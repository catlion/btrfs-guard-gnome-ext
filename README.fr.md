# Btrfs Guard — extension GNOME Shell

Indicateur du panneau qui surveille l'**espace non alloué** de vos systèmes de fichiers btrfs et vous aide à le récupérer avant que les écritures ne se bloquent.

<p align="center">
  <img src="docs/menu.png" alt="Menu du panneau avec l'espace non alloué et les actions de récupération" height="300">
  <img src="docs/usage.png" alt="Boîte de dialogue d'utilisation du système de fichiers" height="300">
</p>

## Fonctionnement

btrfs ne rend pas l'espace disque à « non alloué » lorsque des fichiers sont supprimés. L'espace est attribué en **chunks** de taille fixe (généralement 1 GiB pour les données, 256 MiB pour les métadonnées). Lorsque btrfs manque d'espace non alloué, il ne peut plus allouer de nouveaux chunks : les métadonnées ne peuvent plus croître et les écritures se bloquent, alors même que `df` peut encore sembler correct. La récupération à ce stade est pénible.

Btrfs Guard surveille en continu l'espace non alloué et propose un rééquilibrage en un clic :

1. **Surveillance** — pour chaque point de montage configuré, l'extension :
   - résout l'UUID btrfs et le périphérique sous-jacent une seule fois (via `findmnt`), puis
   - lit les compteurs d'allocation depuis sysfs (`/sys/fs/btrfs/<uuid>/allocation/*`) et la taille du périphérique depuis `/sys/class/block/<dev>/size` — sans appel à la CLI `btrfs` et sans droits root, de sorte qu'interroger toutes les 30 s ne coûte quasiment rien.
   - *Non alloué = taille du périphérique − Σ disk_total des chunks data/metadata/system.*
2. **Alerte** — lorsque l'espace non alloué passe sous **1 GiB**, l'étiquette du panneau devient rouge avec une icône d'avertissement et une notification **critique** est émise ; elle est répétée au plus toutes les 30 minutes tant que l'espace n'est pas récupéré.
3. **Récupération** — le menu exécute `pkexec btrfs balance start -dusage=N <mount>` :
   - `-dusage=0` supprime les chunks entièrement vides,
   - `-dusage=N` (par défaut **60**, configurable) compacte les chunks partiellement utilisés et rend leur espace libre au pool non alloué.
   Le rééquilibrage exige le seuil d'utilisation des chunks — des valeurs basses sont sans risque mais récupèrent moins ; des valeurs élevées récupèrent davantage mais réécrivent plus de données.
4. **Inspection** — un élément de menu affiche `btrfs filesystem usage` pour le point de montage dans une boîte de dialogue défilante.

## Paramètres

Ouvrez-les via l'application *Extensions* → Btrfs Guard → icône en forme d'engrenage (ou `gnome-extensions prefs btrfs-guard@ak0.org`) :

- **Partitions surveillées** — liste des points de montage btrfs ; un indicateur par point dans le panneau. Ajoutez-les manuellement ou cliquez sur *Détecter les montages btrfs* pour remplir automatiquement tous les systèmes de fichiers btrfs à partir de `findmnt` (un montage par système de fichiers ; les montages obsolètes sans UUID sont ignorés).
- **Seuil d'utilisation des chunks** — le `N` de `balance -dusage=N` (0–100 %, par défaut 60).

Les paramètres sont stockés dans GSettings sous `org.gnome.shell.extensions.btrfs-guard`.

## Traductions

Les chaînes destinées à l'utilisateur sont marquées avec gettext (domaine `btrfs-guard`). Le russe (`ru`) est fourni ; pour ajouter une langue, créez `po/<lang>.po` à partir de `po/btrfs-guard.pot` (à actualiser avec `xgettext --from-code=UTF-8 --keyword=_ -o po/btrfs-guard.pot extension.js prefs.js`), traduisez, puis compilez et installez :

```sh
mkdir -p locale/<lang>/LC_MESSAGES
msgfmt po/<lang>.po -o locale/<lang>/LC_MESSAGES/btrfs-guard.mo
```

## Installation depuis les sources

```sh
git clone https://github.com/catlion/btrfs-guard-gnome-ext.git
cd btrfs-guard-gnome-ext
glib-compile-schemas schemas
cp -r . ~/.local/share/gnome-shell/extensions/btrfs-guard@ak0.org
# déconnectez-vous / redémarrez GNOME Shell pour charger l'extension
```

## Prérequis

- GNOME Shell 48 ou plus récent
- btrfs-progs (`/usr/bin/btrfs`) et polkit (`pkexec`) — utilisés uniquement pour les actions de rééquilibrage et d'utilisation
