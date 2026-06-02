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
import { AppPinPad } from "@/components/app-lock/AppPinPad";
import { AnimatePresence, motion } from "framer-motion";

const PIN_LENGTH = 6;
import { copyToClipboard } from "@/lib/clipboard";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { DEVNET_RPC, DEVNET_WS_ENDPOINT } from "@/lib/solana/v2/config";
import { confirmHttp } from "@/lib/solana/confirmHttp";
import {
  generateMnemonicWallet,
  importWallet,
  decryptWallet,
  exportPrivateKey,
  saveEncryptedWallet,
  loadEncryptedWallet,
  clearEncryptedWallet,
  hasEncryptedWallet,
  saveEncryptedMnemonic,
  validatePasswordStrength,
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
        migrateToPin?: (oldPassword: string, newPin: string) => Promise<boolean>;
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
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [createStep, setCreateStep] = useState<"enter" | "confirm">("enter");
  const [setupErrorTick, setSetupErrorTick] = useState(0);
  // Import tab PIN UX — PhonePe-style: tap a field to open the keypad.
  // null hides the keypad entirely until the user taps "PIN" or
  // "Confirm PIN". showPin reveals the entered digits in both fields.
  const [importActivePinField, setImportActivePinField] = useState<"pin" | "confirm" | null>(null);
  const [importShowPin, setImportShowPin] = useState(false);

  // Unlock state
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockLoading, setUnlockLoading] = useState(false);
  const [unlockError, setUnlockError] = useState("");
  const [unlockErrorTick, setUnlockErrorTick] = useState(0);

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
  // BIP39 phrase shown to the merchant on the backup screen after Create
  // (and after a successful mnemonic-Import). Null for legacy base58
  // imports which have no mnemonic.
  const [pendingMnemonic, setPendingMnemonic] = useState<string | null>(null);
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

  // PIN passed explicitly so this isn't dependent on state that hasn't
  // yet committed — AppPinPad fires onComplete synchronously inside the
  // same press handler that called setPassword.
  const handleCreate = async (pin: string = password) => {
    setSetupError("");
    if (!/^\d{6}$/.test(pin)) {
      setSetupError(`Enter your ${PIN_LENGTH}-digit PIN`);
      return;
    }

    setSetupLoading(true);
    try {
      if (!merchantInfo?.id) {
        setSetupError("Session not ready yet — try again in a second");
        return;
      }
      // Step 3 hardening: helper is mandatory for v3 wallets.
      const helperRes = await fetchWithAuth("/api/wallet/unlock-helper");
      const helperJson = await helperRes.json().catch(() => null);
      const unlockHelper: string | null = helperJson?.data?.unlock_helper ?? null;
      if (!unlockHelper) {
        setSetupError("Could not reach the server. Check your connection and try again.");
        return;
      }
      // Step 4: mnemonic-derived wallet so the merchant can recover funds
      // via the 12-word phrase in any Solana wallet if the device is lost.
      const { keypair, mnemonic, encrypted, encryptedMnemonic } =
        await generateMnemonicWallet(pin, unlockHelper);
      saveEncryptedWallet(merchantInfo.id, encrypted);
      saveEncryptedMnemonic(merchantInfo.id, encryptedMnemonic);
      setPendingKeypair(keypair);
      setPendingMnemonic(mnemonic);
    } catch (err: any) {
      setSetupError(err.message || "Failed to create wallet");
    } finally {
      setSetupLoading(false);
    }
  };

  const handleImport = async (pin: string = password) => {
    setSetupError("");
    if (!/^\d{6}$/.test(pin)) {
      setSetupError(`Enter your ${PIN_LENGTH}-digit PIN`);
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
      const helperRes = await fetchWithAuth("/api/wallet/unlock-helper");
      const helperJson = await helperRes.json().catch(() => null);
      const unlockHelper: string | null = helperJson?.data?.unlock_helper ?? null;
      if (!unlockHelper) {
        setSetupError("Could not reach the server. Check your connection and try again.");
        return;
      }
      // importWallet auto-detects mnemonic vs base58. When mnemonic was
      // supplied, persist the encrypted phrase too for later recovery.
      const { keypair, encrypted, encryptedMnemonic } = await importWallet(
        privateKeyInput.trim(),
        pin,
        unlockHelper,
      );
      saveEncryptedWallet(merchantInfo.id, encrypted);
      if (encryptedMnemonic) {
        saveEncryptedMnemonic(merchantInfo.id, encryptedMnemonic);
      }
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
    // Include the 12-word recovery phrase in the backup file when present.
    const mnemonicBlock = pendingMnemonic
      ? `Recovery Phrase (12 words):\n${pendingMnemonic}\n\nThis phrase recovers your wallet in ANY Solana wallet (Phantom, Solflare, etc.) under the standard derivation path m/44'/501'/0'/0'.\n\n`
      : "";
    const blob = new Blob(
      [
        `Blip Market — Wallet Backup\n\nPublic Key: ${pendingKeypair.publicKey.toBase58()}\n\n${mnemonicBlock}Private Key: ${key}\n\nKeep this file safe. Anyone with the recovery phrase or private key can access your funds.\nGenerated: ${new Date().toISOString()}\n`,
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
      setPendingMnemonic(null);
      setBackupDownloaded(false);
      setPassword("");
      setConfirmPassword("");
    }
  };

  const handleUnlock = async (pin: string = unlockPassword) => {
    if (!pin) return;
    setUnlockError("");
    setUnlockLoading(true);
    try {
      const ok = await embeddedWallet?.unlockWallet(pin.trim());
      if (!ok) {
        setUnlockError("Wrong PIN");
        setUnlockErrorTick((t) => t + 1);
        setUnlockPassword("");
      }
    } catch {
      setUnlockError("Failed to decrypt wallet");
      setUnlockErrorTick((t) => t + 1);
      setUnlockPassword("");
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
        const sendHelperRes = await fetchWithAuth("/api/wallet/unlock-helper");
        const sendHelperJson = await sendHelperRes.json().catch(() => null);
        const sendHelper: string | null = sendHelperJson?.data?.unlock_helper ?? null;
        const kp = await decryptWallet(encrypted, pw.trim(), sendHelper);
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
        const sendHelperRes = await fetchWithAuth("/api/wallet/unlock-helper");
        const sendHelperJson = await sendHelperRes.json().catch(() => null);
        const sendHelper: string | null = sendHelperJson?.data?.unlock_helper ?? null;
        const kp = await decryptWallet(encrypted, pw.trim(), sendHelper);
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
      const exportHelperRes = await fetchWithAuth("/api/wallet/unlock-helper");
      const exportHelperJson = await exportHelperRes.json().catch(() => null);
      const exportHelper: string | null = exportHelperJson?.data?.unlock_helper ?? null;
      const kp = await decryptWallet(encrypted, exportPassword.trim(), exportHelper);
      const key = exportPrivateKey(kp);
      const blob = new Blob(
        [
          `Blip Market — Wallet Export\n\nPublic Key: ${kp.publicKey.toBase58()}\nPrivate Key: ${key}\n\nKeep this file safe.\nExported: ${new Date().toISOString()}\n`,
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
        <Loader2 className="w-8 h-8 text-[#f5f5f7] animate-spin" />
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
              <Loader2 className="w-8 h-8 text-[#f5f5f7] animate-spin" />
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
                <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-white/70 to-white/60 border border-white/[0.12] flex items-center justify-center mb-4">
                  <Wallet className="w-10 h-10 text-[#f5f5f7]" />
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
                  <div className="space-y-4">
                    <AnimatePresence mode="wait">
                      <motion.p
                        key={createStep}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                        className="text-sm font-mono text-center text-white/60"
                      >
                        {createStep === "enter"
                          ? "Use your 6-digit sign-in PIN."
                          : "Re-enter to confirm."}
                      </motion.p>
                    </AnimatePresence>

                    <div style={{ maxWidth: 320, width: "100%", margin: "0 auto" }}>
                      <AnimatePresence mode="wait">
                        <motion.div
                          key={createStep}
                          initial={{ opacity: 0, x: createStep === "confirm" ? 24 : -24 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: createStep === "confirm" ? -24 : 24 }}
                          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                        >
                          {createStep === "enter" ? (
                            <AppPinPad
                              value={password}
                              onChange={setPassword}
                              onComplete={() => setCreateStep("confirm")}
                              length={PIN_LENGTH}
                              disabled={setupLoading}
                            />
                          ) : (
                            <AppPinPad
                              value={confirmPassword}
                              onChange={setConfirmPassword}
                              onComplete={(v) => {
                                if (v === password) {
                                  handleCreate(v);
                                } else {
                                  setSetupError("PINs do not match");
                                  setSetupErrorTick((t) => t + 1);
                                  setConfirmPassword("");
                                  setPassword("");
                                  setCreateStep("enter");
                                }
                              }}
                              length={PIN_LENGTH}
                              errorTick={setupErrorTick}
                              disabled={setupLoading}
                            />
                          )}
                        </motion.div>
                      </AnimatePresence>
                    </div>

                    {setupLoading && (
                      <div className="flex items-center justify-center gap-2 text-white/60">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-xs font-mono">Generating wallet…</span>
                      </div>
                    )}
                  </div>
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
                        Recovery Phrase or Private Key
                      </label>
                      <textarea
                        id="wallet-import-key"
                        name="wallet-import-key"
                        autoComplete="off"
                        // Allow enough room for a 24-word phrase (~220 chars)
                        // plus 12-word phrases (~120 chars) and base58 keys
                        // (~88 chars). importWallet auto-detects format.
                        maxLength={300}
                        value={privateKeyInput}
                        onChange={(e) => setPrivateKeyInput(e.target.value)}
                        placeholder="Paste your 12-word recovery phrase OR base58 private key..."
                        rows={3}
                        className="w-full px-3 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl
                                   text-sm text-white font-mono placeholder:text-white/20 resize-none
                                   focus:outline-none focus:border-white/[0.12] transition-colors"
                      />
                    </div>
                    <p className="text-sm font-mono text-center text-white/60">
                      Set a 6-digit PIN to encrypt your wallet.
                    </p>

                    {/* PIN + Confirm PIN field displays — tap to open the
                        keypad below for that field. Eye toggle reveals the
                        entered digits in both fields. */}
                    <div className="flex flex-col gap-2">
                      <PinFieldDisplay
                        label="PIN"
                        value={password}
                        length={PIN_LENGTH}
                        active={importActivePinField === "pin"}
                        show={importShowPin}
                        onClick={() => setImportActivePinField("pin")}
                      />
                      <PinFieldDisplay
                        label="Confirm PIN"
                        value={confirmPassword}
                        length={PIN_LENGTH}
                        active={importActivePinField === "confirm"}
                        show={importShowPin}
                        onClick={() => setImportActivePinField("confirm")}
                        trailing={
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setImportShowPin((s) => !s);
                            }}
                            className="p-1.5 rounded-md transition-colors hover:bg-white/[0.06]"
                            aria-label={importShowPin ? "Hide PIN" : "Show PIN"}
                          >
                            {importShowPin ? (
                              <EyeOff className="w-4 h-4 text-white/40" />
                            ) : (
                              <Eye className="w-4 h-4 text-white/40" />
                            )}
                          </button>
                        }
                      />
                    </div>

                    {/* Keypad — appears only after a field is tapped.
                        Entering 6 digits in PIN auto-advances to Confirm
                        PIN; matching both triggers handleImport. */}
                    <AnimatePresence>
                      {importActivePinField && (
                        <motion.div
                          key={importActivePinField}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 8 }}
                          transition={{ duration: 0.2 }}
                          style={{ maxWidth: 320, width: "100%", margin: "0 auto" }}
                        >
                          <AppPinPad
                            value={importActivePinField === "pin" ? password : confirmPassword}
                            onChange={(v) => {
                              if (importActivePinField === "pin") setPassword(v);
                              else setConfirmPassword(v);
                            }}
                            onComplete={(v) => {
                              if (importActivePinField === "pin") {
                                setImportActivePinField("confirm");
                              } else if (v === password) {
                                if (privateKeyInput.trim()) handleImport(v);
                                else setSetupError("Paste your recovery phrase or private key above.");
                              } else {
                                setSetupError("PINs do not match");
                                setSetupErrorTick((t) => t + 1);
                                setConfirmPassword("");
                              }
                            }}
                            length={PIN_LENGTH}
                            errorTick={setupErrorTick}
                            disabled={setupLoading}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>
                    {setupLoading && (
                      <div className="flex items-center justify-center gap-2 text-white/60">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-xs font-mono">Importing wallet…</span>
                      </div>
                    )}
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
                <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-white/70 to-white/60 border border-white/[0.12] flex items-center justify-center mb-4">
                  <Shield className="w-10 h-10 text-[#f5f5f7]" />
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

                {/* Recovery phrase — shown only for mnemonic-derived wallets
                    (new Create flow + mnemonic-Import). Legacy base58 imports
                    skip this block. */}
                {pendingMnemonic && (
                  <div className="p-3 bg-yellow-500/[0.04] border border-yellow-500/[0.15] rounded-xl">
                    <div className="text-[10px] text-yellow-400/70 font-mono uppercase mb-2 flex items-center gap-1.5">
                      <Key className="w-3 h-3" /> Recovery Phrase (write down)
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {pendingMnemonic.split(/\s+/).map((word, i) => (
                        <div
                          key={i}
                          className="px-2 py-1.5 bg-black/30 border border-white/[0.06] rounded text-[11px] font-mono text-white/80 flex items-center gap-1.5"
                        >
                          <span className="text-white/30 text-[9px] w-3 text-right">
                            {i + 1}
                          </span>
                          <span>{word}</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[9px] text-yellow-400/50 font-mono mt-2 leading-relaxed">
                      These 12 words recover your wallet in any Solana wallet
                      (Phantom, Solflare, etc.). Write them down OFFLINE.
                      Anyone with this phrase controls your funds.
                    </p>
                  </div>
                )}

                {/* Download button */}
                <button
                  onClick={handleDownloadBackup}
                  className={`w-full py-3.5 rounded-xl font-bold font-mono text-sm flex items-center justify-center gap-2 transition-colors ${
                    backupDownloaded
                      ? "bg-white/[0.06] border border-white/[0.09] text-[#f5f5f7]"
                      : "bg-[#f5f5f7] text-background hover:bg-white/[0.08]"
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
                  <p className="text-sm font-mono text-center text-white/60">
                    Enter your 6-digit sign-in PIN.
                  </p>
                  <div style={{ maxWidth: 320, width: "100%", margin: "0 auto" }}>
                    <AppPinPad
                      value={unlockPassword}
                      onChange={setUnlockPassword}
                      onComplete={(v) => handleUnlock(v)}
                      length={PIN_LENGTH}
                      errorTick={unlockErrorTick}
                      disabled={unlockLoading}
                    />
                  </div>
                  {unlockLoading && (
                    <div className="flex items-center justify-center gap-2 text-white/60">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-xs font-mono">Unlocking…</span>
                    </div>
                  )}
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
            <div className="relative">
            {/* Ambient mesh */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 0 }}>
              <div style={{ position: "absolute", width: 340, height: 340, left: "-5%", top: "-8%", borderRadius: "50%", background: "radial-gradient(circle, rgba(120,134,224,0.40), transparent 62%)", mixBlendMode: "screen", filter: "blur(44px)", opacity: 0.85 }} />
              <div style={{ position: "absolute", width: 300, height: 300, right: "-8%", top: "3%", borderRadius: "50%", background: "radial-gradient(circle, rgba(196,138,224,0.32), transparent 62%)", mixBlendMode: "screen", filter: "blur(44px)", opacity: 0.85 }} />
            </div>
            <div className="relative grid grid-cols-1 lg:grid-cols-3 gap-3" style={{ zIndex: 1 }}>
              {/* ── LEFT COLUMN — wallet hero + actions + tokens ────────── */}
              <div className="lg:col-span-2 space-y-3">
                {/* Connected card */}
                <div style={{ background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 20, backdropFilter: "blur(20px) saturate(150%)", padding: 17 }}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#b8e9d4", boxShadow: "0 0 8px rgba(184,233,212,0.7)" }} />
                      <span style={{ color: "#b8e9d4", fontWeight: 700, fontSize: 13 }}>Connected</span>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", fontSize: 12, fontWeight: 700, color: "#f5f5f7" }}>
                      <div className="w-1.5 h-1.5 rounded-full bg-white" />
                      {networkLabel()}
                    </div>
                  </div>

                  {/* Total balance */}
                  <div className="text-center pb-4">
                    <button onClick={() => setHideBalance((v) => !v)} className="flex items-center justify-center gap-1.5 mx-auto mb-2" style={{ background: "none", border: "none", cursor: "pointer", color: "#86868b", fontSize: 13, fontWeight: 600 }}>
                      Total Balance
                      {hideBalance ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    <div className="flex items-baseline justify-center gap-2 mb-1">
                      <span style={{ fontSize: 30, fontWeight: 800, color: "#f5f5f7", fontVariantNumeric: "tabular-nums" }}>
                        {hideBalance ? "••••" : solanaWallet.usdtBalance !== null ? solanaWallet.usdtBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}
                      </span>
                      <span style={{ color: "#86868b", fontSize: 17, fontWeight: 700 }}>USDT</span>
                    </div>
                    <div style={{ color: "#5a5a60", fontSize: 12.5, fontWeight: 600 }}>
                      ≈ ${hideBalance ? "••••" : solanaWallet.usdtBalance !== null ? solanaWallet.usdtBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}
                    </div>
                  </div>

                  {/* SOL balance + address mini tiles */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: "linear-gradient(150deg,#9945ff,#14f195)", fontWeight: 800, fontSize: 15, color: "#fff" }}>◎</div>
                      <div className="min-w-0">
                        <div style={{ color: "#86868b", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>SOL BALANCE</div>
                        <div style={{ fontWeight: 800, fontSize: 14, color: "#f5f5f7" }} className="truncate">{solanaWallet.solBalance !== null ? `${solanaWallet.solBalance.toFixed(4)} SOL` : "— SOL"}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                      <div className="flex-1 min-w-0">
                        <div style={{ color: "#86868b", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>WALLET ADDRESS</div>
                        <div style={{ fontWeight: 700, fontSize: 13, color: "#f5f5f7" }} className="truncate">{truncated}</div>
                      </div>
                      <button onClick={() => setShowReceiveModal(true)} title="Show receive address" className="p-1 rounded-md transition-colors shrink-0" style={{ background: "none", border: "none", cursor: "pointer", color: "#aeaeb2" }}>
                        <ArrowDownToLine className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={handleCopyAddress} title={copied ? "Copied" : "Copy address"} className="p-1 rounded-md transition-colors shrink-0" style={{ background: "none", border: "none", cursor: "pointer", color: copied ? "#b8e9d4" : "#aeaeb2" }}>
                        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Action grid — Send is primary (white), rest are glass */}
                <div className={`grid ${MOCK_MODE ? "grid-cols-5" : "grid-cols-6"} gap-2`}>
                  {([
                    { label: "Send", icon: <Send className="w-[18px] h-[18px]" />, active: true, action: () => { setSendError(""); setSendSuccess(""); setShowSendModal(true); } },
                    { label: "Receive", icon: <ArrowDownToLine className="w-[18px] h-[18px]" />, action: () => setShowReceiveModal(true) },
                    { label: "Swap", icon: <ArrowLeftRight className="w-[18px] h-[18px]" />, action: () => showAlert("Coming Soon", "Token swap will be available soon.", "info") },
                    { label: "Buy", icon: <CreditCard className="w-[18px] h-[18px]" />, action: () => showAlert("Coming Soon", "Buy crypto with fiat will be available soon.", "info") },
                    ...(!MOCK_MODE ? [{ label: "Export Key", icon: <KeyRound className="w-[18px] h-[18px]" />, action: handleExportKey }] : []),
                    { label: isRefreshing ? "..." : "More", icon: isRefreshing ? <RefreshCw className="w-[18px] h-[18px] animate-spin" /> : <MoreHorizontal className="w-[18px] h-[18px]" />, action: handleRefresh, disabled: isRefreshing },
                  ] as Array<{ label: string; icon: React.ReactNode; active?: boolean; action: () => void; disabled?: boolean }>).map(({ label, icon, active, action, disabled }) => (
                    <button key={label} onClick={action} disabled={disabled} style={{ flex: 1, padding: "13px 2px", borderRadius: 15, border: active ? "none" : "1px solid rgba(255,255,255,0.09)", background: active ? "#f5f5f7" : "rgba(255,255,255,0.03)", color: active ? "#0b0b0c" : "#aeaeb2", display: "flex", flexDirection: "column", alignItems: "center", gap: 7, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, fontFamily: "inherit" }}>
                      {icon}
                      <span style={{ fontSize: 10, fontWeight: 700, color: active ? "#0b0b0c" : "#86868b", whiteSpace: "nowrap" }}>{label}</span>
                    </button>
                  ))}
                </div>

                {/* Your Tokens */}
                <div style={{ background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 20, backdropFilter: "blur(20px) saturate(150%)", padding: "15px 15px 6px" }}>
                  <div className="flex items-center justify-between mb-3">
                    <span style={{ fontWeight: 800, fontSize: 16, color: "#f5f5f7" }}>Your Tokens</span>
                    <button style={{ background: "none", border: "none", cursor: "pointer", color: "#b8e9d4", fontSize: 12.5, fontWeight: 700 }}>View all</button>
                  </div>
                  {([
                    { sym: "SOL", name: "Solana", iconBg: "linear-gradient(150deg,#9945ff,#14f195)", iconLabel: "◎", bal: solanaWallet.solBalance !== null ? solanaWallet.solBalance.toFixed(4) : "0.0000", usd: "$0.00" },
                    { sym: "USDT", name: usdtLabel(), iconBg: "#1c9c6b", iconLabel: "$", bal: solanaWallet.usdtBalance !== null ? solanaWallet.usdtBalance.toFixed(2) : "0.00", usd: `$${solanaWallet.usdtBalance !== null ? solanaWallet.usdtBalance.toFixed(2) : "0.00"}` },
                  ] as Array<{ sym: string; name: string; iconBg: string; iconLabel: string; bal: string; usd: string }>).map((t, i) => (
                    <div key={t.sym} className="flex items-center gap-3 py-2.5" style={{ borderTop: i ? "1px solid rgba(255,255,255,0.07)" : "none" }}>
                      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: t.iconBg, fontWeight: 800, fontSize: 16, color: "#fff" }}>{t.iconLabel}</div>
                      <div className="flex-1 min-w-0">
                        <div style={{ fontWeight: 800, fontSize: 14, color: "#f5f5f7" }}>{t.sym}</div>
                        <div style={{ color: "#86868b", fontSize: 11.5, fontWeight: 600 }}>{t.name}</div>
                      </div>
                      <div className="text-right">
                        <div style={{ fontSize: 14, fontWeight: 800, color: "#f5f5f7" }}>{hideBalance ? "••••" : t.bal}</div>
                        <div style={{ color: "#5a5a60", fontSize: 11, fontWeight: 600 }}>≈ {hideBalance ? "••••" : t.usd}</div>
                      </div>
                      <div className="text-right" style={{ minWidth: 52 }}>
                        <div style={{ fontSize: 14, fontWeight: 800, color: "#f5f5f7" }}>{hideBalance ? "••••" : t.usd}</div>
                        <div style={{ color: "#5a5a60", fontSize: 11, fontWeight: 600 }}>0.00%</div>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 py-2.5" style={{ borderTop: "1px solid rgba(255,255,255,0.07)", color: "#aeaeb2" }}>
                    <Wallet className="w-4 h-4" />
                    <span style={{ fontSize: 13.5, fontWeight: 700, flex: 1 }}>Manage Tokens</span>
                    <span style={{ fontSize: 16 }}>›</span>
                  </div>
                </div>

                {/* Transaction History */}
                <div style={{ background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 20, backdropFilter: "blur(20px) saturate(150%)", padding: 15 }}>
                  <div className="flex items-center justify-between mb-2">
                    <span style={{ fontWeight: 800, fontSize: 16, color: "#f5f5f7" }}>Transaction History</span>
                    <button onClick={() => router.push("/merchant/settings?tab=ledger")} className="px-3 py-1 rounded-full transition-colors" style={{ background: "none", border: "1px solid rgba(255,255,255,0.09)", color: "#f5f5f7", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>View all</button>
                  </div>

                  {recentTxsLoading && recentTxs.length === 0 ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="w-4 h-4 animate-spin" style={{ color: "#5a5a60" }} />
                    </div>
                  ) : recentTxs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 gap-3">
                      <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ border: "1px solid rgba(255,255,255,0.09)" }}>
                        <ArrowDownToLine className="w-5 h-5" style={{ color: "#5a5a60" }} />
                      </div>
                      <div style={{ color: "#86868b", fontSize: 13, fontWeight: 500 }}>No transactions yet</div>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-[100px_80px_1fr_110px_80px_28px] gap-2 py-1.5 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                        {["Type", "Status", "From / To", "Amount", "Time", ""].map((h) => (
                          <span key={h} style={{ fontSize: 9, color: "#5a5a60", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</span>
                        ))}
                      </div>
                      {recentTxs.map((tx) => {
                        const amt = Number(tx.amount) || 0;
                        const isIncoming = amt >= 0;
                        const isFailed = tx.entry_type === "ESCROW_REFUND" || (tx.entry_type === "ADJUSTMENT" && (tx.description || "").toLowerCase().includes("fail"));
                        const typeLabel = tx.entry_type === "SYNTHETIC_CONVERSION" ? "Swap" : isIncoming ? "Receive" : "Send";
                        const TypeIcon = typeLabel === "Swap" ? ArrowLeftRight : isIncoming ? ArrowDownToLine : Send;
                        const cpRaw = tx.counterparty_name || tx.order_number || "—";
                        const cpDisplay = cpRaw.length > 18 ? `${cpRaw.slice(0, 8)}…${cpRaw.slice(-6)}` : cpRaw;
                        const ts = new Date(tx.created_at).getTime();
                        const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
                        const rel = diffSec < 60 ? "now" : diffSec < 3600 ? `${Math.floor(diffSec / 60)}m ago` : diffSec < 86400 ? `${Math.floor(diffSec / 3600)}h ago` : `${Math.floor(diffSec / 86400)}d ago`;
                        return (
                          <div key={tx.id} className="grid grid-cols-[100px_80px_1fr_110px_80px_28px] gap-2 items-center py-2 border-b last:border-0" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                            <div className="flex items-center gap-1.5 min-w-0">
                              <TypeIcon className="w-3.5 h-3.5 shrink-0" style={{ color: typeLabel === "Swap" ? "#60a5fa" : isIncoming ? "#b8e9d4" : "#f87171" }} />
                              <span style={{ fontSize: 12, color: "#f5f5f7" }} className="truncate">{typeLabel}</span>
                            </div>
                            <div>
                              {isFailed ? (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ fontSize: 10, fontWeight: 600, background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" }}><XCircle className="w-2.5 h-2.5" />Failed</span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ fontSize: 10, fontWeight: 600, background: "rgba(184,233,212,0.1)", color: "#b8e9d4", border: "1px solid rgba(184,233,212,0.2)" }}><CheckCircle2 className="w-2.5 h-2.5" />Done</span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p style={{ fontSize: 11, color: "#f5f5f7" }} className="truncate">{cpDisplay}</p>
                              <p style={{ fontSize: 9, color: "#5a5a60" }}>{isIncoming ? "From:" : "To:"}</p>
                            </div>
                            <div className="text-right">
                              <p style={{ fontSize: 12, fontWeight: 700, color: isIncoming ? "#b8e9d4" : "#f87171" }}>{isIncoming ? "+" : ""}{amt.toFixed(2)} USDT</p>
                            </div>
                            <div className="text-right">
                              <p style={{ fontSize: 11, color: "#5a5a60" }}>{rel}</p>
                            </div>
                            <button onClick={() => { if (tx.related_order_id) router.push(`/merchant?order=${tx.related_order_id}`); }} className="p-1 rounded transition-colors" style={{ background: "none", border: "none", cursor: "pointer", color: "#5a5a60" }}>
                              <MoreHorizontal className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              </div>

              {/* ── RIGHT COLUMN — network status + security ──────────── */}
              <div className="space-y-3">
                {/* Network Status */}
                <div style={{ background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 20, backdropFilter: "blur(20px) saturate(150%)", padding: 15 }}>
                  <div className="flex items-center justify-between mb-3">
                    <span style={{ fontWeight: 800, fontSize: 15, color: "#f5f5f7" }}>Network Status</span>
                    <div className="flex items-center gap-1.5" style={{ color: networkStatus.healthy ? "#b8e9d4" : "#f87171", fontSize: 12, fontWeight: 700 }}>
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: networkStatus.healthy ? "#b8e9d4" : "#f87171", boxShadow: networkStatus.healthy ? "0 0 6px rgba(184,233,212,0.7)" : "0 0 6px rgba(248,113,113,0.7)" }} />
                      {networkStatus.healthy ? "Operational" : "Down"}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
                    {([
                      ["Block", networkStatus.blockHeight !== null ? networkStatus.blockHeight.toLocaleString("en-US") : "—"],
                      ["Latency", networkStatus.latency !== null ? `${networkStatus.latency}ms` : "—"],
                      ["Network", networkLabel()],
                    ] as [string, string][]).map(([k, v]) => (
                      <div key={k} className="text-center">
                        <div style={{ fontSize: 14, fontWeight: 800, color: "#f5f5f7" }}>{v}</div>
                        <div style={{ color: "#86868b", fontSize: 10.5, fontWeight: 700, marginTop: 2, textTransform: "uppercase", letterSpacing: "0.04em" }}>{k}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {!MOCK_MODE && (
                  <div style={{ background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 20, backdropFilter: "blur(20px) saturate(150%)", overflow: "hidden" }}>
                    <div className="px-4 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.09)" }}>
                      <span style={{ fontWeight: 800, fontSize: 14, color: "#f5f5f7" }}>Security</span>
                    </div>

                    {([
                      { icon: <Lock className="w-3.5 h-3.5" />, label: "Lock Wallet", sub: "Secure your wallet", onClick: () => embeddedWallet?.lockWallet(), red: false },
                      { icon: <Download className="w-3.5 h-3.5" />, label: "Download Backup", sub: "Download your backup file", onClick: handleExportKey, red: false },
                      { icon: <Trash2 className="w-3.5 h-3.5" />, label: "Delete Wallet", sub: "Permanently delete wallet", onClick: () => setShowDeleteConfirm(true), red: true },
                    ] as Array<{ icon: React.ReactNode; label: string; sub: string; onClick: () => void; red: boolean }>).map(({ icon, label, sub, onClick, red }, i, arr) => (
                      <button key={label} onClick={onClick} className="w-full px-4 py-3 flex items-center gap-3 transition-colors" style={{ background: "none", border: "none", borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none", cursor: "pointer" }}>
                        <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: red ? "rgba(239,68,68,0.1)" : "rgba(255,255,255,0.05)", color: red ? "#f87171" : "#aeaeb2" }}>{icon}</div>
                        <div className="flex-1 text-left">
                          <div style={{ fontSize: 13, color: red ? "#f87171" : "#f5f5f7", fontWeight: 600 }}>{label}</div>
                          <div style={{ fontSize: 11, color: "#5a5a60" }}>{sub}</div>
                        </div>
                        <span style={{ color: "#5a5a60" }}>›</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Quick Actions */}
                <div style={{ background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 20, backdropFilter: "blur(20px) saturate(150%)", overflow: "hidden" }}>
                  <div className="px-4 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.09)" }}>
                    <span style={{ fontWeight: 800, fontSize: 14, color: "#f5f5f7" }}>Quick Actions</span>
                  </div>
                  {address && (
                    <a href={explorerUrl("address", address)} target="_blank" rel="noopener noreferrer" className="w-full px-4 py-3 flex items-center gap-3 transition-colors" style={{ textDecoration: "none", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex" }}>
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.05)", color: "#aeaeb2" }}><ScanSearch className="w-3.5 h-3.5" /></div>
                      <div className="flex-1 text-left">
                        <div style={{ fontSize: 13, color: "#f5f5f7", fontWeight: 600 }}>View on Solscan</div>
                        <div style={{ fontSize: 11, color: "#5a5a60" }}>View wallet on Solscan</div>
                      </div>
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" style={{ color: "#5a5a60" }} />
                    </a>
                  )}
                  <button onClick={handleCopyAddress} className="w-full px-4 py-3 flex items-center gap-3 transition-colors" style={{ background: "none", border: "none", borderBottom: "1px solid rgba(255,255,255,0.06)", cursor: "pointer" }}>
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.05)", color: copied ? "#b8e9d4" : "#aeaeb2" }}>
                      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    </div>
                    <div className="flex-1 text-left">
                      <div style={{ fontSize: 13, color: "#f5f5f7", fontWeight: 600 }}>Copy Address</div>
                      <div style={{ fontSize: 11, color: "#5a5a60" }}>Copy wallet address</div>
                    </div>
                    <span style={{ color: "#5a5a60" }}>›</span>
                  </button>
                  {!MOCK_MODE && (
                    <button onClick={() => embeddedWallet?.lockWallet()} className="w-full px-4 py-3 flex items-center gap-3 transition-colors" style={{ background: "none", border: "none", cursor: "pointer" }}>
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.05)", color: "#aeaeb2" }}><LogOut className="w-3.5 h-3.5" /></div>
                      <div className="flex-1 text-left">
                        <div style={{ fontSize: 13, color: "#f5f5f7", fontWeight: 600 }}>Disconnect Wallet</div>
                        <div style={{ fontSize: 11, color: "#5a5a60" }}>Lock and disconnect</div>
                      </div>
                      <LogOut className="w-3.5 h-3.5" style={{ color: "#5a5a60" }} />
                    </button>
                  )}
                </div>
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
              <Send className="w-5 h-5 text-[#f5f5f7]" />
              <h3 className="text-base font-bold text-white font-mono">Send</h3>
            </div>

            {sendError && (
              <div className="p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 font-mono">
                {sendError}
              </div>
            )}
            {sendSuccess && (
              <div className="p-2.5 bg-white/[0.06] border border-white/[0.09] rounded-lg text-xs text-[#f5f5f7] font-mono">
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
                               focus:outline-none focus:border-white/[0.12] transition-colors"
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
                      className="text-[10px] text-[#f5f5f7]/70 font-mono hover:text-white"
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
                               focus:outline-none focus:border-white/[0.12] transition-colors"
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
                  className="w-full py-3 rounded-xl bg-[#f5f5f7] text-background font-bold font-mono text-sm
                             hover:bg-white/[0.08] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
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
              <ArrowDownToLine className="w-5 h-5 text-[#f5f5f7]" />
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
                className="flex-1 py-2.5 rounded-xl bg-white/[0.06] border border-white/[0.12] text-[#f5f5f7] text-sm font-mono font-medium hover:bg-white/[0.08] transition-colors flex items-center justify-center gap-2"
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
              <Key className="w-5 h-5 text-[#f5f5f7]" />
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
                  className="w-full px-3 py-3 pr-10 bg-white/[0.04] border border-white/[0.08] rounded-xl text-sm text-white font-mono placeholder:text-white/20 focus:outline-none focus:border-white/[0.12] transition-colors"
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
                className="flex-1 py-2.5 rounded-xl bg-[#f5f5f7] hover:bg-white/[0.08] text-background text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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

interface PinFieldDisplayProps {
  label: string;
  value: string;
  length: number;
  active: boolean;
  show: boolean;
  onClick: () => void;
  trailing?: React.ReactNode;
}

function PinFieldDisplay({
  label,
  value,
  length,
  active,
  show,
  onClick,
  trailing,
}: PinFieldDisplayProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.()}
      className={`w-full text-left rounded-xl px-4 py-3 bg-white/[0.02] transition-colors cursor-pointer ${
        active ? "border border-white/[0.12]" : "border border-white/[0.08]"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-mono uppercase tracking-[0.15em] text-white/40 mb-1.5">
            {label}
          </p>
          <div className="flex items-center gap-2 h-6">
            {Array.from({ length }).map((_, i) => {
              const filled = i < value.length;
              if (show && filled) {
                return (
                  <span
                    key={i}
                    className="text-base font-mono tabular-nums text-white"
                    style={{ minWidth: 10, textAlign: "center" }}
                  >
                    {value[i]}
                  </span>
                );
              }
              return (
                <span
                  key={i}
                  className="rounded-full"
                  style={{
                    width: 8,
                    height: 8,
                    background: filled ? "#fff" : "rgba(255,255,255,0.18)",
                  }}
                />
              );
            })}
          </div>
        </div>
        {trailing}
      </div>
    </div>
  );
}
