//! REVIEW_8 H1：get_tool_version 必须 async + spawn_blocking。
//!
//! 之前同步 #[tauri::command] 在主线程跑 spawn_with_timeout（含 try_wait + sleep
//! 50ms 循环），冻 webview 直到所有 4 个 version 一次性返回。loadAllVersions 跑
//! Promise.all × 4 直接放大效应。AP-19 / CHANGELOG_17 同根问题。

use crate::commands::shell::{get_user_shell, shell_basename, shell_invocation};
use crate::proc_timeout::spawn_with_timeout;
use std::process::Command;
use std::time::Duration;

#[tauri::command]
pub async fn get_tool_version(command: String) -> String {
    tauri::async_runtime::spawn_blocking(move || get_tool_version_inner(&command))
        .await
        .unwrap_or_else(|_| "unknown".to_string())
}

fn get_tool_version_inner(command: &str) -> String {
    let parts: Vec<&str> = command.split_whitespace().collect();
    if parts.is_empty() {
        return "unknown".to_string();
    }
    let shell = get_user_shell();
    let shell_name = shell_basename(&shell);
    let (shell_args, wrapped) = shell_invocation(shell_name, command);

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
    re.find(&text).map(|m| m.as_str().to_string()).unwrap_or_else(|| "unknown".to_string())
}
