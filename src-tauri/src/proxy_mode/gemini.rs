//! Gemini CLI config: ~/.gemini/.env

use crate::error::AppError;
use std::collections::HashMap;
use std::path::PathBuf;

const X402_PROXY_URL: &str = "http://127.0.0.1:8402";

pub fn is_installed() -> bool {
    binary_in_path("gemini") || gemini_dir().exists()
}

fn binary_in_path(name: &str) -> bool {
    #[cfg(windows)]
    let checker = "where";
    #[cfg(not(windows))]
    let checker = "which";
    std::process::Command::new(checker).arg(name).output()
        .map(|o| o.status.success()).unwrap_or(false)
}

pub fn gemini_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".gemini")
}

pub fn env_path() -> PathBuf {
    gemini_dir().join(".env")
}

pub fn read_config_json() -> Result<String, AppError> {
    let map = read_env_map()?;
    serde_json::to_string(&map).map_err(|e| AppError::msg(e.to_string()))
}

pub fn restore_config_json(json_str: &str) -> Result<(), AppError> {
    let map: HashMap<String, String> = serde_json::from_str(json_str)
        .map_err(|e| AppError::msg(format!("parse gemini backup: {e}")))?;
    write_env_map(&map)
}

pub fn apply_x402() -> Result<(), AppError> {
    let mut map = read_env_map().unwrap_or_default();
    map.insert("GEMINI_API_KEY".to_string(), "x402".to_string());
    map.insert("GOOGLE_GEMINI_BASE_URL".to_string(), X402_PROXY_URL.to_string());
    write_env_map(&map)
}

fn read_env_map() -> Result<HashMap<String, String>, AppError> {
    let path = env_path();
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| AppError::io(&path, e))?;
    Ok(parse_env(&content))
}

fn write_env_map(map: &HashMap<String, String>) -> Result<(), AppError> {
    let content: String = map.iter().map(|(k, v)| format!("{k}={v}\n")).collect();
    super::util::atomic_write_text(&env_path(), &content)
}

fn parse_env(content: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            let k = k.trim();
            let v = v.trim();
            if !k.is_empty() && k.chars().all(|c| c.is_alphanumeric() || c == '_') {
                map.insert(k.to_string(), v.to_string());
            }
        }
    }
    map
}
