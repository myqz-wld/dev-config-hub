use std::fs;
use std::process::Command;
use std::time::{Duration, UNIX_EPOCH};
use serde::Serialize;

mod proc_timeout;
use proc_timeout::spawn_with_timeout;

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    // 用 read + from_utf8_lossy 而非 read_to_string：与 CLI 端 Bun.file.text() 行为一致。
    // Rust fs::read_to_string 严格 UTF-8，遇到非法字节直接 Err(InvalidData) — 用户的
    // ~/.zshrc 用 GBK / Latin-1 写注释（亚洲开发者偶见混用）会让 loadAllConfigs 整个 reject
    // → App 「加载失败」UI 挂死。lossy 用 U+FFFD 替换非法字节，与 CLI 行为对齐。REVIEW_2 M10。
    fs::read(&path)
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .map_err(|e| format!("{}: {}", path, e))
}

#[tauri::command]
fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
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
fn read_file_with_mtime(path: String) -> ReadFileWithMtimeResult {
    let p = std::path::Path::new(&path);
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
struct ReadFileWithMtimeResult {
    exists: bool,
    content: String,
    /// Unix epoch microseconds；不存在 / 拿不到 mtime 为 null。
    /// 改 ms→us 见 REVIEW_3 R_1·C7（APFS sub-ms 写间隔会让 ms 精度漏判）。
    mtime_us: Option<u64>,
}

impl ReadFileWithMtimeResult {
    fn missing() -> Self {
        Self { exists: false, content: String::new(), mtime_us: None }
    }
}

#[tauri::command]
fn save_file(path: String, content: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {}", parent.display(), e))?;
        }
    }
    fs::write(&path, content).map_err(|e| e.to_string())
}

/// 跨平台拿用户默认 shell：
/// - macOS：SHELL env > dscl Directory Services > "/bin/zsh"
/// - Linux：SHELL env > "/bin/bash"
/// - Windows：SHELL env（用户改了如 git-bash 也尊重）> "powershell"
///
/// `dscl` 仅 macOS 有；用 `#[cfg(target_os = "macos")]` 圈起来避免 Win/Linux 编译时
/// 引用不存在的二进制 ENOENT。
fn get_user_shell() -> String {
    #[cfg(target_os = "macos")]
    {
        if let Ok(s) = std::env::var("SHELL") {
            return s;
        }
        // macOS GUI app 启动时 SHELL env 可能未设；从 Directory Services 读
        let user = std::env::var("USER").unwrap_or_default();
        if !user.is_empty() {
            if let Some(out) = Command::new("dscl")
                .args([".", "-read", &format!("/Users/{}", user), "UserShell"])
                .output()
                .ok()
            {
                let s = String::from_utf8_lossy(&out.stdout).to_string();
                if let Some(v) = s.split_whitespace().last() {
                    return v.to_string();
                }
            }
        }
        return "/bin/zsh".to_string();
    }
    #[cfg(target_os = "linux")]
    {
        return std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        return std::env::var("SHELL").unwrap_or_else(|_| "powershell".to_string());
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        return std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    }
}

/// 把 shell 路径解析成 short name（zsh / bash / fish / powershell / cmd）。
fn shell_basename(shell: &str) -> &str {
    std::path::Path::new(shell)
        .file_stem()
        .and_then(|n| n.to_str())
        .unwrap_or("sh")
}

/// 给 shell 选「source rc + 跑命令」的包装语法。返回 (shell_args, wrapped_command)：
/// - POSIX shells (zsh/bash/fish)：`shell -c "source rc; cmd"` 显式 source rc 让 GUI app
///   也能拿到用户 PATH 注入（macOS GUI app 默认不读 zshrc/.bashrc）
/// - PowerShell：`powershell -NoProfile -Command "cmd"` 不 source profile（避免 user
///   profile 干扰 + PATH 一般够用）
/// - cmd.exe：`cmd /c "cmd"`
fn shell_invocation(shell_name: &str, cmd: &str) -> (Vec<&'static str>, String) {
    match shell_name {
        "zsh" => (
            vec!["-c"],
            format!(
                "source $HOME/.zprofile 2>/dev/null; source $HOME/.zshrc 2>/dev/null; {}",
                cmd
            ),
        ),
        "bash" => (
            vec!["-c"],
            format!(
                "source $HOME/.bash_profile 2>/dev/null; source $HOME/.bashrc 2>/dev/null; {}",
                cmd
            ),
        ),
        "fish" => (
            vec!["-c"],
            format!(
                "source $HOME/.config/fish/config.fish 2>/dev/null; {}",
                cmd
            ),
        ),
        "pwsh" | "powershell" => (vec!["-NoProfile", "-Command"], cmd.to_string()),
        "cmd" => (vec!["/c"], cmd.to_string()),
        _ => (vec!["-c"], cmd.to_string()),
    }
}

#[tauri::command]
fn get_tool_version(command: String) -> String {
    let parts: Vec<&str> = command.split_whitespace().collect();
    if parts.is_empty() {
        return "unknown".to_string();
    }
    let shell = get_user_shell();
    let shell_name = shell_basename(&shell);
    let (shell_args, wrapped) = shell_invocation(shell_name, &command);

    let mut cmd = Command::new(&shell);
    for arg in &shell_args {
        cmd.arg(arg);
    }
    cmd.arg(&wrapped);

    // REVIEW_7 H5：原 cmd.output() 同根 H1/H2 卡死路径。用户 .zshrc 含 `(bg-cmd &)`
    // （typical：proxy ensure / nvm preload / shell prompt async refresh）→ source rc 时
    // 后台进程继承 stdio pipe FD → loadAllConfigs Promise.all × 4 全踩 → App 首屏 / focus
    // reload / visibility 切换全卡。version 命令本就秒级返回，给 5s timeout 足够。
    let output = match spawn_with_timeout(cmd, Duration::from_secs(5)) {
        Ok(o) => o,
        Err(_) => return "not installed".to_string(),
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let text = format!("{}{}", stdout, stderr);
    let re = regex_lite::Regex::new(r"\d+\.\d+(?:\.\d+)?").unwrap();
    re.find(&text).map(|m| m.as_str().to_string()).unwrap_or("unknown".to_string())
}

/// 跨平台 home dir：
/// - POSIX：HOME env
/// - Windows：USERPROFILE env（Win 标准，HOME 默认未设）
#[tauri::command]
fn get_home_dir() -> String {
    #[cfg(target_os = "windows")]
    {
        return std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_default();
    }
    #[cfg(not(target_os = "windows"))]
    {
        return std::env::var("HOME").unwrap_or_default();
    }
}

#[derive(Serialize)]
struct DchCommandResult {
    stdout: String,
    stderr: String,
    code: i32,
}

/// Spawn `bun src/cli.ts <args>` 并返回结果。
/// 通过登录 shell 启动，确保 PATH/brew/nvm 注入跟真实终端一致。
/// 项目根从 CARGO_MANIFEST_DIR/.. 解析（dev 模式可靠）；prod 模式需用户在
/// `DCH_PROJECT_ROOT` 环境变量里指定项目源码位置。
///
/// Win：走 PowerShell（不 source profile）；POSIX：走 user shell + source rc。
///
/// **REVIEW_7 H2/H3/H4 落地**：走 `spawn_with_timeout` helper（process group + 增量读 +
/// timeout killpg），不再用同步 `cmd.output()`。`timeout_ms` 由 UI 按命令传：
/// - `use` = `2 × hookTimeoutMs + 5000ms`（pre+post hook + GRACE 余量）
/// - `hook test` = `hookTimeoutMs + 5000ms`
/// - `init` = `30s`（含 mv/ln 等 fs 操作）
/// - `list/current/config/env/show/add/remove` = `10s`（纯文件读写）
/// 缺省（未传）= `1800s`（30 分钟绝对上限，覆盖 `hookTimeoutMs` 上限 600000ms × 2 + 余量）。
#[tauri::command]
fn run_dch_command(args: Vec<String>, timeout_ms: Option<u64>) -> Result<DchCommandResult, String> {
    let project_root = std::env::var("DCH_PROJECT_ROOT").ok().or_else(|| {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        std::path::Path::new(manifest_dir)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
    }).ok_or_else(|| "找不到项目根。请设置 DCH_PROJECT_ROOT 环境变量".to_string())?;

    let cli_path = std::path::Path::new(&project_root).join("src").join("cli.ts");
    if !cli_path.exists() {
        return Err(format!("CLI 入口不存在: {}", cli_path.display()));
    }

    let shell = get_user_shell();
    let shell_name = shell_basename(&shell);

    // 按平台 / shell 拼 cmd 字符串
    let cmd = if shell_name == "pwsh" || shell_name == "powershell" {
        // PowerShell：用 & 调用 + 单引号包路径；args 走单引号转义（PS 单引号内无需转义除单引号本身）
        let quoted_args: Vec<String> = args
            .iter()
            .map(|a| format!("'{}'", a.replace('\'', "''")))
            .collect();
        format!(
            "Set-Location -LiteralPath '{}'; & bun '{}' {}",
            project_root.replace('\'', "''"),
            cli_path.to_string_lossy().replace('\'', "''"),
            quoted_args.join(" "),
        )
    } else if shell_name == "cmd" {
        // cmd.exe：用双引号；arg 含双引号要转义。简单实现：禁止 args 含 "
        let quoted_args: Vec<String> = args
            .iter()
            .map(|a| format!("\"{}\"", a.replace('"', "\\\"")))
            .collect();
        format!(
            "cd /d \"{}\" && bun \"{}\" {}",
            project_root,
            cli_path.to_string_lossy(),
            quoted_args.join(" "),
        )
    } else {
        // POSIX shells：用单引号转义
        let quoted_args: Vec<String> = args
            .iter()
            .map(|a| format!("'{}'", a.replace('\'', "'\\''")))
            .collect();
        format!(
            "cd '{}' && bun '{}' {}",
            project_root.replace('\'', "'\\''"),
            cli_path.to_string_lossy().replace('\'', "'\\''"),
            quoted_args.join(" "),
        )
    };

    let (shell_args, wrapped) = shell_invocation(shell_name, &cmd);

    let mut command = Command::new(&shell);
    for arg in &shell_args {
        command.arg(arg);
    }
    command.arg(&wrapped);

    // REVIEW_7 H2：UI 按命令传 timeout；缺省 1800s 兜底（绝对上限）。
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(1_800_000));
    let outcome = spawn_with_timeout(command, timeout)
        .map_err(|e| format!("spawn failed: {}", e))?;

    Ok(DchCommandResult {
        stdout: String::from_utf8_lossy(&outcome.stdout).to_string(),
        stderr: String::from_utf8_lossy(&outcome.stderr).to_string(),
        // outcome.code = -2 表示 watchdog 杀；UI 端可据此判断是否 timeout 还是 CLI 内部失败。
        code: outcome.code,
    })
}

#[derive(Serialize)]
struct DirEntryView {
    name: String,
    #[serde(rename = "isFile")]
    is_file: bool,
}

/// 读目录下文件列表（name + isFile）。
///
/// **安全边界**：拒绝任何不在 `$HOME` 下的路径。webview 不应能列任意目录
/// （避免泄漏 PII / 系统结构）。HOME 比对走 `get_home_dir()` 同源，与该函数
/// 跨平台行为一致（macOS/Linux=$HOME，Windows=USERPROFILE/$HOME fallback）。
///
/// **不存在的目录返回空 Vec**（不当 error） —— 自定义 schema 目录 `~/.dch/schemas/`
/// 通常用户没建过，要求文件不存在不报错让 caller 路径更平。
///
/// **非目录** / **权限不足** / **其他 IO 错误** → Err，由 caller 决定是 warn 还是 fatal。
#[tauri::command]
fn read_dir(path: String) -> Result<Vec<DirEntryView>, String> {
    let home = get_home_dir();
    if home.is_empty() {
        return Err("HOME 未设置".to_string());
    }
    // 边界：path 必须以 $HOME 起头（含 $HOME 本身）
    let p = std::path::Path::new(&path);
    let home_p = std::path::Path::new(&home);
    if !(p == home_p || p.starts_with(home_p)) {
        return Err(format!("拒绝读非 HOME 路径: {}", path));
    }

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

/// 读 symlink 的目标。仅允许 HOME 下路径（与 read_dir 同源 defensive，防 webview
/// 被滥用探测系统 symlink 结构）。
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
fn read_link(path: String) -> Result<Option<String>, String> {
    let home = get_home_dir();
    if home.is_empty() {
        return Err("HOME 未设置".to_string());
    }
    read_link_inner(&path, &home)
}

/// pure helper：接收 home 不读 env，方便单测在并发 cargo test 下不被 env 改污染。
fn read_link_inner(path: &str, home: &str) -> Result<Option<String>, String> {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_file,
            read_file_with_mtime,
            read_dir,
            read_link,
            file_exists,
            save_file,
            get_tool_version,
            get_home_dir,
            run_dch_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
