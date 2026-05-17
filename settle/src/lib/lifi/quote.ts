/**
 * Thin wrapper around LI.FI's GET /v1/quote endpoint. Always injects our
 * integrator identity + Blip fee so consumers can't forget either.
 *
 * Returns a normalized shape so the UI doesn't have to deal with LI.FI's
 * deeply nested response. If the underlying call fails we return null
 * and let the caller surface a friendly error — LI.FI's 4xx bodies
 * occasionally contain raw error text we don't want in our UI.
 */

import {
  LIFI_API_BASE,
  LIFI_INTEGRATOR_ID,
  BLIP_GROSS_FEE,
  SOLANA_CHAIN_ID,
  USDT_BY_CHAIN,
  USDT_SOLANA,
} from './config';

export interface CrossChainQuoteParams {
  /** LI.FI chain id of the source chain (e.g. 1 = Ethereum). */
  fromChainId: number | string;
  /** Source-chain wallet address the user will sign from. */
  fromAddress: string;
  /** Destination Solana wallet (the user's Blip wallet). */
  toAddress: string;
  /** Source amount expressed in the token's base units (e.g. 100 USDT
   *  with 6 decimals → "100000000"). */
  fromAmount: string;
}

export interface CrossChainQuote {
  /** Estimated USDT the user receives on Solana (human-readable string). */
  receivedUsdt: string;
  /** What the user is sending on the source chain (human-readable string). */
  sentUsdt: string;
  /** Bridge / provider fee in USD, summed across the route. */
  providerFeeUsd: number;
  /** Blip's cut in USD (already included in the 1.33% gross figure). */
  blipFeeUsd: number;
  /** Estimated gas in USD on the source chain. */
  gasFeeUsd: number;
  /** Settlement estimate in seconds — comes straight from LI.FI's
   *  estimate.executionDuration. Surface this directly so the UI ETA
   *  is honest. */
  etaSeconds: number;
  /** Underlying bridge name (e.g. "debridge", "allbridge"). Useful for
   *  the breakdown so users see which rails their funds rode on. */
  bridgeName: string;
  /** Source-chain tx the user needs to sign — built by LI.FI. Pass
   *  the fields straight to `eth_sendTransaction` via the connected
   *  wallet. */
  transactionRequest: {
    to: string;
    data: string;
    value: string;
    gasLimit?: string;
    gasPrice?: string;
    chainId?: number;
  } | null;
  /** ERC20 spender LI.FI will pull `fromAmount` USDT from. Used to
   *  check / set token allowance before submitting the main tx. */
  approvalAddress: string | null;
  /** USDT contract on the source chain (the token to approve). */
  fromTokenAddress: string;
  /** Source amount in base units (string, matches what we passed in). */
  fromAmountBase: string;
  /** The full raw quote — kept around for debugging. */
  raw: unknown;
}

interface LifiFeeCost { amountUSD?: string; name?: string }
interface LifiGasCost { amountUSD?: string }
interface LifiStep { tool?: string }
interface LifiEstimate {
  toAmount?: string;
  toAmountUSD?: string;
  fromAmount?: string;
  fromAmountUSD?: string;
  executionDuration?: number;
  feeCosts?: LifiFeeCost[];
  gasCosts?: LifiGasCost[];
}
interface LifiTxRequest {
  to?: string;
  data?: string;
  value?: string;
  gasLimit?: string;
  gasPrice?: string;
  chainId?: number;
}
interface LifiQuoteResponse {
  estimate?: LifiEstimate & { approvalAddress?: string };
  action?: { toToken?: { decimals?: number } };
  includedSteps?: LifiStep[];
  tool?: string;
  transactionRequest?: LifiTxRequest;
}

const FETCH_TIMEOUT_MS = 12_000;

function sumFeeCostsUsd(costs: LifiFeeCost[] | undefined): number {
  if (!costs) return 0;
  return costs.reduce((acc, c) => acc + (parseFloat(c.amountUSD ?? '0') || 0), 0);
}

function sumGasCostsUsd(costs: LifiGasCost[] | undefined): number {
  if (!costs) return 0;
  return costs.reduce((acc, c) => acc + (parseFloat(c.amountUSD ?? '0') || 0), 0);
}

export async function getCrossChainQuote(
  params: CrossChainQuoteParams,
): Promise<CrossChainQuote | null> {
  const fromToken = USDT_BY_CHAIN[params.fromChainId];
  if (!fromToken) {
    console.warn('[lifi] no USDT token configured for chain', params.fromChainId);
    return null;
  }

  // LI.FI's HTTP API takes everything as query params. `integrator`
  // names the partner; `fee` is a decimal fraction (0.0133 = 1.33%).
  const qs = new URLSearchParams({
    fromChain: String(params.fromChainId),
    toChain: String(SOLANA_CHAIN_ID),
    fromToken,
    toToken: USDT_SOLANA,
    fromAmount: params.fromAmount,
    fromAddress: params.fromAddress,
    toAddress: params.toAddress,
    integrator: LIFI_INTEGRATOR_ID,
    fee: String(BLIP_GROSS_FEE),
    slippage: '0.005', // 0.5%, in line with LI.FI default
  });

  try {
    const res = await fetch(`${LIFI_API_BASE}/quote?${qs.toString()}`, {
      method: 'GET',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn('[lifi] quote HTTP', res.status);
      return null;
    }
    const json = (await res.json()) as LifiQuoteResponse;
    const est = json.estimate;
    if (!est?.toAmount) return null;

    const dstDecimals = json.action?.toToken?.decimals ?? 6;
    const srcDecimals = 6; // every USDT we list is 6-decimal
    const received = Number(est.toAmount) / 10 ** dstDecimals;
    const sent = Number(est.fromAmount ?? params.fromAmount) / 10 ** srcDecimals;

    const feeCosts = est.feeCosts ?? [];
    // LI.FI surfaces the integrator (Blip) cut as its own feeCost row
    // once the integrator is approved (named "Blip-merchant Fee" or
    // similar). Before approval, the same row appears as "LIFI Fixed
    // Fee". Either way it's lumped into the user-visible "Bridge fee"
    // line per our fee-UI spec: fees are a quiet "processing" detail
    // — surfacing every component would add noise without value.
    const providerFeeUsd = sumFeeCostsUsd(feeCosts);
    const blipFeeUsd = 0; // intentionally hidden in the UI

    const txReq = json.transactionRequest;
    const transactionRequest = txReq && txReq.to && txReq.data && txReq.value
      ? {
          to: txReq.to,
          data: txReq.data,
          value: txReq.value,
          gasLimit: txReq.gasLimit,
          gasPrice: txReq.gasPrice,
          chainId: txReq.chainId,
        }
      : null;

    return {
      receivedUsdt: received.toFixed(2),
      sentUsdt: sent.toFixed(2),
      providerFeeUsd,
      blipFeeUsd,
      gasFeeUsd: sumGasCostsUsd(est.gasCosts),
      etaSeconds: est.executionDuration ?? 60,
      bridgeName: json.tool ?? json.includedSteps?.[0]?.tool ?? 'bridge',
      transactionRequest,
      approvalAddress: est.approvalAddress ?? null,
      fromTokenAddress: fromToken,
      fromAmountBase: params.fromAmount,
      raw: json,
    };
  } catch (err) {
    console.warn('[lifi] quote error', err);
    return null;
  }
}
