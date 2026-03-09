/**
 * 10K/min target benchmark — push Solana devnet to the limit
 * Tests increasing concurrency levels to find the ceiling
 */

import {
  Keypair, Connection, Transaction, SystemProgram,
  LAMPORTS_PER_SOL, sendAndConfirmTransaction, PublicKey,
} from '@solana/web3.js';
import fs from 'fs';

const HELIUS_RPC = 'https://devnet.helius-rpc.com/?api-key=b8dab187-ffb1-40c7-b8a9-cb3f488a1d94';
const connection = new Connection(HELIUS_RPC, 'confirmed');

function loadCliKeypair(): Keypair {
  const keyPath = `${process.env.HOME}/.config/solana/id.json`;
  const raw = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function fundRecipient(sender: Keypair, recipient: PublicKey) {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: sender.publicKey,
      toPubkey: recipient,
      lamports: 0.002 * LAMPORTS_PER_SOL,
    })
  );
  await sendAndConfirmTransaction(connection, tx, [sender], { commitment: 'confirmed' });
}

async function blastFireAndForget(sender: Keypair, recipient: PublicKey, total: number, concurrency: number) {
  console.log(`\n--- F&F: ${total} txs, ${concurrency} concurrent ---`);

  const { blockhash } = await connection.getLatestBlockhash();
  let sent = 0;
  let failed = 0;
  const sigs: string[] = [];
  const start = performance.now();

  for (let batch = 0; batch < total; batch += concurrency) {
    const batchSize = Math.min(concurrency, total - batch);
    const promises = [];

    for (let i = 0; i < batchSize; i++) {
      const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: sender.publicKey, toPubkey: recipient, lamports: 1000 })
      );
      tx.recentBlockhash = blockhash;
      tx.feePayer = sender.publicKey;
      tx.sign(sender);

      promises.push(
        connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 2 })
          .then(sig => { sent++; sigs.push(sig); })
          .catch(() => { failed++; })
      );
    }
    await Promise.all(promises);
  }

  const elapsed = performance.now() - start;
  const tps = sent / (elapsed / 1000);
  const perMin = Math.floor(tps * 60);

  console.log(`  Sent: ${sent}/${total} | Failed: ${failed} | ${(elapsed / 1000).toFixed(2)}s`);
  console.log(`  ${tps.toFixed(1)} tx/sec | ~${perMin}/min`);

  // Verify a sample
  if (sigs.length > 0) {
    await new Promise(r => setTimeout(r, 5000));
    let confirmed = 0;
    const sample = sigs.slice(0, Math.min(10, sigs.length));
    for (const sig of sample) {
      try {
        const status = await connection.getSignatureStatus(sig);
        if (status.value?.confirmationStatus === 'confirmed' || status.value?.confirmationStatus === 'finalized') {
          confirmed++;
        }
      } catch {}
    }
    console.log(`  On-chain verification: ${confirmed}/${sample.length} sampled confirmed`);
  }

  return { tps, perMin, sent, failed };
}

// Multi-sender: use multiple keypairs to avoid nonce conflicts
async function blastMultiSender(senders: Keypair[], recipient: PublicKey, total: number, concurrency: number) {
  console.log(`\n--- MULTI-SENDER F&F: ${senders.length} senders, ${total} txs, ${concurrency} concurrent ---`);

  const { blockhash } = await connection.getLatestBlockhash();
  let sent = 0;
  let failed = 0;
  const sigs: string[] = [];
  const start = performance.now();

  for (let batch = 0; batch < total; batch += concurrency) {
    const batchSize = Math.min(concurrency, total - batch);
    const promises = [];

    for (let i = 0; i < batchSize; i++) {
      const sender = senders[(batch + i) % senders.length];
      const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: sender.publicKey, toPubkey: recipient, lamports: 1000 })
      );
      tx.recentBlockhash = blockhash;
      tx.feePayer = sender.publicKey;
      tx.sign(sender);

      promises.push(
        connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 2 })
          .then(sig => { sent++; sigs.push(sig); })
          .catch(() => { failed++; })
      );
    }
    await Promise.all(promises);
  }

  const elapsed = performance.now() - start;
  const tps = sent / (elapsed / 1000);
  const perMin = Math.floor(tps * 60);

  console.log(`  Sent: ${sent}/${total} | Failed: ${failed} | ${(elapsed / 1000).toFixed(2)}s`);
  console.log(`  ${tps.toFixed(1)} tx/sec | ~${perMin}/min`);

  if (sigs.length > 0) {
    await new Promise(r => setTimeout(r, 5000));
    let confirmed = 0;
    const sample = sigs.slice(0, Math.min(10, sigs.length));
    for (const sig of sample) {
      try {
        const status = await connection.getSignatureStatus(sig);
        if (status.value?.confirmationStatus === 'confirmed' || status.value?.confirmationStatus === 'finalized') {
          confirmed++;
        }
      } catch {}
    }
    console.log(`  On-chain verification: ${confirmed}/${sample.length} sampled confirmed`);
  }

  return { tps, perMin, sent, failed };
}

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  10K/min Target — Concurrency Scaling Test   ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`RPC: Helius Devnet (free tier)`);
  console.log(`Target: 167 tx/sec = 10,000/min\n`);

  const sender = loadCliKeypair();
  const balance = await connection.getBalance(sender.publicKey);
  console.log(`Keypair: ${sender.publicKey.toBase58().slice(0, 16)}...`);
  console.log(`Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  const recipient = Keypair.generate().publicKey;
  console.log(`Pre-funding recipient...`);
  await fundRecipient(sender, recipient);

  // Test increasing concurrency with single sender
  const results: { concurrency: number; tps: number; perMin: number }[] = [];

  for (const c of [10, 25, 50, 100]) {
    const r = await blastFireAndForget(sender, recipient, Math.min(c * 2, 200), c);
    results.push({ concurrency: c, ...r });
  }

  // Multi-sender test: generate 5 funded sub-keypairs
  console.log(`\n--- Funding 5 sub-senders (0.01 SOL each)... ---`);
  const subSenders: Keypair[] = [];
  for (let i = 0; i < 5; i++) {
    const kp = Keypair.generate();
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sender.publicKey,
        toPubkey: kp.publicKey,
        lamports: 0.01 * LAMPORTS_PER_SOL,
      })
    );
    await sendAndConfirmTransaction(connection, tx, [sender], { commitment: 'confirmed' });
    subSenders.push(kp);
    process.stdout.write(`  Funded sender ${i + 1}/5\n`);
  }

  const multiResult = await blastMultiSender(subSenders, recipient, 200, 50);

  // Summary
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║            SCALING RESULTS                    ║');
  console.log('╠══════════════════════════════════════════════╣');
  for (const r of results) {
    const bar = '█'.repeat(Math.min(Math.floor(r.perMin / 200), 30));
    console.log(`║  1 sender × ${String(r.concurrency).padStart(3)} conc: ${r.tps.toFixed(1).padStart(6)} tx/s ${String(r.perMin).padStart(5)}/min ${bar}`);
  }
  console.log('╠──────────────────────────────────────────────╣');
  console.log(`║  5 senders × 50 conc: ${multiResult.tps.toFixed(1).padStart(6)} tx/s ${String(multiResult.perMin).padStart(5)}/min`);
  console.log('╠──────────────────────────────────────────────╣');
  console.log(`║  Target: 167.0 tx/s 10000/min`);
  console.log('╚══════════════════════════════════════════════╝');

  const best = Math.max(...results.map(r => r.perMin), multiResult.perMin);
  const gap = 10000 - best;
  if (gap > 0) {
    console.log(`\nGap to 10K: ${gap}/min short`);
    console.log('To reach 10K/min you need:');
    console.log('  1. Paid Helius/Triton dedicated RPC (no rate limits)');
    console.log('  2. 20+ funded sender keypairs (avoid nonce conflicts)');
    console.log('  3. Mainnet (devnet is throttled by design)');
    console.log('  4. 100+ concurrent connections');
  }
}

main().catch(console.error);
