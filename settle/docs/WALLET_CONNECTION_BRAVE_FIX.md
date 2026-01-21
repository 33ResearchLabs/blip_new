# Wallet Connection Fix for Brave Browser

## Problem

The Solana wallet adapter library has issues connecting to Phantom in Brave browser:

1. **readyState is 'Loadable'** - In Brave, Phantom shows as `readyState: 'Loadable'` instead of `'Installed'`
2. **adapter.connect() redirects** - Calling `adapter.connect()` when readyState is 'Loadable' causes a redirect to Phantom's download page
3. **WalletNotSelectedError** - Calling `connect()` before `select()` is processed by React throws this error
4. **Adapter doesn't sync** - After connecting via Phantom's direct API, the wallet adapter doesn't automatically sync its state

## Solution

### 1. Phantom Direct Connection in Brave

When Brave is detected, we bypass the wallet adapter and connect directly to Phantom's API:

```typescript
// In WalletConnectModal.tsx
if (walletName === 'Phantom' && isBrave()) {
  const phantom = (window as any).phantom?.solana;

  // Connect via Phantom's direct API
  const resp = await phantom.connect();
  const pubKey = resp.publicKey.toString();

  // Select the wallet in the adapter (for consistency)
  select(adapter.name);

  // Set pending connect flag for the useEffect
  setPendingConnect(true);
}
```

### 2. Brave Detection

```typescript
const isBrave = useCallback(() => {
  return (navigator as any).brave !== undefined;
}, []);
```

### 3. SolanaWalletContext Fallback

The key fix is in `SolanaWalletContext.tsx`. When the adapter doesn't sync, we detect Phantom's direct connection and use it:

```typescript
// Check for Phantom direct connection in Brave
const [phantomDirectKey, setPhantomDirectKey] = useState<PublicKey | null>(null);

useEffect(() => {
  const checkPhantomDirect = () => {
    const phantom = (window as any).phantom?.solana;
    if (phantom?.isConnected && phantom?.publicKey && !adapterConnected) {
      const pubKey = new PublicKey(phantom.publicKey.toString());
      setPhantomDirectKey(pubKey);
    } else if (!phantom?.isConnected) {
      setPhantomDirectKey(null);
    }
  };

  checkPhantomDirect();
  const interval = setInterval(checkPhantomDirect, 1000);

  // Listen for Phantom events
  const phantom = (window as any).phantom?.solana;
  if (phantom) {
    phantom.on?.('connect', checkPhantomDirect);
    phantom.on?.('disconnect', () => setPhantomDirectKey(null));
  }

  return () => {
    clearInterval(interval);
    // cleanup listeners
  };
}, [adapterConnected]);

// Use adapter values if available, otherwise fall back to Phantom direct
const publicKey = adapterPublicKey || phantomDirectKey;
const connected = adapterConnected || (phantomDirectKey !== null);
```

### 4. Sign Transaction Fallback

When using Phantom direct connection, we also provide fallback signing functions:

```typescript
const signTransaction = useMemo(() => {
  if (adapterSignTransaction) {
    return adapterSignTransaction;
  }
  // Fallback to Phantom direct API
  const phantom = (window as any).phantom?.solana;
  if (phantom?.isConnected && phantomDirectKey) {
    return async <T extends Transaction>(tx: T): Promise<T> => {
      const signed = await phantom.signTransaction(tx);
      return signed as T;
    };
  }
  return undefined;
}, [adapterSignTransaction, phantomDirectKey]);
```

### 5. Disconnect Handling

```typescript
const disconnect = useCallback(() => {
  // Disconnect adapter
  walletDisconnect();
  // Also disconnect Phantom direct if connected
  const phantom = (window as any).phantom?.solana;
  if (phantom?.isConnected) {
    phantom.disconnect?.();
  }
  setPhantomDirectKey(null);
  setSolBalance(null);
  setUsdtBalance(null);
}, [walletDisconnect]);
```

## Flow Summary

### Chrome/Safari (Standard Flow)
1. User clicks Phantom
2. `select(adapter.name)` is called
3. `adapter.connect()` opens Phantom popup
4. User approves, adapter state updates
5. App shows connected

### Brave (Direct API Flow)
1. User clicks Phantom
2. `phantom.connect()` is called directly
3. Phantom popup opens, user approves
4. Phantom is connected but adapter doesn't sync
5. SolanaWalletContext detects `phantom.isConnected`
6. Context uses Phantom's direct API for publicKey and signing
7. App shows connected

## Files Modified

1. **`src/components/WalletConnectModal.tsx`** - User app wallet modal with Brave detection
2. **`src/components/MerchantWalletModal.tsx`** - Merchant app wallet modal with Brave detection
3. **`src/context/SolanaWalletContext.tsx`** - Added Phantom direct connection fallback

## Key Points

- The adapter's `readyState: 'Loadable'` in Brave prevents normal connection
- Calling `adapter.connect()` with 'Loadable' state redirects to download page
- The solution uses Phantom's direct API (`window.phantom.solana`) as fallback
- SolanaWalletContext polls for Phantom's connection state every 1 second
- All signing operations work through Phantom's direct API when adapter isn't synced
