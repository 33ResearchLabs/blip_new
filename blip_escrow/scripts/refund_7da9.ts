import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction,
  getAccount, createTransferInstruction,
} from "@solana/spl-token";
import bs58 from "bs58";
import idl from "../target/idl/blip_protocol_v2.json";

const PROGRAM_ID = new PublicKey("gfFC2pjvRCALNehRWJb2ce81eDXJMwJdg9W7yeLyBqS");
const USDT_MINT  = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");

// BM-260607-7DA9: disputed SELL order — 10 USDT stuck on-chain
const TRADE_PDA  = new PublicKey("7ZxABWMBrFpXkW1eoUpGFhBZfvJPLFfaDF69UBFnH23C");
const ESCROW_PDA = new PublicKey("DVp2UkQMe6WHWCGf6wqaYx3uLpvW4FkqjrP3q7CVd4Mg");
// zoopweb33 main wallet — sweep recovered USDT here
const SWEEP_TO   = new PublicKey("FFMBpnJqtu461tmroQd6Fj6bi3EV2WGxiPhKPWeejJLp");

async function withRetry<T>(label: string, fn: () => Promise<T>, max = 4): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < max; i++) {
    try { return await fn(); }
    catch (e: any) {
      lastErr = e;
      console.log(`   retry ${i+1}/${max} on ${label}: ${e.message?.slice(0, 100)}`);
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

async function main() {
  const bs58Key = process.env.SECRET_KEY_BS58;
  if (!bs58Key) throw new Error("SECRET_KEY_BS58 env var required");

  const depositor = Keypair.fromSecretKey(new Uint8Array(bs58.decode(bs58Key)));
  console.log(`Depositor: ${depositor.publicKey.toBase58()}`);

  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(depositor), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new Program(idl as any, provider);

  const depositorAta = await getAssociatedTokenAddress(USDT_MINT, depositor.publicKey);

  // Verify trade state
  const trade: any = await (program.account as any).trade.fetch(TRADE_PDA);
  const status = Object.keys(trade.status)[0];
  const amount = Number(trade.amount) / 1e6;
  console.log(`Trade status: ${status}, amount: ${amount} USDT`);

  if (status !== "funded") {
    console.log(`Trade is already ${status} — nothing to refund`);
    return;
  }
  if (!trade.creator.equals(depositor.publicKey)) {
    throw new Error(`Creator mismatch — expected ${trade.creator.toBase58()}`);
  }

  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault-authority-v2"), ESCROW_PDA.toBuffer()],
    PROGRAM_ID
  );
  const vaultAta = await getAssociatedTokenAddress(USDT_MINT, vaultAuthority, true);

  // Protocol config PDA — ["protocol-config"] (fetched earlier: 2K1ucbvLoS3S7H8Ft8dsLbmxo39pmwnGY4WRN9R8KJL9)
  const [protocolConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol-config")],
    PROGRAM_ID
  );
  const PROTOCOL_AUTHORITY = new PublicKey("BEV2d9i6Vu9bn5YXkD2MmZAFVxzNCabzK3NV6Aej6C3S");

  console.log(`\n──── refund_escrow ────`);
  console.log(`  protocolConfig: ${protocolConfig.toBase58()}`);
  console.log(`  vaultAuthority: ${vaultAuthority.toBase58()}`);
  console.log(`  vaultAta:       ${vaultAta.toBase58()}`);
  console.log(`  depositorAta:   ${depositorAta.toBase58()}`);

  const sig = await withRetry("refund_escrow", () =>
    (program.methods as any)
      .refundEscrow()
      .accounts({
        signer: depositor.publicKey,
        protocolConfig,
        trade: TRADE_PDA,
        escrow: ESCROW_PDA,
        vaultAuthority,
        vaultAta,
        depositorAta,
        depositor: depositor.publicKey,
        tradeCreator: depositor.publicKey,
        protocolAuthority: PROTOCOL_AUTHORITY,
        mint: USDT_MINT,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([depositor])
      .rpc({ commitment: "confirmed" })
  );
  console.log(`✅ refund_escrow: https://solscan.io/tx/${sig}`);

  // Sweep recovered USDT to zoopweb33 main wallet
  let usdtBal = 0;
  try {
    const acc = await getAccount(conn, depositorAta);
    usdtBal = Number(acc.amount) / 1e6;
  } catch {}
  console.log(`Depositor USDT balance: ${usdtBal}`);

  if (usdtBal > 0) {
    console.log(`\n──── sweep ${usdtBal} USDT → zoopweb33 main wallet ────`);
    const sweepDestAta = await getAssociatedTokenAddress(USDT_MINT, SWEEP_TO);
    const tx = new Transaction();
    try { await getAccount(conn, sweepDestAta); }
    catch {
      console.log(`(creating destination ATA)`);
      tx.add(createAssociatedTokenAccountInstruction(depositor.publicKey, sweepDestAta, SWEEP_TO, USDT_MINT));
    }
    tx.add(createTransferInstruction(depositorAta, sweepDestAta, depositor.publicKey, Math.round(usdtBal * 1e6)));
    const sweepSig = await withRetry("sweep", () =>
      sendAndConfirmTransaction(conn, tx, [depositor], { commitment: "confirmed" })
    );
    console.log(`✅ swept ${usdtBal} USDT: https://solscan.io/tx/${sweepSig}`);
  }

  console.log(`\n🏁 Done.`);
}

main().then(() => process.exit(0)).catch(e => { console.error("❌", e); process.exit(1); });
