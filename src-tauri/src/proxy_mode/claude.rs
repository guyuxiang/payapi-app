//! Claude Code config: ~/.claude/settings.json

use crate::error::AppError;
use serde_json::{json, Value};
use std::path::PathBuf;

const X402_PROXY_URL: &str = "http://127.0.0.1:8402";

pub fn is_installed() -> bool {
    binary_in_path("claude") || settings_path().parent().map(|p| p.exists()).unwrap_or(false)
}

fn binary_in_path(name: &str) -> bool {
    #[cfg(windows)]
    let checker = "where";
    #[cfg(not(windows))]
    let checker = "which";
    std::process::Command::new(checker).arg(name).output()
        .map(|o| o.status.success()).unwrap_or(false)
}

pub fn settings_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".claude")
        .join("settings.json")
}

pub fn read_config_json() -> Result<String, AppError> {
    let path = settings_path();
    let v = if path.exists() {
        let raw = std::fs::read_to_string(&path).map_err(|e| AppError::io(&path, e))?;
        serde_json::from_str::<Value>(&raw).unwrap_or(json!({}))
    } else {
        json!({})
    };
    serde_json::to_string(&v).map_err(|e| AppError::msg(e.to_string()))
}

pub fn restore_config_json(json_str: &str) -> Result<(), AppError> {
    let v: Value = serde_json::from_str(json_str)
        .map_err(|e| AppError::msg(format!("parse claude backup: {e}")))?;
    write_settings(&v)
}

pub fn apply_x402() -> Result<(), AppError> {
    let path = settings_path();
    let mut settings = if path.exists() {
        let raw = std::fs::read_to_string(&path).map_err(|e| AppError::io(&path, e))?;
        serde_json::from_str::<Value>(&raw).unwrap_or(json!({}))
    } else {
        json!({})
    };
    if let Some(obj) = settings.as_object_mut() {
        let env = obj.entry("env").or_insert(json!({}));
        if let Some(env_obj) = env.as_object_mut() {
            env_obj.insert("ANTHROPIC_BASE_URL".to_string(), json!(X402_PROXY_URL));
            env_obj.insert("ANTHROPIC_AUTH_TOKEN".to_string(), json!("x402"));
        }
    }
    write_settings(&settings)
}

fn write_settings(v: &Value) -> Result<(), AppError> {
    super::util::atomic_write_json(&settings_path(), v)
}
