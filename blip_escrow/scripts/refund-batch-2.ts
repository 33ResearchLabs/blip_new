import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, getAccount, createTransferInstruction } from "@solana/spl-token";
import bs58 from "bs58";
import idl from "../target/idl/blip_protocol_v2.json";

const PROGRAM_ID = new PublicKey("gfFC2pjvRCALNehRWJb2ce81eDXJMwJdg9W7yeLyBqS");
const USDT_MINT = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
const STUCK_TRADES = [
  "7eh5F6JKqWm7JbKfHtXbbG9vs8QUv9ALLAdfUpfeTiRQ",
  "9LUjAvhujz9bUA5bdeYzs2ibFGXVDqt6gEgEtjWRqVwk",
];

async function main() {
  const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const kp = Keypair.fromSecretKey(new Uint8Array(bs58.decode(process.env.SECRET_KEY_BS58!)));
  const wallet = new anchor.Wallet(kp);
  const provider = new anchor.AnchorProvider(conn, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new Program(idl as any, provider);
  const ata = await getAssociatedTokenAddress(USDT_MINT, kp.publicKey);
  const dst = new PublicKey(process.env.SWEEP_TO!);

  for (const pda of STUCK_TRADES) {
    const tradePda = new PublicKey(pda);
    const t: any = await (program.account as any).trade.fetch(tradePda);
    const status = Object.keys(t.status)[0];
    console.log(`\n${pda}: status=${status}, amount=${Number(t.amount)/1e6}`);
    if (status !== "funded") { console.log("  skip"); continue; }
    const [escrow] = PublicKey.findProgramAddressSync([Buffer.from("escrow-v2"), tradePda.toBuffer()], PROGRAM_ID);
    const [vauth] = PublicKey.findProgramAddressSync([Buffer.from("vault-authority-v2"), escrow.toBuffer()], PROGRAM_ID);
    const vata = await getAssociatedTokenAddress(USDT_MINT, vauth, true);
    const sig = await (program.methods as any).refundEscrow().accounts({
      signer: kp.publicKey, trade: tradePda, escrow, vaultAuthority: vauth, vaultAta: vata,
      depositorAta: ata, depositor: kp.publicKey, mint: USDT_MINT, tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([kp]).rpc({ commitment: "confirmed" });
    console.log(`  ✅ https://solscan.io/tx/${sig}`);
  }

  // Sweep
  let bal = 0n;
  try { bal = (await getAccount(conn, ata)).amount; } catch {}
  console.log(`\nUSDT in wallet: ${Number(bal)/1e6}`);
  if (bal > 0n) {
    const dstAta = await getAssociatedTokenAddress(USDT_MINT, dst);
    const tx = new Transaction();
    try { await getAccount(conn, dstAta); }
    catch { tx.add(createAssociatedTokenAccountInstruction(kp.publicKey, dstAta, dst, USDT_MINT)); }
    tx.add(createTransferInstruction(ata, dstAta, kp.publicKey, bal));
    const sig = await sendAndConfirmTransaction(conn, tx, [kp], { commitment: "confirmed" });
    console.log(`✅ swept ${Number(bal)/1e6} USDT: https://solscan.io/tx/${sig}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
