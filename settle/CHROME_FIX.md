# Fix Phantom Wallet Connection in Chrome

## The Problem
Phantom works in other browsers but throws error -32603 in Chrome.
This is because Phantom has corrupted/stale connection cache for localhost:3000 in Chrome.

## Solution 1: Clear Phantom Trusted Apps (Easiest)

1. Open Phantom extension in Chrome
2. Click Settings (gear icon) → Trusted Apps
3. Find "localhost:3000" and click Remove/Revoke
4. Refresh the app and try connecting again

## Solution 2: Clear Chrome Site Data

1. Open http://localhost:3000 in Chrome
2. Press F12 to open DevTools
3. Go to Application tab
4. In left sidebar: Storage → Clear site data
5. Check all boxes (Local storage, Session storage, IndexedDB, etc.)
6. Click "Clear site data"
7. Close DevTools
8. Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+F5 (Windows)
9. Try connecting Phantom again

## Solution 3: Reset Phantom Extension (Nuclear Option)

1. Go to chrome://extensions/
2. Find Phantom wallet
3. Toggle OFF then toggle ON
4. OR click Remove → Reinstall from Chrome Web Store
5. Restore wallet with seed phrase
6. Try connecting again

## Why This Happens

- Phantom caches connection state per origin (localhost:3000)
- When you downgrade/upgrade wallet-adapter packages, the cached state becomes invalid
- Error -32603 = Phantom's "internal error" when cache is corrupted
- Other browsers work because they have fresh/no cached state

## Verification

After clearing cache, you should see:
- Phantom popup asking for connection approval (not instant error)
- "Connect" button in the popup (not greyed out)
- Successful connection with your wallet address shown

If you still get errors, try a different port (npm run dev -- -p 3001)
