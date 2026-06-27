mod commands;
mod error;
mod proxy;
mod proxy_mode;
mod store;
mod wallet;

use commands::proxy_mode::DbState;
use std::sync::Arc;
use store::{Db, db_path};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    log::info!("payapi-app starting, db={}", db_path().display());
    let db = Arc::new(Db::open(&db_path()).expect("open db"));
    log::info!("db opened");

    // Re-apply proxy mode on startup if it was left enabled.
    proxy_mode::restore_on_startup(&db);

    // Auto-start proxy if settings say so.
    if let Ok(Some(url)) = db.get_setting("server_url") {
        if !url.is_empty() {
            let port = db
                .get_setting("proxy_port")
                .ok()
                .flatten()
                .and_then(|s| s.parse::<u16>().ok())
                .unwrap_or(8402);
            log::info!("auto-starting proxy on port {port} -> {url}");
            match proxy::server::start(url, port, Arc::clone(&db)) {
                Ok(p)  => log::info!("proxy started on port {p}"),
                Err(e) => log::warn!("auto-start proxy failed: {e}"),
            }
        }
    }

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir { file_name: Some("payapi".into()) },
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                ))
                .build(),
        )
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(DbState(Arc::clone(&db)))
        .invoke_handler(tauri::generate_handler![
            // 代理
            commands::wallet::x402_start_proxy,
            commands::wallet::x402_stop_proxy,
            commands::wallet::x402_proxy_status,
            // 钱包
            commands::wallet::x402_create_wallet,
            commands::wallet::x402_import_wallet,
            commands::wallet::x402_export_mnemonic,
            commands::wallet::x402_get_wallet,
            commands::wallet::x402_get_address,
            commands::wallet::x402_get_balance,
            commands::wallet::x402_get_local_history,
            // 代理模式
            commands::proxy_mode::x402_proxy_mode_enable,
            commands::proxy_mode::x402_proxy_mode_disable,
            commands::proxy_mode::x402_proxy_mode_status,
            commands::proxy_mode::x402_detect_tools,
            commands::proxy_mode::x402_get_proxy_tools,
            commands::proxy_mode::x402_set_proxy_tools,
            commands::proxy_mode::x402_apply_tool,
            commands::proxy_mode::x402_restore_tool,
            // 设置
            commands::settings::x402_get_setting,
            commands::settings::x402_set_setting,
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri application");
}






