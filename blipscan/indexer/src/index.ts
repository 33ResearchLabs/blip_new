/**
 * BlipScan Indexer
 * Reads Solana escrow program transactions and indexes them to PostgreSQL
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { BorshAccountsCoder } from '@coral-xyz/anchor';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { initErrorTracking, safeLog } from './errorTracking';

dotenv.config();

// Load IDLs
const v1IdlPath = './blip_escrow_idl.json';
const v2IdlPath = './blip_protocol_v2_idl.json';
const V1_IDL = JSON.parse(fs.readFileSync(v1IdlPath, 'utf-8'));
const V2_IDL = JSON.parse(fs.readFileSync(v2IdlPath, 'utf-8'));

// ============================================
// CONFIGURATION
// ============================================

const V1_PROGRAM_ID = new PublicKey('HZ9ZSXtebTKYGRR7ZNsetroAT7Kh8ymKExcf5FF9dLNq');
const V2_PROGRAM_ID = new PublicKey('6AG4ccUtM1YPcVmkMrMTuhjEtY8E7p5qwT4nud6mea87');
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const POLL_INTERVAL = 15000; // 15 seconds for forward polling (new txs)
const BACKFILL_INTERVAL = 60000; // 60 seconds for backfill (historical txs)

// PostgreSQL connection - prefer DATABASE_URL if available
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'blipscan',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
    });

// ============================================
// TYPES
// ============================================

interface EscrowAccount {
  version: number;
  dealId: Buffer;
  maker: PublicKey;
  taker: PublicKey;
  arbiter: PublicKey;
  treasury: PublicKey;
  mint: PublicKey;
  amount: bigint;
  feeBps: number;
  status: { funded?: {}; locked?: {}; released?: {}; refunded?: {} };
  escrowBump: number;
  signerBump: number;
}

interface Trade {
  escrowAddress: string;
  dealId: string;
  signature: string;
  merchantPubkey: string;
  buyerPubkey: string | null;
  arbiterPubkey: string;
  treasuryPubkey: string;
  mintAddress: string;
  amount: string;
  feeBps: number;
  status: 'funded' | 'locked' | 'released' | 'refunded';
  createdSlot: number;
  createdAt: Date;
  lockedSlot: number | null;
  lockedAt: Date | null;
  releasedSlot: number | null;
  releasedAt: Date | null;
}

// ============================================
// INDEXER CLASS
// ============================================

class BlipScanIndexer {
  private connection: Connection;
  // Backfill cursors (going backwards in time)
  private v1BackfillSignature: string | null = null;
  private v1BackfillSlot: number = 0;
  private v2BackfillSignature: string | null = null;
  private v2BackfillSlot: number = 0;
  // Forward cursors (newest seen, for catching new txs)
  private v1NewestSignature: string | null = null;
  private v2NewestSignature: string | null = null;
  private v1BackfillDone: boolean = true;  // Skip backfill — only index new transactions
  private v2BackfillDone: boolean = true;  // Skip backfill — only index new transactions
  private v1Coder: BorshAccountsCoder;
  private v2Coder: BorshAccountsCoder | null = null;

  constructor() {
    this.connection = new Connection(RPC_URL, 'confirmed');
    this.v1Coder = new BorshAccountsCoder(V1_IDL);

    // Try to create V2 coder, but don't fail if it doesn't work
    try {
      this.v2Coder = new BorshAccountsCoder(V2_IDL);
    } catch (error) {
      console.warn('⚠️ Could not initialize V2 coder, will use manual parsing:', error);
      this.v2Coder = null;
    }
  }

  async start() {
    console.log('🚀 BlipScan Indexer Starting...');
    console.log(`📡 RPC: ${RPC_URL}`);
    console.log(`🔗 V1 Program: ${V1_PROGRAM_ID.toString()}`);
    console.log(`🔗 V2 Program: ${V2_PROGRAM_ID.toString()}`);

    // Wire up error tracking — reuses the indexer's existing pg pool so we
    // don't open a second connection. When ENABLE_ERROR_TRACKING is off,
    // every logging call is a no-op with zero cost.
    initErrorTracking(pool);

    // Process-level safety nets — catch anything that escapes all the
    // per-tick try/catch blocks.
    if (!(globalThis as any).__blipscanIndexerGlobalsInstalled) {
      (globalThis as any).__blipscanIndexerGlobalsInstalled = true;
      process.on('unhandledRejection', (reason) => {
        const e = reason as { message?: string; stack?: string; name?: string };
        safeLog({
          type: 'process.unhandled_rejection',
          severity: 'ERROR',
          message: `[blipscan-indexer] Unhandled rejection: ${e?.message || String(reason)}`,
          metadata: {
            service: 'blipscan-indexer',
            errorName: e?.name,
            stack: e?.stack?.slice(0, 4000),
          },
        });
      });
      process.on('uncaughtException', (err) => {
        safeLog({
          type: 'process.uncaught_exception',
          severity: 'CRITICAL',
          message: `[blipscan-indexer] Uncaught exception: ${err.message}`,
          metadata: {
            service: 'blipscan-indexer',
            errorName: err.name,
            stack: err.stack?.slice(0, 4000),
          },
        });
      });
    }

    // Load cursors
    await this.loadCursors();

    // One-time repair: backfill missing counterparties from on-chain
    await this.repairMissingCounterparties();

    // Start forward polling (new txs, every 15s) and backfill (old txs, every 60s)
    this.poll();
    this.backfill();
  }

  private async repairMissingCounterparties() {
    console.log('🔧 Checking for trades with missing counterparties...');

    // V2 trades with null counterparty but status locked/released
    const v2Rows = await pool.query(
      `SELECT trade_pda FROM v2_trades WHERE counterparty_pubkey IS NULL AND status IN ('locked', 'released', 'refunded')`
    );
    for (const row of v2Rows.rows) {
      try {
        const accountInfo = await this.connection.getAccountInfo(new PublicKey(row.trade_pda));
        if (!accountInfo) continue;
        let trade;
        if (this.v2Coder) {
          try { trade = this.v2Coder.decode('Trade', accountInfo.data); } catch { trade = this.parseV2TradeAccount(accountInfo.data); }
        } else {
          trade = this.parseV2TradeAccount(accountInfo.data);
        }
        if (trade && trade.counterparty.toString() !== PublicKey.default.toString()) {
          await pool.query('UPDATE v2_trades SET counterparty_pubkey = $1, updated_at = NOW() WHERE trade_pda = $2', [trade.counterparty.toString(), row.trade_pda]);
          console.log(`  🔧 Fixed V2 counterparty for ${row.trade_pda.slice(0, 8)}... → ${trade.counterparty.toString().slice(0, 8)}...`);
        }
      } catch (err) {
        console.error(`  ⚠️ Could not repair ${row.trade_pda}:`, err);
      }
    }

    // V1 trades with null user but status Locked/Released
    const v1Rows = await pool.query(
      `SELECT trade_pda FROM trades WHERE "user" IS NULL AND state IN ('Locked', 'Released', 'Refunded')`
    );
    for (const row of v1Rows.rows) {
      try {
        const accountInfo = await this.connection.getAccountInfo(new PublicKey(row.trade_pda));
        if (!accountInfo) continue;
        const escrow = await this.parseEscrowAccount(accountInfo.data);
        if (escrow.taker && escrow.taker !== PublicKey.default.toString()) {
          await pool.query('UPDATE trades SET "user" = $1, updated_at = NOW() WHERE trade_pda = $2', [escrow.taker, row.trade_pda]);
          console.log(`  🔧 Fixed V1 taker for ${row.trade_pda.slice(0, 8)}... → ${escrow.taker.slice(0, 8)}...`);
        }
      } catch (err) {
        console.error(`  ⚠️ Could not repair ${row.trade_pda}:`, err);
      }
    }

    const total = v2Rows.rows.length + v1Rows.rows.length;
    if (total === 0) {
      console.log('  ✅ No missing counterparties found');
    } else {
      console.log(`  ✅ Repair check complete (${total} trades checked)`);
    }
  }

  private async loadCursors() {
    // Load V1 backfill cursor
    const v1Result = await pool.query(
      'SELECT last_processed_signature, last_processed_slot FROM indexer_cursor WHERE program_id = $1',
      [V1_PROGRAM_ID.toString()]
    );

    if (v1Result.rows.length > 0) {
      this.v1BackfillSignature = v1Result.rows[0].last_processed_signature;
      this.v1BackfillSlot = v1Result.rows[0].last_processed_slot || 0;
      console.log(`📍 V1 backfill cursor at slot ${this.v1BackfillSlot}`);
    } else {
      await pool.query(
        'INSERT INTO indexer_cursor (program_id, last_processed_slot) VALUES ($1, 0) ON CONFLICT DO NOTHING',
        [V1_PROGRAM_ID.toString()]
      );
    }

    // Load V2 backfill cursor
    const v2Result = await pool.query(
      'SELECT last_processed_signature, last_processed_slot FROM indexer_cursor WHERE program_id = $1',
      [V2_PROGRAM_ID.toString()]
    );

    if (v2Result.rows.length > 0) {
      this.v2BackfillSignature = v2Result.rows[0].last_processed_signature;
      this.v2BackfillSlot = v2Result.rows[0].last_processed_slot || 0;
      console.log(`📍 V2 backfill cursor at slot ${this.v2BackfillSlot}`);
    } else {
      await pool.query(
        'INSERT INTO indexer_cursor (program_id, last_processed_slot) VALUES ($1, 0) ON CONFLICT DO NOTHING',
        [V2_PROGRAM_ID.toString()]
      );
    }

    // Load newest signatures from DB (most recent tx we've seen per program)
    const v1Newest = await pool.query(
      `SELECT signature FROM transactions WHERE program_id = $1 ORDER BY block_time DESC LIMIT 1`,
      [V1_PROGRAM_ID.toString()]
    );
    if (v1Newest.rows.length > 0) {
      this.v1NewestSignature = v1Newest.rows[0].signature;
      console.log(`📍 V1 newest sig: ${this.v1NewestSignature?.slice(0, 8)}...`);
    }

    const v2Newest = await pool.query(
      `SELECT signature FROM transactions WHERE program_id = $1 ORDER BY block_time DESC LIMIT 1`,
      [V2_PROGRAM_ID.toString()]
    );
    if (v2Newest.rows.length > 0) {
      this.v2NewestSignature = v2Newest.rows[0].signature;
      console.log(`📍 V2 newest sig: ${this.v2NewestSignature?.slice(0, 8)}...`);
    }
  }

  private async poll() {
    // Forward poll: catch NEW transactions (runs every 15s)
    try {
      await Promise.all([
        this.fetchNewTransactions(V1_PROGRAM_ID, 'v1'),
        this.fetchNewTransactions(V2_PROGRAM_ID, 'v2.2'),
      ]);
    } catch (error) {
      console.error('❌ Error forward polling:', error);
      const e = error as { message?: string; stack?: string; name?: string };
      safeLog({
        type: 'blipscan.forward_poll_failed',
        severity: 'ERROR',
        message: `Blipscan forward poll failed: ${e?.message || String(error)}`,
        metadata: { service: 'blipscan-indexer', stack: e?.stack?.slice(0, 4000) },
      });
    }

    setTimeout(() => this.poll(), POLL_INTERVAL);
  }

  private async backfill() {
    // Backfill: catch OLDER transactions we haven't seen yet
    try {
      if (!this.v1BackfillDone) await this.fetchOlderTransactions(V1_PROGRAM_ID, 'v1');
      if (!this.v2BackfillDone) await this.fetchOlderTransactions(V2_PROGRAM_ID, 'v2.2');
    } catch (error) {
      console.error('❌ Error backfilling:', error);
      const e = error as { message?: string; stack?: string; name?: string };
      safeLog({
        type: 'blipscan.backfill_failed',
        severity: 'ERROR',
        message: `Blipscan backfill failed: ${e?.message || String(error)}`,
        metadata: { service: 'blipscan-indexer', stack: e?.stack?.slice(0, 4000) },
      });
    }

    if (!this.v1BackfillDone || !this.v2BackfillDone) {
      setTimeout(() => this.backfill(), BACKFILL_INTERVAL);
    } else {
      console.log('✅ Backfill complete for all programs');
    }
  }

  // Forward: get transactions NEWER than our newest known signature
  private async fetchNewTransactions(programId: PublicKey, version: string) {
    const isV1 = version === 'v1';
    const newestSig = isV1 ? this.v1NewestSignature : this.v2NewestSignature;

    const signatures = await this.connection.getSignaturesForAddress(
      programId,
      {
        limit: 50,
        ...(newestSig ? { until: newestSig } : {}),
      }
    );

    if (signatures.length === 0) return;

    console.log(`📥 [${version}] ${signatures.length} new transactions`);

    // signatures come newest-first, process oldest-first
    for (const sig of [...signatures].reverse()) {
      try {
        await this.processTransaction(sig.signature, sig.slot, sig.blockTime || null, programId, version);
      } catch (error) {
        console.error(`[${version}] Error processing ${sig.signature}:`, error);
      }
    }

    // Update newest cursor (signatures[0] is the most recent)
    const newest = signatures[0];
    if (isV1) {
      this.v1NewestSignature = newest.signature;
    } else {
      this.v2NewestSignature = newest.signature;
    }

    // Also set backfill cursor if we don't have one yet
    if (!isV1 && !this.v2BackfillSignature) {
      const oldest = signatures[signatures.length - 1];
      this.v2BackfillSignature = oldest.signature;
      this.v2BackfillSlot = oldest.slot;
    }
    if (isV1 && !this.v1BackfillSignature) {
      const oldest = signatures[signatures.length - 1];
      this.v1BackfillSignature = oldest.signature;
      this.v1BackfillSlot = oldest.slot;
    }
  }

  // Backward: get transactions OLDER than our backfill cursor
  private async fetchOlderTransactions(programId: PublicKey, version: string) {
    const isV1 = version === 'v1';
    const backfillSig = isV1 ? this.v1BackfillSignature : this.v2BackfillSignature;

    const signatures = await this.connection.getSignaturesForAddress(
      programId,
      {
        limit: 50,
        before: backfillSig || undefined,
      }
    );

    if (signatures.length === 0) {
      if (isV1) this.v1BackfillDone = true;
      else this.v2BackfillDone = true;
      console.log(`✅ [${version}] Backfill complete`);
      return;
    }

    console.log(`📥 [${version}] Backfilling ${signatures.length} older transactions`);

    // Process oldest-first
    for (const sig of signatures.reverse()) {
      try {
        await this.processTransaction(sig.signature, sig.slot, sig.blockTime || null, programId, version);
      } catch (error) {
        console.error(`[${version}] Error processing ${sig.signature}:`, error);
      }
    }

    // Update backfill cursor (after reverse, signatures[0] is oldest = deepest reached)
    const oldest = signatures[0];
    if (isV1) {
      this.v1BackfillSignature = oldest.signature;
      this.v1BackfillSlot = oldest.slot;
    } else {
      this.v2BackfillSignature = oldest.signature;
      this.v2BackfillSlot = oldest.slot;
    }

    await pool.query(
      'UPDATE indexer_cursor SET last_processed_signature = $1, last_processed_slot = $2, last_indexed_at = NOW() WHERE program_id = $3',
      [oldest.signature, oldest.slot, programId.toString()]
    );
  }

  private async processTransaction(signature: string, slot: number, blockTime: number | null, programId: PublicKey, version: string) {
    const tx = await this.connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });

    if (!tx || !tx.meta) {
      return;
    }

    const logs = tx.meta.logMessages || [];
    const timestamp = blockTime ? new Date(blockTime * 1000) : new Date();

    // Detect instruction type from logs
    const instructionType = this.detectInstructionType(logs, version);

    if (!instructionType) {
      return;
    }

    console.log(`  📝 [${version}] ${instructionType.toUpperCase()} - ${signature.slice(0, 8)}...`);

    let tradePda: string | null = null;

    if (version === 'v1') {
      // V1: Extract escrow address
      const escrowAddress = await this.extractEscrowAddress(tx, programId);
      if (!escrowAddress) return;
      tradePda = escrowAddress;

      switch (instructionType) {
        case 'create_escrow':
          await this.handleCreateEscrow(signature, escrowAddress, slot, timestamp, version);
          break;
        case 'lock_for_taker':
          await this.handleLockForTaker(signature, escrowAddress, slot, timestamp);
          break;
        case 'release_to_taker':
          await this.handleReleaseToTaker(signature, escrowAddress, slot, timestamp);
          break;
        case 'refund_to_maker':
          await this.handleRefundToMaker(signature, escrowAddress, slot, timestamp);
          break;
      }
    } else {
      // V2: Handle lane operations (don't need trade address)
      if (instructionType === 'create_lane' || instructionType === 'fund_lane' || instructionType === 'withdraw_lane') {
        await this.handleV2LaneOperation(signature, slot, timestamp, instructionType, tx);
        // Record lane tx too
        await this.recordTransaction(programId.toString(), version, signature, instructionType, null, slot, timestamp);
        return;
      }

      // V2: Extract trade address for trade operations
      const tradeAddress = await this.extractV2TradeAddress(tx, programId);
      tradePda = tradeAddress;

      switch (instructionType) {
        case 'create_trade':
          if (tradeAddress) await this.handleV2CreateTrade(signature, tradeAddress, slot, timestamp, version, tx);
          break;
        case 'lock_escrow':
          if (tradeAddress) await this.handleV2LockEscrow(signature, tradeAddress, slot, timestamp, tx);
          break;
        case 'release_escrow':
          if (tradeAddress) await this.handleV2ReleaseEscrow(signature, tradeAddress, slot, timestamp);
          break;
        case 'refund_escrow':
          if (tradeAddress) await this.handleV2RefundEscrow(signature, tradeAddress, slot, timestamp);
          break;
        case 'match_offer':
        case 'match_offer_lane':
          if (tradeAddress) await this.handleV2MatchOffer(signature, tradeAddress, slot, timestamp, version, tx, instructionType);
          break;
      }
    }

    // Record every transaction in the unified feed
    await this.recordTransaction(programId.toString(), version, signature, instructionType, tradePda, slot, timestamp);
  }

  private async recordTransaction(programId: string, version: string, signature: string, instructionType: string, tradePda: string | null, slot: number, blockTime: Date) {
    try {
      await pool.query(
        `INSERT INTO transactions (program_id, version, signature, instruction_type, trade_pda, slot, block_time)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (signature) DO NOTHING`,
        [programId, version === 'v2.2' ? 'v2' : version, signature, instructionType, tradePda, slot, blockTime]
      );
    } catch (error) {
      // Non-critical, don't fail the main flow
    }
  }

  private detectInstructionType(logs: string[], version: string): string | null {
    for (const log of logs) {
      if (version === 'v1') {
        if (log.includes('Instruction: CreateEscrow')) return 'create_escrow';
        if (log.includes('Instruction: LockForTaker')) return 'lock_for_taker';
        if (log.includes('Instruction: ReleaseToTaker')) return 'release_to_taker';
        if (log.includes('Instruction: RefundToMaker')) return 'refund_to_maker';
      } else {
        // V2.2 Protocol instructions
        if (log.includes('Instruction: CreateTrade')) return 'create_trade';
        if (log.includes('Instruction: LockEscrow')) return 'lock_escrow';
        if (log.includes('Instruction: ReleaseEscrow')) return 'release_escrow';
        if (log.includes('Instruction: RefundEscrow')) return 'refund_escrow';
        // Lane and matching instructions
        if (log.includes('Instruction: MatchOffer')) return 'match_offer';
        if (log.includes('Instruction: MatchOfferAndLockFromLane')) return 'match_offer_lane';
        if (log.includes('Instruction: CreateLane')) return 'create_lane';
        if (log.includes('Instruction: FundLane')) return 'fund_lane';
        if (log.includes('Instruction: WithdrawLane')) return 'withdraw_lane';
      }
    }
    return null;
  }

  private async extractEscrowAddress(tx: any, programId: PublicKey): Promise<string | null> {
    // The V1 Escrow account has a specific discriminator [31, 213, 123, 187, 186, 22, 218, 155]
    const escrowDiscriminator = Buffer.from([31, 213, 123, 187, 186, 22, 218, 155]);
    const accounts = tx.transaction.message.accountKeys;

    for (const account of accounts) {
      try {
        const pubkey = typeof account === 'string' ? account : account.pubkey.toString();
        const accountInfo = await this.connection.getAccountInfo(new PublicKey(pubkey));

        if (accountInfo && accountInfo.owner.toString() === programId.toString()) {
          // Check if discriminator matches
          const dataDiscriminator = accountInfo.data.slice(0, 8);
          if (dataDiscriminator.equals(escrowDiscriminator)) {
            return pubkey;
          }
        }
      } catch (error) {
        continue;
      }
    }

    return null;
  }

  // Trade account discriminator: sha256("account:Trade")[0..8]
  private static TRADE_DISCRIMINATOR = Buffer.from([0x84, 0x8b, 0x7b, 0x1f, 0x9d, 0xc4, 0xf4, 0xbe]);

  private async extractV2TradeAddress(tx: any, programId: PublicKey): Promise<string | null> {
    const accounts = tx.transaction.message.accountKeys;

    for (const account of accounts) {
      try {
        const pubkey = typeof account === 'string' ? account : account.pubkey.toString();
        const accountInfo = await this.connection.getAccountInfo(new PublicKey(pubkey));

        if (accountInfo && accountInfo.owner.toString() === programId.toString()) {
          // Check 8-byte Anchor discriminator to identify Trade accounts
          if (accountInfo.data.length >= 150) {
            const disc = accountInfo.data.slice(0, 8);
            if (Buffer.from(disc).equals(BlipScanIndexer.TRADE_DISCRIMINATOR)) {
              return pubkey;
            }
          }
        }
      } catch (error) {
        continue;
      }
    }

    return null;
  }

  private async handleCreateEscrow(signature: string, escrowAddress: string, slot: number, timestamp: Date, version: string) {
    try {
      // Fetch escrow account data
      const accountInfo = await this.connection.getAccountInfo(new PublicKey(escrowAddress));

      if (!accountInfo) {
        console.log('  ⚠️ Escrow account not found');
        return;
      }

      // Parse escrow data (simplified - in production use Anchor deserialization)
      const escrow = await this.parseEscrowAccount(accountInfo.data);

      // Insert trade into trades table (snake_case schema)
      const result = await pool.query(
        `INSERT INTO trades (
          trade_pda, trade_id, merchant, "user", arbiter, treasury,
          mint, amount, fee_amount, state, created_slot, created_at, created_signature
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (trade_pda) DO NOTHING
        RETURNING trade_pda`,
        [
          escrowAddress,
          escrow.dealId || '',
          escrow.maker,
          escrow.taker === PublicKey.default.toString() ? null : escrow.taker,
          escrow.arbiter,
          escrow.treasury,
          escrow.mint,
          escrow.amount.toString(),
          0,
          'Funded',
          slot,
          timestamp,
          signature,
        ]
      );

      if (result.rows.length > 0) {
        // Insert event
        await this.insertEvent(escrowAddress, 'created', signature, slot, timestamp);
        console.log(`    ✅ Trade created: ${escrow.amount} tokens`);
      }
    } catch (error) {
      console.error('  ❌ Error handling create_escrow:', error);
    }
  }

  private async handleLockForTaker(signature: string, escrowAddress: string, slot: number, timestamp: Date) {
    try {
      const accountInfo = await this.connection.getAccountInfo(new PublicKey(escrowAddress));
      if (!accountInfo) return;

      const escrow = await this.parseEscrowAccount(accountInfo.data);

      await pool.query(
        `UPDATE trades
        SET state = 'Locked', "user" = $1, locked_slot = $2, locked_at = $3, locked_signature = $4, updated_at = NOW()
        WHERE trade_pda = $5`,
        [escrow.taker, slot, timestamp, signature, escrowAddress]
      );

      await this.insertEvent(escrowAddress, 'locked', signature, slot, timestamp);
      console.log(`    ✅ Trade locked by ${escrow.taker.slice(0, 8)}...`);
    } catch (error) {
      console.error('  ❌ Error handling lock_for_taker:', error);
    }
  }

  private async handleReleaseToTaker(signature: string, escrowAddress: string, slot: number, timestamp: Date) {
    try {
      // Re-read account to get taker in case we missed the lock tx
      let taker: string | null = null;
      const accountInfo = await this.connection.getAccountInfo(new PublicKey(escrowAddress));
      if (accountInfo) {
        try {
          const escrow = await this.parseEscrowAccount(accountInfo.data);
          if (escrow.taker && escrow.taker !== PublicKey.default.toString()) {
            taker = escrow.taker;
          }
        } catch {}
      }

      await pool.query(
        `UPDATE trades
        SET state = 'Released', released_slot = $1, released_signature = $2,
            "user" = COALESCE($3, "user"),
            updated_at = NOW()
        WHERE trade_pda = $4`,
        [slot, signature, taker, escrowAddress]
      );

      await this.insertEvent(escrowAddress, 'released', signature, slot, timestamp);
      console.log(`    ✅ Trade released${taker ? ` (taker: ${taker.slice(0, 8)}...)` : ''}`);
    } catch (error) {
      console.error('  ❌ Error handling release_to_taker:', error);
    }
  }

  private async handleRefundToMaker(signature: string, escrowAddress: string, slot: number, timestamp: Date) {
    try {
      await pool.query(
        `UPDATE trades
        SET state = 'Refunded', refunded_signature = $1, updated_at = NOW()
        WHERE trade_pda = $2`,
        [signature, escrowAddress]
      );

      await this.insertEvent(escrowAddress, 'refunded', signature, slot, timestamp);
      console.log(`    ✅ Trade refunded`);
    } catch (error) {
      console.error('  ❌ Error handling refund_to_maker:', error);
    }
  }

  private async parseEscrowAccount(data: Buffer): Promise<any> {
    // Use Anchor's BorshAccountsCoder to properly deserialize
    const decoded = this.v1Coder.decode('Escrow', data);

    if (!decoded) {
      throw new Error('Failed to decode escrow account');
    }

    // Convert status enum to string
    const statusMap = ['funded', 'locked', 'released', 'refunded'];
    const statusIndex = Object.keys(decoded.status)[0];
    const statusStr = statusMap[parseInt(statusIndex)] || 'funded';

    // dealId is already a Uint8Array/Buffer
    const dealIdHex = decoded.dealId ?
      (Buffer.isBuffer(decoded.dealId) ? decoded.dealId : Buffer.from(decoded.dealId)).toString('hex') :
      '';

    const result = {
      version: decoded.version || 0,
      dealId: dealIdHex,
      maker: decoded.maker.toString(),
      taker: decoded.taker.toString(),
      arbiter: decoded.arbiter.toString(),
      treasury: decoded.treasury.toString(),
      mint: decoded.mint.toString(),
      amount: decoded.amount || BigInt(0),
      feeBps: decoded.feeBps || 0,
      status: statusStr,
    };

    console.log(`    📊 Parsed: ${result.amount} tokens, fee ${result.feeBps}bps, mint ${result.mint.slice(0, 8)}...`);
    return result;
  }

  // Status enum: Created(0), Funded(1), Locked(2), PaymentSent(3), Disputed(4), Released(5), Refunded(6)
  private static V2_STATUS_MAP = ['created', 'funded', 'locked', 'payment_sent', 'disputed', 'released', 'refunded'];

  private parseV2TradeAccount(data: Buffer): any {
    // Trade struct layout (206 bytes total):
    // 8: discriminator, 32: creator, 32: counterparty, 8: tradeId, 32: mint,
    // 8: amount, 1: status, 2: feeBps, 1: escrowBump, 1: bump,
    // 8: createdAt, 8: lockedAt, 8: settledAt, 1: side,
    // 8: expiresAt, 8: paymentConfirmedAt, 8: disputedAt, 32: disputeInitiator

    let offset = 8; // Skip discriminator

    const creator = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    const counterparty = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    const tradeId = data.readBigUInt64LE(offset);
    offset += 8;

    const mint = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    const amount = data.readBigUInt64LE(offset);
    offset += 8;

    const statusByte = data.readUInt8(offset);
    offset += 1;

    const feeBps = data.readUInt16LE(offset);
    offset += 2;

    const statusStr = BlipScanIndexer.V2_STATUS_MAP[statusByte] || 'unknown';

    return {
      creator,
      counterparty,
      tradeId,
      mint,
      amount,
      status: { [statusStr]: {} },
      feeBps,
      statusStr,
    };
  }

  private async handleV2CreateTrade(signature: string, tradeAddress: string, slot: number, timestamp: Date, version: string, tx: any) {
    try {
      // Fetch trade account data
      const accountInfo = await this.connection.getAccountInfo(new PublicKey(tradeAddress));

      if (!accountInfo) {
        console.log('  ⚠️ Trade account not found');
        return;
      }

      // Parse trade data using V2 coder or manual parsing
      let trade;
      if (this.v2Coder) {
        try {
          trade = this.v2Coder.decode('Trade', accountInfo.data);
        } catch (error) {
          console.log('  ℹ️ Coder failed, using manual parsing');
          trade = this.parseV2TradeAccount(accountInfo.data);
        }
      } else {
        trade = this.parseV2TradeAccount(accountInfo.data);
      }

      if (!trade) {
        throw new Error('Failed to decode trade account');
      }

      // Extract lane_id from transaction logs/events if available
      let laneId = 0;
      const logs = tx.meta.logMessages || [];

      // Try to find lane_id in event data
      // The TradeCreatedEvent doesn't have laneId, but we can check if this trade
      // was created with an offer that has a laneId
      // For now, set to 0 and will be updated on lock if lane is used

      // Convert status - use direct statusStr from manual parser, or derive from Anchor coder output
      let statusStr: string;
      if (trade.statusStr) {
        statusStr = trade.statusStr;
      } else {
        const statusKey = Object.keys(trade.status || {})[0] || 'created';
        statusStr = statusKey.toLowerCase();
      }
      // Map 'created' to 'funded' for display (on-chain Created = just created, Funded = escrow deposited)
      if (statusStr === 'created') statusStr = 'funded';

      // Insert trade into v2_trades table (snake_case schema)
      const result = await pool.query(
        `INSERT INTO v2_trades (
          program_id, trade_pda, trade_id, creator_pubkey, counterparty_pubkey,
          mint_address, amount, status, lane_id, created_slot, created_at, created_signature
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (trade_pda) DO UPDATE SET created_signature = EXCLUDED.created_signature
        RETURNING id`,
        [
          V2_PROGRAM_ID.toString(),
          tradeAddress,
          parseInt(trade.tradeId.toString()),
          trade.creator.toString(),
          trade.counterparty.toString() === PublicKey.default.toString() ? null : trade.counterparty.toString(),
          trade.mint.toString(),
          trade.amount.toString(),
          statusStr,
          laneId,
          0, // created_slot - will be updated if available
          timestamp,
          signature,
        ]
      );

      if (result.rows.length > 0) {
        // V2 trades don't use trade_events table - status changes tracked in v2_trades directly
        console.log(`    ✅ [v2.2] Trade created: ${trade.amount} tokens, tradeId: ${trade.tradeId}`);
      }
    } catch (error) {
      console.error('  ❌ Error handling v2 create_trade:', error);
    }
  }

  private async handleV2LockEscrow(signature: string, tradeAddress: string, slot: number, timestamp: Date, tx: any) {
    try {
      const accountInfo = await this.connection.getAccountInfo(new PublicKey(tradeAddress));
      if (!accountInfo) return;

      let trade;
      if (this.v2Coder) {
        try {
          trade = this.v2Coder.decode('Trade', accountInfo.data);
        } catch (error) {
          trade = this.parseV2TradeAccount(accountInfo.data);
        }
      } else {
        trade = this.parseV2TradeAccount(accountInfo.data);
      }
      if (!trade) return;

      // Try to extract lane_id from the transaction
      // In V2, lane_id might be in the instruction data or logs
      let laneId = 0;
      const logs = tx.meta.logMessages || [];

      // Look for lane references in logs
      for (const log of logs) {
        const match = log.match(/lane[:\s]+(\d+)/i);
        if (match) {
          laneId = parseInt(match[1]);
          break;
        }
      }

      await pool.query(
        `UPDATE v2_trades
        SET status = 'locked', counterparty_pubkey = $1, locked_at = $2, lane_id = $3, locked_signature = $4, updated_at = NOW()
        WHERE trade_pda = $5`,
        [trade.counterparty.toString(), timestamp, laneId, signature, tradeAddress]
      );

      const tradeResult = await pool.query('SELECT id FROM v2_trades WHERE trade_pda = $1', [tradeAddress]);
      if (tradeResult.rows.length > 0) {
        console.log(`    ✅ [v2.2] Trade locked by ${trade.counterparty.toString().slice(0, 8)}... (lane: ${laneId})`);
      }
    } catch (error) {
      console.error('  ❌ Error handling v2 lock_escrow:', error);
    }
  }

  private async handleV2ReleaseEscrow(signature: string, tradeAddress: string, slot: number, timestamp: Date) {
    try {
      // Re-read account to get counterparty in case we missed the lock tx
      const accountInfo = await this.connection.getAccountInfo(new PublicKey(tradeAddress));
      let counterparty: string | null = null;
      if (accountInfo) {
        let trade;
        if (this.v2Coder) {
          try { trade = this.v2Coder.decode('Trade', accountInfo.data); } catch { trade = this.parseV2TradeAccount(accountInfo.data); }
        } else {
          trade = this.parseV2TradeAccount(accountInfo.data);
        }
        if (trade && trade.counterparty.toString() !== PublicKey.default.toString()) {
          counterparty = trade.counterparty.toString();
        }
      }

      await pool.query(
        `UPDATE v2_trades
        SET status = 'released', released_at = $1, released_signature = $2,
            counterparty_pubkey = COALESCE($3, counterparty_pubkey),
            locked_at = COALESCE(locked_at, $1),
            updated_at = NOW()
        WHERE trade_pda = $4`,
        [timestamp, signature, counterparty, tradeAddress]
      );

      console.log(`    ✅ [v2.2] Trade released${counterparty ? ` (counterparty: ${counterparty.slice(0, 8)}...)` : ''}`);
    } catch (error) {
      console.error('  ❌ Error handling v2 release_escrow:', error);
    }
  }

  private async handleV2RefundEscrow(signature: string, tradeAddress: string, slot: number, timestamp: Date) {
    try {
      // Re-read account to get counterparty in case we missed the lock tx
      const accountInfo = await this.connection.getAccountInfo(new PublicKey(tradeAddress));
      let counterparty: string | null = null;
      if (accountInfo) {
        let trade;
        if (this.v2Coder) {
          try { trade = this.v2Coder.decode('Trade', accountInfo.data); } catch { trade = this.parseV2TradeAccount(accountInfo.data); }
        } else {
          trade = this.parseV2TradeAccount(accountInfo.data);
        }
        if (trade && trade.counterparty.toString() !== PublicKey.default.toString()) {
          counterparty = trade.counterparty.toString();
        }
      }

      await pool.query(
        `UPDATE v2_trades
        SET status = 'refunded', refunded_signature = $1,
            counterparty_pubkey = COALESCE($2, counterparty_pubkey),
            updated_at = NOW()
        WHERE trade_pda = $3`,
        [signature, counterparty, tradeAddress]
      );

      console.log(`    ✅ [v2.2] Trade refunded${counterparty ? ` (counterparty: ${counterparty.slice(0, 8)}...)` : ''}`);
    } catch (error) {
      console.error('  ❌ Error handling v2 refund_escrow:', error);
    }
  }

  private async handleV2MatchOffer(signature: string, tradeAddress: string, slot: number, timestamp: Date, version: string, tx: any, instructionType: string) {
    try {
      // Match offer creates and locks a trade atomically
      const accountInfo = await this.connection.getAccountInfo(new PublicKey(tradeAddress));
      if (!accountInfo) {
        console.log('  ⚠️ Trade account not found for match');
        return;
      }

      let trade;
      if (this.v2Coder) {
        try {
          trade = this.v2Coder.decode('Trade', accountInfo.data);
        } catch (error) {
          trade = this.parseV2TradeAccount(accountInfo.data);
        }
      } else {
        trade = this.parseV2TradeAccount(accountInfo.data);
      }

      if (!trade) return;

      // Extract lane ID from logs if available
      let laneId = 0;
      const logs = tx.meta.logMessages || [];
      for (const log of logs) {
        const match = log.match(/lane[:\s]+(\d+)/i);
        if (match) {
          laneId = parseInt(match[1]);
          break;
        }
      }

      // Status is already 'locked' for matched offers
      const result = await pool.query(
        `INSERT INTO v2_trades (
          program_id, trade_pda, trade_id, creator_pubkey, counterparty_pubkey,
          mint_address, amount, status, lane_id, created_slot, created_at, locked_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'locked', $8, $9, $10, $10)
        ON CONFLICT (trade_pda) DO UPDATE SET
          status = 'locked',
          counterparty_pubkey = EXCLUDED.counterparty_pubkey,
          locked_at = EXCLUDED.locked_at,
          lane_id = EXCLUDED.lane_id,
          updated_at = NOW()
        RETURNING id`,
        [
          V2_PROGRAM_ID.toString(),
          tradeAddress,
          parseInt(trade.tradeId.toString()),
          trade.creator.toString(),
          trade.counterparty.toString() === PublicKey.default.toString() ? null : trade.counterparty.toString(),
          trade.mint.toString(),
          trade.amount.toString(),
          laneId,
          slot,
          timestamp,
        ]
      );

      if (result.rows.length > 0) {
        const isLane = instructionType === 'match_offer_lane';
        console.log(`    ✅ [v2.2] Trade matched${isLane ? ' (from lane)' : ''}: ${trade.amount} tokens, tradeId: ${trade.tradeId}${isLane ? `, lane: ${laneId}` : ''}`);
      }
    } catch (error) {
      console.error('  ❌ Error handling v2 match_offer:', error);
    }
  }

  private async handleV2LaneOperation(signature: string, slot: number, timestamp: Date, instructionType: string, tx: any) {
    try {
      // Extract lane information from transaction accounts and logs
      const logs = tx.meta.logMessages || [];
      let laneId = 0;
      let merchantWallet = '';
      let lanePda = '';
      let amount = null;
      let mint = '';

      // Extract lane ID and other info from logs
      // Format: "Program log: Lane created: id=102, merchant=7zryn4WyjQ2rHsRAJ4Stagk81QjczHTerEsDg7DSX93K, min=1000000000, max=5000000000"
      // Or: "Program log: Lane funded: id=102, amount=5000000000"
      for (const log of logs) {
        // Try to match "id=XXX" format first
        const idMatch = log.match(/\bid[=:]\s*(\d+)/i);
        if (idMatch) {
          laneId = parseInt(idMatch[1]);
        }

        // Extract merchant from logs if present
        const merchantMatch = log.match(/merchant[=:]\s*([A-Za-z0-9]{32,44})/i);
        if (merchantMatch && !merchantWallet) {
          merchantWallet = merchantMatch[1];
        }

        // Extract amount from logs if present
        const amountMatch = log.match(/amount[=:]\s*(\d+)/i);
        if (amountMatch) {
          amount = amountMatch[1];
        }
      }

      // Extract accounts from transaction - getParsedTransaction returns objects with pubkey field
      const accounts = tx.transaction.message.accountKeys || [];
      if (accounts.length > 0) {
        const acc0 = accounts[0];
        // Handle both string format and object format with pubkey field
        const wallet = (typeof acc0 === 'string') ? acc0 : (acc0?.pubkey || acc0?.toBase58?.() || acc0?.toString?.() || '');
        if (!merchantWallet && wallet) {
          merchantWallet = wallet;
        }
      }
      if (accounts.length > 1) {
        const acc1 = accounts[1];
        // Lane PDA is typically the second account
        lanePda = (typeof acc1 === 'string') ? acc1 : (acc1?.pubkey || acc1?.toBase58?.() || acc1?.toString?.() || '');
      }

      // Get mint from transaction if available
      for (const account of accounts) {
        const pubkey = (typeof account === 'string') ? account : (account?.pubkey || account?.toBase58?.() || account?.toString?.() || '');
        // USDC mint on devnet or mainnet
        if (pubkey === 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr' ||
            pubkey === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' ||
            pubkey === 'FT8zRmLcsbNvqjCMSiwQC5GdkZfGtsoj8r5k19H65X9Z') {
          mint = pubkey;
        }
      }

      // Map instruction type to operation name
      const operationMap: { [key: string]: string } = {
        'create_lane': 'CreateLane',
        'fund_lane': 'FundLane',
        'withdraw_lane': 'WithdrawLane'
      };
      const operation = operationMap[instructionType] || instructionType;

      // Insert lane operation into database
      const result = await pool.query(
        `INSERT INTO lane_operations (
          id, "laneId", "merchantWallet", "lanePda", operation, amount, mint,
          signature, slot, "blockTime", "createdAt"
        ) VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        ON CONFLICT (signature) DO NOTHING
        RETURNING id`,
        [laneId, merchantWallet, lanePda, operation, amount, mint, signature, slot, timestamp]
      );

      if (result.rows.length > 0) {
        console.log(`    ✅ [v2.2] Lane operation stored: ${operation} - lane ${laneId} - merchant ${merchantWallet.slice(0, 8)}... - ${signature.slice(0, 8)}...`);
      } else {
        console.log(`    📝 [v2.2] Lane operation (duplicate): ${operation} - ${signature.slice(0, 8)}...`);
      }
    } catch (error) {
      console.error('  ❌ Error handling lane operation:', error);
    }
  }

  private async insertEvent(escrowAddress: string, eventType: string, signature: string, slot: number, timestamp: Date) {
    // Insert event into trade_events table (snake_case schema)
    await pool.query(
      `INSERT INTO trade_events (
        trade_pda, event_type, signature, slot, log_index, timestamp
      ) VALUES ($1, $2, $3, $4, 0, $5)
      ON CONFLICT (signature, log_index) DO NOTHING`,
      [escrowAddress, eventType, signature, slot, timestamp]
    );
  }
}

// ============================================
// START INDEXER
// ============================================

const indexer = new BlipScanIndexer();
indexer.start().catch(console.error);

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n👋 Shutting down...');
  await pool.end();
  process.exit(0);
});
