"use client";

/**
 * User Embedded Wallet Management Page
 *
 * Mirror of /merchant/wallet/page.tsx scoped to the user actor type.
 * Provides the full embedded-wallet management surface that was missing
 * from the user-side ProfileScreen — Lock, Unlock, Export Private Key,
 * Download Backup, Delete Wallet, Send (SOL/USDT), plus the create/import
 * setup flow for first-time wallet creation.
 *
 * Navigation:
 *   - Auth fail → / (user landing)
 *   - Back button → / (re-enters the user SPA)
 */

import { useState, useEffect } from "react";
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
  Eye,
  EyeOff,
  ArrowDownToLine,
  Shield,
  RefreshCw,
  ExternalLink,
  Send,
  ArrowLeft,
} from "lucide-react";
import { copyToClipboard } from "@/lib/clipboard";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { DEVNET_RPC, DEVNET_WS_ENDPOINT } from "@/lib/solana/v2/config";
import { confirmHttp } from "@/lib/solana/confirmHttp";
import {
  generateMnemonicWallet,
  importWallet,
  decryptWallet,
  decryptMnemonic,
  exportPrivateKey,
  saveEncryptedWallet,
  loadEncryptedWallet,
  saveEncryptedMnemonic,
  loadEncryptedMnemonic,
  hasEncryptedMnemonic,
  validatePasswordStrength,
} from "@/lib/wallet/embeddedWallet";
import { Keypair } from "@solana/web3.js";
import { useSolanaWallet } from "@/context/SolanaWalletContext";
import { showAlert } from "@/context/ModalContext";
import { WalletPinKeypad } from "@/components/wallet/WalletPinKeypad";
import {
  getWalletFormat,
  setWalletFormat,
  clearWalletFormat,
} from "@/lib/wallet/walletFormat";

// User-side wallet password is now a 6-digit PIN — the same secret unlocks
// the wallet AND authorises payments. Existing free-form wallet passwords
// keep working on unlock (handled by the legacy fallback below); only NEW
// wallets created via this page are minted with the PIN format.
//
// The per-actor format marker (lib/wallet/walletFormat.ts) is written after
// a successful PIN-format create / import. The unlock UI reads it to pick
// between the PIN keypad and the legacy password input.
import { MOCK_MODE } from "@/lib/config/mockMode";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { usdtLabel, explorerUrl, isMainnet } from "@/lib/solana/networkLabel";

interface UserInfo {
  id: string;
  username?: string;
  name?: string;
}

type WalletView = "loading" | "setup" | "unlock" | "main";

export default function UserWalletPage() {
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

  const [, setUserInfo] = useState<UserInfo | null>(null);
  // Captured from /api/auth/me — gates per-actor wallet storage. Stays null
  // until session restore completes; the wallet UI shows its loading state
  // for that brief window rather than flashing a wrong-account prompt.
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
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
  // BIP39 phrase shown to the user on the backup screen after Create (and
  // after a successful mnemonic-Import). Null for legacy base58-imported
  // wallets which have no mnemonic.
  const [pendingMnemonic, setPendingMnemonic] = useState<string | null>(null);
  const [backupDownloaded, setBackupDownloaded] = useState(false);

  // Restore user session via cookie-authed /api/auth/me. Survives hard
  // refresh and deep-link entry — identity comes from the signed cookie,
  // not from any client-writable storage. Uses fetchWithAuth so a transient
  // 401 silently refreshes via blip_refresh_token before redirecting.
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const res = await fetchWithAuth("/api/auth/me", {
          method: "GET",
          credentials: "include",
        });
        if (!res.ok) {
          setIsLoading(false);
          router.push("/");
          return;
        }
        const data = await res.json();
        if (
          data?.success &&
          data?.data?.actorType === "user" &&
          data?.data?.user?.id
        ) {
          setUserInfo(data.data.user);
          setUserId(data.data.user.id);
          setIsLoading(false);
          return;
        }
        setIsLoading(false);
        router.push("/");
      } catch {
        setIsLoading(false);
        router.push("/");
      }
    };
    restoreSession();
  }, [router]);

  // Hand the wallet context our actor id so its storage probe targets the
  // right per-user slot (and runs the one-time legacy migration). Until
  // this fires the context stays in 'initializing' and the UI shows a
  // loading state instead of a stale Unlock prompt for someone else.
  useEffect(() => {
    if (!embeddedWallet) return;
    embeddedWallet.setActorId(userId);
  }, [embeddedWallet, userId]);

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
      // Mock wallet auto-connects when user session exists, show loading briefly
      setView("loading");
      return;
    }

    // Wait for the embedded wallet provider to finish loading
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
  }, [isLoading, embeddedWallet?.state, solanaWallet.connected, embeddedWallet]);

  // ---- Handlers ----

  const handleCreate = async () => {
    setSetupError("");
    // User-side wallet password is a 6-digit PIN. The WalletPinKeypad UI
    // already caps input at 6 digits, but we re-check here so a manual
    // state mutation (or autofill) can't slip a non-PIN value through.
    // The lower-level validatePasswordStrength still accepts 4-6 digits;
    // we enforce exactly 6 at the user-side UI layer.
    if (!/^[0-9]{6}$/.test(password)) {
      setSetupError("Enter a 6-digit PIN");
      return;
    }
    if (password !== confirmPassword) {
      setSetupError("PINs do not match");
      return;
    }
    const strength = validatePasswordStrength(password);
    if (!strength.ok) {
      setSetupError(strength.reason || "PIN is too weak");
      return;
    }

    setSetupLoading(true);
    try {
      if (!userId) {
        setSetupError("Session not ready yet — try again in a second");
        return;
      }
      // Step 3 hardening: helper is mandatory for the current (v3) blob.
      const helperRes = await fetchWithAuth("/api/wallet/unlock-helper");
      const helperJson = await helperRes.json().catch(() => null);
      const unlockHelper: string | null = helperJson?.data?.unlock_helper ?? null;
      if (!unlockHelper) {
        setSetupError("Could not reach the server. Check your connection and try again.");
        return;
      }
      // Step 4: generate a BIP39-mnemonic-derived wallet. The mnemonic is
      // displayed during the backup screen (see existing setPendingKeypair
      // flow) AND saved encrypted so the user can re-display it later via
      // "Show Recovery Phrase". Funds remain recoverable in any Solana
      // wallet (Phantom, Solflare, Sollet) under the standard derivation
      // path even if this app's localStorage is wiped.
      const { keypair, mnemonic, encrypted, encryptedMnemonic } =
        await generateMnemonicWallet(password, unlockHelper);
      saveEncryptedWallet(userId, encrypted);
      saveEncryptedMnemonic(userId, encryptedMnemonic);
      // Tag this wallet as PIN-format so a future unlock UI can render
      // the keypad instead of the legacy password input. Non-fatal if
      // localStorage is blocked — the wallet still works.
      setWalletFormat(userId, "pin");
      setPendingKeypair(keypair);
      setPendingMnemonic(mnemonic);
    } catch (err: any) {
      setSetupError(err.message || "Failed to create wallet");
    } finally {
      setSetupLoading(false);
    }
  };

  const handleImport = async () => {
    setSetupError("");
    // Import re-encrypts under a new PIN. Same 6-digit + confirm gates
    // as Create so import isn't a back-door around the format check.
    if (!/^[0-9]{6}$/.test(password)) {
      setSetupError("Enter a 6-digit PIN");
      return;
    }
    if (password !== confirmPassword) {
      setSetupError("PINs do not match");
      return;
    }
    const strength = validatePasswordStrength(password);
    if (!strength.ok) {
      setSetupError(strength.reason || "PIN is too weak");
      return;
    }
    if (!privateKeyInput.trim()) {
      setSetupError("Paste your private key or 12-word recovery phrase");
      return;
    }

    setSetupLoading(true);
    try {
      if (!userId) {
        setSetupError("Session not ready yet — try again in a second");
        return;
      }
      // Import also re-encrypts at v3 (helper-mixed), same reason as Create.
      const helperRes = await fetchWithAuth("/api/wallet/unlock-helper");
      const helperJson = await helperRes.json().catch(() => null);
      const unlockHelper: string | null = helperJson?.data?.unlock_helper ?? null;
      if (!unlockHelper) {
        setSetupError("Could not reach the server. Check your connection and try again.");
        return;
      }
      // importWallet auto-detects mnemonic vs base58 input. When a
      // mnemonic was supplied, encryptedMnemonic is non-null and we
      // persist it so the user can recover the phrase later via
      // "Show Recovery Phrase".
      const { keypair, encrypted, encryptedMnemonic } = await importWallet(
        privateKeyInput.trim(),
        password,
        unlockHelper,
      );
      saveEncryptedWallet(userId, encrypted);
      if (encryptedMnemonic) {
        saveEncryptedMnemonic(userId, encryptedMnemonic);
      }
      // Imported wallets are also PIN-format on the user side now.
      setWalletFormat(userId, "pin");
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
    // The phrase is the user's primary recovery material (works in any
    // Solana wallet under m/44'/501'/0'/0'); the private key is the
    // fallback for wallets that don't support BIP39 import.
    const mnemonicBlock = pendingMnemonic
      ? `Recovery Phrase (12 words):\n${pendingMnemonic}\n\nThis phrase recovers your wallet in ANY Solana wallet (Phantom, Solflare, etc.) under the standard derivation path m/44'/501'/0'/0'.\n\n`
      : "";
    const blob = new Blob(
      [
        `Blip Money — Wallet Backup\n\nPublic Key: ${pendingKeypair.publicKey.toBase58()}\n\n${mnemonicBlock}Private Key: ${key}\n\nKeep this file safe. Anyone with the recovery phrase or private key can access your funds.\nGenerated: ${new Date().toISOString()}\n`,
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
      await solanaWallet.refreshBalances();
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

    let recipientPubkey: PublicKey;
    try {
      recipientPubkey = new PublicKey(sendTo.trim());
    } catch {
      setSendError("Invalid Solana address");
      return;
    }

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

        if (!userId) throw new Error("Session not ready");
        const encrypted = loadEncryptedWallet(userId);
        if (!encrypted) throw new Error("Wallet not found");
        const pw = prompt("Enter wallet password to sign transaction");
        if (!pw) {
          setIsSending(false);
          return;
        }
        // v3 blobs need the server helper; v1/v2 ignore it. Always fetch.
        const sendHelperRes = await fetchWithAuth("/api/wallet/unlock-helper");
        const sendHelperJson = await sendHelperRes.json().catch(() => null);
        const sendHelper: string | null = sendHelperJson?.data?.unlock_helper ?? null;
        const kp = await decryptWallet(encrypted, pw.trim(), sendHelper);
        tx.sign(kp);

        const sig = await connection.sendRawTransaction(tx.serialize());
        await confirmHttp(connection, sig);
        setSendSuccess(`Sent ${amount} SOL! Tx: ${sig.slice(0, 8)}...`);
      } else {
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
        );

        const fromAta = await getAssociatedTokenAddress(USDT_MINT, senderPubkey);
        const toAta = await getAssociatedTokenAddress(USDT_MINT, recipientPubkey);

        const tx = new Transaction();

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
            Math.round(amount * 1_000_000),
          ),
        );

        tx.feePayer = senderPubkey;
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

        if (!userId) throw new Error("Session not ready");
        const encrypted = loadEncryptedWallet(userId);
        if (!encrypted) throw new Error("Wallet not found");
        const pw = prompt("Enter wallet password to sign transaction");
        if (!pw) {
          setIsSending(false);
          return;
        }
        // v3 blobs need the server helper; v1/v2 ignore it. Always fetch.
        const sendHelperRes = await fetchWithAuth("/api/wallet/unlock-helper");
        const sendHelperJson = await sendHelperRes.json().catch(() => null);
        const sendHelper: string | null = sendHelperJson?.data?.unlock_helper ?? null;
        const kp = await decryptWallet(encrypted, pw.trim(), sendHelper);
        tx.sign(kp);

        const sig = await connection.sendRawTransaction(tx.serialize());
        await confirmHttp(connection, sig);
        setSendSuccess(`Sent ${amount} USDT! Tx: ${sig.slice(0, 8)}...`);
      }

      await solanaWallet.refreshBalances();
      setSendTo("");
      setSendAmount("");
    } catch (err: any) {
      setSendError(err.message || "Transaction failed");
    } finally {
      setIsSending(false);
    }
  };

  const handleExportKey = () => {
    if (!userId) {
      showAlert("Error", "Session not ready — try again in a moment", "error");
      return;
    }
    const pw = prompt("Enter your wallet password to export the private key");
    if (!pw) return;

    const encrypted = loadEncryptedWallet(userId);
    if (!encrypted) {
      showAlert("Error", "No wallet found", "error");
      return;
    }

    // v3 blobs need the server helper; v1/v2 ignore it. Always fetch.
    fetchWithAuth("/api/wallet/unlock-helper")
      .then((r) => r.json().catch(() => null))
      .then((d): string | null => d?.data?.unlock_helper ?? null)
      .then((helper) => decryptWallet(encrypted, pw.trim(), helper))
      .then((kp) => {
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
      })
      .catch(() => {
        showAlert("Error", "Wrong password", "error");
      });
  };

  const handleDelete = () => {
    embeddedWallet?.deleteWallet();
    setShowDeleteConfirm(false);
  };

  const address = solanaWallet.walletAddress || "";
  const truncated = address
    ? `${address.slice(0, 8)}....${address.slice(-6)}`
    : "";

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    // Match the user shell exactly: `user-scope` activates the user design
    // tokens, the outer div paints the "desk" frame around the 440px phone
    // column, and the inner column uses `bg-surface-base` so the screen sits
    // under the same surface every other user screen does (HomeScreen,
    // ProfileScreen, etc.). Without this the wallet page reads as a single
    // flat-black slab instead of the framed phone column the rest of the app
    // uses, which is what the user flagged.
    <div
      className="user-scope min-h-dvh flex flex-col items-center overflow-y-auto"
      style={{ background: "var(--user-frame)" }}
    >
      <div className="flex-1 w-full max-w-[440px] mx-auto flex flex-col bg-surface-base">
        {/* Header row — flush with the 440px column, matching ProfileScreen's
            `px-5` content gutter so the back-button / title line up with the
            cards below. */}
        <div className="px-5 pt-10 pb-4 shrink-0 flex items-center justify-between">
          <button
            onClick={() => router.push("/")}
            className="flex items-center gap-1.5 text-[13px] font-semibold text-text-tertiary hover:text-text-primary transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <h1 className="text-[13px] font-bold text-text-primary tracking-tight">My Wallet</h1>
          <div className="w-12" />
        </div>

        {/* Main content — px-5 mirrors ProfileScreen so cards sit at the same
            inset as the rest of the user app. pb-10 keeps the last card off
            the bottom edge (no BottomNav on this screen). */}
        <div className="flex-1 px-5 pb-10 overflow-y-auto scrollbar-hide">
          <div className="w-full">
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

              <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-5 space-y-4">
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
                    {/* Hidden username anchor — keeps password manager bound to
                        THIS form so saved credentials don't bleed into other inputs. */}
                    <input
                      type="text"
                      name="wallet-account"
                      autoComplete="username"
                      value="blip-user-wallet"
                      readOnly
                      aria-hidden="true"
                      tabIndex={-1}
                      className="absolute opacity-0 pointer-events-none h-0 w-0"
                    />
                    {/* User-side wallet password is a 6-digit PIN — same secret
                        unlocks the wallet AND authorises payments. Existing
                        merchant wallets (different page) still use free-form
                        passwords. The handleCreate path validates exactly 6
                        digits before submitting. */}
                    <WalletPinKeypad
                      value={password}
                      onChange={setPassword}
                      label="Set a 6-digit PIN"
                      hint="This PIN unlocks your wallet and authorises Payments."
                      disabled={setupLoading}
                      autoFocus
                    />
                    <WalletPinKeypad
                      value={confirmPassword}
                      onChange={setConfirmPassword}
                      label="Confirm PIN"
                      disabled={setupLoading}
                    />
                    <button
                      type="submit"
                      disabled={setupLoading}
                      className="w-full py-3.5 rounded-xl bg-primary text-background font-bold font-mono text-sm
                                 hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {setupLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" /> Generating...
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
                    <input
                      type="text"
                      name="wallet-account"
                      autoComplete="username"
                      value="blip-user-wallet"
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
                        // 12-word phrases are ~120 chars; 24-word ~220. Allow
                        // enough room for either, plus base58 private keys
                        // (~88 chars), with headroom for spaces and tolerance.
                        maxLength={300}
                        value={privateKeyInput}
                        onChange={(e) => setPrivateKeyInput(e.target.value)}
                        placeholder="Paste your 12-word recovery phrase OR base58 private key..."
                        rows={3}
                        className="w-full px-3 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl
                                   text-sm text-white font-mono placeholder:text-white/20 resize-none
                                   focus:outline-none focus:border-primary/50 transition-colors"
                      />
                    </div>
                    {/* User-side wallet password is a 6-digit PIN (see
                        Create flow above for the full rationale). Import
                        re-encrypts the supplied keypair under this PIN.
                        showToggle is enabled here so users can verify the
                        PIN they entered matches Confirm before committing
                        — recovering an imported wallet wrong is worse than
                        recovering a freshly-created one, since the keypair
                        is already in their hands. */}
                    <WalletPinKeypad
                      value={password}
                      onChange={setPassword}
                      label="Set a 6-digit PIN"
                      hint="You'll use this PIN every time you Pay."
                      disabled={setupLoading}
                      showToggle
                    />
                    <WalletPinKeypad
                      value={confirmPassword}
                      onChange={setConfirmPassword}
                      label="Confirm PIN"
                      disabled={setupLoading}
                      showToggle
                    />
                    <button
                      type="submit"
                      disabled={setupLoading}
                      className="w-full py-3.5 rounded-xl bg-primary text-background font-bold font-mono text-sm
                                 hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {setupLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" /> Importing...
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
                <div className="p-3 bg-white/[0.03] border border-white/[0.06] rounded-xl">
                  <div className="text-[10px] text-white/30 font-mono uppercase mb-1">
                    Your Public Address
                  </div>
                  <div className="text-sm text-white/80 font-mono break-all">
                    {pendingKeypair.publicKey.toBase58()}
                  </div>
                </div>

                {/* Recovery phrase — only shown for mnemonic-derived wallets
                    (new Create flow). Legacy base58-imported wallets have
                    no mnemonic and skip this block entirely. */}
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

                <button
                  onClick={handleDownloadBackup}
                  className={`w-full py-3.5 rounded-xl font-bold font-mono text-sm flex items-center justify-center gap-2 transition-colors ${
                    backupDownloaded
                      ? "bg-green-500/20 border border-green-500/30 text-green-400"
                      : "bg-primary text-background hover:bg-primary/90"
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

                {/* Unlock UI branches on the format marker:
                      - 'pin'  → PIN keypad (new wallets created via this page)
                      - null   → legacy password input (existing free-form
                                 wallets predating this change; they keep
                                 working with their original password)
                    The decision is purely a render-time choice — the
                    underlying `unlockWallet(secret)` call is the same.
                    Existing users see zero change. */}
                {getWalletFormat(userId) === "pin" ? (
                  <form
                    onSubmit={(e) => { e.preventDefault(); handleUnlock(); }}
                    autoComplete="off"
                    className="space-y-4"
                  >
                    <WalletPinKeypad
                      value={unlockPassword}
                      onChange={setUnlockPassword}
                      label="Enter your 6-digit PIN"
                      disabled={unlockLoading}
                      autoFocus
                    />
                    <button
                      type="submit"
                      disabled={unlockLoading || unlockPassword.length !== 6}
                      className="w-full py-3.5 rounded-xl bg-primary text-background font-bold font-mono text-sm
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
                ) : (
                  <form
                    onSubmit={(e) => { e.preventDefault(); handleUnlock(); }}
                    autoComplete="off"
                    className="space-y-4"
                  >
                    <input
                      type="text"
                      name="wallet-account"
                      autoComplete="username"
                      value="blip-user-wallet"
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
                      className="w-full py-3.5 rounded-xl bg-primary text-background font-bold font-mono text-sm
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
                )}

                <div className="flex items-center justify-between">
                  <button
                    onClick={() => {
                      // "Forgot PIN" recovery path: jump to the Import tab so
                      // the user can paste their 12-word recovery phrase and
                      // set a NEW PIN. Existing encrypted blob is replaced
                      // when they complete import. The recovery phrase is
                      // the only canonical "you own this wallet" proof —
                      // account password alone is not enough since the PIN
                      // controls funds directly.
                      embeddedWallet?.deleteWallet();
                      clearWalletFormat(userId);
                      setSetupTab("import");
                    }}
                    className="text-[10px] text-white/40 hover:text-foreground/70 font-mono transition-colors flex items-center gap-1"
                  >
                    <Key className="w-3 h-3" />
                    {getWalletFormat(userId) === "pin"
                      ? "Forgot PIN? Recover with phrase"
                      : "Import with private key"}
                  </button>
                  <button
                    onClick={() => {
                      embeddedWallet?.deleteWallet();
                      clearWalletFormat(userId);
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
            <div className="space-y-4">
              <div className="bg-gradient-to-br from-white/[0.03] to-white/[0.01] border border-white/[0.06] rounded-2xl p-6 text-center">
                {(() => {
                  // Show the *real* wallet state instead of a hardcoded
                  // green dot. Distinguishes: keypair-loaded vs locked vs
                  // address-present-but-balances-failing (RPC throttling).
                  const hasAddress = !!solanaWallet.walletAddress;
                  const balancesReady =
                    solanaWallet.usdtBalance !== null || solanaWallet.solBalance !== null;
                  const status = !hasAddress
                    ? { dot: 'bg-amber-500', text: 'text-amber-400', label: 'Locked' }
                    : balancesReady
                      ? { dot: 'bg-green-500', text: 'text-green-400', label: 'Connected' }
                      : { dot: 'bg-yellow-500', text: 'text-yellow-400', label: 'Connected · balances loading' };
                  return (
                    <div className="flex items-center justify-center gap-1.5 mb-4">
                      <div className={`w-2 h-2 ${status.dot} rounded-full`} />
                      <span className={`text-[10px] ${status.text} font-mono uppercase tracking-wider`}>
                        {status.label}
                      </span>
                    </div>
                  );
                })()}

                <div className="text-[10px] text-white/30 font-mono uppercase tracking-wider mb-1">
                  USDT Balance
                </div>
                <div className="text-4xl font-bold text-white font-mono tabular-nums mb-1">
                  {solanaWallet.usdtBalance !== null
                    ? solanaWallet.usdtBalance.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    : "—"}
                </div>
                <div className="text-xs text-white/30 font-mono">
                  {MOCK_MODE ? "Mock USDT" : usdtLabel()}
                </div>

                <div className="mt-4 pt-3 border-t border-white/[0.04] flex items-center justify-center gap-4">
                  <div className="text-center">
                    <div className="text-[9px] text-white/30 font-mono uppercase">
                      SOL
                    </div>
                    <div className="text-sm font-bold text-white/70 font-mono tabular-nums">
                      {solanaWallet.solBalance !== null
                        ? solanaWallet.solBalance.toFixed(4)
                        : "—"}
                    </div>
                  </div>
                  <div className="w-px h-6 bg-white/[0.06]" />
                  <div className="text-center">
                    <div className="text-[9px] text-white/30 font-mono uppercase">
                      Network
                    </div>
                    <div className={`text-sm font-medium font-mono ${isMainnet() ? 'text-emerald-400' : 'text-primary'}`}>
                      {isMainnet() ? 'Mainnet' : 'Devnet'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Address card */}
              <div
                onClick={handleCopyAddress}
                className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 flex items-center justify-between cursor-pointer hover:border-border-strong transition-colors group"
              >
                <div>
                  <div className="text-[9px] text-white/30 font-mono uppercase mb-0.5">
                    Wallet Address
                  </div>
                  <div className="text-sm text-white/80 font-mono group-hover:text-foreground transition-colors">
                    {truncated}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {address && (
                    <a
                      href={explorerUrl('address', address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="p-1.5 rounded-lg hover:bg-card transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-white/20 hover:text-foreground/40" />
                    </a>
                  )}
                  {copied ? (
                    <Check className="w-4 h-4 text-green-400" />
                  ) : (
                    <Copy className="w-4 h-4 text-white/30" />
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div
                className={`grid ${MOCK_MODE ? "grid-cols-2" : "grid-cols-3"} gap-2`}
              >
                <button
                  onClick={() => {
                    setSendError("");
                    setSendSuccess("");
                    setShowSendModal(true);
                  }}
                  className="py-3 rounded-xl bg-primary/10 border border-primary/20 hover:bg-primary/15 transition-colors
                             flex flex-col items-center gap-1.5"
                >
                  <Send className="w-5 h-5 text-primary" />
                  <span className="text-[10px] text-primary/80 font-mono font-medium">
                    Send
                  </span>
                </button>
                <button
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  className="py-3 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-card transition-colors
                             flex flex-col items-center gap-1.5 disabled:opacity-50"
                >
                  <RefreshCw
                    className={`w-5 h-5 text-primary ${isRefreshing ? "animate-spin" : ""}`}
                  />
                  <span className="text-[10px] text-white/50 font-mono">
                    Refresh
                  </span>
                </button>
                {!MOCK_MODE && (
                  <button
                    onClick={handleExportKey}
                    className="py-3 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-card transition-colors
                               flex flex-col items-center gap-1.5"
                  >
                    <Download className="w-5 h-5 text-primary" />
                    <span className="text-[10px] text-white/50 font-mono">
                      Export Key
                    </span>
                  </button>
                )}
              </div>

              {/* Token list */}
              <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-white/[0.04]">
                  <span className="text-[10px] font-bold text-white/40 font-mono uppercase tracking-wider">
                    Tokens
                  </span>
                </div>

                <div className="px-4 py-3 flex items-center justify-between border-b border-white/[0.03]">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500/30 to-blue-500/30 flex items-center justify-center border border-purple-500/20">
                      <span className="text-xs font-bold text-purple-300">S</span>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-white font-mono">SOL</div>
                      <div className="text-[10px] text-white/30 font-mono">Solana</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-white font-mono tabular-nums">
                      {solanaWallet.solBalance !== null
                        ? solanaWallet.solBalance.toFixed(4)
                        : "0.0000"}
                    </div>
                  </div>
                </div>

                <div className="px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-500/30 to-emerald-500/30 flex items-center justify-center border border-green-500/20">
                      <span className="text-xs font-bold text-green-300">$</span>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-white font-mono">USDT</div>
                      <div className="text-[10px] text-white/30 font-mono">{usdtLabel()}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-primary font-mono tabular-nums">
                      {solanaWallet.usdtBalance !== null
                        ? solanaWallet.usdtBalance.toFixed(2)
                        : "0.00"}
                    </div>
                  </div>
                </div>
              </div>

              {/* Security section — only for embedded wallet mode */}
              {!MOCK_MODE && (
                <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-white/[0.04]">
                    <span className="text-[10px] font-bold text-white/40 font-mono uppercase tracking-wider">
                      Security
                    </span>
                  </div>

                  <button
                    onClick={() => embeddedWallet?.lockWallet()}
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-card transition-colors border-b border-white/[0.03]"
                  >
                    <Lock className="w-4 h-4 text-white/30" />
                    <span className="text-sm text-white/60 font-mono">Lock Wallet</span>
                  </button>

                  <button
                    onClick={handleExportKey}
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-card transition-colors border-b border-white/[0.03]"
                  >
                    <Download className="w-4 h-4 text-white/30" />
                    <span className="text-sm text-white/60 font-mono">Download Backup</span>
                  </button>

                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-[var(--color-error)]/5 transition-colors"
                  >
                    <Trash2 className="w-4 h-4 text-red-400/50" />
                    <span className="text-sm text-red-400/60 font-mono">Delete Wallet</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
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

                <div>
                  <label className="text-[10px] text-white/40 font-mono uppercase mb-1.5 block">
                    Recipient Address
                  </label>
                  <input
                    type="text"
                    value={sendTo}
                    onChange={(e) => setSendTo(e.target.value)}
                    placeholder="Solana address..."
                    maxLength={44}
                    className="w-full px-3 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-xl
                               text-sm text-white font-mono placeholder:text-white/20
                               focus:outline-none focus:border-primary/50 transition-colors"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] text-white/40 font-mono uppercase">
                      Amount
                    </label>
                    <button
                      onClick={() => {
                        const bal =
                          sendToken === "SOL"
                            ? Math.max(0, (solanaWallet.solBalance || 0) - 0.005)
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
                    maxLength={14}
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

                <button
                  onClick={handleSend}
                  disabled={isSending}
                  className="w-full py-3 rounded-xl bg-primary text-background font-bold font-mono text-sm
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
    </div>
  );
}
