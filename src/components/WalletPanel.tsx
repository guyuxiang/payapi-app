import QRCode from "qrcode";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { getSetting, sendUsdc, setSetting } from "../lib/api";
import { extractError } from "../lib/error";
import {
  PayRecord,
  recAmountNum,
  recDurationLabel,
  recLocalTime,
  recModel,
  recPriceLabels,
  recTokenLabels,
  recCachedTokens,
} from "../lib/payrecord";
import { useWallet } from "../hooks/useWallet";

// ── SVG icons ──────────────────────────────────────────────

const IconCoin = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
    stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <circle cx="7" cy="7" r="5.5" />
    <path d="M7 4.5v5M5.5 5.5C5.5 5 6.17 4.5 7 4.5s1.5.5 1.5 1.2c0 .8-1.5 1.3-1.5 2s.67 1.3 1.5 1.3 1.5-.5 1.5-1.3" />
  </svg>
);

const IconHistory = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
    stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1.5 7A5.5 5.5 0 107 1.5" />
    <polyline points="1.5,4 1.5,7 4.5,7" />
    <path d="M7 4v3.5l2 1.5" />
  </svg>
);

const IconKey = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
    stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <circle cx="4.5" cy="4.5" r="2.5" />
    <path d="M6.5 6.5l4 4M9 9l-1.5 1.5" />
  </svg>
);

const IconRefresh = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
    stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.5 2A5 5 0 106 11" />
    <polyline points="10.5,0 10.5,2 8.5,2" />
  </svg>
);

const IconCopy = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
    stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
    <rect x="4" y="4" width="7" height="7" rx="1.2" />
    <path d="M2.5 8H2a1 1 0 01-1-1V2a1 1 0 011-1h5a1 1 0 011 1v.5" />
  </svg>
);

const IconSend = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none"
    stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11.5 1.5L1.5 5.5l4 2 2 4 4-10z" />
    <path d="M5.5 7.5l2.5-2.5" />
  </svg>
);

const IconQR = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none"
    stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <rect x="1" y="1" width="4.5" height="4.5" rx="0.8" />
    <rect x="7.5" y="1" width="4.5" height="4.5" rx="0.8" />
    <rect x="1" y="7.5" width="4.5" height="4.5" rx="0.8" />
    <rect x="2.5" y="2.5" width="1.5" height="1.5" fill="currentColor" stroke="none" />
    <rect x="9" y="2.5" width="1.5" height="1.5" fill="currentColor" stroke="none" />
    <rect x="2.5" y="9" width="1.5" height="1.5" fill="currentColor" stroke="none" />
    <path d="M7.5 7.5h2M7.5 10h1.5M9.5 9h2M11.5 7.5v1.5M11.5 10v1.5M9.5 11.5h2" />
  </svg>
);

// ── RPC / USDC constants ───────────────────────────────────

const RPC: Record<string, string> = {
  "base-sepolia": "https://base-sepolia-rpc.publicnode.com",
  "base":         "https://base-rpc.publicnode.com",
};
const USDC_ADDR: Record<string, string> = {
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "base":         "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

// ──────────────────────────────────────────────────────────

type Pane = null | "send" | "receive";

export function WalletPanel({ serverUrl }: { serverUrl: string }) {
  const [network, setNetwork] = useState("base-sepolia");

  useEffect(() => {
    getSetting("network").then((v) => { if (v) setNetwork(v); }).catch(() => {});
  }, []);

  const {
    wallet, balance, mnemonic, showMnemonic, setShowMnemonic,
    history, loadingBal, loadingHist, importText, setImportText,
    fetchBalance, fetchHistory, handleCreate, handleImport, handleExport,
  } = useWallet(serverUrl, network);

  const handleNetworkChange = (v: string) => {
    setNetwork(v);
    setSetting("network", v).catch(() => {});
  };

  // ── QR code ────────────────────────────────────────────
  const [qrUrl, setQrUrl] = useState("");
  useEffect(() => {
    if (!wallet?.address) return;
    QRCode.toDataURL(wallet.address, {
      width: 200, margin: 2,
      color: { dark: "#111114", light: "#FFFFFF" },
    }).then(setQrUrl).catch(() => {});
  }, [wallet?.address]);

  // ── Send state ─────────────────────────────────────────
  const [pane,       setPane]       = useState<Pane>(null);
  const [sendTo,     setSendTo]     = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sending,    setSending]    = useState(false);

  const togglePane = (p: Pane) => setPane(prev => prev === p ? null : p);

  const handleSend = async () => {
    if (!sendTo.trim() || !sendAmount.trim()) return;
    setSending(true);
    try {
      const txHash = await sendUsdc(
        sendTo.trim(), sendAmount.trim(),
        RPC[network] ?? RPC["base-sepolia"],
        USDC_ADDR[network] ?? USDC_ADDR["base-sepolia"],
      );
      toast.success(`发送成功 — ${txHash.slice(0, 12)}...`);
      setSendTo(""); setSendAmount(""); setPane(null);
      fetchBalance();
    } catch (e) {
      toast.error("发送失败: " + extractError(e));
    } finally {
      setSending(false);
    }
  };

  const copyAddress = () => {
    if (!wallet?.address) return;
    navigator.clipboard.writeText(wallet.address)
      .then(() => toast.success("地址已复制"))
      .catch(() => toast.error("复制失败"));
  };

  // ── Pagination ─────────────────────────────────────────
  const PAGE_SIZE = 15;
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [history]);

  // ── No wallet ──────────────────────────────────────────

  if (!wallet) {
    return (
      <div className="panel">
        <div className="card">
          <div className="card-head">
            <div className="ci ci-clay"><IconCoin /></div>
            <span className="card-title">创建钱包</span>
          </div>
          <div className="card-body">
            <div className="empty-state" style={{ paddingTop: 8 }}>
              <p className="empty-title">还没有钱包</p>
              <p className="empty-sub">创建一个新钱包，或导入已有助记词</p>
            </div>
            <button className="btn btn-primary btn-block" onClick={handleCreate}>
              创建新钱包
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div className="ci ci-purple"><IconKey /></div>
            <span className="card-title">导入助记词</span>
          </div>
          <div className="card-body">
            <textarea
              className="textarea-field" rows={3}
              placeholder="输入 12 个助记词，以空格分隔..."
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <button className="btn btn-ghost" onClick={handleImport} disabled={!importText.trim()}>
              导入
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Has wallet ─────────────────────────────────────────

  // Local history is already newest-first from the DB (ORDER BY id DESC), don't reverse.
  const payRecords: PayRecord[] = Array.isArray(history) ? (history as PayRecord[]) : [];
  const totalPages = Math.max(1, Math.ceil(payRecords.length / PAGE_SIZE));
  const pageRecords = payRecords.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="panel">

      {/* ── Balance card ── */}
      <div className="card">
        <div className="card-head">
          <div className="ci ci-green"><IconCoin /></div>
          <span className="card-title">余额</span>
          <select className="select-sm" value={network} onChange={(e) => handleNetworkChange(e.target.value)}>
            <option value="base-sepolia">Sepolia 测试网</option>
            <option value="base">Base 主网</option>
          </select>
        </div>
        <div className="card-body">

          {/* Balance amount + right-side actions */}
          <div className="balance-row">
            <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
              {loadingBal ? (
                <span className="balance-nil">—</span>
              ) : balance ? (
                <>
                  <span className="balance-amt">{balance.usdc}</span>
                  <span className="balance-unit">USDC</span>
                </>
              ) : (
                <span className="balance-nil">—</span>
              )}
              <button className={`icon-btn bal-refresh${loadingBal ? " bal-refresh-spin" : ""}`}
                onClick={fetchBalance} disabled={loadingBal} title="刷新余额">
                <IconRefresh />
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <button className="btn btn-ghost btn-sm" onClick={handleExport}>
                备份钱包
              </button>
            </div>
          </div>

          {/* Send / Receive toggle buttons */}
          <div className="wallet-actions">
            <button
              className={`btn ${pane === "send" ? "btn-primary" : "btn-ghost"} wallet-action-btn`}
              onClick={() => togglePane("send")}
            >
              <IconSend />发送
            </button>
            <button
              className={`btn ${pane === "receive" ? "btn-primary" : "btn-ghost"} wallet-action-btn`}
              onClick={() => togglePane("receive")}
            >
              <IconQR />接收
            </button>
          </div>

          {/* Send form */}
          {pane === "send" && (
            <div className="wallet-pane">
              <div className="send-row">
                <input
                  className="input-field"
                  placeholder="收款地址 0x..."
                  value={sendTo}
                  onChange={(e) => setSendTo(e.target.value)}
                  spellCheck={false}
                  style={{ flex: 1, minWidth: 0 }}
                />
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <input
                    className="input-field"
                    type="number"
                    min="0"
                    step="0.0001"
                    placeholder="0.00"
                    value={sendAmount}
                    onChange={(e) => setSendAmount(e.target.value)}
                    style={{ width: 120, paddingRight: 42 }}
                  />
                  <span className="input-suffix">USDC</span>
                </div>
              </div>
              <button
                className="btn btn-primary btn-block"
                onClick={handleSend}
                disabled={!sendTo.trim() || !sendAmount.trim() || sending}
              >
                {sending ? "发送中..." : "确认发送"}
              </button>
            </div>
          )}

          {/* Receive QR */}
          {pane === "receive" && (
            <div className="receive-pane">
              {/* Left: meta + address + copy */}
              <div className="receive-left">
                <div className="receive-meta">
                  <span className="receive-tag receive-tag-green">USDC</span>
                  <span className="receive-tag receive-tag-dim">
                    {network === "base" ? "Base 主网" : "Base Sepolia 测试网"}
                  </span>
                </div>
                <p className="addr-mono" style={{ fontSize: 10, lineHeight: 1.75, wordBreak: "break-all" }}>
                  {wallet.address}
                </p>
                <button className="btn btn-ghost btn-sm" onClick={copyAddress} style={{ alignSelf: "flex-start" }}>
                  复制地址
                </button>
              </div>

              {/* Right: QR code */}
              <div className="receive-right">
                {qrUrl
                  ? <img src={qrUrl} width={116} height={116} className="qr-img" alt="收款码" />
                  : <div className="qr-placeholder" style={{ width: 116, height: 116 }} />}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ── Mnemonic warning ── */}
      {showMnemonic && (
        <div className="warn-card">
          <span className="warn-label">助记词 — 请妥善保管，切勿截图</span>
          <p className="mnemonic-text">{mnemonic}</p>
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }}
            onClick={() => setShowMnemonic(false)}>
            隐藏
          </button>
        </div>
      )}

      {/* ── Payment history ── */}
      <div className="card">
        <div className="card-head">
          <div className="ci ci-blue"><IconHistory /></div>
          <span className="card-title">消费记录</span>
          <button className="icon-btn" onClick={() => { setPage(1); fetchHistory(); }} disabled={loadingHist} title="刷新">
            <IconRefresh />
          </button>
        </div>

        {payRecords.length > 0 ? (
          <>
            <div style={{ overflowX: "auto" }}>
              <table className="pay-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>模型</th>
                    <th>耗时</th>
                    <th>Token</th>
                    <th>费用</th>
                    <th>单价</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRecords.map((rec, i) => {
                    const amount = recAmountNum(rec);
                    const tok = recTokenLabels(rec);
                    const price = recPriceLabels(rec);
                    const hasCached = recCachedTokens(rec) > 0;
                    return (
                      <tr key={i}>
                        <td className="pay-td-time">{recLocalTime(rec)}</td>
                        <td className="pay-td-model" title={recModel(rec)}>{recModel(rec) || "—"}</td>
                        <td className="pay-td-num">{recDurationLabel(rec)}</td>
                        <td className="pay-td-num">
                          <span className="inline-split">
                            <span>{tok.input}<span className="split-lbl">in</span></span>
                            {hasCached && <span className="split-cached">{tok.cached}<span className="split-lbl">c</span></span>}
                            <span>{tok.output}<span className="split-lbl">out</span></span>
                          </span>
                        </td>
                        <td className="pay-td-num pay-td-cost">
                          {amount > 0 ? `$${amount.toFixed(5)}` : "—"}
                        </td>
                        <td className="pay-td-num">
                          <span className="inline-split">
                            <span>{price.input}<span className="split-lbl">in</span></span>
                            {hasCached && price.cached && <span className="split-cached">{price.cached}<span className="split-lbl">c</span></span>}
                            <span>{price.output}<span className="split-lbl">out</span></span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="pay-pager">
              <span className="pay-pager-count">{payRecords.length} 条</span>
              {totalPages > 1 && (
                <>
                  <button className="btn btn-ghost btn-sm" disabled={page <= 1}
                    onClick={() => setPage(p => Math.max(1, p - 1))}>‹ 上一页</button>
                  <span className="pay-pager-info">{page} / {totalPages}</span>
                  <button className="btn btn-ghost btn-sm" disabled={page >= totalPages}
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}>下一页 ›</button>
                </>
              )}
            </div>
          </>
        ) : (
          <div style={{ padding: "16px 13px", textAlign: "center" }}>
            <p style={{ fontSize: 12, color: "var(--t3)" }}>
              {loadingHist ? "加载中..." : "通过代理发起请求后显示"}
            </p>
          </div>
        )}
      </div>

    </div>
  );
}
