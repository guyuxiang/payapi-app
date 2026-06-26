import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  BalanceInfo,
  WalletInfo,
  createWallet,
  exportMnemonic,
  getBalance,
  getHistory,
  getWallet,
  importWallet,
} from "../lib/api";
import { extractError } from "../lib/error";

const RPC: Record<string, string> = {
  "base-sepolia": "https://sepolia.base.org",
  "base": "https://mainnet.base.org",
};
const USDC: Record<string, string> = {
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "base": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

export function useWallet(serverUrl: string, network: string) {
  const [wallet,      setWallet]      = useState<WalletInfo | null>(null);
  const [balance,     setBalance]     = useState<BalanceInfo | null>(null);
  const [mnemonic,    setMnemonic]    = useState("");
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [history,     setHistory]     = useState<unknown>(null);
  const [loadingBal,  setLoadingBal]  = useState(false);
  const [loadingHist, setLoadingHist] = useState(false);
  const [importText,  setImportText]  = useState("");

  useEffect(() => {
    getWallet().then(setWallet).catch(() => {});
  }, []);

  const fetchBalance = useCallback(async () => {
    setLoadingBal(true);
    try {
      const b = await getBalance(RPC[network] ?? RPC["base-sepolia"], USDC[network] ?? USDC["base-sepolia"]);
      setBalance(b);
    } catch (e) {
      toast.error("余额查询失败: " + extractError(e));
    } finally {
      setLoadingBal(false);
    }
  }, [network]);

  useEffect(() => {
    if (wallet) fetchBalance();
  }, [wallet, fetchBalance]);

  const fetchHistory = useCallback(async () => {
    if (!serverUrl) return;
    setLoadingHist(true);
    try {
      setHistory(await getHistory(serverUrl));
    } catch { /* server may not have history */ }
    finally { setLoadingHist(false); }
  }, [serverUrl]);

  // Auto-load history when wallet is ready and serverUrl is set
  useEffect(() => {
    if (wallet && serverUrl) fetchHistory();
  }, [wallet, fetchHistory, serverUrl]);

  const handleCreate = async () => {
    try {
      const w = await createWallet();
      setWallet(w);
      toast.success("钱包已创建！");
    } catch (e) { toast.error(extractError(e)); }
  };

  const handleImport = async () => {
    try {
      const w = await importWallet(importText.trim());
      setWallet(w);
      setImportText("");
      toast.success("钱包已导入！");
    } catch (e) { toast.error(extractError(e)); }
  };

  const handleExport = async () => {
    try {
      setMnemonic(await exportMnemonic());
      setShowMnemonic(true);
    } catch (e) { toast.error(extractError(e)); }
  };

  return {
    wallet, balance, mnemonic, showMnemonic, setShowMnemonic,
    history, loadingBal, loadingHist, importText, setImportText,
    fetchBalance, fetchHistory, handleCreate, handleImport, handleExport,
  };
}
