'use client';

/**
 * Embedded Wallet Context
 * Non-custodial in-app Solana wallet that provides the same interface as SolanaWalletContext.
 * Uses encrypted keypair in localStorage — no external wallet extension needed.
 * Set NEXT_PUBLIC_EMBEDDED_WALLET=true to enable.
 */

import React, { FC, ReactNode, useState, useCallback, useEffect, useRef } from 'react';
import { SolanaWalletContext } from './SolanaWalletContext';
import {
  Connection,
  PublicKey,
  Transaction,
  LAMPORTS_PER_SOL,
  Keypair,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  AnchorProvider,
  Program,
  Idl,
  BN,
} from '@coral-xyz/anchor';
import {
  getAssociatedTokenAddress,
  getAccount,
} from '@solana/spl-token';
import {
  DEVNET_RPC,
  DEVNET_WS_ENDPOINT,
  getV2ProgramId,
  getUsdtMint,
  FEE_BPS_DEFAULT,
  TradeSide,
  DisputeResolution,
  type Lane,
  findTradePda,
  findEscrowPda,
  checkProtocolConfigExists,
  initializeProtocolConfig,
  buildCreateTradeTx,
  buildFundEscrowTx,
  buildAcceptTradeTx,
  buildLockEscrowTx,
  buildReleaseEscrowTx,
  buildRefundEscrowTx,
  buildExtendEscrowTx,
  buildConfirmPaymentTx,
  buildOpenDisputeTx,
  buildResolveDisputeTx,
  fetchLane,
  fetchTrade,
} from '@/lib/solana/v2';
import {
  loadEncryptedWallet,
  saveEncryptedWallet,
  decryptWallet,
  clearEncryptedWallet,
  hasEncryptedWallet,
  saveSessionKeypair,
  loadSessionKeypair,
  clearSessionKeypair,
  migrateLegacyWallet,
  reencryptIfStale,
  recordUnlockFailure,
  clearUnlockFailures,
  versionRequiresHelper,
  MAX_UNLOCK_FAILURES,
  changeWalletPassword,
} from '@/lib/wallet/embeddedWallet';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { createKeypairWalletAdapter } from '@/lib/wallet/keypairWalletAdapter';
import { confirmHttp } from '@/lib/solana/confirmHttp';
import idlRaw from '@/lib/solana/v2/idl.json';
import { convertIdlToAnchor29 } from '@/lib/solana/idlConverter';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

// IDL conversion (same as SolanaWalletContext) — kept for reference but
// the inline copy was buggy: it did not materialise event `fields` from
// the types table, which anchor@0.29's Program constructor needs. The
// shared `convertIdlToAnchor29` below handles this. The inline helpers
// below remain only because other code in this file references them.
function convertType(type: any): any {
  if (type === 'pubkey') return 'publicKey';
  if (typeof type === 'string') return type;
  if (type && typeof type === 'object') {
    if (type.array) return { array: [convertType(type.array[0]), type.array[1]] };
    if (type.vec) return { vec: convertType(type.vec) };
    if (type.option) return { option: convertType(type.option) };
    if (type.defined) {
      if (typeof type.defined === 'object' && type.defined.name) return { defined: type.defined.name };
      return { defined: type.defined };
    }
  }
  return type;
}

function convertFields(fields: any[]): any[] {
  if (!fields) return [];
  return fields.map((f: any) => ({ name: f.name, type: convertType(f.type) }));
}

// Use the shared converter — the inline variant above was missing the
// event-fields materialisation, which breaks `new Program(idl)` under
// anchor@0.29 with the V2.3 IDL.
const idl = convertIdlToAnchor29(idlRaw);
const PROGRAM_ID = new PublicKey((idlRaw as any).address || (idlRaw as any).metadata?.address || getV2ProgramId().toBase58());
// Respect the active network (NEXT_PUBLIC_SOLANA_NETWORK) — picks devnet
// or mainnet USDT mint automatically. Critical for mainnet cutover.
const USDT_MINT = getUsdtMint();
const AUTO_LOCK_MS = 15 * 60 * 1000; // 15 minutes

export type EmbeddedWalletState = 'initializing' | 'none' | 'locked' | 'unlocked';

const EmbeddedWalletInnerProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [walletState, setWalletState] = useState<EmbeddedWalletState>('initializing');
  const [keypair, setKeypair] = useState<Keypair | null>(null);
  const [program, setProgram] = useState<Program | null>(null);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [usdtBalance, setUsdtBalance] = useState<number | null>(null);
  // Current actor (user.id or merchant.id) — null until the surrounding
  // auth flow tells us who's logged in. Wallet state stays 'initializing'
  // while this is null so we never flash an "Unlock" prompt for the
  // wrong account on a shared device.
  const [actorId, setActorIdState] = useState<string | null>(null);

  // Explicit wsEndpoint stops web3.js from auto-deriving ws://<origin>/api/rpc
  // (which is not a websocket server) and emitting "ws error: undefined" on
  // every confirmTransaction subscription.
  const connectionRef = useRef<Connection>(new Connection(DEVNET_RPC, {
    commitment: 'confirmed',
    wsEndpoint: DEVNET_WS_ENDPOINT,
  }));
  const lastActivityRef = useRef<number>(Date.now());
  const autoLockTimerRef = useRef<NodeJS.Timeout | null>(null);

  const connection = connectionRef.current;

  // Probe wallet state every time the actor changes.
  //
  //   - actorId === null  → 'initializing' (we don't know who they are yet)
  //   - actorId !== null  → run one-time legacy migration into the per-actor
  //                          slot, then probe session/locked/none for THIS
  //                          actor's blob.
  //
  // Previously this probe ran once at mount with no actor context, which is
  // exactly why a fresh signup on a device that once held User A's wallet
  // saw "Unlock Wallet" — the device-wide single key was hit. Per-actor
  // namespacing fixes that.
  useEffect(() => {
    if (!actorId) {
      setWalletState('initializing');
      return;
    }
    // One-time migration: copy legacy `blip_embedded_wallet` (no actor
    // suffix) into this actor's slot. Idempotent — safe on every mount.
    migrateLegacyWallet(actorId);

    const sessionKp = loadSessionKeypair(actorId);
    if (sessionKp && hasEncryptedWallet(actorId)) {
      // Restore unlocked state from session — no password needed
      setKeypair(sessionKp);
      setWalletState('unlocked');
      lastActivityRef.current = Date.now();
    } else if (hasEncryptedWallet(actorId)) {
      setWalletState('locked');
    } else {
      setWalletState('none');
    }
  }, [actorId]);

  // Public setter: auth flows call wallet.embeddedWallet.setActorId(id)
  // after a successful login or wallet.embeddedWallet.setActorId(null)
  // on logout. Treating null specifically clears the in-memory keypair so
  // the next account on this device starts in 'initializing', not 'unlocked
  // with the previous user's keypair still in memory'.
  const setActorId = useCallback((id: string | null) => {
    setActorIdState((prev) => {
      if (prev === id) return prev;
      if (id === null) {
        setKeypair(null);
        setProgram(null);
        setSolBalance(null);
        setUsdtBalance(null);
      }
      return id;
    });
  }, []);

  // Build program when keypair is available
  useEffect(() => {
    if (!keypair) {
      setProgram(null);
      return;
    }

    try {
      const adapter = createKeypairWalletAdapter(keypair);
      const provider = new AnchorProvider(connection, adapter, { commitment: 'confirmed' });
      const prog = new Program(idl, PROGRAM_ID, provider);
      setProgram(prog);
    } catch (err) {
      console.error('[EmbeddedWallet] Failed to create program:', err);
      setProgram(null);
    }
  }, [keypair, connection]);

  // Auto-lock timer
  useEffect(() => {
    if (walletState !== 'unlocked') return;

    const checkLock = () => {
      if (Date.now() - lastActivityRef.current > AUTO_LOCK_MS) {
        lockWallet();
      }
    };

    autoLockTimerRef.current = setInterval(checkLock, 30_000);
    return () => {
      if (autoLockTimerRef.current) clearInterval(autoLockTimerRef.current);
    };
  }, [walletState]);

  const touchActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  // Refresh balances
  const refreshBalances = useCallback(async () => {
    if (!keypair) return;

    try {
      const solBal = await connection.getBalance(keypair.publicKey);
      setSolBalance(solBal / LAMPORTS_PER_SOL);

      try {
        const usdtAta = await getAssociatedTokenAddress(USDT_MINT, keypair.publicKey);
        const tokenAccount = await getAccount(connection, usdtAta);
        setUsdtBalance(Number(tokenAccount.amount) / 1_000_000);
      } catch {
        setUsdtBalance(0);
      }
    } catch (error) {
      console.error('[EmbeddedWallet] Failed to fetch balances:', error);
    }
  }, [keypair, connection]);

  // Refresh balances when unlocked
  useEffect(() => {
    if (walletState === 'unlocked' && keypair) {
      refreshBalances();
      const interval = setInterval(refreshBalances, 45_000);
      return () => clearInterval(interval);
    }
  }, [walletState, keypair, refreshBalances]);

  // Sync wallet address to whichever actor (merchant OR user) is currently
  // authenticated. Identity is derived from the cookie-authed /api/auth/me
  // probe — never from localStorage (which we no longer write). Proves
  // ownership of the NEW wallet via server-issued nonce + signature signed
  // with the embedded keypair.
  //
  // Best-effort: any failure is swallowed silently. This is a UX nicety
  // (auto-link the embedded wallet to the logged-in account) — the merchant /
  // user profile already loaded their own session before this fires.
  useEffect(() => {
    if (walletState !== 'unlocked' || !keypair) return;
    const walletAddress = keypair.publicKey.toBase58();
    (async () => {
      try {
        const meRes = await fetch('/api/auth/me', {
          method: 'GET',
          credentials: 'include',
        });
        if (!meRes.ok) return;
        const me = await meRes.json();
        if (!me?.success) return;

        const actorType = me?.data?.actorType;
        if (actorType !== 'merchant' && actorType !== 'user') return;

        const actor =
          actorType === 'merchant' ? me?.data?.merchant : me?.data?.user;
        if (!actor?.id) return;
        // Already in sync — nothing to do.
        if (actor.wallet_address === walletAddress) return;

        const { fetchLoginNonce } = await import('@/lib/auth/walletAuth');
        const issued = await fetchLoginNonce(walletAddress);
        const sigBytes = nacl.sign.detached(
          new TextEncoder().encode(issued.message),
          keypair.secretKey,
        );
        const signature = bs58.encode(sigBytes);

        if (actorType === 'merchant') {
          await fetch('/api/auth/merchant', {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              merchant_id: actor.id,
              wallet_address: walletAddress,
              signature,
              message: issued.message,
              nonce: issued.nonce,
            }),
          });
        } else {
          await fetch('/api/auth/user', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'link_wallet',
              user_id: actor.id,
              wallet_address: walletAddress,
              signature,
              message: issued.message,
              nonce: issued.nonce,
            }),
          });
        }
        // No localStorage mirror — the next /api/auth/me read will reflect
        // the updated wallet_address from the DB.
      } catch { /* swallow — best-effort sync */ }
    })();
  }, [walletState, keypair]);

  // Fetch the per-actor unlock helper from the server (Step 3 hardening).
  // Returns null if the endpoint is unreachable or auth fails. Caller
  // decides whether that's fatal: required for v3 decrypt, optional for
  // v1/v2 unlock, optional for an opportunistic v→v3 upgrade.
  const fetchUnlockHelper = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetchWithAuth('/api/wallet/unlock-helper', {
        method: 'GET',
        credentials: 'include',
      });
      if (!res.ok) return null;
      const data = await res.json();
      const helper = data?.data?.unlock_helper;
      return typeof helper === 'string' && helper.length > 0 ? helper : null;
    } catch {
      return null;
    }
  }, []);

  // Unlock wallet — operates on the current actor's blob only.
  //
  // Four layered behaviors:
  //
  //   1. **Server-side helper for v3 blobs.** v3 wallets are encrypted
  //      with `password + helper` where the helper is a per-actor server
  //      secret. We fetch it before decrypting; without it, v3 fails fast
  //      rather than burning a failed-attempt counter slot.
  //
  //   2. **Opportunistic version upgrade.** v1/v2 blobs that decrypt
  //      successfully are silently re-encrypted at v3 (600k + helper)
  //      using the same password. No re-password prompt. If helper fetch
  //      failed, the upgrade is skipped and the original blob remains.
  //
  //   3. **Failed-attempt counter.** Wrong password increments a per-actor
  //      counter. At MAX_UNLOCK_FAILURES the local blob is wiped. Funds
  //      are NEVER at risk — keypair still exists on-chain; user recovers
  //      via the private key they exported at setup.
  //
  //   4. **Counter resets on success.**
  const unlockWallet = useCallback(async (password: string): Promise<boolean> => {
    if (!actorId) return false;
    const encrypted = loadEncryptedWallet(actorId);
    if (!encrypted) return false;

    // Fetch helper before any decrypt attempt. Always fetch — v1/v2 will
    // ignore it; v3 needs it. Single roundtrip per unlock attempt.
    const helper = await fetchUnlockHelper();

    // v3 with no helper → fail fast (don't burn a counter slot trying to
    // decrypt with the password alone; that would always fail).
    if (versionRequiresHelper(encrypted.version) && !helper) {
      return false;
    }

    try {
      const kp = await decryptWallet(encrypted, password.trim(), helper);

      // Success: reset failure counter immediately so a previous near-miss
      // doesn't trigger a wipe on the NEXT wrong attempt.
      clearUnlockFailures(actorId);

      // Best-effort upgrade to current blob version. Skipped if the
      // target version requires a helper and we don't have one.
      const upgraded = await reencryptIfStale(encrypted, password.trim(), kp, helper);
      if (upgraded) saveEncryptedWallet(actorId, upgraded);

      setKeypair(kp);
      setWalletState('unlocked');
      lastActivityRef.current = Date.now();
      saveSessionKeypair(actorId, kp);
      return true;
    } catch {
      const failures = recordUnlockFailure(actorId);
      if (failures >= MAX_UNLOCK_FAILURES) {
        // Threshold reached — wipe local cache. Next mount sees 'none'
        // and the UI flips to the Create/Import wallet screen.
        clearEncryptedWallet(actorId);
        clearSessionKeypair(actorId);
        clearUnlockFailures(actorId);
        setKeypair(null);
        setProgram(null);
        setSolBalance(null);
        setUsdtBalance(null);
        setWalletState('none');
      }
      return false;
    }
  }, [actorId, fetchUnlockHelper]);

  // Migrate a legacy password-protected wallet to the new 6-digit PIN.
  // Decrypts with `oldPassword`, re-encrypts under `newPin`, marks the
  // session unlocked. Returns false if the old password is wrong.
  const migrateToPin = useCallback(async (oldPassword: string, newPin: string): Promise<boolean> => {
    if (!actorId) return false;
    const encrypted = loadEncryptedWallet(actorId);
    if (!encrypted) return false;
    if (!/^\d{6}$/.test(newPin)) return false;

    const helper = await fetchUnlockHelper();
    if (versionRequiresHelper(encrypted.version) && !helper) return false;

    try {
      const kp = await decryptWallet(encrypted, oldPassword.trim(), helper);
      await changeWalletPassword(actorId, oldPassword.trim(), newPin, kp, helper);
      clearUnlockFailures(actorId);
      setKeypair(kp);
      setWalletState('unlocked');
      lastActivityRef.current = Date.now();
      saveSessionKeypair(actorId, kp);
      return true;
    } catch {
      return false;
    }
  }, [actorId, fetchUnlockHelper]);

  // Lock wallet (clear keypair from memory + session, keep encrypted blob).
  const lockWallet = useCallback(() => {
    setKeypair(null);
    setProgram(null);
    setSolBalance(null);
    setUsdtBalance(null);
    if (actorId) {
      clearSessionKeypair(actorId);
      setWalletState(hasEncryptedWallet(actorId) ? 'locked' : 'none');
    } else {
      setWalletState('initializing');
    }
  }, [actorId]);

  // ── PIN-as-password merge ────────────────────────────────────────────
  // Single secret for both the app PIN and the wallet — see comment in
  // validatePasswordStrength. Creates the wallet on first use; unlocks
  // an existing one otherwise. Safe to call repeatedly.
  const createOrUnlockWithPin = useCallback(async (pin: string): Promise<boolean> => {
    if (!actorId) return false;
    if (!/^[0-9]{4,6}$/.test(pin)) return false;

    // Wallet already exists → just unlock with PIN.
    if (hasEncryptedWallet(actorId)) {
      return unlockWallet(pin);
    }

    // No wallet yet → mint one with the PIN as password. Helper is
    // required for v3+ blobs; bail with a clear failure if unreachable.
    const helper = await fetchUnlockHelper();
    if (!helper) return false;
    try {
      const { generateMnemonicWallet, saveEncryptedWallet, saveEncryptedMnemonic } =
        await import('@/lib/wallet/embeddedWallet');
      const { keypair, encrypted, encryptedMnemonic } =
        await generateMnemonicWallet(pin, helper);
      saveEncryptedWallet(actorId, encrypted);
      saveEncryptedMnemonic(actorId, encryptedMnemonic);
      setKeypair(keypair);
      setWalletState('unlocked');
      lastActivityRef.current = Date.now();
      saveSessionKeypair(actorId, keypair);
      return true;
    } catch {
      return false;
    }
  }, [actorId, unlockWallet, fetchUnlockHelper]);

  // Delete wallet entirely (removes the encrypted blob too).
  const deleteWallet = useCallback(() => {
    if (!actorId) return;
    clearSessionKeypair(actorId);
    lockWallet();
    clearEncryptedWallet(actorId);
    setWalletState('none');
  }, [actorId, lockWallet]);

  // Set keypair directly (used by setup flow after generate/import).
  const setKeypairAndUnlock = useCallback((kp: Keypair) => {
    setKeypair(kp);
    setWalletState('unlocked');
    lastActivityRef.current = Date.now();
    if (actorId) saveSessionKeypair(actorId, kp);
  }, [actorId]);

  // ---- Transaction helper ----
  const signAndSend = useCallback(async (transaction: Transaction): Promise<string> => {
    if (!keypair) throw new Error('Wallet locked');
    touchActivity();

    // Gasless: backend pays fees — user needs zero SOL.
    // Serialize without blockhash (backend sets a fresh one).
    transaction.feePayer = keypair.publicKey; // placeholder so serialize works
    const txBase64 = transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');

    const feeRes = await fetch('/api/solana/feepayer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tx: txBase64 }),
      credentials: 'include',
    });
    if (!feeRes.ok) {
      const err = await feeRes.json().catch(() => ({ error: 'feepayer endpoint failed' }));
      throw new Error(err.error || 'Failed to get gasless fee payer signature');
    }
    const { tx: partialBase64, lastValidBlockHeight } = await feeRes.json();
    const partialTx = Transaction.from(Buffer.from(partialBase64, 'base64'));

    // User's keypair adds authority signature
    partialTx.partialSign(keypair);

    const txHash = await connection.sendRawTransaction(partialTx.serialize(), { maxRetries: 5 });
    return await confirmHttp(connection, txHash, { lastValidBlockHeight });
  }, [keypair, connection, touchActivity]);

  // ---- Protocol config check ----
  const ensureProtocolConfig = useCallback(async () => {
    if (!program || !keypair) return;
    const exists = await checkProtocolConfigExists(program);
    if (!exists) {
      await initializeProtocolConfig(program, keypair.publicKey);
    }
  }, [program, keypair]);

  // ---- Trade Operations ----

  const createTrade = useCallback(async (params: {
    tradeId: number; amount: number; side: 'buy' | 'sell'; feeBps?: number;
  }) => {
    if (!keypair || !program) throw new Error('Wallet not connected');
    touchActivity();
    await ensureProtocolConfig();

    const amountBN = new BN(Math.floor(params.amount * 1_000_000));
    const sideEnum = params.side === 'buy' ? TradeSide.Buy : TradeSide.Sell;
    const [tradePda] = findTradePda(keypair.publicKey, params.tradeId);
    const [escrowPda] = findEscrowPda(tradePda);

    const tx = await buildCreateTradeTx(program, keypair.publicKey, USDT_MINT, {
      tradeId: params.tradeId,
      amount: amountBN,
      side: sideEnum,
      feeBps: params.feeBps ?? FEE_BPS_DEFAULT,
    });
    const txHash = await signAndSend(tx);
    await refreshBalances();

    return { txHash, success: true, tradePda: tradePda.toString(), escrowPda: escrowPda.toString(), tradeId: params.tradeId };
  }, [keypair, program, signAndSend, refreshBalances, ensureProtocolConfig, touchActivity]);

  const fundEscrowOnly = useCallback(async (params: {
    tradeId: number; amount: number; side: 'buy' | 'sell'; feeBps?: number;
  }) => {
    if (!keypair || !program) throw new Error('Wallet not connected');
    touchActivity();
    await ensureProtocolConfig();

    const amountBN = new BN(Math.floor(params.amount * 1_000_000));
    const sideEnum = params.side === 'buy' ? TradeSide.Buy : TradeSide.Sell;
    const [tradePda] = findTradePda(keypair.publicKey, params.tradeId);
    const [escrowPda] = findEscrowPda(tradePda);

    // Create trade + fund escrow in one tx
    const createTx = await buildCreateTradeTx(program, keypair.publicKey, USDT_MINT, {
      tradeId: params.tradeId,
      amount: amountBN,
      side: sideEnum,
      feeBps: params.feeBps ?? FEE_BPS_DEFAULT,
    });
    const fundTx = await buildFundEscrowTx(program, keypair.publicKey, tradePda, USDT_MINT);

    // Prepend a priority-fee instruction so the lock-escrow tx lands within
    // the blockhash window even under cluster congestion. 10_000 µ-lamports/CU
    // matches the 'medium' preset used elsewhere — pennies in cost, dramatic
    // reliability win on devnet.
    const transaction = new Transaction();
    transaction.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 }));
    for (const ix of createTx.instructions) transaction.add(ix);
    for (const ix of fundTx.instructions) transaction.add(ix);

    const txHash = await signAndSend(transaction);
    await refreshBalances();

    return { txHash, success: true, tradePda: tradePda.toString(), escrowPda: escrowPda.toString(), tradeId: params.tradeId };
  }, [keypair, program, signAndSend, refreshBalances, ensureProtocolConfig, touchActivity]);

  const depositToEscrowOpen = useCallback(async (params: {
    amount: number; tradeId?: number; side?: 'buy' | 'sell';
  }) => {
    const tradeId = params.tradeId ?? Date.now();
    const side = params.side ?? 'sell';
    return fundEscrowOnly({ tradeId, amount: params.amount, side });
  }, [fundEscrowOnly]);

  const depositToEscrow = useCallback(async (params: {
    amount: number; merchantWallet?: string; tradeId?: number;
  }) => {
    const tradeId = params.tradeId ?? Date.now();
    return depositToEscrowOpen({ amount: params.amount, tradeId });
  }, [depositToEscrowOpen]);

  const lockEscrow = useCallback(async (params: {
    creatorPubkey: string; tradeId: number; counterparty: string;
  }) => {
    if (!keypair || !program) throw new Error('Wallet not connected');
    touchActivity();

    const creatorPk = new PublicKey(params.creatorPubkey);
    const counterpartyPk = new PublicKey(params.counterparty);
    const [tradePda] = findTradePda(creatorPk, params.tradeId);
    const [escrowPda] = findEscrowPda(tradePda);

    const tx = await buildLockEscrowTx(program, keypair.publicKey, tradePda, counterpartyPk, USDT_MINT);
    const txHash = await signAndSend(tx);
    await refreshBalances();

    return { txHash, success: true, tradePda: tradePda.toString(), escrowPda: escrowPda.toString(), tradeId: params.tradeId };
  }, [keypair, program, signAndSend, refreshBalances, touchActivity]);

  const acceptTrade = useCallback(async (params: {
    creatorPubkey: string; tradeId: number;
  }) => {
    if (!keypair || !program) throw new Error('Wallet not connected');
    touchActivity();

    const creatorPk = new PublicKey(params.creatorPubkey);
    const [tradePda] = findTradePda(creatorPk, params.tradeId);
    const [escrowPda] = findEscrowPda(tradePda);

    const tx = await buildAcceptTradeTx(program, keypair.publicKey, tradePda);
    const txHash = await signAndSend(tx);
    await refreshBalances();

    return { txHash, success: true, tradePda: tradePda.toString(), escrowPda: escrowPda.toString(), tradeId: params.tradeId };
  }, [keypair, program, signAndSend, refreshBalances, touchActivity]);

  const releaseEscrow = useCallback(async (params: {
    creatorPubkey: string; tradeId: number; counterparty: string;
  }) => {
    if (!keypair || !program) throw new Error('Wallet not connected');
    touchActivity();

    const creatorPk = new PublicKey(params.creatorPubkey);
    const [tradePda] = findTradePda(creatorPk, params.tradeId);
    const [escrowPda] = findEscrowPda(tradePda);

    // Fetch on-chain trade to get actual counterparty (critical for M2M orders)
    const onChainTrade = await fetchTrade(program, creatorPk, params.tradeId);
    let counterpartyPk: PublicKey;
    if (onChainTrade?.counterparty) {
      counterpartyPk = onChainTrade.counterparty;
      if (process.env.NODE_ENV !== 'production') {

      }
    } else {
      counterpartyPk = new PublicKey(params.counterparty);
      if (process.env.NODE_ENV !== 'production') {

      }
    }

    const tx = await buildReleaseEscrowTx(program, keypair.publicKey, {
      tradePda, counterparty: counterpartyPk, mint: USDT_MINT,
    });
    const txHash = await signAndSend(tx);
    await refreshBalances();

    return { txHash, success: true, tradePda: tradePda.toString(), escrowPda: escrowPda.toString(), tradeId: params.tradeId };
  }, [keypair, program, signAndSend, refreshBalances, touchActivity]);

  const refundEscrow = useCallback(async (params: {
    creatorPubkey: string; tradeId: number;
  }) => {
    if (!keypair || !program) throw new Error('Wallet not connected');
    touchActivity();

    const creatorPk = new PublicKey(params.creatorPubkey);
    const [tradePda] = findTradePda(creatorPk, params.tradeId);
    const [escrowPda] = findEscrowPda(tradePda);

    const tx = await buildRefundEscrowTx(program, keypair.publicKey, {
      tradePda, mint: USDT_MINT,
    });
    const txHash = await signAndSend(tx);
    await refreshBalances();

    return { txHash, success: true, tradePda: tradePda.toString(), escrowPda: escrowPda.toString(), tradeId: params.tradeId };
  }, [keypair, program, signAndSend, refreshBalances, touchActivity]);

  const extendEscrow = useCallback(async (params: {
    creatorPubkey: string; tradeId: number; extensionSeconds: number;
  }) => {
    if (!keypair || !program) throw new Error('Wallet not connected');
    touchActivity();

    const creatorPk = new PublicKey(params.creatorPubkey);
    const [tradePda] = findTradePda(creatorPk, params.tradeId);
    const [escrowPda] = findEscrowPda(tradePda);

    const tx = await buildExtendEscrowTx(program, keypair.publicKey, {
      tradePda, extensionSeconds: new BN(params.extensionSeconds),
    });
    const txHash = await signAndSend(tx);

    return { txHash, success: true, tradePda: tradePda.toString(), escrowPda: escrowPda.toString(), tradeId: params.tradeId };
  }, [keypair, program, signAndSend, touchActivity]);

  const confirmPayment = useCallback(async (params: {
    creatorPubkey: string; tradeId: number;
  }) => {
    if (!keypair || !program) throw new Error('Wallet not connected');
    touchActivity();

    const creatorPk = new PublicKey(params.creatorPubkey);
    const [tradePda] = findTradePda(creatorPk, params.tradeId);
    const [escrowPda] = findEscrowPda(tradePda);

    const tx = await buildConfirmPaymentTx(program, keypair.publicKey, { tradePda });
    const txHash = await signAndSend(tx);

    return { txHash, success: true, tradePda: tradePda.toString(), escrowPda: escrowPda.toString(), tradeId: params.tradeId };
  }, [keypair, program, signAndSend, touchActivity]);

  const openDispute = useCallback(async (params: {
    creatorPubkey: string; tradeId: number;
  }) => {
    if (!keypair || !program) throw new Error('Wallet not connected');
    touchActivity();

    const creatorPk = new PublicKey(params.creatorPubkey);
    const [tradePda] = findTradePda(creatorPk, params.tradeId);
    const [escrowPda] = findEscrowPda(tradePda);

    const tx = await buildOpenDisputeTx(program, keypair.publicKey, { tradePda });
    const txHash = await signAndSend(tx);

    return { txHash, success: true, tradePda: tradePda.toString(), escrowPda: escrowPda.toString(), tradeId: params.tradeId };
  }, [keypair, program, signAndSend, touchActivity]);

  const resolveDispute = useCallback(async (params: {
    creatorPubkey: string; tradeId: number; resolution: 'release_to_buyer' | 'refund_to_seller';
  }) => {
    if (!keypair || !program) throw new Error('Wallet not connected');
    touchActivity();

    const creatorPk = new PublicKey(params.creatorPubkey);
    const [tradePda] = findTradePda(creatorPk, params.tradeId);
    const [escrowPda] = findEscrowPda(tradePda);

    const resolution = params.resolution === 'release_to_buyer'
      ? DisputeResolution.ReleaseToBuyer
      : DisputeResolution.RefundToSeller;

    const tx = await buildResolveDisputeTx(program, keypair.publicKey, {
      tradePda, resolution, mint: USDT_MINT,
    });
    const txHash = await signAndSend(tx);

    return { txHash, success: true, tradePda: tradePda.toString(), escrowPda: escrowPda.toString(), tradeId: params.tradeId };
  }, [keypair, program, signAndSend, touchActivity]);

  // Lane operations
  const createCorridor = useCallback(async (_params: { laneId: number; minAmount: number; maxAmount: number }) => {
    throw new Error('Lane operations not yet supported in embedded wallet');
  }, []);

  const fundCorridor = useCallback(async (_laneId: number, _amount: number) => {
    throw new Error('Lane operations not yet supported in embedded wallet');
  }, []);

  const withdrawCorridor = useCallback(async (_laneId: number, _amount: number) => {
    throw new Error('Lane operations not yet supported in embedded wallet');
  }, []);

  const getCorridorInfo = useCallback(async (laneId: number): Promise<Lane | null> => {
    if (!program || !keypair) return null;
    return fetchLane(program, keypair.publicKey, laneId);
  }, [program, keypair]);

  // Sign message
  const signMessageFn = useCallback(async (message: Uint8Array): Promise<Uint8Array> => {
    if (!keypair) throw new Error('Wallet locked');
    touchActivity();
    const nacl = await import('tweetnacl');
    return nacl.sign.detached(message, keypair.secretKey);
  }, [keypair, touchActivity]);

  // Sign transaction — handles both legacy Transaction and the newer
  // VersionedTransaction the swap flow (Jupiter v1) hands us. Without
  // this exported the swap CTA stays disabled because the modal can't
  // get a `signTransaction` from the embedded wallet adapter.
  const signTransactionFn = useCallback(
    async <T,>(tx: T): Promise<T> => {
      if (!keypair) throw new Error('Wallet locked');
      touchActivity();
      // Lazy-import web3.js to avoid bloating the EmbeddedWalletContext
      // bundle for callers that only need signMessage.
      const { VersionedTransaction, Transaction } = await import('@solana/web3.js');
      if (tx instanceof VersionedTransaction) {
        tx.sign([keypair]);
        return tx;
      }
      if (tx instanceof Transaction) {
        tx.partialSign(keypair);
        return tx;
      }
      throw new Error('Unsupported transaction type');
    },
    [keypair, touchActivity],
  );
  const signAllTransactionsFn = useCallback(
    async <T,>(txs: T[]): Promise<T[]> => {
      const signed: T[] = [];
      for (const tx of txs) signed.push(await signTransactionFn(tx));
      return signed;
    },
    [signTransactionFn],
  );

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const value: any = {
    // Wallet state
    connected: walletState === 'unlocked',
    connecting: false,
    publicKey: keypair?.publicKey ?? null,
    walletAddress: keypair?.publicKey.toBase58() ?? null,

    // Actions
    connect: () => { /* use unlock instead */ },
    disconnect: lockWallet,
    openWalletModal: () => { /* no external wallet modal */ },
    signMessage: signMessageFn,
    signTransaction: signTransactionFn,
    signAllTransactions: signAllTransactionsFn,

    // Balance
    solBalance,
    usdtBalance,
    refreshBalances,

    // Lane operations
    createCorridor,
    fundCorridor,
    withdrawCorridor,
    getCorridorInfo,

    // Trade operations
    createTrade,
    lockEscrow,
    releaseEscrow,
    refundEscrow,
    extendEscrow,
    fundEscrowOnly,
    acceptTrade,
    depositToEscrow,
    depositToEscrowOpen,

    // V2.3: Payment + disputes
    confirmPayment,
    openDispute,
    resolveDispute,

    // Network
    network: 'devnet' as const,
    programReady: !!program,
    reinitializeProgram: () => {
      if (keypair) {
        const adapter = createKeypairWalletAdapter(keypair);
        const provider = new AnchorProvider(connection, adapter, { commitment: 'confirmed' });
        setProgram(new Program(idl, PROGRAM_ID, provider));
      }
    },

    // Embedded-wallet-specific extensions
    embeddedWallet: {
      state: walletState,
      actorId,
      setActorId,
      unlockWallet,
      createOrUnlockWithPin,
      migrateToPin,
      lockWallet,
      deleteWallet,
      setKeypairAndUnlock,
    },
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return (
    <SolanaWalletContext.Provider value={value}>
      {children}
    </SolanaWalletContext.Provider>
  );
};

export const EmbeddedWalletProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) return <>{children}</>;

  return (
    <EmbeddedWalletInnerProvider>
      {children}
    </EmbeddedWalletInnerProvider>
  );
};
