// Microwave-oven app drawer for GNOME Shell 50.
// Tapping Super slides a microwave in from the left edge; its door swings open and the
// apps are inside (scrollable, most-used first). The green LCD on top is the search bar.
// Arrow keys move the selection, Enter launches, Esc clears/closes, Super again closes.
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import Pango from 'gi://Pango';
import Graphene from 'gi://Graphene';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ensureActorVisibleInScrollView} from 'resource:///org/gnome/shell/misc/animationUtils.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// Geometry on the 1920x1200 logical reference screen; scaled to the real monitor.
const REF_W = 1920, REF_H = 1200;
const OVEN = {x: 28, w: 780, h: 560};   // vertically centred
const COLS = 5;
const ICON = 48;
const SLIDE_MS = 320;
const DOOR_MS = 420;
const DOOR_OPEN_DEG = -90;               // swings out towards the viewer until edge-on, hinge on the left

export default class DrawerExtension extends Extension {
    enable() {
        this._open = false;
        this._sel = 0;
        this._shown = [];
        this._appSys = Shell.AppSystem.get_default();
        this._usage = Shell.AppUsage.get_default();
        this._buttons = new Map();

        this._build();
        this._installedId = this._appSys.connect('installed-changed', () => {
            for (const b of this._buttons.values()) b.destroy();
            this._buttons.clear();
            this._shownIds = null;
            this._allApps = null;
            if (this._open) this._refilter();
        });

        // Take over the Super tap: block the shell's own overlay-key handler(s).
        this._blocked = [];
        let id;
        while ((id = GObject.signal_handler_find(global.display, {signalId: 'overlay-key'})) &&
               !this._blocked.includes(id)) {
            GObject.signal_handler_block(global.display, id);
            this._blocked.push(id);
        }
        this._overlayId = global.display.connect('overlay-key', () => {
            // The Super release that just closed us must not reopen it.
            if (GLib.get_monotonic_time() - (this._keyClosedAt ?? 0) < 400000) return;
            this.toggle();
        });
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._place());

        // Build the app tiles in small idle chunks now, so the first open doesn't stall.
        const pending = this._apps().slice();
        this._warmId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
            for (const app of pending.splice(0, 8)) this._button(app);
            if (pending.length) return GLib.SOURCE_CONTINUE;
            this._warmId = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    disable() {
        if (this._open) this._finishClose();
        this._stopClock();
        if (this._warmId) { GLib.source_remove(this._warmId); this._warmId = 0; }
        global.display.disconnect(this._overlayId);
        for (const id of this._blocked) GObject.signal_handler_unblock(global.display, id);
        this._blocked = [];
        this._appSys.disconnect(this._installedId);
        Main.layoutManager.disconnect(this._monitorsId);
        this._backdrop.destroy();
        this._backdrop = this._dim = this._oven = this._door = this._entry = this._grid = this._scroll = null;
        this._shownIds = null;
        this._buttons.clear();
        this._allApps = null;
    }

    // ---------------------------------------------------------------- building

    _build() {
        // Root never changes opacity (that would flatten the whole screen offscreen every
        // frame); only the plain dim layer behind the oven fades.
        this._backdrop = new St.Widget({
            reactive: true, visible: false, layout_manager: new Clutter.FixedLayout(),
        });
        this._dim = new St.Widget({style_class: 'oven-backdrop', reactive: true});
        this._dim.connect('button-press-event', () => { this.close(); return Clutter.EVENT_STOP; });
        this._backdrop.add_child(this._dim);
        // Tapping Super (press+release with nothing else) closes it.
        this._backdrop.connect('captured-event', (_a, ev) => {
            const type = ev.type();
            if (type !== Clutter.EventType.KEY_PRESS && type !== Clutter.EventType.KEY_RELEASE)
                return Clutter.EVENT_PROPAGATE;
            const sym = ev.get_key_symbol();
            const isSuper = sym === Clutter.KEY_Super_L || sym === Clutter.KEY_Super_R;
            if (type === Clutter.EventType.KEY_PRESS) {
                this._superTap = isSuper;
            } else if (isSuper && this._superTap) {
                this._superTap = false;
                this._keyClosedAt = GLib.get_monotonic_time();
                this.close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._oven = new St.BoxLayout({
            style_class: 'oven', orientation: Clutter.Orientation.VERTICAL, reactive: true,
        });
        this._backdrop.add_child(this._oven);

        this._oven.add_child(this._buildTopStrip());

        const body = new St.BoxLayout({style_class: 'oven-body', x_expand: true, y_expand: true});
        body.add_child(this._buildChamber());
        body.add_child(this._buildSidePanel());
        this._oven.add_child(body);

        const feet = new St.BoxLayout({style_class: 'oven-feet', x_expand: true});
        feet.add_child(new St.Widget({style_class: 'oven-foot'}));
        feet.add_child(new St.Widget({x_expand: true}));
        feet.add_child(new St.Widget({style_class: 'oven-foot'}));
        this._oven.add_child(feet);

        Main.layoutManager.uiGroup.add_child(this._backdrop);
        this._place();
    }

    // Dark control strip along the top: dial, green LCD (= search), ON/OFF buttons, red switch.
    _buildTopStrip() {
        const strip = new St.BoxLayout({style_class: 'oven-strip', x_expand: true});

        const leds = new St.BoxLayout({style_class: 'oven-leds', orientation: Clutter.Orientation.VERTICAL,
            y_align: Clutter.ActorAlign.CENTER});
        for (const c of ['led-a', 'led-b', 'led-c']) leds.add_child(new St.Widget({style_class: `oven-led ${c}`}));
        strip.add_child(this._knob('oven-knob-small'));
        strip.add_child(leds);

        this._entry = new St.Entry({
            style_class: 'oven-lcd', hint_text: 'TYPE TO SEARCH', can_focus: true,
            x_expand: true, y_align: Clutter.ActorAlign.CENTER,
        });
        const ct = this._entry.clutter_text;
        ct.connect('text-changed', () => { this._sel = 0; this._refilter(); });
        ct.connect('activate', () => this._launchSelected());
        // Arrows/Esc are intercepted before ClutterText's own cursor bindings run.
        ct.connect('key-press-event', (_a, ev) => this._onKey(ev));
        strip.add_child(this._entry);

        const btns = new St.Widget({style_class: 'oven-btns', layout_manager: new Clutter.GridLayout(),
            y_align: Clutter.ActorAlign.CENTER});
        const mk = (label, cb) => {
            const b = new St.Button({style_class: 'oven-btn', label, can_focus: false});
            b.connect('clicked', cb);
            return b;
        };
        const gl = btns.layout_manager;
        gl.attach(mk('ON', () => this._launchSelected()), 0, 0, 1, 1);
        gl.attach(mk('OFF', () => this.close()), 1, 0, 1, 1);
        gl.attach(mk('TOP', () => this._select(0)), 0, 1, 1, 1);
        gl.attach(mk('CLR', () => this._entry.set_text('')), 1, 1, 1, 1);
        strip.add_child(btns);

        const sw = new St.BoxLayout({style_class: 'oven-switch-box', orientation: Clutter.Orientation.VERTICAL,
            y_align: Clutter.ActorAlign.CENTER});
        sw.add_child(new St.Widget({style_class: 'oven-switch-led'}));
        sw.add_child(new St.Widget({style_class: 'oven-switch'}));
        strip.add_child(sw);
        return strip;
    }

    // The cooking chamber with the app grid, and the door layered on top of it.
    _buildChamber() {
        const chamber = new St.Widget({
            style_class: 'oven-chamber', x_expand: true, y_expand: true,
            layout_manager: new Clutter.BinLayout(),
        });

        const cavity = new St.BoxLayout({style_class: 'oven-cavity', orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, y_expand: true});
        this._grid = new St.Widget({style_class: 'oven-grid', x_expand: true, layout_manager: new Clutter.GridLayout()});
        this._empty = new St.Label({text: 'Nothing in here matches', style_class: 'oven-empty', visible: false,
            x_align: Clutter.ActorAlign.CENTER});
        const inner = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        inner.add_child(this._grid);
        inner.add_child(this._empty);
        this._scroll = new St.ScrollView({
            style_class: 'oven-scroll', x_expand: true, y_expand: true,
            hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
        });
        this._scroll.set_child(inner);
        cavity.add_child(this._scroll);
        chamber.add_child(cavity);

        // Door: steel frame + handle + dark glass window, hinged on its left edge.
        this._door = new St.BoxLayout({
            style_class: 'oven-door', orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, y_expand: true, reactive: true, pivot_point: new Graphene.Point({x: 0, y: 0.5}),
        });
        this._door.connect('button-press-event', () => { this._openDoor(); return Clutter.EVENT_STOP; });
        const handleRow = new St.BoxLayout({x_expand: true});
        handleRow.add_child(new St.Widget({style_class: 'oven-screw'}));
        handleRow.add_child(new St.Widget({x_expand: true}));
        handleRow.add_child(new St.Widget({style_class: 'oven-handle'}));
        handleRow.add_child(new St.Widget({x_expand: true}));
        handleRow.add_child(new St.Widget({style_class: 'oven-screw'}));
        this._door.add_child(handleRow);
        const glass = new St.Widget({style_class: 'oven-glass', x_expand: true, y_expand: true});
        this._door.add_child(glass);
        const bottomRow = new St.BoxLayout({x_expand: true});
        bottomRow.add_child(new St.Widget({style_class: 'oven-screw'}));
        bottomRow.add_child(new St.Widget({x_expand: true}));
        bottomRow.add_child(new St.Widget({style_class: 'oven-screw'}));
        this._door.add_child(bottomRow);
        chamber.add_child(this._door);
        return chamber;
    }

    // Right-hand panel: small green readout, orange nixie clock, two knobs.
    _buildSidePanel() {
        const panel = new St.BoxLayout({style_class: 'oven-side', orientation: Clutter.Orientation.VERTICAL});
        this._count = new St.Label({style_class: 'oven-mini-lcd', text: '', x_expand: true});
        panel.add_child(this._count);
        this._nixies = [];
        const tubes = new St.BoxLayout({style_class: 'oven-nixies', x_align: Clutter.ActorAlign.CENTER});
        for (let i = 0; i < 4; i++) {
            const t = new St.Label({style_class: 'oven-nixie', text: '0'});
            this._nixies.push(t);
            tubes.add_child(t);
        }
        panel.add_child(tubes);
        panel.add_child(new St.Widget({y_expand: true}));
        const k1 = this._knob('oven-knob');
        const k2 = this._knob('oven-knob');
        k1.x_align = k2.x_align = Clutter.ActorAlign.CENTER;
        // Turning (scrolling on) the upper knob scrolls the chamber; the lower one moves the selection.
        k1.connect('scroll-event', (_a, ev) => {
            const dir = ev.get_scroll_direction();
            const adj = this._scroll.vadjustment;
            if (dir === Clutter.ScrollDirection.UP) adj.value -= 60;
            else if (dir === Clutter.ScrollDirection.DOWN) adj.value += 60;
            return Clutter.EVENT_STOP;
        });
        k2.connect('scroll-event', (_a, ev) => {
            const dir = ev.get_scroll_direction();
            if (dir === Clutter.ScrollDirection.UP) this._select(this._sel - 1);
            else if (dir === Clutter.ScrollDirection.DOWN) this._select(this._sel + 1);
            return Clutter.EVENT_STOP;
        });
        panel.add_child(k1);
        panel.add_child(k2);
        return panel;
    }

    _knob(cls) {
        const k = new St.Widget({style_class: cls, reactive: true, layout_manager: new Clutter.BinLayout()});
        k.add_child(new St.Widget({style_class: 'oven-knob-mark', x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START}));
        return k;
    }

    _place() {
        const m = Main.layoutManager.primaryMonitor;
        if (!m) return;
        this._backdrop.set_position(m.x, m.y);
        this._backdrop.set_size(m.width, m.height);
        this._dim.set_size(m.width, m.height);
        const s = Math.min(m.width / REF_W, m.height / REF_H);
        const w = Math.round(OVEN.w * s), h = Math.round(OVEN.h * s);
        this._oven.set_size(w, h);
        this._oven.set_position(Math.round(OVEN.x * s), Math.round((m.height - h) / 2));

        // Tile width from the stylesheet numbers (oven padding+border, side panel, body
        // spacing, cavity border+padding, scrollbar room, column spacing) -- computed here
        // once instead of reacting to allocation changes.
        const sf = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const scrollW = w - (2 * 12 + 2 * 2 + 118 + 12 + 2 * 6 + 2 * 6) * sf;
        const cw = Math.max(60, Math.floor((scrollW - (10 + 4 * (COLS - 1)) * sf) / COLS));
        if (cw !== this._cw) {
            this._cw = cw;
            for (const b of this._buttons?.values() ?? []) b.width = cw;
        }
    }

    // ---------------------------------------------------------------- open / close

    toggle() {
        if (this._open) this.close();
        else this.open();
    }

    open() {
        if (this._open) return;
        if (Main.overview.visible) Main.overview.hide();
        const grab = Main.pushModal(this._backdrop, {actionMode: Shell.ActionMode.POPUP});
        if (!grab) return;
        this._grab = grab;
        this._open = true;

        this._place();
        this._allApps = null;           // re-rank by usage every time it opens
        this._sel = 0;
        if (this._entry.get_text()) this._entry.set_text('');   // triggers _refilter
        else this._refilter();
        this._startClock();

        Main.layoutManager.uiGroup.set_child_above_sibling(this._backdrop, null);
        this._backdrop.show();
        for (const a of [this._dim, this._oven, this._door]) a.remove_all_transitions();
        this._backdrop.opacity = 255;
        this._dim.opacity = 0;
        this._oven.translation_x = -(this._oven.x + this._oven.width + 40);
        this._door.rotation_angle_y = 0;
        this._door.show();
        this._superTap = false;

        this._dim.ease({opacity: 255, duration: SLIDE_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this._oven.ease({
            translation_x: 0, duration: SLIDE_MS, mode: Clutter.AnimationMode.EASE_OUT_BACK,
            onComplete: () => this._openDoor(),
        });
        this._entry.grab_key_focus();
    }

    _openDoor() {
        if (!this._open || !this._door.visible) return;
        this._door.remove_all_transitions();
        this._door.ease({
            rotation_angle_y: DOOR_OPEN_DEG, duration: DOOR_MS, mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC,
            onComplete: () => { if (this._open) this._door.hide(); },
        });
    }

    close() {
        if (!this._open) return;
        this._open = false;
        this._stopClock();
        if (this._grab) { Main.popModal(this._grab); this._grab = null; }

        // Door snaps shut, then the oven slides away.
        this._door.remove_all_transitions();
        if (!this._door.visible) {
            this._door.rotation_angle_y = DOOR_OPEN_DEG;
            this._door.show();
        }
        const shut = 150;
        this._door.ease({rotation_angle_y: 0, duration: shut, mode: Clutter.AnimationMode.EASE_IN_QUAD});
        this._dim.ease({opacity: 0, delay: shut, duration: SLIDE_MS, mode: Clutter.AnimationMode.EASE_IN_QUAD});
        this._oven.ease({
            translation_x: -(this._oven.x + this._oven.width + 40), delay: shut, duration: SLIDE_MS,
            mode: Clutter.AnimationMode.EASE_IN_CUBIC,
            onStopped: () => { if (!this._open) this._backdrop?.hide(); },
        });
    }

    _finishClose() {
        this._open = false;
        if (this._grab) { Main.popModal(this._grab); this._grab = null; }
        this._backdrop.hide();
    }

    // ---------------------------------------------------------------- clock

    _startClock() {
        this._tick();
        this._stopClock();
        this._clockId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => { this._tick(); return GLib.SOURCE_CONTINUE; });
    }

    _stopClock() {
        if (this._clockId) { GLib.source_remove(this._clockId); this._clockId = 0; }
    }

    _tick() {
        const s = GLib.DateTime.new_now_local().format('%H%M');
        this._nixies.forEach((n, i) => n.set_text(s[i]));
    }

    // ---------------------------------------------------------------- keys & selection

    _onKey(ev) {
        const sym = ev.get_key_symbol();
        switch (sym) {
        case Clutter.KEY_Escape:
            if (this._entry.get_text()) this._entry.set_text('');
            else this.close();
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Left: this._select(this._sel - 1); return Clutter.EVENT_STOP;
        case Clutter.KEY_Right: this._select(this._sel + 1); return Clutter.EVENT_STOP;
        case Clutter.KEY_Up:
            if (this._sel >= COLS) this._select(this._sel - COLS);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Down:
            if (this._sel + COLS < this._shown.length) this._select(this._sel + COLS);
            else if (Math.floor(this._sel / COLS) < Math.floor((this._shown.length - 1) / COLS))
                this._select(this._shown.length - 1);   // partial last row
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Page_Down: this._select(Math.min(this._sel + COLS * 3, this._shown.length - 1)); return Clutter.EVENT_STOP;
        case Clutter.KEY_Page_Up: this._select(Math.max(this._sel - COLS * 3, 0)); return Clutter.EVENT_STOP;
        case Clutter.KEY_Home: if (!this._entry.get_text()) { this._select(0); return Clutter.EVENT_STOP; } break;
        case Clutter.KEY_End: if (!this._entry.get_text()) { this._select(this._shown.length - 1); return Clutter.EVENT_STOP; } break;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _select(i, scroll = true) {
        if (!this._shown.length) return;
        i = Math.max(0, Math.min(i, this._shown.length - 1));
        this._buttons.get(this._shown[this._sel]?.get_id())?.remove_style_pseudo_class('selected');
        this._sel = i;
        const b = this._buttons.get(this._shown[i].get_id());
        if (b) {
            b.add_style_pseudo_class('selected');
            if (scroll) ensureActorVisibleInScrollView(this._scroll, b);
        }
    }

    _launchSelected() {
        const app = this._shown[this._sel];
        if (app) this._launch(app);
    }

    // ---------------------------------------------------------------- apps

    _byUsage(a, b) {
        return this._usage.compare(a.get_id(), b.get_id()) || a.get_name().localeCompare(b.get_name());
    }

    _apps() {
        if (!this._allApps) {
            this._allApps = this._appSys.get_installed()
                .filter(info => { try { return info.should_show(); } catch { return false; } })
                .map(info => this._appSys.lookup_app(info.get_id()))
                .filter(Boolean)
                .sort((a, b) => this._byUsage(a, b));
        }
        return this._allApps;
    }

    _search(text) {
        const query = text.trim();
        if (!query) return this._apps();
        const seen = new Set(), out = [];
        for (const group of Shell.AppSystem.search(query)) {
            const apps = [];
            for (const id of group) {
                if (seen.has(id)) continue;
                const app = this._appSys.lookup_app(id);
                if (!app?.app_info?.should_show()) continue;
                seen.add(id);
                apps.push(app);
            }
            // Within each relevance tier, the apps you use most come first.
            out.push(...apps.sort((a, b) => this._byUsage(a, b)));
        }
        return out;
    }

    _button(app) {
        const id = app.get_id();
        let b = this._buttons.get(id);
        if (b) return b;
        const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'oven-app-box'});
        const icon = app.create_icon_texture(ICON);
        icon.x_align = Clutter.ActorAlign.CENTER;
        box.add_child(icon);
        const l = new St.Label({text: app.get_name(), style_class: 'oven-app-name', x_align: Clutter.ActorAlign.CENTER});
        l.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        l.clutter_text.line_alignment = Pango.Alignment.CENTER;
        box.add_child(l);
        b = new St.Button({
            style_class: 'oven-app', child: box, can_focus: false, reactive: true,
            accessible_name: app.get_name(),
        });
        b.width = this._cw;
        b.connect('clicked', () => this._launch(app));
        b.connect('notify::hover', () => {
            // Never scroll on hover: it moves another tile under the pointer and jitters.
            if (b.hover && this._open) this._select(this._shown.findIndex(a => a.get_id() === id), false);
        });
        this._buttons.set(id, b);
        return b;
    }

    _refilter() {
        this._buttons.get(this._shown[this._sel]?.get_id())?.remove_style_pseudo_class('selected');
        this._shown = this._search(this._entry.get_text());
        const ids = this._shown.map(a => a.get_id()).join('\n');
        if (ids !== this._shownIds) {
            this._shownIds = ids;
            const layout = this._grid.layout_manager;
            this._grid.remove_all_children();
            this._shown.forEach((app, i) => layout.attach(this._button(app), i % COLS, Math.floor(i / COLS), 1, 1));
        }
        this._empty.visible = this._shown.length === 0;
        this._grid.visible = !this._empty.visible;
        this._scroll.vadjustment.value = 0;
        this._count.set_text(`${String(this._shown.length).padStart(3, '0')} APPS`);
        this._sel = Math.min(this._sel, Math.max(0, this._shown.length - 1));
        this._select(this._sel);
    }

    _launch(app) {
        this.close();
        app.open_new_window(-1);
        Main.overview.hide();
    }
}
