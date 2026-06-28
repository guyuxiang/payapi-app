//! x402 two-phase client: forward → 402 → sign → retry.

use crate::proxy::payment::{self, SignedPayment};
use alloy_signer_local::PrivateKeySigner;

pub struct ProxyResponse {
    pub status: u16,
    pub content_type: String,
    pub body: Vec<u8>,
    pub tx_hash: Option<String>,
    pub cost_usd: Option<String>,
    // Token usage breakdown from X-Usage-* headers
    pub usage_input: Option<i64>,
    pub usage_cached: Option<i64>,
    pub usage_output: Option<i64>,
    // Per-million-token prices from X-Price-* headers (USD string)
    pub price_input: Option<String>,
    pub price_cached: Option<String>,
    pub price_output: Option<String>,
}

pub async fn forward_with_x402(
    client: &reqwest::Client,
    url: &str,
    body: Vec<u8>,
    anthropic_version: Option<&str>,
    signer: &PrivateKeySigner,
) -> Result<ProxyResponse, String> {
    let first = post(client, url, &body, anthropic_version, None, None)
        .await
        .map_err(|e| format!("forward: {e}"))?;

    if first.status() != reqwest::StatusCode::PAYMENT_REQUIRED {
        return into_response(first, None, None).await;
    }

    let challenge = first.bytes().await.map_err(|e| e.to_string())?;
    let SignedPayment {
        header,
        request_id,
        amount_usd,
    } = payment::sign_challenge(&challenge, signer)?;

    let paid = post(
        client,
        url,
        &body,
        anthropic_version,
        Some(&header),
        Some(&request_id),
    )
    .await
    .map_err(|e| format!("retry: {e}"))?;

    let tx = paid
        .headers()
        .get("x-tx")
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    into_response(paid, tx, Some(amount_usd)).await
}

async fn post(
    client: &reqwest::Client,
    url: &str,
    body: &[u8],
    anthropic_version: Option<&str>,
    payment_header: Option<&str>,
    request_id: Option<&str>,
) -> Result<reqwest::Response, reqwest::Error> {
    let mut req = client
        .post(url)
        .header("content-type", "application/json")
        .body(body.to_vec());
    if let Some(v) = anthropic_version {
        req = req.header("anthropic-version", v);
    }
    if let Some(p) = payment_header {
        req = req.header("X-PAYMENT", p);
    }
    if let Some(id) = request_id {
        req = req.header("X-PAYMENT-REQUEST-ID", id);
    }
    req.send().await
}

async fn into_response(
    resp: reqwest::Response,
    tx_hash: Option<String>,
    cost_usd: Option<String>,
) -> Result<ProxyResponse, String> {
    let status = resp.status().as_u16();
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/json")
        .to_string();
    let header_i64 =
        |name: &str| -> Option<i64> { resp.headers().get(name)?.to_str().ok()?.parse().ok() };
    let header_str = |name: &str| -> Option<String> {
        Some(resp.headers().get(name)?.to_str().ok()?.to_string())
    };
    let usage_input = header_i64("x-usage-input");
    let usage_cached = header_i64("x-usage-cached");
    let usage_output = header_i64("x-usage-output");
    let price_input = header_str("x-price-input");
    let price_cached = header_str("x-price-cached");
    let price_output = header_str("x-price-output");
    let body = resp.bytes().await.map_err(|e| e.to_string())?.to_vec();
    Ok(ProxyResponse {
        status,
        content_type,
        body,
        tx_hash,
        cost_usd,
        usage_input,
        usage_cached,
        usage_output,
        price_input,
        price_cached,
        price_output,
    })
}
