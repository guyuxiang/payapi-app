//! Tauri commands: wallet, proxy start/stop.

use crate::wallet::balance::{format_usdc, usdc_balance};
use crate::wallet::{WalletInfo, WalletManager};
use alloy_primitives::Address;
use serde::Serialize;
use std::str::FromStr;

#[derive(Serialize)]
pub struct BalanceInfo {
    pub address: String,
    pub raw: String,
    pub usdc: String,
}

#[tauri::command]
pub fn x402_create_wallet() -> Result<WalletInfo, String> {
    WalletManager::new().create()
}

#[tauri::command]
pub fn x402_import_wallet(mnemonic: String) -> Result<WalletInfo, String> {
    WalletManager::new().import(&mnemonic)
}

#[tauri::command]
pub fn x402_export_mnemonic() -> Result<String, String> {
    WalletManager::new().export()
}

#[tauri::command]
pub fn x402_get_wallet() -> Result<Option<WalletInfo>, String> {
    let wm = WalletManager::new();
    if !wm.exists() {
        return Ok(None);
    }
    wm.load_info().map(Some)
}

#[tauri::command]
pub fn x402_get_address() -> Result<String, String> {
    WalletManager::new().address()
}

#[tauri::command]
pub async fn x402_get_balance(rpc_url: String, usdc_address: String) -> Result<BalanceInfo, String> {
    let address_str = WalletManager::new().address()?;
    let holder = Address::from_str(&address_str).map_err(|e| e.to_string())?;
    let usdc = Address::from_str(&usdc_address).map_err(|e| format!("bad usdc address: {e}"))?;
    let raw = usdc_balance(&rpc_url, usdc, holder).await?;
    Ok(BalanceInfo { address: address_str, raw: raw.to_string(), usdc: format_usdc(raw) })
}

#[tauri::command]
pub fn x402_start_proxy(server_url: String, port: Option<u16>) -> Result<u16, String> {
    crate::proxy::server::start(server_url, port.unwrap_or(8402))
}

#[tauri::command]
pub fn x402_stop_proxy() -> Result<(), String> {
    crate::proxy::server::stop()
}

#[tauri::command]
pub fn x402_proxy_status() -> Option<u16> {
    crate::proxy::server::status()
}

#[tauri::command]
pub async fn x402_get_history(server_url: String) -> Result<serde_json::Value, String> {
    let address = WalletManager::new().address()?;
    let base = server_url.trim_end_matches('/');
    let url = format!("{base}/v1/info/balance?address={address}");
    let resp = reqwest::Client::new()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("history request: {e}"))?;
    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| format!("history decode: {e}"))
}
