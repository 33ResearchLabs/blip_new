/**
 * Extension-aware fetchWithAuth.
 * Reads the access token from chrome.storage.session, refreshes if stale,
 * and retries once on 401.
 */

import { apiFetch } from "./api";
import {
  getAuth,
  setAuth,
  getRefreshToken,
  isTokenFresh,
  type StoredAuth,
} from "./auth";

async function refreshAccessToken(): Promise<StoredAuth | null> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return null;

  try {
    const res = await apiFetch("/api/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.data?.access_token) return null;

    const current = await getAuth();
    if (!current) return null;

    const updated: StoredAuth = {
      ...current,
      accessToken: data.data.access_token,
      expiresAt: Date.now() + 14 * 60 * 1000, // 14 min
    };
    await setAuth(updated);
    return updated;
  } catch {
    return null;
  }
}

export async function fetchWithAuth(
  path: string,
  opts: RequestInit = {},
): Promise<Response> {
  let auth = await getAuth();

  // Refresh if stale
  if (auth && !isTokenFresh(auth)) {
    auth = await refreshAccessToken();
  }

  const token = auth?.accessToken;
  const res = await apiFetch(path, opts, token);

  // Retry once on 401
  if (res.status === 401 && token) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return apiFetch(path, opts, refreshed.accessToken);
    }
  }

  return res;
}
