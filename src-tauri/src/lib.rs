//! Dev Config Hub Tauri 后端入口。
//!
//! REVIEW_8 D3：拆模块。所有 #[tauri::command] 移到 commands/{fs,version,dch} 与
//! atomic.rs，path 边界策略集中在 path_policy.rs，shell 解析 helpers 在 commands/shell.rs。
//! 本文件只剩 mod 声明 + invoke_handler 注册 + Builder。

mod proc_timeout;
mod path_policy;
mod atomic;
mod commands;

use commands::dch::{run_dch_command, run_dch_with_secrets_temp};
use commands::fs::{
    file_exists, get_home_dir, read_dir, read_file, read_file_with_mtime, read_link, save_file,
};
use commands::version::get_tool_version;
use atomic::save_file_if_mtime;

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
            save_file_if_mtime,
            get_tool_version,
            get_home_dir,
            run_dch_command,
            run_dch_with_secrets_temp,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
