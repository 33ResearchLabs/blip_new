import { Keypair, PublicKey } from "@solana/web3.js";
import fs from "node:fs";
import "dotenv/config";

function req(key: string): string {
  const v = process.env[key];
  if (v === undefined || v === "") throw new Error(`Missing required env var: ${key}`);
  return v;
}
function num(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${key}: ${v}`);
  return n;
}
function str(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const CONFIG = {
  rpcUrl: req("RPC_URL"),
  programId: new PublicKey(req("PROGRAM_ID")),
  keypairPath: req("KEYPAIR_PATH"),
  idlPath: req("IDL_PATH"),
  commitment: str("COMMITMENT", "confirmed") as "processed" | "confirmed" | "finalized",
  paymentStaleThresholdSec: num("PAYMENT_STALE_THRESHOLD_SEC", 24 * 60 * 60),
  disputeWindowSec: num("DISPUTE_WINDOW_SEC", 72 * 60 * 60),
  pollIntervalMs: num("POLL_INTERVAL_MS", 45_000),
  maxTxPerTick: num("MAX_TX_PER_TICK", 20),
  concurrency: num("CONCURRENCY", 4),
  clockSkewBufferSec: num("CLOCK_SKEW_BUFFER_SEC", 60),
  txRetries: num("TX_RETRIES", 3),
};

export function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path, "utf8"));
  if (!Array.isArray(raw)) throw new Error(`Keypair file must be a JSON array of bytes: ${path}`);
  return Keypair.fromSecretKey(new Uint8Array(raw));
}
