/**
 * Initialize Blip Protocol Config on Devnet
 *
 * Run this script once to initialize the protocol configuration
 * Usage: npx ts-node scripts/init-protocol.ts
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import {
  checkProtocolConfigExists,
  initializeProtocolConfig,
  findProtocolConfigPda,
  BLIP_V2_PROGRAM_ID,
  TREASURY_WALLET,
  FEE_BPS,
} from '../src/lib/solana/v2';
import idl from '../src/lib/solana/v2/idl.json';

async function main() {
  try {
    console.log('🚀 Initializing Blip Protocol Config on Devnet...\n');

    // Connect to devnet
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    console.log('✅ Connected to Solana Devnet');

    // Load wallet from environment or use default
    // For testing, you can use a test keypair or connect your wallet
    // NOTE: In production, this should be done by the protocol authority
    const wallet = Wallet.local(); // This will use ~/.config/solana/id.json
    console.log('📝 Authority wallet:', wallet.publicKey.toString());

    // Create provider
    const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
    const program = new Program(idl as any, BLIP_V2_PROGRAM_ID, provider);

    console.log('📋 Program ID:', BLIP_V2_PROGRAM_ID.toString());

    // Check if config already exists
    const [protocolConfigPda] = findProtocolConfigPda();
    console.log('🔍 Protocol Config PDA:', protocolConfigPda.toString());

    const configExists = await checkProtocolConfigExists(program);

    if (configExists) {
      console.log('\n✅ Protocol config already initialized!');
      console.log('   No action needed.');
      return;
    }

    console.log('\n⚠️  Protocol config not found. Initializing...');
    console.log(`   Treasury: ${TREASURY_WALLET.toString()}`);
    console.log(`   Fee: ${FEE_BPS / 100}% (${FEE_BPS} bps)`);
    console.log(`   Max Fee: 10% (1000 bps)`);
    console.log(`   Min Fee: 0% (0 bps)\n`);

    // Initialize protocol config
    const txHash = await initializeProtocolConfig(
      program,
      wallet.publicKey,
      TREASURY_WALLET,
      FEE_BPS,   // 2.5%
      1000,      // 10% max
      0          // 0% min
    );

    console.log('✅ Protocol config initialized successfully!');
    console.log('   Transaction:', txHash);
    console.log('   View on Solana Explorer:');
    console.log(`   https://explorer.solana.com/tx/${txHash}?cluster=devnet\n`);

    // Verify
    const verified = await checkProtocolConfigExists(program);
    if (verified) {
      console.log('✅ Verified: Protocol config is now active!');
    } else {
      console.error('❌ Warning: Could not verify protocol config initialization');
    }

  } catch (error) {
    console.error('\n❌ Error initializing protocol config:', error);
    if (error instanceof Error) {
      console.error('   Message:', error.message);
    }
    process.exit(1);
  }
}

main()
  .then(() => {
    console.log('\n✅ Done!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
