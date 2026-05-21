/**
 * Minimal TronLink connector for the cross-chain deposit flow.
 *
 * Mirrors the public surface of evmWallet.ts but talks TronLink/TronWeb
 * instead of EIP-1193. TronLink injects two globals:
 *   - window.tronLink — request/permissions API
 *   - window.tronWeb  — chain + tx primitives (only ready after the
 *                       user has unlocked + granted site access)
 *
 * Mobile Tron wallets that don't inject TronWeb (Trust on iOS, etc.) are
 * out of scope here, same as the EVM module.
 */

interface TronLinkProvider {
  ready?: boolean;
  request: (args: { method: string; params?: unknown }) => Promise<{ code: number; message?: string }>;
}

interface TronWebProvider {
  ready: boolean;
  defaultAddress?: {
    base58?: string;
    hex?: string;
  };
  fullNode?: { host?: string };
  trx: {
    sign: (tx: unknown) => Promise<unknown>;
    sendRawTransaction: (signedTx: unknown) => Promise<{ result?: boolean; txid?: string; transaction?: { txID?: string }; code?: string; message?: string }>;
  };
  transactionBuilder: {
    triggerConstantContract: (
      contractAddress: string,
      functionSelector: string,
      options: Record<string, unknown>,
      parameters: { type: string; value: string | number }[],
      issuerAddress?: string,
    ) => Promise<{ result?: { result?: boolean }; constant_result?: string[] }>;
    triggerSmartContract: (
      contractAddress: string,
      functionSelector: string,
      options: Record<string, unknown>,
      parameters: { type: string; value: string | number }[],
      issuerAddress?: string,
    ) => Promise<{ result?: { result?: boolean }; transaction?: unknown }>;
  };
  address: {
    toHex: (b58: string) => string;
    fromHex: (hex: string) => string;
  };
  toBigNumber?: (n: string | number) => { toString(): string };
}

function getTronLink(): TronLinkProvider | null {
  if (typeof window === "undefined") return null;
  const tl = (window as unknown as { tronLink?: TronLinkProvider }).tronLink;
  return tl ?? null;
}

function getTronWeb(): TronWebProvider | null {
  if (typeof window === "undefined") return null;
  const tw = (window as unknown as { tronWeb?: TronWebProvider }).tronWeb;
  return tw ?? null;
}

export function hasTronLink(): boolean {
  return getTronLink() !== null || getTronWeb() !== null;
}

/** Prompt the user to grant the site access — returns the base58 address.
 *  Throws if TronLink isn't installed or the user rejects. */
export async function connectTron(): Promise<string> {
  const tl = getTronLink();
  if (!tl) {
    throw new Error(
      "TronLink not detected. Install the TronLink browser extension to deposit from Tron.",
    );
  }
  // Trigger the permission popup. TronLink returns { code: 200 } on
  // approval, { code: 4001 } on rejection, { code: 4000 } when already
  // open (we treat as benign and re-check tronWeb).
  const res = await tl.request({ method: "tron_requestAccounts" });
  if (res.code !== 200 && res.code !== 4000) {
    throw new Error(res.message || "TronLink connection rejected");
  }
  const tw = getTronWeb();
  const addr = tw?.defaultAddress?.base58;
  if (!addr) {
    throw new Error(
      "TronLink connected but no address available — unlock the extension and try again.",
    );
  }
  return addr;
}

/** Return the currently-connected base58 address without prompting. */
export async function getConnectedTronAddress(): Promise<string | null> {
  const tw = getTronWeb();
  if (!tw || !tw.ready) return null;
  return tw.defaultAddress?.base58 ?? null;
}

/** Tron mainnet has a single canonical fullnode host. We check the
 *  current TronWeb instance points there so we don't accidentally send
 *  a deposit on Shasta/Nile testnet. */
export function isOnTronMainnet(): boolean {
  const tw = getTronWeb();
  const host = tw?.fullNode?.host ?? "";
  return host.includes("trongrid.io") && !host.includes("nile") && !host.includes("shasta");
}

/** Read TRC20 allowance(owner, spender) via a constant (free) contract
 *  call. Returns the raw bigint amount. Mirrors readErc20Allowance. */
export async function readTrc20Allowance(opts: {
  token: string; // base58 contract address
  owner: string; // base58
  spender: string; // base58
}): Promise<bigint> {
  const tw = getTronWeb();
  if (!tw) return BigInt(0);
  try {
    const ownerHex = tw.address.toHex(opts.owner).replace(/^41/, "0x");
    const spenderHex = tw.address.toHex(opts.spender).replace(/^41/, "0x");
    const result = await tw.transactionBuilder.triggerConstantContract(
      opts.token,
      "allowance(address,address)",
      {},
      [
        { type: "address", value: ownerHex },
        { type: "address", value: spenderHex },
      ],
      opts.owner,
    );
    const hex = result?.constant_result?.[0];
    if (!hex) return BigInt(0);
    return BigInt("0x" + hex);
  } catch (err) {
    console.warn("[tron] allowance read failed", err);
    return BigInt(0);
  }
}

/** Approve(spender, amount) on a TRC20 token. Returns the txid. */
export async function approveTrc20(opts: {
  token: string;
  owner: string;
  spender: string;
  amount: string; // base-unit string ("1000000" = 1 USDT)
}): Promise<string> {
  const tw = getTronWeb();
  if (!tw) throw new Error("TronLink not available");
  const spenderHex = tw.address.toHex(opts.spender).replace(/^41/, "0x");
  const tx = await tw.transactionBuilder.triggerSmartContract(
    opts.token,
    "approve(address,uint256)",
    { feeLimit: 100_000_000 }, // 100 TRX cap, plenty for an approve
    [
      { type: "address", value: spenderHex },
      { type: "uint256", value: opts.amount },
    ],
    opts.owner,
  );
  if (!tx.result?.result || !tx.transaction) {
    throw new Error("Approval transaction build failed");
  }
  const signed = await tw.trx.sign(tx.transaction);
  const broadcast = await tw.trx.sendRawTransaction(signed);
  const txid = broadcast.txid || broadcast.transaction?.txID;
  if (!txid) throw new Error(broadcast.message || "Approval broadcast failed");
  return txid;
}

/** Submit the bridge transaction returned by LI.FI's quote. The shape
 *  LI.FI returns for Tron differs from EVM — typically a pre-built
 *  Tron transaction (the same object you'd hand to tronWeb.trx.sign).
 *  We accept either:
 *    - a plain object with raw_data / txID (signed-ready Tron tx)
 *    - LI.FI's wrapped { to, data, value, chainId } shape, which we then
 *      pass through triggerSmartContract on the bridge contract.
 *
 *  CAVEAT: LI.FI's Tron response shape isn't documented as cleanly as
 *  EVM's. This first attempts the raw-tx path; if the input looks like
 *  the EVM-style wrapper, falls back to triggerSmartContract. Worth
 *  verifying against a live small-amount deposit before relying on it. */
export async function sendTronBridgeTx(
  txRequest: unknown,
  fromAddress: string,
): Promise<string> {
  const tw = getTronWeb();
  if (!tw) throw new Error("TronLink not available");

  // Path 1: LI.FI returned an already-built Tron transaction object.
  // Detectable by the presence of `raw_data` or `txID`.
  if (
    txRequest &&
    typeof txRequest === "object" &&
    ("raw_data" in (txRequest as Record<string, unknown>) ||
      "txID" in (txRequest as Record<string, unknown>))
  ) {
    const signed = await tw.trx.sign(txRequest);
    const broadcast = await tw.trx.sendRawTransaction(signed);
    const txid = broadcast.txid || broadcast.transaction?.txID;
    if (!txid) throw new Error(broadcast.message || "Bridge broadcast failed");
    return txid;
  }

  // Path 2: EVM-style wrapper { to, data, value }. We rebuild it as a
  // Tron triggerSmartContract call on the bridge contract.
  const wrap = txRequest as { to?: string; data?: string; value?: string };
  if (!wrap?.to || !wrap.data) {
    throw new Error("Unrecognised Tron transaction shape from quote");
  }
  // LI.FI's `to` for Tron is base58. The `data` is the ABI-encoded
  // function call (selector + args). We pass it through as a fallback
  // signed message — Tron supports calling arbitrary smart contracts
  // via raw call data on triggerSmartContract when function_selector is
  // empty.
  const tx = await tw.transactionBuilder.triggerSmartContract(
    wrap.to,
    "", // empty selector — use raw `data` instead
    {
      feeLimit: 300_000_000, // 300 TRX cap for cross-chain bridge contracts
      callValue: wrap.value && wrap.value !== "0x0" ? Number(BigInt(wrap.value)) : 0,
      rawParameter: wrap.data.replace(/^0x/, ""),
    },
    [],
    fromAddress,
  );
  if (!tx.result?.result || !tx.transaction) {
    throw new Error("Bridge transaction build failed");
  }
  const signed = await tw.trx.sign(tx.transaction);
  const broadcast = await tw.trx.sendRawTransaction(signed);
  const txid = broadcast.txid || broadcast.transaction?.txID;
  if (!txid) throw new Error(broadcast.message || "Bridge broadcast failed");
  return txid;
}
