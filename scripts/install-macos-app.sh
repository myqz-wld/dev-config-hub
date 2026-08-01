#!/usr/bin/env bash

set -euo pipefail

app_bundle_name="Dev Config Hub.app"
app_binary_name="dev-config-hub"
script_dir="$(cd "$(dirname "$0")" && pwd -P)"
repo_root="$(cd "$script_dir/.." && pwd -P)"

source_app="${DCH_INSTALL_SOURCE_APP:-$repo_root/src-tauri/target/release/bundle/macos/$app_bundle_name}"
installed_app="${DCH_INSTALL_DESTINATION_APP:-/Applications/$app_bundle_name}"
backup_root="${DCH_INSTALL_BACKUP_ROOT:-$HOME/Library/Application Support/Dev Config Hub/Install Backups}"

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

[ "$(uname -s)" = "Darwin" ] || fail "此安装器仅支持 macOS"

for required_command in basename codesign date dirname ditto mkdir mktemp mv pgrep plutil ps rmdir stat uname; do
  require_command "$required_command"
done

require_absolute_path "构建产物" "$source_app"
require_absolute_path "安装目标" "$installed_app"
require_absolute_path "备份目录" "$backup_root"

[ "$(basename "$installed_app")" = "$app_bundle_name" ] || \
  fail "安装目标必须以 $app_bundle_name 结尾"
[ "$source_app" != "$installed_app" ] || fail "构建产物与安装目标不能是同一路径"
[ -d "$source_app" ] || fail "找不到构建产物：$source_app；请先运行 bunx tauri build --bundles app"
[ ! -L "$source_app" ] || fail "构建产物不能是符号链接：$source_app"
[ -x "$source_app/Contents/MacOS/$app_binary_name" ] || \
  fail "构建产物缺少可执行文件：$source_app/Contents/MacOS/$app_binary_name"
bundle_identifier="$(plutil -extract CFBundleIdentifier raw -o - "$source_app/Contents/Info.plist" 2>/dev/null || true)"
[ "$bundle_identifier" = "com.dch.devconfighub" ] || \
  fail "构建产物的 bundle identifier 不正确：${bundle_identifier:-未找到}"

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

timestamp="$(date '+%Y%m%d-%H%M%S')"
stage_root="$(mktemp -d "$destination_parent/.dch-install.XXXXXX")"
stage_app="$stage_root/$app_bundle_name"
rollback_app="$destination_parent/.dch-rollback-$timestamp-$$.app"
backup_app="$backup_root/Dev Config Hub-$timestamp-$$.app"
old_app_moved=0
new_app_installed=0
install_verified=0
old_inode=""

restore_previous_install() {
  local exit_code="$?"

  trap - EXIT
  if [ "$exit_code" -ne 0 ] && [ "$install_verified" -eq 0 ] && \
      [ "$new_app_installed" -eq 1 ] && [ -e "$installed_app" ]; then
    if mv "$installed_app" "$stage_root/Dev Config Hub.failed.app"; then
      printf '未通过验证的新安装保留在：%s\n' "$stage_root/Dev Config Hub.failed.app" >&2
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

rmdir "$stage_root"
trap - EXIT
printf '安装完成：%s\n' "$installed_app"
