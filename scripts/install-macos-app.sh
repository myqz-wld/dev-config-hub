#!/usr/bin/env bash

set -euo pipefail

app_bundle_name="Dev Config Hub.app"
app_binary_name="dev-config-hub"
script_dir="$(cd "$(dirname "$0")" && pwd -P)"
repo_root="$(cd "$script_dir/.." && pwd -P)"

default_source_app="$repo_root/src-tauri/target/release/bundle/macos/$app_bundle_name"
default_archived_source_app="$default_source_app-build"
archive_source_app=""
if [ "${DCH_INSTALL_SOURCE_APP+x}" = x ]; then
  source_app="$DCH_INSTALL_SOURCE_APP"
  archive_source_app="${DCH_INSTALL_ARCHIVE_SOURCE_APP:-}"
elif [ -d "$default_source_app" ]; then
  source_app="$default_source_app"
  archive_source_app="$default_archived_source_app"
elif [ -d "$default_archived_source_app" ]; then
  source_app="$default_archived_source_app"
else
  source_app="$default_source_app"
  archive_source_app="$default_archived_source_app"
fi
installed_app="${DCH_INSTALL_DESTINATION_APP:-/Applications/$app_bundle_name}"
backup_root="${DCH_INSTALL_BACKUP_ROOT:-$HOME/Library/Application Support/Dev Config Hub/Install Backups}"
launch_services_tool="${DCH_INSTALL_LAUNCH_SERVICES_TOOL:-/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister}"

fail() {
  printf '安装失败：%s\n' "$1" >&2
  exit 1
}

require_absolute_path() {
  local label="$1"
  local candidate_path="$2"

  case "$candidate_path" in
    /*) ;;
    *) fail "$label 必须是绝对路径：$candidate_path" ;;
  esac
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "缺少系统命令：$1"
}

target_app_is_running() {
  local installed_binary="$installed_app/Contents/MacOS/$app_binary_name"
  local app_pid running_command

  while IFS= read -r app_pid; do
    [ -n "$app_pid" ] || continue
    running_command="$(ps -p "$app_pid" -o command= 2>/dev/null || true)"
    case "$running_command" in
      "$installed_binary"|"$installed_binary "*) return 0 ;;
    esac
  done < <(pgrep -x "$app_binary_name" 2>/dev/null || true)

  return 1
}

unregister_app() {
  local app_path="$1"

  [ -x "$launch_services_tool" ] || return 0
  "$launch_services_tool" -u "$app_path" >/dev/null 2>&1 || true
}

migrate_legacy_backups() {
  local legacy_backup migrated_backup

  [ -d "$backup_root" ] || return 0
  for legacy_backup in "$backup_root"/*.app; do
    [ -e "$legacy_backup" ] || continue
    [ -d "$legacy_backup" ] || fail "旧式备份不是目录：$legacy_backup"
    [ ! -L "$legacy_backup" ] || fail "旧式备份不能是符号链接：$legacy_backup"
    migrated_backup="$legacy_backup-backup"
    [ ! -e "$migrated_backup" ] || fail "旧式备份迁移目标已存在：$migrated_backup"
    unregister_app "$legacy_backup"
    mv "$legacy_backup" "$migrated_backup"
    if command -v mdimport >/dev/null 2>&1; then
      mdimport "$migrated_backup" >/dev/null 2>&1 || true
    fi
    printf '旧式 App 备份已转换为不可启动的回滚备份：%s\n' "$migrated_backup"
  done
}

register_canonical_install() {
  unregister_app "$source_app"
  archive_build_artifact

  [ -x "$launch_services_tool" ] || return 0
  if ! "$launch_services_tool" -f "$installed_app" >/dev/null 2>&1; then
    printf '警告：应用已安装，但无法刷新 macOS 应用注册；系统稍后会自动重新发现它。\n' >&2
  fi
}

archive_build_artifact() {
  [ -n "$archive_source_app" ] || return 0

  if [ -e "$archive_source_app" ]; then
    replaced_build_archive="$archive_source_app.replaced-$timestamp-$$"
    if ! mv "$archive_source_app" "$replaced_build_archive"; then
      printf '警告：应用已安装，但无法暂存旧构建归档：%s\n' "$archive_source_app" >&2
      replaced_build_archive=""
      return 0
    fi
  fi

  if ! mv "$source_app" "$archive_source_app"; then
    printf '警告：应用已安装，但无法归档构建产物：%s\n' "$source_app" >&2
    if [ -n "$replaced_build_archive" ] && [ ! -e "$archive_source_app" ]; then
      mv "$replaced_build_archive" "$archive_source_app" || true
      replaced_build_archive=""
    fi
    return 0
  fi

  if command -v mdimport >/dev/null 2>&1; then
    mdimport "$archive_source_app" >/dev/null 2>&1 || true
  fi
  printf '构建产物已归档为不可启动目录：%s\n' "$archive_source_app"
}

[ "$(uname -s)" = "Darwin" ] || fail "此安装器仅支持 macOS"

for required_command in basename chflags codesign date dirname ditto mkdir mktemp mv pgrep plutil ps rm rmdir stat uname; do
  require_command "$required_command"
done

require_absolute_path "构建产物" "$source_app"
require_absolute_path "安装目标" "$installed_app"
require_absolute_path "备份目录" "$backup_root"
if [ -n "$archive_source_app" ]; then
  require_absolute_path "构建归档" "$archive_source_app"
fi

[ "$(basename "$installed_app")" = "$app_bundle_name" ] || \
  fail "安装目标必须以 $app_bundle_name 结尾"
[ "$source_app" != "$installed_app" ] || fail "构建产物与安装目标不能是同一路径"
[ -z "$archive_source_app" ] || [ "$source_app" != "$archive_source_app" ] || \
  fail "构建产物与构建归档不能是同一路径"
[ -z "$archive_source_app" ] || [ "$installed_app" != "$archive_source_app" ] || \
  fail "安装目标与构建归档不能是同一路径"
[ -d "$source_app" ] || fail "找不到构建产物：$source_app；请先运行 bunx tauri build --bundles app"
[ ! -L "$source_app" ] || fail "构建产物不能是符号链接：$source_app"
[ -x "$source_app/Contents/MacOS/$app_binary_name" ] || \
  fail "构建产物缺少可执行文件：$source_app/Contents/MacOS/$app_binary_name"
bundle_identifier="$(plutil -extract CFBundleIdentifier raw -o - "$source_app/Contents/Info.plist" 2>/dev/null || true)"
[ "$bundle_identifier" = "com.dch.devconfighub" ] || \
  fail "构建产物的 bundle identifier 不正确：${bundle_identifier:-未找到}"

if [ -n "$archive_source_app" ]; then
  [ "$(basename "$archive_source_app")" = "$app_bundle_name-build" ] || \
    fail "构建归档必须以 $app_bundle_name-build 结尾"
  archive_parent="$(dirname "$archive_source_app")"
  [ -d "$archive_parent" ] || fail "构建归档的父目录不存在：$archive_parent"
  [ ! -L "$archive_parent" ] || fail "构建归档的父目录不能是符号链接：$archive_parent"
  if [ -e "$archive_source_app" ]; then
    [ -d "$archive_source_app" ] || fail "构建归档已存在但不是目录：$archive_source_app"
    [ ! -L "$archive_source_app" ] || fail "构建归档不能是符号链接：$archive_source_app"
  fi
fi

destination_parent="$(dirname "$installed_app")"
[ -d "$destination_parent" ] || fail "安装目标的父目录不存在：$destination_parent"
[ ! -L "$destination_parent" ] || fail "安装目标的父目录不能是符号链接：$destination_parent"

if [ -e "$installed_app" ]; then
  [ -d "$installed_app" ] || fail "安装目标已存在但不是目录：$installed_app"
  [ ! -L "$installed_app" ] || fail "安装目标不能是符号链接：$installed_app"
fi

if [ -e "$backup_root" ]; then
  [ -d "$backup_root" ] || fail "备份路径已存在但不是目录：$backup_root"
  [ ! -L "$backup_root" ] || fail "备份目录不能是符号链接：$backup_root"
fi

target_app_is_running && fail "请先退出 $app_bundle_name，再重新运行安装命令"
migrate_legacy_backups

timestamp="$(date '+%Y%m%d-%H%M%S')"
stage_root="$(mktemp -d "$destination_parent/.dch-install.XXXXXX")"
stage_app="$stage_root/$app_bundle_name"
rollback_app="$destination_parent/.dch-rollback-$timestamp-$$.app-backup"
backup_app="$backup_root/Dev Config Hub-$timestamp-$$.app-backup"
old_app_moved=0
new_app_installed=0
install_verified=0
old_inode=""
replaced_build_archive=""

restore_previous_install() {
  local exit_code="$?"

  trap - EXIT
  if [ "$exit_code" -ne 0 ] && [ "$install_verified" -eq 0 ] && \
      [ "$new_app_installed" -eq 1 ] && [ -e "$installed_app" ]; then
    if mv "$installed_app" "$stage_root/Dev Config Hub.failed-app"; then
      printf '未通过验证的新安装保留在：%s\n' "$stage_root/Dev Config Hub.failed-app" >&2
      new_app_installed=0
    else
      printf '无法移走未验证的新安装：%s\n' "$installed_app" >&2
    fi
  fi
  if [ "$exit_code" -ne 0 ] && [ "$install_verified" -eq 0 ] && \
      [ "$old_app_moved" -eq 1 ] && [ -d "$rollback_app" ]; then
    if [ ! -e "$installed_app" ] && mv "$rollback_app" "$installed_app"; then
      printf '已自动恢复旧安装：%s\n' "$installed_app" >&2
      old_app_moved=0
    else
      printf '自动恢复失败，旧安装仍位于：%s\n' "$rollback_app" >&2
    fi
  fi
  if [ -d "$stage_root" ]; then
    printf '安装暂存目录保留在：%s\n' "$stage_root" >&2
  fi
  exit "$exit_code"
}

trap restore_previous_install EXIT

printf '正在暂存新应用…\n'
ditto "$source_app" "$stage_app"
chflags nohidden "$stage_app" || fail "无法清除暂存应用的隐藏标记：$stage_app"
if [ -x /usr/bin/SetFile ]; then
  /usr/bin/SetFile -a v "$stage_app" || fail "无法清除暂存应用的 Finder 隐藏标记：$stage_app"
fi
if ! codesign --verify --deep --strict "$stage_app" >/dev/null 2>&1; then
  printf '正在为本地构建补充 ad-hoc 签名…\n'
  codesign --force --deep --sign - "$stage_app" >/dev/null 2>&1 || \
    fail "无法为暂存应用生成 ad-hoc 签名：$stage_app"
fi
codesign --verify --deep --strict --verbose=2 "$stage_app" >/dev/null 2>&1 || \
  fail "暂存应用未通过 macOS 签名校验：$stage_app"

if [ -e "$installed_app" ]; then
  mkdir -p "$backup_root"
  [ ! -e "$backup_app" ] || fail "备份目标已存在：$backup_app"
  [ ! -e "$rollback_app" ] || fail "回滚目标已存在：$rollback_app"
  if [ -e "$installed_app/Contents/MacOS/$app_binary_name" ]; then
    old_inode="$(stat -f '%i' "$installed_app/Contents/MacOS/$app_binary_name")"
  fi
  mv "$installed_app" "$rollback_app"
  old_app_moved=1
fi

mv "$stage_app" "$installed_app"
new_app_installed=1
codesign --verify --deep --strict --verbose=2 "$installed_app" >/dev/null 2>&1 || \
  fail "新安装未通过 macOS 签名校验：$installed_app"

new_inode="$(stat -f '%i' "$installed_app/Contents/MacOS/$app_binary_name")"
if [ -n "$old_inode" ] && [ "$old_inode" = "$new_inode" ]; then
  fail "新安装复用了旧可执行文件 inode，已拒绝提交"
fi
install_verified=1

if [ "$old_app_moved" -eq 1 ]; then
  if ! mv "$rollback_app" "$backup_app"; then
    old_app_moved=0
    fail "新应用已安装，但旧版本只能保留在：$rollback_app"
  fi
  old_app_moved=0
  printf '旧版本已备份：%s\n' "$backup_app"
fi

register_canonical_install
if [ -n "$replaced_build_archive" ] && [ -e "$replaced_build_archive" ]; then
  case "$replaced_build_archive" in
    "$archive_source_app".replaced-*) rm -rf -- "$replaced_build_archive" ;;
    *) fail "拒绝清理异常构建归档路径：$replaced_build_archive" ;;
  esac
fi
rmdir "$stage_root"
trap - EXIT
printf '安装完成：%s\n' "$installed_app"
