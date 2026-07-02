import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  getSetting,
  setSetting,
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

// ──────────────────────────────────────────────────────────

interface Props {
  serverUrl: string;
  setServerUrl: (v: string) => void;
  active: boolean;
}

export function SettingsPanel({ serverUrl, setServerUrl, active }: Props) {
  const [draft,        setDraft]        = useState(serverUrl);
  const [network,      setNetwork]      = useState("base-sepolia");

  useEffect(() => { setDraft(serverUrl); }, [serverUrl]);

  useEffect(() => {
    if (!active) return;
    getSetting("network").then((v) => { if (v) setNetwork(v); }).catch(() => {});
  }, [active]);

  const save = async () => {
    try {
      setServerUrl(draft.trim());
      await setSetting("network", network);
      toast.success("设置已保存");
    } catch (e) {
      toast.error("保存失败: " + extractError(e));
    }
  };

  const handleNetworkChange = (v: string) => setNetwork(v);

  return (
    <div className="panel">

      {/* ── Server URL ── */}
      <div className="card">
        <div className="card-head">
          <div className="ci ci-blue"><IconServer /></div>
          <span className="card-title">xPay 服务器</span>
        </div>
        <div className="card-body">
          <div className="form-group">
            <label className="label">地址</label>
            <input
              className="input-field"
              type="text"
              placeholder="https://www.openshort.cloud/xpay/"
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

      {/* ── About ── */}
      <div style={{ padding: "2px", display: "flex", flexDirection: "column", gap: 4 }}>
        <p style={{ fontSize: 12, fontWeight: 600, color: "var(--t2)" }}>xPay v0.1.0</p>
        <p className="form-hint">通过 USDC 在 Base 网络按需付费访问 AI 服务</p>
      </div>

    </div>
  );
}
