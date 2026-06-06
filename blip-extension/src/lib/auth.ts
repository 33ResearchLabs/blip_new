/**
 * Token storage for the Chrome extension.
 * Both access token and refresh token stored in chrome.storage.local so the
 * user stays logged in across browser restarts. Only explicit sign-out clears them.
 */

export interface StoredAuth {
  accessToken: string;
  refreshToken: string;
  userId: string;
  userName: string;
  userAvatar: string | null;
  expiresAt: number; // unix ms
}

export async function getAuth(): Promise<StoredAuth | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get("blip_auth", (result) => {
      resolve(result.blip_auth ?? null);
    });
  });
}

export async function setAuth(auth: StoredAuth): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ blip_auth: auth }, resolve);
  });
}

export async function clearAuth(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove("blip_auth", resolve);
  });
}

export async function getRefreshToken(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get("blip_refresh", (result) => {
      resolve(result.blip_refresh ?? null);
    });
  });
}

export async function setRefreshToken(token: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ blip_refresh: token }, resolve);
  });
}

export async function clearRefreshToken(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove("blip_refresh", resolve);
  });
}

/** True if the stored access token is still valid (with 60s buffer). */
export function isTokenFresh(auth: StoredAuth): boolean {
  return auth.expiresAt - Date.now() > 60_000;
}
