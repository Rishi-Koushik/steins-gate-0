// Mirrors GNOME's Quick Settings (wifi, bluetooth, power mode, sliders, power
// buttons, plus anything other extensions add) into a vertical list for the notch.
// The real items keep doing the work; we only bind to their properties and
// forward clicks, so behaviour stays identical to the stock menu.
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';
import {QuickSlider} from 'resource:///org/gnome/shell/ui/quickSettings.js';

const SYNC = GObject.BindingFlags.SYNC_CREATE;
const BIDI = GObject.BindingFlags.SYNC_CREATE | GObject.BindingFlags.BIDIRECTIONAL;
const VERTICAL = Clutter.Orientation.VERTICAL;
const MENU_POLL_MS = 1500;

function text(t, style_class) {
    const l = new St.Label({text: t ?? '', style_class, y_align: Clutter.ActorAlign.CENTER});
    l.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return l;
}

// A St.Button whose 'clicked' we replay on the original (honouring toggle-mode
// the same way StButton does on a real release).
function press(orig) {
    if (orig.toggle_mode) orig.checked = !orig.checked;
    orig.emit('clicked', 1);
}

export class QuickMirror {
    constructor({onAction}) {
        this._onAction = onAction;
        this._binds = [];
        this._sigs = [];
        this._watched = new Map();
        this._dead = new Set();
        this._openMenu = null;   // {orig, box, pollId, sig}
        this.actor = new St.BoxLayout({orientation: VERTICAL, style_class: 'nq-list', x_expand: true});
        // shell teardown can destroy us (or the real grid) before disable() runs
        this._gone = false;
        this.actor.connect('destroy', () => (this._gone = true));

        this._qs = Main.panel.statusArea.quickSettings;
        this._grid = this._qs?.menu?._grid ?? null;
        if (this._grid) {
            this._gridSigs = [
                this._grid.connect('child-added', () => this._queueRebuild()),
                this._grid.connect('child-removed', () => this._queueRebuild()),
                this._grid.connect('destroy', () => (this._gone = true)),
            ];
        }
        this.rebuild();
    }

    destroy() {
        if (this._rebuildId) GLib.source_remove(this._rebuildId);
        this._rebuildId = 0;
        this._closeMenu();
        if (this._gone) return;
        this._clear();
        if (this._grid) this._gridSigs.forEach(id => this._grid.disconnect(id));
        this._grid = null;
        this.actor.destroy();
    }

    // Called when the notch collapses: put any real submenu we opened back.
    collapse() { this._closeMenu(); }

    // Originals can be destroyed under us (the network indicator recreates its
    // toggles at startup), so remember which ones died and never touch them again.
    _watch(obj) {
        if (!(obj instanceof Clutter.Actor) || this._watched.has(obj)) return;
        this._watched.set(obj, obj.connect('destroy', () => {
            this._dead.add(obj);
            this._queueRebuild();
        }));
    }

    _bind(src, sp, dst, dp, flags = SYNC) {
        this._watch(src);
        this._binds.push([src, src.bind_property(sp, dst, dp, flags)]);
    }

    _on(obj, sig, fn) {
        this._watch(obj);
        this._sigs.push([obj, obj.connect(sig, fn)]);
    }

    _clear() {
        const alive = o => !this._dead.has(o);
        this._binds.forEach(([src, b]) => alive(src) && b.unbind());
        this._binds = [];
        this._sigs.forEach(([o, id]) => alive(o) && o.disconnect(id));
        this._sigs = [];
        this._watched.forEach((id, o) => alive(o) && o.disconnect(id));
        this._watched = new Map();
        this._dead = new Set();
        this.actor.destroy_all_children();
    }

    _queueRebuild() {
        if (this._rebuildId || this._gone) return;
        this._rebuildId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._rebuildId = 0;
            if (!this._gone) this.rebuild();
            return GLib.SOURCE_REMOVE;
        });
    }

    rebuild() {
        this._closeMenu();
        this._clear();
        if (!this._grid) {
            this.actor.add_child(text('Quick settings unavailable', 'nq-empty'));
            return;
        }
        const items = this._grid.get_children();
        // System row (battery + settings/lock/power) first, then sliders, then toggles.
        const sys = items.filter(i => i.powerToggle);
        const sliders = items.filter(i => i instanceof QuickSlider);
        const toggles = items.filter(i => !i.powerToggle && !(i instanceof QuickSlider) && 'checked' in i && 'title' in i);
        sys.forEach(i => this._addSystem(i));
        sliders.forEach(i => this._addSlider(i));
        toggles.forEach(i => this._addToggle(i));
    }

    // ---------- item kinds ----------
    _addToggle(orig) {
        const wrap = new St.BoxLayout({orientation: VERTICAL, x_expand: true});
        this._bind(orig, 'visible', wrap, 'visible');

        const row = new St.BoxLayout({style_class: 'nq-toggle-row', x_expand: true});
        const icon = new St.Icon({icon_size: 14, style_class: 'nq-toggle-icon'});
        this._bind(orig, 'gicon', icon, 'gicon');
        if (!orig.gicon) this._bind(orig, 'icon-name', icon, 'icon-name');

        const labels = new St.BoxLayout({orientation: VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        const title = text('', 'nq-title');
        const sub = text('', 'nq-subtitle');
        this._bind(orig, 'title', title, 'text');
        this._bind(orig, 'subtitle', sub, 'text');
        const syncSub = () => (sub.visible = !!orig.subtitle);
        syncSub();
        this._on(orig, 'notify::subtitle', syncSub);
        labels.add_child(title);
        labels.add_child(sub);

        const inner = new St.BoxLayout({style_class: 'nq-toggle-inner', x_expand: true});
        inner.add_child(icon);
        inner.add_child(labels);
        const main = new St.Button({style_class: 'nq-toggle', child: inner, x_expand: true, can_focus: true});
        this._bind(orig, 'checked', main, 'checked');
        this._bind(orig, 'reactive', main, 'reactive');
        main.connect('clicked', () => press(orig));
        row.add_child(main);

        if (orig.menu) {
            const chev = new St.Button({
                style_class: 'nq-chevron', can_focus: true,
                child: new St.Icon({icon_name: 'go-down-symbolic', icon_size: 12}),
            });
            if ('menuEnabled' in orig) this._bind(orig, 'menu-enabled', chev, 'visible');
            chev.connect('clicked', () => this._toggleMenu(orig, wrap, chev));
            row.add_child(chev);
        }
        wrap.add_child(row);
        this.actor.add_child(wrap);
    }

    _addSlider(orig) {
        const wrap = new St.BoxLayout({orientation: VERTICAL, x_expand: true});
        this._bind(orig, 'visible', wrap, 'visible');
        const row = new St.BoxLayout({style_class: 'nq-slider-row', x_expand: true});

        const icon = new St.Icon({icon_size: 14});
        this._bind(orig, 'gicon', icon, 'gicon');
        if (!orig.gicon) this._bind(orig, 'icon-name', icon, 'icon-name');
        const iconBtn = new St.Button({style_class: 'nq-icon-btn', child: icon, can_focus: true});
        const realIconBtn = orig._iconButton;
        if (realIconBtn) {
            this._bind(realIconBtn, 'reactive', iconBtn, 'reactive');
            iconBtn.connect('clicked', () => realIconBtn.emit('clicked', 1));
        }
        row.add_child(iconBtn);

        const slider = new Slider(0);
        slider.x_expand = true;
        slider.y_align = Clutter.ActorAlign.CENTER;
        this._bind(orig.slider, 'maximum-value', slider, 'maximum-value');
        this._bind(orig.slider, 'overdrive-start', slider, 'overdrive-start');
        this._bind(orig.slider, 'value', slider, 'value', BIDI);
        // volume.js reacts to drag-begin/end for the feedback sound; forward them.
        slider.connect('drag-begin', () => orig.slider.emit('drag-begin'));
        slider.connect('drag-end', () => orig.slider.emit('drag-end'));
        row.add_child(slider);

        if (orig.menu) {
            const chev = new St.Button({
                style_class: 'nq-chevron', can_focus: true,
                child: new St.Icon({icon_name: 'go-down-symbolic', icon_size: 12}),
            });
            if ('menuEnabled' in orig) this._bind(orig, 'menu-enabled', chev, 'visible');
            chev.connect('clicked', () => this._toggleMenu(orig, wrap, chev));
            row.add_child(chev);
        }
        wrap.add_child(row);
        this.actor.add_child(wrap);
    }

    _addSystem(orig) {
        const wrap = new St.BoxLayout({orientation: VERTICAL, x_expand: true});
        this._bind(orig, 'visible', wrap, 'visible');
        const row = new St.BoxLayout({style_class: 'nq-system-row', x_expand: true});

        // battery (PowerToggle): icon + percentage, click opens power settings
        const pt = orig.powerToggle;
        const batt = new St.BoxLayout({style_class: 'nq-battery-box'});
        const bIcon = new St.Icon({icon_size: 14});
        this._bind(pt, 'gicon', bIcon, 'gicon');
        const bText = text('', 'nq-battery');
        this._bind(pt, 'title', bText, 'text');
        batt.add_child(bIcon);
        batt.add_child(bText);
        const battBtn = new St.Button({style_class: 'nq-icon-btn nq-battery-btn', child: batt, can_focus: true});
        this._bind(pt, 'visible', battBtn, 'visible');
        battBtn.connect('clicked', () => { press(pt); this._onAction(); });
        row.add_child(battBtn);
        row.add_child(new Clutter.Actor({x_expand: true}));

        // the rest: screenshot / settings / lock / power-off menu
        for (const c of orig.child.get_children()) {
            if (c === pt || !(c instanceof St.Button)) continue;
            const b = new St.Button({style_class: 'nq-icon-btn', can_focus: true,
                child: new St.Icon({icon_size: 14})});
            this._bind(c, 'icon-name', b.child, 'icon-name');
            this._bind(c, 'visible', b, 'visible');
            if (c.menu) {
                b.connect('clicked', () => this._toggleMenu(c, wrap, b));
            } else {
                b.connect('clicked', () => { this._onAction(); c.emit('clicked', 1); });
            }
            row.add_child(b);
        }
        wrap.add_child(row);
        this.actor.add_child(wrap);
    }

    // ---------- inline submenus (wifi networks, bluetooth devices, power off…) ----------
    _toggleMenu(orig, wrap, chev) {
        const same = this._openMenu?.orig === orig;
        this._closeMenu();
        if (same) return;

        const box = new St.BoxLayout({orientation: VERTICAL, style_class: 'nq-submenu', x_expand: true});
        wrap.add_child(box);
        chev.add_style_pseudo_class('checked');
        // Opening the (invisible) real menu makes e.g. wifi start a scan.
        try { orig.menu.open(0); } catch (e) { console.warn(`[notch] submenu open: ${e}`); }

        const om = {orig, box, chev, sig: ''};
        this._openMenu = om;
        this._fillMenu(om);
        om.pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, MENU_POLL_MS, () => {
            this._fillMenu(om);
            return GLib.SOURCE_CONTINUE;
        });
    }

    _closeMenu() {
        const om = this._openMenu;
        if (!om) return;
        this._openMenu = null;
        GLib.source_remove(om.pollId);
        if (!this._dead.has(om.orig)) { try { om.orig.menu.close(0); } catch {} }
        om.chev.remove_style_pseudo_class('checked');
        om.box.destroy();
    }

    _fillMenu(om) {
        const leaves = [];
        collectLeaves(om.orig.menu.box, leaves);
        const sig = leaves.map(l => `${l.label}|${l.active}|${l.sensitive}`).join('\n');
        if (sig === om.sig) return;
        om.sig = sig;
        om.box.destroy_all_children();
        if (!leaves.length) {
            om.box.add_child(text('Nothing here', 'nq-empty'));
            return;
        }
        for (const l of leaves) {
            const inner = new St.BoxLayout({style_class: 'nq-item-inner', x_expand: true});
            if (l.gicon || l.iconName)
                inner.add_child(new St.Icon({gicon: l.gicon, icon_name: l.iconName, icon_size: 12}));
            const t = text(l.label, 'nq-item-text');
            t.x_expand = true;
            inner.add_child(t);
            if (l.active) inner.add_child(new St.Icon({icon_name: 'object-select-symbolic', icon_size: 10}));
            const b = new St.Button({
                style_class: `nq-item${l.active ? ' active' : ''}`, child: inner,
                x_expand: true, reactive: l.sensitive, can_focus: true,
            });
            b.connect('clicked', () => {
                try { l.item.activate(Clutter.get_current_event()); } catch (e) { console.warn(`[notch] activate: ${e}`); }
                this._onAction();
            });
            om.box.add_child(b);
        }
    }
}

// Walk a popup menu's actor tree and pull out the clickable rows.
function collectLeaves(actor, out) {
    for (const c of actor.get_children()) {
        const d = c._delegate;
        if (d instanceof PopupMenu.PopupSubMenuMenuItem) {
            if (c.visible) collectLeaves(d.menu.box, out);
            continue;
        }
        if (!c.visible) continue;
        if (d instanceof PopupMenu.PopupSeparatorMenuItem) continue;
        if (d instanceof PopupMenu.PopupBaseMenuItem && d._activatable !== false && c.reactive) {
            out.push(describe(d));
            continue;
        }
        collectLeaves(c, out);
    }
}

function describe(item) {
    const labels = [];
    let gicon = null, iconName = null;
    const walk = a => {
        for (const c of a.get_children()) {
            if (!c.visible) continue;
            if (c instanceof St.Label && c.text) labels.push(c.text);
            else if (c instanceof St.Icon && !gicon && !iconName && c.style_class?.includes?.('popup-menu-ornament') !== true) {
                gicon = c.gicon; iconName = c.icon_name;
            }
            walk(c);
        }
    };
    walk(item);
    const active = item._ornament === PopupMenu.Ornament.CHECK || item._ornament === PopupMenu.Ornament.DOT;
    return {
        item, label: labels.join('  ·  ') || '…', gicon, iconName, active,
        sensitive: item.sensitive !== false,
    };
}
