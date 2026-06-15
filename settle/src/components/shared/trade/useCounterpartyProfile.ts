"use client";

// Read-only fetch of a counterparty's public profile (trust score, KYC,
// success rate, account age, etc.) for use in trade-flow surfaces like the
// escrow-lock modal and the buyer "escrow locked" screen. Mirrors the fetch
// pattern in ProfileSheet (loader in a useCallback, invoked from an effect) so
// it returns just the data + loading flag. No new endpoint — reuses
// GET /api/profile/[entityType]/[id].

import { useCallback, useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import type { ProfileData, ProfileEntityType } from "@/components/shared/profile/types";

export function useCounterpartyProfile(
  entityType: ProfileEntityType | null | undefined,
  id: string | null | undefined,
  enabled: boolean = true,
): { profile: ProfileData | null; loading: boolean } {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!entityType || !id) {
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetchWithAuth(`/api/profile/${entityType}/${id}`);
      const json = await res.json().catch(() => null);
      setProfile(json?.success ? (json.data as ProfileData) : null);
    } catch {
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [entityType, id]);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  return { profile, loading };
}
