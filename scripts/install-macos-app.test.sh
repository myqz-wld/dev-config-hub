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
historical_root="$test_root/existing-history"
binary_path="$destination_app/Contents/MacOS/dev-config-hub"

cleanup() {
  case "$test_root" in
    "$test_parent"/dch-installer-test.*) rm -rf "$test_root" ;;
    *) printf '拒绝清理异常测试路径：%s\n' "$test_root" >&2 ;;
  esac
}
trap cleanup EXIT

fail_test() { printf '安装器测试失败：%s\n' "$1" >&2; exit 1; }
assert_clean_success() {
  [ "$(find "$test_root/destination" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" = 1 ] || \
    fail_test '成功后仍留有暂存或回滚副本。'
  [ "$(find "$test_root/source" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" = 1 ] || \
    fail_test '成功后构建归档未清理。'
  [ ! -e "$source_app" ] || fail_test '可发现的 .app 构建产物仍然存在。'
  [ -d "$source_archive" ] || fail_test '非 App 构建归档不存在。'
  [ -f "$historical_root/Legacy Dev Config Hub.app/keep" ] || fail_test '已有旧式副本被修改。'
  [ -f "$historical_root/Older.app-backup/keep" ] || fail_test '已有历史副本被修改。'
  [ "$(find "$historical_root" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" = 2 ] || \
    fail_test '创建或迁移了长期副本。'
  codesign --verify --deep --strict "$destination_app"
}

mkdir -p "$source_app/Contents/MacOS" "$test_root/destination" \
  "$historical_root/Legacy Dev Config Hub.app" "$historical_root/Older.app-backup"
printf 'preserve\n' > "$historical_root/Legacy Dev Config Hub.app/keep"
printf 'preserve\n' > "$historical_root/Older.app-backup/keep"
printf '#!/bin/sh\nexit 0\n' > "$source_app/Contents/MacOS/dev-config-hub"
chmod 755 "$source_app/Contents/MacOS/dev-config-hub"
plutil -create xml1 "$source_app/Contents/Info.plist"
plutil -insert CFBundleIdentifier -string com.dch.devconfighub "$source_app/Contents/Info.plist"
plutil -insert CFBundleExecutable -string dev-config-hub "$source_app/Contents/Info.plist"
plutil -insert CFBundleName -string 'Dev Config Hub' "$source_app/Contents/Info.plist"
plutil -insert CFBundlePackageType -string APPL "$source_app/Contents/Info.plist"

run_install() {
  DCH_INSTALL_SOURCE_APP="${1:-$source_app}" \
  DCH_INSTALL_ARCHIVE_SOURCE_APP="${2-$source_archive}" \
  DCH_INSTALL_DESTINATION_APP="$destination_app" \
  DCH_INSTALL_BACKUP_ROOT="$historical_root" \
  DCH_INSTALL_LAUNCH_SERVICES_TOOL=/usr/bin/true \
    bash "$script_dir/install-macos-app.sh"
}

run_install
first_inode="$(stat -f '%i' "$binary_path")"
assert_clean_success
ditto "$source_archive" "$source_app"
run_install
second_inode="$(stat -f '%i' "$binary_path")"
[ "$first_inode" != "$second_inode" ] || fail_test '连续安装复用了可执行文件 inode。'
assert_clean_success
run_install "$source_archive" ''
third_inode="$(stat -f '%i' "$binary_path")"
[ "$second_inode" != "$third_inode" ] || fail_test '重用 .app-build 时没有替换 inode。'
assert_clean_success

# Inject an installed-signature failure after replacement; staging still verifies.
ditto "$source_archive" "$source_app"
mkdir -p "$test_root/fail-verify"
cat > "$test_root/fail-verify/codesign" <<'WRAPPER'
#!/usr/bin/env bash
for arg in "$@"; do
  if [ "$arg" = "$DCH_TEST_DESTINATION" ]; then exit 1; fi
done
exec /usr/bin/codesign "$@"
WRAPPER
chmod 755 "$test_root/fail-verify/codesign"
if DCH_TEST_DESTINATION="$destination_app" PATH="$test_root/fail-verify:$PATH" run_install > "$test_root/failure.log" 2>&1; then
  fail_test '签名校验失败却报告安装成功。'
fi
[ "$(stat -f '%i' "$binary_path")" = "$third_inode" ] || fail_test '签名失败没有恢复原安装 inode。'
codesign --verify --deep --strict "$destination_app"
[ -d "$source_app" ] || fail_test '失败时原构建产物被移走。'
[ "$(find "$test_root/destination" -name '*.app-rollback' | wc -l | tr -d ' ')" = 0 ] || \
  fail_test '恢复成功后仍残留旧安装临时副本。'

# Simulate the exact destination running without starting or stopping user apps.
mkdir -p "$test_root/running"
cat > "$test_root/running/pgrep" <<'WRAPPER'
#!/bin/sh
printf '77777\n'
WRAPPER
cat > "$test_root/running/ps" <<'WRAPPER'
#!/bin/sh
printf '%s\n' "$DCH_TEST_BINARY"
WRAPPER
chmod 755 "$test_root/running/pgrep" "$test_root/running/ps"
if DCH_TEST_BINARY="$binary_path" PATH="$test_root/running:$PATH" run_install > "$test_root/running.log" 2>&1; then
  fail_test '正在运行的安装目标未被拒绝。'
fi
[ "$(stat -f '%i' "$binary_path")" = "$third_inode" ] || fail_test '拒绝运行中目标时修改了旧安装。'
[ "$(cat "$historical_root/Legacy Dev Config Hub.app/keep")" = preserve ] || fail_test '历史目录内容改变。'
printf 'macOS 安装器测试通过：成功清理、失败回滚、归档重用、运行中拒绝、历史副本保留。\n'
