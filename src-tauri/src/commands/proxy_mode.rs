//! Tauri commands: 代理模式 (proxy mode) enable/disable/status.

use crate::store::Db;
use serde::Serialize;
use std::sync::Arc;
use tauri::State;

#[derive(Serialize)]
pub struct ToolDetection {
    pub claude: bool,
    pub claude_desktop: bool,
    pub codex: bool,
    pub gemini: bool,
}

#[tauri::command]
pub fn x402_detect_tools() -> ToolDetection {
    ToolDetection {
        claude:         crate::proxy_mode::claude::is_installed(),
        claude_desktop: crate::proxy_mode::claude_desktop::is_installed(),
        codex:          crate::proxy_mode::codex::is_installed(),
        gemini:         crate::proxy_mode::gemini::is_installed(),
    }
}

pub struct DbState(pub Arc<Db>);

#[tauri::command]
pub fn x402_proxy_mode_enable(state: State<'_, DbState>) -> Result<(), String> {
    crate::proxy_mode::enable(&state.0).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn x402_proxy_mode_disable(state: State<'_, DbState>) -> Result<(), String> {
    crate::proxy_mode::disable(&state.0).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn x402_proxy_mode_status(state: State<'_, DbState>) -> Result<bool, String> {
    crate::proxy_mode::is_enabled(&state.0).map_err(|e| e.to_string())
}
