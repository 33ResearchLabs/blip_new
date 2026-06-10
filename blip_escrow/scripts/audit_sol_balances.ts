/**
 * audit_sol_balances.ts
 * Checks SOL balance locked in every Trade PDA, Escrow PDA, and Vault ATA.
 */
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import idl from "../target/idl/blip_protocol_v2.json";

const PROGRAM_ID = new PublicKey("gfFC2pjvRCALNehRWJb2ce81eDXJMwJdg9W7yeLyBqS");
const USDT_MINT   = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
const RPC = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const SOL_PRICE   = parseFloat(process.env.SOL_PRICE || "150");

const ESCROW_DISC = Buffer.from([31, 213, 123, 187, 186, 22, 218, 155]);

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
async function withRetry<T>(fn: () => Promise<T>, max = 5): Promise<T> {
  let last: any;
  for (let i = 0; i < max; i++) {
    try { return await fn(); }
    catch (e) { last = e; await sleep(3000 * (i + 1)); }
  }
  throw last;
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const wallet = new anchor.Wallet(anchor.web3.Keypair.generate());
  const provider = new anchor.AnchorProvider(conn, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new Program(idl as any, provider);

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  SOL RENT AUDIT — all Trade / Escrow / Vault ATAs`);
  console.log(`  SOL price assumption: $${SOL_PRICE}`);
  console.log(`${'═'.repeat(70)}\n`);

  // Fetch all trades
  console.log("Fetching trades…");
  const trades = await withRetry(() => (program.account as any).trade.all());
  await sleep(1500);

  // Fetch all escrows (raw)
  console.log("Fetching escrows…");
  const escrowRaw = await withRetry(() =>
    conn.getProgramAccounts(PROGRAM_ID, {
      filters: [{ memcmp: { offset: 0, bytes: anchor.utils.bytes.bs58.encode(ESCROW_DISC) } }],
    })
  );
  await sleep(1500);

  // Build all PDAs to check
  type AccountRef = { label: string; pubkey: PublicKey; status: string; tradeId: string };
  const toCheck: AccountRef[] = [];

  for (const { publicKey, account } of trades) {
    const status = Object.keys(account.status)[0];
    const tradeId = account.tradeId.toString();

    const [escrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow-v2"), publicKey.toBuffer()],
      PROGRAM_ID
    );
    const [vaultAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault-authority-v2"), escrowPda.toBuffer()],
      PROGRAM_ID
    );
    const vaultAta = getAssociatedTokenAddressSync(USDT_MINT, vaultAuth, true);

    toCheck.push({ label: "trade",  pubkey: publicKey, status, tradeId });
    toCheck.push({ label: "escrow", pubkey: escrowPda, status, tradeId });
    toCheck.push({ label: "vault",  pubkey: vaultAta,  status, tradeId });
  }

  // Batch fetch in chunks of 100
  console.log(`Fetching SOL balances for ${toCheck.length} accounts…\n`);
  const CHUNK = 100;
  const allInfos: (anchor.web3.AccountInfo<Buffer> | null)[] = [];

  for (let i = 0; i < toCheck.length; i += CHUNK) {
    const chunk = toCheck.slice(i, i + CHUNK).map(a => a.pubkey);
    const infos = await withRetry(() => conn.getMultipleAccountsInfo(chunk));
    allInfos.push(...infos);
    if (i + CHUNK < toCheck.length) await sleep(1000);
  }

  // Tally
  let totalTradeSol = 0, totalEscrowSol = 0, totalVaultSol = 0;
  let tradeCount = 0, escrowCount = 0, vaultCount = 0;

  const nonEmpty: { ref: AccountRef; lamports: number }[] = [];

  for (let i = 0; i < toCheck.length; i++) {
    const ref = toCheck[i];
    const info = allInfos[i];
    const lamports = info?.lamports ?? 0;
    const sol = lamports / LAMPORTS_PER_SOL;

    if (lamports > 0) {
      if (ref.label === "trade")  { totalTradeSol  += sol; tradeCount++;  }
      if (ref.label === "escrow") { totalEscrowSol += sol; escrowCount++; }
      if (ref.label === "vault")  { totalVaultSol  += sol; vaultCount++;  }
      nonEmpty.push({ ref, lamports });
    }
  }

  const totalSol = totalTradeSol + totalEscrowSol + totalVaultSol;

  // ── Print all non-empty accounts ────────────────────────────────────
  console.log(`${'─'.repeat(70)}`);
  console.log(`  ALL ACCOUNTS WITH SOL BALANCE`);
  console.log(`${'─'.repeat(70)}\n`);

  const byType: Record<string, typeof nonEmpty> = { trade: [], escrow: [], vault: [] };
  for (const entry of nonEmpty) byType[entry.ref.label].push(entry);

  for (const type of ['trade', 'escrow', 'vault']) {
    const list = byType[type];
    if (list.length === 0) continue;
    console.log(`  ── ${type.toUpperCase()} PDAs (${list.length}) ──`);
    for (const { ref, lamports } of list) {
      const sol = lamports / LAMPORTS_PER_SOL;
      const usd = sol * SOL_PRICE;
      console.log(`  [${ref.status.padEnd(11)}] trade_id=${ref.tradeId.padEnd(16)} ${sol.toFixed(6)} SOL  $${usd.toFixed(3)}   ${ref.pubkey.toBase58()}`);
    }
    console.log();
  }

  // ── Summary ──────────────────────────────────────────────────────────
  console.log(`${'─'.repeat(70)}`);
  console.log(`  SUMMARY`);
  console.log(`${'─'.repeat(70)}`);
  console.log(`  Trade PDAs  (${String(tradeCount).padStart(2)}):  ${totalTradeSol.toFixed(6)} SOL   $${(totalTradeSol * SOL_PRICE).toFixed(2)}`);
  console.log(`  Escrow PDAs (${String(escrowCount).padStart(2)}):  ${totalEscrowSol.toFixed(6)} SOL   $${(totalEscrowSol * SOL_PRICE).toFixed(2)}`);
  console.log(`  Vault ATAs  (${String(vaultCount).padStart(2)}):  ${totalVaultSol.toFixed(6)} SOL   $${(totalVaultSol * SOL_PRICE).toFixed(2)}`);
  console.log(`  ${'─'.repeat(50)}`);
  console.log(`  TOTAL          :  ${totalSol.toFixed(6)} SOL   $${(totalSol * SOL_PRICE).toFixed(2)}`);
  console.log(`${'═'.repeat(70)}\n`);
}

main().then(() => process.exit(0)).catch(e => { console.error("❌", e); process.exit(1); });
