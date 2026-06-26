//! USDC balance lookup via JSON-RPC eth_call.

use alloy_primitives::{Address, U256};
use serde_json::json;

pub async fn usdc_balance(rpc_url: &str, usdc: Address, holder: Address) -> Result<U256, String> {
    let mut data = String::from("0x70a08231");
    data.push_str(&format!("{:0>64}", hex::encode(holder.as_slice())));

    let body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_call",
        "params": [{ "to": format!("0x{}", hex::encode(usdc.as_slice())), "data": data }, "latest"]
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(rpc_url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("rpc request: {e}"))?;
    let v: serde_json::Value = resp.json().await.map_err(|e| format!("rpc decode: {e}"))?;

    if let Some(err) = v.get("error") {
        return Err(format!("rpc error: {err}"));
    }
    let result = v
        .get("result")
        .and_then(|r| r.as_str())
        .ok_or("rpc: missing result")?;
    let hexstr = result.trim_start_matches("0x");
    if hexstr.is_empty() {
        return Ok(U256::ZERO);
    }
    U256::from_str_radix(hexstr, 16).map_err(|e| format!("parse balance: {e}"))
}

pub fn format_usdc(units: U256) -> String {
    let divisor = U256::from(1_000_000u64);
    let whole = units / divisor;
    let frac = units % divisor;
    format!("{}.{:06}", whole, frac)
}
