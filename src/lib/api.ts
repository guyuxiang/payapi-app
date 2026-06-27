import { invoke } from "@tauri-apps/api/core";

export interface WalletInfo {
  address: string;
  created_at: string;
}

export interface BalanceInfo {
  address: string;
  raw: string;
  usdc: string;
}

// ── Wallet ──────────────────────────────────────────────────────────────────

export const createWallet = () => invoke<WalletInfo>("x402_create_wallet");
export const importWallet = (mnemonic: string) =>
  invoke<WalletInfo>("x402_import_wallet", { mnemonic });
export const exportMnemonic = () => invoke<string>("x402_export_mnemonic");
export const getWallet = () => invoke<WalletInfo | null>("x402_get_wallet");
export const getAddress = () => invoke<string>("x402_get_address");
export const getBalance = (rpcUrl: string, usdcAddress: string) =>
  invoke<BalanceInfo>("x402_get_balance", { rpcUrl, usdcAddress });
export const getLocalHistory = (limit?: number) =>
  invoke<unknown[]>("x402_get_local_history", { limit });
export const sendUsdc = (toAddress: string, amount: string, rpcUrl: string, usdcAddress: string) =>
  invoke<string>("x402_send_usdc", { toAddress, amount, rpcUrl, usdcAddress });

// ── Proxy ────────────────────────────────────────────────────────────────────

export const startProxy = (serverUrl: string, port?: number) =>
  invoke<number>("x402_start_proxy", { serverUrl, port });
export const stopProxy = () => invoke<void>("x402_stop_proxy");
export const proxyStatus = () => invoke<number | null>("x402_proxy_status");

// ── Proxy Mode ────────────────────────────────────────────────────────────────

export interface ToolDetection {
  claude: boolean;
  claude_desktop: boolean;
  codex: boolean;
  gemini: boolean;
}

export const proxyModeEnable = () => invoke<void>("x402_proxy_mode_enable");
export const proxyModeDisable = () => invoke<void>("x402_proxy_mode_disable");
export const proxyModeStatus = () => invoke<boolean>("x402_proxy_mode_status");
export const detectTools = () => invoke<ToolDetection>("x402_detect_tools");
export const getProxyTools = () => invoke<string[]>("x402_get_proxy_tools");
export const setProxyTools = (tools: string[]) => invoke<void>("x402_set_proxy_tools", { tools });
export const applyTool = (key: string) => invoke<void>("x402_apply_tool", { key });
export const restoreTool = (key: string) => invoke<void>("x402_restore_tool", { key });

// ── Settings ──────────────────────────────────────────────────────────────────

export const getSetting = (key: string) => invoke<string | null>("x402_get_setting", { key });
export const setSetting = (key: string, value: string) =>
  invoke<void>("x402_set_setting", { key, value });
