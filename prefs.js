import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');

export default class BtrfsGuardPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: _('Btrfs Guard'),
            icon_name: 'drive-harddisk-symbolic',
        });
        window.add(page);

        // --- Watched partitions ---

        const DESCRIPTION = _('Btrfs mount points monitored in the panel. One indicator is shown per mount point.');
        const EMPTY_WARNING = _('No partitions configured — the panel indicator is disabled.');
        const mountsGroup = new Adw.PreferencesGroup({
            title: _('Watched partitions'),
            description: DESCRIPTION,
        });
        page.add(mountsGroup);

        const list = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
            hexpand: true,
        });
        mountsGroup.add(list);

        const saveMounts = () => {
            const mounts = [...list]
                .map(row => row._entry.text.trim())
                .filter(m => m.length > 0);
            settings.set_strv('mounts', mounts);
            mountsGroup.description = mounts.length > 0 ? DESCRIPTION : EMPTY_WARNING;
        };

        const addMountRow = mount => {
            const row = new Gtk.ListBoxRow({activatable: false});
            const box = new Gtk.Box({
                spacing: 6,
                margin_top: 6,
                margin_bottom: 6,
                margin_start: 6,
                margin_end: 6,
            });
            const entry = new Gtk.Entry({
                text: mount,
                placeholder_text: '/path/to/mount',
                hexpand: true,
            });
            entry.connect('changed', saveMounts);
            const remove = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                valign: Gtk.Align.CENTER,
                tooltip_text: _('Remove this mount point'),
            });
            remove.connect('clicked', () => {
                list.remove(row);
                saveMounts();
            });
            row._entry = entry;
            box.append(entry);
            box.append(remove);
            row.set_child(box);
            list.append(row);
        };

        for (const mount of settings.get_strv('mounts'))
            addMountRow(mount);
        if (settings.get_strv('mounts').length === 0)
            mountsGroup.description = EMPTY_WARNING;

        const detectAndAdd = async () => {
            try {
                const proc = new Gio.Subprocess({
                    argv: ['findmnt', '-rno', 'TARGET,UUID,FSTYPE', '-t', 'btrfs'],
                    flags: Gio.SubprocessFlags.STDOUT_PIPE,
                });
                proc.init(null);
                const [stdout] = await proc.communicate_utf8_async(null, null);
                const existing = new Set(settings.get_strv('mounts'));
                const mounts = [];
                for (const line of (stdout ?? '').trim().split('\n')) {
                    // single-space split: UUID may be empty
                    const [rawTarget, uuid, fstype] = line.trim().split(' ');
                    // findmnt -r escapes special characters as \xHH
                    const target = rawTarget?.replace(/\\x([0-9a-fA-F]{2})/g,
                        (_m, h) => String.fromCharCode(parseInt(h, 16)));
                    if (fstype === 'btrfs' && target)
                        mounts.push({target, uuid});
                }
                // one indicator per filesystem: skip stale mounts without a UUID
                // and further mounts of a filesystem that is already watched
                const seen = new Set(mounts.filter(m => existing.has(m.target)).map(m => m.uuid));
                for (const {target, uuid} of mounts) {
                    if (!uuid || seen.has(uuid) || existing.has(target))
                        continue;
                    addMountRow(target);
                    seen.add(uuid);
                }
                saveMounts();
            } catch (e) {
                console.error(`btrfs-guard prefs: cannot detect btrfs mounts: ${e}`);
            }
        };

        const addButtons = new Gtk.Box({spacing: 6, margin_top: 6});
        const addEntry = new Gtk.Entry({
            placeholder_text: '/path/to/mount',
            hexpand: true,
        });
        const addButton = new Gtk.Button({
            label: _('Add'),
            valign: Gtk.Align.CENTER,
        });
        const doAdd = () => {
            const mount = addEntry.text.trim();
            if (!mount)
                return;
            addMountRow(mount);
            addEntry.text = '';
            saveMounts();
        };
        addButton.connect('clicked', doAdd);
        addEntry.connect('activate', doAdd);
        const detectButton = new Gtk.Button({
            label: _('Detect btrfs mounts'),
            valign: Gtk.Align.CENTER,
        });
        detectButton.connect('clicked', () => detectAndAdd());
        addButtons.append(addEntry);
        addButtons.append(addButton);
        addButtons.append(detectButton);
        mountsGroup.add(addButtons);

        // --- Balance threshold ---

        const balanceGroup = new Adw.PreferencesGroup({
            title: _('Space reclaim'),
            description: _('Chunks that are less full than this percentage are compacted by the "balance -dusage=N" menu action.'),
        });
        page.add(balanceGroup);

        const dusageRow = new Adw.SpinRow({
            title: _('Chunk usage threshold'),
            subtitle: _('Used by balance -dusage=N (0–100%)'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 100,
                step_increment: 5,
                page_increment: 10,
                value: settings.get_int('dusage'),
            }),
        });
        settings.bind('dusage', dusageRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        balanceGroup.add(dusageRow);
    }
}
