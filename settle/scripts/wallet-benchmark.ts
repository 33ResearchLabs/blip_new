/**
 * Embedded Wallet Throughput Benchmark
 * Tests: signing speed, tx build speed, sequential tx/s, parallel tx/s on Solana devnet
 * Modes: normal (simulate+confirm), skipPreflight (send+confirm), fire-and-forget (send only)
 */

import {
  Keypair, Connection, Transaction, SystemProgram,
  LAMPORTS_PER_SOL, sendAndConfirmTransaction, PublicKey,
} from '@solana/web3.js';
import nacl from 'tweetnacl';
import fs from 'fs';

const HELIUS_RPC = 'https://devnet.helius-rpc.com/?api-key=b8dab187-ffb1-40c7-b8a9-cb3f488a1d94';
const connection = new Connection(HELIUS_RPC, 'confirmed');

function loadCliKeypair(): Keypair {
  const keyPath = `${process.env.HOME}/.config/solana/id.json`;
  const raw = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function benchmarkSigning(iterations: number) {
  console.log(`\n=== SIGNING BENCHMARK (${iterations} iterations) ===`);
  const keypair = Keypair.generate();
  const message = Buffer.from('benchmark test message for signing speed');

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    nacl.sign.detached(message, keypair.secretKey);
  }
  const elapsed = performance.now() - start;

  const perSec = Math.floor(iterations / (elapsed / 1000));
  console.log(`  ${iterations} signatures in ${elapsed.toFixed(1)}ms`);
  console.log(`  ${perSec.toLocaleString()} signatures/sec`);
  console.log(`  ${(elapsed / iterations).toFixed(3)}ms per signature`);
  return perSec;
}

async function benchmarkTxBuild(iterations: number) {
  console.log(`\n=== TX BUILD + SIGN BENCHMARK (${iterations} iterations) ===`);
  const keypair = Keypair.generate();
  const recipient = Keypair.generate().publicKey;
  const { blockhash } = await connection.getLatestBlockhash();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: recipient,
        lamports: 1000,
      })
    );
    tx.recentBlockhash = blockhash;
    tx.feePayer = keypair.publicKey;
    tx.sign(keypair);
  }
  const elapsed = performance.now() - start;

  const perSec = Math.floor(iterations / (elapsed / 1000));
  console.log(`  ${iterations} tx build+sign in ${elapsed.toFixed(1)}ms`);
  console.log(`  ${perSec.toLocaleString()} tx/sec (local, no network)`);
  console.log(`  ${(elapsed / iterations).toFixed(3)}ms per tx`);
  return perSec;
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

// Mode 1: Normal (simulate + confirm) — baseline
async function benchmarkSequentialNormal(sender: Keypair, recipient: PublicKey, count: number) {
  console.log(`\n=== SEQUENTIAL — NORMAL (simulate + confirm) ===`);
  const results: { success: boolean; time: number }[] = [];
  const overallStart = performance.now();

  for (let i = 0; i < count; i++) {
    const txStart = performance.now();
    try {
      const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: sender.publicKey, toPubkey: recipient, lamports: 1000 })
      );
      await sendAndConfirmTransaction(connection, tx, [sender], { commitment: 'confirmed' });
      const t = performance.now() - txStart;
      results.push({ success: true, time: t });
      process.stdout.write(`  [${i + 1}/${count}] ${t.toFixed(0)}ms OK\n`);
    } catch (e: any) {
      const t = performance.now() - txStart;
      results.push({ success: false, time: t });
      process.stdout.write(`  [${i + 1}/${count}] ${t.toFixed(0)}ms FAIL\n`);
    }
  }
  return summarize(results, overallStart);
}

// Mode 2: skipPreflight + confirm — saves 1 round-trip
async function benchmarkSequentialSkipPreflight(sender: Keypair, recipient: PublicKey, count: number) {
  console.log(`\n=== SEQUENTIAL — SKIP PREFLIGHT (send + confirm) ===`);
  const results: { success: boolean; time: number }[] = [];
  const overallStart = performance.now();

  for (let i = 0; i < count; i++) {
    const txStart = performance.now();
    try {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: sender.publicKey, toPubkey: recipient, lamports: 1000 })
      );
      tx.recentBlockhash = blockhash;
      tx.feePayer = sender.publicKey;
      tx.sign(sender);

      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true, maxRetries: 3,
      });
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });
      const t = performance.now() - txStart;
      results.push({ success: true, time: t });
      process.stdout.write(`  [${i + 1}/${count}] ${t.toFixed(0)}ms OK\n`);
    } catch (e: any) {
      const t = performance.now() - txStart;
      results.push({ success: false, time: t });
      process.stdout.write(`  [${i + 1}/${count}] ${t.toFixed(0)}ms FAIL\n`);
    }
  }
  return summarize(results, overallStart);
}

// Mode 3: Fire-and-forget — send only, no confirmation wait
async function benchmarkSequentialFireAndForget(sender: Keypair, recipient: PublicKey, count: number) {
  console.log(`\n=== SEQUENTIAL — FIRE & FORGET (send only, no confirm) ===`);
  const results: { success: boolean; time: number }[] = [];
  const sigs: string[] = [];
  const overallStart = performance.now();

  const { blockhash } = await connection.getLatestBlockhash();

  for (let i = 0; i < count; i++) {
    const txStart = performance.now();
    try {
      const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: sender.publicKey, toPubkey: recipient, lamports: 1000 })
      );
      tx.recentBlockhash = blockhash;
      tx.feePayer = sender.publicKey;
      tx.sign(sender);

      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true, maxRetries: 3,
      });
      sigs.push(sig);
      const t = performance.now() - txStart;
      results.push({ success: true, time: t });
      process.stdout.write(`  [${i + 1}/${count}] ${t.toFixed(0)}ms sent\n`);
    } catch (e: any) {
      const t = performance.now() - txStart;
      results.push({ success: false, time: t });
      process.stdout.write(`  [${i + 1}/${count}] ${t.toFixed(0)}ms FAIL\n`);
    }
  }

  const summary = summarize(results, overallStart);

  // Now verify how many actually landed
  console.log(`  Verifying ${sigs.length} signatures...`);
  await new Promise(r => setTimeout(r, 5000)); // wait 5s for confirmations
  let confirmed = 0;
  for (const sig of sigs) {
    const status = await connection.getSignatureStatus(sig);
    if (status.value?.confirmationStatus === 'confirmed' || status.value?.confirmationStatus === 'finalized') {
      confirmed++;
    }
  }
  console.log(`  ${confirmed}/${sigs.length} confirmed on-chain after 5s wait`);

  return summary;
}

// Mode 4: Parallel skipPreflight + confirm
async function benchmarkParallel(sender: Keypair, recipient: PublicKey, count: number, concurrency: number) {
  console.log(`\n=== PARALLEL — SKIP PREFLIGHT (${concurrency} concurrent, ${count} total) ===`);
  let succeeded = 0;
  let failed = 0;
  const overallStart = performance.now();

  for (let batch = 0; batch < count; batch += concurrency) {
    const batchSize = Math.min(concurrency, count - batch);
    const batchStart = performance.now();
    const promises = [];

    for (let i = 0; i < batchSize; i++) {
      const p = (async () => {
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        const tx = new Transaction().add(
          SystemProgram.transfer({ fromPubkey: sender.publicKey, toPubkey: recipient, lamports: 1000 })
        );
        tx.recentBlockhash = blockhash;
        tx.feePayer = sender.publicKey;
        tx.sign(sender);

        const sig = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: true, maxRetries: 3,
        });
        await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });
      })();

      promises.push(p.then(() => { succeeded++; }).catch(() => { failed++; }));
    }

    await Promise.all(promises);
    const bt = performance.now() - batchStart;
    process.stdout.write(`  Batch ${Math.floor(batch / concurrency) + 1}: ${succeeded} ok, ${failed} fail (${bt.toFixed(0)}ms)\n`);
  }

  const overallTime = performance.now() - overallStart;
  const tps = succeeded / (overallTime / 1000);
  console.log(`\n  ${succeeded}/${count} succeeded | ${(overallTime / 1000).toFixed(2)}s | ${tps.toFixed(2)} tx/sec | ~${Math.floor(tps * 60)}/min`);
  return tps;
}

// Mode 5: Parallel fire-and-forget
async function benchmarkParallelFireAndForget(sender: Keypair, recipient: PublicKey, count: number, concurrency: number) {
  console.log(`\n=== PARALLEL — FIRE & FORGET (${concurrency} concurrent, ${count} total) ===`);
  let succeeded = 0;
  let failed = 0;
  const sigs: string[] = [];
  const overallStart = performance.now();

  const { blockhash } = await connection.getLatestBlockhash();

  for (let batch = 0; batch < count; batch += concurrency) {
    const batchSize = Math.min(concurrency, count - batch);
    const promises = [];

    for (let i = 0; i < batchSize; i++) {
      const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: sender.publicKey, toPubkey: recipient, lamports: 1000 })
      );
      tx.recentBlockhash = blockhash;
      tx.feePayer = sender.publicKey;
      tx.sign(sender);

      promises.push(
        connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 })
          .then(sig => { succeeded++; sigs.push(sig); })
          .catch(() => { failed++; })
      );
    }
    await Promise.all(promises);
  }

  const overallTime = performance.now() - overallStart;
  const tps = succeeded / (overallTime / 1000);
  console.log(`  ${succeeded}/${count} sent | ${(overallTime / 1000).toFixed(2)}s | ${tps.toFixed(2)} tx/sec | ~${Math.floor(tps * 60)}/min`);

  // Verify
  console.log(`  Verifying after 5s...`);
  await new Promise(r => setTimeout(r, 5000));
  let confirmed = 0;
  for (const sig of sigs) {
    const status = await connection.getSignatureStatus(sig);
    if (status.value?.confirmationStatus === 'confirmed' || status.value?.confirmationStatus === 'finalized') {
      confirmed++;
    }
  }
  console.log(`  ${confirmed}/${sigs.length} confirmed on-chain`);

  return tps;
}

function summarize(results: { success: boolean; time: number }[], overallStart: number) {
  const overallTime = performance.now() - overallStart;
  const ok = results.filter(r => r.success);
  const avg = ok.length > 0 ? ok.reduce((a, r) => a + r.time, 0) / ok.length : 0;
  const min = ok.length > 0 ? Math.min(...ok.map(r => r.time)) : 0;
  const max = ok.length > 0 ? Math.max(...ok.map(r => r.time)) : 0;
  const tps = ok.length / (overallTime / 1000);

  console.log(`\n  ${ok.length}/${results.length} succeeded | ${(overallTime / 1000).toFixed(2)}s | avg ${avg.toFixed(0)}ms | ${tps.toFixed(2)} tx/sec | ~${Math.floor(tps * 60)}/min`);
  return { tps, avgLatency: avg, minLatency: min, maxLatency: max };
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Blip Embedded Wallet — Optimized Throughput Benchmark  ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`RPC: Helius Devnet`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  const sender = loadCliKeypair();
  console.log(`Keypair: ${sender.publicKey.toBase58().slice(0, 16)}...`);
  const balance = await connection.getBalance(sender.publicKey);
  console.log(`Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  // Pre-fund a shared recipient
  const recipient = Keypair.generate().publicKey;
  console.log(`\nPre-funding recipient...`);
  await fundRecipient(sender, recipient);
  console.log(`Done.\n`);

  // 1. Local benchmarks
  const sigPerSec = await benchmarkSigning(10000);
  const buildPerSec = await benchmarkTxBuild(1000);

  // 2. Sequential: Normal vs SkipPreflight vs Fire-and-forget (5 each)
  const normal = await benchmarkSequentialNormal(sender, recipient, 5);
  const skipPf = await benchmarkSequentialSkipPreflight(sender, recipient, 5);
  const fireForget = await benchmarkSequentialFireAndForget(sender, recipient, 5);

  // 3. Parallel: skipPreflight (10 tx, 5 concurrent)
  const parSkip = await benchmarkParallel(sender, recipient, 10, 5);

  // 4. Parallel: fire-and-forget (20 tx, 10 concurrent)
  const parFF = await benchmarkParallelFireAndForget(sender, recipient, 20, 10);

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║                   RESULTS SUMMARY                       ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Ed25519 Sign:          ${sigPerSec.toLocaleString().padStart(7)} /sec                  ║`);
  console.log(`║  TX Build+Sign:         ${buildPerSec.toLocaleString().padStart(7)} /sec                  ║`);
  console.log('╠──────────────────────────────────────────────────────────╣');
  console.log(`║  Seq Normal:            ${normal.tps.toFixed(2).padStart(7)} /sec  (${Math.floor(normal.tps * 60).toString().padStart(4)}/min)  ║`);
  console.log(`║  Seq SkipPreflight:     ${skipPf.tps.toFixed(2).padStart(7)} /sec  (${Math.floor(skipPf.tps * 60).toString().padStart(4)}/min)  ║`);
  console.log(`║  Seq Fire&Forget:       ${fireForget.tps.toFixed(2).padStart(7)} /sec  (${Math.floor(fireForget.tps * 60).toString().padStart(4)}/min)  ║`);
  console.log('╠──────────────────────────────────────────────────────────╣');
  console.log(`║  Parallel SkipPF(5x):   ${parSkip.toFixed(2).padStart(7)} /sec  (${Math.floor(parSkip * 60).toString().padStart(4)}/min)  ║`);
  console.log(`║  Parallel F&F(10x):     ${parFF.toFixed(2).padStart(7)} /sec  (${Math.floor(parFF * 60).toString().padStart(4)}/min)  ║`);
  console.log('╠──────────────────────────────────────────────────────────╣');
  console.log(`║  Avg Latency (normal):  ${normal.avgLatency.toFixed(0).padStart(5)}ms                        ║`);
  console.log(`║  Avg Latency (skipPF):  ${skipPf.avgLatency.toFixed(0).padStart(5)}ms                        ║`);
  console.log(`║  Avg Latency (F&F):     ${fireForget.avgLatency.toFixed(0).padStart(5)}ms                        ║`);
  console.log('╚══════════════════════════════════════════════════════════╝');
}

main().catch(console.error);
