// All API calls go to the Blip backend.
// Change this to your production URL.
export const API_BASE = "https://app.blip.money";

export async function apiFetch(
  path: string,
  opts: RequestInit = {},
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  return fetch(`${API_BASE}${path}`, { ...opts, headers });
}
