//! REVIEW_8 H9：所有 #[tauri::command] fs 操作显式声明边界策略。
//!
//! 之前 read_file / save_file / read_file_with_mtime 没有任何路径校验，webview 可读
//! 写任意文件（含 /etc/hosts / ~/.ssh/authorized_keys 等系统资产）。把策略集中
//! 到一个 enum，新加 fs command 时漏校验会立刻看出来。
//!
//! - HomeOnly：必须在 $HOME 下（含 $HOME 本身）—— 覆盖 settings.json / .zshrc /
//!   profile configDir / dch backups 等所有用户配置面
//! - DchStoreOnly：仅 ~/.dch 下 —— atomic save_file_if_mtime 给 profiles.json 用
//!
//! `..` 段一律拒（avoid `~/foo/../../etc/passwd` 绕过 starts_with）。symlink walk
//! 不在本层处理（backup.ts H2 walkFiles 单独处理 dir symlink）—— 这里只做
//! 字符串/组件级校验，不解析 symlink。

use std::path::{Component, Path};

#[derive(Debug, Clone, Copy)]
pub enum PathPolicy {
    /// 必须在 $HOME 下（含 $HOME 本身）。
    HomeOnly,
    /// 必须在 $HOME/.dch 下（atomic store write）。
    #[allow(dead_code)] // 预留给 atomic save_file_if_mtime 后续 lock down 时启用
    DchStoreOnly,
}

/// 跨平台 home dir 解析（与原 lib.rs::get_home_dir 同源，单一 SSOT）。
pub fn home_dir() -> String {
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_default()
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME").unwrap_or_default()
    }
}

/// 校验 `path` 是否符合 `policy`。Err 时 caller 直接 reject Tauri command。
///
/// 规则：
/// 1. path 非空
/// 2. **拒含 `..` 段**（任何组件等于 `..` 即拒，跨平台用 `Component::ParentDir` 判定）
/// 3. HOME 必须非空（HOME 未设直接 reject，不允许 fallback 到无校验）
/// 4. `Path::starts_with` 走组件比对，不是字符串前缀（避免 `~foo` 误中）
pub fn check_path(path: &str, policy: PathPolicy) -> Result<(), String> {
    if path.is_empty() {
        return Err("路径不能为空".to_string());
    }
    let p = Path::new(path);
    if p.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(format!("拒绝含 '..' 的路径: {}", path));
    }

    let home = home_dir();
    if home.is_empty() {
        return Err("HOME 未设置".to_string());
    }
    let home_p = Path::new(&home);

    match policy {
        PathPolicy::HomeOnly => {
            if p == home_p || p.starts_with(home_p) {
                Ok(())
            } else {
                Err(format!("拒绝非 HOME 路径: {}", path))
            }
        }
        PathPolicy::DchStoreOnly => {
            let dch = home_p.join(".dch");
            if p.starts_with(&dch) {
                Ok(())
            } else {
                Err(format!("拒绝非 ~/.dch 路径: {}", path))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with_home<R>(home: &str, f: impl FnOnce() -> R) -> R {
        // 注意：cargo test 默认多线程，env 改是进程级 → 测内 env 改不安全。
        // 这些 test 仅当 cargo test -- --test-threads=1 时可靠；CI 配单线程。
        let prev = std::env::var("HOME").ok();
        std::env::set_var("HOME", home);
        let r = f();
        match prev {
            Some(v) => std::env::set_var("HOME", v),
            None => std::env::remove_var("HOME"),
        }
        r
    }

    #[test]
    fn rejects_parent_dir_segment() {
        with_home("/Users/test", || {
            assert!(check_path("/Users/test/../etc/passwd", PathPolicy::HomeOnly).is_err());
            assert!(check_path("/Users/test/foo/../../etc", PathPolicy::HomeOnly).is_err());
        });
    }

    #[test]
    fn rejects_outside_home() {
        with_home("/Users/test", || {
            assert!(check_path("/etc/hosts", PathPolicy::HomeOnly).is_err());
            assert!(check_path("/Users/other/.ssh/id_rsa", PathPolicy::HomeOnly).is_err());
        });
    }

    #[test]
    fn rejects_lookalike_prefix() {
        with_home("/Users/test", || {
            // /Users/testfoo 字符串前缀像 /Users/test，但组件级 starts_with 应拒
            assert!(check_path("/Users/testfoo/x", PathPolicy::HomeOnly).is_err());
        });
    }

    #[test]
    fn accepts_home_root_and_subpath() {
        with_home("/Users/test", || {
            assert!(check_path("/Users/test", PathPolicy::HomeOnly).is_ok());
            assert!(check_path("/Users/test/.zshrc", PathPolicy::HomeOnly).is_ok());
            assert!(check_path("/Users/test/.claude/settings.json", PathPolicy::HomeOnly).is_ok());
        });
    }

    #[test]
    fn dch_store_only_blocks_outside_dch() {
        with_home("/Users/test", || {
            assert!(check_path("/Users/test/.zshrc", PathPolicy::DchStoreOnly).is_err());
            assert!(check_path("/Users/test/.dch/profiles.json", PathPolicy::DchStoreOnly).is_ok());
            assert!(check_path("/Users/test/.dch/backups/x.dchpack", PathPolicy::DchStoreOnly).is_ok());
        });
    }

    #[test]
    fn empty_path_rejected() {
        with_home("/Users/test", || {
            assert!(check_path("", PathPolicy::HomeOnly).is_err());
        });
    }

    #[test]
    fn home_unset_rejected() {
        with_home("", || {
            assert!(check_path("/Users/test/.zshrc", PathPolicy::HomeOnly).is_err());
        });
    }
}
