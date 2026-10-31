<p align="center"><img src="docs/icon.png" alt="Btrfs Guard" width="96"></p>

# Btrfs Guard — إضافة GNOME Shell

مؤشر في اللوحة يراقب **المساحة غير المخصصة** لأنظمة ملفات btrfs لديك، ويساعدك على استعادتها قبل أن تتوقف عمليات الكتابة.

**Languages:** [English](README.md) · [Русский](README.ru.md) · [中文](README.zh.md) · [Español](README.es.md) · [Français](README.fr.md) · [Português](README.pt.md) · [Deutsch](README.de.md) · العربية

<p align="center">
  <img src="docs/menu.png" alt="قائمة اللوحة تعرض المساحة غير المخصصة وإجراءات الاستعادة" height="300">
  <img src="docs/usage.png" alt="حوار استخدام نظام الملفات" height="300">
</p>

## آلية العمل

لا يعيد btrfs المساحة إلى حالة "غير مخصصة" عند حذف الملفات. تُوزَّع المساحة في **Chunks** بحجم ثابت (عادةً 1 GiB للبيانات و256 MiB للبيانات الوصفية). عندما ينفد btrfs من المساحة غير المخصصة لا يستطيع إنشاء Chunks جديدة — فلا تستطيع البيانات الوصفية النمو بعد ذلك وتتوقف عمليات الكتابة، حتى وإن بدا `df` سليمًا. والتعافي في هذه المرحلة صعب.

تراقب Btrfs Guard المساحة غير المخصصة باستمرار، وتقدم موازنة بنقرة واحدة:

1. **المراقبة** — لكل نقطة تركيب مُهيأة تقوم الإضافة بما يلي:
   - تحديد معرّف btrfs UUID والجهاز الأساسي مرة واحدة (عبر `findmnt`)، ثم
   - قراءة عدادات التخصيص من sysfs (`/sys/fs/btrfs/<uuid>/allocation/*`) وحجم الجهاز من `/sys/class/block/<dev>/size` — دون استدعاء أوامر `btrfs` ودون الحاجة إلى صلاحيات root، لذلك فإن الاستعلام كل 30 ثانية مجاني تقريبًا.
   - *غير مخصص = حجم الجهاز − Σ disk_total لـ Chunks البيانات والبيانات الوصفية والنظام.*
2. **التنبيه** — عندما تنخفض المساحة غير المخصصة عن **1 GiB**، يتحول نص المؤشر في اللوحة إلى الأحمر مع أيقونة تحذير، ويُطلق إشعار **حرج**؛ ويُعاد التنبيه كحد أقصى كل 30 دقيقة حتى تُستعاد المساحة.
3. **الاستعادة** — تُنفّذ القائمة الأمر `pkexec btrfs balance start -dusage=N <mount>`:
   - `-dusage=0` يُفرغ الـ Chunks الفارغة تمامًا،
   - `-dusage=N` (الافتراضي **60**، وقابل للتهيئة) يضغط الـ Chunks المستخدمة جزئيًا ويعيد مساحتها الفارغة إلى المجموعة غير المخصصة.
   تتطلب الموازنة حد استخدام الـ Chunk — القيم المنخفضة آمنة لكنها تسترد مساحة أقل، والقيم المرتفعة تسترد مساحة أكبر لكنها تعيد كتابة بيانات أكثر.
4. **الفحص** — يعرض عنصر في القائمة `btrfs filesystem usage` لنقطة التركيب في حوار قابل للتمرير.

## الإعدادات

تُفتح عبر تطبيق *الإضافات* ← Btrfs Guard ← أيقونة الترس (أو `gnome-extensions prefs btrfs-guard@ak0.org`):

- **الأقسام المراقبة** — قائمة نقاط تركيب btrfs، ومؤشر واحد في اللوحة لكل نقطة. أضفها يدويًا، أو انقر *اكتشاف عمليات تركيب btrfs* لملء جميع أنظمة ملفات btrfs تلقائيًا من `findmnt` (نقطة تركيب واحدة لكل نظام ملفات؛ تُتجاهل عمليات التركيب القديمة التي لا تملك UUID).
- **حد استخدام Chunk** — الـ `N` في `balance -dusage=N` (0–100%، الافتراضي 60).

تُخزَّن الإعدادات في GSettings ضمن `org.gnome.shell.extensions.btrfs-guard`.

## الترجمات

تُعلَّم النصوص الظاهرة للمستخدم بـ gettext (النطاق `btrfs-guard`). الروسية (`ru`) مُضمّنة. لإضافة لغة، أنشئ `po/<lang>.po` من `po/btrfs-guard.pot` (حدّثه بالأمر `xgettext --from-code=UTF-8 --keyword=_ -o po/btrfs-guard.pot extension.js prefs.js`)، ثم ترجم الملف، وبعد ذلك ترجمه إلى ملف ثنائي وثبّته:

```sh
mkdir -p locale/<lang>/LC_MESSAGES
msgfmt po/<lang>.po -o locale/<lang>/LC_MESSAGES/btrfs-guard.mo
```

## التثبيت من المصدر

```sh
git clone https://github.com/catlion/btrfs-guard-gnome-ext.git
cd btrfs-guard-gnome-ext
glib-compile-schemas schemas
cp -r . ~/.local/share/gnome-shell/extensions/btrfs-guard@ak0.org
# سجّل الخروج / أعد تشغيل GNOME Shell لتحميل الإضافة
```

## المتطلبات

- GNOME Shell 48 أو أحدث
- btrfs-progs (`/usr/bin/btrfs`) و polkit (`pkexec`) — يُستخدمان فقط لإجراءات الموازنة والاستخدام
