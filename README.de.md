<p align="center"><img src="docs/icon.png" alt="Btrfs Guard" width="96"></p>

# Btrfs Guard — GNOME-Shell-Erweiterung

Panel-Indikator, der den **nicht zugewiesenen Speicherplatz** Ihrer btrfs-Dateisysteme überwacht und hilft, ihn freizugeben, bevor Schreibvorgänge blockiert werden.

**Languages:** [English](README.md) · [Русский](README.ru.md) · [中文](README.zh.md) · [Español](README.es.md) · [Français](README.fr.md) · [Português](README.pt.md) · Deutsch

<p align="center">
  <img src="docs/menu.png" alt="Panelmenü mit nicht zugewiesenem Speicher und Freigabeaktionen" height="300">
  <img src="docs/usage.png" alt="Dialog zur Dateisystemauslastung" height="300">
</p>

## Funktionsweise

btrfs gibt beim Löschen von Dateien keinen Speicherplatz zurück an "nicht zugewiesen". Speicher wird in festen Größen als **Chunks** vergeben (typischerweise 1 GiB für Daten, 256 MiB für Metadaten). Wenn btrfs keinen nicht zugewiesenen Speicher mehr hat, kann es keine neuen Chunks anlegen — Metadaten können nicht mehr wachsen und Schreibvorgänge werden blockiert, obwohl `df` noch unauffällig aussehen kann. Die Wiederherstellung ist dann mühsam.

Btrfs Guard überwacht den nicht zugewiesenen Speicher fortlaufend und bietet ein Balancieren mit einem Klick an:

1. **Überwachen** — für jeden konfigurierten Einhängepunkt führt die Erweiterung Folgendes aus:
   - ermittelt die btrfs-UUID und das zugrunde liegende Gerät einmalig (über `findmnt`), danach
   - liest die Zuweisungszähler aus sysfs (`/sys/fs/btrfs/<uuid>/allocation/*`) und die Gerätegröße aus `/sys/class/block/<dev>/size` — ohne `btrfs`-CLI-Aufrufe und ohne root-Rechte, daher ist das Abfragen alle 30 s praktisch kostenlos.
   - *Nicht zugewiesen = Gerätegröße − Σ disk_total der data/metadata/system-Chunks.*
2. **Warnen** — sinkt der nicht zugewiesene Speicher unter **1 GiB**, wird die Panel-Beschriftung rot mit einem Warnsymbol und eine **kritische** Benachrichtigung wird ausgelöst; sie wird höchstens alle 30 Minuten wiederholt, bis Speicher freigegeben ist.
3. **Freigeben** — das Menü führt `pkexec btrfs balance start -dusage=N <mount>` aus:
   - `-dusage=0` entfernt vollständig leere Chunks,
   - `-dusage=N` (Standard **60**, konfigurierbar) verdichtet teilweise belegte Chunks und gibt ihren freien Platz an den nicht zugewiesenen Pool zurück.
   Das Balancieren erfordert den Schwellenwert für die Chunk-Auslastung — niedrige Werte sind unbedenklich, geben aber weniger frei; hohe Werte geben mehr frei, schreiben aber mehr Daten neu.
4. **Prüfen** — ein Menüeintrag zeigt `btrfs filesystem usage` für den Einhängepunkt in einem scrollbaren Dialog.

## Einstellungen

Öffnen über die App *Erweiterungen* → Btrfs Guard → Zahnradsymbol (oder `gnome-extensions prefs btrfs-guard@ak0.org`):

- **Überwachte Partitionen** — Liste der btrfs-Einhängepunkte; je einer ein Indikator im Panel. Manuell hinzufügen oder auf *Btrfs-Einhängungen erkennen* klicken, um alle btrfs-Dateisysteme aus `findmnt` automatisch einzutragen (ein Einhängepunkt pro Dateisystem; veraltete Einhängungen ohne UUID werden übersprungen).
- **Schwellenwert für Chunk-Auslastung** — das `N` in `balance -dusage=N` (0–100 %, Standard 60).

Die Einstellungen werden in GSettings unter `org.gnome.shell.extensions.btrfs-guard` gespeichert.

## Übersetzungen

Benutzersichtbare Zeichenketten sind mit gettext markiert (Domäne `btrfs-guard`). Russisch (`ru`) ist enthalten; um eine Sprache hinzuzufügen, erstellen Sie `po/<lang>.po` aus `po/btrfs-guard.pot` (aktualisieren mit `xgettext --from-code=UTF-8 --keyword=_ -o po/btrfs-guard.pot extension.js prefs.js`), übersetzen Sie sie und kompilieren und installieren Sie anschließend:

```sh
mkdir -p locale/<lang>/LC_MESSAGES
msgfmt po/<lang>.po -o locale/<lang>/LC_MESSAGES/btrfs-guard.mo
```

## Installation aus dem Quellcode

```sh
git clone https://github.com/catlion/btrfs-guard-gnome-ext.git
cd btrfs-guard-gnome-ext
glib-compile-schemas schemas
cp -r . ~/.local/share/gnome-shell/extensions/btrfs-guard@ak0.org
# abmelden / GNOME Shell neu starten, um die Erweiterung zu laden
```

## Voraussetzungen

- GNOME Shell 48 oder neuer
- btrfs-progs (`/usr/bin/btrfs`) und polkit (`pkexec`) — nur für die Aktionen Balancieren und Auslastung verwendet
