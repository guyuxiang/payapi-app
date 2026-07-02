//! Claude Desktop app config.
//!
//! macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
//! Windows: %LOCALAPPDATA%\Claude\claude_desktop_config.json
//!
//! Switching to 3p mode writes four files:
//!   {Claude dir}/claude_desktop_config.json          ← deploymentMode = "3p"
//!   {Claude-3p dir}/claude_desktop_config.json       ← deploymentMode = "3p"
//!   {Claude-3p dir}/configLibrary/{PROFILE_ID}.json  ← gateway profile
//!   {Claude-3p dir}/configLibrary/_meta.json         ← profile registry

use crate::error::AppError;
use serde_json::{json, Value};
use std::path::PathBuf;

use super::X402_PROXY_URL;

const PROFILE_ID: &str = "00000000-0000-4000-8000-000000157210";
const PROFILE_NAME: &str = "xPay x402";
const CONFIG_FILE: &str = "claude_desktop_config.json";
const CONFIG_LIB_DIR: &str = "configLibrary";

// ── platform paths ────────────────────────────────────────────────────────────

fn platform_claude_dir(_variant: &str) -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        return dirs::home_dir()
            .map(|h| h.join("Library").join("Application Support").join(_variant));
    }
    #[cfg(windows)]
    {
        return dirs::data_local_dir().map(|d| d.join(_variant));
    }
    #[allow(unreachable_code)]
    None
}

fn app_dir() -> Option<PathBuf> {
    platform_claude_dir("Claude")
}
fn app_3p_dir() -> Option<PathBuf> {
    platform_claude_dir("Claude-3p")
}

fn main_config_path() -> Option<PathBuf> {
    app_dir().map(|d| d.join(CONFIG_FILE))
}
fn config_3p_path() -> Option<PathBuf> {
    app_3p_dir().map(|d| d.join(CONFIG_FILE))
}
fn profile_path() -> Option<PathBuf> {
    app_3p_dir().map(|d| d.join(CONFIG_LIB_DIR).join(format!("{PROFILE_ID}.json")))
}
fn meta_path() -> Option<PathBuf> {
    app_3p_dir().map(|d| d.join(CONFIG_LIB_DIR).join("_meta.json"))
}

// ── public API ────────────────────────────────────────────────────────────────

pub fn is_installed() -> bool {
    main_config_path().map(|p| p.exists()).unwrap_or(false)
}

/// Snapshot all four files into a single JSON blob for backup.
pub fn read_config_json() -> Result<String, AppError> {
    let snap = json!({
        "main":    read_opt_text(&main_config_path()),
        "three_p": read_opt_text(&config_3p_path()),
        "profile": read_opt_text(&profile_path()),
        "meta":    read_opt_text(&meta_path()),
    });
    serde_json::to_string(&snap).map_err(|e| AppError::msg(e.to_string()))
}

pub fn restore_config_json(json_str: &str) -> Result<(), AppError> {
    let v: Value = serde_json::from_str(json_str)
        .map_err(|e| AppError::msg(format!("parse claude_desktop backup: {e}")))?;
    restore_file(&main_config_path(), v.get("main"))?;
    restore_file(&config_3p_path(), v.get("three_p"))?;
    restore_file(&profile_path(), v.get("profile"))?;
    restore_file(&meta_path(), v.get("meta"))?;
    Ok(())
}

pub fn apply_x402() -> Result<(), AppError> {
    let main_path = main_config_path()
        .ok_or_else(|| AppError::msg("Claude Desktop not supported on this OS"))?;
    let three_p_path = config_3p_path().unwrap();
    let p_path = profile_path().unwrap();
    let m_path = meta_path().unwrap();

    // 1. Set deploymentMode = "3p" in main config (preserve existing keys).
    let mut main_cfg = read_json(&main_path).unwrap_or(json!({}));
    main_cfg["deploymentMode"] = json!("3p");
    write_json(&main_path, &main_cfg)?;

    // 2. Create Claude-3p dir config.
    ensure_parent(&three_p_path)?;
    write_json(&three_p_path, &json!({ "deploymentMode": "3p" }))?;

    // 3. Write gateway profile.
    ensure_parent(&p_path)?;
    write_json(&p_path, &build_profile())?;

    // 4. Write profile registry.
    write_json(&m_path, &build_meta())?;

    Ok(())
}

// ── helpers ───────────────────────────────────────────────────────────────────

fn build_profile() -> Value {
    json!({
        "inferenceProvider": "gateway",
        "inferenceGatewayBaseUrl": X402_PROXY_URL,
        "inferenceGatewayApiKey": "x402",
        "inferenceGatewayAuthScheme": "bearer",
        "disableDeploymentModeChooser": true,
        "coworkEgressAllowedHosts": ["*"],
        "inferenceModels": [
            { "name": "claude-sonnet-4-6",        "labelOverride": "claude-sonnet-4-6 (xPay x402)",  "supports1m": true  },
            { "name": "claude-opus-4-8",           "labelOverride": "claude-opus-4-8 (xPay x402)",   "supports1m": true  },
            { "name": "claude-haiku-4-5-20251001", "labelOverride": "claude-haiku-4-5 (xPay x402)",  "supports1m": true  },
            { "name": "claude-fable-5",            "labelOverride": "claude-fable-5 (xPay x402)",    "supports1m": true  }
        ]
    })
}

fn build_meta() -> Value {
    json!({
        "appliedId": PROFILE_ID,
        "entries": [{ "id": PROFILE_ID, "name": PROFILE_NAME }]
    })
}

fn read_opt_text(path: &Option<PathBuf>) -> Value {
    path.as_ref()
        .and_then(|p| {
            if p.exists() {
                std::fs::read_to_string(p).ok()
            } else {
                None
            }
        })
        .map(Value::String)
        .unwrap_or(Value::Null)
}

fn read_json(path: &PathBuf) -> Option<Value> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

fn write_json(path: &PathBuf, v: &Value) -> Result<(), AppError> {
    super::util::atomic_write_json(path, v)
}

fn ensure_parent(path: &PathBuf) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError::io(parent, e))?;
    }
    Ok(())
}

/// Restore a single file from its backed-up Value (String = content, Null = didn't exist → delete).
fn restore_file(path: &Option<PathBuf>, val: Option<&Value>) -> Result<(), AppError> {
    let Some(path) = path else {
        return Ok(());
    };
    match val.and_then(|v| v.as_str()) {
        Some(content) => {
            ensure_parent(path)?;
            std::fs::write(path, content).map_err(|e| AppError::io(path, e))
        }
        None => {
            if path.exists() {
                std::fs::remove_file(path).map_err(|e| AppError::io(path, e))?;
            }
            Ok(())
        }
    }
}
