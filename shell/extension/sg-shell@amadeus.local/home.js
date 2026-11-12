// Home-screen extras that only run in the unlocked session:
//   - desktop notifications are copied into the phone's inbox as mails
//   - battery / 3 a.m. / login events make the contacts mail and Amadeus call (via sg-mail, sg-phone)
//   - a rare Upa capsule drops onto the screen; clicking it adds it to the collection
//   - a tiny command file lets the phone ask the shell for things only the shell can do (screenshot)
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {dataPath, RUNTIME_DIR} from './config.js';
import {writeMail, addUpa, playSound, arrivedDmails, deliverDmail} from './mailbox.js';

const dec = new TextDecoder();
const TICK_S = 60;
const UPA_LIFE_MS = 90000;
const UPA_KINDS = [['metal', 1], ['gold', 0.4], ['green', 6], ['blue', 2], ['pink', 2]];
const UPA_RGB = {
    green: [0.38, 0.80, 0.36], blue: [0.33, 0.62, 0.92], pink: [0.95, 0.52, 0.70],
    metal: [0.78, 0.80, 0.84], gold: [0.93, 0.74, 0.25],
};

function spawn(argv) {
    try {
        if (GLib.file_test(argv[0], GLib.FileTest.IS_EXECUTABLE))
            Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
    } catch (e) {
        console.warn(`[sg-shell] could not start ${argv[0]}: ${e}`);
    }
}

function readText(path) {
    try {
        return dec.decode(GLib.file_get_contents(path)[1]).trim();
    } catch {
        return null;
    }
}

function battery() {
    for (let i = 0; i < 3; i++) {
        const cap = readText(`/sys/class/power_supply/BAT${i}/capacity`);
        if (cap !== null && cap !== '')
            return {level: Number(cap), status: readText(`/sys/class/power_supply/BAT${i}/status`) ?? ''};
    }
    return null;
}

export class HomeExtras {
    constructor(cfg) {
        this._cfg = cfg;
        this._sources = new Map();
        this._seen = new Map();
        this._flags = {};
        this._upa = null;

        if (cfg.phone.notifications_as_mail) {
            this._trayId = Main.messageTray.connect('source-added', (_t, source) => this._watch(source));
            for (const s of Main.messageTray.getSources?.() ?? []) this._watch(s);
        }
        this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, TICK_S, () => {
            try { this._tick(); } catch (e) { console.warn(`[sg-shell] home tick: ${e}`); }
            return GLib.SOURCE_CONTINUE;
        });
        this._watchCommands();
    }

    destroy() {
        if (this._trayId) Main.messageTray.disconnect(this._trayId);
        for (const [source, ids] of this._sources) {
            for (const id of ids) { try { source.disconnect(id); } catch {} }
        }
        this._sources.clear();
        if (this._tickId) GLib.source_remove(this._tickId);
        this._tickId = 0;
        try { this._cmdMon?.cancel(); } catch {}
        this._cmdMon = null;
        this._dropUpa();
    }

    // ----- notifications → phone mail -----
    _watch(source) {
        if (this._sources.has(source)) return;
        try {
            this._sources.set(source, [
                source.connect('notification-added', (s, n) => this._onNotification(s, n)),
                source.connect('destroy', () => this._sources.delete(source)),
            ]);
        } catch {}
    }

    _onNotification(source, n) {
        try {
            const from = String(source?.title ?? '').trim() || 'System';
            const subject = String(n?.title ?? '').trim();
            const body = String(n?.body ?? '').trim();
            if (!subject && !body) return;
            // an app that updates one notification again and again is one mail, not twenty
            const key = `${from}\n${subject}\n${body}`, now = Date.now();
            if (now - (this._seen.get(key) ?? 0) < 60000) return;
            this._seen.set(key, now);
            if (this._seen.size > 200) this._seen.clear();
            writeMail({from, subject: subject || body.slice(0, 60), body, kind: 'notify'});
        } catch (e) {
            console.warn(`[sg-shell] notification not mailed: ${e}`);
        }
    }

    // ----- events -----
    // called once per unlock; the first one after login is "booted"
    loggedIn() {
        const flag = GLib.build_filenamev([RUNTIME_DIR, 'login-mail']);
        if (GLib.file_test(flag, GLib.FileTest.EXISTS)) return;
        try {
            GLib.mkdir_with_parents(RUNTIME_DIR, 0o700);
            GLib.file_set_contents(flag, '');
        } catch {}
        if (this._cfg.phone.character_mails) spawn([dataPath('apps', 'sg-mail'), 'event', 'login']);
        playSound('crt');
    }

    _tick() {
        // D-Mails the lock screen never got to show (stock lock screen, F12) still reach the inbox.
        // Not at start-up: the login lock screen comes first and shows them itself.
        if (this._cfg.dmail.enabled) arrivedDmails().forEach(deliverDmail);
        const f = this._flags;
        const b = battery();
        if (b) {
            const draining = /discharging/i.test(b.status);
            if (!draining || b.level > 25) f.mail = f.call = false;
            if (draining && b.level <= 20 && !f.mail) {
                f.mail = true;
                if (this._cfg.phone.character_mails) spawn([dataPath('apps', 'sg-mail'), 'event', 'battery-low', `${b.level}`]);
            }
            if (draining && b.level <= 10 && !f.call) {
                f.call = true;
                if (this._cfg.amadeus.calls) spawn([dataPath('apps', 'sg-phone'), '--call', 'battery', `${b.level}`]);
            }
        }
        // 3 a.m. and still at the keyboard: once a night
        const d = new Date();
        if (d.getHours() === 3 && this._cfg.amadeus.calls) {
            const night = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
            const flag = GLib.build_filenamev([RUNTIME_DIR, 'late-call']);
            let idle = 0;
            try { idle = global.backend.get_core_idle_monitor().get_idletime(); } catch {}
            if (idle < 5 * 60000 && readText(flag) !== night) {
                try {
                    GLib.mkdir_with_parents(RUNTIME_DIR, 0o700);
                    GLib.file_set_contents(flag, night);
                } catch {}
                spawn([dataPath('apps', 'sg-phone'), '--call', 'late']);
            }
        }
        // Upa: about [home] upa_per_day drops across a 16-hour day
        const perDay = Number(this._cfg.home.upa_per_day) || 0;
        if (this._cfg.home.upa && perDay > 0 && !this._upa && Math.random() < perDay / (16 * 60))
            this.dropUpa();
    }

    // ----- phone → shell commands (a one-word file in the runtime dir) -----
    _watchCommands() {
        try {
            GLib.mkdir_with_parents(RUNTIME_DIR, 0o700);
            const file = Gio.File.new_for_path(GLib.build_filenamev([RUNTIME_DIR, 'shell-cmd']));
            this._cmdMon = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._cmdMon.connect('changed', (_m, f, _o, ev) => {
                if (ev !== Gio.FileMonitorEvent.CHANGES_DONE_HINT && ev !== Gio.FileMonitorEvent.CREATED) return;
                const cmd = readText(f.get_path());
                if (!cmd) return;
                try { f.delete(null); } catch {}
                if (cmd === 'screenshot') Main.screenshotUI?.open().catch(() => {});
                else if (cmd === 'upa') this.dropUpa();
            });
        } catch (e) {
            console.warn(`[sg-shell] command watch unavailable: ${e}`);
        }
    }

    // ----- Upa capsule -----
    dropUpa(kind = null) {
        const mon = Main.layoutManager.primaryMonitor;
        if (!mon || this._upa) return;
        if (!kind) {
            let r = Math.random() * UPA_KINDS.reduce((a, [, w]) => a + w, 0);
            kind = UPA_KINDS.find(([, w]) => (r -= w) < 0)?.[0] ?? 'green';
        }
        const size = Math.round(Math.max(56, mon.height * 0.07));
        const rgb = UPA_RGB[kind] ?? UPA_RGB.green;
        const a = new St.DrawingArea({width: size, height: size, reactive: true, track_hover: true});
        a.connect('repaint', () => {
            const cr = a.get_context();
            const [w, h] = a.get_surface_size();
            const c = w / 2, r = Math.min(w, h) / 2 - 2;
            // lower half: coloured shell; upper half: clear dome with the Upa's head inside
            cr.arc(c, c, r, 0, Math.PI); cr.closePath();
            cr.setSourceRGBA(rgb[0] * 0.75, rgb[1] * 0.75, rgb[2] * 0.75, 1); cr.fill();
            cr.arc(c, c, r, Math.PI, 2 * Math.PI); cr.closePath();
            cr.setSourceRGBA(1, 1, 1, 0.28); cr.fill();
            cr.arc(c, c + r * 0.05, r * 0.56, 0, 2 * Math.PI);
            cr.setSourceRGBA(rgb[0], rgb[1], rgb[2], 1); cr.fill();
            cr.setSourceRGBA(0.08, 0.08, 0.1, 1);
            for (const dx of [-0.2, 0.2]) { cr.arc(c + r * dx, c - r * 0.06, r * 0.07, 0, 2 * Math.PI); cr.fill(); }
            cr.setLineWidth(Math.max(1.5, r * 0.07));
            cr.arc(c, c, r, 0, 2 * Math.PI); cr.setSourceRGBA(0.05, 0.05, 0.06, 0.9); cr.stroke();
            cr.moveTo(c - r, c); cr.lineTo(c + r, c); cr.stroke();
            cr.arc(c - r * 0.35, c - r * 0.45, r * 0.16, 0, 2 * Math.PI);
            cr.setSourceRGBA(1, 1, 1, 0.55); cr.fill();
            cr.$dispose();
        });
        const x = mon.x + Math.round(size + Math.random() * (mon.width - 3 * size));
        const y = mon.y + mon.height - size - Math.round(mon.height * 0.05);
        a.set_position(x, y);
        a.set_pivot_point(0.5, 1);
        Main.layoutManager.addChrome(a, {trackFullscreen: true});
        this._upa = {actor: a, kind};
        // falls in, then keeps hopping
        a.translation_y = -(mon.height * 0.6);
        a.ease({
            translation_y: 0, duration: 900, mode: Clutter.AnimationMode.EASE_OUT_BOUNCE,
            onComplete: () => {
                if (this._upa?.actor !== a) return;
                a.ease({
                    translation_y: -Math.round(size * 0.35), duration: 520, delay: 400,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD, repeatCount: -1, autoReverse: true,
                });
            },
        });
        a.connect('button-release-event', () => { this._catchUpa(); return Clutter.EVENT_STOP; });
        this._upaTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, UPA_LIFE_MS, () => {
            this._upaTimer = 0;
            this._dropUpa(true);
            return GLib.SOURCE_REMOVE;
        });
    }

    _catchUpa() {
        const u = this._upa;
        if (!u || u.caught) return;
        u.caught = true;
        try { addUpa(u.kind); } catch (e) { console.warn(`[sg-shell] Upa not saved: ${e}`); }
        playSound('upa', 'ok');
        const rare = u.kind === 'metal' || u.kind === 'gold';
        try {
            writeMail({
                from: 'Upa', kind: 'upa', subject: rare ? `A ${u.kind} Upa!` : `Caught a ${u.kind} Upa`,
                body: rare ? `A ${u.kind} Upa. Those hardly ever drop. It is in your collection: phone → Gadgets → Upa collection.`
                    : `A ${u.kind} Upa is in your collection: phone → Gadgets → Upa collection.`,
            });
        } catch {}
        this._dropUpa(true);
    }

    _dropUpa(animate = false) {
        if (this._upaTimer) GLib.source_remove(this._upaTimer);
        this._upaTimer = 0;
        const u = this._upa;
        this._upa = null;
        if (!u) return;
        const a = u.actor;
        const gone = () => {
            try { Main.layoutManager.removeChrome(a); } catch {}
            a.destroy();
        };
        if (!animate) { gone(); return; }
        a.remove_all_transitions();
        a.reactive = false;
        a.ease({
            opacity: 0, scale_x: 1.6, scale_y: 1.6, duration: 320,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD, onComplete: gone,
        });
    }
}
