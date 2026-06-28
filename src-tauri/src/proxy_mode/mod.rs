//! 代理模式: backs up AI tool configs, writes x402 proxy settings.
//! Enable: backup → apply. Disable: restore from backup.

pub mod claude;
pub mod claude_desktop;
pub mod codex;
pub mod gemini;
pub(super) mod util;

use crate::error::AppError;
use crate::store::Db;
use std::sync::Arc;

const SETTING_ENABLED: &str = "proxy_mode_enabled";
const SETTING_TOOLS: &str = "proxy_tools";
const BACKUP_CLAUDE: &str = "backup_claude";
const BACKUP_CLAUDE_DESKTOP: &str = "backup_claude_desktop";
const BACKUP_CODEX: &str = "backup_codex";
const BACKUP_GEMINI: &str = "backup_gemini";

#[cfg(windows)]
pub(super) const X402_PROXY_URL: &str = "http://localhost:8402";
#[cfg(not(windows))]
pub(super) const X402_PROXY_URL: &str = "http://127.0.0.1:8402";

/// Returns the user-selected tool keys, defaulting to all tools.
pub fn get_enabled_tools(db: &Arc<Db>) -> Vec<String> {
    db.get_setting(SETTING_TOOLS)
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_else(|| {
            vec![
                "claude".into(),
                "claude_desktop".into(),
                "codex".into(),
                "gemini".into(),
            ]
        })
}

pub fn set_enabled_tools(db: &Arc<Db>, tools: &[String]) -> Result<(), AppError> {
    let json = serde_json::to_string(tools).map_err(|e| AppError::msg(e.to_string()))?;
    db.set_setting(SETTING_TOOLS, &json)
}

pub fn enable(db: &Arc<Db>) -> Result<(), AppError> {
    let tools = get_enabled_tools(db);
    backup_selected(db, &tools)?;
    apply_selected(&tools)?;
    db.set_setting(SETTING_ENABLED, "true")?;
    log::info!("proxy mode enabled (tools: {tools:?})");
    Ok(())
}

pub fn disable(db: &Arc<Db>) -> Result<(), AppError> {
    let tools = get_enabled_tools(db);
    restore_selected(db, &tools)?;
    db.set_setting(SETTING_ENABLED, "false")?;
    log::info!("proxy mode disabled");
    Ok(())
}

pub fn is_enabled(db: &Arc<Db>) -> Result<bool, AppError> {
    Ok(db.get_setting(SETTING_ENABLED)?.as_deref() == Some("true"))
}

/// Apply x402 config for a single tool (with backup). Used for live checkbox toggle.
pub fn apply_tool(db: &Arc<Db>, key: &str) -> Result<(), AppError> {
    match key {
        "claude" if claude::is_installed() => {
            db.set_backup(BACKUP_CLAUDE, &claude::read_config_json()?)?;
            claude::apply_x402()?;
        }
        "claude_desktop" if claude_desktop::is_installed() => {
            db.set_backup(BACKUP_CLAUDE_DESKTOP, &claude_desktop::read_config_json()?)?;
            claude_desktop::apply_x402()?;
        }
        "codex" if codex::is_installed() => {
            db.set_backup(BACKUP_CODEX, &codex::read_config_json()?)?;
            codex::apply_x402()?;
        }
        "gemini" if gemini::is_installed() => {
            db.set_backup(BACKUP_GEMINI, &gemini::read_config_json()?)?;
            gemini::apply_x402()?;
        }
        _ => {}
    }
    Ok(())
}

/// Restore a single tool's original config from backup. Used for live checkbox toggle.
pub fn restore_tool(db: &Arc<Db>, key: &str) -> Result<(), AppError> {
    match key {
        "claude" => {
            if let Some(json) = db.get_backup(BACKUP_CLAUDE)? {
                claude::restore_config_json(&json)?;
                db.delete_backup(BACKUP_CLAUDE)?;
            }
        }
        "claude_desktop" => {
            if let Some(json) = db.get_backup(BACKUP_CLAUDE_DESKTOP)? {
                claude_desktop::restore_config_json(&json)?;
                db.delete_backup(BACKUP_CLAUDE_DESKTOP)?;
            }
        }
        "codex" => {
            if let Some(json) = db.get_backup(BACKUP_CODEX)? {
                codex::restore_config_json(&json)?;
                db.delete_backup(BACKUP_CODEX)?;
            }
        }
        "gemini" => {
            if let Some(json) = db.get_backup(BACKUP_GEMINI)? {
                gemini::restore_config_json(&json)?;
                db.delete_backup(BACKUP_GEMINI)?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// On startup, if proxy mode was enabled before shutdown, re-apply configs.
pub fn restore_on_startup(db: &Arc<Db>) {
    match is_enabled(db) {
        Ok(true) => {
            let tools = get_enabled_tools(db);
            if let Err(e) = apply_selected(&tools) {
                log::warn!("proxy mode startup re-apply failed: {e}");
            } else {
                log::info!("proxy mode re-applied on startup");
            }
        }
        Ok(false) => {}
        Err(e) => log::warn!("proxy mode startup check failed: {e}"),
    }
}

fn backup_selected(db: &Arc<Db>, tools: &[String]) -> Result<(), AppError> {
    if tools.contains(&"claude".into()) && claude::is_installed() {
        db.set_backup(BACKUP_CLAUDE, &claude::read_config_json()?)?;
    }
    if tools.contains(&"claude_desktop".into()) && claude_desktop::is_installed() {
        db.set_backup(BACKUP_CLAUDE_DESKTOP, &claude_desktop::read_config_json()?)?;
    }
    if tools.contains(&"codex".into()) && codex::is_installed() {
        db.set_backup(BACKUP_CODEX, &codex::read_config_json()?)?;
    }
    if tools.contains(&"gemini".into()) && gemini::is_installed() {
        db.set_backup(BACKUP_GEMINI, &gemini::read_config_json()?)?;
    }
    Ok(())
}

fn apply_selected(tools: &[String]) -> Result<(), AppError> {
    if tools.contains(&"claude".into()) && claude::is_installed() {
        claude::apply_x402()?;
    }
    if tools.contains(&"claude_desktop".into()) && claude_desktop::is_installed() {
        claude_desktop::apply_x402()?;
    }
    if tools.contains(&"codex".into()) && codex::is_installed() {
        codex::apply_x402()?;
    }
    if tools.contains(&"gemini".into()) && gemini::is_installed() {
        gemini::apply_x402()?;
    }
    Ok(())
}

fn restore_selected(db: &Arc<Db>, tools: &[String]) -> Result<(), AppError> {
    if tools.contains(&"claude".into()) {
        if let Some(json) = db.get_backup(BACKUP_CLAUDE)? {
            claude::restore_config_json(&json)?;
            db.delete_backup(BACKUP_CLAUDE)?;
        }
    }
    if tools.contains(&"claude_desktop".into()) {
        if let Some(json) = db.get_backup(BACKUP_CLAUDE_DESKTOP)? {
            claude_desktop::restore_config_json(&json)?;
            db.delete_backup(BACKUP_CLAUDE_DESKTOP)?;
        }
    }
    if tools.contains(&"codex".into()) {
        if let Some(json) = db.get_backup(BACKUP_CODEX)? {
            codex::restore_config_json(&json)?;
            db.delete_backup(BACKUP_CODEX)?;
        }
    }
    if tools.contains(&"gemini".into()) {
        if let Some(json) = db.get_backup(BACKUP_GEMINI)? {
            gemini::restore_config_json(&json)?;
            db.delete_backup(BACKUP_GEMINI)?;
        }
    }
    Ok(())
}
