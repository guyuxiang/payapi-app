import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  ToolDetection,
  applyTool,
  detectTools,
  getSetting,
  getProxyTools,
  proxyModeStatus,
  restoreTool,
  setSetting,
  setProxyTools,
} from "../lib/api";
import { extractError } from "../lib/error";

// ── SVG icons ──────────────────────────────────────────────

const IconServer = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
    stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <rect x="1.5" y="2" width="11" height="4" rx="1" />
    <rect x="1.5" y="8" width="11" height="4" rx="1" />
    <circle cx="11" cy="4" r="0.75" fill="currentColor" stroke="none" />
    <circle cx="11" cy="10" r="0.75" fill="currentColor" stroke="none" />
  </svg>
);

const IconChain = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
    stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <path d="M5.5 8.5a3 3 0 004.24 0l1.5-1.5a3 3 0 00-4.24-4.24l-.83.83" />
    <path d="M8.5 5.5a3 3 0 00-4.24 0L2.76 7a3 3 0 004.24 4.24l.83-.83" />
  </svg>
);

const IconPort = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
    stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <rect x="1.5" y="3.5" width="11" height="7" rx="1.5" />
    <path d="M4 7h6M7 5v4" />
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

interface Props {
  serverUrl: string;
  setServerUrl: (v: string) => void;
}

export function SettingsPanel({ serverUrl, setServerUrl }: Props) {
  const [draft,        setDraft]        = useState(serverUrl);
  const [network,      setNetwork]      = useState("base-sepolia");
  const [detected,     setDetected]     = useState<ToolDetection>({
    claude: false, claude_desktop: false, codex: false, gemini: false,
  });
  const [modeOn,       setModeOn]       = useState(false);
  const [enabledTools, setEnabledTools] = useState<Set<string>>(
    new Set(["claude", "claude_desktop", "codex", "gemini"])
  );

  useEffect(() => { setDraft(serverUrl); }, [serverUrl]);

  useEffect(() => {
    getSetting("network").then((v) => { if (v) setNetwork(v); }).catch(() => {});
    detectTools().then(setDetected).catch(() => {});
    proxyModeStatus().then(setModeOn).catch(() => {});
    getProxyTools().then((keys) => setEnabledTools(new Set(keys))).catch(() => {});
  }, []);

  const save = async () => {
    try {
      setServerUrl(draft.trim());
      await setSetting("network", network);
      toast.success("设置已保存");
    } catch (e) {
      toast.error("保存失败: " + extractError(e));
    }
  };

  const toggleTool = async (key: string, checked: boolean) => {
    const next = new Set(enabledTools);
    if (checked) next.add(key); else next.delete(key);
    setEnabledTools(next);
    try {
      await setProxyTools([...next]);
      if (modeOn) {
        if (checked) await applyTool(key);
        else await restoreTool(key);
      }
    } catch (e) {
      toast.error("工具配置失败: " + extractError(e));
    }
  };

  const handleNetworkChange = (v: string) => setNetwork(v);

  const installedCount = TOOLS.filter(t => detected[t.key]).length;

  return (
    <div className="panel">

      {/* ── Server URL ── */}
      <div className="card">
        <div className="card-head">
          <div className="ci ci-blue"><IconServer /></div>
          <span className="card-title">PAYAPI 服务器</span>
        </div>
        <div className="card-body">
          <div className="form-group">
            <label className="label">地址</label>
            <input
              className="input-field"
              type="text"
              placeholder="http://localhost:3402"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <p className="form-hint">x402 服务端，代理将把 AI 请求转发至此</p>
          </div>
        </div>
      </div>

      {/* ── Network ── */}
      <div className="card">
        <div className="card-head">
          <div className="ci ci-clay"><IconChain /></div>
          <span className="card-title">支付网络</span>
        </div>
        <div className="card-body">
          <select
            className="select-field"
            value={network}
            onChange={(e) => handleNetworkChange(e.target.value)}
          >
            <option value="base-sepolia">Base Sepolia — 测试网</option>
            <option value="base">Base 主网</option>
          </select>
          <p className="form-hint">选择 USDC 结算的区块链网络</p>
        </div>
      </div>

      {/* ── Proxy port info ── */}
      <div className="card">
        <div className="card-head">
          <div className="ci ci-purple"><IconPort /></div>
          <span className="card-title">本地代理端口</span>
        </div>
        <div className="card-body">
          <input className="input-field" type="text" defaultValue="8402" readOnly />
          <p className="form-hint">ANTHROPIC_BASE_URL=http://localhost:8402</p>
        </div>
      </div>

      <button className="btn btn-primary" onClick={save}>保存设置</button>

      <div className="divider" />

      {/* ── Tool config ── */}
      <div className="card">
        <div className="card-head">
          <div className="ci ci-amber"><IconTools /></div>
          <span className="card-title">工具配置</span>
          <span className="count-badge">{installedCount}/{TOOLS.length} 已安装</span>
        </div>
        <div style={{ padding: "0 13px 4px" }}>
          <p className="form-hint" style={{ marginBottom: 8 }}>
            勾选需要代理的工具，开启代理模式时自动注入 x402 配置
          </p>
          <div className="tool-list">
            {TOOLS.map((t) => {
              const installed = detected[t.key];
              const checked   = enabledTools.has(t.key);
              return (
                <label
                  key={t.key}
                  className={`tool-row tool-row-check${!installed ? " tool-row-dim" : ""}`}
                  style={{ cursor: installed ? "pointer" : "default" }}
                >
                  <div className="tool-info">
                    <span className={`tool-name${!installed ? " dim" : ""}`}>{t.name}</span>
                    <span className="tool-path">
                      {installed ? t.configHint : "未安装"}
                    </span>
                  </div>
                  {installed && modeOn && checked && (
                    <span className="pill pill-green" style={{ fontSize: 10, padding: "1px 7px" }}>已配置</span>
                  )}
                  <input
                    type="checkbox"
                    className="tool-checkbox"
                    checked={checked && installed}
                    disabled={!installed}
                    onChange={(e) => toggleTool(t.key, e.target.checked)}
                  />
                </label>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── About ── */}
      <div style={{ padding: "2px", display: "flex", flexDirection: "column", gap: 4 }}>
        <p style={{ fontSize: 12, fontWeight: 600, color: "var(--t2)" }}>PAYAPI v0.1.0</p>
        <p className="form-hint">通过 USDC 在 Base 网络按需付费访问 AI 服务</p>
      </div>

    </div>
  );
}
