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
const BACKUP_CLAUDE: &str = "backup_claude";
const BACKUP_CLAUDE_DESKTOP: &str = "backup_claude_desktop";
const BACKUP_CODEX: &str = "backup_codex";
const BACKUP_GEMINI: &str = "backup_gemini";

pub fn enable(db: &Arc<Db>) -> Result<(), AppError> {
    backup_all(db)?;
    apply_all()?;
    db.set_setting(SETTING_ENABLED, "true")?;
    log::info!("proxy mode enabled");
    Ok(())
}

pub fn disable(db: &Arc<Db>) -> Result<(), AppError> {
    restore_all(db)?;
    db.set_setting(SETTING_ENABLED, "false")?;
    log::info!("proxy mode disabled");
    Ok(())
}

pub fn is_enabled(db: &Arc<Db>) -> Result<bool, AppError> {
    Ok(db.get_setting(SETTING_ENABLED)?.as_deref() == Some("true"))
}

/// On startup, if proxy mode was enabled before shutdown, re-apply configs.
pub fn restore_on_startup(db: &Arc<Db>) {
    match is_enabled(db) {
        Ok(true) => {
            if let Err(e) = apply_all() {
                log::warn!("proxy mode startup re-apply failed: {e}");
            } else {
                log::info!("proxy mode re-applied on startup");
            }
        }
        Ok(false) => {}
        Err(e) => log::warn!("proxy mode startup check failed: {e}"),
    }
}

fn backup_all(db: &Arc<Db>) -> Result<(), AppError> {
    if claude::is_installed() {
        db.set_backup(BACKUP_CLAUDE, &claude::read_config_json()?)?;
    }
    if claude_desktop::is_installed() {
        db.set_backup(BACKUP_CLAUDE_DESKTOP, &claude_desktop::read_config_json()?)?;
    }
    if codex::is_installed() {
        db.set_backup(BACKUP_CODEX, &codex::read_config_json()?)?;
    }
    if gemini::is_installed() {
        db.set_backup(BACKUP_GEMINI, &gemini::read_config_json()?)?;
    }
    Ok(())
}

fn apply_all() -> Result<(), AppError> {
    if claude::is_installed() { claude::apply_x402()?; }
    if claude_desktop::is_installed() { claude_desktop::apply_x402()?; }
    if codex::is_installed() { codex::apply_x402()?; }
    if gemini::is_installed() { gemini::apply_x402()?; }
    Ok(())
}

fn restore_all(db: &Arc<Db>) -> Result<(), AppError> {
    if let Some(json) = db.get_backup(BACKUP_CLAUDE)? {
        claude::restore_config_json(&json)?;
        db.delete_backup(BACKUP_CLAUDE)?;
    }
    if let Some(json) = db.get_backup(BACKUP_CLAUDE_DESKTOP)? {
        claude_desktop::restore_config_json(&json)?;
        db.delete_backup(BACKUP_CLAUDE_DESKTOP)?;
    }
    if let Some(json) = db.get_backup(BACKUP_CODEX)? {
        codex::restore_config_json(&json)?;
        db.delete_backup(BACKUP_CODEX)?;
    }
    if let Some(json) = db.get_backup(BACKUP_GEMINI)? {
        gemini::restore_config_json(&json)?;
        db.delete_backup(BACKUP_GEMINI)?;
    }
    Ok(())
}
