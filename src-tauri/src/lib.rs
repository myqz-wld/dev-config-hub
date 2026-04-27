use std::fs;
use std::process::Command;
use serde::Serialize;

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("{}: {}", path, e))
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

#[tauri::command]
fn get_tool_version(command: String) -> String {
    let parts: Vec<&str> = command.split_whitespace().collect();
    if parts.is_empty() {
        return "unknown".to_string();
    }
    let shell = std::env::var("SHELL")
        .or_else(|_| {
            // macOS GUI apps may not have SHELL; read from user's directory services
            let out = Command::new("dscl").args([".", "-read", &format!("/Users/{}", std::env::var("USER").unwrap_or_default()), "UserShell"]).output().ok();
            out.and_then(|o| {
                let s = String::from_utf8_lossy(&o.stdout).to_string();
                s.split_whitespace().last().map(|v| v.to_string())
            }).ok_or(std::env::VarError::NotPresent)
        })
        .unwrap_or_else(|_| "/bin/zsh".to_string());

    let shell_name = std::path::Path::new(&shell)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("zsh");

    let wrapped = match shell_name {
        "zsh" => format!(
            "source $HOME/.zprofile 2>/dev/null; source $HOME/.zshrc 2>/dev/null; {}", command
        ),
        "bash" => format!(
            "source $HOME/.bash_profile 2>/dev/null; source $HOME/.bashrc 2>/dev/null; {}", command
        ),
        "fish" => format!(
            "source $HOME/.config/fish/config.fish 2>/dev/null; {}", command
        ),
        _ => command.clone(),
    };

    let output = Command::new(&shell).args(&["-c", &wrapped]).output();
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

#[tauri::command]
fn get_home_dir() -> String {
    std::env::var("HOME").unwrap_or_default()
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

    // 用单引号转义每个 arg，再拼成一个 shell 命令
    let quoted_args: Vec<String> = args.iter()
        .map(|a| format!("'{}'", a.replace('\'', "'\\''")))
        .collect();
    let cmd = format!(
        "cd '{}' && bun '{}' {}",
        project_root.replace('\'', "'\\''"),
        cli_path.to_string_lossy().replace('\'', "'\\''"),
        quoted_args.join(" "),
    );

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let shell_name = std::path::Path::new(&shell)
        .file_name().and_then(|n| n.to_str()).unwrap_or("zsh");

    // macOS GUI app 启动的 shell PATH 不含用户 zshrc 注入的内容（如 ~/.bun/bin）。
    // 显式 source zprofile + rc，与 get_tool_version 行为一致。
    let wrapped = match shell_name {
        "zsh" => format!(
            "source $HOME/.zprofile 2>/dev/null; source $HOME/.zshrc 2>/dev/null; {}", cmd
        ),
        "bash" => format!(
            "source $HOME/.bash_profile 2>/dev/null; source $HOME/.bashrc 2>/dev/null; {}", cmd
        ),
        "fish" => format!(
            "source $HOME/.config/fish/config.fish 2>/dev/null; {}", cmd
        ),
        _ => cmd.clone(),
    };

    let output = Command::new(&shell)
        .args(&["-c", &wrapped])
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
