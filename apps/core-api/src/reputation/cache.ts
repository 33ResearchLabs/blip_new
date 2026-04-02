import { ReputationResult } from './types';
import { CACHE_TTL_MS } from './constants';

const store = new Map<string, { data: ReputationResult; expires: number }>();

export function cacheGet(key: string): ReputationResult | null {
  const entry = store.get(key);
  if (entry && entry.expires > Date.now()) return entry.data;
  if (entry) store.delete(key);
  return null;
}

export function cacheSet(key: string, data: ReputationResult): void {
  store.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
}

export function cacheInvalidate(key: string): void {
  store.delete(key);
}
