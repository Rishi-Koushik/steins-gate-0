// Small on-disk stores shared with the phone (apps/sg_mailbox.py reads the same files):
//   mail/inbox/ID.json   one mail per file, so the shell and the phone never rewrite each other's data
//   dmail/ID.json        D-Mails typed on the lock screen, waiting for the next boot
//   upa/collection.json  Upa capsules caught on the home screen
//   sounds/pack/NAME.*   optional sound pack supplied by the owner
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {DATA_DIR} from './config.js';

const dec = new TextDecoder();
const INBOX = GLib.build_filenamev([DATA_DIR, 'mail', 'inbox']);
const DMAIL = GLib.build_filenamev([DATA_DIR, 'dmail']);
const UPA = GLib.build_filenamev([DATA_DIR, 'upa', 'collection.json']);
const PACK = GLib.build_filenamev([DATA_DIR, 'sounds', 'pack']);
const SOUND_TYPES = ['ogg', 'oga', 'wav', 'opus', 'mp3', 'flac'];
export const MAX_DMAILS = 12;

function readJson(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? JSON.parse(dec.decode(bytes)) : null;
    } catch {
        return null;
    }
}

function writeJson(path, value) {
    GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o700);
    GLib.file_set_contents(path, JSON.stringify(value));   // written to a temp file, then renamed
}

function newId() {
    return `${Date.now()}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function listJson(dir) {
    const out = [];
    try {
        const d = GLib.Dir.open(dir, 0);
        let name;
        while ((name = d.read_name()) !== null) {
            if (!name.endsWith('.json')) continue;
            const path = GLib.build_filenamev([dir, name]);
            const v = readJson(path);
            if (v && typeof v === 'object') out.push([path, v]);
        }
        d.close();
    } catch {}
    return out;
}

export function bootId() {
    try {
        return dec.decode(GLib.file_get_contents('/proc/sys/kernel/random/boot_id')[1]).trim();
    } catch {
        return '';
    }
}

// ----- phone inbox -----
export function writeMail({from, subject, body, kind = 'mail', ts = null}) {
    const id = newId();
    writeJson(GLib.build_filenamev([INBOX, `${id}.json`]), {
        id, from: String(from ?? '').slice(0, 80), subject: String(subject ?? '').slice(0, 160),
        body: String(body ?? '').slice(0, 4000), kind, ts: ts ?? Math.floor(Date.now() / 1000), read: false,
    });
    return id;
}

// ----- D-Mail -----
export function dmailCount() {
    return listJson(DMAIL).length;
}

export function saveDmail(text, sender) {
    const id = newId();
    writeJson(GLib.build_filenamev([DMAIL, `${id}.json`]), {
        id, text, from: sender, ts: Math.floor(Date.now() / 1000), boot: bootId(),
    });
}

// D-Mails sent before this boot, oldest first: [{path, text, from, ts}]
export function arrivedDmails() {
    const now = bootId();
    return listJson(DMAIL)
        .filter(([, d]) => typeof d.text === 'string' && d.boot !== now)
        .map(([path, d]) => ({path, text: d.text, from: String(d.from ?? ''), ts: Number(d.ts) || 0}))
        .sort((a, b) => a.ts - b.ts);
}

// Move a read D-Mail into the phone's inbox.
export function deliverDmail(d) {
    writeMail({from: 'D-Mail', subject: d.text.slice(0, 40), body: d.text, kind: 'dmail', ts: d.ts || null});
    try { Gio.File.new_for_path(d.path).delete(null); } catch {}
}

// ----- Upa collection -----
export function addUpa(kind) {
    const c = readJson(UPA);
    const list = Array.isArray(c) ? c : [];
    list.push({kind, ts: Math.floor(Date.now() / 1000)});
    writeJson(UPA, list.slice(-2000));
    return list.length;
}

// ----- sound pack -----
export function packSound(name) {
    for (const ext of SOUND_TYPES) {
        const p = GLib.build_filenamev([PACK, `${name}.${ext}`]);
        if (GLib.file_test(p, GLib.FileTest.EXISTS)) return p;
    }
    return null;
}

// Play a pack sound if the owner supplied one, else the bundled fallback (may be null).
export function playSound(name, fallback = null) {
    const path = packSound(name) ??
        (fallback ? GLib.build_filenamev([DATA_DIR, 'sounds', `${fallback}.ogg`]) : null);
    if (!path) return;
    try {
        global.display.get_sound_player().play_from_file(Gio.File.new_for_path(path), 'sg-shell', null);
    } catch {}
}
