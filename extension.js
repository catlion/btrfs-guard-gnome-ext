import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const BTRFS = '/usr/bin/btrfs';
const THRESHOLD = 1024 ** 3;       // alert below 1 GiB unallocated
const POLL_SECONDS = 30;
const REALERT_SECONDS = 30 * 60;

Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
Gio._promisify(Gio.File.prototype, 'enumerate_children_async', 'enumerate_children_finish');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async', 'next_files_finish');
Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');

function fmt(bytes) {
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
        bytes /= 1024;
        i++;
    }
    return `${bytes.toFixed(i >= 3 ? 2 : 0)} ${units[i]}`;
}

// compact panel form: whole number and one-letter unit, e.g. 120G, 512M
function fmtShort(bytes) {
    const units = ['B', 'K', 'M', 'G', 'T', 'P'];
    let i = 0;
    while (Math.round(bytes) >= 1024 && i < units.length - 1) {
        bytes /= 1024;
        i++;
    }
    return `${Math.round(bytes)}${units[i]}`;
}

// printf-style interpolation for translated strings (%% escapes a literal %)
function format(str, ...args) {
    return str.replace(/%%|%([sd])/g, (m, type) => {
        if (m === '%%')
            return '%';
        const arg = args.shift();
        return type === 'd' ? String(Math.round(arg)) : String(arg);
    });
}

async function run(argv) {
    const proc = new Gio.Subprocess({
        argv,
        flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
    });
    proc.init(null);
    const [stdout, stderr] = await proc.communicate_utf8_async(null, null);
    return {status: proc.get_exit_status(), stdout: stdout ?? '', stderr: stderr ?? ''};
}

async function readText(path) {
    const [bytes] = await Gio.File.new_for_path(path).load_contents_async(null);
    return new TextDecoder().decode(bytes).trim();
}

async function listDir(path) {
    const dir = Gio.File.new_for_path(path);
    const enumerator = await dir.enumerate_children_async(
        'standard::name,standard::symlink-target', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null);
    const out = [];
    let files;
    do {
        files = await enumerator.next_files_async(100, GLib.PRIORITY_DEFAULT, null);
        out.push(...files);
    } while (files.length > 0);
    enumerator.close(null);
    return out;
}

// one watched btrfs mount: its panel label, its submenu in the shared menu,
// polling state and maintenance actions
class Mount {
    constructor(indicator, mount) {
        this._indicator = indicator;
        this._ext = indicator._ext;
        this._mount = mount;
        this._busy = false;
        this._refreshing = false;
        this._resolveFailed = false;
        this._sysfs = null;      // /sys/fs/btrfs/<uuid>
        this._devSize = null;    // /sys/class/block/<dev>/size (single-device fallback)
        this._lastAlert = 0;
        this._alerted = false;
        this.low = false;

        this.label = new St.Label({text: '…', y_align: Clutter.ActorAlign.CENTER});

        this.item = new PopupMenu.PopupSubMenuMenuItem(`${mount}  …`, true);
        this.item.icon.icon_name = 'drive-harddisk-symbolic';
        const menu = this.item.menu;

        this._info = {};
        for (const key of ['data', 'meta']) {
            const item = new PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false});
            this._info[key] = item;
            menu.addMenuItem(item);
        }
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._balance0 = new PopupMenu.PopupMenuItem(_('Reclaim empty chunks  (balance -dusage=0)'));
        this._balance0.connect('activate', () => this._balance(0));
        menu.addMenuItem(this._balance0);

        this._balanceN = new PopupMenu.PopupMenuItem('');
        this._balanceN.connect('activate', () => this._balance(this._ext.getSettings().get_int('dusage')));
        menu.addMenuItem(this._balanceN);
        this.updateBalanceItem();

        this._usage = new PopupMenu.PopupMenuItem(_('Show filesystem usage…'));
        this._usage.connect('activate', () => this._showUsage());
        menu.addMenuItem(this._usage);
    }

    updateBalanceItem() {
        const dusage = this._ext.getSettings().get_int('dusage');
        this._balanceN.label.text = format(_('Compact chunks <%d%% full  (balance -dusage=%d)'), dusage, dusage);
    }

    _setLow(low) {
        this.low = low;
        this.label.style = low ? 'color: #ff5555; font-weight: bold;' : '';
        this.item.icon.icon_name = low ? 'dialog-warning-symbolic' : 'drive-harddisk-symbolic';
        this._indicator?.syncIcon();
    }

    _setUnavailable() {
        this.label.text = 'n/a';
        this.item.label.text = `${this._mount}  n/a`;
    }

    async _resolve() {
        if (this._sysfs)
            return true;
        try {
            const uuid = (await run(['findmnt', '-no', 'UUID', '-T', this._mount])).stdout.trim();
            const src = (await run(['findmnt', '-no', 'SOURCE', '-T', this._mount])).stdout.trim();
            const dev = GLib.path_get_basename(src.replace(/\[.*\]$/, ''));
            this._sysfs = `/sys/fs/btrfs/${uuid}`;
            this._devSize = `/sys/class/block/${dev}/size`;
            this._resolveFailed = false;
            return true;
        } catch (e) {
            this._setUnavailable();
            if (!this._resolveFailed) {
                this._resolveFailed = true;
                console.error(`btrfs-guard: cannot resolve ${this._mount}: ${e}`);
            }
            return false;
        }
    }

    async tick() {
        if (await this._resolve())
            await this._refresh();
    }

    // total size of all member devices listed in sysfs; falls back to the
    // single device reported by findmnt (e.g. devices dir unreadable)
    async _deviceSize() {
        try {
            let total = 0;
            for (const info of await listDir(`${this._sysfs}/devices`)) {
                const dev = GLib.path_get_basename(info.get_symlink_target() || info.get_name());
                try {
                    total += Number(await readText(`/sys/class/block/${dev}/size`)) * 512;
                } catch {
                    // member device unreadable or virtual; skip it
                }
            }
            if (total > 0)
                return total;
        } catch (e) {
            // fall through to single-device fallback
        }
        return Number(await readText(this._devSize)) * 512;
    }

    async _stats() {
        const num = async p => Number(await readText(p));
        const devSize = await this._deviceSize();
        let allocated = 0;
        const space = {};
        for (const t of ['data', 'metadata', 'system']) {
            const base = `${this._sysfs}/allocation/${t}`;
            allocated += await num(`${base}/disk_total`);
            space[t] = {total: await num(`${base}/total_bytes`), used: await num(`${base}/bytes_used`)};
        }
        return {unalloc: Math.max(0, devSize - allocated), devSize, space};
    }

    async _refresh() {
        if (this._refreshing || !this._sysfs)
            return null;
        this._refreshing = true;
        try {
            let s;
            try {
                s = await this._stats();
            } catch (e) {
                if (this._indicator)
                    this._setUnavailable();
                return null;
            }
            if (!this._indicator)
                return null;    // indicator destroyed while reading stats
            const low = s.unalloc < THRESHOLD;
            if (!this._busy)
                this.label.text = fmtShort(s.unalloc);
            this._setLow(low);
            this.item.label.text = format(_('%s unallocated: %s of %s'), this._mount, fmt(s.unalloc), fmt(s.devSize));
            this._info.data.label.text = format(_('Data: %s used of %s'), fmt(s.space.data.used), fmt(s.space.data.total));
            this._info.meta.label.text = format(_('Metadata: %s used of %s'), fmt(s.space.metadata.used), fmt(s.space.metadata.total));

            const now = GLib.get_monotonic_time() / 1e6;
            if (low && (!this._alerted || now - this._lastAlert > REALERT_SECONDS)) {
                this._alerted = true;
                this._lastAlert = now;
                this._indicator.notify(_('Btrfs: low unallocated space'),
                    format(_('%s has only %s unallocated. Metadata cannot grow and writes will stall. ' +
                    'Open the Btrfs Guard menu to reclaim space.'), this._mount, fmt(s.unalloc)), true);
            } else if (!low) {
                this._alerted = false;
            }
            return s;
        } finally {
            this._refreshing = false;
        }
    }

    _setBusy(busy, text) {
        this._busy = busy;
        for (const item of [this._balance0, this._balanceN, this._usage])
            item.setSensitive(!busy);
        if (busy)
            this.label.text = text;
    }

    // stdout on success, null when the user dismissed the auth dialog, error output otherwise
    _pkexecResult(r) {
        if (r.status === 0)
            return r.stdout;
        if (r.status === 126 || r.status === 127)
            return null;
        return (r.stderr || r.stdout).trim();
    }

    async _balance(usage) {
        if (this._busy)
            return;
        this._setBusy(true, format(_('balancing -dusage=%d…'), usage));
        const title = format(_('Btrfs balance -dusage=%d'), usage);
        try {
            const r = await run(['pkexec', BTRFS, 'balance', 'start', `-dusage=${usage}`, this._mount]);
            const result = this._pkexecResult(r);
            if (result === null) {
                this._indicator.notify(format(_('%s cancelled'), title), _('Authentication was dismissed or denied.'));
            } else if (r.status !== 0) {
                this._indicator.notify(format(_('%s failed'), title), result.split('\n').slice(-3).join('\n'));
            } else {
                this._setBusy(false);
                const s = await this._refresh();
                const summary = result.trim().split('\n').pop() || _('Balance completed');
                this._indicator.notify(format(_('%s finished'), title),
                    s ? `${summary}\n${format(_('Unallocated now: %s'), fmt(s.unalloc))}` : summary);
            }
        } catch (e) {
            this._indicator.notify(format(_('%s failed'), title), `${e}`);
        } finally {
            this._setBusy(false);
            await this._refresh();
        }
    }

    async _showUsage() {
        if (this._busy)
            return;
        this._setBusy(true, 'usage…');
        let text;
        try {
            const r = await run(['pkexec', BTRFS, 'filesystem', 'usage', this._mount]);
            const result = this._pkexecResult(r);
            text = result === null ? _('Authentication was dismissed or denied.') : result;
        } catch (e) {
            text = `${e}`;
        } finally {
            this._setBusy(false);
            await this._refresh();
        }
        try {
            const dialog = new ModalDialog.ModalDialog({styleClass: 'prompt-dialog'});
            dialog.contentLayout.add_child(new St.Label({
                text: format(_('btrfs filesystem usage %s'), this._mount),
                style: 'font-weight: bold; padding-bottom: 8px;',
            }));
            const scroll = new St.ScrollView({
                style: 'min-width: 640px; max-height: 520px;',
                hscrollbar_policy: St.PolicyType.AUTOMATIC,
            });
            // St.ScrollView only accepts St.Scrollable children (a bare St.Label renders nothing)
            const body = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
            const label = new St.Label({text: text.trim(), style: 'font-family: monospace;'});
            label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            body.add_child(label);
            scroll.add_child(body);
            dialog.contentLayout.add_child(scroll);
            dialog.addButton({label: _('Close'), action: () => dialog.close(), key: Clutter.KEY_Escape});
            dialog.open();
        } catch (e) {
            console.error(`btrfs-guard: cannot show usage dialog: ${e}\n${e.stack}`);
            this._indicator.notify(_('Btrfs Guard'), `${e}`);
        }
    }

    destroy() {
        this._indicator = null;
        this._balance0 = null;
        this._balanceN = null;
        this._usage = null;
    }
}

// single panel button: one icon followed by the short unallocated size of
// every watched mount; the menu has one submenu per mount
const Indicator = GObject.registerClass(
class BtrfsGuardIndicator extends PanelMenu.Button {
    _init(ext, mounts) {
        super._init(0.0, 'Btrfs Guard');
        this._ext = ext;
        this._source = null;

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box', style: 'spacing: 6px;'});
        this._icon = new St.Icon({icon_name: 'drive-harddisk-symbolic', style_class: 'system-status-icon'});
        box.add_child(this._icon);
        this.add_child(box);

        this._mounts = mounts.map(m => new Mount(this, m));
        for (const m of this._mounts) {
            box.add_child(m.label);
            this.menu.addMenuItem(m.item);
        }

        // with a single mount there is nothing to choose: show its details right away
        this.menu.connect('open-state-changed', (menu, open) => {
            if (open && this._mounts.length === 1)
                this._mounts[0].item.setSubmenuShown(true);
        });
    }

    syncIcon() {
        const low = this._mounts.some(m => m.low);
        this._icon.icon_name = low ? 'dialog-warning-symbolic' : 'drive-harddisk-symbolic';
    }

    updateBalanceItems() {
        for (const m of this._mounts)
            m.updateBalanceItem();
    }

    async _tick() {
        await Promise.all(this._mounts.map(m => m.tick()));
    }

    async start() {
        await this._tick();
        if (!this._mounts)
            return;     // destroyed while the first tick was running
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_SECONDS, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    notify(title, body, critical = false) {
        if (!this._source) {
            this._source = new MessageTray.Source({title: 'Btrfs Guard', iconName: 'drive-harddisk-symbolic'});
            this._source.connect('destroy', () => {
                this._source = null;
            });
            Main.messageTray.add(this._source);
        }
        const n = new MessageTray.Notification({
            source: this._source,
            title,
            body,
            urgency: critical ? MessageTray.Urgency.CRITICAL : MessageTray.Urgency.NORMAL,
        });
        this._source.addNotification(n);
    }

    destroy() {
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = null;
        }
        this._source?.destroy();
        super.destroy();
        for (const m of this._mounts)
            m.destroy();
        this._mounts = null;
    }
});

export default class BtrfsGuardExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = null;
        this._handlers = [
            this._settings.connect('changed::mounts', () => this._rebuild()),
            this._settings.connect('changed::dusage', () => this._indicator?.updateBalanceItems()),
        ];
        this._rebuild();
    }

    _rebuild() {
        this._indicator?.destroy();
        this._indicator = null;
        const mounts = this._settings.get_strv('mounts').filter(m => m);
        if (mounts.length === 0)
            return;
        this._indicator = new Indicator(this, mounts);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._indicator.start();
    }

    disable() {
        for (const id of this._handlers)
            this._settings.disconnect(id);
        this._handlers = [];
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
