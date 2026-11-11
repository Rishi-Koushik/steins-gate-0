// Title-screen lock UI drawn on top of GNOME's own UnlockDialog.
// Security boundary stays GNOME's: we only draw, and hand the typed secret to the
// stock AuthPrompt / PAM conversation. If anything here throws, the overlay is
// removed and the stock lock screen is what remains. F12 toggles the overlay.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {dataPath, RUNTIME_DIR} from './config.js';
import {Meter} from './nixie.js';

const REF_W = 1280, REF_H = 720;
const IT = [
    ['NEW GAME', 143, 517, 180, 34], ['CONTINUE', 394, 517, 178, 34], ['EXTRA', 640, 517, 122, 34],
    ['CONFIG', 824, 517, 130, 34], ['HELP', 1017, 517, 96, 34], ['EXIT GAME', 1070, 16, 196, 40],
];
const SUB = [['LOAD', 394, 577, 96, 32], ['QUICK LOAD', 540, 577, 206, 32]];
const BRACKET = [[372, 532, 22, 2], [372, 532, 2, 60], [372, 591, 22, 2]];
const SANS = 'Adwaita Sans, Inter, sans-serif';
const MENU_FONT = 'Archivo Black, Impact, sans-serif';

export class LockScreen {
    constructor(cfg) {
        this._cfg = cfg;
        this._lc = cfg.lock;
        this._timeouts = new Set();
        this._stage = 'menu';
        this._sel = 0;
        this._subSel = 0;
        this._secret = '';
        this._busy = false;
        this.authenticated = false;
        this._hookedVerifier = null;
    }

    // ---------- lifecycle ----------
    attach(dialog) {
        this._dialog = dialog;
        const mon = Main.layoutManager.primaryMonitor;
        // "cover" fills the screen with the 16:9 picture (a 16:10 panel loses 5 % per side),
        // "contain" shows all of it with black bars.
        const cover = this._lc.fit === 'cover';
        const s = this._s = (cover ? Math.max : Math.min)(mon.width / REF_W, mon.height / REF_H);
        this._mon = mon;
        const spareX = mon.width - REF_W * s;
        // Everything is centred. When the picture is cropped (16:10 panel), the baked EXIT GAME
        // and Enter / Back pills would be cut by the right edge: they are redrawn further in.
        this._frameX = Math.round(spareX / 2);
        this._crop = spareX < 0 ? Math.ceil(-spareX / 2 / s) : 0;   // reference px lost per side
        const px = this._px = v => Math.round(v * s);

        this.actor = new St.Widget({
            reactive: true, style: 'background-color: #000;', clip_to_allocation: true,
            x: mon.x, y: mon.y, width: mon.width, height: mon.height,
        });
        this._frame = new St.Widget({
            x: this._frameX, y: Math.round((mon.height - REF_H * s) / 2),
            width: px(REF_W), height: px(REF_H), clip_to_allocation: true,
        });
        this.actor.add_child(this._frame);

        this._still = new St.Widget({
            width: px(REF_W), height: px(REF_H),
            style: `background-image: url("file://${dataPath('media', 'lock_still.jpg')}"); background-size: cover;`,
        });
        this._frame.add_child(this._still);
        this._videoBox = new Clutter.Actor({width: px(REF_W), height: px(REF_H)});
        this._frame.add_child(this._videoBox);

        this._buildMenu();
        this._buildPanels();

        dialog.add_child(this.actor);
        this._capId = dialog.connect('captured-event', (_a, ev) => this._onCaptured(ev));
        this.actor.connect('button-press-event', () => Clutter.EVENT_STOP);
        this.actor.connect('destroy', () => { this.actor = null; });

        // GNOME fades the locked screen to black until input arrives: no video/music while dark.
        const shield = Main.screenShield;
        this._boxes = [shield._longLightbox, shield._shortLightbox].filter(b => b);
        this._boxIds = this._boxes.map(b => b.connect('notify::active', () => this._onDarkChanged()));

        // decide the entry stage
        const flag = GLib.build_filenamev([RUNTIME_DIR, 'boot-clip']);
        // the flag is left by the console `lock` command and by the lock-at-login path
        const explicit = GLib.file_test(flag, GLib.FileTest.EXISTS);
        const wantBoot = this._lc.boot_clip === 'always' || (this._lc.boot_clip !== 'never' && explicit);
        try { Gio.File.new_for_path(flag).delete(null); } catch {}
        this._go(wantBoot ? 'boot' : 'menu');
        // An explicit `lock` asked for the transition clip: light the screen instead of waiting for input.
        if (explicit)
            this._later(400, () => { if (this._dark()) Main.screenShield._wakeUpScreen?.(); });
    }

    detach() {
        for (const id of this._timeouts) GLib.source_remove(id);
        this._timeouts.clear();
        this._stopMedia();
        this._unhookVerifier();
        (this._boxes ?? []).forEach((b, i) => { try { b.disconnect(this._boxIds[i]); } catch {} });
        this._boxes = [];
        if (this._dialog && this._capId) {
            try { this._dialog.disconnect(this._capId); } catch {}
        }
        this._capId = 0;
        this.actor?.destroy();
        this.actor = null;
        this._dialog = null;
    }

    toggleStock() {
        if (!this.actor) return;
        this.actor.visible = !this.actor.visible;
        if (this.actor.visible) this._go('menu'); else this._stopMedia();
    }

    _later(ms, fn) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timeouts.delete(id);
            try { fn(); } catch (e) { console.warn(`[sg-shell] ${e}`); }
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.add(id);
        return id;
    }

    // ---------- media ----------
    _dark() {
        return (this._boxes ?? []).some(b => b.active);
    }

    _onDarkChanged() {
        if (!this.actor) return;
        if (this._dark()) {
            this._stopMedia();
        } else if (this.actor.visible) {
            this._go(this._stage === 'power' ? 'power' : this._stage);
        }
    }

    async _startLoop() {
        if (this._loop || this._loopStarting || this._dark()) return;
        this._loopStarting = true;
        try {
            const {Player} = await import('./video.js');
            if (!this.actor || this._dark() || this._stage === 'boot' || this._stage === 'power') return;
            if (this._lc.video && !this._loop) {
                this._loop = new Player({file: dataPath('media', 'lock_loop.webm'), audio: false, loop: true});
                this._setVideo(this._loop);
                this._loop.play();
            }
            if (this._lc.music && !this._music) {
                this._music = new Player({
                    file: dataPath('media', 'lock_music.ogg'), video: false, loop: true,
                    volume: Number(this._lc.music_volume) || 0.85,
                });
                this._music.play();
            }
        } catch (e) {
            console.warn(`[sg-shell] video unavailable, using still frame: ${e}`);
        } finally {
            this._loopStarting = false;
        }
    }

    _setVideo(player) {
        this._videoBox.destroy_all_children();
        if (!player) return;
        const a = player.makeActor();
        a.set_size(this._px(REF_W), this._px(REF_H));
        this._videoBox.add_child(a);
    }

    async _startBoot() {
        if (this._boot || this._dark()) return;
        try {
            const {Player} = await import('./video.js');
            if (!this.actor || this._stage !== 'boot' || this._boot || this._dark()) return;
            this._boot = new Player({
                file: dataPath('media', 'boot.webm'), loop: false,
                onEnded: () => this._go('menu'), onError: () => this._go('menu'),
            });
            this._still.hide();
            this._setVideo(this._boot);
            this._boot.play();
        } catch (e) {
            console.warn(`[sg-shell] boot clip unavailable: ${e}`);
            this._go('menu');
        }
    }

    _stopMedia() {
        for (const k of ['_loop', '_music', '_boot']) {
            try { this[k]?.destroy(); } catch {}
            this[k] = null;
        }
        this._videoBox?.destroy_all_children();
    }

    _beep(name) {
        if (!this._lc.sounds) return;
        try {
            const f = Gio.File.new_for_path(dataPath('sounds', `${name}.ogg`));
            global.display.get_sound_player().play_from_file(f, 'sg-shell', null);
        } catch {}
    }

    // ---------- widgets ----------
    _hit(label, x, y, w, h, fontPx, onEnter, onClick) {
        const px = this._px;
        const b = new St.Bin({
            x: px(x), y: px(y), width: px(w), height: px(h), reactive: true, track_hover: true,
        });
        b._label = new St.Label({
            text: label, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, opacity: 0,
        });
        b._label.clutter_text.ellipsize = 0;
        const font = f => `font-family: ${MENU_FONT}; font-size: ${f}px; letter-spacing: ${(-0.045 * f).toFixed(1)}px;`;
        b._font = font(px(fontPx));
        b.set_child(b._label);
        b._fontFn = font;
        b._fontPx = px(fontPx);
        b._room = px(w) - 8;
        if (onEnter) b.connect('enter-event', () => { onEnter(); return Clutter.EVENT_PROPAGATE; });
        b.connect('button-release-event', () => { onClick(); return Clutter.EVENT_STOP; });
        this._menu.add_child(b);
        return b;
    }

    _style(b, mode) {
        const px = this._px;
        const set = (box, text) => {
            b.style = box; b._label.style = b._font + text; b._label.opacity = 255;
            // Archivo Black runs wider than the game's face: shrink once until the label fits its baked box.
            if (!b._fitted && b._label.get_stage()) {
                b._fitted = true;
                const [, nat] = b._label.get_preferred_width(-1);
                if (nat > b._room) {
                    b._font = b._fontFn(Math.floor(b._fontPx * b._room / nat));
                    b._label.style = b._font + text;
                }
            }
        };
        switch (mode) {
        case 'sel': set('background-color: #f7a600; box-shadow: 0 0 0 2px #000;', 'color: #000;'); break;
        case 'patch': set('background-color: #06080a;', `color: #eee; text-shadow: ${px(2)}px ${px(2)}px 0 #000;`); break;
        case 'dim': set('background-color: #000;', 'color: #555;'); break;
        case 'parent': set('background-color: #000; border: 2px solid #e8e8e8;', 'color: #666;'); break;
        case 'sub': set('background-color: #000; border: 2px solid #e8e8e8;', 'color: #d4d4d4;'); break;
        default: b.style = ''; b._label.opacity = 0;
        }
    }

    _buildMenu() {
        const px = this._px;
        this._menu = new St.Widget({width: px(REF_W), height: px(REF_H)});
        this._frame.add_child(this._menu);
        // how far the top-right / bottom-right baked items have to move in to stay on screen
        const edge = REF_W - this._crop;
        const dxExit = this._crop ? Math.max(0, 1266 + 10 - edge) : 0;
        const dxPill = this._crop ? Math.max(0, 1240 + 12 - edge) : 0;
        const cover = (x, y, h) => this._menu.add_child(new St.Widget({
            x: px(x), y: px(y), width: px(REF_W - x), height: px(h), style: 'background-color: #06080a;',
        }));
        if (dxExit) cover(1070 - dxExit, 10, 52);
        if (dxPill) {
            cover(1050 - dxPill, 646, 58);
            const pill = new St.Bin({
                x: px(1055 - dxPill), y: px(655), width: px(185), height: px(36),
                style: `border: ${Math.max(1, px(1.5))}px solid #e8e8e8; border-radius: ${px(18)}px; background-color: #000;`,
            });
            pill.set_child(new St.Label({
                text: 'Enter  ·  Back', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
                style: `font-family: ${SANS}; font-weight: 600; font-size: ${px(17)}px; color: #fff;`,
            }));
            this._menu.add_child(pill);
        }
        this._hits = IT.map(([t, x, y, w, h], i) => this._hit(t, i === 5 ? x - dxExit : x, y, w, h, i === 5 ? 38 : 31,
            () => { if (this._stage === 'menu' && this._sel !== i) { this._sel = i; this._paint(); this._beep('hover'); } },
            () => { if (this._stage === 'sub') this._go('menu'); if (this._stage === 'menu') { this._sel = i; this._paint(); this._activate(); } }));
        this._subs = SUB.map(([t, x, y, w, h], i) => this._hit(t, x, y, w, h, 31,
            () => { if (this._stage === 'sub' && this._subSel !== i) { this._subSel = i; this._paint(); this._beep('hover'); } },
            () => { if (this._stage === 'sub') { this._subSel = i; this._subActivate(); } }));
        this._brackets = BRACKET.map(([x, y, w, h]) => {
            const a = new St.Widget({x: px(x), y: px(y), width: Math.max(1, px(w)), height: Math.max(1, px(h)), style: 'background-color: #e8e8e8;'});
            this._menu.add_child(a);
            return a;
        });
        // baked "Enter" / "Back" pills
        this._hit('', 1062 - dxPill, 655, 85, 34, 10, null, () => this._key(Clutter.KEY_Return, ''));
        this._hit('', 1150 - dxPill, 655, 85, 34, 10, null, () => this._key(Clutter.KEY_Escape, ''));
    }

    _panel(width) {
        const px = this._px;
        const p = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL, visible: false, reactive: true,
            width: px(width),
            style: `background-color: rgba(6,8,8,0.96); border-top: ${Math.max(2, px(3))}px solid #fff;` +
                `padding: ${px(22)}px ${px(28)}px; box-shadow: 0 ${px(20)}px ${px(60)}px rgba(0,0,0,0.9);`,
        });
        this._frame.add_child(p);
        return p;
    }

    _text(text, style) {
        const l = new St.Label({text, style});
        l.clutter_text.line_wrap = true;
        return l;
    }

    _buildPanels() {
        const px = this._px;
        const h3 = `font-family: ${SANS}; font-weight: 700; font-size: ${px(20)}px; letter-spacing: ${px(1.6)}px; color: #f7a600; padding-bottom: ${px(6)}px;`;
        const pst = `font-family: ${SANS}; font-size: ${px(14)}px; color: #cfe; padding-bottom: ${px(12)}px;`;
        const name = this._lc.display_name || GLib.get_user_name();

        // --- user list ---
        this._users = this._panel(580);
        this._users.add_child(this._text('CONTINUE — SELECT USER', h3));
        this._users.add_child(this._text('All saved users on this machine.', pst));
        const slot = new St.BoxLayout({
            reactive: true, track_hover: true,
            style: `spacing: ${px(16)}px; padding: ${px(12)}px ${px(14)}px; background-color: #120d08; border: 1px solid #3a2810;`,
        });
        slot.add_child(new St.Label({
            text: name[0].toUpperCase(), width: px(48), height: px(48),
            style: `font-family: ${SANS}; font-weight: 700; font-size: ${px(24)}px; color: #f7a600; background-color: #1a1006;` +
                `border: 1px solid #a35a00; text-align: center; padding-top: ${px(8)}px;`,
        }));
        const meta = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
        for (const [t, st] of [['SAVE DATA 01', `font-size: ${px(12)}px; color: #c98a3a;`], [name, `font-size: ${px(17)}px; color: #fff;`]]) {
            const l = new St.Label({text: t, style: `font-family: ${SANS}; ${st}`});
            l.clutter_text.ellipsize = 0;
            meta.add_child(l);
        }
        slot.add_child(meta);
        slot.connect('button-release-event', () => { this._go('pin'); return Clutter.EVENT_STOP; });
        slot.connect('notify::hover', () => {
            slot.style = slot.style.replace(/border: 1px solid #[0-9a-f]+;/, `border: 1px solid ${slot.hover ? '#f7a600' : '#3a2810'};`);
        });
        this._users.add_child(slot);
        this._users.add_child(this._text('Enter = select · Esc = back', pst + `padding-top: ${px(12)}px; padding-bottom: 0; color: #9aa;`));

        // --- nixie panel ---
        this._pin = this._panel(790);
        this._pin.set_pivot_point(0.5, 0.5);
        this._pin.add_child(this._text('CONTINUE — LOAD SAVE DATA', h3 + 'text-align: center;'));
        const pinMode = this._lc.auth_mode === 'pin';
        this._pin.add_child(this._text(
            `Save 01 · ${name} · Worldline 1.048596\n` + (this._lc.auth_mode === 'none' ? 'Loading save data …'
                : pinMode ? 'Enter your 4-digit PIN.' : 'Type your password, then press Enter.'),
            pst + 'text-align: center;'));
        this._meter = new Meter(this._s);
        this._pin.add_child(this._meter);
        this._msg = this._text('', `font-family: ${SANS}; font-size: ${px(13)}px; color: #e83f8f; text-align: center; padding-top: ${px(10)}px;`);
        this._pin.add_child(this._msg);

        // --- toast ---
        this._toast = new St.Label({
            visible: false,
            style: `font-family: ${SANS}; font-weight: 600; font-size: ${px(14)}px; color: #fff; background-color: rgba(8,22,20,0.92);` +
                `border: 1px solid rgba(255,255,255,0.33); padding: ${px(8)}px ${px(20)}px;`,
        });
        this._frame.add_child(this._toast);

        // --- power / skip hint ---
        this._power = new St.Label({
            visible: false, text: 'POWER ON',
            style: `font-family: ${SANS}; font-weight: 600; font-size: ${px(22)}px; letter-spacing: ${px(6.6)}px; color: #fff;`,
        });
        this._frame.add_child(this._power);
        this._skip = new St.Label({
            visible: false, text: 'Ctrl+Shift+Esc — skip',
            style: `font-family: ${SANS}; font-weight: 600; font-size: ${px(13)}px; color: #ddd; background-color: rgba(0,0,0,0.55);` +
                `border: 1px solid rgba(255,255,255,0.4); border-radius: ${px(14)}px; padding: ${px(5)}px ${px(12)}px;`,
        });
        this._frame.add_child(this._skip);
    }

    _center(actor, topFrac = 0.5, anchor = 0.5) {
        const [, natH] = actor.get_preferred_height(actor.width > 0 ? actor.width : -1);
        const [, natW] = actor.get_preferred_width(-1);
        const w = actor.width > 0 ? actor.width : natW;
        // centred on the screen, whatever part of the frame is cropped
        actor.set_position(Math.round((this._mon.width - w) / 2) - this._frame.x,
            Math.round(this._frame.height * topFrac - natH * anchor));
    }

    _fadeIn(actor, ms) {
        actor.remove_all_transitions();
        actor.opacity = 0;
        actor.show();
        actor.ease({opacity: 255, duration: ms, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    // dialogs fade in and settle upwards
    _popIn(actor) {
        actor.remove_all_transitions();
        actor.set_pivot_point(0.5, 0.5);
        actor.opacity = 0;
        actor.translation_x = 0;
        actor.translation_y = this._px(18);
        actor.ease({opacity: 255, translation_y: 0, duration: 280, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
    }

    _showToast(text) {
        this._toast.text = text;
        this._fadeIn(this._toast, 300);
        this._center(this._toast, 460 / 720, 0);
        if (this._toastId) { GLib.source_remove(this._toastId); this._timeouts.delete(this._toastId); }
        this._toastId = this._later(2400, () => {
            this._toastId = 0;
            this._toast?.ease({opacity: 0, duration: 300, mode: Clutter.AnimationMode.EASE_OUT_QUAD, onComplete: () => this._toast?.hide()});
        });
    }

    // ---------- state machine ----------
    _go(stage) {
        if (!this.actor) return;
        // title_screen = false: no title menu at all, the nixie panel is the whole lock screen
        if (stage === 'menu' && this._lc.title_screen === false) stage = 'pin';
        const bare = stage === 'pin' && this._lc.title_screen === false;
        const prev = this._stage;
        this._stage = stage;
        const media = stage !== 'boot' && stage !== 'power';
        const wasMedia = prev !== 'boot' && prev !== 'power';
        this._menu.visible = media && !bare;
        this._users.visible = stage === 'users';
        this._pin.visible = stage === 'pin';
        this._power.visible = stage === 'power';
        this._skip.visible = stage === 'boot';
        this._toast.remove_all_transitions();
        this._toast.hide();
        this._power.remove_all_transitions();
        // scene cross-fades, as in the demo (.scene opacity .5s)
        if (media !== wasMedia || (stage === 'boot' && prev !== 'boot'))
            this._fadeIn(this._frame, stage === 'boot' ? 400 : 900);

        if (!media) {
            for (const k of ['_loop', '_music']) { try { this[k]?.destroy(); } catch {} this[k] = null; }
        } else if (this._boot) {
            try { this._boot.destroy(); } catch {}
            this._boot = null;
            this._videoBox.destroy_all_children();
        }
        this._still.visible = media && !bare;

        switch (stage) {
        case 'boot':
            this._startBoot();
            this._skip.set_position(this._mon.width - this._frame.x - this._px(190),
                this._mon.height - this._frame.y - this._px(44));
            break;
        case 'power':
            this._videoBox.destroy_all_children();
            this._center(this._power);
            this._power.opacity = 255;
            this._power.ease({opacity: 64, duration: 900, mode: Clutter.AnimationMode.EASE_IN_OUT_SINE, repeatCount: -1, autoReverse: true});
            break;
        case 'menu': case 'sub':
            this._startLoop();
            this._paint();
            break;
        case 'users':
            this._startLoop();
            this._paint();
            this._center(this._users);
            if (prev !== stage) this._popIn(this._users);
            this._beep('select');
            break;
        case 'pin':
            if (!bare) { this._startLoop(); this._paint(); }
            this._secret = '';
            this._busy = false;
            if (this._lc.auth_mode === 'none') {
                this._center(this._pin, 0.5, 0.42);
                if (prev !== stage) this._popIn(this._pin);
                this._beep('select');
                this._openWithoutSecret();
                break;
            }
            this._setMsg(this._lc.auth_mode === 'pin'
                ? 'Type your 4-digit PIN · Backspace erases · Esc = back'
                : 'Type your password · Enter submits · Esc = back', '#e83f8f');
            this._renderSecret();
            this._center(this._pin, 0.5, 0.42);
            if (prev !== stage) this._popIn(this._pin);
            this._ensurePrompt();
            this._beep('select');
            break;
        }
    }

    _paint() {
        const sub = this._stage === 'sub';
        const menu = this._stage === 'menu';
        this._hits.forEach((b, i) => {
            let m = null;
            const moved = i === 5 && this._crop;   // EXIT GAME redrawn inside the visible area
            if (sub) m = i === 1 ? 'parent' : i === 5 ? (moved ? 'patch' : null) : 'dim';
            else if (menu && i === this._sel) m = 'sel';
            else if (moved) m = 'patch';
            else if (i === 0 && (this._sel !== 0 || !menu)) m = 'patch';
            this._style(b, m);
        });
        this._subs.forEach((b, i) => {
            b.visible = sub;
            this._style(b, i === this._subSel ? 'sel' : 'sub');
        });
        this._brackets.forEach(a => { a.visible = sub; });
    }

    _activate() {
        const k = IT[this._sel][0];
        this._beep('select');
        if (k === 'CONTINUE') { this._subSel = 0; this._go('sub'); }
        else if (k === 'NEW GAME') this._showToast('NEW GAME → creating a Linux account needs the owner\'s approval — see BUILD-NOTES.md');
        else if (k === 'EXIT GAME') this._go('power');
        else if (k === 'HELP') this._showToast('← → move · ↑ EXIT GAME · Enter select · Esc back · F12 stock lock screen');
        else this._showToast(`${k} → not wired`);
    }

    _subActivate() {
        this._beep('select');
        this._go(this._subSel === 0 ? 'users' : 'pin');
    }

    // ---------- input ----------
    _onCaptured(ev) {
        if (ev.type() !== Clutter.EventType.KEY_PRESS)
            return Clutter.EVENT_PROPAGATE;
        const sym = ev.get_key_symbol();
        if (sym === Clutter.KEY_F12) {
            this.toggleStock();
            return Clutter.EVENT_STOP;
        }
        if (!this.actor?.visible)
            return Clutter.EVENT_PROPAGATE;
        try {
            const mods = ev.get_state();
            const ctrlShift = (mods & Clutter.ModifierType.CONTROL_MASK) && (mods & Clutter.ModifierType.SHIFT_MASK);
            this._key(sym, ev.get_key_unicode(), ctrlShift);
        } catch (e) {
            console.warn(`[sg-shell] key handling failed: ${e}`);
        }
        return Clutter.EVENT_STOP;
    }

    _key(sym, ch, ctrlShift = false) {
        const K = Clutter;
        const enter = sym === K.KEY_Return || sym === K.KEY_KP_Enter;
        switch (this._stage) {
        case 'boot':
            if (sym === K.KEY_Escape) this._go('menu');
            break;
        case 'power':
            if (![K.KEY_Shift_L, K.KEY_Shift_R, K.KEY_Control_L, K.KEY_Control_R, K.KEY_Alt_L, K.KEY_Alt_R, K.KEY_Super_L].includes(sym))
                this._go('boot');
            break;
        case 'menu':
            if (sym === K.KEY_Right) this._sel = this._sel >= 4 ? 0 : this._sel + 1;
            else if (sym === K.KEY_Left) this._sel = this._sel <= 0 || this._sel === 5 ? 4 : this._sel - 1;
            else if (sym === K.KEY_Up) this._sel = 5;
            else if (sym === K.KEY_Down && this._sel === 5) this._sel = 0;
            else if (enter) { this._activate(); return; }
            else return;
            this._paint();
            this._beep('hover');
            break;
        case 'sub':
            if (sym === K.KEY_Right || sym === K.KEY_Left) { this._subSel = 1 - this._subSel; this._paint(); this._beep('hover'); }
            else if (enter) this._subActivate();
            else if (sym === K.KEY_Escape) this._go('menu');
            break;
        case 'users':
            if (enter) this._go('pin');
            else if (sym === K.KEY_Escape) this._go('menu');
            break;
        case 'pin':
            this._pinKey(sym, ch, enter);
            break;
        }
    }

    _pinKey(sym, ch, enter) {
        if (sym === Clutter.KEY_Escape) {
            this._secret = '';
            this._go('menu');
            return;
        }
        if (this._busy) return;
        const pinMode = this._lc.auth_mode === 'pin';
        if (sym === Clutter.KEY_BackSpace) {
            this._secret = this._secret.slice(0, -1);
            this._beep('back');
        } else if (enter) {
            if (this._secret.length && (!pinMode || this._secret.length === 4)) this._submit();
            return;
        } else if (ch && ch >= ' ' && ch !== '\x7f') {
            if (pinMode && (!/^[0-9]$/.test(ch) || this._secret.length >= 4)) return;
            this._secret += ch;
            this._beep(`digit${Math.min(4, this._secret.length)}`);
            if (pinMode && this._secret.length === 4)
                this._later(350, () => { if (this._stage === 'pin' && this._secret.length === 4) this._submit(); });
        } else {
            return;
        }
        this._renderSecret();
    }

    _renderSecret(randomise = false) {
        const pinMode = this._lc.auth_mode === 'pin';
        // Digits light their own numeral; anything else (the tubes only hold 0-9) glows as a dot.
        // A password longer than four characters shows its last four.
        const shown = pinMode ? this._secret : this._secret.slice(-4);
        const mid = [0, 1, 2, 3].map(i => {
            if (randomise) return String(Math.floor(Math.random() * 10));
            const c = shown[i];
            if (c === undefined) return null;
            return /^[0-9]$/.test(c) ? c : '*';
        });
        this._meter.show8(['0', '.', ...mid, '3', '1']);
        if (!pinMode && !randomise && this._stage === 'pin' && !this._busy && this._secret.length > 4)
            this._setMsg(`${this._secret.length} characters · Enter submits`, '#c98a3a');
    }

    _setMsg(text, color) {
        this._msg.text = text;
        this._msg.style = this._msg.style.replace(/color: [^;]+;/, `color: ${color};`);
    }

    // ---------- auth_mode = "none": no secret, the tubes spin to the worldline and the session opens ----------
    // The owner chose this: the lock screen is then a title screen, not a security boundary.
    // The account password is untouched (sudo, TTY, F12 stock prompt still ask for it).
    _openWithoutSecret() {
        const run = this._openRun = (this._openRun ?? 0) + 1;
        this._renderSecret();
        // never open a blanked screen: _onDarkChanged re-enters this stage when it lights up
        if (this._dark()) return;
        const live = () => this.actor && this._stage === 'pin' && this._openRun === run && !this._dark();
        this._busy = true;
        this._setMsg('Reading Steiner …', '#c98a3a');
        const n = 22;
        for (let i = 0; i < n; i++)
            this._later(i * 70, () => { if (live()) this._renderSecret(true); });
        this._later(n * 70, () => {
            if (!live()) return;
            this._meter.show8(['1', '.', '0', '4', '8', '5', '9', '6']);
            this._setMsg('Reading Steiner … worldline reached', '#88ff88');
        });
        this._later(n * 70 + 900, () => {
            if (!live()) return;
            this._onComplete();
            Main.screenShield.deactivate(true);
        });
    }

    // ---------- authentication (stock AuthPrompt underneath) ----------
    _ensurePrompt() {
        const d = this._dialog;
        if (!d) return null;
        d._showPrompt();
        const ap = d._authPrompt;
        const uv = ap?._userVerifier;
        if (uv && uv !== this._hookedVerifier) {
            this._unhookVerifier();
            this._hookedVerifier = uv;
            this._uvIds = [
                uv.connect('verification-failed', () => this._onFailed()),
                uv.connect('verification-complete', () => this._onComplete()),
                uv.connect('show-message', (_v, _svc, message) => {
                    if (message && this._stage === 'pin') this._setMsg(message, '#e83f8f');
                }),
            ];
        }
        return ap;
    }

    _unhookVerifier() {
        if (this._hookedVerifier && this._uvIds) {
            for (const id of this._uvIds) {
                try { this._hookedVerifier.disconnect(id); } catch {}
            }
        }
        this._hookedVerifier = null;
        this._uvIds = null;
    }

    _submit() {
        if (this._busy) return;
        const ap = this._ensurePrompt();
        if (!ap?._entry) {
            this._setMsg('Authentication is not ready — press F12 for the stock lock screen.', '#e83f8f');
            return;
        }
        this._busy = true;
        this._setMsg('Reading Steiner …', '#c98a3a');
        const secret = this._secret;
        this._secret = '';
        ap._entry.text = secret;
        ap._activateNext(false);
        // If PAM never answers, let the user try again.
        this._busyGuard = this._later(15000, () => {
            if (this._busy) { this._busy = false; this._setMsg('No answer from the authenticator. Try again.', '#e83f8f'); this._renderSecret(); }
        });
    }

    _onFailed() {
        if (!this.actor || this._stage !== 'pin') return;
        this._setMsg(this._lc.auth_mode === 'pin'
            ? 'Wrong PIN. The worldline did not change.' : 'Wrong password. The worldline did not change.', '#e83f8f');
        this._beep('wrong');
        // shake
        const p = this._pin, d = this._px(10);
        const seq = [-d, d * 0.9, -d * 0.5, 0];
        const step = i => {
            if (!this.actor || i >= seq.length) return;
            p.ease({translation_x: seq[i], duration: 100, mode: Clutter.AnimationMode.EASE_OUT_QUAD, onComplete: () => step(i + 1)});
        };
        step(0);
        // flicker random digits 8 × 60 ms, then clear
        for (let i = 0; i < 8; i++)
            this._later(i * 60, () => this._renderSecret(true));
        this._later(8 * 60, () => {
            this._busy = false;
            this._secret = '';
            this._renderSecret();
            this._later(400, () => { if (this._stage === 'pin') this._ensurePrompt(); });
        });
    }

    _onComplete() {
        this.authenticated = true;
        if (!this.actor) return;
        this._setMsg('Reading Steiner … authenticated', '#88ff88');
        this._beep('ok');
        try { this._music?.destroy(); } catch {}
        this._music = null;
    }
}
