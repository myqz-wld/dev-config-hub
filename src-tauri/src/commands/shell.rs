//! 跨平台 shell 解析 helpers（pure logic，无 #[tauri::command]）。
//!
//! 给 commands::version + commands::dch 共用 —— 之前散在 lib.rs 顶层 fn，
//! 拆出来避免 lib.rs 超 500 行 + 让 version / dch 模块独立可测。
//!
//! POSIX：source 用户 rc 让 GUI app 也能拿 brew/nvm 注入的 PATH（macOS GUI app
//! 默认不读 zshrc/.bashrc）。Windows pwsh：-NoProfile 跳过 user profile（PATH 一般够）。

use std::process::Command;

/// 跨平台拿用户默认 shell：
/// - macOS：SHELL env > dscl Directory Services > "/bin/zsh"
/// - Linux：SHELL env > "/bin/bash"
/// - Windows：SHELL env > "powershell"
pub fn get_user_shell() -> String {
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
pub fn shell_basename(shell: &str) -> &str {
    std::path::Path::new(shell)
        .file_stem()
        .and_then(|n| n.to_str())
        .unwrap_or("sh")
}

/// 给 shell 选「source rc + 跑命令」的包装语法。返回 (shell_args, wrapped_command)：
/// - POSIX shells (zsh/bash/fish)：`shell -c "source rc; cmd"` 显式 source rc 让 GUI app
///   也能拿到用户 PATH 注入（macOS GUI app 默认不读 zshrc/.bashrc）
/// - PowerShell：`powershell -NoProfile -Command "cmd"` 不 source profile
/// - cmd.exe：`cmd /c "cmd"`
pub fn shell_invocation(shell_name: &str, cmd: &str) -> (Vec<&'static str>, String) {
    match shell_name {
        "zsh" => (
            vec!["-c"],
            format!(
                "source ${{ZDOTDIR:-$HOME}}/.zprofile 2>/dev/null; source ${{ZDOTDIR:-$HOME}}/.zshrc 2>/dev/null; {}",
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
                "if test -n \"$XDG_CONFIG_HOME\"; source $XDG_CONFIG_HOME/fish/config.fish 2>/dev/null; else; source $HOME/.config/fish/config.fish 2>/dev/null; end; {}",
                cmd
            ),
        ),
        "pwsh" | "powershell" => (vec!["-NoProfile", "-Command"], cmd.to_string()),
        "cmd" => (vec!["/c"], cmd.to_string()),
        _ => (vec!["-c"], cmd.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_basename_strips_path_and_ext() {
        assert_eq!(shell_basename("/bin/zsh"), "zsh");
        assert_eq!(shell_basename("/usr/local/bin/bash"), "bash");
        assert_eq!(shell_basename("powershell.exe"), "powershell");
        assert_eq!(shell_basename(""), "sh");
    }

    #[test]
    fn invocation_zsh_sources_zshrc() {
        let (args, wrapped) = shell_invocation("zsh", "echo hi");
        assert_eq!(args, vec!["-c"]);
        assert!(wrapped.contains("source ${ZDOTDIR:-$HOME}/.zprofile"));
        assert!(wrapped.contains("source ${ZDOTDIR:-$HOME}/.zshrc"));
        assert!(wrapped.contains("echo hi"));
    }

    #[test]
    fn invocation_powershell_no_profile() {
        let (args, wrapped) = shell_invocation("powershell", "Get-Date");
        assert_eq!(args, vec!["-NoProfile", "-Command"]);
        assert_eq!(wrapped, "Get-Date");
    }

    #[test]
    fn invocation_unknown_shell_fallback_sh() {
        let (args, wrapped) = shell_invocation("ksh", "ls");
        assert_eq!(args, vec!["-c"]);
        assert_eq!(wrapped, "ls");
    }
}
