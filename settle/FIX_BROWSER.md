# 🔧 Fix Browser WebSocket / HMR Issues

## The Problem
Your browser has cached old service workers and is trying to connect to a stale WebSocket, causing HMR errors.

## ⚡ FASTEST FIX (Do This Now!)

### Step 1: Open the Clear Cache Page
1. **Open this URL in your browser:**
   ```
   http://localhost:3000/clear-cache.html
   ```

2. The page will **automatically** clear:
   - Service Workers
   - All caches
   - localStorage
   - sessionStorage

3. After it says "Done", click the **"4. Hard Reload"** button

### Step 2: If Step 1 Doesn't Work - Manual Clear

1. **Open DevTools:**
   - Mac: `Cmd + Option + I`
   - Windows: `F12` or `Ctrl + Shift + I`

2. **Go to Application Tab** (Chrome/Edge) or **Storage Tab** (Firefox)

3. **Unregister Service Workers:**
   - Click **"Service Workers"** in left sidebar
   - Click **"Unregister"** next to each service worker
   - You should see entries like `settle-v1`

4. **Clear All Site Data:**
   - In the **Application** tab, look for **"Clear site data"** button at the top
   - Click it to clear everything

5. **Hard Reload:**
   - Mac: `Cmd + Shift + R`
   - Windows: `Ctrl + Shift + R` or `Ctrl + F5`

## Alternative: Chrome DevTools Fast Clear

1. **Right-click** the refresh button (while DevTools is open)
2. Select **"Empty Cache and Hard Reload"**

## If Nothing Works - Nuclear Option

Close your browser completely and run:

```bash
cd /Users/zeus/Documents/Vscode/BM/settle

# Kill all Next.js processes
pkill -9 -f "next dev"

# Clear all caches
rm -rf .next
rm -rf node_modules/.cache

# Restart dev server
npm run dev
```

Then:
1. **Close ALL browser tabs** with localhost:3000
2. **Quit your browser completely** (Cmd+Q or Alt+F4)
3. **Reopen browser**
4. Go to `http://localhost:3000`

## Why This Happened

When we updated the code, the HMR (Hot Module Replacement) system got confused because:
- The service worker cached old module versions
- The WebSocket tried to connect to modules that were replaced
- The browser cache held stale bundles

This is a **development environment issue only** and won't affect production.

## Verify It's Fixed

After clearing, you should see:
- ✅ No WebSocket errors in console
- ✅ No "module factory not available" errors
- ✅ HMR working (changes appear without full reload)
- ✅ Merchant dashboard loads properly

## Still Having Issues?

If you're still seeing errors after trying all the above:

1. **Check what port the server is on:**
   ```bash
   lsof -i :3000
   ```

2. **Make sure only ONE dev server is running:**
   ```bash
   ps aux | grep "next dev"
   ```

3. **Try a different browser** (Incognito/Private mode)

---

**TL;DR:** Go to `http://localhost:3000/clear-cache.html` and click the buttons! 🚀
