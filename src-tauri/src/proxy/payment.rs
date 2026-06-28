//! Builds the X-PAYMENT header from a server 402 challenge.

use crate::wallet::signer::{self, Authorization};
use alloy_primitives::{Address, B256, U256};
use alloy_signer_local::PrivateKeySigner;
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Deserialize)]
pub struct PaymentRequirements {
    pub scheme: String,
    pub network: String,
    #[serde(rename = "maxAmountRequired")]
    pub max_amount_required: String,
    #[allow(dead_code)]
    #[serde(default)]
    pub resource: String,
    #[serde(rename = "payTo")]
    pub pay_to: String,
    #[serde(default)]
    pub asset: String,
    #[serde(rename = "maxTimeoutSeconds", default)]
    pub max_timeout_seconds: u64,
    #[serde(default)]
    pub extra: std::collections::HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
pub struct PaymentChallenge {
    #[allow(dead_code)]
    #[serde(rename = "x402Version")]
    pub x402_version: u32,
    pub accepts: Vec<PaymentRequirements>,
}

#[derive(Debug, Serialize)]
struct AuthorizationPayload {
    from: String,
    to: String,
    value: String,
    #[serde(rename = "validAfter")]
    valid_after: String,
    #[serde(rename = "validBefore")]
    valid_before: String,
    nonce: String,
}

#[derive(Debug, Serialize)]
struct ExactEvmPayload {
    signature: String,
    authorization: AuthorizationPayload,
}

#[derive(Debug, Serialize)]
struct PaymentPayload {
    #[serde(rename = "x402Version")]
    x402_version: u32,
    scheme: String,
    network: String,
    payload: ExactEvmPayload,
}

pub struct SignedPayment {
    pub header: String,
    pub request_id: String,
    pub amount_usd: String,
}

fn chain_id_from_network(network: &str) -> Result<u64, String> {
    network
        .strip_prefix("eip155:")
        .and_then(|s| s.parse::<u64>().ok())
        .ok_or_else(|| format!("unsupported network {network}"))
}

pub fn sign_challenge(
    challenge_json: &[u8],
    signer: &PrivateKeySigner,
) -> Result<SignedPayment, String> {
    let challenge: PaymentChallenge =
        serde_json::from_slice(challenge_json).map_err(|e| format!("parse challenge: {e}"))?;
    let req = challenge
        .accepts
        .into_iter()
        .find(|a| a.scheme == "exact")
        .ok_or("no supported 'exact' payment requirement")?;

    let chain_id = chain_id_from_network(&req.network)?;
    let usdc = Address::from_str(&req.asset).map_err(|e| format!("bad asset address: {e}"))?;
    let pay_to = Address::from_str(&req.pay_to).map_err(|e| format!("bad payTo address: {e}"))?;
    let value = U256::from_str(&req.max_amount_required).map_err(|e| format!("bad amount: {e}"))?;
    let request_id = req
        .extra
        .get("requestId")
        .cloned()
        .ok_or("challenge missing requestId")?;

    let domain_name = req
        .extra
        .get("name")
        .cloned()
        .unwrap_or_else(|| "USD Coin".to_string());
    let domain_version = req
        .extra
        .get("version")
        .cloned()
        .unwrap_or_else(|| "2".to_string());

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let window = if req.max_timeout_seconds == 0 {
        120
    } else {
        req.max_timeout_seconds
    };
    let valid_before = now + window;

    let nonce = B256::random();
    let auth = Authorization {
        from: signer.address(),
        to: pay_to,
        value,
        valid_after: U256::ZERO,
        valid_before: U256::from(valid_before),
        nonce,
    };

    let sig = signer::sign(signer, &auth, &domain_name, &domain_version, chain_id, usdc)?;

    let payload = PaymentPayload {
        x402_version: 1,
        scheme: "exact".into(),
        network: req.network.clone(),
        payload: ExactEvmPayload {
            signature: format!("0x{}", hex::encode(sig)),
            authorization: AuthorizationPayload {
                from: signer.address().to_string(),
                to: req.pay_to.clone(),
                value: req.max_amount_required.clone(),
                valid_after: "0".into(),
                valid_before: valid_before.to_string(),
                nonce: format!("0x{}", hex::encode(nonce.as_slice())),
            },
        },
    };

    let json = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    use base64::Engine;
    let header = base64::engine::general_purpose::STANDARD.encode(json);
    let amount_usd = crate::wallet::balance::format_usdc(value);
    Ok(SignedPayment {
        header,
        request_id,
        amount_usd,
    })
}
