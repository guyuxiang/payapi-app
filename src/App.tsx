import { useEffect, useState } from "react";
import { Toaster } from "react-hot-toast";
import { OverviewTab } from "./components/OverviewTab";
import { SettingsPanel } from "./components/SettingsPanel";
import { WalletPanel } from "./components/WalletPanel";
import { getSetting, setSetting } from "./lib/api";

type Tab = "overview" | "wallet" | "settings";

const DEFAULT_SERVER = "https://www.openshort.com/payapi";

// ── Inline SVG icons ──────────────────────────────────────

const IconOverview = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.2"/>
    <rect x="9"   y="1.5" width="5.5" height="5.5" rx="1.2"/>
    <rect x="1.5" y="9"   width="5.5" height="5.5" rx="1.2"/>
    <rect x="9"   y="9"   width="5.5" height="5.5" rx="1.2"/>
  </svg>
);


const IconWallet = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <rect x="1" y="4" width="14" height="10" rx="1.5" />
    <path d="M1 7.5h14" />
    <circle cx="12" cy="11" r="1.25" fill="currentColor" stroke="none" />
  </svg>
);

const IconSettings = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M2 4h12M2 8h12M2 12h12" />
    <circle cx="5.5" cy="4" r="1.5" fill="var(--surface)" stroke="currentColor" />
    <circle cx="10.5" cy="8" r="1.5" fill="var(--surface)" stroke="currentColor" />
    <circle cx="7"    cy="12" r="1.5" fill="var(--surface)" stroke="currentColor" />
  </svg>
);

// ─────────────────────────────────────────────────────────

const NAV: { id: Tab; label: string; Icon: () => JSX.Element }[] = [
  { id: "overview",  label: "概览", Icon: IconOverview  },
  { id: "wallet",    label: "钱包", Icon: IconWallet    },
  { id: "settings",  label: "设置", Icon: IconSettings  },
];

const PAGE_TITLES: Record<Tab, string> = {
  overview: "概览",
  wallet:   "钱包",
  settings: "设置",
};

export default function App() {
  const [tab, setTab]           = useState<Tab>("overview");
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER);
  const [loaded, setLoaded]     = useState(false);

  useEffect(() => {
    getSetting("server_url")
      .then((v) => { if (v) setServerUrl(v); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  const handleSetServerUrl = (v: string) => {
    setServerUrl(v);
    setSetting("server_url", v).catch(() => {});
  };

  if (!loaded) return null;

  return (
    <div className="app-shell">
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 3000,
          style: {
            background: "var(--surface-hi)",
            color: "var(--t1)",
            border: "1px solid var(--border-hi)",
            fontSize: "12.5px",
            borderRadius: "8px",
            padding: "10px 14px",
            boxShadow: "0 6px 20px rgba(30,20,10,0.18)",
          },
          success: {
            iconTheme: { primary: "var(--green)", secondary: "var(--green-bg)" },
          },
          error: {
            iconTheme: { primary: "var(--red)", secondary: "var(--red-bg)" },
          },
        }}
      />

      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sb-logo" aria-hidden="true" />

        <nav className="sb-nav">
          {NAV.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`sb-btn${tab === id ? " active" : ""}`}
              onClick={() => setTab(id)}
              title={label}
            >
              <Icon />
            </button>
          ))}
        </nav>

        <div className="sb-footer">
          <span className="sb-ver">x402</span>
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="main-area">
        <header className="page-header">
          <span className="page-title">{PAGE_TITLES[tab]}</span>
          <span className="page-badge">PAYAPI</span>
        </header>

        <div style={{ flex: 1, overflow: "auto", display: tab === "overview" ? undefined : "none" }}>
          <OverviewTab serverUrl={serverUrl} active={tab === "overview"} />
        </div>
        <div style={{ flex: 1, overflow: "auto", display: tab === "wallet" ? undefined : "none" }}>
          <WalletPanel serverUrl={serverUrl} active={tab === "wallet"} />
        </div>
        <div style={{ flex: 1, overflow: "auto", display: tab === "settings" ? undefined : "none" }}>
          <SettingsPanel serverUrl={serverUrl} setServerUrl={handleSetServerUrl} active={tab === "settings"} />
        </div>
      </div>
    </div>
  );
}
