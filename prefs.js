import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class BtrfsGuardPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'Btrfs Guard',
            icon_name: 'drive-harddisk-symbolic',
        });
        window.add(page);

        // --- Watched partitions ---

        const mountsGroup = new Adw.PreferencesGroup({
            title: 'Watched partitions',
            description: 'Btrfs mount points monitored in the panel. One indicator is shown per mount point.',
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
                tooltip_text: 'Remove this mount point',
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

        const detectAndAdd = async () => {
            try {
                const proc = new Gio.Subprocess({
                    argv: ['findmnt', '-rnbo', 'TARGET,FSTYPE', '-t', 'btrfs'],
                    flags: Gio.SubprocessFlags.STDOUT_PIPE,
                });
                proc.init(null);
                const [stdout] = await proc.communicate_utf8_async(null, null);
                const existing = new Set(settings.get_strv('mounts'));
                for (const line of (stdout ?? '').trim().split('\n')) {
                    const [target, fstype] = line.trim().split(/\s+/);
                    if (fstype === 'btrfs' && target && !existing.has(target)) {
                        addMountRow(target);
                        existing.add(target);
                    }
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
            label: 'Add',
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
            label: 'Detect btrfs mounts',
            valign: Gtk.Align.CENTER,
        });
        detectButton.connect('clicked', () => detectAndAdd());
        addButtons.append(addEntry);
        addButtons.append(addButton);
        addButtons.append(detectButton);
        mountsGroup.add(addButtons);

        // --- Balance threshold ---

        const balanceGroup = new Adw.PreferencesGroup({
            title: 'Space reclaim',
            description: 'Chunks that are less full than this percentage are compacted by the "balance -dusage=N" menu action.',
        });
        page.add(balanceGroup);

        const dusageRow = new Adw.SpinRow({
            title: 'Chunk usage threshold',
            subtitle: 'Used by balance -dusage=N (0–100%)',
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
