//! Local BIP-39 wallet for x402 payment signing.
//!
//! Stored at ~/.payapi/wallet.json with 0600 permissions.

use alloy_signer_local::coins_bip39::{English, Mnemonic};
use alloy_signer_local::{MnemonicBuilder, PrivateKeySigner};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const DERIVATION_PATH: &str = "m/44'/60'/0'/0/0";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletInfo {
    pub address: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct WalletFile {
    mnemonic: String,
    address: String,
    created_at: String,
}

pub struct WalletManager {
    path: PathBuf,
}

impl WalletManager {
    pub fn new() -> Self {
        let path = wallet_path();
        Self { path }
    }

    #[cfg(test)]
    pub fn with_path(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn exists(&self) -> bool {
        self.path.exists()
    }

    pub fn create(&self) -> Result<WalletInfo, String> {
        if self.exists() {
            return Err("wallet already exists".into());
        }
        let mut rng = rand::thread_rng();
        let mnemonic = Mnemonic::<English>::new_with_count(&mut rng, 12)
            .map_err(|e| format!("generate mnemonic: {e}"))?;
        self.persist(&mnemonic.to_phrase())
    }

    pub fn import(&self, phrase: &str) -> Result<WalletInfo, String> {
        let _ = Self::signer_from_phrase(phrase)?;
        self.persist(phrase.trim())
    }

    pub fn load_info(&self) -> Result<WalletInfo, String> {
        let f = self.read_file()?;
        Ok(WalletInfo { address: f.address, created_at: f.created_at })
    }

    pub fn export(&self) -> Result<String, String> {
        Ok(self.read_file()?.mnemonic)
    }

    pub fn signer(&self) -> Result<PrivateKeySigner, String> {
        let f = self.read_file()?;
        Self::signer_from_phrase(&f.mnemonic)
    }

    pub fn address(&self) -> Result<String, String> {
        Ok(self.read_file()?.address)
    }

    fn signer_from_phrase(phrase: &str) -> Result<PrivateKeySigner, String> {
        MnemonicBuilder::<English>::default()
            .phrase(phrase.trim())
            .derivation_path(DERIVATION_PATH)
            .map_err(|e| format!("derivation path: {e}"))?
            .build()
            .map_err(|e| format!("invalid mnemonic: {e}"))
    }

    fn persist(&self, phrase: &str) -> Result<WalletInfo, String> {
        let signer = Self::signer_from_phrase(phrase)?;
        let address = signer.address().to_string();
        let created_at = chrono::Utc::now().to_rfc3339();
        let file = WalletFile {
            mnemonic: phrase.to_string(),
            address: address.clone(),
            created_at: created_at.clone(),
        };
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("create dir: {e}"))?;
        }
        let json = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
        std::fs::write(&self.path, json).map_err(|e| format!("write wallet: {e}"))?;
        self.restrict_permissions();
        Ok(WalletInfo { address, created_at })
    }

    fn read_file(&self) -> Result<WalletFile, String> {
        let data = std::fs::read_to_string(&self.path)
            .map_err(|_| "no wallet found; create or import one first".to_string())?;
        serde_json::from_str(&data).map_err(|e| format!("corrupt wallet file: {e}"))
    }

    #[cfg(unix)]
    fn restrict_permissions(&self) {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&self.path, std::fs::Permissions::from_mode(0o600));
    }

    #[cfg(not(unix))]
    fn restrict_permissions(&self) {}
}

pub fn wallet_path() -> PathBuf {
    // ~/.config/payapi (Linux), %APPDATA%\payapi (Windows), ~/Library/Application Support/payapi (Mac)
    dirs::config_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")))
        .join("payapi")
        .join("wallet.json")
}
