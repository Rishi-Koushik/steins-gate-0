// Home-screen date badge: "M.D (DDD)", top-left, above the wallpaper and below windows.
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
// "M.D label" — dates the badge marks and counts down to ([home] canon_list replaces them)
const CANON = ['7.28 Radio Kaikan', '8.21 Operation Skuld', '7.25 Kurisu\'s birthday',
    '12.14 Okabe\'s birthday', '2.1 Mayuri\'s birthday'];

// → {today: label | null, next: {m, d, label, days} | null}
export function canonInfo(now, list) {
    const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let today = null, next = null;
    for (const entry of list) {
        const m = String(entry).match(/^\s*(\d{1,2})\.(\d{1,2})\s*(.*)$/);
        if (!m) continue;
        const mo = Number(m[1]), d = Number(m[2]), label = m[3].trim();
        if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
        let when = new Date(now.getFullYear(), mo - 1, d);
        if (when < today0) when = new Date(now.getFullYear() + 1, mo - 1, d);
        const days = Math.round((when - today0) / 86400000);
        if (days === 0) today = label || `${mo}.${d}`;
        else if (!next || days < next.days) next = {m: mo, d, label, days};
    }
    return {today, next};
}

export class DateBadge {
    constructor(home = {}) {
        this._canon = home.canon_dates === false ? null
            : (Array.isArray(home.canon_list) && home.canon_list.length ? home.canon_list : CANON);
        this.actor = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
        const row = new St.BoxLayout({style_class: 'sg-date-badge', x_align: Clutter.ActorAlign.START});
        this.actor.add_child(row);
        this._note = new St.Label({style_class: 'sg-date-badge-canon', x_align: Clutter.ActorAlign.START, visible: false});
        this.actor.add_child(this._note);
        this._date = new St.Label({style_class: 'sg-date-badge-date', y_align: Clutter.ActorAlign.CENTER});
        this._day = new St.Label({style_class: 'sg-date-badge-day', y_align: Clutter.ActorAlign.END});
        row.add_child(this._date);
        row.add_child(this._day);

        this._group = Main.layoutManager._backgroundGroup;
        this._group.add_child(this.actor);
        this._groupId = this._group.connect('child-added', () => this._raise());
        this._monId = Main.layoutManager.connect('monitors-changed', () => this._place());

        this._tick();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
        this._place();
        this.slideIn();
    }

    _raise() {
        if (this._group.get_last_child() !== this.actor)
            this._group.set_child_above_sibling(this.actor, null);
    }

    _tick() {
        const d = new Date();
        this._date.text = `${d.getMonth() + 1}.${d.getDate()}`;
        this._day.text = `(${DAYS[d.getDay()]})`;
        if (!this._canon) return;
        const {today, next} = canonInfo(d, this._canon);
        this._note.visible = Boolean(today || next);
        if (today) {
            this._note.text = `◆ ${today}`;
            this._note.add_style_class_name('sg-today');
        } else if (next) {
            this._note.text = `${next.m}.${next.d}${next.label ? ` ${next.label}` : ''} · in ${next.days} day${next.days === 1 ? '' : 's'}`;
            this._note.remove_style_class_name('sg-today');
        }
    }

    _place() {
        const mon = Main.layoutManager.primaryMonitor;
        if (!mon) return;
        const panelH = Main.panel?.visible ? Main.panel.height : 0;
        this.actor.set_position(mon.x, mon.y + panelH + 14);
        this._raise();
    }

    slideIn() {
        const a = this.actor;
        a.remove_all_transitions();
        const [, w] = a.get_preferred_width(-1);
        a.translation_x = -(w + 20);
        a.ease({
            translation_x: 0, duration: 700, delay: 200,
            mode: Clutter.AnimationMode.EASE_OUT_QUART,
        });
    }

    destroy() {
        if (this._timer) GLib.source_remove(this._timer);
        this._timer = 0;
        this._group.disconnect(this._groupId);
        Main.layoutManager.disconnect(this._monId);
        this.actor.destroy();
        this.actor = null;
    }
}
