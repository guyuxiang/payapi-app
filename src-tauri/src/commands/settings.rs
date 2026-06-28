//! 持久化设置读写命令

use crate::commands::proxy_mode::DbState;
use tauri::State;

#[tauri::command]
pub fn x402_get_setting(state: State<'_, DbState>, key: String) -> Result<Option<String>, String> {
    state.0.get_setting(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn x402_set_setting(
    state: State<'_, DbState>,
    key: String,
    value: String,
) -> Result<(), String> {
    state.0.set_setting(&key, &value).map_err(|e| e.to_string())
}
