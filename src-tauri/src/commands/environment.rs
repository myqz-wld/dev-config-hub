//! Resolve user-level configuration roots once for the Tauri frontend.

use crate::commands::shell::{get_user_shell, shell_basename, shell_invocation};
use crate::path_policy::home_dir;
use crate::proc_timeout::spawn_with_timeout;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use std::time::Duration;

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PowerShellProfileLocation {
    label: String,
    path: String,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConfigEnvironment {
    home: String,
    platform: &'static str,
    codex_home: Option<String>,
    grok_home: Option<String>,
    zdotdir: Option<String>,
    xdg_config_home: Option<String>,
    app_data: Option<String>,
    fish_installed: bool,
    power_shell_profiles: Vec<PowerShellProfileLocation>,
}

fn platform_name() -> &'static str {
    #[cfg(target_os = "windows")]
    return "win32";
    #[cfg(target_os = "macos")]
    return "darwin";
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    return "linux";
}

fn login_environment() -> HashMap<String, String> {
    let shell = get_user_shell();
    let shell_name = shell_basename(&shell);
    let keys = [
        "CODEX_HOME",
        "GROK_HOME",
        "ZDOTDIR",
        "XDG_CONFIG_HOME",
        "APPDATA",
        "PATH",
    ];
    let probe = match shell_name {
        "pwsh" | "powershell" => keys
            .iter()
            .map(|key| format!("Write-Output ('__DCH_ENV_{}__=' + $env:{})", key, key))
            .collect::<Vec<_>>()
            .join("; "),
        "fish" => keys
            .iter()
            .map(|key| {
                format!(
                    "if set -q {0}; echo '__DCH_ENV_{0}__='${0}; else; echo '__DCH_ENV_{0}__='; end",
                    key
                )
            })
            .collect::<Vec<_>>()
            .join("; "),
        _ => "printf '__DCH_ENV_CODEX_HOME__=%s\\n' \"${CODEX_HOME-}\"; \
              printf '__DCH_ENV_GROK_HOME__=%s\\n' \"${GROK_HOME-}\"; \
              printf '__DCH_ENV_ZDOTDIR__=%s\\n' \"${ZDOTDIR-}\"; \
              printf '__DCH_ENV_XDG_CONFIG_HOME__=%s\\n' \"${XDG_CONFIG_HOME-}\"; \
              printf '__DCH_ENV_APPDATA__=%s\\n' \"${APPDATA-}\"; \
              printf '__DCH_ENV_PATH__=%s\\n' \"${PATH-}\""
            .to_string(),
    };
    let (args, wrapped) = shell_invocation(shell_name, &probe);
    let mut command = Command::new(&shell);
    command.args(args).arg(wrapped);
    let output = match spawn_with_timeout(command, Duration::from_secs(5)) {
        Ok(output) => output,
        Err(_) => return HashMap::new(),
    };
    parse_login_environment(&String::from_utf8_lossy(&output.stdout))
}

fn parse_login_environment(text: &str) -> HashMap<String, String> {
    let mut values = HashMap::new();
    for line in text.lines() {
        let Some(rest) = line.strip_prefix("__DCH_ENV_") else {
            continue;
        };
        let Some((key, value)) = rest.split_once("__=") else {
            continue;
        };
        if !value.is_empty() {
            values.insert(key.to_string(), value.to_string());
        }
    }
    values
}

fn env_value(login: &HashMap<String, String>, key: &str) -> Option<String> {
    login
        .get(key)
        .cloned()
        .or_else(|| std::env::var(key).ok())
        .filter(|value| !value.is_empty())
}

fn query_power_shell_profiles(
    binary: &str,
    product: &str,
    search_path: Option<&str>,
) -> Vec<PowerShellProfileLocation> {
    let mut command = Command::new(binary);
    if let Some(path) = search_path {
        command.env("PATH", path);
    }
    command.args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new(); Write-Output $PROFILE.CurrentUserAllHosts; Write-Output $PROFILE.CurrentUserCurrentHost",
    ]);
    let output = match spawn_with_timeout(command, Duration::from_secs(3)) {
        Ok(output) if output.code == 0 => output,
        _ => return Vec::new(),
    };
    let paths = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    if paths.len() < 2 {
        return Vec::new();
    }
    vec![
        PowerShellProfileLocation {
            label: format!("{} · CurrentUserAllHosts", product),
            path: paths[0].clone(),
        },
        PowerShellProfileLocation {
            label: format!("{} · CurrentUserCurrentHost", product),
            path: paths[1].clone(),
        },
    ]
}

fn fallback_windows_profiles(home: &str) -> Vec<PowerShellProfileLocation> {
    let base = PathBuf::from(home)
        .join("Documents")
        .join("WindowsPowerShell");
    vec![
        PowerShellProfileLocation {
            label: "Windows PowerShell · CurrentUserAllHosts".to_string(),
            path: base.join("profile.ps1").to_string_lossy().into_owned(),
        },
        PowerShellProfileLocation {
            label: "Windows PowerShell · CurrentUserCurrentHost".to_string(),
            path: base
                .join("Microsoft.PowerShell_profile.ps1")
                .to_string_lossy()
                .into_owned(),
        },
    ]
}

fn existing_power_shell_profiles(
    product: &str,
    directory: PathBuf,
) -> Vec<PowerShellProfileLocation> {
    [
        ("CurrentUserAllHosts", directory.join("profile.ps1")),
        (
            "CurrentUserCurrentHost",
            directory.join("Microsoft.PowerShell_profile.ps1"),
        ),
    ]
    .into_iter()
    .filter(|(_, path)| path.exists())
    .map(|(scope, path)| PowerShellProfileLocation {
        label: format!("{} · {}", product, scope),
        path: path.to_string_lossy().into_owned(),
    })
    .collect()
}

fn command_available(binary: &str, search_path: Option<&str>) -> bool {
    let mut command = Command::new(binary);
    if let Some(path) = search_path {
        command.env("PATH", path);
    }
    command.arg("--version");
    spawn_with_timeout(command, Duration::from_secs(2))
        .map(|output| output.code == 0)
        .unwrap_or(false)
}

fn resolve_config_environment() -> ConfigEnvironment {
    let home = home_dir();
    let login = login_environment();
    let search_path = env_value(&login, "PATH");
    let power_shell_profiles = if cfg!(target_os = "windows") {
        let windows_power_shell =
            query_power_shell_profiles("powershell", "Windows PowerShell", search_path.as_deref());
        let power_shell_7 =
            query_power_shell_profiles("pwsh", "PowerShell 7", search_path.as_deref());
        let mut profiles = if windows_power_shell.is_empty() {
            fallback_windows_profiles(&home)
        } else {
            windows_power_shell
        };
        profiles.extend(if power_shell_7.is_empty() {
            existing_power_shell_profiles(
                "PowerShell 7",
                PathBuf::from(&home).join("Documents").join("PowerShell"),
            )
        } else {
            power_shell_7
        });
        profiles
    } else {
        let power_shell = query_power_shell_profiles("pwsh", "PowerShell", search_path.as_deref());
        if power_shell.is_empty() {
            existing_power_shell_profiles(
                "PowerShell",
                PathBuf::from(&home).join(".config").join("powershell"),
            )
        } else {
            power_shell
        }
    };
    let shell = get_user_shell();
    let fish_installed =
        shell_basename(&shell) == "fish" || command_available("fish", search_path.as_deref());

    ConfigEnvironment {
        home,
        platform: platform_name(),
        codex_home: env_value(&login, "CODEX_HOME"),
        grok_home: env_value(&login, "GROK_HOME"),
        zdotdir: env_value(&login, "ZDOTDIR"),
        xdg_config_home: env_value(&login, "XDG_CONFIG_HOME"),
        app_data: env_value(&login, "APPDATA"),
        fish_installed,
        power_shell_profiles,
    }
}

fn config_environment() -> &'static ConfigEnvironment {
    static VALUE: OnceLock<ConfigEnvironment> = OnceLock::new();
    VALUE.get_or_init(resolve_config_environment)
}

fn expanded_root(value: Option<&String>, home: &str) -> Option<PathBuf> {
    let value = value?.trim();
    if value.is_empty() {
        return None;
    }
    if value == "~" {
        return Some(PathBuf::from(home));
    }
    if let Some(rest) = value
        .strip_prefix("~/")
        .or_else(|| value.strip_prefix("~\\"))
    {
        return Some(PathBuf::from(home).join(rest));
    }
    Some(PathBuf::from(value))
}

fn known_config_files_for(env: &ConfigEnvironment) -> Vec<PathBuf> {
    let home = PathBuf::from(&env.home);
    let codex =
        expanded_root(env.codex_home.as_ref(), &env.home).unwrap_or_else(|| home.join(".codex"));
    let grok =
        expanded_root(env.grok_home.as_ref(), &env.home).unwrap_or_else(|| home.join(".grok"));
    let cursor = home.join(".cursor");
    let mut files = Vec::new();

    if env.platform == "win32" {
        files.extend(
            env.power_shell_profiles
                .iter()
                .map(|profile| PathBuf::from(&profile.path)),
        );
    } else {
        let zsh = expanded_root(env.zdotdir.as_ref(), &env.home).unwrap_or_else(|| home.clone());
        files.extend([".zshenv", ".zprofile", ".zshrc"].map(|name| zsh.join(name)));
        files.extend([".bash_profile", ".bashrc", ".profile"].map(|name| home.join(name)));
        let xdg = expanded_root(env.xdg_config_home.as_ref(), &env.home)
            .unwrap_or_else(|| home.join(".config"));
        files.push(xdg.join("fish").join("config.fish"));
        files.extend(
            env.power_shell_profiles
                .iter()
                .map(|profile| PathBuf::from(&profile.path)),
        );
    }

    files.extend([
        home.join(".claude").join("settings.json"),
        home.join(".claude").join("CLAUDE.md"),
        codex.join("config.toml"),
        codex.join("AGENTS.override.md"),
        codex.join("AGENTS.md"),
        grok.join("config.toml"),
        grok.join("AGENTS.md"),
        grok.join("managed_config.toml"),
        grok.join("requirements.toml"),
        cursor.join("mcp.json"),
        cursor.join("cli-config.json"),
        cursor.join("hooks.json"),
    ]);

    let cursor_user = match env.platform {
        "darwin" => home
            .join("Library")
            .join("Application Support")
            .join("Cursor")
            .join("User"),
        "win32" => expanded_root(env.app_data.as_ref(), &env.home)
            .unwrap_or_else(|| home.join("AppData").join("Roaming"))
            .join("Cursor")
            .join("User"),
        _ => expanded_root(env.xdg_config_home.as_ref(), &env.home)
            .unwrap_or_else(|| home.join(".config"))
            .join("Cursor")
            .join("User"),
    };
    files.push(cursor_user.join("settings.json"));
    files.push(cursor_user.join("keybindings.json"));
    files
}

fn known_profile_roots_for(env: &ConfigEnvironment) -> Vec<PathBuf> {
    let home = PathBuf::from(&env.home);
    vec![
        home.join(".claude"),
        expanded_root(env.codex_home.as_ref(), &env.home).unwrap_or_else(|| home.join(".codex")),
        expanded_root(env.grok_home.as_ref(), &env.home).unwrap_or_else(|| home.join(".grok")),
        home.join(".cursor"),
    ]
}

pub(crate) fn is_known_config_file(path: &Path) -> bool {
    known_config_files_for(config_environment())
        .iter()
        .any(|known| known == path)
}

pub(crate) fn is_known_profile_root(path: &Path) -> bool {
    known_profile_roots_for(config_environment())
        .iter()
        .any(|known| known == path)
}

pub(crate) fn canonical_known_config_file(path: &Path) -> bool {
    known_config_files_for(config_environment())
        .iter()
        .any(|known| {
            if let Ok(canonical) = std::fs::canonicalize(known) {
                return canonical == path;
            }
            let Some(parent) = known.parent() else {
                return false;
            };
            let Some(name) = known.file_name() else {
                return false;
            };
            std::fs::canonicalize(parent)
                .map(|canonical_parent| canonical_parent.join(name) == path)
                .unwrap_or(false)
        })
}

#[tauri::command]
pub async fn get_config_environment() -> Result<ConfigEnvironment, String> {
    tauri::async_runtime::spawn_blocking(|| config_environment().clone())
        .await
        .map_err(|e| format!("get_config_environment worker failed: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mac_env() -> ConfigEnvironment {
        ConfigEnvironment {
            home: "/Users/test".to_string(),
            platform: "darwin",
            codex_home: Some("~/tool-roots/codex".to_string()),
            grok_home: Some("/Volumes/config/grok".to_string()),
            zdotdir: Some("~/.config/zsh".to_string()),
            xdg_config_home: None,
            app_data: None,
            fish_installed: true,
            power_shell_profiles: Vec::new(),
        }
    }

    #[test]
    fn parses_only_non_empty_probe_values() {
        let parsed = parse_login_environment(
            "noise\n__DCH_ENV_CODEX_HOME__=/tmp/codex\n__DCH_ENV_GROK_HOME__=\n",
        );
        assert_eq!(
            parsed.get("CODEX_HOME").map(String::as_str),
            Some("/tmp/codex")
        );
        assert!(!parsed.contains_key("GROK_HOME"));
    }

    #[test]
    fn known_files_follow_custom_roots_without_project_paths() {
        let files = known_config_files_for(&mac_env());
        assert!(files.contains(&PathBuf::from("/Users/test/tool-roots/codex/config.toml")));
        assert!(files.contains(&PathBuf::from("/Volumes/config/grok/AGENTS.md")));
        assert!(files.contains(&PathBuf::from("/Volumes/config/grok/requirements.toml")));
        assert!(files.contains(&PathBuf::from("/Users/test/.config/zsh/.zshrc")));
        assert!(!files
            .iter()
            .any(|path| path.to_string_lossy().contains("/.cursor/rules")));
    }

    #[test]
    fn profile_roots_cover_four_switchable_tools() {
        assert_eq!(
            known_profile_roots_for(&mac_env()),
            vec![
                PathBuf::from("/Users/test/.claude"),
                PathBuf::from("/Users/test/tool-roots/codex"),
                PathBuf::from("/Volumes/config/grok"),
                PathBuf::from("/Users/test/.cursor"),
            ]
        );
    }
}
