// Tiny MPRIS watcher: tracks every org.mpris.MediaPlayer2.* on the session bus
// and exposes the "best" one (playing beats paused, most recently changed wins).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const PREFIX = 'org.mpris.MediaPlayer2.';
const PATH = '/org/mpris/MediaPlayer2';
const IFACE = 'org.mpris.MediaPlayer2.Player';

export class MprisWatcher {
    constructor(onChange) {
        this._onChange = onChange;
        this._players = new Map(); // busName -> {proxy, id, stamp}
        this._cancel = new Gio.Cancellable();
        this._bus = Gio.DBus.session;

        this._nameSub = this._bus.signal_subscribe('org.freedesktop.DBus', 'org.freedesktop.DBus',
            'NameOwnerChanged', '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE,
            (_c, _s, _p, _i, _sig, params) => {
                const [name, , newOwner] = params.deepUnpack();
                if (!name.startsWith(PREFIX)) return;
                if (newOwner) this._add(name);
                else this._remove(name);
            });

        this._bus.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'ListNames', null, null, Gio.DBusCallFlags.NONE, -1, this._cancel, (bus, res) => {
                try {
                    const [names] = bus.call_finish(res).deepUnpack();
                    names.filter(n => n.startsWith(PREFIX)).forEach(n => this._add(n));
                } catch (e) {
                    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.warn(`[notch] ListNames failed: ${e}`);
                }
            });
    }

    _add(name) {
        if (this._players.has(name)) return;
        const entry = {proxy: null, id: 0, stamp: GLib.get_monotonic_time()};
        this._players.set(name, entry);
        Gio.DBusProxy.new_for_bus(Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, null,
            name, PATH, IFACE, this._cancel, (_o, res) => {
                try {
                    const proxy = Gio.DBusProxy.new_for_bus_finish(res);
                    if (this._players.get(name) !== entry) return;
                    entry.proxy = proxy;
                    entry.id = proxy.connect('g-properties-changed', () => {
                        entry.stamp = GLib.get_monotonic_time();
                        this._onChange();
                    });
                    this._onChange();
                } catch (e) {
                    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.warn(`[notch] proxy for ${name} failed: ${e}`);
                }
            });
    }

    _remove(name) {
        const entry = this._players.get(name);
        if (!entry) return;
        if (entry.proxy && entry.id) entry.proxy.disconnect(entry.id);
        this._players.delete(name);
        this._onChange();
    }

    _prop(proxy, key) {
        const v = proxy.get_cached_property(key);
        return v ? v.recursiveUnpack() : null;
    }

    // -> {title, artist, artUrl, playing, busName} | null
    get current() {
        let best = null;
        for (const [name, e] of this._players) {
            if (!e.proxy) continue;
            const status = this._prop(e.proxy, 'PlaybackStatus');
            if (!status || status === 'Stopped') continue;
            const meta = this._prop(e.proxy, 'Metadata') ?? {};
            if (!meta['xesam:title']) continue;
            const playing = status === 'Playing';
            const score = (playing ? 1e15 : 0) + e.stamp;
            if (!best || score > best.score) {
                const artist = meta['xesam:artist'];
                best = {
                    score, busName: name, playing,
                    title: String(meta['xesam:title']),
                    artist: Array.isArray(artist) ? artist.join(', ') : (artist ?? ''),
                    artUrl: meta['mpris:artUrl'] ?? '',
                };
            }
        }
        return best;
    }

    call(busName, method) {
        const e = this._players.get(busName);
        e?.proxy?.call(method, null, Gio.DBusCallFlags.NONE, -1, null, null);
    }

    destroy() {
        this._cancel.cancel();
        this._bus.signal_unsubscribe(this._nameSub);
        for (const name of [...this._players.keys()]) this._remove(name);
    }
}
