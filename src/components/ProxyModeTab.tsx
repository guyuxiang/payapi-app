import { useEffect, useState } from "react";
import {
  ToolDetection,
  detectTools,
  getLocalHistory,
  proxyModeStatus,
  proxyStatus,
} from "../lib/api";
import { PayRecord, extractRecords, recAmount, recLabel, recRelTime } from "../lib/payrecord";

// ── SVG icons ──────────────────────────────────────────────

const IconReceipt = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
    stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <rect x="2" y="1.5" width="10" height="11" rx="1.5" />
    <path d="M4.5 4.5h5M4.5 7h5M4.5 9.5h3" />
  </svg>
);

const IconTools = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
    stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <path d="M9.5 1.5a3 3 0 00-2.83 4L1.5 10.7a1 1 0 000 1.5l.3.3a1 1 0 001.5 0L8.5 7.3a3 3 0 004.2-2.8 3 3 0 00-.4-1.5L10.5 5 9 3.5l.5-2z" />
  </svg>
);

// ──────────────────────────────────────────────────────────

interface ToolMeta {
  key: keyof ToolDetection;
  name: string;
  configHint: string;
}

const TOOLS: ToolMeta[] = [
  { key: "claude",         name: "Claude Code",    configHint: "~/.claude/settings.json" },
  { key: "claude_desktop", name: "Claude Desktop", configHint: "AppSupport/Claude/" },
  { key: "codex",          name: "Codex",          configHint: "~/.codex/config.toml" },
  { key: "gemini",         name: "Gemini CLI",     configHint: "~/.gemini/.env" },
];

export function ProxyModeTab({ serverUrl }: { serverUrl: string }) {
  const [modeOn,    setModeOn]    = useState(false);
  const [proxyPort, setProxyPort] = useState<number | null>(null);
  const [detected,  setDetected]  = useState<ToolDetection>({
    claude: false, claude_desktop: false, codex: false, gemini: false,
  });
  const [recentPays, setRecentPays] = useState<PayRecord[]>([]);

  useEffect(() => {
    proxyModeStatus().then(setModeOn).catch(() => {});
    detectTools().then(setDetected).catch(() => {});
    proxyStatus().then(setProxyPort).catch(() => {});
  }, [serverUrl]);

  // Proxy status poll
  useEffect(() => {
    if (!proxyPort) return;
    const id = setInterval(() => {
      proxyStatus().then(setProxyPort).catch(() => setProxyPort(null));
    }, 3000);
    return () => clearInterval(id);
  }, [proxyPort]);

  // Payment history poll (15s when mode is on)
  useEffect(() => {
    if (!modeOn) { setRecentPays([]); return; }
    const load = async () => {
      try {
        const raw = await getLocalHistory(5);
        setRecentPays(extractRecords(raw, 5));
      } catch { /* ignore */ }
    };
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [modeOn]);

  const installedCount = TOOLS.filter(t => detected[t.key]).length;

  return (
    <div className="panel">

      {/* ── Recent payments ── */}
      <div className="card">
        <div className="card-head">
          <div className="ci ci-clay"><IconReceipt /></div>
          <span className="card-title">最近支付</span>
          {modeOn && (
            <span className="count-badge" style={{ fontSize: 10 }}>每 15s 刷新</span>
          )}
        </div>
        <div style={{ padding: "2px 13px 6px" }}>
          {recentPays.length > 0 ? (
            <div className="pay-list">
              {recentPays.map((rec, i) => (
                <div key={i} className="pay-row">
                  <span className="pay-label">{recLabel(rec)}</span>
                  <span className="pay-amount">{recAmount(rec)}</span>
                  <span className="pay-time">{recRelTime(rec)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 12, color: "var(--t3)", padding: "10px 0", textAlign: "center" }}>
              {modeOn ? "暂无支付记录" : "开启代理模式后显示"}
            </p>
          )}
        </div>
      </div>

      {/* ── Tool list ── */}
      <div className="card">
        <div className="card-head">
          <div className="ci ci-amber"><IconTools /></div>
          <span className="card-title">工具配置</span>
          <span className="count-badge">{installedCount}/{TOOLS.length} 已安装</span>
        </div>
        <div style={{ padding: "0 13px 4px" }}>
          <div className="tool-list">
            {TOOLS.map((t) => {
              const installed  = detected[t.key];
              const configured = installed && modeOn;
              return (
                <div key={t.key} className="tool-row">
                  <div className="tool-info">
                    <span className={`tool-name${!installed ? " dim" : ""}`}>{t.name}</span>
                    {installed && <span className="tool-path">{t.configHint}</span>}
                  </div>
                  <span className={`pill ${configured ? "pill-green" : installed ? "pill-amber" : "pill-dim"}`}>
                    {!installed ? "未安装" : configured ? "已配置" : "待配置"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

    </div>
  );
}
