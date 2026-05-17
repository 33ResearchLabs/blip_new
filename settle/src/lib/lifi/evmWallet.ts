/**
 * Minimal EVM wallet connector for the cross-chain deposit flow.
 *
 * Uses window.ethereum (EIP-1193) directly so we avoid the ~1MB of
 * wagmi + WalletConnect for v2. Works with MetaMask, Coinbase Wallet
 * extension, Brave Wallet, Rabby — any browser wallet that injects
 * the standard provider.
 *
 * Mobile wallets that don't inject (Trust Wallet, Rainbow on iOS, etc.)
 * are out of scope here — they need WalletConnect, which we can add
 * later without changing the public API of this module.
 */

export interface EthRequestPayload {
  method: string;
  params?: unknown[];
}

interface EthereumProvider {
  request: (args: EthRequestPayload) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
}

function getProvider(): EthereumProvider | null {
  if (typeof window === 'undefined') return null;
  const eth = (window as unknown as { ethereum?: EthereumProvider }).ethereum;
  return eth ?? null;
}

export function hasInjectedWallet(): boolean {
  return getProvider() !== null;
}

/** Prompt the user to connect — returns the first selected address.
 *  Throws if no injected wallet exists or the user rejects. */
export async function connectEvm(): Promise<string> {
  const eth = getProvider();
  if (!eth) {
    throw new Error(
      'No browser wallet detected. Install MetaMask, Coinbase Wallet, or any EVM wallet extension.',
    );
  }
  const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error('No account returned from wallet');
  }
  return accounts[0];
}

/** Get the currently-connected account without prompting. Returns null
 *  if no wallet or no permission granted yet. */
export async function getConnectedAddress(): Promise<string | null> {
  const eth = getProvider();
  if (!eth) return null;
  try {
    const accounts = (await eth.request({ method: 'eth_accounts' })) as string[];
    return accounts[0] ?? null;
  } catch {
    return null;
  }
}

/** Ask the wallet to switch the active network. Returns true on
 *  success, throws on user-rejection or unsupported chain. */
export async function switchChain(targetChainId: number): Promise<void> {
  const eth = getProvider();
  if (!eth) throw new Error('No browser wallet detected.');
  const hex = '0x' + targetChainId.toString(16);
  try {
    await eth.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hex }],
    });
  } catch (err) {
    const code = (err as { code?: number }).code;
    // 4902 = chain not added in wallet. Surface a clearer error so the
    // UI can prompt the user to add it manually in their wallet.
    if (code === 4902) {
      throw new Error(
        "This chain isn't added to your wallet — open the wallet and add it, then try again.",
      );
    }
    throw err;
  }
}

/** Return the wallet's current chain id as a number. */
export async function getCurrentChainId(): Promise<number | null> {
  const eth = getProvider();
  if (!eth) return null;
  try {
    const hex = (await eth.request({ method: 'eth_chainId' })) as string;
    return parseInt(hex, 16);
  } catch {
    return null;
  }
}

export interface SendRawTxParams {
  from: string;
  to: string;
  data?: string;
  value?: string;
  gasLimit?: string;
  /** Optional: max-priority-fee for EIP-1559. */
  maxPriorityFeePerGas?: string;
  /** Optional: max-fee for EIP-1559. */
  maxFeePerGas?: string;
}

/** Submit a transaction via the injected wallet. Returns the tx hash
 *  the wallet broadcasts. Caller is responsible for polling for
 *  confirmation — this resolves the moment the wallet hands back a
 *  hash (i.e. user signed + provider accepted), not on-chain finality. */
export async function sendTransaction(tx: SendRawTxParams): Promise<string> {
  const eth = getProvider();
  if (!eth) throw new Error('No browser wallet detected.');
  // EIP-1193 transaction object expects exactly these field names.
  const txReq: Record<string, string> = { from: tx.from, to: tx.to };
  if (tx.data) txReq.data = tx.data;
  if (tx.value) txReq.value = tx.value;
  if (tx.gasLimit) txReq.gas = tx.gasLimit;
  if (tx.maxPriorityFeePerGas) txReq.maxPriorityFeePerGas = tx.maxPriorityFeePerGas;
  if (tx.maxFeePerGas) txReq.maxFeePerGas = tx.maxFeePerGas;
  const hash = (await eth.request({
    method: 'eth_sendTransaction',
    params: [txReq],
  })) as string;
  return hash;
}

/** Read on-chain ERC20 allowance via eth_call. Used to skip the
 *  approval tx when the user has already approved the spender for at
 *  least the amount they're about to send. */
export async function readErc20Allowance(opts: {
  token: string;
  owner: string;
  spender: string;
}): Promise<bigint> {
  const eth = getProvider();
  if (!eth) return BigInt(0);
  // allowance(address,address) → 0xdd62ed3e
  const selector = '0xdd62ed3e';
  const owner = opts.owner.replace(/^0x/, '').padStart(64, '0');
  const spender = opts.spender.replace(/^0x/, '').padStart(64, '0');
  const data = selector + owner + spender;
  try {
    const result = (await eth.request({
      method: 'eth_call',
      params: [{ to: opts.token, data }, 'latest'],
    })) as string;
    if (!result || result === '0x') return BigInt(0);
    return BigInt(result);
  } catch {
    return BigInt(0);
  }
}
