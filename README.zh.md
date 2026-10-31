# Btrfs Guard — GNOME Shell 扩展

面板指示器，用于监视 btrfs 文件系统的**未分配空间**，并帮助你在写入卡住之前回收空间。

## 工作原理

删除文件后，btrfs 不会把磁盘空间释放回"未分配"状态。空间以固定大小的**块**（chunk）分配，数据块通常为 1 GiB，元数据块通常为 256 MiB。当 btrfs 的未分配空间耗尽时，就无法再分配新的块——元数据无法继续增长，写入随之卡住，即使 `df` 看起来仍然正常。此时恢复起来非常麻烦。

Btrfs Guard 会持续监视未分配空间，并提供一键平衡（balance）功能：

1. **监视**——对于每个已配置的挂载点，扩展会：
   - 通过 `findmnt` 一次性解析 btrfs UUID 和底层设备，然后
   - 从 sysfs 读取分配计数器（`/sys/fs/btrfs/<uuid>/allocation/*`），并从 `/sys/class/block/<dev>/size` 读取设备大小——不调用 `btrfs` 命令行工具，也不需要 root 权限，因此每 30 秒轮询一次基本没有开销。
   - *未分配空间 = 设备大小 − 数据/元数据/系统块的 disk_total 之和。*
2. **警报**——当未分配空间低于 **1 GiB** 时，面板标签会变为红色并显示警告图标，同时发出**严重**级别的通知；在空间被回收之前，最多每 30 分钟重新警报一次。
3. **回收**——菜单运行 `pkexec btrfs balance start -dusage=N <mount>`：
   - `-dusage=0` 清理完全空闲的块，
   - `-dusage=N`（默认 **60**，可配置）压缩部分已使用的块，并将其剩余空间归还到未分配空间池。
   平衡操作需要设定块使用率阈值——较低的值更安全但回收较少；较高的值回收更多，但需要重写更多数据。
4. **查看**——菜单项会在可滚动的对话框中显示该挂载点的 `btrfs filesystem usage` 输出。

## 设置

通过 *Extensions* 应用 → Btrfs Guard → 齿轮图标打开（或运行 `gnome-extensions prefs btrfs-guard@ak.local`）：

- **监视的分区**——btrfs 挂载点列表；每个挂载点对应一个面板指示器。可手动添加，或点击 *Detect btrfs mounts* 从 `findmnt` 自动填充所有 btrfs 文件系统。
- **块使用率阈值**——`balance -dusage=N` 中的 `N`（0–100%，默认 60）。

设置保存在 GSettings 的 `org.gnome.shell.extensions.btrfs-guard` 下。

## 翻译

面向用户的字符串使用 gettext 标记（域为 `btrfs-guard`）。随扩展提供俄语（`ru`）翻译。要添加新语言，请从 `po/btrfs-guard.pot` 创建 `po/<lang>.po`（可使用 `xgettext --from-code=UTF-8 --keyword=_ -o po/btrfs-guard.pot extension.js prefs.js` 刷新模板），翻译后再编译安装：

```sh
mkdir -p locale/<lang>/LC_MESSAGES
msgfmt po/<lang>.po -o locale/<lang>/LC_MESSAGES/btrfs-guard.mo
```

## 从源码安装

```sh
git clone https://github.com/catlion/btrfs-guard-gnome-ext.git
cd btrfs-guard-gnome-ext
glib-compile-schemas schemas
cp -r . ~/.local/share/gnome-shell/extensions/btrfs-guard@ak.local
# 注销或重启 GNOME Shell 以加载扩展
```

## 系统要求

- GNOME Shell 46 或更高版本
- btrfs-progs（`/usr/bin/btrfs`）和 polkit（`pkexec`）——仅用于平衡和用量查看操作
