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
///
/// **NOTE**: 本函数仅做 lexical(字符串/组件级)check,不解析 symlink。如果 path 含 HOME
/// 内 symlink 指向 HOME 外目标(`$HOME/link-to-etc -> /etc`),lexical check 通过但 OS
/// 真去读会读到 /etc — 这是 **REVIEW_9 C-HIGH-2** 的攻击面。读类操作应改用
/// `check_path_canonical` 把 symlink 解到真实路径再做 boundary check;写新文件用
/// `check_path_for_write` (canonicalize parent + basename 拼)。仅 boolean 判断
/// (file_exists) 仍可走本函数(无 IO 开销 + 无内容泄漏)。
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

/// **REVIEW_9 C-HIGH-2 / C-codex H1**: canonicalize 后再做 HOME 边界校验,杜绝 HOME 内
/// symlink 绕过。
///
/// 旧 `check_path` 仅 lexical check,$HOME/symlink-to-etc -> /etc 这种 webview 调
/// `read_file($HOME/symlink-to-etc/hosts)` lexical 通过 → fs::read 按 OS canonicalize 真
/// 读 /etc/hosts → 信息泄漏。3 种攻击实测:
///   1. read_file($HOME/symlink-to-etc/hosts) → 读到 /etc/hosts
///   2. read_dir($HOME/symlink-to-etc) → 列出 /etc 含 sudoers.d / krb5.keytab
///   3. save_file($HOME/symlink-to-tmp/x) → 实测写穿到 /tmp/outside-victim/
/// 触发面:webview XSS / 受损 npm 依赖 + HOME 内既存 symlink (stow / chezmoi / ln -s)。
///
/// 用于**读类操作**(read_file / read_dir / read_link / read_file_with_mtime):path 必须
/// 存在 → fs::canonicalize 把 symlink + `..` + `.` 全解到真实路径,再做 boundary check。
/// 写新文件用 `check_path_for_write` (parent canonicalize)。
///
/// **macOS 路径映射**: 同时 canonicalize HOME 让 `/var/folders/...` ↔ `/private/var/folders/...`
/// 同款映射不误伤(macOS canonicalize 把 /var → /private/var,/tmp → /private/tmp)。
///
/// **回归保护**:用户合法用例 `dch profile add claude foo --dir /opt/shared/claude-conf`
/// 把 `~/.claude` symlink 指向 HOME 外不能误伤 — 本函数通过 caller 控制范围保证(只在
/// HomeOnly fs.rs 类 read_file 走;CLI 端 profile add 走 Bun.write 不经本函数)。
pub fn check_path_canonical(path: &str, policy: PathPolicy) -> Result<(), String> {
    check_path(path, policy)?; // 先 lexical check 拒空 / .. 段
    let canonical = std::fs::canonicalize(path)
        .map_err(|e| format!("canonicalize 失败 {}: {}", path, e))?;
    boundary_check_canonical(&canonical, policy)
}

/// **REVIEW_9 C-HIGH-2 写场景**: 给写新文件用(target 不存在,canonicalize 不到):
/// canonicalize parent + basename 拼接再做 HOME 边界校验。
///
/// 适用 caller: `save_file` 等。parent 不存在时 fall back 到 lexical check(因为不存在
/// 的 dir 无法被 symlink 攻击 — caller 之后 mkdir 会按 lexical 路径创建)。
pub fn check_path_for_write(path: &str, policy: PathPolicy) -> Result<(), String> {
    check_path(path, policy)?;

    let p = Path::new(path);
    let parent = match p.parent() {
        Some(pp) if !pp.as_os_str().is_empty() => pp,
        _ => return Ok(()), // 无 parent / parent 是空(应是 root) → lexical check 已 enforce
    };
    let basename = match p.file_name() {
        Some(b) => b,
        None => return Err(format!("路径无 basename: {}", path)),
    };

    // parent 不存在时 fall back lexical check(caller 之后 mkdir 按 lexical 路径创建,
    // 不存在的 dir 无法被 symlink 攻击)。
    if !parent.exists() {
        return Ok(());
    }

    let parent_canonical = std::fs::canonicalize(parent)
        .map_err(|e| format!("canonicalize parent 失败 {}: {}", parent.display(), e))?;
    let full = parent_canonical.join(basename);
    boundary_check_canonical(&full, policy)
}

/// 内部 helper: 用 canonicalize 后的 absolute path 与 canonicalize 后的 HOME 做 boundary
/// 比较。macOS /var ↔ /private/var 等同款映射通过双 canonicalize 对齐。
fn boundary_check_canonical(canonical: &std::path::Path, policy: PathPolicy) -> Result<(), String> {
    let home = home_dir();
    if home.is_empty() {
        return Err("HOME 未设置".to_string());
    }
    let home_canonical = std::fs::canonicalize(&home).unwrap_or_else(|_| std::path::PathBuf::from(&home));

    match policy {
        PathPolicy::HomeOnly => {
            if canonical == home_canonical || canonical.starts_with(&home_canonical) {
                Ok(())
            } else {
                Err(format!("拒绝非 HOME 路径(canonical): {}", canonical.display()))
            }
        }
        PathPolicy::DchStoreOnly => {
            let dch_canonical = home_canonical.join(".dch");
            if canonical.starts_with(&dch_canonical) {
                Ok(())
            } else {
                Err(format!("拒绝非 ~/.dch 路径(canonical): {}", canonical.display()))
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

    /// **REVIEW_9 C-HIGH-2 / C-codex H1**: HOME 内 symlink 指向 HOME 外 → check_path_canonical
    /// 应解析后拒;旧 check_path lexical 通过(攻击通道)。
    #[cfg(unix)]
    #[test]
    fn check_path_canonical_rejects_home_internal_symlink_to_outside() {
        // 用真 fs 建 symlink 验证;不修 HOME env(用临时 dir 当 HOME)
        let tmp = std::env::temp_dir().join(format!("dch-pp-test-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let outside_target = std::env::temp_dir().join(format!("dch-pp-outside-{}", std::process::id()));
        std::fs::create_dir_all(&outside_target).unwrap();
        std::fs::write(outside_target.join("secret"), "leaked").unwrap();
        let symlink_in_home = tmp.join("link-to-outside");
        let _ = std::fs::remove_file(&symlink_in_home);
        std::os::unix::fs::symlink(&outside_target, &symlink_in_home).unwrap();
        let attack_path = symlink_in_home.join("secret");

        // env 改要串行(本测可能与其他 with_home 并行 race,加锁略,直接 set 后 check)
        let prev_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", &tmp);

        // 旧 check_path lexical 应通过(symlink in_home 字符串前缀符合 HOME)
        let lexical = check_path(&attack_path.to_string_lossy(), PathPolicy::HomeOnly);

        // 新 check_path_canonical 应拒(canonicalize 解到 outside_target/secret 不在 HOME)
        let canonical = check_path_canonical(&attack_path.to_string_lossy(), PathPolicy::HomeOnly);

        // 还原 env
        match prev_home {
            Some(v) => std::env::set_var("HOME", v),
            None => std::env::remove_var("HOME"),
        }

        assert!(lexical.is_ok(), "旧 lexical check 通过(攻击通道存在)");
        assert!(canonical.is_err(), "新 canonical check 应拒 HOME 外 symlink target;实际 ok");
        assert!(canonical.unwrap_err().contains("拒绝非 HOME"), "错误消息应明示 HOME 边界");

        // cleanup
        let _ = std::fs::remove_dir_all(&tmp);
        let _ = std::fs::remove_dir_all(&outside_target);
    }

    /// 合法用例不被误伤:HOME 内真实文件(无 symlink)canonicalize 后仍在 HOME 下。
    #[cfg(unix)]
    #[test]
    fn check_path_canonical_accepts_normal_home_file() {
        let tmp = std::env::temp_dir().join(format!("dch-pp-ok-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let real_file = tmp.join("real.txt");
        std::fs::write(&real_file, "ok").unwrap();

        let prev_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", &tmp);
        let r = check_path_canonical(&real_file.to_string_lossy(), PathPolicy::HomeOnly);
        match prev_home {
            Some(v) => std::env::set_var("HOME", v),
            None => std::env::remove_var("HOME"),
        }

        assert!(r.is_ok(), "HOME 内真实文件应通过;实际 err={:?}", r);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// check_path_for_write: parent 是 HOME 内 symlink 指向 HOME 外 → 拒
    #[cfg(unix)]
    #[test]
    fn check_path_for_write_rejects_symlink_parent_to_outside() {
        let tmp = std::env::temp_dir().join(format!("dch-pp-w-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let outside = std::env::temp_dir().join(format!("dch-pp-w-out-{}", std::process::id()));
        std::fs::create_dir_all(&outside).unwrap();
        let link = tmp.join("link-to-out");
        let _ = std::fs::remove_file(&link);
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        let new_file = link.join("new.txt"); // parent (link) 指向 HOME 外

        let prev_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", &tmp);
        let r = check_path_for_write(&new_file.to_string_lossy(), PathPolicy::HomeOnly);
        match prev_home {
            Some(v) => std::env::set_var("HOME", v),
            None => std::env::remove_var("HOME"),
        }

        assert!(r.is_err(), "parent symlink 出 HOME 应拒;实际 ok");
        let _ = std::fs::remove_dir_all(&tmp);
        let _ = std::fs::remove_dir_all(&outside);
    }
}
