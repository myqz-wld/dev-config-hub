//! Native configuration-file picker.
//!
//! Tauri's dialog plugin does not expose macOS `showsHiddenFiles`, so its
//! default open panel hides the dot-prefixed directories that hold most tool
//! configuration. The macOS path uses `NSOpenPanel` directly on the main
//! thread and enables that property; other desktop platforms keep using the
//! dialog plugin.

use crate::path_policy::home_dir;

#[cfg(target_os = "macos")]
fn pick_macos_config_file(title: &str) -> Result<Option<String>, String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSModalResponseCancel, NSModalResponseOK, NSOpenPanel};
    use objc2_foundation::{NSString, NSURL};

    let mtm =
        MainThreadMarker::new().ok_or_else(|| "文件选择器必须在 macOS 主线程打开".to_string())?;
    let panel = NSOpenPanel::openPanel(mtm);
    let message = NSString::from_str(title);

    panel.setCanChooseDirectories(false);
    panel.setCanChooseFiles(true);
    panel.setAllowsMultipleSelection(false);
    panel.setShowsHiddenFiles(true);
    panel.setMessage(Some(&message));

    let home = home_dir();
    if !home.is_empty() {
        let home_url = NSURL::fileURLWithPath_isDirectory(&NSString::from_str(&home), true);
        panel.setDirectoryURL(Some(&home_url));
    }

    let response = panel.runModal();
    if response == NSModalResponseOK {
        panel
            .URL()
            .and_then(|url| url.path())
            .map(|path| Some(path.to_string()))
            .ok_or_else(|| "文件选择器没有返回有效路径".to_string())
    } else if response == NSModalResponseCancel {
        Ok(None)
    } else {
        Err(format!("文件选择器异常关闭: {}", response))
    }
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn pick_config_file(
    app: tauri::AppHandle,
    title: String,
) -> Result<Option<String>, String> {
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let _ = sender.send(pick_macos_config_file(&title));
    })
    .map_err(|error| format!("无法打开文件选择器: {}", error))?;

    tauri::async_runtime::spawn_blocking(move || {
        receiver
            .recv()
            .map_err(|error| format!("文件选择器结果通道已关闭: {}", error))?
    })
    .await
    .map_err(|error| format!("等待文件选择器失败: {}", error))?
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn pick_config_file(
    app: tauri::AppHandle,
    title: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    app.dialog()
        .file()
        .set_title(title)
        .set_directory(home_dir())
        .pick_file(move |selection| {
            let result = selection
                .map(|path| {
                    path.into_path()
                        .map(|path| path.to_string_lossy().into_owned())
                        .map_err(|error| format!("文件选择器返回了无效路径: {}", error))
                })
                .transpose();
            let _ = sender.send(result);
        });

    tauri::async_runtime::spawn_blocking(move || {
        receiver
            .recv()
            .map_err(|error| format!("文件选择器结果通道已关闭: {}", error))?
    })
    .await
    .map_err(|error| format!("等待文件选择器失败: {}", error))?
}
