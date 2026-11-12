// Dynamic-island notch for GNOME Shell 50. Replaces the top bar entirely.
//   compact : now playing (or clock when idle), sits under the camera
//   expanded: left  = quick settings (wifi, bluetooth, sliders, power…), scrollable
//             right = what you're doing (focused app + media) and every open window
// Hidden automatically whenever the monitor has a fullscreen window.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Pango from 'gi://Pango';
import Graphene from 'gi://Graphene';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import {MprisWatcher} from './mpris.js';
import {QuickMirror} from './quick.js';
import {AfkScreen} from './afk.js';

// Geometry measured on the 1920x1200 logical screen (straightened from coords.json).
// Stored relative to that reference so it still lines up if scaling changes.
const REF_W = 1920;
const NOTCH = {x: 680, y: 0, w: 556, h: 30};
const PANEL_H = 260;
const LEFT_RATIO = 0.42;
const ANIM_MS = 260;
const LEAVE_COLLAPSE_MS = 700;

const VERTICAL = Clutter.Orientation.VERTICAL;

function label(text, style_class) {
    const l = new St.Label({text, style_class, y_align: Clutter.ActorAlign.CENTER});
    l.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return l;
}

function artIcon(url, size, fallback) {
    let gicon = null;
    if (url) {
        try { gicon = new Gio.FileIcon({file: Gio.File.new_for_uri(url)}); } catch { gicon = null; }
    }
    return new St.Icon({
        gicon: gicon ?? Gio.ThemedIcon.new(fallback), icon_size: size,
        style_class: 'notch-art', y_align: Clutter.ActorAlign.CENTER,
    });
}

export default class NotchExtension extends Extension {
    enable() {
        this._expanded = false;
        this._tracker = Shell.WindowTracker.get_default();
        this._signals = [];
        this._afk = new AfkScreen();

        this._hideTopBar();

        this._island = new St.Widget({
            style_class: 'notch-island', reactive: true, track_hover: true,
            clip_to_allocation: true, layout_manager: new Clutter.BinLayout(),
        });
        this._buildCompact();
        this._buildExpanded();

        Main.layoutManager.addChrome(this._island, {trackFullscreen: true});

        this._island.connect('button-release-event', (_a, ev) => this._onClick(ev));
        this._island.connect('notify::hover', () => this._onHover());

        this._mpris = new MprisWatcher(() => this._sync());

        const d = global.display;
        this._connect(d, 'notify::focus-window', () => { this._watchFocusTitle(); this._sync(); });
        this._connect(d, 'window-created', () => this._sync());
        this._connect(global.window_manager, 'destroy', () => this._sync());
        this._connect(Main.layoutManager, 'monitors-changed', () => this._place());
        this._stageId = global.stage.connect('captured-event', (_s, ev) => this._onStageEvent(ev));

        this._clockId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, () => {
            this._updateCompact(); return GLib.SOURCE_CONTINUE;
        });

        this._place();
        this._watchFocusTitle();
        this._sync();
        console.log(`[notch] enabled at ${this._island.x},${this._island.y} ${this._island.width}x${this._island.height}`);
    }

    disable() {
        for (const [obj, id] of this._signals) obj.disconnect(id);
        this._signals = [];
        if (this._titleSig) { this._titleSig[0].disconnect(this._titleSig[1]); this._titleSig = null; }
        global.stage.disconnect(this._stageId);
        GLib.source_remove(this._clockId);
        if (this._leaveId) GLib.source_remove(this._leaveId);
        this._leaveId = 0;
        this._afk.destroy();
        this._afk = null;
        this._mpris.destroy();
        this._mpris = null;
        this._quick.destroy();
        this._quick = null;
        Main.layoutManager.removeChrome(this._island);
        this._island.destroy();
        this._island = null;
        this._tracker = null;
        this._restoreTopBar();
    }

    // ---------- top bar ----------
    // panelBox is tracked chrome that reserves a strut and is forced visible on
    // fullscreen changes; re-track it without either so windows get the full height.
    _hideTopBar() {
        const lm = Main.layoutManager, box = lm.panelBox;
        lm.untrackChrome(box);
        lm.trackChrome(box, {affectsStruts: false, trackFullscreen: false});
        box.hide();
        this._panelVisId = box.connect('notify::visible', () => box.visible && box.hide());
    }

    _restoreTopBar() {
        const lm = Main.layoutManager, box = lm.panelBox;
        box.disconnect(this._panelVisId);
        lm.untrackChrome(box);
        lm.trackChrome(box, {affectsStruts: true, trackFullscreen: true});
        box.show();
    }

    _connect(obj, sig, fn) { this._signals.push([obj, obj.connect(sig, fn)]); }

    // ---------- layout ----------
    _geom() {
        const mon = Main.layoutManager.primaryMonitor;
        const k = mon.width / REF_W;
        return {
            x: mon.x + Math.round(NOTCH.x * k), y: mon.y + Math.round(NOTCH.y * k),
            w: Math.round(NOTCH.w * k), h: Math.round(NOTCH.h * k), ph: Math.round(PANEL_H * k),
        };
    }

    _place() {
        const g = this._geom();
        this._island.set_position(g.x, g.y);
        this._island.set_size(g.w, this._expanded ? g.ph : g.h);
        this._compact.set_size(g.w, g.h);
        this._exp.set_size(g.w, g.ph);
        const inner = g.w - 24 - 12; // padding + gap
        this._left.width = Math.round(inner * LEFT_RATIO);
        this._right.width = inner - this._left.width;
    }

    // ---------- compact ----------
    _buildCompact() {
        this._compact = new St.BoxLayout({style_class: 'notch-compact', x_expand: true});
        this._cArt = new St.Bin({y_align: Clutter.ActorAlign.CENTER});
        this._cText = label('', 'notch-compact-text');
        this._cText.x_expand = true;
        this._cText.x_align = Clutter.ActorAlign.CENTER;
        this._bars = new St.BoxLayout({style_class: 'notch-bars', y_align: Clutter.ActorAlign.CENTER});
        for (let i = 0; i < 3; i++) {
            const b = new St.Widget({style_class: 'notch-bar', pivot_point: new Graphene.Point({x: 0.5, y: 1})});
            this._bars.add_child(b);
        }
        this._compact.add_child(this._cArt);
        this._compact.add_child(this._cText);
        this._compact.add_child(this._bars);
        this._island.add_child(this._compact);
    }

    _setBars(playing) {
        if (playing === this._barsPlaying) return;
        this._barsPlaying = playing;
        this._bars.get_children().forEach((b, i) => {
            b.remove_all_transitions();
            b.scale_y = playing ? 1 : 0.35;
            if (playing) {
                b.ease({
                    scale_y: 0.3, duration: 320 + i * 110, delay: i * 90,
                    mode: Clutter.AnimationMode.EASE_IN_OUT_SINE, repeatCount: -1, autoReverse: true,
                });
            }
        });
    }

    _updateCompact() {
        const m = this._media;
        if (m) {
            this._cText.text = m.artist ? `${m.title}  ·  ${m.artist}` : m.title;
            if (this._cArtUrl !== m.artUrl || !this._cArt.child) {
                this._cArtUrl = m.artUrl;
                this._cArt.child = artIcon(m.artUrl, 20, 'audio-x-generic-symbolic');
            }
            this._bars.show();
            this._setBars(m.playing);
        } else {
            this._cText.text = GLib.DateTime.new_now_local().format('%a %d %b   %H:%M');
            this._cArt.child = null;
            this._cArtUrl = null;
            this._bars.hide();
            this._setBars(false);
        }
    }

    // ---------- expanded ----------
    _buildExpanded() {
        this._exp = new St.BoxLayout({style_class: 'notch-expanded', opacity: 0, visible: false});

        // left: quick settings, scrollable so everything fits
        this._left = new St.BoxLayout({orientation: VERTICAL, style_class: 'notch-left'});
        const head = new St.BoxLayout({x_expand: true});
        const ctl = label('CONTROLS', 'notch-heading');
        ctl.x_expand = true;
        head.add_child(ctl);
        // AFK: black screen that keeps the laptop awake; any key/click comes back.
        const afkBox = new St.BoxLayout({style_class: 'notch-afk-box'});
        afkBox.add_child(new St.Icon({icon_name: 'weather-clear-night-symbolic', icon_size: 11}));
        afkBox.add_child(new St.Label({text: 'AFK', y_align: Clutter.ActorAlign.CENTER}));
        const afk = new St.Button({style_class: 'notch-afk', child: afkBox, y_align: Clutter.ActorAlign.START,
            accessible_name: 'Go AFK: black screen, stay awake'});
        afk.connect('clicked', () => { this._setExpanded(false); this._afk.start(); });
        head.add_child(afk);
        this._left.add_child(head);
        this._quick = new QuickMirror({onAction: () => this._setExpanded(false)});
        this._qScroll = new St.ScrollView({
            style_class: 'notch-scroll', y_expand: true, overlay_scrollbars: true,
            hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC,
        });
        this._qScroll.child = this._quick.actor;
        this._left.add_child(this._qScroll);

        // right: now (focused app + media) on top, open windows below
        this._right = new St.BoxLayout({orientation: VERTICAL, style_class: 'notch-right'});
        this._right.add_child(label('NOW', 'notch-heading'));
        const nowRow = new St.BoxLayout({style_class: 'notch-app-row'});
        this._lIcon = new St.Bin({y_align: Clutter.ActorAlign.CENTER});
        const nowText = new St.BoxLayout({orientation: VERTICAL, x_expand: true});
        this._lApp = label('', 'notch-app-name');
        this._lTitle = label('', 'notch-win-title');
        nowText.add_child(this._lApp);
        nowText.add_child(this._lTitle);
        nowRow.add_child(this._lIcon);
        nowRow.add_child(nowText);

        this._media = null;
        this._mediaRow = new St.BoxLayout({style_class: 'notch-media-row', y_align: Clutter.ActorAlign.CENTER});
        const btn = (icon, method) => {
            const b = new St.Button({style_class: 'notch-ctl', child: new St.Icon({icon_name: icon, icon_size: 14})});
            b.connect('clicked', () => this._media && this._mpris.call(this._media.busName, method));
            return b;
        };
        this._playIcon = new St.Icon({icon_name: 'media-playback-start-symbolic', icon_size: 14});
        const play = new St.Button({style_class: 'notch-ctl', child: this._playIcon});
        play.connect('clicked', () => this._media && this._mpris.call(this._media.busName, 'PlayPause'));
        this._mediaRow.add_child(btn('media-skip-backward-symbolic', 'Previous'));
        this._mediaRow.add_child(play);
        this._mediaRow.add_child(btn('media-skip-forward-symbolic', 'Next'));
        nowRow.add_child(this._mediaRow);
        this._right.add_child(nowRow);

        this._rHead = label('OPEN', 'notch-heading notch-heading-open');
        this._right.add_child(this._rHead);
        this._scroll = new St.ScrollView({
            style_class: 'notch-scroll', y_expand: true, overlay_scrollbars: true,
            hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC,
        });
        this._list = new St.BoxLayout({orientation: VERTICAL, style_class: 'notch-list'});
        this._scroll.child = this._list;
        this._right.add_child(this._scroll);

        this._exp.add_child(this._left);
        this._exp.add_child(this._right);
        this._island.add_child(this._exp);
    }

    _updateNow() {
        const win = global.display.focus_window;
        const app = win ? this._tracker.get_window_app(win) : null;
        this._lIcon.child = app
            ? app.create_icon_texture(24)
            : new St.Icon({icon_name: 'user-desktop-symbolic', icon_size: 24});
        this._lApp.text = app?.get_name() ?? (win ? (win.get_wm_class() ?? 'Window') : 'Desktop');
        this._lTitle.text = win?.get_title() ?? 'Nothing focused';

        this._mediaRow.visible = !!this._media;
        this._playIcon.icon_name = this._media?.playing
            ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
    }

    _windows() {
        return global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)
            .filter(w => !w.skip_taskbar);
    }

    _updateRight() {
        const wins = this._windows();
        const focus = global.display.focus_window;
        this._rHead.text = `OPEN  ·  ${wins.length}`;
        this._list.destroy_all_children();
        if (!wins.length) {
            this._list.add_child(label('No open windows', 'notch-empty'));
            return;
        }
        // two tiles per row
        for (let i = 0; i < wins.length; i += 2) {
            const row = new St.BoxLayout({style_class: 'notch-row', x_expand: true});
            for (const w of wins.slice(i, i + 2)) row.add_child(this._tile(w, w === focus));
            this._list.add_child(row);
        }
    }

    _tile(win, focused) {
        const app = this._tracker.get_window_app(win);
        const box = new St.BoxLayout({style_class: 'notch-tile-box'});
        box.add_child(app ? app.create_icon_texture(16)
            : new St.Icon({icon_name: 'application-x-executable-symbolic', icon_size: 16}));
        const l = label(win.get_title() || app?.get_name() || '', 'notch-tile-text');
        l.x_expand = true;
        box.add_child(l);
        const b = new St.Button({
            style_class: `notch-tile${focused ? ' focused' : ''}`, child: box,
            x_expand: true, x_align: Clutter.ActorAlign.FILL,
        });
        b.width = Math.floor((this._right.width - 6) / 2);
        b.connect('clicked', () => { Main.activateWindow(win); this._setExpanded(false); });
        return b;
    }

    // ---------- state ----------
    _sync() {
        if (!this._island) return;
        this._media = this._mpris?.current ?? null;
        this._updateCompact();
        if (this._expanded) { this._updateNow(); this._updateRight(); }
    }

    _watchFocusTitle() {
        if (this._titleSig) { this._titleSig[0].disconnect(this._titleSig[1]); this._titleSig = null; }
        const w = global.display.focus_window;
        if (w) this._titleSig = [w, w.connect('notify::title', () => this._expanded && this._updateNow())];
    }

    _setExpanded(on) {
        if (on === this._expanded) return;
        this._expanded = on;
        const g = this._geom();
        if (on) {
            this._updateNow();
            this._updateRight();
            this._island.add_style_class_name('expanded');
            this._exp.show();
            this._compact.ease({opacity: 0, duration: 120, onComplete: () => this._compact.hide()});
            this._exp.ease({opacity: 255, duration: ANIM_MS, delay: 80});
        } else {
            this._quick.collapse();
            this._island.remove_style_class_name('expanded');
            this._compact.show();
            this._exp.ease({opacity: 0, duration: 120, onComplete: () => this._exp.hide()});
            this._compact.ease({opacity: 255, duration: ANIM_MS, delay: 100});
        }
        this._island.ease({
            height: on ? g.ph : g.h, duration: ANIM_MS,
            mode: on ? Clutter.AnimationMode.EASE_OUT_BACK : Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _insideControl(actor) {
        for (let a = actor; a && a !== this._island; a = a.get_parent())
            if (a instanceof St.Button || a instanceof Slider || a instanceof St.ScrollBar || a === this._left) return true;
        return false;
    }

    _onClick(ev) {
        if (ev.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
        if (this._expanded && this._insideControl(global.stage.get_event_actor(ev))) return Clutter.EVENT_PROPAGATE;
        this._setExpanded(!this._expanded);
        return Clutter.EVENT_STOP;
    }

    _onHover() {
        if (this._leaveId) { GLib.source_remove(this._leaveId); this._leaveId = 0; }
        if (this._expanded && !this._island.hover) {
            this._leaveId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, LEAVE_COLLAPSE_MS, () => {
                // still dragging a slider (pointer grabbed) -> keep open
                const grab = global.stage.get_grab_actor?.();
                if (grab && this._island.contains(grab)) return GLib.SOURCE_CONTINUE;
                this._leaveId = 0;
                if (!this._island.hover && !this._pointerInside()) this._setExpanded(false);
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    // A click grabs the pointer, which makes St drop `hover` until the next
    // motion; so check the real pointer position before collapsing.
    _pointerInside() {
        const [px, py] = global.get_pointer();
        const [x, y] = this._island.get_transformed_position();
        const [w, h] = this._island.get_transformed_size();
        return px >= x && px < x + w && py >= y && py < y + h;
    }

    _onStageEvent(ev) {
        if (!this._expanded) return Clutter.EVENT_PROPAGATE;
        const t = ev.type();
        if (t === Clutter.EventType.KEY_PRESS && ev.get_key_symbol() === Clutter.KEY_Escape) {
            this._setExpanded(false);
        } else if (t === Clutter.EventType.BUTTON_PRESS) {
            // ClutterEvent.get_source() is gone in GNOME 50; ask the stage instead.
            const src = global.stage.get_event_actor(ev);
            if (!src || !this._island.contains(src)) this._setExpanded(false);
        }
        return Clutter.EVENT_PROPAGATE;
    }
}
