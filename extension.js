import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
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

const Indicator = GObject.registerClass(
class BtrfsGuardIndicator extends PanelMenu.Button {
    _init(ext, mount) {
        super._init(0.0, `Btrfs Guard ${mount}`);
        this._ext = ext;
        this._mount = mount;
        this._busy = false;
        this._sysfs = null;      // /sys/fs/btrfs/<uuid>
        this._devSize = null;    // /sys/class/block/<dev>/size
        this._lastAlert = 0;
        this._alerted = false;
        this._source = null;

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this._icon = new St.Icon({icon_name: 'drive-harddisk-symbolic', style_class: 'system-status-icon'});
        this._label = new St.Label({text: '…', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._icon);
        box.add_child(this._label);
        this.add_child(box);

        this._info = {};
        for (const key of ['unalloc', 'data', 'meta']) {
            const item = new PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false});
            this._info[key] = item;
            this.menu.addMenuItem(item);
        }
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._balance0 = new PopupMenu.PopupMenuItem(_('Reclaim empty chunks  (balance -dusage=0)'));
        this._balance0.connect('activate', () => this._balance(0));
        this.menu.addMenuItem(this._balance0);

        this._balanceN = new PopupMenu.PopupMenuItem('');
        this._balanceN.connect('activate', () => this._balance(this._ext.getSettings().get_int('dusage')));
        this.menu.addMenuItem(this._balanceN);
        this._updateBalanceItem();

        this._usage = new PopupMenu.PopupMenuItem(_('Show filesystem usage…'));
        this._usage.connect('activate', () => this._showUsage());
        this.menu.addMenuItem(this._usage);
    }

    _updateBalanceItem() {
        const dusage = this._ext.getSettings().get_int('dusage');
        this._balanceN.label.text = format(_('Compact chunks <%d%% full  (balance -dusage=%d)'), dusage, dusage);
    }

    async start() {
        try {
            const uuid = (await run(['findmnt', '-no', 'UUID', '-T', this._mount])).stdout.trim();
            const src = (await run(['findmnt', '-no', 'SOURCE', '-T', this._mount])).stdout.trim();
            const dev = GLib.path_get_basename(src.replace(/\[.*\]$/, ''));
            this._sysfs = `/sys/fs/btrfs/${uuid}`;
            this._devSize = `/sys/class/block/${dev}/size`;
        } catch (e) {
            this._label.text = 'n/a';
            console.error(`btrfs-guard: cannot resolve ${this._mount}: ${e}`);
            return;
        }
        await this._refresh();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_SECONDS, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    async _stats() {
        const num = async p => Number(await readText(p));
        const devSize = (await num(this._devSize)) * 512;
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
        let s;
        try {
            s = await this._stats();
        } catch (e) {
            this._label.text = 'n/a';
            return null;
        }
        const low = s.unalloc < THRESHOLD;
        this._label.text = fmt(s.unalloc);
        this._icon.icon_name = low ? 'dialog-warning-symbolic' : 'drive-harddisk-symbolic';
        this._label.style = low ? 'color: #ff5555; font-weight: bold;' : '';
        this._info.unalloc.label.text = format(_('%s unallocated: %s of %s'), this._mount, fmt(s.unalloc), fmt(s.devSize));
        this._info.data.label.text = format(_('Data: %s used of %s'), fmt(s.space.data.used), fmt(s.space.data.total));
        this._info.meta.label.text = format(_('Metadata: %s used of %s'), fmt(s.space.metadata.used), fmt(s.space.metadata.total));

        const now = GLib.get_monotonic_time() / 1e6;
        if (low && (!this._alerted || now - this._lastAlert > REALERT_SECONDS)) {
            this._alerted = true;
            this._lastAlert = now;
            this._notify(_('Btrfs: low unallocated space'),
                format(_('%s has only %s unallocated. Metadata cannot grow and writes will stall. ' +
                'Open the Btrfs Guard menu to reclaim space.'), this._mount, fmt(s.unalloc)), true);
        } else if (!low) {
            this._alerted = false;
        }
        return s;
    }

    _notify(title, body, critical = false) {
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

    _setBusy(busy, text) {
        this._busy = busy;
        for (const item of [this._balance0, this._balanceN, this._usage])
            item.setSensitive(!busy);
        if (busy)
            this._label.text = text;
    }

    async _balance(usage) {
        if (this._busy)
            return;
        this._setBusy(true, format(_('balancing -dusage=%d…'), usage));
        const title = format(_('Btrfs balance -dusage=%d'), usage);
        try {
            const r = await run(['pkexec', BTRFS, 'balance', 'start', `-dusage=${usage}`, this._mount]);
            if (r.status === 0) {
                const s = await this._refresh();
                const summary = r.stdout.trim().split('\n').pop();
                this._notify(format(_('%s finished'), title),
                    s ? `${summary}\n${format(_('Unallocated now: %s'), fmt(s.unalloc))}` : summary);
            } else if (r.status === 126 || r.status === 127) {
                this._notify(format(_('%s cancelled'), title), _('Authentication was dismissed or denied.'));
            } else {
                this._notify(format(_('%s failed'), title), (r.stderr || r.stdout).trim().split('\n').slice(-3).join('\n'));
            }
        } catch (e) {
            this._notify(format(_('%s failed'), title), `${e}`);
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
            text = r.status === 0
                ? r.stdout
                : (r.status === 126 || r.status === 127
                    ? 'Authentication was dismissed or denied.'
                    : (r.stderr || r.stdout));
        } catch (e) {
            text = `${e}`;
        } finally {
            this._setBusy(false);
            await this._refresh();
        }
        const dialog = new ModalDialog.ModalDialog({styleClass: 'prompt-dialog'});
        dialog.contentLayout.add_child(new St.Label({
            text: format(_('btrfs filesystem usage %s'), this._mount),
            style: 'font-weight: bold; padding-bottom: 8px;',
        }));
        const scroll = new St.ScrollView({style: 'max-height: 520px;'});
        scroll.add_child(new St.Label({text: text.trim(), style: 'font-family: monospace;'}));
        dialog.contentLayout.add_child(scroll);
        dialog.addButton({label: _('Close'), action: () => dialog.close(), key: Clutter.KEY_Escape});
        dialog.open();
    }

    destroy() {
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = null;
        }
        this._source?.destroy();
        super.destroy();
    }
});

export default class BtrfsGuardExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicators = [];
        this._settings.connect('changed::mounts', () => this._rebuild());
        this._settings.connect('changed::dusage', () => {
            for (const i of this._indicators)
                i._updateBalanceItem();
        });
        this._rebuild();
    }

    _rebuild() {
        for (const i of this._indicators ?? [])
            i.destroy();
        this._indicators = [];
        for (const mount of this._settings.get_strv('mounts')) {
            if (!mount)
                continue;
            const indicator = new Indicator(this, mount);
            Main.panel.addToStatusArea(`${this.uuid}-${mount}`, indicator);
            indicator.start();
            this._indicators.push(indicator);
        }
    }

    disable() {
        for (const i of this._indicators ?? [])
            i.destroy();
        this._indicators = [];
        this._settings = null;
    }
}
