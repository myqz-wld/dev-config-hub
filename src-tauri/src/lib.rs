use std::fs;
use std::process::Command;
use serde::Serialize;

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

    let output = cmd.output();
    match output {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout);
            let stderr = String::from_utf8_lossy(&o.stderr);
            let text = format!("{}{}", stdout, stderr);
            let re = regex_lite::Regex::new(r"\d+\.\d+(?:\.\d+)?").unwrap();
            re.find(&text).map(|m| m.as_str().to_string()).unwrap_or("unknown".to_string())
        }
        Err(_) => "not installed".to_string(),
    }
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
#[tauri::command]
fn run_dch_command(args: Vec<String>) -> Result<DchCommandResult, String> {
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

    let output = command
        .output()
        .map_err(|e| format!("spawn failed: {}", e))?;

    Ok(DchCommandResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        code: output.status.code().unwrap_or(-1),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            read_file,
            file_exists,
            save_file,
            get_tool_version,
            get_home_dir,
            run_dch_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
