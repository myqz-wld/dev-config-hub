//! REVIEW_8 H7：原子写 + mtime CAS（compare-and-swap）。
//!
//! 旧 `save_file` 直接 `fs::write` 没做：
//! 1. atomicity（写到一半 crash 留半文件 → JSON.parse 全炸）
//! 2. TOCTOU 校验（前端 enter-edit 拿 mtime，背地里 CLI / 外部编辑器改了，前端 save
//!    一脚踩翻 → 用户的外部修改静默丢）
//!
//! 本模块：
//! - `write_atomic_check_mtime(path, content, expected_mtime_us)` 内部 helper
//! - `save_file_if_mtime` Tauri command 给前端走（透传 expected_mtime_us）
//!
//! ## atomic 实现
//!
//! `write tmp + rename` —— POSIX rename(2) 原子（同 fs 内）。tmp 文件名带 pid 避免
//! 并发 save 撞车（不同进程 / 不同窗口）。tmp 必须与 path 同目录（跨 fs rename ENOENT
//! / EXDEV）。
//!
//! ## mtime CAS
//!
//! caller 传 `expected_mtime_us = Some(N)`：写前 stat 取 actual，不一致 → Err，错误串
//! 头标 `MTIME_MISMATCH:<expected>:<actual>` 让前端 parse 出 banner。文件不存在但
//! caller 期望存在 → `MTIME_MISSING:<expected>`。caller 传 `None` → 跳过 CAS（首次创建
//! / caller 显式不 care）。
//!
//! 写完返回新 mtime（us 精度），让前端更新 loadedMtime 不需再发 readFileWithMtime。
//!
//! ## TOCTOU 残留窗口
//!
//! stat → write tmp → rename 之间仍有 µs 级窗口让外部进程修改 path。本应用是单
//! 用户单 GUI（webview 单线程 + CLI 偶发并发），残留窗口不重要 —— 主要防的是
//! "前端读 mtime 后过几秒/几分钟才 save" 这种秒级/分钟级 TOCTOU。

use crate::path_policy::{check_path_for_write, PathPolicy};
use std::fs;
use std::io::ErrorKind;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// REVIEW_8 R2 R2-1 / R3 G3：tmp_name 唯一性。
///
/// 旧实现 `format!(".{}.dch-tmp-{}", file_name, std::process::id())` 仅 PID 区分，
/// Tauri spawn_blocking worker pool 多线程并发同 path 调 `save_file_if_mtime` 时：
/// - 同 PID + 同 file_name → 拼出**完全相同** tmp_name
/// - 第二个 thread 的 `fs::write` 覆盖第一个 thread 的 tmp 内容
/// - 第一个 thread 的 `fs::rename(&tmp, path)` 已成功取走 tmp → 第二个 thread `fs::rename` ENOENT
/// - 即便都 rename 成功，最终内容 = 「最后赢的 thread」，其他 thread caller 拿到 OK 但写入实际丢失
///   → **silent data corruption**
///
/// 修：tmp_name 加 (a) 当前时间 nanos、(b) module-level AtomicU64 counter。两个加在一起保证
/// 同进程任意 thread 调用任意次数 tmp_name 都唯一。counter 用 Relaxed 序（仅要求唯一不要求
/// 跨 thread happens-before），fetch_add 是原子 CAS 不会撞。
///
/// **REVIEW_9 C-LOW-1 / C 双方独立**: pub(crate) 让 dch.rs run_dch_with_secrets_temp 复用
/// 同款 unique 算法,消除 R1 G4 清单说"已抽 tmp_name helper 实际没做"的债。dch.rs 旧
/// 实现 `format!("dch-secrets-{}-{}.json", pid, nanos)` 缺 AtomicU64 counter,同进程多
/// thread 并发同 nanos 时撞名(罕见但 thread pool 唤醒时序极端可达,且 secret 写穿 race
/// 是数据正确性问题不是性能问题)。
static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

pub(crate) fn unique_tmp_suffix() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u128)
        .unwrap_or(0);
    let cnt = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{}-{}-{}", std::process::id(), nanos, cnt)
}

/// 把 metadata 转成 unix epoch microseconds。失败 / pre-1970 → None。
fn meta_to_mtime_us(meta: &fs::Metadata) -> Option<u64> {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_micros() as u64)
}

/// 取 path 当前 mtime（us）。文件不存在 → Ok(None)；其他 IO 错 → Err。
fn current_mtime_us(path: &Path) -> Result<Option<u64>, String> {
    match fs::metadata(path) {
        Ok(m) => Ok(meta_to_mtime_us(&m)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("stat 失败 {}: {}", path.display(), e)),
    }
}

/// 写 tmp + rename 实现原子写；带可选 mtime CAS。
///
/// 返回写完后新 mtime（us）。CAS 失败用错误串前缀传给前端：
/// - `MTIME_MISMATCH:<expected>:<actual>` —— 文件被外部修改
/// - `MTIME_MISSING:<expected>` —— caller 期望存在但已被删
pub fn write_atomic_check_mtime(
    path: &Path,
    content: &str,
    expected_mtime_us: Option<u64>,
) -> Result<u64, String> {
    if let Some(expected) = expected_mtime_us {
        match current_mtime_us(path)? {
            Some(actual) if actual != expected => {
                return Err(format!("MTIME_MISMATCH:{}:{}", expected, actual));
            }
            None => {
                return Err(format!("MTIME_MISSING:{}", expected));
            }
            _ => {} // mtime 一致，继续
        }
    }

    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("mkdir {}: {}", parent.display(), e))?;
        }
    }

    // tmp 必须同目录（跨 fs rename ENOENT/EXDEV）。R2-1 / G3：tmp_name 用 pid + nanos +
    // atomic counter 保证同进程多 thread 并发同 path 也唯一。
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file");
    let tmp_name = format!(".{}.dch-tmp-{}", file_name, unique_tmp_suffix());
    let tmp = path.with_file_name(&tmp_name);

    fs::write(&tmp, content).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("写 tmp 失败 {}: {}", tmp.display(), e)
    })?;

    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("rename 失败 {} -> {}: {}", tmp.display(), path.display(), e)
    })?;

    // 拿写后 mtime 给前端更新 loadedMtime（避免再发 readFileWithMtime）
    Ok(fs::metadata(path)
        .ok()
        .and_then(|m| meta_to_mtime_us(&m))
        .unwrap_or(0))
}

/// Tauri command：原子写 + mtime CAS。失败串前缀 `MTIME_MISMATCH` / `MTIME_MISSING`
/// 让前端解析出 banner（"文件已外部修改"）让用户决定 reload / overwrite。
///
/// **必须 async + spawn_blocking**（Tauri v2 同步 #[tauri::command] 在主线程跑会冻 webview
/// — tally AP-19 / CHANGELOG_17）。
///
/// **REVIEW_9 C-HIGH-2 / C-codex H2 + C-claude 反驳同意 + 端到端 PoC 写穿**: 用
/// `check_path_for_write` 替代 lexical `check_path`,与 commands/fs.rs:164 save_file 对齐。
/// 旧 lexical 让 `$HOME/symlink-to-tmp/x` 通过(字符串前缀符合 HOME)→ rename 真去写,
/// 文件落到 /tmp/outside-victim/ 写穿 HOME 边界。check_path_for_write 把 parent
/// canonicalize 后再 boundary check,parent 是 symlink 出 HOME 立即拒。同时保留
/// "parent 不存在 fall back lexical"的 caller 友好行为(新建配置文件正常)。
#[tauri::command]
pub async fn save_file_if_mtime(
    path: String,
    content: String,
    expected_mtime_us: Option<u64>,
) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        check_path_for_write(&path, PathPolicy::KnownConfigFile)?;
        let p = Path::new(&path);
        write_atomic_check_mtime(p, &content, expected_mtime_us)
    })
    .await
    .map_err(|e| format!("save_file_if_mtime worker failed: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_when_no_expected_mtime() {
        let tmp = std::env::temp_dir().join(format!("dch-atomic-test-{}", std::process::id()));
        let _ = fs::create_dir_all(&tmp);
        let target = tmp.join("file.json");
        let _ = fs::remove_file(&target);

        let mtime = write_atomic_check_mtime(&target, "{\"a\":1}", None).unwrap();
        assert!(mtime > 0);
        assert_eq!(fs::read_to_string(&target).unwrap(), "{\"a\":1}");

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn rejects_mismatch_mtime() {
        let tmp = std::env::temp_dir().join(format!("dch-atomic-test2-{}", std::process::id()));
        let _ = fs::create_dir_all(&tmp);
        let target = tmp.join("file.json");
        fs::write(&target, "v1").unwrap();
        let actual = current_mtime_us(&target).unwrap().unwrap();

        // expected != actual → MTIME_MISMATCH
        let r = write_atomic_check_mtime(&target, "v2", Some(actual.wrapping_sub(1000)));
        assert!(r.is_err());
        let err = r.unwrap_err();
        assert!(err.starts_with("MTIME_MISMATCH:"), "got: {}", err);

        // 内容不应变
        assert_eq!(fs::read_to_string(&target).unwrap(), "v1");
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn writes_when_mtime_matches() {
        let tmp = std::env::temp_dir().join(format!("dch-atomic-test3-{}", std::process::id()));
        let _ = fs::create_dir_all(&tmp);
        let target = tmp.join("file.json");
        fs::write(&target, "v1").unwrap();
        let actual = current_mtime_us(&target).unwrap().unwrap();

        let new_mtime = write_atomic_check_mtime(&target, "v2", Some(actual)).unwrap();
        assert!(new_mtime >= actual);
        assert_eq!(fs::read_to_string(&target).unwrap(), "v2");
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn missing_when_caller_expected_existing() {
        let tmp = std::env::temp_dir().join(format!("dch-atomic-test4-{}", std::process::id()));
        let _ = fs::create_dir_all(&tmp);
        let target = tmp.join("nonexistent.json");

        let r = write_atomic_check_mtime(&target, "v", Some(123));
        assert!(r.is_err());
        let err = r.unwrap_err();
        assert!(err.starts_with("MTIME_MISSING:"), "got: {}", err);
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn no_tmp_left_after_success() {
        let tmp = std::env::temp_dir().join(format!("dch-atomic-test5-{}", std::process::id()));
        let _ = fs::create_dir_all(&tmp);
        let target = tmp.join("file.json");
        write_atomic_check_mtime(&target, "v1", None).unwrap();

        // 同目录不应有 .file.json.dch-tmp-* 残留
        let entries: Vec<_> = fs::read_dir(&tmp)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.contains("dch-tmp"))
            .collect();
        assert!(entries.is_empty(), "tmp 残留: {:?}", entries);
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn parent_mkdir_on_write() {
        let tmp = std::env::temp_dir().join(format!("dch-atomic-test6-{}", std::process::id()));
        let _ = fs::create_dir_all(&tmp);
        let nested = tmp.join("a/b/c/file.json");

        write_atomic_check_mtime(&nested, "x", None).unwrap();
        assert_eq!(fs::read_to_string(&nested).unwrap(), "x");
        let _ = fs::remove_dir_all(&tmp);
    }

    /// REVIEW_8 R2 R2-1 / R3 G3：tmp_name 唯一性回归测试。
    ///
    /// 旧实现 `format!(".{}.dch-tmp-{}", file_name, std::process::id())` 同进程多线程并发同
    /// path 撞 tmp（B-codex + B-claude 双方独立提出，B-claude 实测 20 thread 18/20 fail）。
    /// G3 修：tmp_name = pid + nanos + AtomicU64 counter 保证唯一。
    ///
    /// 本测试用 16 thread 并发写不同 content 到同一 path：
    /// - 旧实现：~80%+ thread 报 rename ENOENT 失败 / 内容被覆盖
    /// - 新实现：所有 thread 都 rename 成功（最终内容是 last-writer-win，但都不报错）
    #[test]
    fn concurrent_writes_same_path_no_tmp_collision() {
        use std::sync::Arc;
        use std::thread;
        let tmp = std::env::temp_dir().join(format!("dch-atomic-concurrent-{}", std::process::id()));
        let _ = fs::create_dir_all(&tmp);
        let target = Arc::new(tmp.join("file.json"));
        let _ = fs::remove_file(target.as_path());
        // 先建文件让 mtime CAS skip 时仍 rename 成功
        fs::write(target.as_path(), "init").unwrap();

        let mut handles = Vec::new();
        for i in 0..16 {
            let t = Arc::clone(&target);
            handles.push(thread::spawn(move || {
                let content = format!("thread-{}-content", i);
                write_atomic_check_mtime(&t, &content, None)
            }));
        }
        let mut ok_count = 0;
        let mut err_count = 0;
        let mut errors: Vec<String> = Vec::new();
        for h in handles {
            match h.join().unwrap() {
                Ok(_) => ok_count += 1,
                Err(e) => {
                    err_count += 1;
                    errors.push(e);
                }
            }
        }
        assert_eq!(
            err_count, 0,
            "concurrent write 出 {} 个失败（tmp 撞名 race 回归？）: {:?}",
            err_count, errors
        );
        assert_eq!(ok_count, 16, "应 16 个 thread 全成功");

        // 同目录验 .dch-tmp-* 全清理（不留 race-condition-stranded tmp）
        let stranded: Vec<_> = fs::read_dir(&tmp)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.contains("dch-tmp"))
            .collect();
        assert!(
            stranded.is_empty(),
            "并发写后残留 tmp 文件: {:?}",
            stranded
        );

        let _ = fs::remove_dir_all(&tmp);
    }

    /// REVIEW_8 R3 G7 / B-claude-L2：rename 失败时 tmp 必须已清理（避免逐次失败积累 stranded tmp）。
    ///
    /// 触发 rename 失败：dst 是非空 dir → fs::rename 报 ENOTEMPTY / EISDIR
    #[test]
    fn no_tmp_left_after_rename_failure() {
        let tmp = std::env::temp_dir().join(format!("dch-atomic-rename-fail-{}", std::process::id()));
        let _ = fs::create_dir_all(&tmp);
        let dst_dir = tmp.join("not-a-file");
        let _ = fs::create_dir_all(&dst_dir);
        // 在 dst_dir 下放一个文件，让 dst_dir 非空 → fs::rename(tmp_file, dst_dir) 失败
        fs::write(dst_dir.join("filler"), "x").unwrap();

        let r = write_atomic_check_mtime(&dst_dir, "should fail", None);
        assert!(r.is_err(), "rename 到非空 dir 应失败");

        // 验证同目录无 .dch-tmp-* 残留
        let entries: Vec<_> = fs::read_dir(&tmp)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.contains("dch-tmp"))
            .collect();
        assert!(entries.is_empty(), "rename 失败后 tmp 残留: {:?}", entries);

        let _ = fs::remove_dir_all(&tmp);
    }
}
