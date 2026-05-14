//! commands/ 把所有 #[tauri::command] 拆模块管理（lib.rs 仅留 Builder）。

pub mod fs;
pub mod shell;
pub mod version;
pub mod dch;
