/**
 * backendArbiterReadiness — fail-closed validation. Every failure mode must
 * report ready=false (→ route falls back to the human-wallet path); only a
 * fully-valid, on-chain-registered arbiter reports ready=true.
 */

const mockEnabled = jest.fn();
const mockKeypair = jest.fn();
jest.mock('@/lib/solana/backendArbiter', () => ({
  isBackendArbiterEnabled: () => mockEnabled(),
  getArbiterKeypair: () => mockKeypair(),
}));

const mockGetAccountInfo = jest.fn();
jest.mock('@/lib/solana/backendSigner', () => ({
  getBackendConnection: () => ({ getAccountInfo: (...a: unknown[]) => mockGetAccountInfo(...a) }),
}));

const mockProgramId = jest.fn();
jest.mock('@/lib/solana/v2/config', () => ({
  getV2ProgramId: () => mockProgramId(),
  isMainnetActive: () => false,
}));

jest.mock('@/lib/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import { Keypair, PublicKey } from '@solana/web3.js';
import { validateBackendArbiterReadiness } from '@/lib/solana/backendArbiterReadiness';

const PROGRAM = Keypair.generate().publicKey;
const ARBITER = Keypair.generate();
const PROGRAM_ACCT = { data: Buffer.alloc(36), executable: true };

function arbiterSetAcct(members: PublicKey[]) {
  const data = Buffer.alloc(362); // 8 disc + 32 authority + 320 arbiters + 1 count + 1 bump
  members.slice(0, 10).forEach((pk, i) => pk.toBuffer().copy(data, 40 + i * 32));
  data.writeUInt8(members.length, 360);
  return { data, executable: false };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockProgramId.mockReturnValue(PROGRAM);
  mockKeypair.mockReturnValue(ARBITER);
  mockEnabled.mockReturnValue(true);
});

test('flag off → not ready (no RPC)', async () => {
  mockEnabled.mockReturnValue(false);
  const r = await validateBackendArbiterReadiness(true);
  expect(r.ready).toBe(false);
  expect(r.reason).toMatch(/not true/);
  expect(mockGetAccountInfo).not.toHaveBeenCalled();
});

test('no keypair → not ready', async () => {
  mockKeypair.mockReturnValue(null);
  const r = await validateBackendArbiterReadiness(true);
  expect(r.ready).toBe(false);
  expect(r.reason).toMatch(/not configured/);
});

test('program not found → not ready', async () => {
  mockGetAccountInfo.mockResolvedValueOnce(null);
  const r = await validateBackendArbiterReadiness(true);
  expect(r.ready).toBe(false);
  expect(r.reason).toMatch(/not found\/executable/);
});

test('ArbiterSet PDA missing → not ready', async () => {
  mockGetAccountInfo.mockResolvedValueOnce(PROGRAM_ACCT).mockResolvedValueOnce(null);
  const r = await validateBackendArbiterReadiness(true);
  expect(r.ready).toBe(false);
  expect(r.reason).toMatch(/ArbiterSet PDA does not exist/);
});

test('arbiter not in on-chain set → not ready', async () => {
  mockGetAccountInfo
    .mockResolvedValueOnce(PROGRAM_ACCT)
    .mockResolvedValueOnce(arbiterSetAcct([Keypair.generate().publicKey]));
  const r = await validateBackendArbiterReadiness(true);
  expect(r.ready).toBe(false);
  expect(r.reason).toMatch(/NOT registered/);
  expect(r.arbiterCount).toBe(1);
});

test('arbiter registered on-chain → READY', async () => {
  mockGetAccountInfo
    .mockResolvedValueOnce(PROGRAM_ACCT)
    .mockResolvedValueOnce(arbiterSetAcct([ARBITER.publicKey, Keypair.generate().publicKey]));
  const r = await validateBackendArbiterReadiness(true);
  expect(r.ready).toBe(true);
  expect(r.arbiterPubkey).toBe(ARBITER.publicKey.toBase58());
  expect(r.arbiterCount).toBe(2);
});

test('RPC throws → fail closed (not ready)', async () => {
  mockGetAccountInfo.mockRejectedValueOnce(new Error('rpc down'));
  const r = await validateBackendArbiterReadiness(true);
  expect(r.ready).toBe(false);
  expect(r.reason).toMatch(/RPC error/);
});
