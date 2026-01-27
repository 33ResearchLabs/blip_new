# Frontend Integration Guide

## Quick Integration Steps

### 1. Import Required Components and Hooks

```typescript
import UsernameModal from '@/components/UsernameModal';
import { useWalletAuth } from '@/hooks/useWalletAuth';
import { useWallet } from '@solana/wallet-adapter-react';
```

### 2. Add Wallet Auth Hook

```typescript
const { connected } = useWallet();
const {
  authenticate,
  setUsername,
  showUsernameModal,
  closeUsernameModal,
  isAuthenticating,
  authError,
  walletAddress,
} = useWalletAuth();
```

### 3. Add Username State

```typescript
const [user, setUser] = useState<any>(null);
```

### 4. Handle Wallet Connection

Replace the existing `handleSolanaWalletConnect` function:

```typescript
const handleSolanaWalletConnect = useCallback(async () => {
  if (!connected || !walletAddress) {
    console.log('Wallet not connected');
    return;
  }

  // Authenticate with wallet signature
  const result = await authenticate();

  if (result.success && result.user) {
    // User authenticated successfully
    setUser(result.user);
    setUserId(result.user.id);
    setUserWallet(walletAddress);
    setUserName(result.user.username || result.user.name || 'User');
    localStorage.setItem('blip_user', JSON.stringify(result.user));
    localStorage.setItem('blip_wallet', walletAddress);

    // Fetch user data
    fetchOrders(result.user.id);
    fetchBankAccounts(result.user.id);
    fetchResolvedDisputes(result.user.id);

    setScreen('home');
  } else if (result.needsUsername) {
    // Username modal will show automatically
    console.log('Username required');
  } else {
    console.error('Authentication failed:', result.error);
  }
}, [connected, walletAddress, authenticate]);
```

### 5. Handle Username Submission

```typescript
const handleUsernameSubmit = useCallback(async (username: string) => {
  const result = await setUsername(username);

  if (result.success && result.user) {
    // Username set successfully
    setUser(result.user);
    setUserId(result.user.id);
    setUserWallet(walletAddress!);
    setUserName(result.user.username);
    localStorage.setItem('blip_user', JSON.stringify(result.user));
    localStorage.setItem('blip_wallet', walletAddress!);

    // Fetch user data
    fetchOrders(result.user.id);
    fetchBankAccounts(result.user.id);
    fetchResolvedDisputes(result.user.id);

    setScreen('home');
  } else {
    throw new Error(result.error || 'Failed to set username');
  }
}, [setUsername, walletAddress]);
```

### 6. Add Username Modal to JSX

Add this before the closing tag of your main component:

```tsx
{/* Username Modal */}
{showUsernameModal && walletAddress && (
  <UsernameModal
    isOpen={showUsernameModal}
    walletAddress={walletAddress}
    onSubmit={handleUsernameSubmit}
    onClose={closeUsernameModal}
    canClose={false} // User must set username
  />
)}
```

### 7. Auto-Login on Page Load

Replace the existing auto-login logic:

```typescript
useEffect(() => {
  const initializeAuth = async () => {
    if (!connected || !walletAddress) {
      setIsInitializing(false);
      return;
    }

    // Try to restore session from localStorage
    const savedUser = localStorage.getItem('blip_user');
    const savedWallet = localStorage.getItem('blip_wallet');

    if (savedUser && savedWallet === walletAddress) {
      try {
        const user = JSON.parse(savedUser);
        setUser(user);
        setUserId(user.id);
        setUserWallet(walletAddress);
        setUserName(user.username || user.name || 'User');

        // Fetch fresh data
        fetchOrders(user.id);
        fetchBankAccounts(user.id);
        fetchResolvedDisputes(user.id);

        setScreen('home');
      } catch (error) {
        console.error('Failed to restore session:', error);
        // Clear invalid session
        localStorage.removeItem('blip_user');
        localStorage.removeItem('blip_wallet');
      }
    } else {
      // No saved session or different wallet - authenticate
      await handleSolanaWalletConnect();
    }

    setIsInitializing(false);
  };

  initializeAuth();
}, [connected, walletAddress]);
```

---

## Complete Example Component

```typescript
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletAuth } from '@/hooks/useWalletAuth';
import UsernameModal from '@/components/UsernameModal';
import WalletConnectModal from '@/components/WalletConnectModal';

export default function HomePage() {
  const { connected } = useWallet();
  const {
    authenticate,
    setUsername,
    showUsernameModal,
    closeUsernameModal,
    isAuthenticating,
    authError,
    walletAddress,
  } = useWalletAuth();

  const [user, setUser] = useState<any>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userWallet, setUserWallet] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>('Guest');
  const [isInitializing, setIsInitializing] = useState(true);
  const [showWalletModal, setShowWalletModal] = useState(false);

  // Handle wallet connection and authentication
  const handleWalletAuth = useCallback(async () => {
    if (!connected || !walletAddress) return;

    const result = await authenticate();

    if (result.success && result.user) {
      setUser(result.user);
      setUserId(result.user.id);
      setUserWallet(walletAddress);
      setUserName(result.user.username || result.user.name || 'User');
      localStorage.setItem('blip_user', JSON.stringify(result.user));
      localStorage.setItem('blip_wallet', walletAddress);
    }
  }, [connected, walletAddress, authenticate]);

  // Handle username submission
  const handleUsernameSubmit = useCallback(async (username: string) => {
    const result = await setUsername(username);

    if (result.success && result.user) {
      setUser(result.user);
      setUserId(result.user.id);
      setUserWallet(walletAddress!);
      setUserName(result.user.username);
      localStorage.setItem('blip_user', JSON.stringify(result.user));
      localStorage.setItem('blip_wallet', walletAddress!);
    } else {
      throw new Error(result.error || 'Failed to set username');
    }
  }, [setUsername, walletAddress]);

  // Auto-restore session or authenticate
  useEffect(() => {
    const initAuth = async () => {
      if (!connected || !walletAddress) {
        setIsInitializing(false);
        return;
      }

      const savedUser = localStorage.getItem('blip_user');
      const savedWallet = localStorage.getItem('blip_wallet');

      if (savedUser && savedWallet === walletAddress) {
        try {
          const user = JSON.parse(savedUser);
          setUser(user);
          setUserId(user.id);
          setUserWallet(walletAddress);
          setUserName(user.username || user.name);
        } catch (error) {
          console.error('Session restore failed:', error);
          localStorage.removeItem('blip_user');
          localStorage.removeItem('blip_wallet');
          await handleWalletAuth();
        }
      } else {
        await handleWalletAuth();
      }

      setIsInitializing(false);
    };

    initAuth();
  }, [connected, walletAddress, handleWalletAuth]);

  return (
    <div>
      {/* Your app content */}

      {!user && (
        <button onClick={() => setShowWalletModal(true)}>
          Connect Wallet
        </button>
      )}

      {user && (
        <div>
          Welcome, {userName}!
        </div>
      )}

      {/* Wallet Modal */}
      {showWalletModal && (
        <WalletConnectModal
          isOpen={showWalletModal}
          onClose={() => setShowWalletModal(false)}
        />
      )}

      {/* Username Modal */}
      {showUsernameModal && walletAddress && (
        <UsernameModal
          isOpen={showUsernameModal}
          walletAddress={walletAddress}
          onSubmit={handleUsernameSubmit}
          canClose={false}
        />
      )}
    </div>
  );
}
```

---

## Removing Old Auth Code

### Files to Update

1. **Remove password-based login UI** from welcome screen
2. **Remove demo account creation** flow
3. **Update merchant page** with similar wallet auth flow

### What to Keep

- Keep `localStorage` keys (already updated to `blip_*`)
- Keep wallet connection modal
- Keep user state management

### What to Remove

- `loginForm` state
- `handleUserLogin` function
- `createAccount` function (demo mode)
- Email/password input fields
- "Create Account" with name input

---

## Testing Checklist

- [ ] Connect wallet triggers authentication
- [ ] New users see username modal
- [ ] Username validation works (3-20 chars, alphanumeric)
- [ ] Username availability check works in real-time
- [ ] Existing users skip username modal
- [ ] Session restores on page reload
- [ ] Logout clears localStorage
- [ ] Different wallet = new session
- [ ] Username cannot be changed after setting
- [ ] Global username uniqueness enforced

---

## Error Handling

```typescript
// Display auth errors
{authError && (
  <div className="text-red-400 text-sm">
    {authError}
  </div>
)}

// Handle username submission errors
const handleUsernameSubmit = async (username: string) => {
  try {
    const result = await setUsername(username);
    if (!result.success) {
      throw new Error(result.error || 'Failed to set username');
    }
    // Success handling...
  } catch (error) {
    // Error will be shown in UsernameModal
    throw error;
  }
};
```

---

## Next Steps

1. Apply these changes to [src/app/page.tsx](src/app/page.tsx)
2. Update merchant page with similar flow
3. Remove old password-based UI elements
4. Test the complete flow
5. Deploy!
