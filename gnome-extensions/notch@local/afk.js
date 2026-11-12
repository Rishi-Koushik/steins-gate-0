// AFK mode: a pure black screen that keeps the machine awake.
// While it's up, GNOME is told not to idle-blank, lock or suspend (session inhibitor),
// the cursor is hidden, and everything keeps running underneath. Any key or click
// brings the desktop back; moving the mouse doesn't, so a bump won't wake it.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const INHIBIT_SUSPEND = 4, INHIBIT_IDLE = 8;
const GRACE_MS = 700;       // ignore the tail of the click that started it
const HINT_MS = 2500;

export class AfkScreen {
    get active() { return !!this._actor; }

    start() {
        if (this._actor) return;
        this._actor = new St.Widget({
            style_class: 'afk-screen', reactive: true, can_focus: true,
            layout_manager: new Clutter.BinLayout(),
        });
        this._actor.add_constraint(new Clutter.BindConstraint({
            source: global.stage, coordinate: Clutter.BindCoordinate.ALL,
        }));
        this._hint = new St.Label({
            style_class: 'afk-hint', text: 'Away  ·  press any key or click to come back',
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
        });
        this._actor.add_child(this._hint);
        Main.layoutManager.uiGroup.add_child(this._actor);
        Main.layoutManager.uiGroup.set_child_above_sibling(this._actor, null);

        this._grab = Main.pushModal(this._actor, {actionMode: Shell.ActionMode.NONE});
        this._actor.grab_key_focus();
        this._startedAt = GLib.get_monotonic_time();
        this._actor.connect('captured-event', (_a, ev) => this._onEvent(ev));

        this._actor.opacity = 0;
        this._actor.ease({opacity: 255, duration: 250, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this._hintId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HINT_MS, () => {
            this._hintId = 0;
            this._hint?.ease({opacity: 0, duration: 800});
            return GLib.SOURCE_REMOVE;
        });

        this._cursor = global.backend.get_cursor_tracker();
        this._cursor.inhibit_cursor_visibility();
        this._inhibit();
    }

    stop() {
        if (!this._actor) return;
        if (this._hintId) { GLib.source_remove(this._hintId); this._hintId = 0; }
        if (this._grab) { Main.popModal(this._grab); this._grab = null; }
        this._cursor?.uninhibit_cursor_visibility();
        this._cursor = null;
        this._uninhibit();
        const a = this._actor;
        this._actor = this._hint = null;
        a.ease({opacity: 0, duration: 200, mode: Clutter.AnimationMode.EASE_IN_QUAD, onStopped: () => a.destroy()});
    }

    destroy() {
        this.stop();
    }

    _onEvent(ev) {
        const t = ev.type();
        const wake = t === Clutter.EventType.KEY_PRESS || t === Clutter.EventType.BUTTON_PRESS ||
            t === Clutter.EventType.TOUCH_BEGIN;
        if (wake && GLib.get_monotonic_time() - this._startedAt > GRACE_MS * 1000)
            this.stop();
        return Clutter.EVENT_STOP;   // nothing reaches the desktop underneath
    }

    // org.gnome.SessionManager inhibitors are tied to our bus connection, so they also
    // go away by themselves if the shell restarts.
    _inhibit() {
        Gio.DBus.session.call(
            'org.gnome.SessionManager', '/org/gnome/SessionManager', 'org.gnome.SessionManager', 'Inhibit',
            new GLib.Variant('(susu)', ['org.gnome.Shell', 0, 'AFK screen', INHIBIT_SUSPEND | INHIBIT_IDLE]),
            new GLib.VariantType('(u)'), Gio.DBusCallFlags.NONE, -1, null,
            (conn, res) => {
                try {
                    const [cookie] = conn.call_finish(res).deepUnpack();
                    if (this._actor) this._cookie = cookie;
                    else this._release(cookie);      // stopped before the reply came back
                } catch (e) {
                    console.error(`[notch] AFK inhibit failed: ${e.message}`);
                }
            });
    }

    _uninhibit() {
        if (this._cookie) this._release(this._cookie);
        this._cookie = 0;
    }

    _release(cookie) {
        Gio.DBus.session.call(
            'org.gnome.SessionManager', '/org/gnome/SessionManager', 'org.gnome.SessionManager', 'Uninhibit',
            new GLib.Variant('(u)', [cookie]), null, Gio.DBusCallFlags.NONE, -1, null,
            (conn, res) => { try { conn.call_finish(res); } catch {} });
    }
}
