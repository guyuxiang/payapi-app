import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  BalanceInfo,
  ToolDetection,
  WalletInfo,
  detectTools,
  getBalance,
  getLocalHistory,
  getSetting,
  getWallet,
  proxyModeDisable,
  proxyModeEnable,
  proxyModeStatus,
  proxyStatus,
  startProxy,
} from "../lib/api";
import { extractError } from "../lib/error";
import {
  PayRecord,
  extractRecords,
  recAmountNum,
  recLabel,
  recModel,
  recTimestamp,
  recTokens,
} from "../lib/payrecord";
import { HourlyBucket, SpendingChart } from "./SpendingChart";

// ── Network config ─────────────────────────────────────────

const RPC: Record<string, string> = {
  "base-sepolia": "https://base-sepolia-rpc.publicnode.com",
  "base":         "https://base-rpc.publicnode.com",
};
const USDC: Record<string, string> = {
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "base":         "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

const TOOL_NAMES: { key: keyof ToolDetection; name: string }[] = [
  { key: "claude",         name: "Claude Code"    },
  { key: "claude_desktop", name: "Claude Desktop" },
  { key: "codex",          name: "Codex"          },
  { key: "gemini",         name: "Gemini CLI"     },
];

// ── SVG icons ──────────────────────────────────────────────

const IconPower = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M7 1v5M4 3.2A5.5 5.5 0 107 13" />
  </svg>
);

const IconTrend = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1,10 4,6.5 7,8 10,4.5 13,6" />
    <polyline points="9.5,4.5 13,4.5 13,8" />
  </svg>
);

const IconGrid = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
    stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <rect x="1.5" y="1.5" width="4.5" height="4.5" rx="1"/>
    <rect x="8"   y="1.5" width="4.5" height="4.5" rx="1"/>
    <rect x="1.5" y="8"   width="4.5" height="4.5" rx="1"/>
    <rect x="8"   y="8"   width="4.5" height="4.5" rx="1"/>
  </svg>
);

const IconShield = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
    <path d="M7 1L2 3.4v4.3C2 10.9 4.2 13.6 7 14.4c2.8-.8 5-3.5 5-6.7V3.4L7 1z" opacity="0.9"/>
  </svg>
);

// ── Helpers ────────────────────────────────────────────────

function latencyClass(ms: number | null, up: boolean | null): string {
  if (up === null) return "latency-dim";
  if (!up)         return "latency-bad";
  if (ms === null) return "latency-dim";
  if (ms < 200)    return "latency-good";
  if (ms < 600)    return "latency-ok";
  return "latency-bad";
}

function latencyLabel(ms: number | null, up: boolean | null): string {
  if (up === null) return "...";
  if (!up)         return "不可达";
  if (ms === null) return "...";
  return `${ms}ms`;
}

function fmtTokens(n: number): string {
  if (n === 0)        return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function buildHourlyBuckets(records: PayRecord[]): HourlyBucket[] {
  const now     = Date.now();
  const buckets = Array.from<unknown, HourlyBucket>({ length: 24 }, (_, i) => {
    const h = new Date(now - (23 - i) * 3_600_000);
    return { label: `${h.getHours()}h`, amount: 0 };
  });
  for (const rec of records) {
    const ts = recTimestamp(rec);
    if (!ts) continue;
    const age = now - ts;
    if (age < 0 || age > 24 * 3_600_000) continue;
    const idx = 23 - Math.floor(age / 3_600_000);
    if (idx >= 0 && idx < 24) buckets[idx].amount += 1;
  }
  return buckets;
}

function buildDistStats(
  records: PayRecord[],
  keyFn: (r: PayRecord) => string,
): { name: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const rec of records) {
    const key = keyFn(rec);
    if (!key) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

function isToday(ts: number | null): boolean {
  if (!ts) return false;
  const d = new Date(ts), now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate()  === now.getDate();
}

// ── Stat card ──────────────────────────────────────────────

function MiniStat({ title, value, sub, accent }: {
  title: string;
  value: string | number;
  sub?: string;
  accent?: "clay" | "green" | "blue";
}) {
  const colorMap = { clay: "var(--clay)", green: "var(--green)", blue: "var(--blue)" };
  return (
    <div className="mini-stat">
      <span className="mini-stat-title">{title}</span>
      <span className="mini-stat-value" style={accent ? { color: colorMap[accent] } : undefined}>
        {value}
      </span>
      {sub && <span className="mini-stat-sub">{sub}</span>}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────

export function OverviewTab({ serverUrl }: { serverUrl: string }) {
  // Wallet / balance
  const [wallet,  setWallet]  = useState<WalletInfo | null>(null);
  const [balance, setBalance] = useState<BalanceInfo | null>(null);
  // Payment history
  const [records, setRecords] = useState<PayRecord[]>([]);
  // Proxy state
  const [proxyPort,     setProxyPort]     = useState<number | null>(null);
  const [modeOn,        setModeOn]        = useState(false);
  const [loadingToggle, setLoadingToggle] = useState(false);
  const [detected,      setDetected]      = useState<ToolDetection>({
    claude: false, claude_desktop: false, codex: false, gemini: false,
  });
  // Latency
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [latencyUp, setLatencyUp] = useState<boolean | null>(null);
  // UI loading
  const [loading, setLoading] = useState(true);

  // ── Init ────────────────────────────────────────────────

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getSetting("network"),
      getWallet(),
      proxyModeStatus(),
      detectTools(),
      proxyStatus(),
    ])
      .then(([net, w, mode, det, port]) => {
        const n = net ?? "base-sepolia";
        setWallet(w);
        setModeOn(mode);
        setDetected(det);

        if (port) {
          setProxyPort(port);
        } else if (serverUrl) {
          startProxy(serverUrl).then(setProxyPort).catch(() => {});
        }

        if (w) {
          getBalance(RPC[n] ?? RPC["base-sepolia"], USDC[n] ?? USDC["base-sepolia"])
            .then(setBalance)
            .catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    getLocalHistory(200)
      .then((raw) => setRecords(extractRecords(raw, 200)))
      .catch(() => {});
  }, [serverUrl]);

  // Proxy status poll (3s)
  useEffect(() => {
    if (!proxyPort) return;
    const id = setInterval(() => {
      proxyStatus().then(setProxyPort).catch(() => setProxyPort(null));
    }, 3000);
    return () => clearInterval(id);
  }, [proxyPort]);

  // History refresh (30s)
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const raw = await getLocalHistory(200);
        setRecords(extractRecords(raw, 200));
      } catch { /* ignore */ }
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  // Latency check (30s)
  useEffect(() => {
    if (!serverUrl) return;
    const check = async () => {
      const start = performance.now();
      const ctrl  = new AbortController();
      const tid   = setTimeout(() => ctrl.abort(), 5000);
      try {
        await fetch(serverUrl, { method: "HEAD", mode: "no-cors", signal: ctrl.signal });
        clearTimeout(tid);
        setLatencyMs(Math.round(performance.now() - start));
        setLatencyUp(true);
      } catch {
        clearTimeout(tid);
        setLatencyMs(null);
        setLatencyUp(false);
      }
    };
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, [serverUrl]);

  // ── Toggle ───────────────────────────────────────────────

  const toggle = async () => {
    if (loadingToggle) return;
    setLoadingToggle(true);
    try {
      if (!modeOn) {
        if (!proxyPort) {
          if (!serverUrl) { toast.error("请先在设置中填写服务器地址"); return; }
          const port = await startProxy(serverUrl);
          setProxyPort(port);
        }
        await proxyModeEnable();
        setModeOn(true);
        const names = TOOL_NAMES.filter(t => detected[t.key]).map(t => t.name).join("、");
        toast.success(`代理已开启${names ? " — " + names : ""}`);
      } else {
        await proxyModeDisable();
        setModeOn(false);
        toast.success("代理已关闭，原始配置已恢复");
      }
    } catch (e) {
      toast.error(extractError(e));
    } finally {
      setLoadingToggle(false);
    }
  };

  // ── Derived stats ────────────────────────────────────────

  const todayRecords = records.filter((r) => isToday(recTimestamp(r)));
  const totalSpent   = records.reduce((s, r) => s + recAmountNum(r), 0);
  const todaySpent   = todayRecords.reduce((s, r) => s + recAmountNum(r), 0);
  const todayCount   = todayRecords.length;
  const todayTokens  = todayRecords.reduce((s, r) => s + recTokens(r), 0);

  const avgPerRequest = records.length > 0 ? totalSpent / records.length : 0;
  const balNum        = balance ? parseFloat(balance.usdc) : null;
  const runway        = balNum !== null && avgPerRequest > 0
    ? Math.floor(balNum / avgPerRequest)
    : null;

  const hourlyBuckets  = buildHourlyBuckets(records);
  const toolStats      = buildDistStats(records, recLabel);
  const modelStats     = buildDistStats(records, recModel);
  const maxToolCount   = toolStats[0]?.count ?? 1;
  const maxModelCount  = modelStats[0]?.count ?? 1;

  // Request trend derived stats
  const lastHourCount = hourlyBuckets[23]?.amount ?? 0;
  const peakBucket    = hourlyBuckets.reduce(
    (best, b) => b.amount > best.amount ? b : best,
    { label: "", amount: 0 },
  );
  const activeHours   = hourlyBuckets.filter(b => b.amount > 0).length;
  const peakTopLabel  = peakBucket.amount > 0
    ? `峰 ${peakBucket.amount} 次`
    : undefined;
  const lowBalance    = balNum !== null && balNum < 1;

  return (
    <div className="panel">

      {/* ── Stat grid ── */}
      <div className="stat-grid">
        <MiniStat
          title="当前余额"
          value={loading ? "—" : (balance?.usdc ?? "—")}
          sub="USDC"
          accent={lowBalance ? "clay" : "green"}
        />
        <MiniStat title="今日请求" value={todayCount} sub="笔" accent="blue" />
        <MiniStat
          title="今日消费"
          value={todaySpent > 0 ? todaySpent.toFixed(4) : "0.00"}
          sub="USDC"
          accent="clay"
        />
        <MiniStat title="今日 Token" value={fmtTokens(todayTokens)} sub="tokens" />
      </div>

      {/* ── Low balance warning ── */}
      {lowBalance && (
        <div className="warn-inline warn-amber">
          余额不足 1 USDC，建议充值以保证代理正常运行
        </div>
      )}

      {/* ── Proxy mode toggle ── */}
      <div className="card">
        <div className="card-head">
          <div className={`ci ${modeOn ? "ci-clay" : "ci-dim"}`}><IconPower /></div>
          <span className="card-title">代理模式</span>
          <label className="toggle toggle-sm">
            <input type="checkbox" checked={modeOn} onChange={toggle} disabled={loadingToggle} />
            <span className="toggle-slider" />
          </label>
        </div>
        <div className="card-body" style={{ gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="status-inline">
              {proxyPort ? (
                <>
                  <span className="dot dot-green dot-pulse" />
                  <span>127.0.0.1:{proxyPort}</span>
                </>
              ) : (
                <>
                  <span className="dot dot-amber" />
                  <span style={{ color: "var(--amber)" }}>启动中...</span>
                </>
              )}
            </div>
            <span className={`latency-chip ${latencyClass(latencyMs, latencyUp)}`}>
              {latencyLabel(latencyMs, latencyUp)}
            </span>
          </div>
          <p style={{ fontSize: 12, color: "var(--t3)" }}>
            {modeOn ? "AI 请求通过本地代理，按 USDC 按需结算" : "开启后自动配置已安装的 AI 编码工具"}
          </p>
        </div>
      </div>

      {/* ── Request trend ── */}
      <div className="card">
        <div className="card-head">
          <div className="ci ci-blue"><IconTrend /></div>
          <span className="card-title">请求趋势</span>
          <span className="count-badge">
            {activeHours > 0 ? `活跃 ${activeHours}h` : "近 24 小时"}
          </span>
        </div>
        <div className="card-body" style={{ paddingTop: 8, paddingBottom: 8, gap: 6 }}>
          <SpendingChart
            data={hourlyBuckets}
            color="#2C68B5"
            height={80}
            highlightPeak
            topLabel={peakTopLabel}
          />
          <div className="chart-footer">
            <span>
              上 1h&nbsp;·&nbsp;
              <strong style={{ color: "var(--t1)" }}>{lastHourCount}</strong> 次
            </span>
            {peakBucket.amount > 0 && (
              <span>
                峰值 {peakBucket.label}&nbsp;·&nbsp;
                <strong style={{ color: "var(--blue)" }}>{peakBucket.amount}</strong> 次
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Distribution pair ── */}
      <div className="dist-pair">
        <div className="card" style={{ flex: 1, minWidth: 0 }}>
          <div className="card-head">
            <div className="ci ci-amber"><IconGrid /></div>
            <span className="card-title">工具分布</span>
          </div>
          <div className="card-body" style={{ gap: 2, paddingTop: 8 }}>
            {toolStats.length > 0 ? toolStats.map((t) => (
              <div key={t.name} className="tool-dist-row">
                <span className="tool-dist-name">{t.name}</span>
                <div className="tool-dist-track">
                  <div className="tool-dist-fill" style={{ width: `${(t.count / maxToolCount) * 100}%` }} />
                </div>
                <span className="tool-dist-count">{t.count}</span>
              </div>
            )) : (
              <p className="dist-empty">暂无数据</p>
            )}
          </div>
        </div>

        <div className="card" style={{ flex: 1, minWidth: 0 }}>
          <div className="card-head">
            <div className="ci ci-purple"><IconGrid /></div>
            <span className="card-title">模型分布</span>
          </div>
          <div className="card-body" style={{ gap: 2, paddingTop: 8 }}>
            {modelStats.length > 0 ? modelStats.map((m) => (
              <div key={m.name} className="tool-dist-row">
                <span className="tool-dist-name">{m.name}</span>
                <div className="tool-dist-track">
                  <div className="tool-dist-fill" style={{
                    width: `${(m.count / maxModelCount) * 100}%`,
                    background: "var(--purple)",
                  }} />
                </div>
                <span className="tool-dist-count">{m.count}</span>
              </div>
            )) : (
              <p className="dist-empty">暂无数据</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Session summary ── */}
      <div className="card">
        <div className="card-head">
          <div className={`ci ${proxyPort ? "ci-green" : "ci-dim"}`}><IconShield /></div>
          <span className="card-title">会话摘要</span>
          <span className="count-badge" style={{ display: "flex", alignItems: "center", gap: 5 }}>
            {proxyPort
              ? <><span className="dot dot-green dot-pulse" />{modeOn ? "代理中" : "已启动"}</>
              : "离线"}
          </span>
        </div>
        <div style={{ padding: "0 13px 10px" }}>
          <div className="summary-row">
            <span>总请求数</span>
            <span className="summary-val">{records.length} 次</span>
          </div>
          <div className="summary-row">
            <span>累计消费</span>
            <span className="summary-val">{totalSpent.toFixed(5)} USDC</span>
          </div>
          {avgPerRequest > 0 && (
            <div className="summary-row">
              <span>均次费用</span>
              <span className="summary-val">{avgPerRequest.toFixed(5)} USDC</span>
            </div>
          )}
          {runway !== null && (
            <div className="summary-row">
              <span>预计剩余次数</span>
              <span className="summary-val" style={{ color: runway < 20 ? "var(--amber)" : "var(--green)" }}>
                {runway.toLocaleString()} 次
              </span>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
