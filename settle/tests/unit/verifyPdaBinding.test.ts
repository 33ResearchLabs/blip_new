/**
 * verifyEscrowPdaBinding — server-side PDA derivation + mismatch rejection.
 *
 * Uses REAL @solana/web3.js + Anchor BN derivation (the same code path
 * production uses) so the canonical seeds are exercised end-to-end.
 * Mocked: only the logger.
 */

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('@/lib/logger', () => ({ logger: mockLog }));

import { Keypair, PublicKey } from '@solana/web3.js';
import {
  verifyEscrowPdaBinding,
  rejectsSubmittedPdaWithoutDerivationInputs,
  isPdaVerificationStrict,
} from '@/lib/solana/v2/verifyPdaBinding';
import { findTradePda, findEscrowPda } from '@/lib/solana/v2/pdas';

// Build a fixture pair (creator + tradeId) and the canonical derived PDAs.
const creatorKp = Keypair.generate();
const CREATOR = creatorKp.publicKey.toBase58();
const TRADE_ID = 42;

const [DERIVED_TRADE_PDA] = findTradePda(creatorKp.publicKey, TRADE_ID);
const [DERIVED_ESCROW_PDA] = findEscrowPda(DERIVED_TRADE_PDA);
const TRADE_PDA = DERIVED_TRADE_PDA.toBase58();
const ESCROW_PDA = DERIVED_ESCROW_PDA.toBase58();

// Deliberately wrong PDA (a different real keypair pubkey) for mismatch tests.
const WRONG_PDA = Keypair.generate().publicKey.toBase58();

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.PDA_VERIFICATION_STRICT;
});

describe('isPdaVerificationStrict', () => {
  test('default = strict', () => {
    expect(isPdaVerificationStrict()).toBe(true);
  });
  test('explicit "false" disables strict (emergency rollback)', () => {
    process.env.PDA_VERIFICATION_STRICT = 'false';
    expect(isPdaVerificationStrict()).toBe(false);
  });
});

describe('rejectsSubmittedPdaWithoutDerivationInputs', () => {
  test('PDAs submitted without creator+tradeId → reject', () => {
    const r = rejectsSubmittedPdaWithoutDerivationInputs({
      submittedTradePda: TRADE_PDA,
    });
    expect(r?.ok).toBe(false);
    expect(r?.reason).toMatch(/cannot verify PDA/);
  });
  test('PDAs submitted with full inputs → no early rejection', () => {
    expect(rejectsSubmittedPdaWithoutDerivationInputs({
      creatorWallet: CREATOR, tradeId: TRADE_ID, submittedTradePda: TRADE_PDA,
    })).toBeNull();
  });
  test('no PDAs submitted → no early rejection (verifier may still derive)', () => {
    expect(rejectsSubmittedPdaWithoutDerivationInputs({
      creatorWallet: CREATOR, tradeId: TRADE_ID,
    })).toBeNull();
  });
});

describe('verifyEscrowPdaBinding — happy paths', () => {
  test('all submitted PDAs match derivation → ok with derived values', () => {
    const r = verifyEscrowPdaBinding({
      creatorWallet: CREATOR,
      tradeId: TRADE_ID,
      submittedTradePda: TRADE_PDA,
      submittedEscrowPda: ESCROW_PDA,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.derived.tradePda).toBe(TRADE_PDA);
      expect(r.derived.escrowPda).toBe(ESCROW_PDA);
      expect(r.derived.creatorWallet).toBe(CREATOR);
      expect(r.derived.tradeId).toBe(TRADE_ID);
    }
    expect(mockLog.info).toHaveBeenCalled();   // audit-log
    expect(mockLog.error).not.toHaveBeenCalled();
  });

  test('no submitted PDAs (only creator+tradeId) → ok, server derives both', () => {
    const r = verifyEscrowPdaBinding({
      creatorWallet: CREATOR, tradeId: TRADE_ID,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.derived.tradePda).toBe(TRADE_PDA);
      expect(r.derived.escrowPda).toBe(ESCROW_PDA);
    }
    // Quiet path — no audit log when client didn't attest
    expect(mockLog.info).not.toHaveBeenCalled();
  });

  test('tradeId can be a numeric string (frontend serialization)', () => {
    const r = verifyEscrowPdaBinding({
      creatorWallet: CREATOR, tradeId: String(TRADE_ID),
      submittedTradePda: TRADE_PDA,
    });
    expect(r.ok).toBe(true);
  });
});

describe('verifyEscrowPdaBinding — mismatch rejection (strict default)', () => {
  test('wrong submitted tradePda → reject, ERROR log, derived values returned in NO field', () => {
    const r = verifyEscrowPdaBinding({
      orderId: 'ord-1',
      creatorWallet: CREATOR,
      tradeId: TRADE_ID,
      submittedTradePda: WRONG_PDA,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.field).toBe('tradePda');
      expect(r.reason).toMatch(/escrow_trade_pda mismatch/);
      expect(r.reason).toContain(WRONG_PDA);
      expect(r.reason).toContain(TRADE_PDA);
    }
    expect(mockLog.error).toHaveBeenCalled();
    expect(mockLog.warn).not.toHaveBeenCalled();
  });

  test('matching tradePda but wrong escrowPda → reject (escrowPda field)', () => {
    const r = verifyEscrowPdaBinding({
      creatorWallet: CREATOR,
      tradeId: TRADE_ID,
      submittedTradePda: TRADE_PDA,
      submittedEscrowPda: WRONG_PDA,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('escrowPda');
  });

  test('attacker swaps in their own creator+tradeId → derived PDA differs from submitted (would be caught by attestation)', () => {
    const otherKp = Keypair.generate();
    const otherCreator = otherKp.publicKey.toBase58();

    // Attacker keeps the LEGITIMATE trade_pda but lies about the creator
    const r = verifyEscrowPdaBinding({
      creatorWallet: otherCreator,
      tradeId: TRADE_ID,
      submittedTradePda: TRADE_PDA,        // legitimate user's PDA
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('tradePda');
  });
});

describe('verifyEscrowPdaBinding — input validation', () => {
  test('missing creatorWallet → reject', () => {
    const r = verifyEscrowPdaBinding({ tradeId: TRADE_ID });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('creatorWallet');
  });
  test('non-base58 creatorWallet → reject', () => {
    const r = verifyEscrowPdaBinding({ creatorWallet: 'not-a-real-wallet!', tradeId: TRADE_ID });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('creatorWallet');
  });
  test('off-curve pubkey (correct charset, wrong shape) → reject', () => {
    // 32 ones is base58 valid but isn't a real public key
    const r = verifyEscrowPdaBinding({
      creatorWallet: '1'.repeat(43), tradeId: TRADE_ID,
    });
    expect(r.ok).toBe(false);
  });
  test('missing tradeId → reject', () => {
    const r = verifyEscrowPdaBinding({ creatorWallet: CREATOR });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('tradeId');
  });
  test('negative tradeId → reject', () => {
    const r = verifyEscrowPdaBinding({ creatorWallet: CREATOR, tradeId: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('tradeId');
  });
  test('non-integer tradeId → reject', () => {
    const r = verifyEscrowPdaBinding({ creatorWallet: CREATOR, tradeId: 1.5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('tradeId');
  });
  test('NaN/non-numeric string tradeId → reject', () => {
    const r = verifyEscrowPdaBinding({ creatorWallet: CREATOR, tradeId: 'banana' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('tradeId');
  });
});

describe('verifyEscrowPdaBinding — different tradeIds derive different PDAs', () => {
  test('two trade_ids on same creator produce distinct PDAs (proves seed includes tradeId)', () => {
    const a = verifyEscrowPdaBinding({ creatorWallet: CREATOR, tradeId: 1 });
    const b = verifyEscrowPdaBinding({ creatorWallet: CREATOR, tradeId: 2 });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.derived.tradePda).not.toBe(b.derived.tradePda);
      expect(a.derived.escrowPda).not.toBe(b.derived.escrowPda);
    }
  });
});

describe('verifyEscrowPdaBinding — lax mode (emergency rollback)', () => {
  beforeEach(() => { process.env.PDA_VERIFICATION_STRICT = 'false'; });

  test('mismatch under lax → ok=true with lax flag, WARN log, derived values returned', () => {
    const r = verifyEscrowPdaBinding({
      creatorWallet: CREATOR,
      tradeId: TRADE_ID,
      submittedTradePda: WRONG_PDA,
    });
    expect(r.ok).toBe(true);
    if (r.ok && r.lax) {
      expect(r.lax).toBe(true);
      expect(r.reason).toMatch(/escrow_trade_pda mismatch/);
      // CRITICAL: even in lax mode, the DERIVED PDA is returned for storage
      // — never the submitted (potentially attacker-controlled) one.
      expect(r.derived.tradePda).toBe(TRADE_PDA);
      expect(r.derived.tradePda).not.toBe(WRONG_PDA);
    }
    expect(mockLog.warn).toHaveBeenCalled();
    expect(mockLog.error).not.toHaveBeenCalled();
  });

  test('input-shape rejections still apply under lax (no creator → still reject)', () => {
    const r = verifyEscrowPdaBinding({ tradeId: TRADE_ID });
    expect(r.ok).toBe(false);
  });
});
