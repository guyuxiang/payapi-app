//! Simple SQLite store: settings key-value + tool config backup + local pay log.

use crate::error::AppError;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub struct Db {
    conn: Arc<Mutex<Connection>>,
}

impl Db {
    pub fn open(path: &PathBuf) -> Result<Self, AppError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| AppError::io(parent, e))?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch("
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS config_backup (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS pay_log (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at        TEXT    NOT NULL,
                path              TEXT    NOT NULL DEFAULT '',
                tool              TEXT    NOT NULL DEFAULT '',
                model             TEXT    NOT NULL DEFAULT '',
                amount_usdc       TEXT    NOT NULL DEFAULT '0',
                tx_hash           TEXT    NOT NULL DEFAULT '',
                prompt_tokens     INTEGER NOT NULL DEFAULT 0,
                completion_tokens INTEGER NOT NULL DEFAULT 0,
                duration_ms       INTEGER NOT NULL DEFAULT 0,
                input_tokens      INTEGER NOT NULL DEFAULT 0,
                cached_tokens     INTEGER NOT NULL DEFAULT 0,
                output_tokens     INTEGER NOT NULL DEFAULT 0,
                price_input       TEXT    NOT NULL DEFAULT '',
                price_cached      TEXT    NOT NULL DEFAULT '',
                price_output      TEXT    NOT NULL DEFAULT ''
            );
        ")?;
        Ok(Db { conn: Arc::new(Mutex::new(conn)) })
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, AppError> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        ).optional()?)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_backup(&self, key: &str) -> Result<Option<String>, AppError> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.query_row(
            "SELECT value FROM config_backup WHERE key = ?1",
            params![key],
            |row| row.get(0),
        ).optional()?)
    }

    pub fn set_backup(&self, key: &str, value: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO config_backup (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn delete_backup(&self, key: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM config_backup WHERE key = ?1", params![key])?;
        Ok(())
    }

    pub fn log_payment(&self, entry: &NewPayLog) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        // Add new columns to existing tables if they don't exist (migration).
        let _ = conn.execute_batch("
            ALTER TABLE pay_log ADD COLUMN input_tokens  INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE pay_log ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE pay_log ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE pay_log ADD COLUMN price_input   TEXT    NOT NULL DEFAULT '';
            ALTER TABLE pay_log ADD COLUMN price_cached  TEXT    NOT NULL DEFAULT '';
            ALTER TABLE pay_log ADD COLUMN price_output  TEXT    NOT NULL DEFAULT '';
        ");
        conn.execute(
            "INSERT INTO pay_log
             (created_at, path, tool, model, amount_usdc, tx_hash,
              prompt_tokens, completion_tokens, duration_ms,
              input_tokens, cached_tokens, output_tokens,
              price_input, price_cached, price_output)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                entry.created_at, entry.path, entry.tool, entry.model,
                entry.amount_usdc, entry.tx_hash,
                entry.prompt_tokens, entry.completion_tokens, entry.duration_ms,
                entry.input_tokens, entry.cached_tokens, entry.output_tokens,
                entry.price_input, entry.price_cached, entry.price_output,
            ],
        )?;
        Ok(())
    }

    pub fn get_pay_log(&self, limit: usize) -> Result<Vec<PayLogEntry>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, created_at, path, tool, model, amount_usdc, tx_hash,
                    prompt_tokens, completion_tokens, duration_ms,
                    input_tokens, cached_tokens, output_tokens,
                    price_input, price_cached, price_output
             FROM pay_log ORDER BY id DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit as i64], |row| {
            Ok(PayLogEntry {
                id:                row.get(0)?,
                created_at:        row.get(1)?,
                path:              row.get(2)?,
                tool:              row.get(3)?,
                model:             row.get(4)?,
                amount_usdc:       row.get(5)?,
                tx_hash:           row.get(6)?,
                prompt_tokens:     row.get(7)?,
                completion_tokens: row.get(8)?,
                duration_ms:       row.get(9)?,
                input_tokens:      row.get(10).unwrap_or(0),
                cached_tokens:     row.get(11).unwrap_or(0),
                output_tokens:     row.get(12).unwrap_or(0),
                price_input:       row.get(13).unwrap_or_default(),
                price_cached:      row.get(14).unwrap_or_default(),
                price_output:      row.get(15).unwrap_or_default(),
            })
        })?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }
}

pub struct NewPayLog {
    pub created_at:        String,
    pub path:              String,
    pub tool:              String,
    pub model:             String,
    pub amount_usdc:       String,
    pub tx_hash:           String,
    pub prompt_tokens:     i64,
    pub completion_tokens: i64,
    pub duration_ms:       i64,
    // From X-Usage-* / X-Price-* headers (zero/empty if server didn't provide)
    pub input_tokens:      i64,
    pub cached_tokens:     i64,
    pub output_tokens:     i64,
    pub price_input:       String,
    pub price_cached:      String,
    pub price_output:      String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PayLogEntry {
    pub id:                i64,
    pub created_at:        String,
    pub path:              String,
    pub tool:              String,
    pub model:             String,
    pub amount_usdc:       String,
    pub tx_hash:           String,
    pub prompt_tokens:     i64,
    pub completion_tokens: i64,
    pub duration_ms:       i64,
    pub input_tokens:      i64,
    pub cached_tokens:     i64,
    pub output_tokens:     i64,
    pub price_input:       String,
    pub price_cached:      String,
    pub price_output:      String,
}

pub fn db_path() -> PathBuf {
    app_data_dir().join("payapi-app.db")
}

fn app_data_dir() -> PathBuf {
    // ~/.config/payapi (Linux), %APPDATA%\payapi (Windows), ~/Library/Application Support/payapi (Mac)
    dirs::config_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")))
        .join("payapi")
}
