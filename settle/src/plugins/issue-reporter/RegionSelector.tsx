"use client";

/**
 * <RegionSelector /> — fullscreen overlay that lets the user drag to
 * pick a rectangular region for capture. Calls `onSelect(region)` with
 * document-space coordinates when the user releases, or `onCancel()` if
 * they press Escape / right-click.
 *
 * This is the UI counterpart to captureRegionScreenshot() — the
 * overlay is intentionally minimal (crosshair cursor + dim background +
 * live rectangle preview) so it disappears cleanly before capture.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  onSelect: (region: Region) => void;
  onCancel: () => void;
}

export function RegionSelector({ onSelect, onCancel }: Props) {
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [end, setEnd] = useState<{ x: number; y: number } | null>(null);
  const cancelRef = useRef(onCancel);
  // Keep the ref in sync AFTER render; updating during render violates
  // React's ref rules (refs are post-render-only values).
  useEffect(() => {
    cancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toDocPoint = useCallback((e: React.MouseEvent) => {
    // clientX/Y are viewport-relative; add scroll offset so we get
    // document-space coordinates, which is what captureRegionScreenshot
    // expects (the full-page capture covers the whole document).
    return {
      x: e.clientX + window.scrollX,
      y: e.clientY + window.scrollY,
    };
  }, []);

  const handleDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) {
        e.preventDefault();
        onCancel();
        return;
      }
      const p = toDocPoint(e);
      setStart(p);
      setEnd(p);
    },
    [onCancel, toDocPoint],
  );

  const handleMove = useCallback(
    (e: React.MouseEvent) => {
      if (!start) return;
      setEnd(toDocPoint(e));
    },
    [start, toDocPoint],
  );

  const handleUp = useCallback(() => {
    if (!start || !end) return;
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    setStart(null);
    setEnd(null);
    if (width < 10 || height < 10) {
      onCancel();
      return;
    }
    onSelect({ x, y, width, height });
  }, [start, end, onSelect, onCancel]);

  // Preview rectangle in VIEWPORT space (CSS positioning is relative to
  // the fixed-position overlay, which is pinned to the viewport, not
  // the document).
  let rectStyle: React.CSSProperties | null = null;
  if (start && end) {
    const sx = start.x - window.scrollX;
    const sy = start.y - window.scrollY;
    const ex = end.x - window.scrollX;
    const ey = end.y - window.scrollY;
    rectStyle = {
      position: "absolute",
      left: Math.min(sx, ex),
      top: Math.min(sy, ey),
      width: Math.abs(ex - sx),
      height: Math.abs(ey - sy),
      border: "2px solid #f59e0b",
      background: "rgba(245, 158, 11, 0.12)",
      pointerEvents: "none",
      boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.45)",
    };
  }

  return (
    <div
      data-issue-reporter-region-selector
      onMouseDown={handleDown}
      onMouseMove={handleMove}
      onMouseUp={handleUp}
      onContextMenu={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="fixed inset-0 z-[80]"
      style={{
        cursor: "crosshair",
        background: rectStyle ? "transparent" : "rgba(0, 0, 0, 0.25)",
        userSelect: "none",
      }}
    >
      {rectStyle && <div style={rectStyle} />}
      {!start && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-black/80 border border-white/10 text-[12px] text-white/90 font-medium pointer-events-none">
          Drag to select a region — Esc to cancel
        </div>
      )}
    </div>
  );
}
