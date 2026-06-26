// Shared helpers for parsing x402 payment records (format is server-defined, unknown at compile time)

export type PayRecord = Record<string, unknown>;

export function extractRecords(raw: unknown, limit = 50): PayRecord[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return (raw as PayRecord[]).slice(-limit).reverse();
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    for (const key of ["records", "data", "payments", "history", "items", "transactions", "logs"]) {
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
  for (const k of ["amount", "usdc", "value", "price", "cost", "fee"]) {
    if (rec[k] != null) {
      const n = parseFloat(String(rec[k]));
      if (!isNaN(n) && n >= 0) return n;
    }
  }
  return 0;
}

export function recAmount(rec: PayRecord): string {
  const n = recAmountNum(rec);
  return n > 0 ? `${n} USDC` : "—";
}

export function recTimestamp(rec: PayRecord): number | null {
  for (const k of ["timestamp", "created_at", "time", "date", "at", "ts"]) {
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

export function recTokens(rec: PayRecord): number {
  for (const k of ["tokens", "token_count", "token_used", "total_tokens", "usage"]) {
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
