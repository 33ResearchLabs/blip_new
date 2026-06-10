/**
 * audit_all_accounts.ts
 * Fetches all Trade PDAs via Anchor (correct parsing), checks every vault ATA balance.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import idl from "../target/idl/blip_protocol_v2.json";

const PROGRAM_ID = new PublicKey("gfFC2pjvRCALNehRWJb2ce81eDXJMwJdg9W7yeLyBqS");
const USDT_MINT   = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
const RPC = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";

const ESCROW_DISC = Buffer.from([31, 213, 123, 187, 186, 22, 218, 155]);

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry<T>(label: string, fn: () => Promise<T>, max = 6): Promise<T> {
  let last: any;
  for (let i = 0; i < max; i++) {
    try { return await fn(); }
    catch (e: any) {
      last = e;
      const delay = 3000 * (i + 1);
      process.stdout.write(`  [retry ${i+1}/${max} on ${label} — wait ${delay/1000}s]\n`);
      await sleep(delay);
    }
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
  console.log(`  BLIP ESCROW — FULL AUDIT (Anchor-parsed)`);
  console.log(`${'═'.repeat(70)}\n`);

  // ── 1. Fetch all Trade accounts via Anchor ──────────────────────────
  console.log("Fetching all Trade accounts via Anchor…");
  const trades = await withRetry("trade.all", () => (program.account as any).trade.all());
  console.log(`Found ${trades.length} Trade accounts\n`);

  await sleep(2000);

  // ── 2. Fetch all Escrow accounts (raw — only 2 expected) ────────────
  console.log("Fetching all Escrow accounts…");
  const escrowRaw = await withRetry("escrow.all", () =>
    conn.getProgramAccounts(PROGRAM_ID, {
      filters: [{ memcmp: { offset: 0, bytes: anchor.utils.bytes.bs58.encode(ESCROW_DISC) } }],
    })
  );
  console.log(`Found ${escrowRaw.length} Escrow accounts\n`);
  await sleep(1000);

  // Parse escrows for depositor lookup
  const escrowByTrade = new Map<string, { depositor: string; escrowPda: string }>();
  for (const { pubkey, account } of escrowRaw) {
    const d = account.data;
    if (d.length < 72) continue;
    const tradePubkey = new PublicKey(d.slice(8, 40)).toBase58();
    const depositor   = new PublicKey(d.slice(40, 72)).toBase58();
    escrowByTrade.set(tradePubkey, { depositor, escrowPda: pubkey.toBase58() });
  }

  // ── 3. Group trades by status ───────────────────────────────────────
  type TradeEntry = {
    pubkey: string;
    tradeId: string;
    creator: string;
    amount: number;
    status: string;
    side: string;
    counterparty: string | null;
    escrowPda: PublicKey;
    vaultAta: PublicKey;
    depositor?: string;
  };

  const allTrades: TradeEntry[] = [];

  for (const { publicKey, account } of trades) {
    const status = Object.keys(account.status)[0];
    const side   = Object.keys(account.side)[0];
    const amount = Number(account.amount) / 1e6;
    const counterparty = account.counterparty?.toBase58() ?? null;

    const [escrowPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow-v2"), publicKey.toBuffer()],
      PROGRAM_ID
    );
    const [vaultAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault-authority-v2"), escrowPda.toBuffer()],
      PROGRAM_ID
    );
    const vaultAta = getAssociatedTokenAddressSync(USDT_MINT, vaultAuth, true);
    const escrowInfo = escrowByTrade.get(publicKey.toBase58());

    allTrades.push({
      pubkey: publicKey.toBase58(),
      tradeId: account.tradeId.toString(),
      creator: account.creator.toBase58(),
      amount,
      status,
      side,
      counterparty,
      escrowPda,
      vaultAta,
      depositor: escrowInfo?.depositor,
    });
  }

  // ── 4. Summary ──────────────────────────────────────────────────────
  const byStatus: Record<string, TradeEntry[]> = {};
  for (const t of allTrades) {
    (byStatus[t.status] ??= []).push(t);
  }

  console.log(`${'─'.repeat(70)}`);
  console.log(`  SUMMARY`);
  console.log(`${'─'.repeat(70)}`);
  const order = ['funded','locked','paymentSent','disputed','created','released','refunded'];
  for (const status of [...order, ...Object.keys(byStatus).filter(s => !order.includes(s))]) {
    const list = byStatus[status];
    if (!list) continue;
    const vol = list.reduce((s, t) => s + t.amount, 0);
    const flag = ['funded','locked','paymentSent','disputed'].includes(status) ? '⚠️ ' : '   ';
    console.log(`${flag}${status.padEnd(14)} ${String(list.length).padStart(3)} trades   ${vol.toFixed(6).padStart(14)} USDT`);
  }
  console.log();

  // ── 5. Check vault balances for ALL non-terminal trades ─────────────
  const openStatuses = ['funded','locked','paymentSent','disputed','created'];
  const openTrades = allTrades.filter(t => openStatuses.includes(t.status));

  // Also check ALL trades' vault ATAs — some may have been marked
  // released/refunded in DB but vault never actually closed on-chain.
  console.log(`${'─'.repeat(70)}`);
  console.log(`  VAULT BALANCE CHECK — all ${allTrades.length} trades`);
  console.log(`${'─'.repeat(70)}\n`);

  // Batch getMultipleAccountsInfo in chunks of 100
  const CHUNK = 100;
  const vaultKeys = allTrades.map(t => t.vaultAta);
  const allVaultInfos: (anchor.web3.AccountInfo<Buffer> | null)[] = [];

  for (let i = 0; i < vaultKeys.length; i += CHUNK) {
    const chunk = vaultKeys.slice(i, i + CHUNK);
    const infos = await withRetry(`vault-chunk-${i}`, () => conn.getMultipleAccountsInfo(chunk));
    allVaultInfos.push(...infos);
    if (i + CHUNK < vaultKeys.length) await sleep(1500);
  }

  let totalStuck = 0;
  const stuck: (TradeEntry & { vaultBalance: number })[] = [];
  const surprises: (TradeEntry & { vaultBalance: number })[] = []; // closed on-chain but vault still has money

  for (let i = 0; i < allTrades.length; i++) {
    const t = allTrades[i];
    const info = allVaultInfos[i];
    let vaultBalance = 0;
    if (info?.data && info.data.length >= 72) {
      vaultBalance = Number((info.data as Buffer).readBigUInt64LE(64)) / 1e6;
    }

    if (vaultBalance > 0) {
      totalStuck += vaultBalance;
      if (openStatuses.includes(t.status)) {
        stuck.push({ ...t, vaultBalance });
      } else {
        surprises.push({ ...t, vaultBalance }); // released/refunded but vault not closed!
      }
    }
  }

  // Print open trades with balance
  if (stuck.length > 0) {
    console.log(`⚠️  OPEN TRADES WITH FUNDS (${stuck.length}):\n`);
    for (const t of stuck) {
      console.log(`  [${t.status.toUpperCase()}] trade_id=${t.tradeId}  ${t.vaultBalance.toFixed(6)} USDT  ${t.side}`);
      console.log(`  trade PDA:  ${t.pubkey}`);
      console.log(`  escrow PDA: ${t.escrowPda.toBase58()}`);
      console.log(`  vault ATA:  ${t.vaultAta.toBase58()}`);
      console.log(`  creator:    ${t.creator}`);
      if (t.depositor) console.log(`  depositor:  ${t.depositor}`);
      console.log();
    }
  }

  // Print surprises — these are the "dormant" funds
  if (surprises.length > 0) {
    console.log(`🚨 DORMANT FUNDS — marked released/refunded but vault still holds balance (${surprises.length}):\n`);
    for (const t of surprises) {
      console.log(`  [${t.status.toUpperCase()}] trade_id=${t.tradeId}  ${t.vaultBalance.toFixed(6)} USDT  ${t.side}`);
      console.log(`  trade PDA:  ${t.pubkey}`);
      console.log(`  escrow PDA: ${t.escrowPda.toBase58()}`);
      console.log(`  vault ATA:  ${t.vaultAta.toBase58()}`);
      console.log(`  creator:    ${t.creator}`);
      if (t.depositor) console.log(`  depositor:  ${t.depositor}`);
      console.log();
    }
  }

  if (stuck.length === 0 && surprises.length === 0) {
    console.log(`✅ No vault ATAs with balance found across all ${allTrades.length} trades.\n`);
  }

  console.log(`${'─'.repeat(70)}`);
  console.log(`  TOTAL BALANCE ACROSS ALL OPEN VAULT ATAs: ${totalStuck.toFixed(6)} USDT`);
  console.log(`  Open trades: ${stuck.length}   Dormant (closed on-chain, vault still has $): ${surprises.length}`);
  console.log(`${'═'.repeat(70)}\n`);
}

main().then(() => process.exit(0)).catch(e => { console.error("❌", e); process.exit(1); });
