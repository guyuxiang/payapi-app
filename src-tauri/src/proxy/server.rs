//! Local Axum proxy on 127.0.0.1:8402. Coding tools point their base URLs here.
//! Each request is forwarded to the PayApi server with transparent x402 payment.

use crate::proxy::hook::forward_with_x402;
use crate::wallet::WalletManager;
use axum::{
    body::{Body, Bytes},
    extract::{OriginalUri, State},
    http::{HeaderMap, StatusCode},
    response::Response,
    Router,
};
use std::net::{SocketAddr, TcpListener as StdTcpListener};
use tokio::sync::oneshot;

#[derive(Clone)]
pub struct ProxyState {
    pub client: reqwest::Client,
    /// PayApi server base URL, e.g. https://your-server.com
    pub server_url: String,
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

    let signer = match WalletManager::new().signer() {
        Ok(s) => s,
        Err(e) => return error_response(StatusCode::BAD_REQUEST, &format!("wallet: {e}")),
    };

    let anthropic_version = headers
        .get("anthropic-version")
        .and_then(|v| v.to_str().ok());

    let body_bytes = force_no_stream(body.to_vec());

    match forward_with_x402(&state.client, &target, body_bytes, anthropic_version, &signer).await {
        Ok(resp) => {
            let mut builder = Response::builder()
                .status(StatusCode::from_u16(resp.status).unwrap_or(StatusCode::BAD_GATEWAY))
                .header("content-type", resp.content_type);
            if let Some(tx) = resp.tx_hash {
                builder = builder.header("x-tx", tx);
            }
            if let Some(cost) = resp.cost_usd {
                builder = builder.header("x-cost", cost);
            }
            builder
                .body(Body::from(resp.body))
                .unwrap_or_else(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "build response"))
        }
        Err(e) => error_response(StatusCode::BAD_GATEWAY, &e),
    }
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

pub fn start(server_url: String, port: u16) -> Result<u16, String> {
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
                Err(e) => { eprintln!("proxy runtime init failed: {e}"); return; }
            };
            rt.block_on(async move {
                if let Err(e) = serve_with_std_listener(listener, server_url, rx).await {
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
    shutdown: oneshot::Receiver<()>,
) -> Result<(), String> {
    let state = ProxyState { client: reqwest::Client::new(), server_url };
    let listener = tokio::net::TcpListener::from_std(listener)
        .map_err(|e| format!("tcp listener: {e}"))?;
    axum::serve(listener, router(state))
        .with_graceful_shutdown(async move { let _ = shutdown.await; })
        .await
        .map_err(|e| format!("serve: {e}"))
}
