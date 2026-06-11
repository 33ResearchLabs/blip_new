"use client";

// Responsive host for the counterparty profile: full-screen page on mobile, a
// centered modal/popup on desktop (lg+). Fetches /api/profile/[entityType]/[id]
// on open and renders CounterpartyProfile. `variant` selects the surface theme
// (user vs merchant scope). Mount one of these per app tree and drive it with
// openProfile(entityType, id).

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, AlertCircle } from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { SURFACES, type LimitsVariant } from "@/components/shared/limits/types";
import { CounterpartyProfile } from "./CounterpartyProfile";
import type { ProfileData, ProfileEntityType } from "./types";

interface Props {
  open: boolean;
  entityType: ProfileEntityType | null;
  id: string | null;
  /** Which app scope is rendering (drives the surface theme). */
  variant: LimitsVariant;
  onClose: () => void;
  onMessage?: (entityType: ProfileEntityType, id: string) => void;
  onStartTrade?: (entityType: ProfileEntityType, id: string) => void;
  onReport?: (entityType: ProfileEntityType, id: string) => void;
}

export function ProfileSheet({
  open,
  entityType,
  id,
  variant,
  onClose,
  onMessage,
  onStartTrade,
  onReport,
}: Props) {
  const surfaces = SURFACES[variant];
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!entityType || !id) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetchWithAuth(`/api/profile/${entityType}/${id}`);
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) setData(json.data as ProfileData);
      else setError(json?.error || "Couldn't load this profile");
    } catch (err) {
      console.error("Failed to load profile:", err);
      setError("Couldn't load this profile");
    } finally {
      setLoading(false);
    }
  }, [entityType, id]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[140] flex items-stretch lg:items-center justify-center bg-black/60 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.99 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className={`relative w-full h-full lg:h-[88vh] lg:max-w-lg lg:rounded-3xl overflow-hidden border-0 lg:border border-border-subtle ${surfaces.screen} ${variant === "merchant" ? "text-white lg:text-inherit" : ""}`}
          >
            {loading ? (
              <div className="h-full flex flex-col items-center justify-center gap-3">
                <Loader2 className="w-6 h-6 text-text-tertiary animate-spin" />
                <p className="text-[13px] text-text-tertiary">Loading profile…</p>
              </div>
            ) : error ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 px-8 text-center">
                <AlertCircle className="w-7 h-7 text-text-tertiary" />
                <p className="text-[14px] text-text-secondary">{error}</p>
                <button
                  onClick={load}
                  className={`px-4 py-2 rounded-xl border border-border-subtle text-[13px] text-text-secondary ${surfaces.chip} ${surfaces.hover} transition-colors`}
                >
                  Retry
                </button>
                <button onClick={onClose} className="text-[13px] text-text-tertiary mt-1">
                  Close
                </button>
              </div>
            ) : data ? (
              <CounterpartyProfile
                data={data}
                surfaces={surfaces}
                onClose={onClose}
                onMessage={onMessage ? () => onMessage(data.entityType, data.id) : undefined}
                onStartTrade={
                  onStartTrade ? () => onStartTrade(data.entityType, data.id) : undefined
                }
                onReport={onReport ? () => onReport(data.entityType, data.id) : undefined}
              />
            ) : null}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
