<p align="center"><img src="docs/icon.png" alt="Btrfs Guard" width="96"></p>

# Btrfs Guard — GNOME Shell extension

Panel indicator that watches the **unallocated space** of your btrfs filesystems and helps you reclaim it before writes stall.

**Languages:** [English](README.md) · [Русский](README.ru.md) · [中文](README.zh.md) · [Español](README.es.md) · [Français](README.fr.md) · [Português](README.pt.md) · [Deutsch](README.de.md) · [العربية](README.ar.md)

<p align="center">
  <img src="docs/menu.png" alt="Panel menu showing unallocated space and reclaim actions" height="300">
  <img src="docs/usage.png" alt="Filesystem usage dialog" height="300">
</p>

## How it works

btrfs does not free disk space back to "unallocated" when files are deleted. Space is handed out in fixed-size **chunks** (typically 1 GiB for data, 256 MiB for metadata). When btrfs runs out of unallocated space it cannot allocate new chunks — metadata can no longer grow and writes stall, even though `df` may still look fine. Recovery at that point is painful.

Btrfs Guard continuously monitors unallocated space and offers one-click balancing:

1. **Watch** — for every configured mount point the extension:
   - resolves the btrfs UUID and backing device once (via `findmnt`), then
   - reads allocation counters from sysfs (`/sys/fs/btrfs/<uuid>/allocation/*`) and the device size from `/sys/class/block/<dev>/size` — no `btrfs` CLI calls and no root needed, so polling every 30 s is essentially free.
   - *Unallocated = device size − Σ disk_total of data/metadata/system chunks.*
2. **Alert** — when unallocated space drops below **1 GiB**, the panel label turns red with a warning icon and a **critical** notification is raised; it re-alerts at most every 30 minutes until space is reclaimed.
3. **Reclaim** — the menu runs `pkexec btrfs balance start -dusage=N <mount>`:
   - `-dusage=0` vacates completely empty chunks,
   - `-dusage=N` (default **60**, configurable) partially-used chunks are compacted and their slack space returned to the unallocated pool.
   Balance requires the chunk usage threshold — lower values are safe but do less; higher values reclaim more but rewrite more data.
4. **Inspect** — a menu item shows `btrfs filesystem usage` for the mount in a scrollable dialog.

## Settings

Open via *Extensions* app → Btrfs Guard → gear icon (or `gnome-extensions prefs btrfs-guard@ak0.org`):

- **Watched partitions** — list of btrfs mount points; one panel indicator each. Add manually or click *Detect btrfs mounts* to auto-fill all btrfs filesystems from `findmnt` (one mount per filesystem; stale mounts without a UUID are skipped).
- **Chunk usage threshold** — the `N` in `balance -dusage=N` (0–100 %, default 60).

Settings are stored in GSettings under `org.gnome.shell.extensions.btrfs-guard`.

## Translations

User-facing strings are marked with gettext (domain `btrfs-guard`). Russian (`ru`) is shipped; to add a language, create `po/<lang>.po` from `po/btrfs-guard.pot` (refresh with `xgettext --from-code=UTF-8 --keyword=_ -o po/btrfs-guard.pot extension.js prefs.js`), translate, then build and install:

```sh
mkdir -p locale/<lang>/LC_MESSAGES
msgfmt po/<lang>.po -o locale/<lang>/LC_MESSAGES/btrfs-guard.mo
```

## Install from source

```sh
git clone https://github.com/catlion/btrfs-guard-gnome-ext.git
cd btrfs-guard-gnome-ext
glib-compile-schemas schemas
cp -r . ~/.local/share/gnome-shell/extensions/btrfs-guard@ak0.org
# log out / restart GNOME Shell to load
```

## Requirements

- GNOME Shell 48 or newer
- btrfs-progs (`/usr/bin/btrfs`) and polkit (`pkexec`) — used only for balance/usage actions
