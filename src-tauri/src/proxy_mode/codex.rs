//! Codex CLI config: ~/.codex/auth.json + ~/.codex/config.toml

use crate::error::AppError;
use serde_json::{json, Value};
use std::path::PathBuf;

const X402_PROXY_URL: &str = "http://127.0.0.1:8402";

pub fn is_installed() -> bool {
    binary_in_path("codex") || codex_dir().exists() || desktop_app_exists()
}

fn desktop_app_exists() -> bool {
    #[cfg(target_os = "macos")]
    {
        std::path::Path::new("/Applications/Codex.app").exists()
    }
    #[cfg(windows)]
    {
        dirs::data_local_dir()
            .map(|d| d.join("Programs").join("Codex").join("Codex.exe").exists())
            .unwrap_or(false)
    }
    #[allow(unreachable_code)]
    false
}

fn binary_in_path(name: &str) -> bool {
    #[cfg(windows)]
    let checker = "where";
    #[cfg(not(windows))]
    let checker = "which";
    std::process::Command::new(checker).arg(name).output()
        .map(|o| o.status.success()).unwrap_or(false)
}

pub fn codex_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".codex")
}

pub fn auth_path() -> PathBuf {
    codex_dir().join("auth.json")
}

pub fn config_path() -> PathBuf {
    codex_dir().join("config.toml")
}

/// Read current codex config as JSON: `{"auth": {...}, "config": "...toml text..."}`.
pub fn read_config_json() -> Result<String, AppError> {
    let auth: Value = if auth_path().exists() {
        let raw = std::fs::read_to_string(auth_path())
            .map_err(|e| AppError::io(auth_path(), e))?;
        serde_json::from_str(&raw).unwrap_or(json!({}))
    } else {
        json!({})
    };
    let config_text = if config_path().exists() {
        std::fs::read_to_string(config_path())
            .map_err(|e| AppError::io(config_path(), e))?
    } else {
        String::new()
    };
    let v = json!({ "auth": auth, "config": config_text });
    serde_json::to_string(&v).map_err(|e| AppError::msg(e.to_string()))
}

pub fn restore_config_json(json_str: &str) -> Result<(), AppError> {
    let v: Value = serde_json::from_str(json_str)
        .map_err(|e| AppError::msg(format!("parse codex backup: {e}")))?;
    let auth = v.get("auth").cloned().unwrap_or(json!({}));
    let config_text = v.get("config").and_then(|c| c.as_str()).unwrap_or("").to_string();
    write_codex_atomic(&auth, if config_text.is_empty() { None } else { Some(&config_text) })
}

pub fn apply_x402() -> Result<(), AppError> {
    let existing = if config_path().exists() {
        std::fs::read_to_string(config_path()).unwrap_or_default()
    } else {
        String::new()
    };
    let x402_toml = inject_x402_into_config(&existing);
    let auth = json!({ "OPENAI_API_KEY": "x402" });
    write_codex_atomic(&auth, Some(&x402_toml))
}

/// Injects x402 provider fields into existing config.toml, preserving all other
/// sections (mcp_servers, projects, hooks, etc.) via toml_edit.
fn inject_x402_into_config(existing: &str) -> String {
    use toml_edit::{DocumentMut, Item, Table};

    let mut doc = if existing.is_empty() {
        DocumentMut::new()
    } else {
        existing.parse::<DocumentMut>().unwrap_or_else(|_| DocumentMut::new())
    };

    doc["model_provider"] = toml_edit::value("custom");
    doc["disable_response_storage"] = toml_edit::value(true);

    if doc.get("model_providers").is_none() {
        let mut parent = Table::new();
        parent.set_implicit(true);
        doc["model_providers"] = Item::Table(parent);
    }
    if let Some(providers) = doc["model_providers"].as_table_mut() {
        let mut custom = Table::new();
        custom["name"] = toml_edit::value("PayApi x402");
        custom["base_url"] = toml_edit::value(X402_PROXY_URL);
        custom["wire_api"] = toml_edit::value("responses");
        custom["requires_openai_auth"] = toml_edit::value(true);
        providers.insert("custom", Item::Table(custom));
    }

    doc.to_string()
}

fn write_codex_atomic(auth: &Value, config_text: Option<&str>) -> Result<(), AppError> {
    // Write auth first; if config write fails, roll back auth.
    let auth_path = auth_path();
    let old_auth = if auth_path.exists() {
        std::fs::read(&auth_path).ok()
    } else {
        None
    };

    super::util::atomic_write_json(&auth_path, auth)?;

    if let Some(text) = config_text {
        if let Err(e) = super::util::atomic_write_text(&config_path(), text) {
            // Rollback auth.
            match old_auth {
                Some(bytes) => { let _ = std::fs::write(&auth_path, bytes); }
                None => { let _ = std::fs::remove_file(&auth_path); }
            }
            return Err(e);
        }
    }
    Ok(())
}
