# Fix Phantom Wallet Not Detected in Brave

## Problem
Wallet shows "Click to install" even though Phantom is installed in Brave.

## Why This Happens
1. Brave's privacy shields block wallet injection
2. Phantom extension loads slower in Brave 
3. Page loads before Phantom injects `window.solana`

## Solutions

### Solution 1: Disable Brave Shields for localhost
1. Open http://localhost:3000 in Brave
2. Click the Lion icon (Brave Shields) in address bar
3. Toggle "Shields" to OFF for this site
4. Hard refresh: Cmd+Shift+R

### Solution 2: Allow Wallet Detection in Brave Settings
1. Go to brave://settings/shields
2. Under "Fingerprinting blocking", select "Allow all fingerprinting"
3. Refresh the app

### Solution 3: Use Chrome/Firefox Instead
Brave's privacy features sometimes conflict with wallet detection.
The app works fine in Chrome, Firefox, or Arc browser.

### Solution 4: Wait a Few Seconds
Sometimes Phantom takes 2-3 seconds to inject in Brave.
Wait 5 seconds after page load, then click "Connect Wallet" again.

### Solution 5: Reinstall Phantom in Brave
1. Go to brave://extensions
2. Remove Phantom
3. Reinstall from Chrome Web Store
4. Refresh the app

## Verification
Open browser console and type:
```javascript
window.phantom
window.solana  
```

If both return `undefined`, Phantom isn't injecting.
If they return objects, Phantom is injected but readyState detection failed.
