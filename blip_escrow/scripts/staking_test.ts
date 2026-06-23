/**
 * staking_test.ts — devnet end-to-end for blip_staking.
 * Run: ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *      ANCHOR_WALLET=/Users/apple/Documents/Jeys/blip-v3-devnet-wallet.json \
 *      npx tsx scripts/staking_test.ts
 *
 * Authority/treasury = provider wallet (also USDT mint authority). A SEPARATE
 * generated staker is used so the 10% early-unstake fee to treasury is
 * observable. Proves: init, stake, early-unstake 10% fee split, min enforcement.
 */
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount, mintTo, getAccount, getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import idl from "../target/idl/blip_staking.json";

const MINT = new PublicKey("5AzTK6KUfGT5yim4hwfbwcyf2wB5Aw72dxgKdBtCjdzn");
const USDT = (n: number) => new anchor.BN(n * 1_000_000);
let failed = false;
const ok = (c: boolean, m: string) => { console.log(`   ${c ? "✅" : "❌"} ${m}`); if (!c) failed = true; };
async function expectErr(label: string, code: string, fn: () => Promise<any>) {
  try { await fn(); ok(false, `${label} — expected ${code} but succeeded`); }
  catch (e: any) { ok((e.toString() + JSON.stringify(e.logs ?? "")).includes(code), `${label} — rejected (${code})`); }
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new anchor.Program(idl as any, provider);
  const conn = provider.connection;
  const authority = (provider.wallet as anchor.Wallet).payer; // also treasury
  const staker = Keypair.generate(); // separate staker (signs; provider pays fees)
  const pid = program.programId;
  console.log("Program:", pid.toBase58());
  console.log("Authority/treasury:", authority.publicKey.toBase58());
  console.log("Staker:", staker.publicKey.toBase58(), "\n");

  const [config] = PublicKey.findProgramAddressSync([Buffer.from("stake-config")], pid);
  const [vaultAuth] = PublicKey.findProgramAddressSync([Buffer.from("stake-vault-authority")], pid);
  const [position] = PublicKey.findProgramAddressSync([Buffer.from("stake"), staker.publicKey.toBuffer()], pid);
  const vault = getAssociatedTokenAddressSync(MINT, vaultAuth, true);
  const stakerAta = (await getOrCreateAssociatedTokenAccount(conn, authority, MINT, staker.publicKey)).address;
  const treasuryAta = (await getOrCreateAssociatedTokenAccount(conn, authority, MINT, authority.publicKey)).address;
  await mintTo(conn, authority, MINT, stakerAta, authority, 400 * 1_000_000);
  // Fund the staker with a little SOL — it pays rent for its own StakePosition PDA.
  await provider.sendAndConfirm(
    new Transaction().add(SystemProgram.transfer({
      fromPubkey: authority.publicKey, toPubkey: staker.publicKey, lamports: 0.05 * 1e9,
    })),
  );
  console.log("🪙 minted 400 test USDT + 0.05 SOL to staker\n");

  // ensure config exists (idempotent: init if missing, else leave as-is)
  let inited = false;
  try { await (program.account as any).stakeConfig.fetch(config); inited = true; } catch {}
  if (!inited) {
    await program.methods.initializeConfig({ minStake: USDT(100), unstakeCooldown: new anchor.BN(0) })
      .accountsPartial({ authority: authority.publicKey, config, mint: MINT, vaultAuthority: vaultAuth, vault,
        tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).rpc();
    console.log("1️⃣ config initialized (min $100)");
  } else { console.log("1️⃣ config already initialized (min $100)"); }

  // stake $100
  await program.methods.stake(USDT(100))
    .accountsPartial({ staker: staker.publicKey, config, position, vault, stakerAta,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .signers([staker]).rpc();
  let pos: any = await (program.account as any).stakePosition.fetch(position);
  console.log("2️⃣ staked $100");
  ok(pos.amount.toNumber() === 100_000_000, "position.amount = 100");

  // early unstake $100 → 10% fee: staker +90, treasury +10
  const stBefore = Number((await getAccount(conn, stakerAta)).amount);
  const trBefore = Number((await getAccount(conn, treasuryAta)).amount);
  await program.methods.unstake(USDT(100))
    .accountsPartial({ staker: staker.publicKey, config, position, vaultAuthority: vaultAuth, vault,
      stakerAta, treasuryAta, tokenProgram: TOKEN_PROGRAM_ID })
    .signers([staker]).rpc();
  const stGot = Number((await getAccount(conn, stakerAta)).amount) - stBefore;
  const trGot = Number((await getAccount(conn, treasuryAta)).amount) - trBefore;
  pos = await (program.account as any).stakePosition.fetch(position);
  console.log(`3️⃣ early-unstaked $100 — staker +${stGot / 1e6}, treasury +${trGot / 1e6}`);
  ok(stGot === 90_000_000, "staker received 90 (after 10% fee)");
  ok(trGot === 10_000_000, "treasury received 10 (10% early fee)");
  ok(pos.amount.toNumber() === 0, "position.amount = 0");

  // stake below minimum → blocked
  await expectErr("4️⃣ stake $50 (< $100 min)", "BelowMinimum", () =>
    program.methods.stake(USDT(50)).accountsPartial({ staker: staker.publicKey, config, position, vault, stakerAta,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).signers([staker]).rpc());

  // 5) AUTHORITY slash: re-stake $100, then arbiter seizes it → treasury (victim wallet in prod)
  await program.methods.stake(USDT(100)).accountsPartial({ staker: staker.publicKey, config, position, vault, stakerAta,
    tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).signers([staker]).rpc();
  const trB = Number((await getAccount(conn, treasuryAta)).amount);
  await program.methods.slash(USDT(100)).accountsPartial({ authority: authority.publicKey, config, position,
    vaultAuthority: vaultAuth, vault, recipientAta: treasuryAta, tokenProgram: TOKEN_PROGRAM_ID }).rpc();
  const slashed = Number((await getAccount(conn, treasuryAta)).amount) - trB;
  pos = await (program.account as any).stakePosition.fetch(position);
  console.log(`5️⃣ authority slashed $100 → recipient +${slashed / 1e6}`);
  ok(slashed === 100_000_000, "recipient received the full slashed 100");
  ok(pos.amount.toNumber() === 0, "slashed position.amount = 0");

  // 6) non-authority CANNOT slash
  await expectErr("6️⃣ slash by non-authority", "Unauthorized", () =>
    program.methods.slash(USDT(1)).accountsPartial({ authority: staker.publicKey, config, position,
      vaultAuthority: vaultAuth, vault, recipientAta: treasuryAta, tokenProgram: TOKEN_PROGRAM_ID }).signers([staker]).rpc());

  // 7) AUTHORITY charge (subscription/fee): re-stake $100, charge $30 → treasury
  await program.methods.stake(USDT(100)).accountsPartial({ staker: staker.publicKey, config, position, vault, stakerAta,
    tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).signers([staker]).rpc();
  const trC = Number((await getAccount(conn, treasuryAta)).amount);
  await program.methods.charge(USDT(30)).accountsPartial({ authority: authority.publicKey, config, position,
    vaultAuthority: vaultAuth, vault, treasuryAta, tokenProgram: TOKEN_PROGRAM_ID }).rpc();
  const charged = Number((await getAccount(conn, treasuryAta)).amount) - trC;
  pos = await (program.account as any).stakePosition.fetch(position);
  console.log(`7️⃣ authority charged $30 (fee) → treasury +${charged / 1e6}, stake left ${pos.amount.toNumber() / 1e6}`);
  ok(charged === 30_000_000, "treasury received the $30 charge");
  ok(pos.amount.toNumber() === 70_000_000, "stake reduced to 70");

  // 8) non-authority CANNOT charge
  await expectErr("8️⃣ charge by non-authority", "Unauthorized", () =>
    program.methods.charge(USDT(1)).accountsPartial({ authority: staker.publicKey, config, position,
      vaultAuthority: vaultAuth, vault, treasuryAta, tokenProgram: TOKEN_PROGRAM_ID }).signers([staker]).rpc());

  console.log("\n" + (failed ? "❌ SOME CHECKS FAILED" : "🎉 ALL STAKING CHECKS PASSED (lock + early fee + slash + charge)"));
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error("❌", e); process.exit(1); });
