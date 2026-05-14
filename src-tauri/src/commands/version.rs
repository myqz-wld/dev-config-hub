//! REVIEW_8 H1：get_tool_version 必须 async + spawn_blocking。
//!
//! 之前同步 #[tauri::command] 在主线程跑 spawn_with_timeout（含 try_wait + sleep
//! 50ms 循环），冻 webview 直到所有 4 个 version 一次性返回。loadAllVersions 跑
//! Promise.all × 4 直接放大效应。AP-19 / CHANGELOG_17 同根问题。
//!
//! **REVIEW_9 C-HIGH-1 / C-codex H1 + C-claude 反驳同意**: IPC 入参从 `command: String`
//! 重构为 `tool: ToolKind` enum,关闭 webview 任意 shell -c 注入面。
//!
//! 攻击模型(旧实现):webview XSS / 受损 npm 依赖调
//! `version("claude --version; rm -rf $HOME/.dch")` → bridge 直传 string 到 Rust →
//! `spawn_with_timeout` 用 `shell_invocation` 拼 `-c` 一段执行任意命令(凭据偷取 /
//! profile 全删 / launchd 持久化)。Tauri capability 默认 allow get_tool_version + CSP
//! 默认 null 不能拦 webview JS 调 IPC。
//!
//! 防御:input domain 收紧到 4 个 enum value;后端按 enum 拼**固定**命令字符串(后端
//! 完全控制,前端没法注入)。攻击面从「任意 string」收缩到「4 个 enum value」。
//!
//! **TS 端契约**: `tool` 字段 serde rename_all = camelCase 让 OpenCode → "openCode";
//! Zsh / Claude / Codex 单词 lowercase。bridge.ts ToolKind type 必须与本 enum 同步。

use crate::commands::shell::{get_user_shell, shell_basename, shell_invocation};
use crate::proc_timeout::spawn_with_timeout;
use serde::Deserialize;
use std::process::Command;
use std::sync::OnceLock;
use std::time::Duration;

/// **REVIEW_9 C-HIGH-1**: 4 个工具 enum 替代任意 string 命令。后端按 enum 拼固定
/// 命令字符串,关闭 IPC 直传 shell -c 的注入面。
#[derive(Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum ToolKind {
    Zsh,
    Claude,
    Codex,
    OpenCode,
}

impl ToolKind {
    /// 返回固定的版本检查命令字符串(后端拼接,前端无法注入)。
    fn version_command(self) -> &'static str {
        match self {
            ToolKind::Zsh => "zsh --version",
            ToolKind::Claude => "claude --version",
            ToolKind::Codex => "codex --version",
            ToolKind::OpenCode => "opencode --version",
        }
    }
}

#[tauri::command]
pub async fn get_tool_version(tool: ToolKind) -> String {
    tauri::async_runtime::spawn_blocking(move || get_tool_version_inner(tool.version_command()))
        .await
        .unwrap_or_else(|_| "unknown".to_string())
}

/// **REVIEW_9 C-claude INFO**: hot path 用 OnceLock 缓存 Regex,避免每次 cold 编译。
/// loadAllVersions Promise.all × 4 让本函数被并发调,旧 `Regex::new(...).unwrap()` 每次重
/// 编译,虽然 regex-lite 编译很快但 4× 串起来是 N×100us ~ 1ms 浪费。
fn version_regex() -> &'static regex_lite::Regex {
    static RE: OnceLock<regex_lite::Regex> = OnceLock::new();
    RE.get_or_init(|| regex_lite::Regex::new(r"\d+\.\d+(?:\.\d+)?").unwrap())
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
    version_regex().find(&text).map(|m| m.as_str().to_string()).unwrap_or_else(|| "unknown".to_string())
}
