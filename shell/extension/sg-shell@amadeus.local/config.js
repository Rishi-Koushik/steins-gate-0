// Minimal reader for ~/.config/sg-shell/config.toml (flat [section] key = value only).
import GLib from 'gi://GLib';

export const DATA_DIR = GLib.build_filenamev([GLib.get_user_data_dir(), 'sg-shell']);
export const CONFIG_FILE = GLib.build_filenamev([GLib.get_user_config_dir(), 'sg-shell', 'config.toml']);
export const RUNTIME_DIR = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'sg-shell']);

const DEFAULTS = {
    home: {wallpaper: '', date_badge: true, canon_dates: true, canon_list: [], upa: true, upa_per_day: 3},
    lock: {
        enabled: true, title_screen: true, auth_mode: 'password', video: true, music: true, music_volume: 0.85,
        sounds: true, unlock_movie: true, boot_clip: 'manual', on_login: 'always', fit: 'contain', display_name: '',
        lab_member: true, lab_member_no: 0, lab_member_name: '', ambience_volume: 0.5,
    },
    dmail: {enabled: true, max_bytes: 36},
    phone: {notifications_as_mail: true, character_mails: true},
    amadeus: {calls: true},
};

function parseValue(raw) {
    raw = raw.trim();
    if (raw.startsWith('[')) {
        // one-line array of strings: ["a", "b"]
        const items = [];
        const re = /"((?:[^"\\]|\\.)*)"/g;
        let m;
        while ((m = re.exec(raw)) !== null) items.push(m[1].replace(/\\(["\\])/g, '$1'));
        return items;
    }
    if (raw.startsWith('"')) {
        const m = raw.match(/^"((?:[^"\\]|\\.)*)"/);
        return m ? m[1].replace(/\\(["\\])/g, '$1') : '';
    }
    raw = raw.replace(/\s+#.*$/, '').trim();
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
}

export function loadConfig() {
    const cfg = JSON.parse(JSON.stringify(DEFAULTS));
    try {
        const [ok, bytes] = GLib.file_get_contents(CONFIG_FILE);
        if (!ok) return cfg;
        let section = null;
        for (let line of new TextDecoder().decode(bytes).split('\n')) {
            line = line.trim();
            if (!line || line.startsWith('#')) continue;
            const s = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
            if (s) { section = s[1]; cfg[section] ??= {}; continue; }
            const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.*)$/);
            if (kv && section)
                cfg[section][kv[1]] = parseValue(kv[2]);
        }
    } catch (e) {
        // missing/unreadable config → defaults
    }
    return cfg;
}

export function dataPath(...parts) {
    return GLib.build_filenamev([DATA_DIR, ...parts]);
}
