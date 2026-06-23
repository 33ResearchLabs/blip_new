/**
 * staking_test.ts — devnet end-to-end for blip_staking.
 * Run: ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *      ANCHOR_WALLET=/Users/apple/Documents/Jeys/blip-v3-devnet-wallet.json \
 *      npx tsx scripts/staking_test.ts
 *
 * Authority + staker = the provider wallet (also the USDT mint authority, so it
 * mints itself test USDT). Proves: init, stake, min enforcement, cooldown block,
 * unstake + fund return. Leaves config at the production 24h cooldown.
 */
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount, mintTo, getAccount, getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import idl from "../target/idl/blip_staking.json";

const MINT = new PublicKey("5AzTK6KUfGT5yim4hwfbwcyf2wB5Aw72dxgKdBtCjdzn");
const USDT = (n: number) => new anchor.BN(n * 1_000_000);
const COOLDOWN = 24 * 60 * 60;
let failed = false;
const ok = (c: boolean, m: string) => { console.log(`   ${c ? "✅" : "❌"} ${m}`); if (!c) failed = true; };

async function expectErr(label: string, code: string, fn: () => Promise<any>) {
  try { await fn(); ok(false, `${label} — expected ${code} but it succeeded`); }
  catch (e: any) {
    const s = e.toString() + JSON.stringify(e.logs ?? e.error ?? "");
    ok(s.includes(code), `${label} — correctly rejected (${code})`);
  }
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new anchor.Program(idl as any, provider);
  const conn = provider.connection;
  const w = (provider.wallet as anchor.Wallet).payer;
  const pid = program.programId;
  console.log("Program:", pid.toBase58());
  console.log("Staker/authority:", w.publicKey.toBase58(), "\n");

  const [config] = PublicKey.findProgramAddressSync([Buffer.from("stake-config")], pid);
  const [vaultAuth] = PublicKey.findProgramAddressSync([Buffer.from("stake-vault-authority")], pid);
  const [position] = PublicKey.findProgramAddressSync([Buffer.from("stake"), w.publicKey.toBuffer()], pid);
  const vault = getAssociatedTokenAddressSync(MINT, vaultAuth, true);
  const stakerAta = (await getOrCreateAssociatedTokenAccount(conn, w, MINT, w.publicKey)).address;

  // fund staker with test USDT (we are the mint authority)
  await mintTo(conn, w, MINT, stakerAta, w, 500 * 1_000_000);
  console.log("🪙 minted 500 test USDT to staker\n");

  // 1) init config (skip if already initialized)
  let inited = false;
  try { await (program.account as any).stakeConfig.fetch(config); inited = true; } catch {}
  if (!inited) {
    await program.methods.initializeConfig({ minStake: USDT(100), unstakeCooldown: new anchor.BN(COOLDOWN) })
      .accountsPartial({ authority: w.publicKey, config, mint: MINT, vaultAuthority: vaultAuth, vault,
        tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
      .rpc();
    console.log("1️⃣ config initialized (min $100, cooldown 24h)");
  } else {
    await program.methods.updateConfig({ minStake: USDT(100), unstakeCooldown: new anchor.BN(COOLDOWN), isFrozen: null, newAuthority: null })
      .accountsPartial({ authority: w.publicKey, config }).rpc();
    console.log("1️⃣ config already existed — reset to min $100 / 24h cooldown");
  }

  // 2) stake $100
  await program.methods.stake(USDT(100))
    .accountsPartial({ staker: w.publicKey, config, position, vault, stakerAta: stakerAta,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).rpc();
  let pos: any = await (program.account as any).stakePosition.fetch(position);
  let vbal = Number((await getAccount(conn, vault)).amount);
  console.log("2️⃣ staked $100");
  ok(pos.amount.toNumber() === 100_000_000, "position.amount = 100");
  ok(vbal === 100_000_000, "vault holds 100 USDT");

  // 3) unstake before cooldown -> blocked
  await expectErr("3️⃣ unstake pre-cooldown", "CooldownActive", () =>
    program.methods.unstake(USDT(100)).accountsPartial({ staker: w.publicKey, config, position,
      vaultAuthority: vaultAuth, vault, stakerAta: stakerAta, tokenProgram: TOKEN_PROGRAM_ID }).rpc());

  // 4) drop cooldown to 0, unstake succeeds, funds returned
  await program.methods.updateConfig({ minStake: null, unstakeCooldown: new anchor.BN(0), isFrozen: null, newAuthority: null })
    .accountsPartial({ authority: w.publicKey, config }).rpc();
  const before = Number((await getAccount(conn, stakerAta)).amount);
  await program.methods.unstake(USDT(100)).accountsPartial({ staker: w.publicKey, config, position,
    vaultAuthority: vaultAuth, vault, stakerAta: stakerAta, tokenProgram: TOKEN_PROGRAM_ID }).rpc();
  const got = Number((await getAccount(conn, stakerAta)).amount) - before;
  pos = await (program.account as any).stakePosition.fetch(position);
  console.log("4️⃣ unstaked $100 (cooldown=0)");
  ok(got === 100_000_000, "100 USDT returned to staker");
  ok(pos.amount.toNumber() === 0, "position.amount = 0");

  // 5) stake below minimum -> blocked
  await expectErr("5️⃣ stake $50 (< $100 min)", "BelowMinimum", () =>
    program.methods.stake(USDT(50)).accountsPartial({ staker: w.publicKey, config, position, vault, stakerAta: stakerAta,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId }).rpc());

  // restore production cooldown
  await program.methods.updateConfig({ minStake: null, unstakeCooldown: new anchor.BN(COOLDOWN), isFrozen: null, newAuthority: null })
    .accountsPartial({ authority: w.publicKey, config }).rpc();
  console.log("\n6️⃣ restored cooldown to 24h");

  console.log("\n" + (failed ? "❌ SOME CHECKS FAILED" : "🎉 ALL STAKING CHECKS PASSED on devnet"));
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error("❌", e); process.exit(1); });
