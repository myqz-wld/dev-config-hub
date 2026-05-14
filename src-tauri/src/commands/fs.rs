//! REVIEW_8 H1 + H9：所有 fs #[tauri::command] 必须 async + spawn_blocking + PathPolicy。
//!
//! ## 为什么 async + spawn_blocking
//!
//! Tauri v2 同步 #[tauri::command] 在主线程跑（webview 渲染线程），任何 fs::read /
//! fs::write 都阻塞 React 渲染。CHANGELOG_17 已经为 run_dch_command 修过一次（webview
//! 假死直到 CLI 完成才一次性渲染），AP-19 tally 升级为「Tauri v2 #[tauri::command]
//! 必须 async + spawn_blocking」（codex rescue 实证）。同样的修需要扩到 fs 类 commands ——
//! 大文件读 / 慢盘 stat 都会冻 webview。
//!
//! ## 为什么 PathPolicy
//!
//! 旧 read_file / save_file 完全没路径校验，webview 可读写任意文件（含 /etc/hosts /
//! ~/.ssh/authorized_keys / 上邻 macOS 用户家目录）。HomeOnly 一刀切覆盖所有合法用例
//! （配置文件 + dch store + profile configDir 全在 HOME 下）。
//!
//! 例外：read_file_with_mtime 给 ConfigPanel 读 ~/.zshrc 等，仍 HomeOnly；不需放宽。

use crate::path_policy::{check_path, home_dir, PathPolicy};
use serde::Serialize;
use std::fs;
use std::time::UNIX_EPOCH;

#[tauri::command]
pub async fn read_file(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        check_path(&path, PathPolicy::HomeOnly)?;
        // 用 read + from_utf8_lossy 而非 read_to_string：与 CLI 端 Bun.file.text() 行为一致。
        // Rust fs::read_to_string 严格 UTF-8，遇到非法字节直接 Err(InvalidData) — 用户的
        // ~/.zshrc 用 GBK / Latin-1 写注释（亚洲开发者偶见混用）会让 loadAllConfigs 整个 reject
        // → App 「加载失败」UI 挂死。lossy 用 U+FFFD 替换非法字节，与 CLI 行为对齐。REVIEW_2 M10。
        fs::read(&path)
            .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
            .map_err(|e| format!("{}: {}", path, e))
    })
    .await
    .map_err(|e| format!("read_file worker failed: {}", e))?
}

#[tauri::command]
pub async fn file_exists(path: String) -> bool {
    tauri::async_runtime::spawn_blocking(move || {
        // file_exists 不走 PathPolicy（只是布尔判断，无内容泄漏；前端确实需要查
        // 任意路径存在性的需求被 read_dir / read_link 严格限 HOME 隔离了）。
        std::path::Path::new(&path).exists()
    })
    .await
    .unwrap_or(false)
}

/// 单次 IPC 同时拿 exists + content + mtime。
///
/// 相比 file_exists + read_file 双 IPC（REVIEW_2 #M12 race），原子读取消除
/// 「检查存在与实际读取之间被外部改 / 删」的窗口。mtime 用于 PR-D 之后的
/// 写回 TOCTOU 校验（save 前 stat 比对 loadedMtime，不一致 → 弹「文件已外部变更」）。
///
/// **精度用 microseconds 而非 milliseconds**（REVIEW_3 R_1·C7 实证）：
/// macOS APFS 连续两次 fs::write 实测间隔 ~335 µs（< 1 ms）→ ms 精度看不出
/// 差异 → TOCTOU 漏判 sub-ms 写入。改 us 后精度足够（unix epoch us 当前 ~1.78e15
/// 远低于 JS Number 2^53 ≈ 9e15，安全到公元 ~285616 年）。
///
/// **字段契约**（REVIEW_3 R_1·C12）：本 struct 与 `src/client/bridge.ts` 中
/// `ReadFileWithMtimeResult` interface 必须**字段名 / 类型完全同步**。改 Rust
/// 端字段名时务必同步改前端 interface，否则前端 `r.mtimeUs` 静默 undefined →
/// PR-D loadedMtime 比对永远不命中 → 误报「文件已外部变更」。
///
/// UTF-8 lossy 与 read_file 一致（CLI Bun.file.text() 行为对齐，REVIEW_2 #M10）。
/// 文件不存在 / 不是 regular file 一律 `exists=false`，与现有 readFile race 兜底语义统一；
/// metadata 成功但 read 失败的罕见 race（权限改 / 并发删）会 `eprintln` 留痕便于排查
/// （REVIEW_3 R_1·C16）。
///
/// **mtime None 三种来源各自留痕**（REVIEW_3 R_2 D2）：
///   1. metadata.modified() Err（罕见 FS 不支持 mtime）
///   2. duration_since(UNIX_EPOCH) Err（pre-1970 文件，touch -t 196812310000 / rsync --times 老备份可造）
///   3. metadata 成功但 read 失败（权限改 / 并发删 race）
/// 当前合并到 `mtime_us=None`（PR-D consumer 跳过 TOCTOU）；APFS 实证场景 1/2 实质不可达
/// （u64 ns 时间戳无法表示负值），合并语义可接受。stderr 留痕方便日后从 Console.app 排查。
#[tauri::command]
pub async fn read_file_with_mtime(path: String) -> ReadFileWithMtimeResult {
    tauri::async_runtime::spawn_blocking(move || read_file_with_mtime_inner(&path))
        .await
        .unwrap_or_else(|_| ReadFileWithMtimeResult::missing())
}

fn read_file_with_mtime_inner(path: &str) -> ReadFileWithMtimeResult {
    // PathPolicy 失败时直接当文件不存在（前端 readFileWithMtime 回报 missing 走平
    // 路径 — 不对 webview 暴露 boundary error，让 boundary 像 ENOENT 一样静默跳过）。
    if check_path(path, PathPolicy::HomeOnly).is_err() {
        return ReadFileWithMtimeResult::missing();
    }
    let p = std::path::Path::new(path);
    let meta = match fs::metadata(p) {
        Ok(m) => m,
        Err(_) => return ReadFileWithMtimeResult::missing(),
    };
    if !meta.is_file() {
        return ReadFileWithMtimeResult::missing();
    }
    let mtime_us = match meta.modified() {
        Ok(t) => match t.duration_since(UNIX_EPOCH) {
            Ok(d) => Some(d.as_micros() as u64),
            Err(e) => {
                // pre-1970 文件（git checkout / rsync --times / 老备份恢复 / touch -t 19xx）
                eprintln!(
                    "read_file_with_mtime: pre-UNIX_EPOCH mtime path={} err={}",
                    path, e
                );
                None
            }
        },
        Err(e) => {
            // 罕见 FS 不支持 mtime（network mount / FUSE 等）
            eprintln!("read_file_with_mtime: modified() failed path={} err={}", path, e);
            None
        }
    };
    let content = match fs::read(p) {
        Ok(b) => String::from_utf8_lossy(&b).into_owned(),
        Err(e) => {
            // 罕见 race：metadata OK 但 read 失败（权限改 / 并发删）—— 区分日志便于排查
            eprintln!(
                "read_file_with_mtime: metadata 成功但 read 失败 path={} err={}",
                path, e
            );
            return ReadFileWithMtimeResult::missing();
        }
    };
    ReadFileWithMtimeResult { exists: true, content, mtime_us }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileWithMtimeResult {
    pub exists: bool,
    pub content: String,
    /// Unix epoch microseconds；不存在 / 拿不到 mtime 为 null。
    /// 改 ms→us 见 REVIEW_3 R_1·C7（APFS sub-ms 写间隔会让 ms 精度漏判）。
    pub mtime_us: Option<u64>,
}

impl ReadFileWithMtimeResult {
    fn missing() -> Self {
        Self { exists: false, content: String::new(), mtime_us: None }
    }
}

/// **DEPRECATED**：新代码用 `save_file_if_mtime`（atomic write + mtime CAS，REVIEW_8 H7）。
/// 本接口保留给前端过渡期 caller（暂未切换到 mtime CAS 的路径）—— 但仍走 atomic write
/// + PathPolicy，杜绝半文件 + 任意路径写。
#[tauri::command]
pub async fn save_file(path: String, content: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        check_path(&path, PathPolicy::HomeOnly)?;
        let p = std::path::Path::new(&path);
        // 走原子 write 而非 fs::write 防 crash 留半文件；不传 expected_mtime → 跳过 CAS。
        crate::atomic::write_atomic_check_mtime(p, &content, None).map(|_| ())
    })
    .await
    .map_err(|e| format!("save_file worker failed: {}", e))?
}

#[tauri::command]
pub async fn get_home_dir() -> String {
    home_dir()
}

#[derive(Serialize)]
pub struct DirEntryView {
    name: String,
    #[serde(rename = "isFile")]
    is_file: bool,
}

/// 读目录下文件列表（name + isFile）。
///
/// **安全边界**：拒绝任何不在 `$HOME` 下的路径（PathPolicy::HomeOnly）。webview 不应
/// 能列任意目录（避免泄漏 PII / 系统结构）。
///
/// **不存在的目录返回空 Vec**（不当 error） —— 自定义 schema 目录 `~/.dch/schemas/`
/// 通常用户没建过，要求文件不存在不报错让 caller 路径更平。
///
/// **非目录** / **权限不足** / **其他 IO 错误** → Err，由 caller 决定是 warn 还是 fatal。
#[tauri::command]
pub async fn read_dir(path: String) -> Result<Vec<DirEntryView>, String> {
    tauri::async_runtime::spawn_blocking(move || read_dir_inner(&path))
        .await
        .map_err(|e| format!("read_dir worker failed: {}", e))?
}

fn read_dir_inner(path: &str) -> Result<Vec<DirEntryView>, String> {
    check_path(path, PathPolicy::HomeOnly)?;
    let p = std::path::Path::new(path);
    let entries = match fs::read_dir(p) {
        Ok(it) => it,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("{}: {}", path, e)),
    };

    let mut out = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        // 跳过隐藏 dotfiles（除 caller 显式想要 — 当前用例 ~/.dch/schemas/*.json 不会有 dotfile）
        if name.starts_with('.') {
            continue;
        }
        let is_file = entry.file_type().map(|t| t.is_file()).unwrap_or(false);
        out.push(DirEntryView { name, is_file });
    }
    Ok(out)
}

/// 读 symlink 的目标。仅允许 HOME 下路径（PathPolicy::HomeOnly）。
///
/// **行为对齐 CLI** (`src/profiles/symlink.ts:150 currentSymlinkTarget`)：
/// - 单层 `read_link`，不 deref 链式 symlink；与 CLI `readlink(target)` 一致
/// - 相对 link → 解析为绝对（参照 `symlink.ts:154` join(dirname(target), t)）
/// - 不是 symlink / 不存在 / IO 错 → `Ok(None)`，与 CLI `pathState() != "symlink"` 一致
///
/// **为什么所有失败都吞成 Ok(None)**：前端 `loadProfileDataDirect` 用 `Promise.all`
/// 并发拿 `~/.claude` `~/.codex` 两个 link target；若 IO 错 reject，整组 fail →
/// UI 进「读 profile 失败」 toast，体感比 CLI 路径退化（CLI 直接回 null + UI 显示
/// "(非 symlink)"）。把所有错合并成 None 让前端 fallback 平滑。
///
/// **HOME boundary** 保留 Err，因为这是程序 bug（前端不该传 HOME 外路径），
/// 应该让前端开发者立刻看到错误而非静默退化。
#[tauri::command]
pub async fn read_link(path: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = home_dir();
        if home.is_empty() {
            return Err("HOME 未设置".to_string());
        }
        read_link_inner(&path, &home)
    })
    .await
    .map_err(|e| format!("read_link worker failed: {}", e))?
}

/// pure helper：接收 home 不读 env，方便单测在并发 cargo test 下不被 env 改污染。
pub(crate) fn read_link_inner(path: &str, home: &str) -> Result<Option<String>, String> {
    let p = std::path::Path::new(path);
    let home_p = std::path::Path::new(home);
    if !(p == home_p || p.starts_with(home_p)) {
        return Err(format!("拒绝读非 HOME 路径: {}", path));
    }
    let meta = match fs::symlink_metadata(p) {
        Ok(m) => m,
        Err(_) => return Ok(None),
    };
    if !meta.file_type().is_symlink() {
        return Ok(None);
    }
    let t = match fs::read_link(p) {
        Ok(t) => t,
        Err(_) => return Ok(None),
    };
    let abs = if t.is_absolute() {
        t
    } else {
        p.parent().map(|d| d.join(&t)).unwrap_or(t)
    };
    Ok(Some(abs.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// CHANGELOG_15: read_link_inner 测试。直接传 home 不 set env，
    /// 避免 cargo test 默认多线程下 HOME 被并发改污染（先 set 后被覆盖 → starts_with 失败）。
    /// Win 不跑（应用 macOS-only）。
    #[cfg(unix)]
    #[test]
    fn read_link_returns_target_for_symlink() {
        let tmp = std::env::temp_dir().join(format!("dch-rl-test-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let target = tmp.join("real");
        std::fs::write(&target, "hi").unwrap();
        let link = tmp.join("alias");
        let _ = std::fs::remove_file(&link);
        std::os::unix::fs::symlink(&target, &link).unwrap();

        let r = read_link_inner(&link.to_string_lossy(), &tmp.to_string_lossy()).unwrap();
        assert_eq!(r.as_deref(), Some(target.to_string_lossy().as_ref()));

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[cfg(unix)]
    #[test]
    fn read_link_returns_none_for_non_symlink() {
        let tmp = std::env::temp_dir().join(format!("dch-rl-test2-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let plain = tmp.join("plain");
        std::fs::write(&plain, "hi").unwrap();

        let r = read_link_inner(&plain.to_string_lossy(), &tmp.to_string_lossy()).unwrap();
        assert_eq!(r, None);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[cfg(unix)]
    #[test]
    fn read_link_returns_none_for_missing_path() {
        let tmp = std::env::temp_dir().join(format!("dch-rl-test3-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();

        let r = read_link_inner(
            &tmp.join("nonexistent").to_string_lossy(),
            &tmp.to_string_lossy(),
        )
        .unwrap();
        assert_eq!(r, None);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[cfg(unix)]
    #[test]
    fn read_link_rejects_path_outside_home() {
        let tmp = std::env::temp_dir().join(format!("dch-rl-test4-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();

        // HOME 设到子目录 → /etc/passwd 必然在外
        let r = read_link_inner("/etc/passwd", &tmp.to_string_lossy());
        assert!(r.is_err(), "应拒绝 HOME 外路径");
        assert!(r.unwrap_err().contains("拒绝"));

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[cfg(unix)]
    #[test]
    fn read_link_relative_target_resolved_to_absolute() {
        let tmp = std::env::temp_dir().join(format!("dch-rl-test5-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let target = tmp.join("real");
        std::fs::write(&target, "hi").unwrap();
        let link = tmp.join("alias");
        let _ = std::fs::remove_file(&link);
        // 相对 link target = "real"（同目录）
        std::os::unix::fs::symlink("real", &link).unwrap();

        let r = read_link_inner(&link.to_string_lossy(), &tmp.to_string_lossy()).unwrap();
        // 应被 join(parent, "real") 解析成绝对
        assert_eq!(r.as_deref(), Some(target.to_string_lossy().as_ref()));

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
