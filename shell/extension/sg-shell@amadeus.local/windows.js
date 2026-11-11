// Wayland clients cannot position themselves or stay on top, so the shell places the
// three SG app windows: console (bottom edge / floating), phone (right edge), clip (fullscreen).
import Meta from 'gi://Meta';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const IDS = {
    'local.amadeus.SgConsole': 'console',
    'local.amadeus.SgPhone': 'phone',
    'local.amadeus.SgClip': 'clip',
};

export class WindowHelper {
    constructor(onClipMapped) {
        this._onClipMapped = onClipMapped;
        this._tracked = new Map();
        this._createdId = global.display.connect('window-created', (_d, win) => this._maybeTrack(win));
        for (const actor of global.get_window_actors())
            this._maybeTrack(actor.meta_window);
    }

    _kind(win) {
        return IDS[win.get_wm_class()] ?? IDS[win.get_gtk_application_id?.()] ?? null;
    }

    _maybeTrack(win) {
        if (!win || this._tracked.has(win)) return;
        let kind = this._kind(win);
        const ids = [];
        const setup = () => {
            kind = this._kind(win);
            if (!kind || this._tracked.has(win)) return;
            this._tracked.set(win, ids);
            win.make_above();
            win.stick();
            if (kind === 'clip') {
                this._onClipMapped?.();
            } else {
                ids.push(win.connect('size-changed', () => this._place(win, kind)));
                ids.push(win.connect('notify::title', () => this._place(win, kind)));
                if (kind === 'console') this._hideUntilSized(win);
                this._place(win, kind);
            }
            win.connect('unmanaged', () => this._tracked.delete(win));
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                try { win.activate(global.get_current_time()); } catch {}
                return GLib.SOURCE_REMOVE;
            });
        };
        if (kind) {
            setup();
        } else {
            // app id may arrive after creation
            const id = win.connect('notify::wm-class', () => { setup(); if (this._tracked.has(win)) win.disconnect(id); });
            win.connect('unmanaged', () => { try { win.disconnect(id); } catch {} });
        }
    }

    _place(win, kind) {
        const mon = Main.layoutManager.primaryMonitor;
        if (!mon) return;
        const r = win.get_frame_rect();
        // Animate the surface inside the window actor: GNOME's own window effects reset the
        // window actor's translation when they finish, but leave its children alone.
        const actor = win.get_compositor_private()?.get_first_child() ?? null;
        if (kind === 'phone') {
            win.move_frame(true, mon.x + mon.width - r.width, mon.y);
        } else if (kind === 'console') {
            const title = win.title ?? '';
            if (!win._sgShown) {
                // slide in once the first real size is known (it is 0 when the window is created)
                if (r.height <= 1 || !actor) return;
                win._sgShown = true;
                win._sgH = r.height;
                const floating = title.includes(':float');
                if (floating) {
                    win._sgFloated = true;
                    win.move_frame(true, mon.x + 150, mon.y + mon.height - 90 - r.height);
                } else if (!title.includes(':fullscreen')) {
                    win.move_frame(true, mon.x, mon.y + mon.height - r.height);
                }
                const from = title.includes(':fullscreen') ? 0 : r.height + (floating ? 90 : 0);
                const slide = () => {
                    actor.remove_transition('translation-y');
                    actor.translation_y = from;
                    actor.ease({translation_y: 0, duration: 800, mode: Clutter.AnimationMode.EASE_OUT_QUART});
                };
                // a transition on an actor that is not on screen yet finishes at once
                if (actor.mapped) {
                    slide();
                } else {
                    actor.translation_y = from;
                    const id = actor.connect('notify::mapped', () => {
                        if (!actor.mapped) return;
                        actor.disconnect(id);
                        slide();
                    });
                }
                return;
            }
            if (title.endsWith(':closing')) {
                // the app hides itself right after this slide-out
                win._sgClosing = true;
                actor?.ease({translation_y: r.height, duration: 260, mode: Clutter.AnimationMode.EASE_IN_QUAD});
                return;
            }
            if (win._sgClosing) {
                // re-opened before the slide-out finished
                win._sgClosing = false;
                actor?.ease({translation_y: 0, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            }
            if (title.includes(':fullscreen') || (typeof win.is_fullscreen === 'function' && win.is_fullscreen())) {
                win._sgFloated = false;
                return;
            }
            const floating = title.includes(':float');
            if (floating) {
                if (!win._sgFloated) {
                    win._sgFloated = true;
                    win.move_frame(true, mon.x + 150, mon.y + mon.height - 90 - r.height);
                }
            } else {
                win._sgFloated = false;
                win.move_frame(true, mon.x, mon.y + mon.height - r.height);
                // tall / normal jumps: the bar rises from its old top edge instead of popping
                const grew = r.height - (win._sgH ?? r.height);
                if (actor && grew > 60 && !actor.get_transition('translation-y')) {
                    actor.translation_y = grew;
                    actor.ease({translation_y: 0, duration: 450, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
                }
            }
            win._sgH = r.height;
        }
    }

    _hideUntilSized(win) {
        const actor = win.get_compositor_private()?.get_first_child();
        const mon = Main.layoutManager.primaryMonitor;
        if (actor && mon) actor.translation_y = mon.height;
    }

    destroy() {
        global.display.disconnect(this._createdId);
        for (const [win, ids] of this._tracked) {
            for (const id of ids) {
                try { win.disconnect(id); } catch {}
            }
        }
        this._tracked.clear();
    }
}
