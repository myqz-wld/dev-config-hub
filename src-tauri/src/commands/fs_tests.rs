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

/// **REVIEW_9 C-MED-1 / C-claude MED M1**: read_link_inner 拒含 `..` 段的路径,防
/// `/Users/test/foo/../../etc/some-link` 通过 starts_with(home) 后被 fs::read_link 真去
/// 读 /etc/some-link 的 traversal 攻击。与 path_policy::check_path 同步加 `..` 拒绝。
#[cfg(unix)]
#[test]
fn read_link_rejects_dotdot_traversal() {
    let tmp = std::env::temp_dir().join(format!("dch-rl-test6-{}", std::process::id()));
    std::fs::create_dir_all(&tmp).unwrap();
    // path 字符串前缀符合 home (tmp 字符串 + /foo/../../etc/...) 但实际 OS 解到 /etc/x
    let attack = format!("{}/foo/../../etc/passwd", tmp.to_string_lossy());

    let r = read_link_inner(&attack, &tmp.to_string_lossy());
    assert!(r.is_err(), "含 `..` 段应拒;实际 ok");
    assert!(r.unwrap_err().contains("拒绝含 '..'"));

    let _ = std::fs::remove_dir_all(&tmp);
}

/// **REVIEW_9 C-MED-1 / C-codex MED-4 + C-claude MED-1 双方 PoC**: read_link_inner parent
/// 是 symlink 出 HOME 时应拒(仅 lexical starts_with check 漏)。攻击模型:`$HOME/link-to-etc`
/// 是 symlink 指向 `/etc`,`$HOME/link-to-etc/some-link` 这条路径 lexical starts_with
/// HOME 通过,但 OS 真解 parent → /etc → fs::read_link 读 /etc/some-link。
#[cfg(unix)]
#[test]
fn read_link_rejects_parent_symlink_to_outside_home() {
    let tmp_home = std::env::temp_dir().join(format!("dch-rl-pcheck-{}", std::process::id()));
    std::fs::create_dir_all(&tmp_home).unwrap();
    let outside = std::env::temp_dir().join(format!("dch-rl-pcheck-out-{}", std::process::id()));
    std::fs::create_dir_all(&outside).unwrap();
    // 在 outside 建一个 symlink 当 attack target
    let outside_link = outside.join("symlink-victim");
    let _ = std::fs::remove_file(&outside_link);
    std::os::unix::fs::symlink("/tmp/dummy", &outside_link).unwrap();
    // 在 home 内建 link-to-outside 指向 outside dir
    let home_link = tmp_home.join("link-to-outside");
    let _ = std::fs::remove_file(&home_link);
    std::os::unix::fs::symlink(&outside, &home_link).unwrap();

    // attack path: $HOME/link-to-outside/symlink-victim — parent canonicalize 解到 outside
    let attack_path = home_link.join("symlink-victim");
    let r = read_link_inner(&attack_path.to_string_lossy(), &tmp_home.to_string_lossy());
    assert!(r.is_err(), "parent symlink 解到 HOME 外应拒;实际 ok");

    let _ = std::fs::remove_dir_all(&tmp_home);
    let _ = std::fs::remove_dir_all(&outside);
}

/// **REVIEW_9 C-MED-3 [NEW REGRESSION post-G4]**: read_dir 「不存在目录返空 Vec」契约必须
/// 保留。R1 G4 加 canonicalize 前置后,canonicalize 对不存在路径必报错 → 旧 R1 实现直接
/// Err 而非 Ok(Vec::new())。修法:canonical 失败时检测是否 ENOENT(此处用 lexical 通过
/// 但 canonical 失败 = 必是不存在)→ 走 NotFound 路径返空 Vec。
#[cfg(unix)]
#[test]
fn read_dir_returns_empty_vec_for_nonexistent_dir_contract() {
    let tmp_home = std::env::temp_dir().join(format!("dch-rd-noexist-{}", std::process::id()));
    std::fs::create_dir_all(&tmp_home).unwrap();
    let nonexist = tmp_home.join("schemas-not-built-yet");
    // 不创建该 dir,验证契约
    // **REVIEW_9 follow-up F1**: 与 path_policy::HOME_ENV_LOCK 共享串行 env 改
    let _guard = crate::path_policy::HOME_ENV_LOCK
        .lock()
        .expect("HOME_ENV_LOCK poisoned");
    let prev_home = std::env::var("HOME").ok();
    std::env::set_var("HOME", &tmp_home);

    let r = read_dir_inner(&nonexist.to_string_lossy());

    match prev_home {
        Some(v) => std::env::set_var("HOME", v),
        None => std::env::remove_var("HOME"),
    }

    assert!(r.is_ok(), "不存在的 HOME 内目录应返 Ok(空 Vec);实际 err={:?}", r);
    assert!(r.unwrap().is_empty(), "应返空 Vec");
    let _ = std::fs::remove_dir_all(&tmp_home);
}

/// HOME 外不存在的目录仍应拒(boundary check 不被 ENOENT 兜底绕过)。
#[cfg(unix)]
#[test]
fn read_dir_rejects_outside_home_even_if_nonexistent() {
    let tmp_home = std::env::temp_dir().join(format!("dch-rd-out-{}", std::process::id()));
    std::fs::create_dir_all(&tmp_home).unwrap();
    // **REVIEW_9 follow-up F1**: 与 path_policy::HOME_ENV_LOCK 共享串行 env 改
    let _guard = crate::path_policy::HOME_ENV_LOCK
        .lock()
        .expect("HOME_ENV_LOCK poisoned");
    let prev_home = std::env::var("HOME").ok();
    std::env::set_var("HOME", &tmp_home);

    // /etc/some-nonexistent-path 不存在 + HOME 外 → 必须拒不能误返空 Vec
    let r = read_dir_inner("/etc/some-nonexistent-attack-path");

    match prev_home {
        Some(v) => std::env::set_var("HOME", v),
        None => std::env::remove_var("HOME"),
    }

    assert!(r.is_err(), "HOME 外路径应拒不论是否存在;实际 ok");
    let _ = std::fs::remove_dir_all(&tmp_home);
}
