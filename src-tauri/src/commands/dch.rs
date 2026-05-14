//! `bun src/cli.ts <args>` 的 Tauri 桥（CHANGELOG_17 已 async + spawn_blocking 修过；
//! 这里仅迁出 lib.rs 解构入 commands/ 模块，行为不变）。
//!
//! UI 的所有 profile 操作通过 run_dch_command 调 cli 子命令（CLAUDE.md「CLI 是单一
//! 入口」约束），不在 Rust 端复刻 profile 逻辑。

use crate::commands::shell::{get_user_shell, shell_basename, shell_invocation};
use crate::proc_timeout::spawn_with_timeout;
use serde::Serialize;
use std::process::Command;
use std::time::Duration;

#[derive(Serialize)]
pub struct DchCommandResult {
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
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
///
/// **必须 async + spawn_blocking**（codex rescue 实证，CHANGELOG_17 + AP-19）：Tauri v2
/// 非 async `#[tauri::command]` 在主线程跑（同 webview 渲染线程），`spawn_with_timeout`
/// 内部 `try_wait` + `thread::sleep(50ms)` 循环阻塞主线程 → React 渲染主循环 + `setInterval`
/// elapsed timer 全冻住 → 用户看到的是「点击后 UI 假死直到 backup 完成才一次性渲染」。
/// 改 async + `tauri::async_runtime::spawn_blocking` 把阻塞工作扔到 worker pool，主线程
/// 立刻让出，webview 持续重绘。
#[tauri::command]
pub async fn run_dch_command(
    args: Vec<String>,
    timeout_ms: Option<u64>,
) -> Result<DchCommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || run_dch_command_blocking(args, timeout_ms))
        .await
        .map_err(|e| format!("run_dch_command worker failed: {}", e))?
}

fn run_dch_command_blocking(
    args: Vec<String>,
    timeout_ms: Option<u64>,
) -> Result<DchCommandResult, String> {
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
