/**
 * Solana Wallet Module for Telegram Bot
 * Server-side keypair management with AES-256-GCM encryption.
 * Handles: create/import/export wallet, fund escrow, release escrow, refund escrow, balance checks.
 */

const { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram } = require('@solana/web3.js');
const { BN } = require('@coral-xyz/anchor');
const {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} = require('@solana/spl-token');
const crypto = require('crypto');
const bs58 = require('bs58');
const fs = require('fs');
const path = require('path');

// ── Config ───────────────────────────────────────────────────────────
const PROGRAM_ID = new PublicKey('6AG4ccUtM1YPcVmkMrMTuhjEtY8E7p5qwT4nud6mea87');
const USDT_MINT = new PublicKey('FT8zRmLcsbNvqjCMSiwQC5GdkZfGtsoj8r5k19H65X9Z');
const TREASURY = new PublicKey('8G55Mg2QmeR5LTz1Ckp8fH2cYh4H3HpLHz2VmFMFKvtB');
const DEVNET_RPC = process.env.SOLANA_RPC || 'https://api.devnet.solana.com';

// Anchor instruction discriminators (sha256("global:<snake_name>")[0..8])
const DISC = {
  createTrade:   Buffer.from([183,82,24,245,248,30,204,246]),
  fundEscrow:    Buffer.from([155,18,218,141,182,213,69,201]),
  acceptTrade:   Buffer.from([139,218,29,95,124,75,64,116]),
  releaseEscrow: Buffer.from([146,253,129,233,20,145,181,206]),
  refundEscrow:  Buffer.from([107,186,89,99,26,194,23,204]),
};

const PBKDF2_ITERATIONS = 100_000;
const WALLETS_FILE = path.join(__dirname, 'wallets.json');

// ── Singleton connection ─────────────────────────────────────────────
let _connection = null;
function getConnection() {
  if (!_connection) {
    _connection = new Connection(DEVNET_RPC, 'confirmed');
  }
  return _connection;
}

// ── PDA Derivation ───────────────────────────────────────────────────
function findTradePda(creator, tradeId) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('trade-v2'), creator.toBuffer(), new BN(tradeId).toArrayLike(Buffer, 'le', 8)],
    PROGRAM_ID
  );
}

function findEscrowPda(trade) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('escrow-v2'), trade.toBuffer()],
    PROGRAM_ID
  );
}

function findVaultAuthorityPda(escrow) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault-authority-v2'), escrow.toBuffer()],
    PROGRAM_ID
  );
}

function findProtocolConfigPda() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('protocol-config')],
    PROGRAM_ID
  );
}

// ── Raw Instruction Builder ──────────────────────────────────────────
// Builds TransactionInstruction directly (no Anchor program.methods)
// to avoid Anchor 0.29/0.30 IDL format incompatibility.
function buildInstruction(discriminator, args, accounts) {
  const data = Buffer.concat([discriminator, ...(args || [])]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: accounts,
    data,
  });
}

// ── Encryption (Node.js crypto, compatible with browser Web Crypto) ──
function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256');
}

function encryptSecretKey(secretKey, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secretKey), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encryptedKey: Buffer.concat([encrypted, authTag]).toString('base64'),
    iv: iv.toString('base64'),
    salt: salt.toString('base64'),
  };
}

function decryptSecretKey(encryptedData, password) {
  const salt = Buffer.from(encryptedData.salt, 'base64');
  const iv = Buffer.from(encryptedData.iv, 'base64');
  const data = Buffer.from(encryptedData.encryptedKey, 'base64');
  const key = deriveKey(password, salt);
  // Last 16 bytes are the auth tag
  const authTag = data.subarray(data.length - 16);
  const ciphertext = data.subarray(0, data.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return new Uint8Array(decrypted);
}

// ── Wallet Storage ───────────────────────────────────────────────────
// Maps merchantId -> { publicKey, encryptedKey, iv, salt }
let _walletStore = {};

function loadWallets() {
  try {
    if (fs.existsSync(WALLETS_FILE)) {
      _walletStore = JSON.parse(fs.readFileSync(WALLETS_FILE, 'utf8'));
      console.log(`[Wallet] Loaded ${Object.keys(_walletStore).length} encrypted wallets`);
    }
  } catch (e) {
    console.error('[Wallet] Failed to load wallets:', e.message);
  }
}

function saveWallets() {
  try {
    fs.writeFileSync(WALLETS_FILE, JSON.stringify(_walletStore, null, 2));
  } catch (e) {
    console.error('[Wallet] Failed to save wallets:', e.message);
  }
}

loadWallets();

// ── In-memory keypair cache (unlocked wallets) ───────────────────────
// Maps merchantId -> Keypair (cleared on bot restart)
const _keypairCache = new Map();

// ── Wallet Management ────────────────────────────────────────────────

/**
 * Generate a new wallet for a merchant
 * @returns {{ publicKey: string, keypair: Keypair }}
 */
function generateWallet(merchantId, password) {
  const keypair = Keypair.generate();
  const encrypted = encryptSecretKey(keypair.secretKey, password);
  _walletStore[merchantId] = {
    publicKey: keypair.publicKey.toBase58(),
    ...encrypted,
  };
  saveWallets();
  _keypairCache.set(merchantId, keypair);
  console.log(`[Wallet] Generated new wallet for merchant ${merchantId}: ${keypair.publicKey.toBase58()}`);
  return { publicKey: keypair.publicKey.toBase58(), keypair };
}

/**
 * Import a wallet from base58 private key
 */
function importWallet(merchantId, base58PrivateKey, password) {
  const secretKey = bs58.decode(base58PrivateKey);
  const keypair = Keypair.fromSecretKey(secretKey);
  const encrypted = encryptSecretKey(keypair.secretKey, password);
  _walletStore[merchantId] = {
    publicKey: keypair.publicKey.toBase58(),
    ...encrypted,
  };
  saveWallets();
  _keypairCache.set(merchantId, keypair);
  console.log(`[Wallet] Imported wallet for merchant ${merchantId}: ${keypair.publicKey.toBase58()}`);
  return { publicKey: keypair.publicKey.toBase58(), keypair };
}

/**
 * Unlock wallet (decrypt and cache keypair)
 */
function unlockWallet(merchantId, password) {
  const stored = _walletStore[merchantId];
  if (!stored) throw new Error('No wallet found. Use /wallet to create one.');
  try {
    const secretKey = decryptSecretKey(stored, password);
    const keypair = Keypair.fromSecretKey(secretKey);
    _keypairCache.set(merchantId, keypair);
    return keypair;
  } catch (e) {
    throw new Error('Wrong password.');
  }
}

/**
 * Get cached keypair (must be unlocked first)
 */
function getKeypair(merchantId) {
  return _keypairCache.get(merchantId) || null;
}

/**
 * Check if merchant has a wallet
 */
function hasWallet(merchantId) {
  return !!_walletStore[merchantId];
}

/**
 * Get stored public key
 */
function getPublicKey(merchantId) {
  return _walletStore[merchantId]?.publicKey || null;
}

/**
 * Export private key as base58
 */
function exportPrivateKey(merchantId) {
  const keypair = getKeypair(merchantId);
  if (!keypair) throw new Error('Wallet not unlocked.');
  return bs58.encode(keypair.secretKey);
}

/**
 * Lock wallet (remove from cache)
 */
function lockWallet(merchantId) {
  _keypairCache.delete(merchantId);
}

// ── Sign & Send helper ───────────────────────────────────────────────
async function signAndSend(keypair, transaction) {
  const connection = getConnection();
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = keypair.publicKey;
  transaction.sign(keypair);

  const txHash = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });

  await connection.confirmTransaction({
    signature: txHash,
    blockhash,
    lastValidBlockHeight,
  }, 'confirmed');

  return txHash;
}

// ── Balance ──────────────────────────────────────────────────────────
async function getUsdtBalance(publicKeyStr) {
  const connection = getConnection();
  const owner = new PublicKey(publicKeyStr);
  try {
    const ata = await getAssociatedTokenAddress(USDT_MINT, owner);
    const account = await getAccount(connection, ata);
    return Number(account.amount) / 1_000_000; // 6 decimals
  } catch {
    return 0;
  }
}

async function getSolBalance(publicKeyStr) {
  const connection = getConnection();
  const balance = await connection.getBalance(new PublicKey(publicKeyStr));
  return balance / 1_000_000_000; // 9 decimals
}

// ── Escrow Operations ────────────────────────────────────────────────

/**
 * Fund escrow: createTrade + fundEscrow in one tx
 * Called when seller locks crypto into escrow.
 */
async function fundEscrow(merchantId, amount) {
  const keypair = getKeypair(merchantId);
  if (!keypair) throw new Error('Wallet not unlocked. Use /unlock first.');

  const tradeId = Date.now();
  const amountLamports = Math.floor(amount * 1_000_000);
  const [tradePda] = findTradePda(keypair.publicKey, tradeId);
  const [escrowPda] = findEscrowPda(tradePda);
  const [vaultAuthority] = findVaultAuthorityPda(escrowPda);
  const [protocolConfigPda] = findProtocolConfigPda();
  const vaultAta = await getAssociatedTokenAddress(USDT_MINT, vaultAuthority, true);
  const depositorAta = await getAssociatedTokenAddress(USDT_MINT, keypair.publicKey);

  const transaction = new Transaction();

  // 1. createTrade: args = tradeId(u64) + amount(u64) + side(enum: 1=sell)
  const tradeIdBuf = new BN(tradeId).toArrayLike(Buffer, 'le', 8);
  const amountBuf = new BN(amountLamports).toArrayLike(Buffer, 'le', 8);
  const sideBuf = Buffer.from([1]); // 0=buy, 1=sell
  transaction.add(buildInstruction(DISC.createTrade, [tradeIdBuf, amountBuf, sideBuf], [
    { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
    { pubkey: protocolConfigPda, isSigner: false, isWritable: false },
    { pubkey: tradePda, isSigner: false, isWritable: true },
    { pubkey: USDT_MINT, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ]));

  // 2. fundEscrow: no args
  transaction.add(buildInstruction(DISC.fundEscrow, [], [
    { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
    { pubkey: tradePda, isSigner: false, isWritable: true },
    { pubkey: escrowPda, isSigner: false, isWritable: true },
    { pubkey: vaultAuthority, isSigner: false, isWritable: false },
    { pubkey: vaultAta, isSigner: false, isWritable: true },
    { pubkey: depositorAta, isSigner: false, isWritable: true },
    { pubkey: USDT_MINT, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ]));

  const txHash = await signAndSend(keypair, transaction);

  return {
    success: true,
    txHash,
    tradeId,
    tradePda: tradePda.toBase58(),
    escrowPda: escrowPda.toBase58(),
    creatorWallet: keypair.publicKey.toBase58(),
  };
}

/**
 * Release escrow: transfer from vault to counterparty
 * Called when seller confirms fiat received and releases crypto.
 */
async function releaseEscrowOnChain(merchantId, creatorPubkeyStr, tradeId, counterpartyStr) {
  const keypair = getKeypair(merchantId);
  if (!keypair) throw new Error('Wallet not unlocked. Use /unlock first.');

  const connection = getConnection();
  const creatorPk = new PublicKey(creatorPubkeyStr);
  const counterpartyPk = new PublicKey(counterpartyStr);
  const [tradePda] = findTradePda(creatorPk, tradeId);
  const [escrowPda] = findEscrowPda(tradePda);
  const [vaultAuthority] = findVaultAuthorityPda(escrowPda);
  const [protocolConfigPda] = findProtocolConfigPda();
  const vaultAta = await getAssociatedTokenAddress(USDT_MINT, vaultAuthority, true);
  const counterpartyAta = await getAssociatedTokenAddress(USDT_MINT, counterpartyPk);
  const treasuryAta = await getAssociatedTokenAddress(USDT_MINT, TREASURY);

  const transaction = new Transaction();

  // Ensure counterparty ATA exists
  try {
    await getAccount(connection, counterpartyAta);
  } catch {
    transaction.add(
      createAssociatedTokenAccountInstruction(keypair.publicKey, counterpartyAta, counterpartyPk, USDT_MINT)
    );
  }

  // Ensure treasury ATA exists
  try {
    await getAccount(connection, treasuryAta);
  } catch {
    transaction.add(
      createAssociatedTokenAccountInstruction(keypair.publicKey, treasuryAta, TREASURY, USDT_MINT)
    );
  }

  // releaseEscrow: no args
  transaction.add(buildInstruction(DISC.releaseEscrow, [], [
    { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
    { pubkey: protocolConfigPda, isSigner: false, isWritable: false },
    { pubkey: tradePda, isSigner: false, isWritable: true },
    { pubkey: escrowPda, isSigner: false, isWritable: true },
    { pubkey: vaultAuthority, isSigner: false, isWritable: false },
    { pubkey: vaultAta, isSigner: false, isWritable: true },
    { pubkey: counterpartyAta, isSigner: false, isWritable: true },
    { pubkey: treasuryAta, isSigner: false, isWritable: true },
    { pubkey: creatorPk, isSigner: false, isWritable: true },
    { pubkey: USDT_MINT, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ]));

  const txHash = await signAndSend(keypair, transaction);

  return {
    success: true,
    txHash,
    tradePda: tradePda.toBase58(),
    escrowPda: escrowPda.toBase58(),
  };
}

/**
 * Refund escrow: return funds to depositor
 * Called when order is cancelled/expired.
 */
async function refundEscrowOnChain(merchantId, creatorPubkeyStr, tradeId) {
  const keypair = getKeypair(merchantId);
  if (!keypair) throw new Error('Wallet not unlocked. Use /unlock first.');

  const connection = getConnection();
  const creatorPk = new PublicKey(creatorPubkeyStr);
  const [tradePda] = findTradePda(creatorPk, tradeId);
  const [escrowPda] = findEscrowPda(tradePda);
  const [vaultAuthority] = findVaultAuthorityPda(escrowPda);
  const vaultAta = await getAssociatedTokenAddress(USDT_MINT, vaultAuthority, true);

  // Read escrow account raw data to get depositor (offset 40: 8 disc + 32 trade = depositor at 40)
  const escrowInfo = await connection.getAccountInfo(escrowPda);
  if (!escrowInfo) throw new Error('Escrow account not found on-chain');
  const depositor = new PublicKey(escrowInfo.data.slice(40, 72));
  const depositorAta = await getAssociatedTokenAddress(USDT_MINT, depositor);

  // refundEscrow: no args
  const transaction = new Transaction();
  transaction.add(buildInstruction(DISC.refundEscrow, [], [
    { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
    { pubkey: tradePda, isSigner: false, isWritable: true },
    { pubkey: escrowPda, isSigner: false, isWritable: true },
    { pubkey: vaultAuthority, isSigner: false, isWritable: false },
    { pubkey: vaultAta, isSigner: false, isWritable: true },
    { pubkey: depositorAta, isSigner: false, isWritable: true },
    { pubkey: creatorPk, isSigner: false, isWritable: true },
    { pubkey: USDT_MINT, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ]));

  const txHash = await signAndSend(keypair, transaction);

  return {
    success: true,
    txHash,
    tradePda: tradePda.toBase58(),
    escrowPda: escrowPda.toBase58(),
  };
}

/**
 * Accept trade: set counterparty on-chain (buyer joins a funded escrow)
 * Must be called before releaseEscrow for pre-locked SELL orders.
 */
async function acceptTradeOnChain(merchantId, creatorPubkeyStr, tradeId) {
  const keypair = getKeypair(merchantId);
  if (!keypair) throw new Error('Wallet not unlocked. Use /unlock first.');

  const creatorPk = new PublicKey(creatorPubkeyStr);
  const [tradePda] = findTradePda(creatorPk, tradeId);
  const [escrowPda] = findEscrowPda(tradePda);

  // acceptTrade: no args
  const transaction = new Transaction();
  transaction.add(buildInstruction(DISC.acceptTrade, [], [
    { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
    { pubkey: tradePda, isSigner: false, isWritable: true },
    { pubkey: escrowPda, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ]));

  const txHash = await signAndSend(keypair, transaction);

  return {
    success: true,
    txHash,
    tradePda: tradePda.toBase58(),
    escrowPda: escrowPda.toBase58(),
  };
}

// ── Exports ──────────────────────────────────────────────────────────
module.exports = {
  // Wallet management
  generateWallet,
  importWallet,
  unlockWallet,
  getKeypair,
  hasWallet,
  getPublicKey,
  exportPrivateKey,
  lockWallet,
  // Balance
  getUsdtBalance,
  getSolBalance,
  // Escrow operations
  fundEscrow,
  acceptTradeOnChain,
  releaseEscrowOnChain,
  refundEscrowOnChain,
  // Helpers
  getConnection,
  USDT_MINT,
  PROGRAM_ID,
};
