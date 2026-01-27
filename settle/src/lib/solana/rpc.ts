/**
 * RPC Endpoint Configuration with Health Checking and Fallback
 */

export interface RpcEndpoint {
  url: string;
  weight: number; // Lower = preferred
  network: 'devnet' | 'mainnet-beta';
}

export interface EndpointHealth {
  url: string;
  healthy: boolean;
  latency: number;
  lastChecked: number;
}

// Default endpoints - can be extended via environment variables
const DEFAULT_DEVNET_ENDPOINTS: RpcEndpoint[] = [
  { url: 'https://api.devnet.solana.com', weight: 1, network: 'devnet' },
];

const DEFAULT_MAINNET_ENDPOINTS: RpcEndpoint[] = [
  { url: 'https://api.mainnet-beta.solana.com', weight: 1, network: 'mainnet-beta' },
];

// Parse endpoints from environment variable
function parseEndpointsFromEnv(envVar: string | undefined, network: 'devnet' | 'mainnet-beta'): RpcEndpoint[] {
  if (!envVar) return [];

  return envVar.split(',').map((url, index) => ({
    url: url.trim(),
    weight: index + 1, // First in list = lowest weight = highest priority
    network,
  })).filter(e => e.url.length > 0);
}

// Get all configured endpoints for a network
export function getRpcEndpoints(network: 'devnet' | 'mainnet-beta' = 'devnet'): RpcEndpoint[] {
  const envKey = network === 'devnet'
    ? process.env.NEXT_PUBLIC_DEVNET_RPC_ENDPOINTS
    : process.env.NEXT_PUBLIC_MAINNET_RPC_ENDPOINTS;

  const envEndpoints = parseEndpointsFromEnv(envKey, network);
  const defaultEndpoints = network === 'devnet' ? DEFAULT_DEVNET_ENDPOINTS : DEFAULT_MAINNET_ENDPOINTS;

  // Use env endpoints if provided, otherwise use defaults
  return envEndpoints.length > 0 ? envEndpoints : defaultEndpoints;
}

// Health check cache (in-memory, client-side only)
const healthCache = new Map<string, EndpointHealth>();
const HEALTH_CACHE_TTL = 60 * 1000; // 1 minute cache

/**
 * Check the health of a single RPC endpoint
 */
export async function checkEndpointHealth(url: string): Promise<EndpointHealth> {
  // Check cache first
  const cached = healthCache.get(url);
  if (cached && Date.now() - cached.lastChecked < HEALTH_CACHE_TTL) {
    return cached;
  }

  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getHealth',
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = await response.json();
    const latency = Date.now() - start;

    const result: EndpointHealth = {
      url,
      healthy: data.result === 'ok',
      latency,
      lastChecked: Date.now(),
    };

    healthCache.set(url, result);
    return result;
  } catch (error) {
    const result: EndpointHealth = {
      url,
      healthy: false,
      latency: -1,
      lastChecked: Date.now(),
    };

    healthCache.set(url, result);
    return result;
  }
}

/**
 * Get the healthiest RPC endpoint for a network
 * Checks all endpoints in parallel and returns the fastest healthy one
 */
export async function getHealthyEndpoint(network: 'devnet' | 'mainnet-beta' = 'devnet'): Promise<string> {
  const endpoints = getRpcEndpoints(network);

  if (endpoints.length === 0) {
    throw new Error(`No RPC endpoints configured for ${network}`);
  }

  if (endpoints.length === 1) {
    // Single endpoint - just return it
    return endpoints[0].url;
  }

  // Check health of all endpoints in parallel
  const healthChecks = await Promise.all(
    endpoints.map(e => checkEndpointHealth(e.url))
  );

  // Sort by health (healthy first), then by latency (fastest first)
  const sorted = healthChecks
    .filter(h => h.healthy)
    .sort((a, b) => a.latency - b.latency);

  if (sorted.length > 0) {
    return sorted[0].url;
  }

  // All endpoints unhealthy - return first one and log warning
  console.warn('[RPC] All endpoints appear unhealthy, using primary fallback:', endpoints[0].url);
  return endpoints[0].url;
}

/**
 * Get the primary RPC endpoint without health checking
 * Used for initial connection before health checks complete
 */
export function getPrimaryEndpoint(network: 'devnet' | 'mainnet-beta' = 'devnet'): string {
  // Check for override first
  const override = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  if (override) {
    return override;
  }

  const endpoints = getRpcEndpoints(network);
  return endpoints[0]?.url || 'https://api.devnet.solana.com';
}

/**
 * Clear the health cache (useful for forcing re-check)
 */
export function clearHealthCache(): void {
  healthCache.clear();
}
