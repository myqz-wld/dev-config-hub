#!/usr/bin/env bash

set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  printf '跳过 macOS 安装器测试：当前系统不是 macOS。\n'
  exit 0
fi

script_dir="$(cd "$(dirname "$0")" && pwd -P)"
test_parent="${TMPDIR:-/tmp}"
test_parent="${test_parent%/}"
test_root="$(mktemp -d "$test_parent/dch-installer-test.XXXXXX")"
source_app="$test_root/source/Dev Config Hub.app"
source_archive="$source_app-build"
destination_app="$test_root/destination/Dev Config Hub.app"
backup_root="$test_root/backups"
binary_path="$destination_app/Contents/MacOS/dev-config-hub"

cleanup() {
  case "$test_root" in
    "$test_parent"/dch-installer-test.*) rm -rf "$test_root" ;;
    *) printf '拒绝清理异常测试路径：%s\n' "$test_root" >&2 ;;
  esac
}
trap cleanup EXIT

mkdir -p "$source_app/Contents/MacOS" "$test_root/destination" \
  "$backup_root/Legacy Dev Config Hub.app"
printf '#!/bin/sh\nexit 0\n' > "$source_app/Contents/MacOS/dev-config-hub"
chmod 755 "$source_app/Contents/MacOS/dev-config-hub"
plutil -create xml1 "$source_app/Contents/Info.plist"
plutil -insert CFBundleIdentifier -string com.dch.devconfighub "$source_app/Contents/Info.plist"
plutil -insert CFBundleExecutable -string dev-config-hub "$source_app/Contents/Info.plist"
plutil -insert CFBundleName -string 'Dev Config Hub' "$source_app/Contents/Info.plist"
plutil -insert CFBundlePackageType -string APPL "$source_app/Contents/Info.plist"

run_install() {
  DCH_INSTALL_SOURCE_APP="$source_app" \
  DCH_INSTALL_ARCHIVE_SOURCE_APP="$source_archive" \
  DCH_INSTALL_DESTINATION_APP="$destination_app" \
  DCH_INSTALL_BACKUP_ROOT="$backup_root" \
  DCH_INSTALL_LAUNCH_SERVICES_TOOL=/usr/bin/true \
    bash "$script_dir/install-macos-app.sh"
}

run_install
first_inode="$(stat -f '%i' "$binary_path")"
ditto "$source_archive" "$source_app"
run_install
second_inode="$(stat -f '%i' "$binary_path")"

[ "$first_inode" != "$second_inode" ] || {
  printf '安装器测试失败：连续安装复用了可执行文件 inode。\n' >&2
  exit 1
}
[ -d "$backup_root/Legacy Dev Config Hub.app-backup" ] || {
  printf '安装器测试失败：旧式 .app 备份未迁移。\n' >&2
  exit 1
}
[ "$(find "$backup_root" -maxdepth 1 -type d -name '*.app' | wc -l | tr -d ' ')" = 0 ] || {
  printf '安装器测试失败：备份目录仍包含可发现的 .app。\n' >&2
  exit 1
}
[ "$(find "$backup_root" -maxdepth 1 -type d -name '*.app-backup' | wc -l | tr -d ' ')" = 2 ] || {
  printf '安装器测试失败：回滚备份数量不正确。\n' >&2
  exit 1
}
[ ! -e "$source_app" ] || {
  printf '安装器测试失败：可发现的 .app 构建产物仍然存在。\n' >&2
  exit 1
}
[ -d "$source_archive" ] || {
  printf '安装器测试失败：非 App 构建归档不存在。\n' >&2
  exit 1
}
codesign --verify --deep --strict "$destination_app"
printf 'macOS 安装器测试通过。\n'
