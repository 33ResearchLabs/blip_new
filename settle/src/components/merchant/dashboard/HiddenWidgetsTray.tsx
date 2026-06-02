"use client";

/**
 * Phase 3 — hidden-widget tray.
 *
 * Mounted above the PanelGroup inside the parent DndContext only when edit
 * mode is on. Each hidden widget renders as a draggable chip; dropping
 * onto any column moves it back into that column at the chosen index.
 *
 * The chips reuse the same useSortable as WidgetShell, with a virtual
 * "hidden" container id surfaced via the global registry-of-containers
 * lookup in MerchantDashboardV2.onDragEnd.
 */

import React from "react";
import { GripVertical, Plus, RotateCcw } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  WIDGET_LABELS,
  type WidgetId,
} from "@/components/merchant/dashboard/widgetRegistry";

export const HIDDEN_CONTAINER_ID = "__hidden__" as const;

interface HiddenChipProps {
  id: WidgetId;
  onRestore: (id: WidgetId) => void;
}

function HiddenChip({ id, onRestore }: HiddenChipProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className="inline-flex items-center gap-1 h-7 pl-1 pr-1.5 rounded-md border border-foreground/15 bg-foreground/[0.04] text-foreground/70"
    >
      <button
        type="button"
        aria-label={`Drag ${WIDGET_LABELS[id]}`}
        {...attributes}
        {...listeners}
        className="p-0.5 text-foreground/50 hover:text-foreground/90 cursor-grab active:cursor-grabbing touch-none"
      >
        <GripVertical className="w-3 h-3" />
      </button>
      <span className="text-[11px] font-bold uppercase tracking-wider whitespace-nowrap">
        {WIDGET_LABELS[id]}
      </span>
      <button
        type="button"
        aria-label={`Restore ${WIDGET_LABELS[id]} to layout`}
        onClick={() => onRestore(id)}
        className="ml-0.5 p-0.5 rounded text-foreground/50 hover:text-white hover:bg-foreground/[0.06]"
        title="Restore to default column"
      >
        <Plus className="w-3 h-3" strokeWidth={2.5} />
      </button>
    </div>
  );
}

interface HiddenWidgetsTrayProps {
  hidden: WidgetId[];
  onRestore: (id: WidgetId) => void;
  /** Reset the entire layout to the viewport default. Lives here so the
   *  navbar button can stay slim (just edit/done). */
  onResetToDefault: () => void;
}

export function HiddenWidgetsTray({
  hidden,
  onRestore,
  onResetToDefault,
}: HiddenWidgetsTrayProps) {
  const { setNodeRef, isOver } = useDroppable({ id: HIDDEN_CONTAINER_ID });

  return (
    <div
      ref={setNodeRef}
      className={`flex items-center gap-2 px-3 py-1.5 border-b border-foreground/[0.06] bg-background overflow-x-auto scrollbar-thin ${
        isOver ? "ring-2 ring-white/20 ring-inset" : ""
      }`}
    >
      <span className="shrink-0 text-[10.5px] font-mono uppercase tracking-wider text-foreground/40">
        Hidden:
      </span>
      {hidden.length === 0 ? (
        <span className="text-[10.5px] font-mono uppercase tracking-wider text-foreground/30">
          none
        </span>
      ) : (
        <SortableContext items={hidden} strategy={horizontalListSortingStrategy}>
          <div className="flex items-center gap-1.5">
            {hidden.map((id) => (
              <HiddenChip key={id} id={id} onRestore={onRestore} />
            ))}
          </div>
        </SortableContext>
      )}

      {/* Reset moved here from the left-column header so the navbar
            EditLayoutButton can stay slim (just edit/done). Always visible
            while editing — the merchant rarely needs it but should never
            have to hunt for it. */}
      <button
        type="button"
        onClick={onResetToDefault}
        className="ml-auto shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded-md text-[10px] font-bold uppercase tracking-wider bg-foreground/[0.04] text-foreground/60 hover:bg-foreground/[0.08] hover:text-foreground transition-colors"
        title="Reset layout to default"
      >
        <RotateCcw className="w-3 h-3" strokeWidth={2.5} />
        <span>Reset</span>
      </button>
    </div>
  );
}
