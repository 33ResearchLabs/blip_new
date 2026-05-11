"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Wallet,
  Lock,
  Unlock,
  Copy,
  Check,
  Loader2,
  Download,
  Trash2,
  Key,
  KeyRound,
  Eye,
  EyeOff,
  ArrowDownToLine,
  ArrowUpFromLine,
  Shield,
  RefreshCw,
  ExternalLink,
  Send,
  ArrowLeftRight,
  CreditCard,
  MoreHorizontal,
  Plus,
  ArrowDownRight,
  ArrowUpRight,
  XCircle,
  CheckCircle2,
  ScanSearch,
  LogOut,
} from "lucide-react";
import { MerchantNavbar } from "@/components/merchant/MerchantNavbar";
import { MerchantSettingsOverlay } from "@/components/merchant/MerchantSettingsOverlay";
import { copyToClipboard } from "@/lib/clipboard";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { DEVNET_RPC, DEVNET_WS_ENDPOINT } from "@/lib/solana/v2/config";
import { confirmHttp } from "@/lib/solana/confirmHttp";
import {
  generateWallet,
  importWallet,
  decryptWallet,
  exportPrivateKey,
  saveEncryptedWallet,
  loadEncryptedWallet,
  clearEncryptedWallet,
  hasEncryptedWallet,
} from "@/lib/wallet/embeddedWallet";
import { Keypair } from "@solana/web3.js";
import { useSolanaWallet } from "@/context/SolanaWalletContext";
import { showAlert } from "@/context/ModalContext";
import { MOCK_MODE } from "@/lib/config/mockMode";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { networkLabel, usdtLabel, explorerUrl, isMainnet } from "@/lib/solana/networkLabel";

interface MerchantInfo {
  id: string;
  username: string;
  display_name: string;
}

type WalletView = "loading" | "setup" | "unlock" | "main";

export default function WalletPage({
  onClose,
  onOpenSettings: onOpenSettingsProp,
}: { onClose?: () => void; onOpenSettings?: () => void } = {}) {
  const router = useRouter();
  const solanaWallet = useSolanaWallet();
  const embeddedWallet = (solanaWallet as any)?.embeddedWallet as
    | {
        state: "initializing" | "none" | "locked" | "unlocked";
        actorId: string | null;
        setActorId: (id: string | null) => void;
        unlockWallet: (password: string) => Promise<boolean>;
        lockWallet: () => void;
        deleteWallet: () => void;
        setKeypairAndUnlock: (kp: Keypair) => void;
      }
    | undefined;

  const [merchantInfo, setMerchantInfo] = useState<MerchantInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [view, setView] = useState<WalletView>("loading");

  // Setup state
  const [setupTab, setSetupTab] = useState<"create" | "import">("create");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [privateKeyInput, setPrivateKeyInput] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState("");

  // Unlock state
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockLoading, setUnlockLoading] = useState(false);
  const [unlockError, setUnlockError] = useState("");

  // Main wallet state
  const [copied, setCopied] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Send state
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendToken, setSendToken] = useState<"USDT" | "SOL">("USDT");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sendSuccess, setSendSuccess] = useState("");

  // Backup state (after creation)
  const [pendingKeypair, setPendingKeypair] = useState<Keypair | null>(null);
  const [backupDownloaded, setBackupDownloaded] = useState(false);

  // Receive modal state — shows the wallet address with quick copy / explorer
  // links so the merchant can hand it to a counterparty without copy-pasting
  // through the smaller address card. Mirrors the Send modal pattern so the
  // four-button row reads as a balanced quad (Send / Receive / Refresh / Export).
  const [showReceiveModal, setShowReceiveModal] = useState(false);

  // Balance privacy toggle — eye icon next to "Total Balance" lets the user
  // mask the number when sharing their screen. Pure UI state, no persistence
  // (re-shows on next visit by design).
  const [hideBalance, setHideBalance] = useState(false);

  // Export-key password prompt — replaces the native window.prompt() the
  // export flow used to call. window.prompt is unstyleable, can't show a
  // password mask, and looks foreign on production. The local modal mirrors
  // the rest of the wallet UI (dark glass card, primary CTA, eye toggle).
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportPassword, setExportPassword] = useState("");
  const [showExportPassword, setShowExportPassword] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState("");

  // Recent transaction history — surfaces the latest 5 wallet-ledger entries
  // directly on the wallet page so the merchant doesn't have to dig into the
  // Settings → Wallet Ledger tab to see what just happened. Shape mirrors
  // what the Settings Ledger uses; we only render a subset of fields here.
  type RecentLedgerEntry = {
    id: string;
    entry_type: string;
    amount: number;
    description: string | null;
    related_order_id: string | null;
    order_number: string | null;
    counterparty_name: string | null;
    created_at: string;
  };
  const [recentTxs, setRecentTxs] = useState<RecentLedgerEntry[]>([]);
  const [recentTxsLoading, setRecentTxsLoading] = useState(false);

  // Network Status polling — block height + RPC latency. Hits the same RPC the
  // wallet connection uses so the values reflect what THIS client sees, not a
  // generic /health endpoint. We poll every 10s because Solana slot time is
  // ~400ms but the indicator's purpose is "is the RPC alive and roughly fresh"
  // — sub-10s precision would just burn requests and battery.
  const [networkStatus, setNetworkStatus] = useState<{
    blockHeight: number | null;
    latency: number | null;
    healthy: boolean;
  }>({ blockHeight: null, latency: null, healthy: true });

  // Restore merchant session via cookie-authed /api/auth/me. Survives hard
  // refresh and deep-link entry — identity comes from the signed cookie,
  // not from any client-writable storage.
  //
  // Use fetchWithAuth so that a transient 401 (access-token expired between
  // the last activity and this navigation, OR a slow session-check at the
  // server timing out) gets ONE silent refresh-and-retry via the
  // blip_refresh_token cookie before we redirect to /merchant/login. The
  // previous raw `fetch` skipped that retry path and kicked the user to
  // login → the login page saw isLoggedIn was still true in the merchant
  // store and bounced them back, producing the visible logout-then-login
  // flicker the user reported.
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const res = await fetchWithAuth("/api/auth/me", {
          method: "GET",
          credentials: "include",
        });
        if (!res.ok) {
          setIsLoading(false);
          router.push("/merchant/login");
          return;
        }
        const data = await res.json();
        if (
          data?.success &&
          data?.data?.actorType === "merchant" &&
          data?.data?.merchant?.id
        ) {
          setMerchantInfo(data.data.merchant);
          setIsLoading(false);
          return;
        }
        setIsLoading(false);
        router.push("/merchant/login");
      } catch {
        setIsLoading(false);
        router.push("/merchant/login");
      }
    };
    restoreSession();
  }, [router]);

  // Hand the wallet context our actor id so its storage probe targets the
  // right per-merchant slot (and runs the one-time legacy migration). Until
  // this fires the context stays in 'initializing'.
  useEffect(() => {
    if (!embeddedWallet) return;
    embeddedWallet.setActorId(merchantInfo?.id ?? null);
  }, [embeddedWallet, merchantInfo?.id]);

  // Determine view based on wallet state
  useEffect(() => {
    if (isLoading) {
      setView("loading");
      return;
    }

    // In mock mode, wallet is always "connected" via DB — skip setup/unlock
    if (MOCK_MODE) {
      if (solanaWallet.connected) {
        setView("main");
        return;
      }
      // Mock wallet auto-connects when merchant session exists, show loading briefly
      setView("loading");
      return;
    }

    // Wait for the embedded wallet provider to finish loading (dynamic import + init)
    if (!embeddedWallet || embeddedWallet.state === "initializing") {
      setView("loading");
      return;
    }

    switch (embeddedWallet.state) {
      case "none":
        setView("setup");
        break;
      case "locked":
        setView("unlock");
        break;
      case "unlocked":
        setView("main");
        break;
    }
  }, [isLoading, embeddedWallet?.state, solanaWallet.connected]);

  // ── Network status polling ────────────────────────────────────────────
  // Calls our server-side proxy at /api/solana/network-status instead of
  // hitting the RPC directly. Why the proxy exists:
  //
  //   Public Solana RPCs — api.mainnet-beta.solana.com, api.devnet.solana.com,
  //   and most free mirrors — reject browser POSTs without a CORS allow-origin
  //   header. The fetch throws before the body is even read, so a direct
  //   client-side probe could only ever say "Down" on production. Doing the
  //   same call from /api/solana/network-status (server-side, no CORS) reaches
  //   the RPC normally and returns { slot, latency, healthy } as JSON.
  //
  //   The proxy caches results for 8s, so polling here at 10s yields at most
  //   one upstream RPC call per network per ~8s no matter how many tabs are
  //   open against this host.
  //
  // `latency` reported here is the proxy's server-to-RPC round-trip — that's
  // also what matters operationally (transaction submission speed), so it's
  // the more useful number to show the merchant anyway.
  useEffect(() => {
    if (view !== "main") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      const network = isMainnet() ? "mainnet-beta" : "devnet";
      try {
        const res = await fetchWithAuth(
          `/api/solana/network-status?network=${network}`,
        );
        const json = await res.json();
        if (cancelled) return;
        if (json?.success && json.data?.healthy) {
          setNetworkStatus({
            blockHeight: typeof json.data.slot === "number" ? json.data.slot : null,
            latency: typeof json.data.latency === "number" ? json.data.latency : null,
            healthy: true,
          });
        } else {
          setNetworkStatus((prev) => ({ ...prev, healthy: false }));
        }
      } catch {
        if (!cancelled) {
          setNetworkStatus((prev) => ({ ...prev, healthy: false }));
        }
      } finally {
        if (!cancelled) {
          timer = setTimeout(tick, 10_000);
        }
      }
    };
    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [view]);

  // ── Recent transactions fetch ─────────────────────────────────────────
  // Pulls the last 5 wallet-ledger entries from the same backend route the
  // Settings → Wallet Ledger tab uses. Re-fetches whenever the wallet view
  // mounts or the merchantInfo id changes, plus once after every successful
  // balance refresh (handleRefresh below) so a fresh send/receive shows up
  // without forcing a full page reload.
  const fetchRecentTxs = useCallback(async () => {
    const id = merchantInfo?.id;
    if (!id) return;
    setRecentTxsLoading(true);
    try {
      const res = await fetchWithAuth(
        `/api/merchant/wallet-ledger?merchant_id=${id}&limit=5&offset=0`,
      );
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.data?.entries)) {
          setRecentTxs(data.data.entries);
        }
      }
    } catch {
      // Non-fatal — section just stays empty if the API is down.
    } finally {
      setRecentTxsLoading(false);
    }
  }, [merchantInfo?.id]);

  useEffect(() => {
    if (view === "main") fetchRecentTxs();
  }, [view, fetchRecentTxs]);

  // ---- Handlers ----

  const handleCreate = async () => {
    setSetupError("");
    if (password.length < 6) {
      setSetupError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirmPassword) {
      setSetupError("Passwords do not match");
      return;
    }

    setSetupLoading(true);
    try {
      if (!merchantInfo?.id) {
        setSetupError("Session not ready yet — try again in a second");
        return;
      }
      const { keypair, encrypted } = await generateWallet(password);
      saveEncryptedWallet(merchantInfo.id, encrypted);
      setPendingKeypair(keypair);
    } catch (err: any) {
      setSetupError(err.message || "Failed to create wallet");
    } finally {
      setSetupLoading(false);
    }
  };

  const handleImport = async () => {
    setSetupError("");
    if (password.length < 6) {
      setSetupError("Password must be at least 6 characters");
      return;
    }
    if (!privateKeyInput.trim()) {
      setSetupError("Paste your private key");
      return;
    }

    setSetupLoading(true);
    try {
      if (!merchantInfo?.id) {
        setSetupError("Session not ready yet — try again in a second");
        return;
      }
      const { keypair, encrypted } = await importWallet(
        privateKeyInput.trim(),
        password,
      );
      saveEncryptedWallet(merchantInfo.id, encrypted);
      embeddedWallet?.setKeypairAndUnlock(keypair);
    } catch (err: any) {
      setSetupError(err.message || "Invalid private key");
    } finally {
      setSetupLoading(false);
    }
  };

  const handleDownloadBackup = () => {
    if (!pendingKeypair) return;
    const key = exportPrivateKey(pendingKeypair);
    const blob = new Blob(
      [
        `Blip Money — Wallet Backup\n\nPublic Key: ${pendingKeypair.publicKey.toBase58()}\nPrivate Key: ${key}\n\nKeep this file safe. Anyone with the private key can access your funds.\nGenerated: ${new Date().toISOString()}\n`,
      ],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `blip-wallet-backup-${pendingKeypair.publicKey.toBase58().slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setBackupDownloaded(true);
  };

  const handleFinishSetup = () => {
    if (pendingKeypair && embeddedWallet) {
      embeddedWallet.setKeypairAndUnlock(pendingKeypair);
      setPendingKeypair(null);
      setBackupDownloaded(false);
      setPassword("");
      setConfirmPassword("");
    }
  };

  const handleUnlock = async () => {
    if (!unlockPassword) return;
    setUnlockError("");
    setUnlockLoading(true);
    try {
      const ok = await embeddedWallet?.unlockWallet(unlockPassword.trim());
      if (!ok) {
        setUnlockError("Wrong password");
        setUnlockPassword("");
      }
    } catch {
      setUnlockError("Failed to decrypt wallet");
    } finally {
      setUnlockLoading(false);
    }
  };

  const handleCopyAddress = async () => {
    const addr = solanaWallet.walletAddress || address;
    if (!addr) return;
    await copyToClipboard(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      // Refresh both balances AND the recent-transactions strip so a fresh
      // send/receive doesn't sit invisible behind a stale list.
      await Promise.allSettled([
        solanaWallet.refreshBalances(),
        fetchRecentTxs(),
      ]);
    } catch {}
    setIsRefreshing(false);
  };

  const handleSend = async () => {
    setSendError("");
    setSendSuccess("");

    if (!sendTo.trim()) {
      setSendError("Enter a recipient address");
      return;
    }
    const amount = parseFloat(sendAmount);
    if (!amount || amount <= 0) {
      setSendError("Enter a valid amount");
      return;
    }

    // Validate Solana address
    let recipientPubkey: PublicKey;
    try {
      recipientPubkey = new PublicKey(sendTo.trim());
    } catch {
      setSendError("Invalid Solana address");
      return;
    }

    // Check balance
    if (sendToken === "SOL") {
      if (
        solanaWallet.solBalance !== null &&
        amount > solanaWallet.solBalance - 0.005
      ) {
        setSendError(`Insufficient SOL (need ~0.005 for fees)`);
        return;
      }
    } else {
      if (
        solanaWallet.usdtBalance !== null &&
        amount > solanaWallet.usdtBalance
      ) {
        setSendError(`Insufficient USDT balance`);
        return;
      }
    }

    if (!solanaWallet.publicKey) {
      setSendError("Wallet not connected");
      return;
    }
    const senderPubkey = solanaWallet.publicKey;

    setIsSending(true);
    try {
      const connection = new Connection(DEVNET_RPC, {
        commitment: "confirmed",
        wsEndpoint: DEVNET_WS_ENDPOINT,
      });

      if (sendToken === "SOL") {
        // Send SOL
        const { Transaction, SystemProgram } = await import("@solana/web3.js");
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: senderPubkey,
            toPubkey: recipientPubkey,
            lamports: Math.round(amount * LAMPORTS_PER_SOL),
          }),
        );
        tx.feePayer = senderPubkey;
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

        // Sign with embedded wallet keypair
        if (!merchantInfo?.id) throw new Error("Session not ready");
        const encrypted = loadEncryptedWallet(merchantInfo.id);
        if (!encrypted) throw new Error("Wallet not found");
        const pw = prompt("Enter wallet password to sign transaction");
        if (!pw) {
          setIsSending(false);
          return;
        }
        const kp = await decryptWallet(encrypted, pw.trim());
        tx.sign(kp);

        const sig = await connection.sendRawTransaction(tx.serialize());
        await confirmHttp(connection, sig);
        setSendSuccess(`Sent ${amount} SOL! Tx: ${sig.slice(0, 8)}...`);
      } else {
        // Send USDT (SPL token)
        const {
          getAssociatedTokenAddress,
          createAssociatedTokenAccountInstruction,
          createTransferInstruction,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        } = await import("@solana/spl-token");
        const { Transaction } = await import("@solana/web3.js");

        const USDT_MINT = new PublicKey(
          "FT8zRmLcsbNvqjCMSiwQC5GdkZfGtsoj8r5k19H65X9Z",
        ); // Devnet USDT

        const fromAta = await getAssociatedTokenAddress(
          USDT_MINT,
          senderPubkey,
        );
        const toAta = await getAssociatedTokenAddress(
          USDT_MINT,
          recipientPubkey,
        );

        const tx = new Transaction();

        // Create recipient ATA if needed
        const toAtaInfo = await connection.getAccountInfo(toAta);
        if (!toAtaInfo) {
          tx.add(
            createAssociatedTokenAccountInstruction(
              senderPubkey,
              toAta,
              recipientPubkey,
              USDT_MINT,
              TOKEN_PROGRAM_ID,
              ASSOCIATED_TOKEN_PROGRAM_ID,
            ),
          );
        }

        tx.add(
          createTransferInstruction(
            fromAta,
            toAta,
            senderPubkey,
            Math.round(amount * 1_000_000), // 6 decimals
          ),
        );

        tx.feePayer = senderPubkey;
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

        if (!merchantInfo?.id) throw new Error("Session not ready");
        const encrypted = loadEncryptedWallet(merchantInfo.id);
        if (!encrypted) throw new Error("Wallet not found");
        const pw = prompt("Enter wallet password to sign transaction");
        if (!pw) {
          setIsSending(false);
          return;
        }
        const kp = await decryptWallet(encrypted, pw.trim());
        tx.sign(kp);

        const sig = await connection.sendRawTransaction(tx.serialize());
        await confirmHttp(connection, sig);
        setSendSuccess(`Sent ${amount} USDT! Tx: ${sig.slice(0, 8)}...`);
      }

      // Refresh balances
      await solanaWallet.refreshBalances();
      setSendTo("");
      setSendAmount("");
    } catch (err: any) {
      setSendError(err.message || "Transaction failed");
    } finally {
      setIsSending(false);
    }
  };

  // Open the in-app password modal. The actual decrypt/download runs in
  // confirmExportKey below — splitting this lets the modal stay simple
  // (no async logic in the click handler) and keeps the download path
  // identical to the old prompt-based flow.
  const handleExportKey = () => {
    setExportPassword("");
    setShowExportPassword(false);
    setExportError("");
    setShowExportModal(true);
  };

  const confirmExportKey = async () => {
    setExportError("");
    if (!exportPassword) {
      setExportError("Enter your wallet password");
      return;
    }
    if (!merchantInfo?.id) {
      setExportError("Session not ready — try again in a moment");
      return;
    }
    const encrypted = loadEncryptedWallet(merchantInfo.id);
    if (!encrypted) {
      setShowExportModal(false);
      showAlert("Error", "No wallet found", "error");
      return;
    }
    setExportLoading(true);
    try {
      const kp = await decryptWallet(encrypted, exportPassword.trim());
      const key = exportPrivateKey(kp);
      const blob = new Blob(
        [
          `Blip Money — Wallet Export\n\nPublic Key: ${kp.publicKey.toBase58()}\nPrivate Key: ${key}\n\nKeep this file safe.\nExported: ${new Date().toISOString()}\n`,
        ],
        { type: "text/plain" },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `blip-wallet-export-${kp.publicKey.toBase58().slice(0, 8)}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      setShowExportModal(false);
      setExportPassword("");
    } catch {
      setExportError("Wrong password");
    } finally {
      setExportLoading(false);
    }
  };

  const handleDelete = () => {
    embeddedWallet?.deleteWallet();
    setShowDeleteConfirm(false);
  };

  const address = solanaWallet.walletAddress || "";
  const truncated = address
    ? `${address.slice(0, 8)}....${address.slice(-6)}`
    : "";

  // Loading
  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <MerchantNavbar
        activePage="wallet"
        merchantInfo={merchantInfo}
        embeddedWalletState={embeddedWallet?.state}
        onOpenSettings={onOpenSettingsProp ?? (() => setShowSettings(true))}
        onOpenWallet={onClose ? () => { /* already in wallet */ } : undefined}
        onNavLinkClick={onClose}
        onBack={onClose ?? (() => router.push("/merchant"))}
      />

      {/* Main content — wider on desktop so the redesigned wallet view can
          spread into a 2-column grid (wallet hero + tokens on the left,
          network status + security on the right). The setup / unlock /
          backup flows still center to a 420px column inside via `mx-auto
          max-w-[420px]` on each of those blocks — only the "main" view
          uses the full width. */}
      <div className="flex-1 flex items-start justify-center overflow-y-auto pt-4 pb-4 px-4">
        <div className={`w-full ${view === "main" ? "max-w-[1080px]" : "max-w-[420px]"}`}>
          {/* ========== LOADING VIEW ========== */}
          {view === "loading" && (
            <div className="flex flex-col items-center justify-center pt-24 space-y-4">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
              <p className="text-sm text-white/40 font-mono">
                Loading wallet...
              </p>
            </div>
          )}

          {/* ========== SETUP VIEW ========== */}
          {view === "setup" && !pendingKeypair && (
            <div className="space-y-6">
              {/* Wallet icon hero */}
              <div className="text-center pt-4">
                <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center mb-4">
                  <Wallet className="w-10 h-10 text-primary" />
                </div>
                <h1 className="text-2xl font-bold text-white font-mono">
                  Create Your Wallet
                </h1>
                <p className="text-sm text-white/40 font-mono mt-2">
                  Non-custodial Solana wallet. Your keys, your crypto.
                </p>
              </div>

              {/* Glass card */}
              <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-5 space-y-4">
                {/* Tabs */}
                <div className="flex bg-white/[0.03] rounded-lg p-[3px]">
                  <button
                    onClick={() => {
                      setSetupTab("create");
                      setSetupError("");
                    }}
                    className={`flex-1 py-2.5 rounded-md text-xs font-mono font-medium transition-colors ${
                      setupTab === "create"
                        ? "bg-white/[0.08] text-white"
                        : "text-white/40 hover:text-foreground/60"
                    }`}
                  >
                    Create New
                  </button>
                  <button
                    onClick={() => {
                      setSetupTab("import");
                      setSetupError("");
                    }}
                    className={`flex-1 py-2.5 rounded-md text-xs font-mono font-medium transition-colors ${
                      setupTab === "import"
                        ? "bg-white/[0.08] text-white"
                        : "text-white/40 hover:text-foreground/60"
                    }`}
                  >
                    Import Key
                  </button>
                </div>

                {setupError && (
                  <div className="p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 font-mono">
                    {setupError}
                  </div>
                )}

                {setupTab === "create" && (
                  <form
                    onSubmit={(e) => { e.preventDefault(); handleCreate(); }}
                    autoComplete="off"
                    className="space-y-3"
                  >
                    {/* Hidden username anchor: keeps Chrome's password manager
                        bound to THIS form so saved Gmail credentials don't bleed
                        into the chat search input on the page behind. */}
                    <input
                      type="text"
                      name="wallet-account"
                      autoComplete="username"
                      value="blip-merchant-wallet"
                      readOnly
                      aria-hidden="true"
                      tabIndex={-1}
                      className="absolute opacity-0 pointer-events-none h-0 w-0"
                    />
                    <div>
                      <label htmlFor="wallet-new-password" className="text-[10px] text-white/40 font-mono uppercase mb-1.5 block">
                        Password
                      </label>
                      <div className="relative">
                        <input
                          id="wallet-new-password"
                          name="wallet-new-password"
                          type={showPassword ? "text" : "password"}
                          autoComplete="new-password"
                          maxLength={100}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Min 6 characters"
                          className="w-full px-3 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl
                                     text-sm text-white font-mono placeholder:text-white/20
                                     focus:outline-none focus:border-primary/50 transition-colors"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2"
                        >
                          {showPassword ? (
                            <EyeOff className="w-4 h-4 text-white/30" />
                          ) : (
                            <Eye className="w-4 h-4 text-white/30" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label htmlFor="wallet-new-password-confirm" className="text-[10px] text-white/40 font-mono uppercase mb-1.5 block">
                        Confirm Password
                      </label>
                      <input
                        id="wallet-new-password-confirm"
                        name="wallet-new-password-confirm"
                        type="password"
                        autoComplete="new-password"
                        maxLength={100}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter password"
                        className="w-full px-3 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl
                                   text-sm text-white font-mono placeholder:text-white/20
                                   focus:outline-none focus:border-primary/50 transition-colors"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={setupLoading}
                      className="w-full py-3.5 rounded-xl bg-primary text-white font-bold font-mono text-sm
                                 hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {setupLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />{" "}
                          Generating...
                        </>
                      ) : (
                        <>
                          <Key className="w-4 h-4" /> Create Wallet
                        </>
                      )}
                    </button>
                  </form>
                )}

                {setupTab === "import" && (
                  <form
                    onSubmit={(e) => { e.preventDefault(); handleImport(); }}
                    autoComplete="off"
                    className="space-y-3"
                  >
                    {/* Hidden username anchor — see comment in create form. */}
                    <input
                      type="text"
                      name="wallet-account"
                      autoComplete="username"
                      value="blip-merchant-wallet"
                      readOnly
                      aria-hidden="true"
                      tabIndex={-1}
                      className="absolute opacity-0 pointer-events-none h-0 w-0"
                    />
                    <div>
                      <label htmlFor="wallet-import-key" className="text-[10px] text-white/40 font-mono uppercase mb-1.5 block">
                        Private Key (Base58)
                      </label>
                      <textarea
                        id="wallet-import-key"
                        name="wallet-import-key"
                        autoComplete="off"
                        maxLength={128}
                        value={privateKeyInput}
                        onChange={(e) => setPrivateKeyInput(e.target.value)}
                        placeholder="Paste your base58 private key..."
                        rows={3}
                        className="w-full px-3 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl
                                   text-sm text-white font-mono placeholder:text-white/20 resize-none
                                   focus:outline-none focus:border-primary/50 transition-colors"
                      />
                    </div>
                    <div>
                      <label htmlFor="wallet-import-password" className="text-[10px] text-white/40 font-mono uppercase mb-1.5 block">
                        Encryption Password
                      </label>
                      <input
                        id="wallet-import-password"
                        name="wallet-import-password"
                        type="password"
                        autoComplete="new-password"
                        maxLength={100}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Min 6 characters"
                        className="w-full px-3 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl
                                   text-sm text-white font-mono placeholder:text-white/20
                                   focus:outline-none focus:border-primary/50 transition-colors"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={setupLoading}
                      className="w-full py-3.5 rounded-xl bg-primary text-white font-bold font-mono text-sm
                                 hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {setupLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />{" "}
                          Importing...
                        </>
                      ) : (
                        <>
                          <ArrowDownToLine className="w-4 h-4" /> Import Wallet
                        </>
                      )}
                    </button>
                  </form>
                )}
              </div>

              {/* Security note */}
              <div className="flex items-start gap-2.5 px-1">
                <Shield className="w-4 h-4 text-white/20 shrink-0 mt-0.5" />
                <p className="text-[10px] text-white/25 font-mono leading-relaxed">
                  Your private key is encrypted with AES-256-GCM and stored only
                  in your browser. We never see or store your keys.
                </p>
              </div>
            </div>
          )}

          {/* ========== BACKUP VIEW (after create) ========== */}
          {view === "setup" && pendingKeypair && (
            <div className="space-y-6">
              <div className="text-center pt-4">
                <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center mb-4">
                  <Shield className="w-10 h-10 text-primary" />
                </div>
                <h1 className="text-2xl font-bold text-white font-mono">
                  Backup Your Wallet
                </h1>
                <p className="text-sm text-white/40 font-mono mt-2">
                  Download your recovery file. Without it, a forgotten password
                  means lost funds.
                </p>
              </div>

              <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-5 space-y-4">
                {/* Public address preview */}
                <div className="p-3 bg-white/[0.03] border border-white/[0.06] rounded-xl">
                  <div className="text-[10px] text-white/30 font-mono uppercase mb-1">
                    Your Public Address
                  </div>
                  <div className="text-sm text-white/80 font-mono break-all">
                    {pendingKeypair.publicKey.toBase58()}
                  </div>
                </div>

                {/* Download button */}
                <button
                  onClick={handleDownloadBackup}
                  className={`w-full py-3.5 rounded-xl font-bold font-mono text-sm flex items-center justify-center gap-2 transition-colors ${
                    backupDownloaded
                      ? "bg-green-500/20 border border-green-500/30 text-green-400"
                      : "bg-primary text-white hover:bg-primary/90"
                  }`}
                >
                  {backupDownloaded ? (
                    <>
                      <Check className="w-4 h-4" /> Backup Downloaded
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" /> Download Backup File
                    </>
                  )}
                </button>

                {/* Continue */}
                <button
                  onClick={handleFinishSetup}
                  disabled={!backupDownloaded}
                  className="w-full py-3.5 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white font-bold font-mono text-sm
                             hover:bg-accent-subtle transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                >
                  Continue to Wallet
                </button>
              </div>

              <div className="flex items-start gap-2.5 px-1">
                <Shield className="w-4 h-4 text-red-400/50 shrink-0 mt-0.5" />
                <p className="text-[10px] text-red-400/50 font-mono leading-relaxed">
                  The backup file contains your private key. Never share it.
                  Store it offline.
                </p>
              </div>
            </div>
          )}

          {/* ========== UNLOCK VIEW ========== */}
          {view === "unlock" && (
            <div className="space-y-6">
              <div className="text-center pt-4">
                <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-white/10 to-white/[0.02] border border-white/10 flex items-center justify-center mb-4">
                  <Lock className="w-10 h-10 text-white" />
                </div>
                <h1 className="text-2xl font-bold text-white font-mono">
                  Unlock Wallet
                </h1>
                <p className="text-sm text-white/40 font-mono mt-2">
                  Enter your password to access your wallet
                </p>
              </div>

              <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-5 space-y-4">
                {unlockError && (
                  <div className="p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 font-mono">
                    {unlockError}
                  </div>
                )}

                <form
                  onSubmit={(e) => { e.preventDefault(); handleUnlock(); }}
                  autoComplete="off"
                  className="space-y-4"
                >
                  {/* Hidden username anchor: keeps the password manager bound to
                      THIS form so the saved Gmail credential doesn't leak into
                      the chat search input on the page behind. */}
                  <input
                    type="text"
                    name="wallet-account"
                    autoComplete="username"
                    value="blip-merchant-wallet"
                    readOnly
                    aria-hidden="true"
                    tabIndex={-1}
                    className="absolute opacity-0 pointer-events-none h-0 w-0"
                  />
                  <div>
                    <label htmlFor="wallet-unlock-password" className="text-[10px] text-white/40 font-mono uppercase mb-1.5 block">
                      Password
                    </label>
                    <input
                      id="wallet-unlock-password"
                      name="wallet-unlock-password"
                      type="password"
                      autoComplete="current-password"
                      maxLength={100}
                      value={unlockPassword}
                      onChange={(e) => setUnlockPassword(e.target.value)}
                      placeholder="Enter your wallet password"
                      autoFocus
                      className="w-full px-3 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl
                                 text-sm text-white font-mono placeholder:text-white/20
                                 focus:outline-none focus:border-white/20 transition-colors"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={unlockLoading || !unlockPassword}
                    className="w-full py-3.5 rounded-xl bg-primary text-white font-bold font-mono text-sm
                               hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {unlockLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" /> Unlocking...
                      </>
                    ) : (
                      <>
                        <Unlock className="w-4 h-4" /> Unlock
                      </>
                    )}
                  </button>
                </form>

                <div className="flex items-center justify-between">
                  <button
                    onClick={() => {
                      embeddedWallet?.deleteWallet();
                      setSetupTab("import");
                    }}
                    className="text-[10px] text-white/40 hover:text-foreground/70 font-mono transition-colors flex items-center gap-1"
                  >
                    <Key className="w-3 h-3" />
                    Import with private key
                  </button>
                  <button
                    onClick={() => {
                      embeddedWallet?.deleteWallet();
                      setSetupTab("create");
                    }}
                    className="text-[10px] text-white/30 hover:text-foreground/50 font-mono transition-colors flex items-center gap-1"
                  >
                    <Wallet className="w-3 h-3" />
                    Create new wallet
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ========== MAIN WALLET VIEW ========== */}
          {view === "main" && (
            // Compact density pass — every card / spacer / font size dropped a
            // step so the full wallet view fits in a typical viewport (≈ 760px
            // tall) without scrolling. Same structure as before, just tighter:
            // outer gap 4→3, hero p-6→p-4, total balance text-5xl→text-4xl,
            // network status orb 32→24, action buttons py-4→py-3, etc.
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {/* ── LEFT COLUMN — wallet hero + actions + tokens ────────── */}
              <div className="lg:col-span-2 space-y-3">
                <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-green-500 rounded-full shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                      <span className="text-[11px] text-green-400 font-mono">
                        Connected
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/25">
                      <div className="w-1.5 h-1.5 bg-primary rounded-full" />
                      <span className="text-[10px] text-primary font-mono">
                        {networkLabel()}
                      </span>
                    </div>
                  </div>

                  <div className="text-center mb-3">
                    <div className="flex items-center justify-center gap-1.5 text-[10px] text-white/40 font-mono mb-1">
                      Total Balance
                      <button
                        onClick={() => setHideBalance((v) => !v)}
                        title={hideBalance ? "Show balance" : "Hide balance"}
                        className="p-0.5 rounded hover:bg-white/[0.06] transition-colors"
                      >
                        {hideBalance ? (
                          <EyeOff className="w-3 h-3 text-white/40" />
                        ) : (
                          <Eye className="w-3 h-3 text-white/40" />
                        )}
                      </button>
                    </div>
                    <div className="flex items-baseline justify-center gap-1.5 mb-0.5">
                      <span className="text-3xl font-bold text-white font-mono tabular-nums leading-none">
                        {hideBalance
                          ? "••••••"
                          : solanaWallet.usdtBalance !== null
                          ? solanaWallet.usdtBalance.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })
                          : "—"}
                      </span>
                      <span className="text-sm text-white/50 font-mono">USDT</span>
                    </div>
                    <div className="text-[10px] text-white/30 font-mono">
                      ≈ ${hideBalance
                        ? "••••"
                        : solanaWallet.usdtBalance !== null
                        ? solanaWallet.usdtBalance.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })
                        : "0.00"}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-2 flex items-center gap-2">
                      <div className="w-7 h-7 rounded-md bg-gradient-to-br from-purple-500/30 to-blue-500/30 flex items-center justify-center border border-purple-500/20 shrink-0">
                        <span className="text-[11px] font-bold text-purple-300">S</span>
                      </div>
                      <div className="min-w-0">
                        <div className="text-[9px] text-white/40 font-mono uppercase tracking-wider">
                          SOL Balance
                        </div>
                        <div className="text-[12px] font-bold text-white font-mono tabular-nums truncate">
                          {solanaWallet.solBalance !== null
                            ? `${solanaWallet.solBalance.toFixed(4)} SOL`
                            : "— SOL"}
                        </div>
                      </div>
                    </div>

                    <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-2 flex items-center gap-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="text-[9px] text-white/40 font-mono uppercase tracking-wider">
                          Wallet Address
                        </div>
                        <div className="text-[12px] font-bold text-white font-mono truncate">
                          {truncated}
                        </div>
                      </div>
                      <button
                        onClick={() => setShowReceiveModal(true)}
                        title="Show receive address"
                        className="p-1 rounded-md hover:bg-white/[0.06] transition-colors shrink-0"
                      >
                        <ArrowDownToLine className="w-3.5 h-3.5 text-white/40" />
                      </button>
                      <button
                        onClick={handleCopyAddress}
                        title={copied ? "Copied" : "Copy address"}
                        className="p-1 rounded-md hover:bg-white/[0.06] transition-colors shrink-0"
                      >
                        {copied ? (
                          <Check className="w-3.5 h-3.5 text-green-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5 text-white/40" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* 6-button action row matching the wallet UI mock:
                    Send / Receive / Swap / Buy / Export Key / More.
                    Swap and Buy are intentionally non-functional placeholders
                    — those features aren't wired up yet, but the icons need
                    to be present in the row for layout parity. They show a
                    "Coming Soon" alert on click so the click isn't silent.
                    "More" toggles between Refresh and a future menu — for
                    now it triggers Refresh so we don't lose that capability.
                */}
                <div className={`grid ${MOCK_MODE ? "grid-cols-5" : "grid-cols-6"} gap-2`}>
                  <button
                    onClick={() => {
                      setSendError("");
                      setSendSuccess("");
                      setShowSendModal(true);
                    }}
                    className="py-2.5 rounded-lg bg-primary/10 border border-primary/25 hover:bg-primary/15 transition-colors flex flex-col items-center gap-1"
                  >
                    <Send className="w-4 h-4 text-primary" />
                    <span className="text-[11px] text-primary font-mono font-medium">
                      Send
                    </span>
                  </button>
                  <button
                    onClick={() => setShowReceiveModal(true)}
                    className="py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] transition-colors flex flex-col items-center gap-1"
                  >
                    <ArrowDownToLine className="w-4 h-4 text-white/70" />
                    <span className="text-[11px] text-white/60 font-mono">Receive</span>
                  </button>
                  <button
                    onClick={() =>
                      showAlert("Coming Soon", "Token swap will be available soon.", "info")
                    }
                    className="py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] transition-colors flex flex-col items-center gap-1"
                  >
                    <ArrowLeftRight className="w-4 h-4 text-white/70" />
                    <span className="text-[11px] text-white/60 font-mono">Swap</span>
                  </button>
                  <button
                    onClick={() =>
                      showAlert("Coming Soon", "Buy crypto with fiat will be available soon.", "info")
                    }
                    className="py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] transition-colors flex flex-col items-center gap-1"
                  >
                    <CreditCard className="w-4 h-4 text-white/70" />
                    <span className="text-[11px] text-white/60 font-mono">Buy</span>
                  </button>
                  {!MOCK_MODE && (
                    <button
                      onClick={handleExportKey}
                      className="py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] transition-colors flex flex-col items-center gap-1"
                    >
                      <KeyRound className="w-4 h-4 text-white/70" />
                      <span className="text-[11px] text-white/60 font-mono">
                        Export Key
                      </span>
                    </button>
                  )}
                  <button
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                    title="Refresh balances"
                    className="py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] transition-colors flex flex-col items-center gap-1 disabled:opacity-50"
                  >
                    {isRefreshing ? (
                      <RefreshCw className="w-4 h-4 text-white/70 animate-spin" />
                    ) : (
                      <MoreHorizontal className="w-4 h-4 text-white/70" />
                    )}
                    <span className="text-[11px] text-white/60 font-mono">
                      {isRefreshing ? "..." : "More"}
                    </span>
                  </button>
                </div>

                <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl">
                  <div className="px-3 py-2 flex items-center justify-between border-b border-white/[0.06]">
                    <span className="text-[12px] font-bold text-white">
                      Your Tokens
                    </span>
                    <button className="text-[10px] text-white/40 hover:text-white/70 font-mono transition-colors">
                      View all
                    </button>
                  </div>
                  <div className="px-3 py-1.5 grid grid-cols-[1fr_1fr_1fr] gap-3 border-b border-white/[0.04]">
                    <span className="text-[9px] text-white/30 font-mono uppercase tracking-wider">Token</span>
                    <span className="text-[9px] text-white/30 font-mono uppercase tracking-wider">Balance</span>
                    <span className="text-[9px] text-white/30 font-mono uppercase tracking-wider text-right">Value (USD)</span>
                  </div>

                  <div className="px-3 py-2 grid grid-cols-[1fr_1fr_1fr] gap-3 items-center border-b border-white/[0.04]">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500/30 to-blue-500/30 flex items-center justify-center border border-purple-500/20 shrink-0">
                        <span className="text-[11px] font-bold text-purple-300">S</span>
                      </div>
                      <div className="min-w-0">
                        <div className="text-[12px] font-medium text-white font-mono">SOL</div>
                        <div className="text-[9px] text-white/30 font-mono">Solana</div>
                      </div>
                    </div>
                    <div>
                      <div className="text-[12px] font-bold text-white font-mono tabular-nums">
                        {solanaWallet.solBalance !== null
                          ? solanaWallet.solBalance.toFixed(4)
                          : "0.0000"}
                      </div>
                      <div className="text-[9px] text-white/30 font-mono">
                        ≈ $0.00
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[12px] font-bold text-white font-mono tabular-nums">
                        $0.00
                      </div>
                      <div className="text-[9px] text-white/30 font-mono">0.00%</div>
                    </div>
                  </div>

                  <div className="px-3 py-2 grid grid-cols-[1fr_1fr_1fr] gap-3 items-center border-b border-white/[0.04]">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-green-500/30 to-emerald-500/30 flex items-center justify-center border border-green-500/20 shrink-0">
                        <span className="text-[11px] font-bold text-green-300">$</span>
                      </div>
                      <div className="min-w-0">
                        <div className="text-[12px] font-medium text-white font-mono">USDT</div>
                        <div className="text-[9px] text-white/30 font-mono">{usdtLabel()}</div>
                      </div>
                    </div>
                    <div>
                      <div className="text-[12px] font-bold text-white font-mono tabular-nums">
                        {solanaWallet.usdtBalance !== null
                          ? solanaWallet.usdtBalance.toFixed(2)
                          : "0.00"}
                      </div>
                      <div className="text-[9px] text-white/30 font-mono">
                        ≈ ${solanaWallet.usdtBalance !== null
                          ? solanaWallet.usdtBalance.toFixed(2)
                          : "0.00"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[12px] font-bold text-white font-mono tabular-nums">
                        ${solanaWallet.usdtBalance !== null
                          ? solanaWallet.usdtBalance.toFixed(2)
                          : "0.00"}
                      </div>
                      <div className="text-[9px] text-white/30 font-mono">0.00%</div>
                    </div>
                  </div>

                  <button className="w-full px-3 py-2 flex items-center justify-between text-white/50 hover:text-white/80 hover:bg-white/[0.03] transition-colors">
                    <div className="flex items-center gap-2">
                      <Wallet className="w-3.5 h-3.5" />
                      <span className="text-[12px] font-mono">Manage Tokens</span>
                    </div>
                    <span className="text-white/30">›</span>
                  </button>
                </div>

                {/* Transaction History — last 5 wallet-ledger entries.
                    Same data source as Settings → Wallet Ledger; this strip
                    is the at-a-glance view, with "View all" jumping into
                    the full filterable list in Settings. */}
                <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl">
                  <div className="px-3 py-2 flex items-center justify-between border-b border-white/[0.06]">
                    <span className="text-[12px] font-bold text-white">
                      Transaction History
                    </span>
                    <button
                      onClick={() => router.push("/merchant/settings?tab=ledger")}
                      className="px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06] text-[10px] text-white/50 hover:text-white/80 font-mono transition-colors"
                    >
                      View all
                    </button>
                  </div>

                  {/* Column headers */}
                  <div className="px-3 py-1.5 grid grid-cols-[100px_88px_1fr_110px_90px_28px] gap-2 border-b border-white/[0.04]">
                    <span className="text-[9px] text-white/30 font-mono uppercase tracking-wider">Type</span>
                    <span className="text-[9px] text-white/30 font-mono uppercase tracking-wider">Status</span>
                    <span className="text-[9px] text-white/30 font-mono uppercase tracking-wider">From / To</span>
                    <span className="text-[9px] text-white/30 font-mono uppercase tracking-wider text-right">Amount</span>
                    <span className="text-[9px] text-white/30 font-mono uppercase tracking-wider text-right">Time</span>
                    <span />
                  </div>

                  {recentTxsLoading && recentTxs.length === 0 ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="w-4 h-4 text-white/30 animate-spin" />
                    </div>
                  ) : recentTxs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 gap-2">
                      <div className="w-9 h-9 rounded-full bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
                        <ArrowDownRight className="w-4 h-4 text-white/20" />
                      </div>
                      <p className="text-[11px] text-white/40">No transactions yet</p>
                    </div>
                  ) : (
                    recentTxs.map((tx) => {
                      const amt = Number(tx.amount) || 0;
                      const isIncoming = amt >= 0;
                      const isFailed =
                        tx.entry_type === "ESCROW_REFUND" ||
                        tx.entry_type === "ADJUSTMENT" &&
                          (tx.description || "").toLowerCase().includes("fail");
                      // Pretty type label — "Send" for outflows, "Receive"
                      // for inflows, "Swap" for synthetic conversions, fall
                      // back to the raw entry_type prettified for anything
                      // exotic (corridor fee, deposit, etc).
                      const typeLabel =
                        tx.entry_type === "SYNTHETIC_CONVERSION"
                          ? "Swap"
                          : isIncoming
                            ? "Receive"
                            : "Send";
                      // Reuse the same icons as the action button row above
                      // so a "Send" row visually matches the "Send" button
                      // (paper plane), Receive row matches the Receive button
                      // (down arrow), and Swap matches Swap.
                      const TypeIcon =
                        typeLabel === "Swap"
                          ? ArrowLeftRight
                          : isIncoming
                            ? ArrowDownToLine
                            : Send;
                      const cpRaw = tx.counterparty_name || tx.order_number || "—";
                      const cpDisplay =
                        cpRaw.length > 18 ? `${cpRaw.slice(0, 8)}…${cpRaw.slice(-6)}` : cpRaw;
                      const cpLabel = isIncoming ? "From:" : "To:";
                      // Relative time string: "2m ago" / "1h ago" / "3d ago"
                      const ts = new Date(tx.created_at).getTime();
                      const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
                      const rel =
                        diffSec < 60
                          ? "now"
                          : diffSec < 3600
                            ? `${Math.floor(diffSec / 60)}m ago`
                            : diffSec < 86400
                              ? `${Math.floor(diffSec / 3600)}h ago`
                              : `${Math.floor(diffSec / 86400)}d ago`;
                      return (
                        <div
                          key={tx.id}
                          className="px-3 py-2 grid grid-cols-[100px_88px_1fr_110px_90px_28px] gap-2 items-center border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors"
                        >
                          {/* Type */}
                          <div className="flex items-center gap-1.5 min-w-0">
                            <TypeIcon
                              className={`w-3.5 h-3.5 shrink-0 ${
                                typeLabel === "Swap"
                                  ? "text-blue-400"
                                  : isIncoming
                                    ? "text-emerald-400"
                                    : "text-red-400"
                              }`}
                            />
                            <span className="text-[12px] text-white truncate">{typeLabel}</span>
                          </div>

                          {/* Status */}
                          <div>
                            {isFailed ? (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                                <XCircle className="w-2.5 h-2.5" />
                                Failed
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                <CheckCircle2 className="w-2.5 h-2.5" />
                                Confirmed
                              </span>
                            )}
                          </div>

                          {/* From / To */}
                          <div className="min-w-0">
                            <p className="text-[11px] text-white font-mono truncate">{cpDisplay}</p>
                            <p className="text-[9px] text-white/30 font-mono">{cpLabel}</p>
                          </div>

                          {/* Amount */}
                          <div className="text-right">
                            <p
                              className={`text-[12px] font-bold font-mono tabular-nums ${
                                isIncoming ? "text-emerald-400" : "text-red-400"
                              }`}
                            >
                              {isIncoming ? "+" : ""}
                              {amt.toFixed(2)} USDT
                            </p>
                          </div>

                          {/* Time */}
                          <div className="text-right">
                            <p className="text-[11px] text-white/40 font-mono">{rel}</p>
                          </div>

                          {/* Action menu placeholder — clicking jumps to the
                              related order if there is one, otherwise no-op. */}
                          <button
                            onClick={() => {
                              if (tx.related_order_id) {
                                router.push(`/merchant?order=${tx.related_order_id}`);
                              }
                            }}
                            className="p-1 rounded hover:bg-white/[0.06] text-white/30 hover:text-white/70 transition-colors"
                            title={tx.related_order_id ? "Open related order" : "No related order"}
                          >
                            <MoreHorizontal className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* ── RIGHT COLUMN — network status + security ──────────── */}
              <div className="space-y-3">
                <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[12px] font-bold text-white">
                      Network Status
                    </span>
                  </div>

                  <div className="flex items-center gap-2 mb-3">
                    <div
                      className={`w-4 h-4 rounded-full flex items-center justify-center ${
                        networkStatus.healthy
                          ? "bg-green-500/20 border border-green-500/40"
                          : "bg-red-500/20 border border-red-500/40"
                      }`}
                    >
                      <Check
                        className={`w-2.5 h-2.5 ${
                          networkStatus.healthy ? "text-green-400" : "text-red-400"
                        }`}
                      />
                    </div>
                    <span
                      className={`text-[12px] font-mono ${
                        networkStatus.healthy ? "text-green-400" : "text-red-400"
                      }`}
                    >
                      {networkStatus.healthy
                        ? "All systems operational"
                        : "RPC unreachable"}
                    </span>
                  </div>

                  <div className="flex items-center justify-center mb-3">
                    <div className="w-20 h-20 rounded-full border border-white/[0.06] flex items-center justify-center bg-gradient-to-br from-purple-500/[0.04] to-blue-500/[0.04]">
                      <div className="w-11 h-11 rounded-full bg-gradient-to-br from-purple-500/30 to-cyan-400/30 flex items-center justify-center">
                        <Wallet className="w-5 h-5 text-white/80" />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-2 border-t border-white/[0.06]">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-white/50 font-mono">Network</span>
                      <span className="text-[11px] text-primary font-mono font-bold">
                        {networkLabel()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-white/50 font-mono">Block Height</span>
                      <span className="text-[11px] text-white font-mono tabular-nums">
                        {networkStatus.blockHeight !== null
                          ? networkStatus.blockHeight.toLocaleString()
                          : "—"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-white/50 font-mono">Connection</span>
                      <span
                        className={`text-[11px] font-mono ${
                          networkStatus.healthy ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        {networkStatus.healthy ? "Stable" : "Down"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-white/50 font-mono">Latency</span>
                      <span className="text-[11px] text-green-400 font-mono tabular-nums">
                        {networkStatus.latency !== null
                          ? `${networkStatus.latency}ms`
                          : "—"}
                      </span>
                    </div>
                  </div>
                </div>

                {!MOCK_MODE && (
                  <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl overflow-hidden">
                    <div className="px-3 py-2 border-b border-white/[0.06]">
                      <span className="text-[12px] font-bold text-white">Security</span>
                    </div>

                    <button
                      onClick={() => embeddedWallet?.lockWallet()}
                      className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-white/[0.04] transition-colors border-b border-white/[0.04]"
                    >
                      <div className="w-7 h-7 rounded-md bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
                        <Lock className="w-3.5 h-3.5 text-white/60" />
                      </div>
                      <div className="flex-1 text-left">
                        <div className="text-[12px] text-white font-mono">Lock Wallet</div>
                        <div className="text-[10px] text-white/40 font-mono">
                          Secure your wallet
                        </div>
                      </div>
                      <span className="text-white/30 text-sm">›</span>
                    </button>

                    <button
                      onClick={handleExportKey}
                      className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-white/[0.04] transition-colors border-b border-white/[0.04]"
                    >
                      <div className="w-7 h-7 rounded-md bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
                        <Download className="w-3.5 h-3.5 text-white/60" />
                      </div>
                      <div className="flex-1 text-left">
                        <div className="text-[12px] text-white font-mono">Download Backup</div>
                        <div className="text-[10px] text-white/40 font-mono">
                          Download your backup file
                        </div>
                      </div>
                      <span className="text-white/30 text-sm">›</span>
                    </button>

                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-[var(--color-error)]/5 transition-colors"
                    >
                      <div className="w-7 h-7 rounded-md bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0">
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </div>
                      <div className="flex-1 text-left">
                        <div className="text-[12px] text-red-400 font-mono">Delete Wallet</div>
                        <div className="text-[10px] text-white/40 font-mono">
                          Permanently delete wallet
                        </div>
                      </div>
                      <span className="text-white/30 text-sm">›</span>
                    </button>
                  </div>
                )}

                {/* Quick Actions — convenience shortcuts that don't fit
                    elsewhere. Each row reuses an existing handler:
                      - View on Solscan: opens explorer in a new tab
                      - Copy Address: same handler the wallet hero uses
                      - Disconnect Wallet: locks the embedded wallet (the
                        merchant can re-unlock from setup view) */}
                <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl overflow-hidden">
                  <div className="px-3 py-2 border-b border-white/[0.06]">
                    <span className="text-[12px] font-bold text-white">Quick Actions</span>
                  </div>

                  {address && (
                    <a
                      href={explorerUrl("address", address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-white/[0.04] transition-colors border-b border-white/[0.04]"
                    >
                      <div className="w-7 h-7 rounded-md bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
                        <ScanSearch className="w-3.5 h-3.5 text-white/60" />
                      </div>
                      <div className="flex-1 text-left">
                        <div className="text-[12px] text-white font-mono">View on Solscan</div>
                        <div className="text-[10px] text-white/40 font-mono">
                          View wallet on Solscan
                        </div>
                      </div>
                      <ExternalLink className="w-3.5 h-3.5 text-white/30 shrink-0" />
                    </a>
                  )}

                  <button
                    onClick={handleCopyAddress}
                    className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-white/[0.04] transition-colors border-b border-white/[0.04]"
                  >
                    <div className="w-7 h-7 rounded-md bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
                      {copied ? (
                        <Check className="w-3.5 h-3.5 text-green-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-white/60" />
                      )}
                    </div>
                    <div className="flex-1 text-left">
                      <div className="text-[12px] text-white font-mono">Copy Address</div>
                      <div className="text-[10px] text-white/40 font-mono">
                        Copy wallet address
                      </div>
                    </div>
                    <span className="text-white/30 text-sm">›</span>
                  </button>

                  {!MOCK_MODE && (
                    <button
                      onClick={() => embeddedWallet?.lockWallet()}
                      className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-white/[0.04] transition-colors"
                    >
                      <div className="w-7 h-7 rounded-md bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
                        <LogOut className="w-3.5 h-3.5 text-white/60" />
                      </div>
                      <div className="flex-1 text-left">
                        <div className="text-[12px] text-white font-mono">Disconnect Wallet</div>
                        <div className="text-[10px] text-white/40 font-mono">
                          Lock and disconnect
                        </div>
                      </div>
                      <LogOut className="w-3.5 h-3.5 text-white/30 shrink-0" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Send modal */}
      {showSendModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !isSending && setShowSendModal(false)}
        >
          <div
            className="bg-[#0d0d0d] rounded-2xl w-full max-w-sm border border-white/[0.08] shadow-2xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <Send className="w-5 h-5 text-primary" />
              <h3 className="text-base font-bold text-white font-mono">Send</h3>
            </div>

            {sendError && (
              <div className="p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 font-mono">
                {sendError}
              </div>
            )}
            {sendSuccess && (
              <div className="p-2.5 bg-green-500/10 border border-green-500/20 rounded-lg text-xs text-green-400 font-mono">
                {sendSuccess}
              </div>
            )}

            {!sendSuccess && (
              <>
                {/* Token selector */}
                <div className="flex bg-white/[0.03] rounded-lg p-[3px]">
                  <button
                    onClick={() => setSendToken("USDT")}
                    className={`flex-1 py-2 rounded-md text-xs font-mono font-medium transition-colors ${
                      sendToken === "USDT"
                        ? "bg-white/[0.08] text-white"
                        : "text-white/40"
                    }`}
                  >
                    USDT
                  </button>
                  <button
                    onClick={() => setSendToken("SOL")}
                    className={`flex-1 py-2 rounded-md text-xs font-mono font-medium transition-colors ${
                      sendToken === "SOL"
                        ? "bg-white/[0.08] text-white"
                        : "text-white/40"
                    }`}
                  >
                    SOL
                  </button>
                </div>

                {/* Recipient */}
                <div>
                  <label className="text-[10px] text-white/40 font-mono uppercase mb-1.5 block">
                    Recipient Address
                  </label>
                  <input
                    type="text"
                    value={sendTo}
                    onChange={(e) => setSendTo(e.target.value)}
                    placeholder="Solana address..."
                    className="w-full px-3 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-xl
                               text-sm text-white font-mono placeholder:text-white/20
                               focus:outline-none focus:border-primary/50 transition-colors"
                  />
                </div>

                {/* Amount */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] text-white/40 font-mono uppercase">
                      Amount
                    </label>
                    <button
                      onClick={() => {
                        const bal =
                          sendToken === "SOL"
                            ? Math.max(
                                0,
                                (solanaWallet.solBalance || 0) - 0.005,
                              )
                            : solanaWallet.usdtBalance || 0;
                        setSendAmount(bal.toString());
                      }}
                      className="text-[10px] text-primary/70 font-mono hover:text-primary"
                    >
                      MAX
                    </button>
                  </div>
                  <input
                    type="number"
                    value={sendAmount}
                    onChange={(e) => setSendAmount(e.target.value)}
                    placeholder="0.00"
                    step="any"
                    className="w-full px-3 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-xl
                               text-sm text-white font-mono placeholder:text-white/20
                               focus:outline-none focus:border-primary/50 transition-colors"
                  />
                  <div className="text-[10px] text-white/30 font-mono mt-1">
                    Available:{" "}
                    {sendToken === "SOL"
                      ? `${solanaWallet.solBalance?.toFixed(4) || "0"} SOL`
                      : `${solanaWallet.usdtBalance?.toFixed(2) || "0"} USDT`}
                  </div>
                </div>

                {/* Send button */}
                <button
                  onClick={handleSend}
                  disabled={isSending}
                  className="w-full py-3 rounded-xl bg-primary text-white font-bold font-mono text-sm
                             hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Sending...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" /> Send {sendToken}
                    </>
                  )}
                </button>
              </>
            )}

            {sendSuccess && (
              <button
                onClick={() => {
                  setShowSendModal(false);
                  setSendSuccess("");
                }}
                className="w-full py-3 rounded-xl bg-white/[0.06] text-white/60 font-mono text-sm hover:bg-accent-subtle transition-colors"
              >
                Done
              </button>
            )}
          </div>
        </div>
      )}

      {/* Receive modal — shows the full wallet address with quick actions
          (copy, view in explorer). Solana addresses are short enough that a
          full-string display is more useful than a QR for desktop merchants. */}
      {showReceiveModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowReceiveModal(false)}
        >
          <div
            className="bg-[#0d0d0d] rounded-2xl w-full max-w-sm border border-white/[0.08] shadow-2xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <ArrowDownToLine className="w-5 h-5 text-primary" />
              <h3 className="text-base font-bold text-white font-mono">
                Receive
              </h3>
            </div>
            <p className="text-xs text-white/50 font-mono leading-relaxed">
              Share this address to receive {usdtLabel()} or SOL on{" "}
              {networkLabel()}. Sending tokens from another network will result
              in lost funds.
            </p>
            <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3 space-y-2">
              <div className="text-[10px] text-white/40 font-mono uppercase tracking-wider">
                Wallet Address
              </div>
              <div className="text-sm text-white font-mono break-all">
                {address || "—"}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCopyAddress}
                className="flex-1 py-2.5 rounded-xl bg-primary/10 border border-primary/25 text-primary text-sm font-mono font-medium hover:bg-primary/15 transition-colors flex items-center justify-center gap-2"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" /> Copy Address
                  </>
                )}
              </button>
              {address && (
                <a
                  href={explorerUrl("address", address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2.5 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white/70 text-sm font-mono hover:bg-white/[0.10] transition-colors flex items-center justify-center"
                  title="View on explorer"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
            </div>
            <button
              onClick={() => setShowReceiveModal(false)}
              className="w-full py-2.5 rounded-xl bg-white/[0.04] text-sm text-white/60 font-mono hover:bg-white/[0.08] transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Export-key password modal — replaces the native window.prompt that
          used to handle this. Same look as Send / Receive: dark overlay,
          glass card, primary CTA. The actual decrypt + download runs in
          confirmExportKey; this just collects the password. */}
      {showExportModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !exportLoading && setShowExportModal(false)}
        >
          <div
            className="bg-[#0d0d0d] rounded-2xl w-full max-w-sm border border-white/[0.08] shadow-2xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <Key className="w-5 h-5 text-primary" />
              <h3 className="text-base font-bold text-white font-mono">
                Export Private Key
              </h3>
            </div>
            <p className="text-xs text-white/50 font-mono leading-relaxed">
              Enter your wallet password to decrypt and download the private
              key. Keep the exported file offline and treat it like cash —
              anyone with this key can move your funds.
            </p>

            {exportError && (
              <div className="p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 font-mono">
                {exportError}
              </div>
            )}

            <div>
              <label
                htmlFor="export-password"
                className="text-[10px] text-white/40 font-mono uppercase mb-1.5 block"
              >
                Wallet Password
              </label>
              <div className="relative">
                <input
                  id="export-password"
                  type={showExportPassword ? "text" : "password"}
                  autoComplete="current-password"
                  maxLength={100}
                  value={exportPassword}
                  onChange={(e) => setExportPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !exportLoading) confirmExportKey();
                  }}
                  placeholder="Enter wallet password"
                  className="w-full px-3 py-3 pr-10 bg-white/[0.04] border border-white/[0.08] rounded-xl text-sm text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-primary/50 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowExportPassword(!showExportPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                >
                  {showExportPassword ? (
                    <EyeOff className="w-4 h-4 text-white/30" />
                  ) : (
                    <Eye className="w-4 h-4 text-white/30" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowExportModal(false)}
                disabled={exportLoading}
                className="flex-1 py-2.5 rounded-xl bg-white/[0.04] text-sm text-white/60 font-mono hover:bg-white/[0.08] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmExportKey}
                disabled={exportLoading || !exportPassword}
                className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-background text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {exportLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Decrypting...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Export
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            className="bg-card-solid rounded-2xl w-full max-w-sm border border-white/[0.08] shadow-2xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-[var(--color-error)] font-mono">
              Delete Wallet?
            </h3>
            <p className="text-xs text-foreground/60 font-mono leading-relaxed">
              This removes the encrypted key from this device permanently. Make
              sure you have downloaded your backup file first.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2.5 rounded-xl bg-foreground/[0.06] text-sm text-foreground/70 font-mono hover:bg-foreground/[0.10] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 py-2.5 rounded-xl bg-[var(--color-error)]/15 border border-[var(--color-error)]/30 text-sm text-[var(--color-error)] font-mono hover:bg-[var(--color-error)]/25 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <MerchantSettingsOverlay
        open={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </div>
  );
}
