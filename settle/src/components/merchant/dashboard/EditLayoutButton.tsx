"use client";

/**
 * Toggle dashboard edit mode. Mounts in the MerchantNavbar's rightActions
 * slot on the dashboard page so it's always reachable regardless of which
 * column the merchant is looking at. Reset-to-default moved to the hidden
 * tray (HiddenWidgetsTray) since it only matters while editing anyway.
 *
 * Read-only state — doesn't touch the layout itself, only the
 * isEditingLayout flag in the merchant store.
 */

import React from "react";
import { Pencil, Check } from "lucide-react";
import { useMerchantStore } from "@/stores/merchantStore";

export function EditLayoutButton() {
  const isEditing = useMerchantStore((s) => s.isEditingLayout);
  const setIsEditing = useMerchantStore((s) => s.setIsEditingLayout);

  return (
    <button
      type="button"
      onClick={() => setIsEditing(!isEditing)}
      className={`hidden lg:inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors border ${
        isEditing
          ? "bg-[#f5f5f7] text-background border-white/[0.12]"
          : "bg-white/[0.03] text-foreground/60 border-white/[0.05] hover:bg-card hover:text-foreground/90"
      }`}
      title={isEditing ? "Finish editing layout" : "Edit dashboard layout"}
      aria-pressed={isEditing}
    >
      {isEditing ? (
        <>
          <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
          <span>Done</span>
        </>
      ) : (
        <>
          <Pencil className="w-3.5 h-3.5" strokeWidth={2.5} />
          <span className="hidden xl:block">Edit Layout</span>
        </>
      )}
    </button>
  );
}
