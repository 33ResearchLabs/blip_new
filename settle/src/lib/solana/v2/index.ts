/**
 * Blip Protocol V2.3 SDK for Settle App
 * Exports all types, config, PDAs, and program functions
 * Includes payment confirmation and dispute resolution
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
  DisputeResolution,
  type Lane,
  type Trade,
  type Escrow,
  type LaneInfo,
  type CreateLaneParams,
  type FundLaneParams,
  type WithdrawLaneParams,
  type CreateTradeParams,
  type FundEscrowParams,
  type AcceptTradeParams,
  type LockEscrowParams,
  type ReleaseEscrowParams,
  type RefundEscrowParams,
  type ExtendEscrowParams,
  type ConfirmPaymentParams,
  type OpenDisputeParams,
  type ResolveDisputeParams,
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
  buildFundEscrowTx,
  buildAcceptTradeTx,
  buildLockEscrowTx,
  buildReleaseEscrowTx,
  buildRefundEscrowTx,
  buildExtendEscrowTx,
  // V2.3: Payment confirmation & disputes
  buildConfirmPaymentTx,
  buildOpenDisputeTx,
  buildResolveDisputeTx,
  fetchTrade,
  fetchEscrow,
} from './program';
