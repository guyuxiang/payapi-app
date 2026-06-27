//! Synthesizes a Responses API SSE stream from a non-streaming response.
//!
//! Codex (`wire_api = "responses"`) always requests streaming and expects a
//! `text/event-stream` that ends in a `response.completed` event. The x402 server,
//! however, must run non-streaming so it can count tokens to price and settle the
//! payment. So the proxy talks non-streaming upstream, then re-emits the final
//! JSON as the exact event sequence Codex expects.
//!
//! A non-streaming Responses body (`object: "response"`, `status: "completed"`) is
//! byte-for-byte the same shape as the `response` object inside the terminal
//! `response.completed` event, so synthesis is just "replay this object as events".

use serde_json::{json, Value};

/// True if the request body asked for streaming (`"stream": true`).
pub fn wants_stream(body: &[u8]) -> bool {
    serde_json::from_slice::<Value>(body)
        .ok()
        .as_ref()
        .and_then(|v| v.get("stream"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

/// Convert a completed Responses API object into the SSE bytes Codex expects.
/// `full` must be the top-level response object (`object == "response"`).
pub fn responses_to_sse(full: &Value) -> Vec<u8> {
    let mut out = String::new();
    let mut seq: u64 = 0;

    // 1. response.created / response.in_progress — same object, but not yet done.
    let mut shell = full.clone();
    shell["status"] = json!("in_progress");
    shell["output"] = json!([]);
    shell["completed_at"] = Value::Null;
    push(&mut out, "response.created",
        &json!({ "type": "response.created", "sequence_number": seq, "response": shell }));
    seq += 1;
    push(&mut out, "response.in_progress",
        &json!({ "type": "response.in_progress", "sequence_number": seq, "response": shell }));
    seq += 1;

    // 2. Replay each output item.
    if let Some(items) = full.get("output").and_then(Value::as_array) {
        for (idx, item) in items.iter().enumerate() {
            let item_id = item.get("id").and_then(Value::as_str).unwrap_or("");
            let output_index = idx as u64;

            // output_item.added — item in progress, content cleared.
            let mut added = item.clone();
            added["status"] = json!("in_progress");
            if added.get("content").is_some() {
                added["content"] = json!([]);
            }
            push(&mut out, "response.output_item.added",
                &json!({ "type": "response.output_item.added", "output_index": output_index,
                         "sequence_number": seq, "item": added }));
            seq += 1;

            // Message items emit their text content as part + delta + done events.
            let is_message = item.get("type").and_then(Value::as_str) == Some("message");
            if is_message {
                if let Some(parts) = item.get("content").and_then(Value::as_array) {
                    for (cidx, part) in parts.iter().enumerate() {
                        if part.get("type").and_then(Value::as_str) != Some("output_text") {
                            continue;
                        }
                        let content_index = cidx as u64;
                        let text = part.get("text").and_then(Value::as_str).unwrap_or("");

                        let mut empty = part.clone();
                        empty["text"] = json!("");
                        push(&mut out, "response.content_part.added",
                            &json!({ "type": "response.content_part.added", "content_index": content_index,
                                     "item_id": item_id, "output_index": output_index,
                                     "sequence_number": seq, "part": empty }));
                        seq += 1;

                        push(&mut out, "response.output_text.delta",
                            &json!({ "type": "response.output_text.delta", "content_index": content_index,
                                     "delta": text, "item_id": item_id, "output_index": output_index,
                                     "sequence_number": seq }));
                        seq += 1;

                        push(&mut out, "response.output_text.done",
                            &json!({ "type": "response.output_text.done", "content_index": content_index,
                                     "item_id": item_id, "output_index": output_index,
                                     "sequence_number": seq, "text": text }));
                        seq += 1;

                        push(&mut out, "response.content_part.done",
                            &json!({ "type": "response.content_part.done", "content_index": content_index,
                                     "item_id": item_id, "output_index": output_index,
                                     "sequence_number": seq, "part": part }));
                        seq += 1;
                    }
                }
            }

            // output_item.done — the fully completed item.
            push(&mut out, "response.output_item.done",
                &json!({ "type": "response.output_item.done", "output_index": output_index,
                         "sequence_number": seq, "item": item }));
            seq += 1;
        }
    }

    // 3. response.completed — the full object, verbatim.
    push(&mut out, "response.completed",
        &json!({ "type": "response.completed", "sequence_number": seq, "response": full }));

    out.into_bytes()
}

fn push(out: &mut String, event: &str, data: &Value) {
    out.push_str("event: ");
    out.push_str(event);
    out.push_str("\ndata: ");
    out.push_str(&data.to_string());
    out.push_str("\n\n");
}
