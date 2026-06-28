//! Local Axum proxy on 127.0.0.1:8402. Coding tools point their base URLs here.
//! Each request is forwarded to the PayApi server with transparent x402 payment.

use crate::proxy::hook::forward_with_x402;
use crate::store::{Db, NewPayLog};
use crate::wallet::WalletManager;
use axum::{
    body::{Body, Bytes},
    extract::{OriginalUri, State},
    http::{HeaderMap, StatusCode},
    response::Response,
    Router,
};
use std::net::{SocketAddr, TcpListener as StdTcpListener};
use std::sync::Arc;
use tokio::sync::oneshot;

#[derive(Clone)]
pub struct ProxyState {
    pub client: reqwest::Client,
    /// PayApi server base URL, e.g. https://your-server.com
    pub server_url: String,
    pub db: Arc<Db>,
}

pub fn router(state: ProxyState) -> Router {
    Router::new().fallback(proxy_handler).with_state(state)
}

async fn proxy_handler(
    State(state): State<ProxyState>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let path = uri.path();
    let target = format!("{}{}", state.server_url.trim_end_matches('/'), path);

    log::info!("proxy_handler: {} {}", "POST", path);
    let signer = match WalletManager::new().signer() {
        Ok(s) => s,
        Err(e) => return error_response(StatusCode::BAD_REQUEST, &format!("wallet: {e}")),
    };

    let anthropic_version = headers
        .get("anthropic-version")
        .and_then(|v| v.to_str().ok());

    // The client may ask for streaming, but x402 needs the full body to count
    // tokens — so we always go non-streaming upstream and synthesize SSE back.
    let wants_stream = crate::proxy::sse::wants_stream(&body);
    let is_responses = path.ends_with("/responses");

    let body_snapshot = body.to_vec();
    let body_bytes = force_no_stream(body.to_vec());

    let t0 = std::time::Instant::now();
    match forward_with_x402(
        &state.client,
        &target,
        body_bytes,
        anthropic_version,
        &signer,
    )
    .await
    {
        Ok(resp) => {
            let duration_ms = t0.elapsed().as_millis() as i64;
            log::info!(
                "proxy_handler: {} {} -> status={} duration={}ms paid={}",
                "POST",
                path,
                resp.status,
                duration_ms,
                resp.tx_hash.is_some()
            );
            // Log the payment locally if x402 was triggered (tx_hash is set).
            if resp.tx_hash.is_some() {
                log_payment_local(
                    &state.db,
                    path,
                    &headers,
                    &body_snapshot,
                    &resp,
                    duration_ms,
                );
            }

            // Codex (responses wire API) expects a text/event-stream; rebuild one
            // from the completed JSON so it sees response.completed.
            if wants_stream && is_responses && resp.status == 200 {
                if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&resp.body) {
                    if json.get("object").and_then(|v| v.as_str()) == Some("response") {
                        let sse = crate::proxy::sse::responses_to_sse(&json);
                        let mut builder = Response::builder()
                            .status(StatusCode::OK)
                            .header("content-type", "text/event-stream")
                            .header("cache-control", "no-cache");
                        if let Some(tx) = resp.tx_hash {
                            builder = builder.header("x-tx", tx);
                        }
                        if let Some(cost) = resp.cost_usd {
                            builder = builder.header("x-cost", cost);
                        }
                        return builder.body(Body::from(sse)).unwrap_or_else(|_| {
                            error_response(StatusCode::INTERNAL_SERVER_ERROR, "build sse")
                        });
                    }
                }
            }

            let mut builder = Response::builder()
                .status(StatusCode::from_u16(resp.status).unwrap_or(StatusCode::BAD_GATEWAY))
                .header("content-type", resp.content_type);
            if let Some(tx) = resp.tx_hash {
                builder = builder.header("x-tx", tx);
            }
            if let Some(cost) = resp.cost_usd {
                builder = builder.header("x-cost", cost);
            }
            builder.body(Body::from(resp.body)).unwrap_or_else(|_| {
                error_response(StatusCode::INTERNAL_SERVER_ERROR, "build response")
            })
        }
        Err(e) => error_response(StatusCode::BAD_GATEWAY, &e),
    }
}

fn derive_tool(path: &str, headers: &HeaderMap) -> String {
    // anthropic-version header → Claude Code CLI
    if headers.contains_key("anthropic-version") {
        return "Claude Code".to_string();
    }
    // Responses API wire format → Codex
    if path.ends_with("/responses") {
        return "Codex".to_string();
    }
    // Anthropic native messages API
    if path.ends_with("/messages") {
        return "Claude".to_string();
    }
    // OpenAI-style chat completions — check User-Agent for hints
    let ua = headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    if ua.contains("gemini") {
        return "Gemini".to_string();
    }
    if ua.contains("codex") {
        return "Codex".to_string();
    }
    if ua.contains("claude") {
        return "Claude Code".to_string();
    }
    // Fallback: last path segment
    path.rsplit('/').next().unwrap_or("API").to_string()
}

fn log_payment_local(
    db: &Arc<Db>,
    path: &str,
    headers: &HeaderMap,
    req_body: &[u8],
    resp: &crate::proxy::hook::ProxyResponse,
    duration_ms: i64,
) {
    let tool = derive_tool(path, headers);

    let model = serde_json::from_slice::<serde_json::Value>(req_body)
        .ok()
        .and_then(|v| v.get("model").and_then(|m| m.as_str()).map(String::from))
        .unwrap_or_default();

    let (prompt_tokens, completion_tokens) =
        serde_json::from_slice::<serde_json::Value>(&resp.body)
            .ok()
            .map(|v| {
                let usage = v.get("usage");
                let pt = usage
                    .and_then(|u| u.get("input_tokens").or_else(|| u.get("prompt_tokens")))
                    .and_then(|n| n.as_i64())
                    .unwrap_or(0);
                let ct = usage
                    .and_then(|u| {
                        u.get("output_tokens")
                            .or_else(|| u.get("completion_tokens"))
                    })
                    .and_then(|n| n.as_i64())
                    .unwrap_or(0);
                (pt, ct)
            })
            .unwrap_or((0, 0));

    let now = chrono::Utc::now().to_rfc3339();
    let _ = db.log_payment(&NewPayLog {
        created_at: now,
        path: path.to_string(),
        tool,
        model,
        amount_usdc: resp.cost_usd.clone().unwrap_or_default(),
        tx_hash: String::new(),
        prompt_tokens,
        completion_tokens,
        duration_ms,
        input_tokens: resp.usage_input.unwrap_or(0),
        cached_tokens: resp.usage_cached.unwrap_or(0),
        output_tokens: resp.usage_output.unwrap_or(0),
        price_input: resp.price_input.clone().unwrap_or_default(),
        price_cached: resp.price_cached.clone().unwrap_or_default(),
        price_output: resp.price_output.clone().unwrap_or_default(),
    });
}

fn force_no_stream(body: Vec<u8>) -> Vec<u8> {
    let Ok(mut v) = serde_json::from_slice::<serde_json::Value>(&body) else {
        return body;
    };
    if let Some(obj) = v.as_object_mut() {
        obj.insert("stream".to_owned(), serde_json::Value::Bool(false));
        if let Ok(b) = serde_json::to_vec(&v) {
            return b;
        }
    }
    body
}

fn error_response(code: StatusCode, msg: &str) -> Response {
    Response::builder()
        .status(code)
        .header("content-type", "application/json")
        .body(Body::from(format!(r#"{{"error":{msg:?}}}"#)))
        .unwrap()
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

use once_cell::sync::Lazy;
use std::sync::Mutex;

struct Running {
    port: u16,
    shutdown: oneshot::Sender<()>,
}

static RUNNING: Lazy<Mutex<Option<Running>>> = Lazy::new(|| Mutex::new(None));

pub fn start(server_url: String, port: u16, db: Arc<Db>) -> Result<u16, String> {
    let mut guard = RUNNING.lock().map_err(|_| "lock poisoned")?;
    if guard.is_some() {
        return Err("x402 proxy already running".into());
    }
    let addr: SocketAddr = format!("127.0.0.1:{port}")
        .parse()
        .map_err(|e| format!("bad addr: {e}"))?;

    let listener = StdTcpListener::bind(addr).map_err(|e| format!("bind {addr}: {e}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("set nonblocking: {e}"))?;

    let (tx, rx) = oneshot::channel();
    std::thread::Builder::new()
        .name("payapi-proxy".to_string())
        .spawn(move || {
            let rt = match tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    eprintln!("proxy runtime init failed: {e}");
                    return;
                }
            };
            rt.block_on(async move {
                if let Err(e) = serve_with_std_listener(listener, server_url, db, rx).await {
                    eprintln!("x402 proxy stopped: {e}");
                }
            });
        })
        .map_err(|e| format!("spawn proxy thread: {e}"))?;

    *guard = Some(Running { port, shutdown: tx });
    Ok(port)
}

pub fn stop() -> Result<(), String> {
    if let Some(r) = RUNNING.lock().map_err(|_| "lock poisoned")?.take() {
        let _ = r.shutdown.send(());
    }
    Ok(())
}

pub fn status() -> Option<u16> {
    RUNNING.lock().ok().and_then(|g| g.as_ref().map(|r| r.port))
}

async fn serve_with_std_listener(
    listener: StdTcpListener,
    server_url: String,
    db: Arc<Db>,
    shutdown: oneshot::Receiver<()>,
) -> Result<(), String> {
    let state = ProxyState {
        client: reqwest::Client::new(),
        server_url,
        db,
    };
    let listener =
        tokio::net::TcpListener::from_std(listener).map_err(|e| format!("tcp listener: {e}"))?;
    axum::serve(listener, router(state))
        .with_graceful_shutdown(async move {
            let _ = shutdown.await;
        })
        .await
        .map_err(|e| format!("serve: {e}"))
}
