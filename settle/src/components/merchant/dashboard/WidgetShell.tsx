"use client";

/**
 * Phase 2 — per-widget shell that wraps each registry render.
 *
 * Read-only (edit mode off): renders children inert. Zero added DOM beyond
 * a position-relative wrapper so the absolute-positioned overlay can mount
 * without reflowing the panel.
 *
 * Edit mode on: adds a grip handle (dnd-kit drag handle), a hide button,
 * and a dashed outline so the widget reads as draggable. Widget click
 * targets behind the overlay are NOT blocked when edit mode is off — the
 * overlay only mounts in edit mode.
 */

import React from "react";
import { GripVertical, EyeOff } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { WidgetId } from "@/components/merchant/dashboard/widgetRegistry";

interface WidgetShellProps {
  id: WidgetId;
  isEditing: boolean;
  onHide: (id: WidgetId) => void;
  /** True (default) → shell expands to fill its parent height, used when
   *  the parent is a fixed-size react-resizable-panels <Panel>. False →
   *  intrinsic height; used for the left column's flex stack where
   *  widgets size to their own content (otherwise the first widget
   *  collapses to 100% of the column and leaves a big gap). */
  fillHeight?: boolean;
  children: React.ReactNode;
}

export function WidgetShell({
  id,
  isEditing,
  onHide,
  fillHeight = true,
  children,
}: WidgetShellProps) {
  // dnd-kit's hook is safe to call unconditionally; without an enclosing
  // DndContext it returns inert listeners (no drag). When edit mode is off
  // we explicitly drop the listeners + transform so nothing visual changes.
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !isEditing });

  // Apply the dnd-kit transform so the sortable strategy can shift the
  // OTHER widgets in the column to make a visible hole at the drop
  // target. The DragOverlay handles the floating ghost; this shell goes
  // transparent in place so two visuals of the same widget don't show.
  const style: React.CSSProperties = isEditing
    ? {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0 : 1,
      }
    : {};

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-widget-id={id}
      className={`relative ${fillHeight ? "h-full" : ""} ${
        isEditing
          ? "rounded-xl outline-dashed outline-2 outline-primary/40 outline-offset-[-2px] overflow-hidden"
          : "overflow-hidden"
      }`}
    >
      {isEditing && (
        <div className="absolute top-1 right-1 z-20 flex items-center gap-0.5 rounded-md bg-background/95 backdrop-blur-sm border border-foreground/10 shadow-lg">
          <button
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            type="button"
            aria-label="Drag widget"
            className="p-1 text-foreground/60 hover:text-foreground cursor-grab active:cursor-grabbing touch-none"
          >
            <GripVertical className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            aria-label="Hide widget"
            onClick={() => onHide(id)}
            className="p-1 text-foreground/60 hover:text-red-400"
          >
            <EyeOff className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {children}
    </div>
  );
}
