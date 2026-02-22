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
  getV2ProgramId,
  getUsdtMint,
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
} from '@/lib/solana/v2';
import {
  loadEncryptedWallet,
  decryptWallet,
  clearEncryptedWallet,
  hasEncryptedWallet,
  saveSessionKeypair,
  loadSessionKeypair,
  clearSessionKeypair,
} from '@/lib/wallet/embeddedWallet';
import { createKeypairWalletAdapter } from '@/lib/wallet/keypairWalletAdapter';
import idlRaw from '@/lib/solana/v2/idl.json';

// IDL conversion (same as SolanaWalletContext)
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

function convertIdlToAnchor29(idl: any): Idl {
  const hasProperAccounts = (idl.accounts || []).length === 0 ||
    (idl.accounts || []).every((acc: any) => acc.type && acc.type.kind);
  if (hasProperAccounts && idl.accounts?.length > 0) return idl as Idl;
  if (idl.version && idl.name && hasProperAccounts) return idl as Idl;

  const isNewFormat = !!(idl.address || (idl.metadata && !idl.name) || (idl.accounts?.length && !idl.accounts[0].type));
  if (!isNewFormat) return idl as Idl;

  const typeMap = new Map<string, any>();
  for (const td of (idl.types || [])) {
    const c: any = { name: td.name, type: { kind: td.type?.kind || 'struct' } };
    if (td.type?.kind === 'struct') c.type.fields = convertFields(td.type.fields || []);
    else if (td.type?.kind === 'enum') c.type.variants = (td.type.variants || []).map((v: any) => ({
      name: v.name, ...(v.fields ? { fields: convertFields(v.fields) } : {}),
    }));
    typeMap.set(td.name, c);
  }

  return {
    address: idl.address || idl.metadata?.address || '',
    metadata: {
      name: idl.metadata?.name || idl.name || 'unknown',
      version: idl.metadata?.version || idl.version || '0.1.0',
      spec: idl.metadata?.spec || '0.1.0',
    },
    version: idl.metadata?.version || idl.version || '0.1.0',
    name: idl.metadata?.name || idl.name || 'unknown',
    instructions: (idl.instructions || []).map((ix: any) => ({
      name: ix.name,
      accounts: (ix.accounts || []).map((acc: any) => ({
        name: acc.name,
        isMut: acc.writable ?? acc.isMut ?? false,
        isSigner: acc.signer ?? acc.isSigner ?? false,
        ...(acc.optional || acc.isOptional ? { isOptional: true } : {}),
      })),
      args: (ix.args || []).map((arg: any) => ({
        name: arg.name,
        type: convertType(arg.type),
      })),
    })),
    accounts: [],
    types: Array.from(typeMap.values()),
    errors: idl.errors || [],
    events: idl.events || [],
  } as unknown as Idl;
}

const idl = convertIdlToAnchor29(idlRaw);
const PROGRAM_ID = new PublicKey((idlRaw as any).address || (idlRaw as any).metadata?.address || getV2ProgramId().toBase58());
const USDT_MINT = getUsdtMint('devnet');
const AUTO_LOCK_MS = 15 * 60 * 1000; // 15 minutes

export type EmbeddedWalletState = 'none' | 'locked' | 'unlocked';

const EmbeddedWalletInnerProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [walletState, setWalletState] = useState<EmbeddedWalletState>('none');
  const [keypair, setKeypair] = useState<Keypair | null>(null);
  const [program, setProgram] = useState<Program | null>(null);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [usdtBalance, setUsdtBalance] = useState<number | null>(null);

  const connectionRef = useRef<Connection>(new Connection(DEVNET_RPC, 'confirmed'));
  const lastActivityRef = useRef<number>(Date.now());
  const autoLockTimerRef = useRef<NodeJS.Timeout | null>(null);

  const connection = connectionRef.current;

  // Check sessionStorage first (survives refresh), then localStorage
  useEffect(() => {
    const sessionKp = loadSessionKeypair();
    if (sessionKp && hasEncryptedWallet()) {
      // Restore unlocked state from session — no password needed
      setKeypair(sessionKp);
      setWalletState('unlocked');
      lastActivityRef.current = Date.now();
    } else if (hasEncryptedWallet()) {
      setWalletState('locked');
    } else {
      setWalletState('none');
    }
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
      const interval = setInterval(refreshBalances, 10_000);
      return () => clearInterval(interval);
    }
  }, [walletState, keypair, refreshBalances]);

  // Sync wallet address to merchant DB record when unlocked
  useEffect(() => {
    if (walletState !== 'unlocked' || !keypair) return;
    const walletAddress = keypair.publicKey.toBase58();
    try {
      const saved = localStorage.getItem('blip_merchant');
      if (!saved) return;
      const merchant = JSON.parse(saved);
      if (!merchant.id) return;
      // Skip if already synced
      if (merchant.wallet_address === walletAddress) return;
      // Update DB
      fetch('/api/auth/merchant', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchant_id: merchant.id, wallet_address: walletAddress }),
      }).then(() => {
        // Update local cache too
        merchant.wallet_address = walletAddress;
        localStorage.setItem('blip_merchant', JSON.stringify(merchant));
      }).catch(() => {});
    } catch {}
  }, [walletState, keypair]);

  // Unlock wallet
  const unlockWallet = useCallback(async (password: string): Promise<boolean> => {
    const encrypted = loadEncryptedWallet();
    if (!encrypted) return false;

    try {
      const kp = await decryptWallet(encrypted, password);
      setKeypair(kp);
      setWalletState('unlocked');
      lastActivityRef.current = Date.now();
      saveSessionKeypair(kp);
      return true;
    } catch {
      return false;
    }
  }, []);

  // Lock wallet (clear keypair from memory + session)
  const lockWallet = useCallback(() => {
    setKeypair(null);
    setProgram(null);
    setSolBalance(null);
    setUsdtBalance(null);
    clearSessionKeypair();
    setWalletState(hasEncryptedWallet() ? 'locked' : 'none');
  }, []);

  // Delete wallet entirely
  const deleteWallet = useCallback(() => {
    clearSessionKeypair();
    lockWallet();
    clearEncryptedWallet();
    setWalletState('none');
  }, [lockWallet]);

  // Set keypair directly (used by setup flow after generate/import)
  const setKeypairAndUnlock = useCallback((kp: Keypair) => {
    setKeypair(kp);
    setWalletState('unlocked');
    lastActivityRef.current = Date.now();
    saveSessionKeypair(kp);
  }, []);

  // ---- Transaction helper ----
  const signAndSend = useCallback(async (transaction: Transaction): Promise<string> => {
    if (!keypair) throw new Error('Wallet locked');
    touchActivity();

    // Check SOL balance for fees
    const solBal = await connection.getBalance(keypair.publicKey);
    if (solBal < 10_000) {
      throw new Error('Insufficient SOL for transaction fees. Airdrop SOL first from the Wallet page.');
    }

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = keypair.publicKey;
    transaction.partialSign(keypair);

    const txHash = await connection.sendRawTransaction(transaction.serialize(), {
      maxRetries: 5,
    });

    await connection.confirmTransaction({ signature: txHash, blockhash, lastValidBlockHeight });
    return txHash;
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
    tradeId: number; amount: number; side: 'buy' | 'sell';
  }) => {
    if (!keypair || !program) throw new Error('Wallet not connected');
    touchActivity();
    await ensureProtocolConfig();

    const amountBN = new BN(Math.floor(params.amount * 1_000_000));
    const sideEnum = params.side === 'buy' ? TradeSide.Buy : TradeSide.Sell;
    const [tradePda] = findTradePda(keypair.publicKey, params.tradeId);
    const [escrowPda] = findEscrowPda(tradePda);

    const tx = await buildCreateTradeTx(program, keypair.publicKey, USDT_MINT, {
      tradeId: params.tradeId, amount: amountBN, side: sideEnum,
    });
    const txHash = await signAndSend(tx);
    await refreshBalances();

    return { txHash, success: true, tradePda: tradePda.toString(), escrowPda: escrowPda.toString(), tradeId: params.tradeId };
  }, [keypair, program, signAndSend, refreshBalances, ensureProtocolConfig, touchActivity]);

  const fundEscrowOnly = useCallback(async (params: {
    tradeId: number; amount: number; side: 'buy' | 'sell';
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
      tradeId: params.tradeId, amount: amountBN, side: sideEnum,
    });
    const fundTx = await buildFundEscrowTx(program, keypair.publicKey, tradePda, USDT_MINT);

    const transaction = new Transaction();
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
    const counterpartyPk = new PublicKey(params.counterparty);
    const [tradePda] = findTradePda(creatorPk, params.tradeId);
    const [escrowPda] = findEscrowPda(tradePda);

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
      unlockWallet,
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
