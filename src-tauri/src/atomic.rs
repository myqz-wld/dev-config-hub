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

use crate::path_policy::{check_path, PathPolicy};
use std::fs;
use std::io::ErrorKind;
use std::path::Path;
use std::time::UNIX_EPOCH;

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

    // tmp 必须同目录（跨 fs rename ENOENT/EXDEV）。pid 避免并发 save 撞车。
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file");
    let tmp_name = format!(".{}.dch-tmp-{}", file_name, std::process::id());
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
#[tauri::command]
pub async fn save_file_if_mtime(
    path: String,
    content: String,
    expected_mtime_us: Option<u64>,
) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        check_path(&path, PathPolicy::HomeOnly)?;
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
}
