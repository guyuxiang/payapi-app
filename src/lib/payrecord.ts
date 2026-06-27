// Shared helpers for parsing x402 payment records (format is server-defined, unknown at compile time)

export type PayRecord = Record<string, unknown>;

export function extractRecords(raw: unknown, limit = 50): PayRecord[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return (raw as PayRecord[]).slice(-limit).reverse();
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    for (const key of ["recent", "records", "data", "payments", "history", "items", "transactions", "logs"]) {
      if (Array.isArray(obj[key])) {
        return (obj[key] as PayRecord[]).slice(-limit).reverse();
      }
    }
  }
  return [];
}

export function recLabel(rec: PayRecord): string {
  for (const k of ["tool", "service", "model", "source", "name", "type", "app"]) {
    if (typeof rec[k] === "string" && (rec[k] as string).length > 0) return rec[k] as string;
  }
  return "AI 请求";
}

export function recAmountNum(rec: PayRecord): number {
  // Local pay_log: amountUsdc (camelCase from Tauri) or amount_usdc
  const raw = rec["amountUsdc"] ?? rec["amount_usdc"];
  if (raw != null) {
    const n = parseFloat(String(raw));
    if (!isNaN(n) && n >= 0) return n;
  }
  return 0;
}

export function recAmount(rec: PayRecord): string {
  const n = recAmountNum(rec);
  return n > 0 ? `${n} USDC` : "—";
}

export function recTimestamp(rec: PayRecord): number | null {
  for (const k of ["timestamp", "createdAt", "created_at", "time", "date", "at", "ts"]) {
    const v = rec[k];
    if (typeof v === "string") {
      const ts = new Date(v).getTime();
      if (!isNaN(ts)) return ts;
    }
    if (typeof v === "number") {
      // Could be seconds or milliseconds — heuristic: if < 1e12 treat as seconds
      return v < 1e12 ? v * 1000 : v;
    }
  }
  return null;
}

export function recModel(rec: PayRecord): string {
  for (const k of ["model", "model_name", "model_id", "ai_model", "llm"]) {
    if (typeof rec[k] === "string" && (rec[k] as string).length > 0) return rec[k] as string;
  }
  return "";
}

export function recPath(rec: PayRecord): string {
  return typeof rec["path"] === "string" ? rec["path"] as string : "";
}

export function recDurationMs(rec: PayRecord): number {
  const v = rec["duration_ms"] ?? rec["durationMs"];
  if (typeof v === "number" && v > 0) return v;
  return 0;
}

export function recDurationLabel(rec: PayRecord): string {
  const ms = recDurationMs(rec);
  if (ms <= 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function recTotalTokens(rec: PayRecord): number {
  return recTokens(rec);
}

export function recPromptTokens(rec: PayRecord): number {
  const v = rec["promptTokens"] ?? rec["prompt_tokens"];
  return typeof v === "number" ? v : 0;
}

export function recCompletionTokens(rec: PayRecord): number {
  const v = rec["completionTokens"] ?? rec["completion_tokens"];
  return typeof v === "number" ? v : 0;
}

// Server-supplied breakdown (from X-Usage-* headers, stored as inputTokens/cachedTokens/outputTokens)
export function recInputTokens(rec: PayRecord): number {
  const v = rec["inputTokens"] ?? rec["input_tokens"];
  return typeof v === "number" ? v : 0;
}

export function recCachedTokens(rec: PayRecord): number {
  const v = rec["cachedTokens"] ?? rec["cached_tokens"];
  return typeof v === "number" ? v : 0;
}

export function recOutputTokens(rec: PayRecord): number {
  const v = rec["outputTokens"] ?? rec["output_tokens"];
  return typeof v === "number" ? v : 0;
}

// Whether the record has server-supplied pricing breakdown
function hasServerPricing(rec: PayRecord): boolean {
  const p = rec["priceInput"] ?? rec["price_input"];
  return typeof p === "string" && (p as string).length > 0;
}

function abbrevN(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function recTokenLabels(rec: PayRecord): { input: string; cached: string; output: string } {
  if (hasServerPricing(rec)) {
    return {
      input:  abbrevN(recInputTokens(rec)),
      cached: recCachedTokens(rec) > 0 ? abbrevN(recCachedTokens(rec)) : "",
      output: abbrevN(recOutputTokens(rec)),
    };
  }
  // Fallback: use prompt/completion from response body parse
  return { input: abbrevN(recPromptTokens(rec)), cached: "", output: abbrevN(recCompletionTokens(rec)) };
}

// Price per million tokens in USD
export function recPricePerMToken(rec: PayRecord): string {
  const tokens = recTotalTokens(rec);
  const amount = recAmountNum(rec);
  if (tokens <= 0 || amount <= 0) return "—";
  const perM = (amount / tokens) * 1_000_000;
  return `$${perM.toFixed(2)}/M`;
}

function fmtUSDPerM(s: string): string {
  const n = parseFloat(s);
  if (isNaN(n) || n <= 0) return "—";
  return `$${n.toFixed(2)}`;
}

// Returns server-supplied per-M prices, or derived average if server didn't provide.
export function recPriceLabels(rec: PayRecord): { input: string; cached: string; output: string } {
  if (hasServerPricing(rec)) {
    const pi = rec["priceInput"] ?? rec["price_input"];
    const pc = rec["priceCached"] ?? rec["price_cached"];
    const po = rec["priceOutput"] ?? rec["price_output"];
    return {
      input:  fmtUSDPerM(typeof pi === "string" ? pi : ""),
      cached: typeof pc === "string" && (pc as string).length > 0 ? fmtUSDPerM(pc as string) : "",
      output: fmtUSDPerM(typeof po === "string" ? po : ""),
    };
  }
  // Fallback: average over total tokens (not split)
  const avg = recPricePerMToken(rec);
  return { input: avg, cached: "", output: avg };
}

export function recTokens(rec: PayRecord): number {
  // camelCase from Tauri, or snake_case fallback
  const pt = rec["promptTokens"] ?? rec["prompt_tokens"];
  const ct = rec["completionTokens"] ?? rec["completion_tokens"];
  if (pt != null || ct != null) {
    return (typeof pt === "number" ? pt : 0) + (typeof ct === "number" ? ct : 0);
  }
  for (const k of ["tokens", "token_count", "token_used", "total_tokens"]) {
    if (rec[k] != null) {
      const n = parseInt(String(rec[k]), 10);
      if (!isNaN(n) && n >= 0) return n;
    }
  }
  // Try nested usage object: { usage: { total_tokens: N } }
  if (typeof rec["usage"] === "object" && rec["usage"] !== null) {
    const u = rec["usage"] as Record<string, unknown>;
    for (const k of ["total_tokens", "tokens"]) {
      if (u[k] != null) {
        const n = parseInt(String(u[k]), 10);
        if (!isNaN(n) && n >= 0) return n;
      }
    }
  }
  return 0;
}

export function recRelTime(rec: PayRecord): string {
  const ts = recTimestamp(rec);
  if (ts === null) return "";
  const m = Math.floor((Date.now() - ts) / 60_000);
  if (m < 1)  return "刚刚";
  if (m < 60) return `${m}分钟前`;
  return `${Math.floor(m / 60)}小时前`;
}

export function recLocalTime(rec: PayRecord): string {
  const ts = recTimestamp(rec);
  if (ts === null) return "—";
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const HH = String(d.getHours()).padStart(2, "0");
  const MM = String(d.getMinutes()).padStart(2, "0");
  const SS = String(d.getSeconds()).padStart(2, "0");
  return `${mm}-${dd} ${HH}:${MM}:${SS}`;
}
