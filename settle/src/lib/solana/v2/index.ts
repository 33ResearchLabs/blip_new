/**
 * Blip Protocol V2.2 SDK for Settle App
 * Exports all types, config, PDAs, and program functions
 */

// Config
export {
  BLIP_V2_PROGRAM_ID,
  BLIP_V1_PROGRAM_ID,
  USDT_DEVNET_MINT,
  USDT_MAINNET_MINT,
  TREASURY_WALLET,
  FEE_BPS,
  DEVNET_RPC,
  getV2ProgramId,
  getUsdtMint,
  getFeeTreasury,
  getFeeBps,
} from './config';

// PDAs
export {
  findProtocolConfigPda,
  findLanePda,
  findLaneVaultAuthorityPda,
  findTradePda,
  findEscrowPda,
  findVaultAuthorityPda,
  deriveLanePdas,
  deriveTradePdas,
} from './pdas';

// Types
export {
  TradeStatus,
  TradeSide,
  type Lane,
  type Trade,
  type Escrow,
  type LaneInfo,
  type CreateLaneParams,
  type FundLaneParams,
  type WithdrawLaneParams,
  type CreateTradeParams,
  type LockEscrowParams,
  type ReleaseEscrowParams,
  type RefundEscrowParams,
} from './types';

// Program functions
export {
  getProgram,
  checkProtocolConfigExists,
  initializeProtocolConfig,
  createLane,
  buildFundLaneTx,
  fundLane,
  buildWithdrawLaneTx,
  withdrawLane,
  fetchLane,
  buildCreateTradeTx,
  buildLockEscrowTx,
  buildReleaseEscrowTx,
  buildRefundEscrowTx,
  fetchTrade,
  fetchEscrow,
} from './program';
