import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {loadConfig, dataPath, RUNTIME_DIR} from './config.js';
import {DateBadge} from './badge.js';
import {WindowHelper} from './windows.js';
import {LockScreen} from './lock.js';
import {HomeExtras} from './home.js';

export default class SgShellExtension extends Extension {
    enable() {
        this._cfg = loadConfig();
        this._lockAtLoginOnce();
        this._lock = null;
        this._cover = null;

        if (GLib.getenv('SG_SHELL_TEST')) {
            global.context.unsafe_mode = true;
            globalThis.sgShell = this;
        }

        this._modeId = Main.sessionMode.connect('updated', () => this._sync());
        this._shieldIds = Main.screenShield ? [
            Main.screenShield.connect('active-changed', () => this._sync()),
            Main.screenShield.connect('locked-changed', () => this._sync()),
        ] : [];
        // The unlock dialog can be created lazily / recreated; a slow poll while locked catches that.
        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 700, () => {
            if (Main.sessionMode.isLocked) this._sync();
            return GLib.SOURCE_CONTINUE;
        });
        this._sync();
    }

    // ----- login: POWER ON → boot clip → title screen, like the demo -----
    // GDM has already authenticated (or auto-logged-in) the user; the session is locked
    // straight away so the themed lock screen is the first thing on screen.
    _lockAtLoginOnce() {
        try {
            this._lockAtLogin();
        } catch (e) {
            console.warn(`[sg-shell] lock at login skipped: ${e}`);
            this._dropLoginCover();
        }
        firstEnable = false;
    }

    _lockAtLogin() {
        const mode = this._cfg.lock.on_login;
        if (!this._cfg.lock.enabled || mode === 'never' || !Main.screenShield) return;
        // only at login: the first enable of a freshly started shell, not a mid-session enable
        if (Main.sessionMode.currentMode !== 'user' || !firstEnable || shellAge() > 45) return;
        if (mode === 'autologin' && !gdmAutologin()) return;
        if (GLib.getenv('SG_SHELL_TEST') && !GLib.getenv('SG_SHELL_TEST_LOGIN')) return;

        const mon = Main.layoutManager.primaryMonitor;
        if (mon) {
            this._loginCover = new St.Widget({
                style: 'background-color: #000;', reactive: true,
                x: mon.x, y: mon.y, width: mon.width, height: mon.height,
            });
            Main.layoutManager.addTopChrome(this._loginCover);
        }
        const lockNow = () => {
            if (this._startupId) Main.layoutManager.disconnect(this._startupId);
            this._startupId = 0;
            if (this._loginCoverId) GLib.source_remove(this._loginCoverId);
            try {
                GLib.mkdir_with_parents(RUNTIME_DIR, 0o700);
                GLib.file_set_contents(GLib.build_filenamev([RUNTIME_DIR, 'boot-clip']), '');
                if (Main.overview.visible) Main.overview.hide();
                Main.screenShield.lock(false);
            } catch (e) {
                console.warn(`[sg-shell] lock at login failed: ${e}`);
            }
            // whatever happened, never leave the black cover up
            this._loginCoverId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
                this._loginCoverId = 0;
                this._dropLoginCover();
                return GLib.SOURCE_REMOVE;
            });
        };
        if (Main.layoutManager._startingUp) {
            this._startupId = Main.layoutManager.connect('startup-complete', lockNow);
        } else {
            this._loginCoverId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._loginCoverId = 0;
                lockNow();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _dropLoginCover() {
        if (this._startupId) Main.layoutManager.disconnect(this._startupId);
        this._startupId = 0;
        if (this._loginCoverId) GLib.source_remove(this._loginCoverId);
        this._loginCoverId = 0;
        if (this._loginCover) {
            Main.layoutManager.removeChrome(this._loginCover);
            this._loginCover.destroy();
            this._loginCover = null;
        }
    }

    disable() {
        // Runs when the extension is turned off and on every shell-mode change it does not
        // list; with "unlock-dialog" in session-modes it stays loaded across lock/unlock.
        Main.sessionMode.disconnect(this._modeId);
        for (const id of this._shieldIds) Main.screenShield.disconnect(id);
        GLib.source_remove(this._pollId);
        this._dropLock();
        this._dropUser();
        this._dropCover();
        this._dropLoginCover();
        if (globalThis.sgShell === this) delete globalThis.sgShell;
    }

    _sync() {
        try {
            if (Main.sessionMode.isLocked) {
                this._dropUser();
                this._syncLock();
            } else {
                const wasAuthed = this._lock?.authenticated;
                this._dropLock();
                this._ensureUser();
                if (wasAuthed) this._afterUnlock();
            }
        } catch (e) {
            console.warn(`[sg-shell] sync failed: ${e}\n${e.stack}`);
            this._dropLock();
        }
    }

    // ----- user session -----
    _ensureUser() {
        if (!this._windows)
            this._windows = new WindowHelper(() => this._dropCover());
        if (!this._badge && this._cfg.home.date_badge)
            this._badge = new DateBadge(this._cfg.home);
        if (!this._home) {
            try {
                this._home = new HomeExtras(this._cfg);
            } catch (e) {
                console.warn(`[sg-shell] home extras unavailable: ${e}\n${e.stack}`);
            }
        }
    }

    _dropUser() {
        this._windows?.destroy();
        this._windows = null;
        this._badge?.destroy();
        this._badge = null;
        try { this._home?.destroy(); } catch (e) { console.warn(`[sg-shell] ${e}`); }
        this._home = null;
    }

    // ----- lock screen -----
    _syncLock() {
        const dialog = Main.screenShield?._dialog;
        if (!this._cfg.lock.enabled || !dialog) {
            if (!dialog) this._dropLock();
            return;
        }
        if (this._lock && this._lock._dialog === dialog && this._lock.actor)
            return;
        this._dropLock();
        this._cfg = loadConfig();
        if (!this._cfg.lock.enabled) return;
        const lock = new LockScreen(this._cfg);
        try {
            lock.attach(dialog);
            this._lock = lock;
        } catch (e) {
            console.warn(`[sg-shell] lock overlay failed, stock lock screen stays: ${e}\n${e.stack}`);
            try { lock.detach(); } catch {}
        }
    }

    _dropLock() {
        try { this._lock?.detach(); } catch (e) { console.warn(`[sg-shell] ${e}`); }
        this._lock = null;
    }

    // ----- unlock movie -----
    _afterUnlock() {
        this._badge?.slideIn();
        try { this._home?.loggedIn(); } catch (e) { console.warn(`[sg-shell] ${e}`); }
        if (!this._cfg.lock.unlock_movie) return;
        const bin = dataPath('apps', 'sg-clip');
        if (!GLib.file_test(bin, GLib.FileTest.IS_EXECUTABLE)) return;
        // black cover so the desktop does not flash before the movie window maps
        const mon = Main.layoutManager.primaryMonitor;
        this._cover = new St.Widget({
            style: 'background-color: #000;', x: mon.x, y: mon.y, width: mon.width, height: mon.height,
        });
        Main.layoutManager.addTopChrome(this._cover);
        this._coverId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 4000, () => {
            this._coverId = 0;
            this._dropCover();
            return GLib.SOURCE_REMOVE;
        });
        try {
            Gio.Subprocess.new([bin, 'unlock'], Gio.SubprocessFlags.NONE);
        } catch (e) {
            console.warn(`[sg-shell] could not start unlock movie: ${e}`);
            this._dropCover();
        }
    }

    _dropCover() {
        if (this._coverId) GLib.source_remove(this._coverId);
        this._coverId = 0;
        if (this._cover) {
            const c = this._cover;
            this._cover = null;
            // let the movie window paint its first frame
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
                Main.layoutManager.removeChrome(c);
                c.destroy();
                return GLib.SOURCE_REMOVE;
            });
        }
    }
}

let firstEnable = true;

// seconds since this gnome-shell process started
function shellAge() {
    const dec = new TextDecoder();
    const stat = dec.decode(GLib.file_get_contents('/proc/self/stat')[1]);
    const start = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]) / 100;
    const up = Number(dec.decode(GLib.file_get_contents('/proc/uptime')[1]).split(' ')[0]);
    return up - start;
}

function gdmAutologin() {
    try {
        const [ok, bytes] = GLib.file_get_contents('/etc/gdm/custom.conf');
        return ok && /^\s*AutomaticLoginEnable\s*=\s*true\s*$/im.test(new TextDecoder().decode(bytes));
    } catch {
        return false;
    }
}
