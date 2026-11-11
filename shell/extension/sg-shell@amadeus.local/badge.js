// Home-screen date badge: "M.D (DDD)", top-left, above the wallpaper and below windows.
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export class DateBadge {
    constructor() {
        this.actor = new St.BoxLayout({style_class: 'sg-date-badge'});
        this._date = new St.Label({style_class: 'sg-date-badge-date', y_align: Clutter.ActorAlign.CENTER});
        this._day = new St.Label({style_class: 'sg-date-badge-day', y_align: Clutter.ActorAlign.END});
        this.actor.add_child(this._date);
        this.actor.add_child(this._day);

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
