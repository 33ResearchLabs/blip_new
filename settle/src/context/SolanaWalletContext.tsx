'use client';

import React, { FC, ReactNode, useMemo, useCallback, createContext, useContext, useState, useEffect, useRef } from 'react';
import { ConnectionProvider, WalletProvider, useWallet, useConnection } from '@solana/wallet-adapter-react';
import type { Adapter } from '@solana/wallet-adapter-base';
import { WalletModalProvider, useWalletModal } from '@solana/wallet-adapter-react-ui';
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  TorusWalletAdapter,
  LedgerWalletAdapter,
  CoinbaseWalletAdapter,
  WalletConnectWalletAdapter,
  TrustWalletAdapter,
  CloverWalletAdapter,
  Coin98WalletAdapter,
  SlopeWalletAdapter,
  BitpieWalletAdapter,
  TokenPocketWalletAdapter,
  MathWalletAdapter,
  BitgetWalletAdapter,
  SpotWalletAdapter,
  HuobiWalletAdapter,
  SaifuWalletAdapter,
  TokenaryWalletAdapter,
  NightlyWalletAdapter,
  NekoWalletAdapter,
  NufiWalletAdapter,
  OntoWalletAdapter,
  ParticleAdapter,
  SafePalWalletAdapter,
  SalmonWalletAdapter,
  SkyWalletAdapter,
  AvanaWalletAdapter,
  ExodusWalletAdapter,
  KeystoneWalletAdapter,
  KrystalWalletAdapter,
  XDEFIWalletAdapter,
} from '@solana/wallet-adapter-wallets';
import { getPrimaryEndpoint, getHealthyEndpoint } from '@/lib/solana/rpc';
import { PublicKey, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  getAccount,
} from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import { Program, AnchorProvider, BN, Idl } from '@coral-xyz/anchor';

// Import wallet adapter styles
import '@solana/wallet-adapter-react-ui/styles.css';

// Import V2.2 SDK
import {
  BLIP_V2_PROGRAM_ID,
  checkProtocolConfigExists,
  initializeProtocolConfig,
  createLane,
  buildFundLaneTx,
  buildWithdrawLaneTx,
  buildCreateTradeTx,
  buildLockEscrowTx,
  buildReleaseEscrowTx,
  buildRefundEscrowTx,
  fetchLane,
  fetchTrade,
  findLanePda,
  findTradePda,
  findEscrowPda,
  TradeSide,
  type Lane,
  getUsdtMint,
} from '@/lib/solana/v2';

// Get network from environment variable (defaults to devnet for safety)
const SOLANA_NETWORK: 'devnet' | 'mainnet-beta' =
  (process.env.NEXT_PUBLIC_SOLANA_NETWORK as 'devnet' | 'mainnet-beta') || 'devnet';
import idlRaw from '@/lib/solana/v2/idl.json';
// Using inline convertIdlToAnchor29 function below

// ============================================================================
// IDL CONVERSION: Anchor 0.30+ format → Anchor 0.29 format
// ============================================================================

/**
 * Convert type from Anchor 0.30+ format to Anchor 0.29 format
 * Main differences:
 * - "pubkey" → "publicKey"
 * - { defined: { name: "X" } } → { defined: "X" }
 */
function convertType(type: any): any {
  if (type === "pubkey") return "publicKey";
  if (type === "string") return "string";
  if (typeof type === "string") return type;

  if (type && typeof type === "object") {
    if (type.array) {
      return { array: [convertType(type.array[0]), type.array[1]] };
    }
    if (type.vec) {
      return { vec: convertType(type.vec) };
    }
    if (type.option) {
      return { option: convertType(type.option) };
    }
    if (type.defined) {
      if (typeof type.defined === "object" && type.defined.name) {
        return { defined: type.defined.name };
      }
      return { defined: type.defined };
    }
  }

  return type;
}

function convertFields(fields: any[]): any[] {
  if (!fields) return [];
  return fields.map((field: any) => ({
    name: field.name,
    type: convertType(field.type),
  }));
}

/**
 * Convert new Anchor 0.30+ IDL format to Anchor 0.29 compatible format
 */
function convertIdlToAnchor29(idl: any): Idl {
  // Check if accounts already have proper type structure - this is the KEY indicator
  const hasProperAccounts = (idl.accounts || []).length === 0 ||
    (idl.accounts || []).every((acc: any) =>
      acc.type && acc.type.kind && (acc.type.fields || acc.type.variants)
    );

  // If accounts have proper types, don't convert - regardless of other fields
  if (hasProperAccounts && idl.accounts?.length > 0) {
    console.log("[IDL] Accounts already have proper type structure, skipping conversion:", idl.name || idl.metadata?.name);
    return idl as Idl;
  }

  if (idl.version && idl.name && hasProperAccounts) {
    console.log("[IDL] Already in Anchor 0.29 format:", idl.name);
    return idl as Idl;
  }

  const isNewFormat = !!(
    idl.address ||
    (idl.metadata && !idl.name) ||
    (idl.accounts?.length && !idl.accounts[0].type)
  );

  if (!isNewFormat) {
    console.log("[IDL] Already in old format:", idl.name || idl.metadata?.name);
    return idl as Idl;
  }

  console.log("[IDL] Converting from Anchor 0.30+ format:", idl.metadata?.name || idl.name);

  // Build type map
  const typeMap = new Map<string, any>();
  for (const typeDef of (idl.types || [])) {
    const converted: any = {
      name: typeDef.name,
      type: {
        kind: typeDef.type?.kind || "struct",
      },
    };

    if (typeDef.type?.kind === "struct") {
      converted.type.fields = convertFields(typeDef.type.fields || []);
    } else if (typeDef.type?.kind === "enum") {
      converted.type.variants = (typeDef.type.variants || []).map((v: any) => ({
        name: v.name,
        ...(v.fields ? { fields: convertFields(v.fields) } : {}),
      }));
    }

    typeMap.set(typeDef.name, converted);
  }

  const convertedTypes = Array.from(typeMap.values());

  // Convert accounts
  const convertedAccounts = (idl.accounts || []).map((acc: any) => {
    if (acc.type && acc.type.kind) {
      return {
        name: acc.name,
        type: {
          kind: acc.type.kind,
          fields: acc.type.fields ? convertFields(acc.type.fields) : [],
          ...(acc.type.variants ? { variants: acc.type.variants } : {}),
        },
      };
    }

    const typeDef = typeMap.get(acc.name);
    return {
      name: acc.name,
      type: typeDef?.type || { kind: "struct", fields: [] },
    };
  });

  const converted = {
    address: idl.address || idl.metadata?.address || "",
    metadata: {
      name: idl.metadata?.name || idl.name || "unknown",
      version: idl.metadata?.version || idl.version || "0.1.0",
      spec: idl.metadata?.spec || "0.1.0",
      ...(idl.metadata?.description ? { description: idl.metadata.description } : {}),
    },
    version: idl.metadata?.version || idl.version || "0.1.0",
    name: idl.metadata?.name || idl.name || "unknown",
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
    accounts: [], // CRITICAL: Empty to prevent Anchor AccountClient validation during Program instantiation
    types: convertedTypes,
    errors: idl.errors || [],
    events: idl.events || [],
  } as unknown as Idl;

  console.log("[IDL] Converted successfully:", (converted as any).name || converted.metadata?.name);
  return converted;
}

// Convert IDL to Anchor 0.29 format
const idl = convertIdlToAnchor29(idlRaw);

// Program ID from IDL
const PROGRAM_ID = new PublicKey(idlRaw.address || idlRaw.metadata?.address || BLIP_V2_PROGRAM_ID);

// Debug: Log IDL and program ID at module load
if (typeof window !== 'undefined') {
  console.log('[SolanaWallet] Module loaded - IDL address:', (idl as any).address || idlRaw.address);
  console.log('[SolanaWallet] Module loaded - PROGRAM_ID:', PROGRAM_ID.toString());
  console.log('[SolanaWallet] Module loaded - IDL instructions:', (idl as any).instructions?.length || 0);
}

// USDT Mint - dynamically selected based on network
const USDT_MINT = getUsdtMint(SOLANA_NETWORK);

interface LaneOperationResult {
  txHash: string;
  success: boolean;
  lanePda?: string;
  laneId?: number;
}

interface TradeOperationResult {
  txHash: string;
  success: boolean;
  tradePda?: string;
  escrowPda?: string;
  tradeId?: number;
}

interface SolanaWalletContextType {
  // Wallet state
  connected: boolean;
  connecting: boolean;
  publicKey: PublicKey | null;
  walletAddress: string | null;

  // Actions
  connect: () => void;
  disconnect: () => void;
  openWalletModal: () => void;
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;

  // Balance
  solBalance: number | null;
  usdtBalance: number | null;
  refreshBalances: () => Promise<void>;

  // Lane operations (corridors)
  createCorridor: (params: {
    laneId: number;
    minAmount: number;
    maxAmount: number;
  }) => Promise<LaneOperationResult>;
  fundCorridor: (laneId: number, amount: number) => Promise<LaneOperationResult>;
  withdrawCorridor: (laneId: number, amount: number) => Promise<LaneOperationResult>;
  getCorridorInfo: (laneId: number) => Promise<Lane | null>;

  // Trade operations
  createTrade: (params: {
    tradeId: number;
    amount: number;
    side: 'buy' | 'sell';
  }) => Promise<TradeOperationResult>;
  lockEscrow: (params: {
    creatorPubkey: string;
    tradeId: number;
    counterparty: string;
  }) => Promise<TradeOperationResult>;
  releaseEscrow: (params: {
    creatorPubkey: string;
    tradeId: number;
    counterparty: string;
  }) => Promise<TradeOperationResult>;
  refundEscrow: (params: {
    creatorPubkey: string;
    tradeId: number;
  }) => Promise<TradeOperationResult>;

  // Escrow function - creates trade and locks funds using V2.2 program
  // merchantWallet is optional - if not provided, uses treasury as placeholder counterparty
  // This allows locking escrow before a merchant is assigned (for sell orders)
  depositToEscrow: (params: {
    amount: number;
    merchantWallet?: string;
    tradeId?: number;
  }) => Promise<{
    txHash: string;
    success: boolean;
    tradePda?: string;
    escrowPda?: string;
    tradeId?: number;
  }>;

  // Network
  network: 'devnet' | 'mainnet-beta';

  // Program readiness - true when Anchor program is initialized
  programReady: boolean;

  // Force reinitialize program (for recovery)
  reinitializeProgram: () => void;
}

const SolanaWalletContext = createContext<SolanaWalletContextType | null>(null);

// Inner provider that has access to wallet hooks
const SolanaWalletContextProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const { connection } = useConnection();
  const { publicKey: adapterPublicKey, connected: adapterConnected, connecting, disconnect: walletDisconnect, signTransaction: adapterSignTransaction, signAllTransactions: adapterSignAllTransactions, signMessage, wallet } = useWallet();
  const { setVisible } = useWalletModal();

  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [usdtBalance, setUsdtBalance] = useState<number | null>(null);

  // Phantom direct connection state (for Brave browser fallback)
  const [phantomDirectKey, setPhantomDirectKey] = useState<PublicKey | null>(null);

  // Track current phantom key in a ref to avoid re-render loops in the effect
  const phantomDirectKeyRef = useRef<string | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    phantomDirectKeyRef.current = phantomDirectKey?.toString() || null;
  }, [phantomDirectKey]);

  // Check for Phantom direct connection in Brave - using events only (no polling)
  useEffect(() => {
    const phantom = (window as any).phantom?.solana;
    if (!phantom) return;

    // Handler for Phantom connection state changes
    const handlePhantomConnect = (publicKeyParam?: any) => {
      // Use the passed publicKey or get it from phantom object
      const pubKeySource = publicKeyParam?.publicKey || publicKeyParam || phantom.publicKey;

      if (pubKeySource && !adapterConnected) {
        try {
          const pubKey = new PublicKey(pubKeySource.toString());
          const pubKeyStr = pubKey.toString();

          // Only update state if the key actually changed to avoid re-render loops
          if (phantomDirectKeyRef.current !== pubKeyStr) {
            console.log('[SolanaWallet] Phantom connected (via event):', pubKeyStr);
            phantomDirectKeyRef.current = pubKeyStr;
            setPhantomDirectKey(pubKey);
          }
        } catch (error) {
          console.error('[SolanaWallet] Invalid publicKey from Phantom:', error);
          phantomDirectKeyRef.current = null;
          setPhantomDirectKey(null);
        }
      }
    };

    const handlePhantomDisconnect = () => {
      if (phantomDirectKeyRef.current !== null) {
        console.log('[SolanaWallet] Phantom disconnected (via event)');
        phantomDirectKeyRef.current = null;
        setPhantomDirectKey(null);
      }
    };

    const handleAccountChanged = (newPublicKey: any) => {
      if (newPublicKey) {
        console.log('[SolanaWallet] Phantom account changed');
        handlePhantomConnect(newPublicKey);
      } else {
        handlePhantomDisconnect();
      }
    };

    // Check initial Phantom state ONLY if user has actively connected before
    // This helps Brave browser where the adapter doesn't work but Phantom is connected
    // We only do this if:
    // 1. Phantom reports connected (phantom.isConnected)
    // 2. Phantom has a publicKey
    // 3. The adapter is NOT already connected (to avoid duplicate state)
    if (phantom.isConnected && phantom.publicKey && !adapterConnected) {
      handlePhantomConnect(phantom.publicKey);
    }

    // Register event listeners
    phantom.on?.('connect', handlePhantomConnect);
    phantom.on?.('disconnect', handlePhantomDisconnect);
    phantom.on?.('accountChanged', handleAccountChanged);

    // Cleanup
    return () => {
      phantom.off?.('connect', handlePhantomConnect);
      phantom.off?.('disconnect', handlePhantomDisconnect);
      phantom.off?.('accountChanged', handleAccountChanged);
    };
  }, [adapterConnected]); // Removed phantomDirectKey from deps - using ref instead

  // Use adapter values if available, otherwise fall back to Phantom direct
  const publicKey = adapterPublicKey || phantomDirectKey;
  const connected = adapterConnected || (phantomDirectKey !== null);

  // Debug logging - only log once on initial connection, using a ref to track
  const hasLoggedConnection = React.useRef(false);
  useEffect(() => {
    if (connected && publicKey && !hasLoggedConnection.current) {
      hasLoggedConnection.current = true;
      console.log('[SolanaWallet] Connected:', publicKey.toString());
    } else if (!connected && hasLoggedConnection.current) {
      hasLoggedConnection.current = false;
      console.log('[SolanaWallet] Disconnected');
    }
  }, [connected, publicKey]);

  // Sign transaction - use adapter if available, otherwise use Phantom direct
  const signTransaction = useMemo(() => {
    if (adapterSignTransaction) {
      return adapterSignTransaction;
    }
    // Fallback to Phantom direct API
    const phantom = (window as any).phantom?.solana;
    if (phantom?.isConnected && phantomDirectKey) {
      return async <T extends Transaction>(tx: T): Promise<T> => {
        const signed = await phantom.signTransaction(tx);
        return signed as T;
      };
    }
    return undefined;
  }, [adapterSignTransaction, phantomDirectKey]);

  const signAllTransactions = useMemo(() => {
    if (adapterSignAllTransactions) {
      return adapterSignAllTransactions;
    }
    // Fallback to Phantom direct API
    const phantom = (window as any).phantom?.solana;
    if (phantom?.isConnected && phantomDirectKey) {
      return async <T extends Transaction>(txs: T[]): Promise<T[]> => {
        const signed = await phantom.signAllTransactions(txs);
        return signed as T[];
      };
    }
    return undefined;
  }, [adapterSignAllTransactions, phantomDirectKey]);

  // Sign message - use adapter if available, otherwise use Phantom direct
  // Phantom direct signMessage fallback using useCallback
  const phantomDirectSignMessage = useCallback(
    async (message: Uint8Array): Promise<Uint8Array> => {
      const phantom = (window as any).phantom?.solana;
      if (!phantom?.isConnected) {
        throw new Error('Phantom wallet not connected');
      }
      const signedMessage = await phantom.signMessage(message, 'utf8');
      return signedMessage.signature;
    },
    []
  );

  // Choose signMessage: prefer adapter, fallback to Phantom direct
  const signMessageFallback = useMemo(() => {
    if (signMessage) {
      return signMessage;
    }
    // Use Phantom direct API as fallback
    if (phantomDirectKey) {
      return phantomDirectSignMessage;
    }
    return undefined;
  }, [signMessage, phantomDirectKey, phantomDirectSignMessage]);

  // Counter to force program reinitialization
  const [programVersion, setProgramVersion] = useState(0);

  // Program state - using useState instead of useMemo for more reliable updates
  const [program, setProgram] = useState<Program | null>(null);

  // Guard against concurrent escrow deposit calls
  const depositInProgressRef = useRef(false);

  const walletAddress = useMemo(() => {
    return publicKey ? publicKey.toBase58() : null;
  }, [publicKey]);

  // Create a custom Anchor-compatible wallet object
  // useAnchorWallet returns null if signAllTransactions is missing, so we create our own
  const anchorWallet = useMemo(() => {
    if (!publicKey || !signTransaction) {
      return null;
    }

    // Create an Anchor-compatible wallet interface with proper typing
    const anchorCompatibleWallet = {
      publicKey,
      signTransaction: signTransaction as <T extends Transaction | anchor.web3.VersionedTransaction>(tx: T) => Promise<T>,
      signAllTransactions: (signAllTransactions || (async <T extends Transaction | anchor.web3.VersionedTransaction>(txs: T[]) => {
        // Fallback: sign transactions one by one if signAllTransactions is not available
        const signed: T[] = [];
        for (const tx of txs) {
          signed.push(await (signTransaction as any)(tx));
        }
        return signed;
      })) as <T extends Transaction | anchor.web3.VersionedTransaction>(txs: T[]) => Promise<T[]>,
    };

    return anchorCompatibleWallet;
    // Note: Only depend on values used to create the wallet object, not for logging
  }, [publicKey, signTransaction, signAllTransactions]);


  // Create Anchor program instance using useEffect for more reliable updates
  // This ensures the program is created/updated whenever dependencies change
  useEffect(() => {
    if (!anchorWallet) {
      setProgram(null);
      return;
    }

    try {
      const provider = new AnchorProvider(
        connection,
        anchorWallet,
        { commitment: 'confirmed', preflightCommitment: 'confirmed' }
      );

      // Convert IDL to Anchor 0.29 compatible format
      const convertedIdl = convertIdlToAnchor29(idlRaw);

      // Anchor 0.29 uses 3-parameter constructor: new Program(idl, programId, provider)
      const prog = new anchor.Program(convertedIdl as Idl, PROGRAM_ID, provider);
      setProgram(prog);
    } catch (err) {
      console.error('[SolanaWallet] Failed to create program:', err);
      if (err instanceof Error) {
        console.error('[SolanaWallet] Error details:', {
          name: err.name,
          message: err.message,
          stack: err.stack?.split('\n').slice(0, 5).join('\n'),
        });
      }
      console.error('[SolanaWallet] Full error object:', JSON.stringify(err, Object.getOwnPropertyNames(err)));
      setProgram(null);
    }
  }, [connection, anchorWallet, wallet, programVersion]);

  // Reinitialize program (useful for recovery after wallet issues)
  const reinitializeProgram = useCallback(() => {
    console.log('[SolanaWallet] Forcing program reinitialization...');
    setProgramVersion(v => v + 1);
  }, []);

  const openWalletModal = useCallback(() => {
    setVisible(true);
  }, [setVisible]);

  const disconnect = useCallback(() => {
    // Disconnect adapter
    walletDisconnect();
    // Also disconnect Phantom direct if connected
    const phantom = (window as any).phantom?.solana;
    if (phantom?.isConnected) {
      phantom.disconnect?.();
    }
    setPhantomDirectKey(null);
    setSolBalance(null);
    setUsdtBalance(null);
  }, [walletDisconnect]);

  // Refresh balances
  const refreshBalances = useCallback(async () => {
    if (!publicKey || !connection) return;

    try {
      // Get SOL balance
      const solBal = await connection.getBalance(publicKey);
      setSolBalance(solBal / LAMPORTS_PER_SOL);

      // Get USDT balance
      try {
        const usdtAta = await getAssociatedTokenAddress(
          USDT_MINT,
          publicKey
        );
        const tokenAccount = await getAccount(connection, usdtAta);
        // USDT has 6 decimals
        setUsdtBalance(Number(tokenAccount.amount) / 1_000_000);
      } catch {
        // Token account doesn't exist yet
        setUsdtBalance(0);
      }
    } catch (error) {
      console.error('Failed to fetch balances:', error);
    }
  }, [publicKey, connection]);

  // Refresh balances when connected
  React.useEffect(() => {
    if (connected && publicKey) {
      refreshBalances();
    }
  }, [connected, publicKey, refreshBalances]);

  // ============ PROTOCOL INITIALIZATION ============

  // Helper function to ensure protocol config is initialized
  const ensureProtocolConfigInitialized = useCallback(async (): Promise<void> => {
    if (!program || !publicKey) {
      throw new Error('Program or wallet not ready');
    }

    try {
      const configExists = await checkProtocolConfigExists(program);

      if (!configExists) {
        console.log('[SolanaWallet] Protocol config not found, initializing...');

        // Initialize with default values
        // Note: In production, you'd want a dedicated authority wallet
        // For now, we'll use the connected wallet as authority
        // Treasury: User-specified wallet for receiving protocol fees
        const treasuryWallet = new PublicKey('3ZRyqoMVfCuxgKjGQeJzAuuDZ91L29jCHpi82B3UbAjP');
        console.log('[SolanaWallet] Using treasury:', treasuryWallet.toString());

        const txHash = await initializeProtocolConfig(
          program,
          publicKey,
          treasuryWallet, // Explicitly pass treasury wallet
          250,  // 2.5% fee
          1000, // 10% max fee
          0     // 0% min fee
        );

        console.log('[SolanaWallet] Protocol config initialized:', txHash);
      } else {
        console.log('[SolanaWallet] Protocol config already exists');
      }
    } catch (error) {
      console.error('[SolanaWallet] Failed to check/initialize protocol config:', error);
      throw error;
    }
  }, [program, publicKey]);

  // ============ LANE (CORRIDOR) OPERATIONS ============

  // Create a new corridor (lane) on-chain
  const createCorridor = useCallback(async (params: {
    laneId: number;
    minAmount: number;
    maxAmount: number;
  }): Promise<LaneOperationResult> => {
    if (!publicKey || !program) {
      throw new Error('Wallet not connected');
    }

    try {
      const txHash = await createLane(program, publicKey, {
        laneId: params.laneId,
        minAmount: new BN(Math.floor(params.minAmount * 1_000_000)),
        maxAmount: new BN(Math.floor(params.maxAmount * 1_000_000)),
        mint: USDT_MINT,
      });

      const [lanePda] = findLanePda(publicKey, params.laneId);

      await refreshBalances();

      return {
        txHash,
        success: true,
        lanePda: lanePda.toString(),
        laneId: params.laneId,
      };
    } catch (error) {
      console.error('Create corridor failed:', error);
      throw error;
    }
  }, [publicKey, program, refreshBalances]);

  // Fund a corridor
  const fundCorridor = useCallback(async (laneId: number, amount: number): Promise<LaneOperationResult> => {
    if (!publicKey || !program || !signTransaction) {
      throw new Error('Wallet not connected');
    }

    try {
      const transaction = await buildFundLaneTx(
        program,
        publicKey,
        USDT_MINT,
        {
          laneId,
          amount: new BN(Math.floor(amount * 1_000_000)),
        }
      );

      // Get recent blockhash
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      // Sign transaction
      const signedTx = await signTransaction(transaction);

      // Send transaction
      const txHash = await connection.sendRawTransaction(signedTx.serialize());

      // Confirm transaction
      await connection.confirmTransaction({
        signature: txHash,
        blockhash,
        lastValidBlockHeight,
      });

      const [lanePda] = findLanePda(publicKey, laneId);

      await refreshBalances();

      return {
        txHash,
        success: true,
        lanePda: lanePda.toString(),
        laneId,
      };
    } catch (error) {
      console.error('Fund corridor failed:', error);
      throw error;
    }
  }, [publicKey, program, signTransaction, connection, refreshBalances]);

  // Withdraw from a corridor
  const withdrawCorridor = useCallback(async (laneId: number, amount: number): Promise<LaneOperationResult> => {
    if (!publicKey || !program || !signTransaction) {
      throw new Error('Wallet not connected');
    }

    try {
      const transaction = await buildWithdrawLaneTx(
        program,
        publicKey,
        USDT_MINT,
        {
          laneId,
          amount: new BN(Math.floor(amount * 1_000_000)),
        }
      );

      // Get recent blockhash
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      // Sign transaction
      const signedTx = await signTransaction(transaction);

      // Send transaction
      const txHash = await connection.sendRawTransaction(signedTx.serialize());

      // Confirm transaction
      await connection.confirmTransaction({
        signature: txHash,
        blockhash,
        lastValidBlockHeight,
      });

      const [lanePda] = findLanePda(publicKey, laneId);

      await refreshBalances();

      return {
        txHash,
        success: true,
        lanePda: lanePda.toString(),
        laneId,
      };
    } catch (error) {
      console.error('Withdraw corridor failed:', error);
      throw error;
    }
  }, [publicKey, program, signTransaction, connection, refreshBalances]);

  // Get corridor info
  const getCorridorInfo = useCallback(async (laneId: number): Promise<Lane | null> => {
    if (!publicKey || !program) {
      return null;
    }

    try {
      return await fetchLane(program, publicKey, laneId);
    } catch (error) {
      console.error('Get corridor info failed:', error);
      return null;
    }
  }, [publicKey, program]);

  // ============ TRADE OPERATIONS ============

  // Create a trade on-chain
  const createTrade = useCallback(async (params: {
    tradeId: number;
    amount: number;
    side: 'buy' | 'sell';
  }): Promise<TradeOperationResult> => {
    if (!publicKey || !program || !signTransaction) {
      throw new Error('Wallet not connected');
    }

    try {
      // Ensure protocol config is initialized
      await ensureProtocolConfigInitialized();

      const transaction = await buildCreateTradeTx(
        program,
        publicKey,
        USDT_MINT,
        {
          tradeId: params.tradeId,
          amount: new BN(Math.floor(params.amount * 1_000_000)),
          side: params.side === 'buy' ? TradeSide.Buy : TradeSide.Sell,
        }
      );

      // Get recent blockhash
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      // Sign transaction
      const signedTx = await signTransaction(transaction);

      // Send transaction
      const txHash = await connection.sendRawTransaction(signedTx.serialize());

      // Confirm transaction
      await connection.confirmTransaction({
        signature: txHash,
        blockhash,
        lastValidBlockHeight,
      });

      const [tradePda] = findTradePda(publicKey, params.tradeId);
      const [escrowPda] = findEscrowPda(tradePda);

      await refreshBalances();

      return {
        txHash,
        success: true,
        tradePda: tradePda.toString(),
        escrowPda: escrowPda.toString(),
        tradeId: params.tradeId,
      };
    } catch (error) {
      console.error('Create trade failed:', error);
      throw error;
    }
  }, [publicKey, program, signTransaction, connection, refreshBalances, ensureProtocolConfigInitialized]);

  // Lock escrow for a trade
  const lockEscrow = useCallback(async (params: {
    creatorPubkey: string;
    tradeId: number;
    counterparty: string;
  }): Promise<TradeOperationResult> => {
    if (!publicKey || !program || !signTransaction) {
      throw new Error('Wallet not connected');
    }

    try {
      const creatorPk = new PublicKey(params.creatorPubkey);
      const counterpartyPk = new PublicKey(params.counterparty);
      const [tradePda] = findTradePda(creatorPk, params.tradeId);

      const transaction = await buildLockEscrowTx(
        program,
        publicKey,
        tradePda,
        counterpartyPk,
        USDT_MINT
      );

      // Get recent blockhash
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      // Sign transaction
      const signedTx = await signTransaction(transaction);

      // Send transaction
      const txHash = await connection.sendRawTransaction(signedTx.serialize());

      // Confirm transaction
      await connection.confirmTransaction({
        signature: txHash,
        blockhash,
        lastValidBlockHeight,
      });

      const [escrowPda] = findEscrowPda(tradePda);

      await refreshBalances();

      return {
        txHash,
        success: true,
        tradePda: tradePda.toString(),
        escrowPda: escrowPda.toString(),
        tradeId: params.tradeId,
      };
    } catch (error) {
      console.error('Lock escrow failed:', error);
      throw error;
    }
  }, [publicKey, program, signTransaction, connection, refreshBalances]);

  // Release escrow
  const releaseEscrow = useCallback(async (params: {
    creatorPubkey: string;
    tradeId: number;
    counterparty: string;
  }): Promise<TradeOperationResult> => {
    if (!publicKey || !program || !signTransaction) {
      throw new Error('Wallet not connected');
    }

    try {
      const creatorPk = new PublicKey(params.creatorPubkey);
      const [tradePda] = findTradePda(creatorPk, params.tradeId);

      // Fetch the on-chain trade to get the actual stored counterparty
      // This is critical for M2M orders where escrow was locked to treasury placeholder
      const onChainTrade = await fetchTrade(program, creatorPk, params.tradeId);
      let counterpartyPk: PublicKey;

      if (onChainTrade?.counterparty) {
        // Use the counterparty stored on-chain (this is what the program validates)
        counterpartyPk = onChainTrade.counterparty;
        console.log('[releaseEscrow] Using on-chain counterparty:', counterpartyPk.toString());
      } else {
        // Fallback to passed counterparty if trade not found
        counterpartyPk = new PublicKey(params.counterparty);
        console.log('[releaseEscrow] Using passed counterparty (trade not found):', counterpartyPk.toString());
      }

      const transaction = await buildReleaseEscrowTx(
        program,
        publicKey,
        {
          tradePda,
          counterparty: counterpartyPk,
          mint: USDT_MINT,
        }
      );

      // Get recent blockhash
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      // Sign transaction
      const signedTx = await signTransaction(transaction);

      // Send transaction
      const txHash = await connection.sendRawTransaction(signedTx.serialize());

      // Confirm transaction
      await connection.confirmTransaction({
        signature: txHash,
        blockhash,
        lastValidBlockHeight,
      });

      const [escrowPda] = findEscrowPda(tradePda);

      await refreshBalances();

      return {
        txHash,
        success: true,
        tradePda: tradePda.toString(),
        escrowPda: escrowPda.toString(),
        tradeId: params.tradeId,
      };
    } catch (error) {
      console.error('Release escrow failed:', error);
      throw error;
    }
  }, [publicKey, program, signTransaction, connection, refreshBalances]);

  // Refund escrow
  const refundEscrow = useCallback(async (params: {
    creatorPubkey: string;
    tradeId: number;
  }): Promise<TradeOperationResult> => {
    if (!publicKey || !program || !signTransaction) {
      throw new Error('Wallet not connected');
    }

    try {
      const creatorPk = new PublicKey(params.creatorPubkey);
      const [tradePda] = findTradePda(creatorPk, params.tradeId);

      const transaction = await buildRefundEscrowTx(
        program,
        publicKey,
        {
          tradePda,
          mint: USDT_MINT,
        }
      );

      // Get recent blockhash
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      // Sign transaction
      const signedTx = await signTransaction(transaction);

      // Send transaction
      const txHash = await connection.sendRawTransaction(signedTx.serialize());

      // Confirm transaction
      await connection.confirmTransaction({
        signature: txHash,
        blockhash,
        lastValidBlockHeight,
      });

      const [escrowPda] = findEscrowPda(tradePda);

      await refreshBalances();

      return {
        txHash,
        success: true,
        tradePda: tradePda.toString(),
        escrowPda: escrowPda.toString(),
        tradeId: params.tradeId,
      };
    } catch (error) {
      console.error('Refund escrow failed:', error);
      throw error;
    }
  }, [publicKey, program, signTransaction, connection, refreshBalances]);

  // Deposit to escrow using V2.2 program - creates trade and locks funds
  // merchantWallet is optional - if not provided, uses treasury as placeholder counterparty
  const depositToEscrow = useCallback(async (params: {
    amount: number;
    merchantWallet?: string;
    tradeId?: number;
  }): Promise<{
    txHash: string;
    success: boolean;
    tradePda?: string;
    escrowPda?: string;
    tradeId?: number;
  }> => {
    // Prevent concurrent deposit calls (double-click protection)
    if (depositInProgressRef.current) {
      console.log('[depositToEscrow] Deposit already in progress, ignoring duplicate call');
      throw new Error('Deposit already in progress');
    }
    depositInProgressRef.current = true;

    console.log('[depositToEscrow] Starting with params:', params);
    console.log('[depositToEscrow] State:', {
      publicKey: publicKey?.toString(),
      signTransaction: !!signTransaction,
      program: !!program,
      connected
    });

    if (!publicKey || !signTransaction || !program) {
      depositInProgressRef.current = false;
      const error = `Wallet not ready: publicKey=${!!publicKey}, signTransaction=${!!signTransaction}, program=${!!program}`;
      console.error('[depositToEscrow]', error);
      throw new Error(error);
    }

    try {
      const { amount, merchantWallet, tradeId: providedTradeId } = params;

      // Use treasury as placeholder counterparty if merchant wallet not provided
      // This allows locking escrow before a merchant is assigned (for sell orders)
      const TREASURY_WALLET = '3ZRyqoMVfCuxgKjGQeJzAuuDZ91L29jCHpi82B3UbAjP';
      const counterpartyWallet = merchantWallet || TREASURY_WALLET;

      // Validate counterparty wallet is a valid Solana address (base58)
      // Base58 characters: 123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz
      const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
      if (!base58Regex.test(counterpartyWallet)) {
        throw new Error(`Invalid counterparty wallet address: not a valid Solana address (got ${counterpartyWallet.slice(0, 10)}...)`);
      }

      console.log('[depositToEscrow] Using counterparty:', counterpartyWallet, merchantWallet ? '(merchant)' : '(treasury placeholder)');

      // Ensure protocol config is initialized before creating trades
      console.log('[depositToEscrow] Ensuring protocol config is initialized...');
      await ensureProtocolConfigInitialized();

      // Generate a unique trade ID if not provided (timestamp-based)
      const tradeId = providedTradeId ?? Date.now();

      // Convert amount to token units (USDT has 6 decimals)
      const amountBN = new BN(Math.floor(amount * 1_000_000));

      // Get the trade PDA
      const [tradePda] = findTradePda(publicKey, tradeId);
      const [escrowPda] = findEscrowPda(tradePda);

      console.log('[depositToEscrow] Creating trade with params:', {
        tradeId,
        amount: amountBN.toString(),
        tradePda: tradePda.toString(),
        escrowPda: escrowPda.toString(),
        counterpartyWallet,
      });

      // Helper function with timeout
      const withTimeout = <T,>(promise: Promise<T>, ms: number, name: string): Promise<T> => {
        return Promise.race([
          promise,
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`${name} timed out after ${ms}ms`)), ms)
          )
        ]);
      };

      // Step 1: Build the create trade transaction
      console.log('[depositToEscrow] Building create trade tx...');
      const createTradeTx = await withTimeout(
        buildCreateTradeTx(
          program,
          publicKey,
          USDT_MINT,
          {
            tradeId,
            amount: amountBN,
            side: TradeSide.Sell, // User is selling crypto
          }
        ),
        10000,
        'buildCreateTradeTx'
      );
      console.log('[depositToEscrow] Create trade tx built, instructions:', createTradeTx.instructions.length);

      // Step 2: Build the lock escrow transaction
      console.log('[depositToEscrow] Building lock escrow tx...');
      const counterpartyPubkey = new PublicKey(counterpartyWallet);
      const lockEscrowTx = await withTimeout(
        buildLockEscrowTx(
          program,
          publicKey,
          tradePda,
          counterpartyPubkey,
          USDT_MINT
        ),
        10000,
        'buildLockEscrowTx'
      );
      console.log('[depositToEscrow] Lock escrow tx built, instructions:', lockEscrowTx.instructions.length);

      // Combine both transactions
      const transaction = new Transaction();

      // Add all instructions from create trade
      for (const ix of createTradeTx.instructions) {
        transaction.add(ix);
      }

      // Add all instructions from lock escrow
      for (const ix of lockEscrowTx.instructions) {
        transaction.add(ix);
      }

      // Get recent blockhash
      console.log('[depositToEscrow] Getting blockhash...');
      const { blockhash, lastValidBlockHeight } = await withTimeout(
        connection.getLatestBlockhash('finalized'),
        10000,
        'getLatestBlockhash'
      );
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;
      console.log('[depositToEscrow] Blockhash:', blockhash);

      console.log('[depositToEscrow] Requesting wallet signature...');

      // Sign transaction - this opens the wallet popup
      const signedTx = await signTransaction(transaction);

      console.log('[depositToEscrow] Transaction signed, sending...');

      // Send transaction - skip preflight simulation to avoid stale blockhash errors
      // The blockhash may become stale while user is approving in wallet
      const txHash = await withTimeout(
        connection.sendRawTransaction(signedTx.serialize(), {
          skipPreflight: true, // Skip simulation to avoid blockhash expiry issues
          maxRetries: 5,
        }),
        30000,
        'sendRawTransaction'
      );

      console.log('[depositToEscrow] Transaction sent:', txHash);

      // Confirm transaction with longer timeout
      console.log('[depositToEscrow] Waiting for confirmation...');
      await withTimeout(
        connection.confirmTransaction({
          signature: txHash,
          blockhash,
          lastValidBlockHeight,
        }),
        90000, // 90 seconds for confirmation
        'confirmTransaction'
      );

      console.log('[depositToEscrow] Transaction confirmed!');

      // Refresh balances
      await refreshBalances();

      depositInProgressRef.current = false;
      return {
        txHash,
        success: true,
        tradePda: tradePda.toString(),
        escrowPda: escrowPda.toString(),
        tradeId,
      };
    } catch (error) {
      depositInProgressRef.current = false;
      console.error('Escrow deposit failed:', error);
      throw error;
    }
  }, [publicKey, signTransaction, connection, program, refreshBalances, ensureProtocolConfigInitialized]);

  const value: SolanaWalletContextType = {
    connected,
    connecting,
    publicKey,
    walletAddress,
    connect: openWalletModal,
    disconnect,
    openWalletModal,
    signMessage: signMessageFallback,
    solBalance,
    usdtBalance,
    refreshBalances,
    createCorridor,
    fundCorridor,
    withdrawCorridor,
    getCorridorInfo,
    createTrade,
    lockEscrow,
    releaseEscrow,
    refundEscrow,
    depositToEscrow,
    network: SOLANA_NETWORK,
    programReady: !!program,
    reinitializeProgram,
  };

  return (
    <SolanaWalletContext.Provider value={value}>
      {children}
    </SolanaWalletContext.Provider>
  );
};

// Main provider component
export const SolanaWalletProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [isClient, setIsClient] = useState(false);

  // RPC endpoint with fallback support - uses configured network
  const [endpoint, setEndpoint] = useState(() => getPrimaryEndpoint(SOLANA_NETWORK));

  // Check for healthier endpoint on mount and periodically
  useEffect(() => {
    let mounted = true;

    const checkEndpoint = async () => {
      try {
        const healthyEndpoint = await getHealthyEndpoint(SOLANA_NETWORK);
        if (mounted && healthyEndpoint !== endpoint) {
          console.log('[SolanaWallet] Switching to healthier RPC endpoint:', healthyEndpoint);
          setEndpoint(healthyEndpoint);
        }
      } catch (error) {
        console.warn('[SolanaWallet] Failed to check RPC health:', error);
      }
    };

    // Check after a short delay to not block initial render
    const initialCheck = setTimeout(checkEndpoint, 2000);

    // Re-check every 5 minutes
    const interval = setInterval(checkEndpoint, 5 * 60 * 1000);

    return () => {
      mounted = false;
      clearTimeout(initialCheck);
      clearInterval(interval);
    };
  }, [endpoint]);

  // Configure wallets - comprehensive support for all major wallets
  // Includes desktop extensions, mobile apps, hardware wallets, and WalletConnect
  const wallets = useMemo(() => {
    const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

    const walletList: Adapter[] = [
      // Primary wallets - most popular and reliable
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),

      // Hardware wallets
      new LedgerWalletAdapter(),
      new KeystoneWalletAdapter(),

      // Major exchange/app wallets
      new CoinbaseWalletAdapter(),
      new TrustWalletAdapter(),
      new BitgetWalletAdapter(),
      new ExodusWalletAdapter(),
      new SafePalWalletAdapter(),

      // Additional popular wallets
      new Coin98WalletAdapter(),
      new TokenPocketWalletAdapter(),
      new MathWalletAdapter(),
      new CloverWalletAdapter(),
      new BitpieWalletAdapter(),
      new SpotWalletAdapter(),
      new NightlyWalletAdapter(),
      new NufiWalletAdapter(),
      new OntoWalletAdapter(),
      new SalmonWalletAdapter(),
      new AvanaWalletAdapter(),
      new XDEFIWalletAdapter(),
      new KrystalWalletAdapter(),

      // Web-based wallets
      new TorusWalletAdapter(),
      new SlopeWalletAdapter(),
      new HuobiWalletAdapter(),
      new SaifuWalletAdapter(),
      new TokenaryWalletAdapter(),
      new NekoWalletAdapter(),
      new SkyWalletAdapter(),
    ];

    // Add WalletConnect for maximum mobile and cross-platform support
    // This enables connections from ANY WalletConnect-compatible wallet
    if (walletConnectProjectId) {
      walletList.push(
        new WalletConnectWalletAdapter({
          network: SOLANA_NETWORK as any,
          options: {
            projectId: walletConnectProjectId,
            // Metadata for WalletConnect modal
            metadata: {
              name: 'Blip Money',
              description: 'Secure P2P crypto payments with escrow protection',
              url: process.env.NEXT_PUBLIC_APP_URL || 'https://blip.money',
              icons: [`${process.env.NEXT_PUBLIC_APP_URL || 'https://blip.money'}/logo.png`],
            },
          },
        })
      );
      console.log('[SolanaWallet] WalletConnect adapter enabled for', SOLANA_NETWORK);
    } else {
      console.warn('[SolanaWallet] WalletConnect disabled - set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID for mobile support');
    }

    // Add Particle adapter for social login support (if configured)
    const particleProjectId = process.env.NEXT_PUBLIC_PARTICLE_PROJECT_ID;
    const particleClientKey = process.env.NEXT_PUBLIC_PARTICLE_CLIENT_KEY;
    const particleAppId = process.env.NEXT_PUBLIC_PARTICLE_APP_ID;
    if (particleProjectId && particleClientKey && particleAppId) {
      try {
        walletList.push(new ParticleAdapter());
        console.log('[SolanaWallet] Particle social login enabled');
      } catch (e) {
        console.warn('[SolanaWallet] Failed to initialize Particle adapter:', e);
      }
    }

    console.log(`[SolanaWallet] Initialized ${walletList.length} wallet adapters on ${SOLANA_NETWORK}`);
    return walletList;
  }, []);

  // Handle wallet errors gracefully - suppress auto-connect and connection errors
  const onError = useCallback((error: Error) => {
    // Silently ignore ALL wallet connection errors - they don't affect manual connection
    const errorMessage = error?.message || '';
    const errorName = error?.name || '';

    // Suppress common wallet errors
    const suppressedErrors = [
      'WalletConnectionError',
      'WalletNotReadyError',
      'WalletDisconnectedError',
      'Unexpected error',
      'User rejected',
      'Connection closed',
      'The wallet adapter is not ready',
    ];

    const shouldSuppress = suppressedErrors.some(
      e => errorName.includes(e) || errorMessage.includes(e)
    );

    if (shouldSuppress) {
      // Silent - don't even log in development to reduce noise
      return;
    }

    console.error('Wallet error:', error);
  }, []);

  // Clear stale wallet state and set client flag
  useEffect(() => {
    setIsClient(true);

    // Clear ALL wallet-related localStorage to prevent stale connections
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('walletName');
        localStorage.removeItem('walletAdapter');
        // Clear any standard wallet cache
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.includes('wallet') || key.includes('solana'))) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
      } catch {
        // Ignore localStorage errors
      }
    }
  }, []);

  // Don't render wallet provider until client-side
  if (!isClient) {
    return <>{children}</>;
  }

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect={false} onError={onError}>
        <WalletModalProvider>
          <SolanaWalletContextProvider>
            {children}
          </SolanaWalletContextProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};

// Hook to use wallet context
export function useSolanaWallet() {
  const context = useContext(SolanaWalletContext);
  if (!context) {
    throw new Error('useSolanaWallet must be used within SolanaWalletProvider');
  }
  return context;
}

// Export the USDT mint for use elsewhere
export { USDT_MINT };
