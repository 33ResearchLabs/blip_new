"use client";

/**
 * <IssueAnnotator /> — screenshot annotation layer.
 *
 * Architecture:
 *   - The captured screenshot is displayed via a plain <img> element
 *     (guaranteed by the browser).
 *   - A TRANSPARENT fabric.js canvas is layered on top for annotations.
 *   - On export, we composite img + fabric canvas into a single JPEG
 *     via a temporary canvas.
 *
 * Why not `setBackgroundImage` / locked fabric.Image for the screenshot?
 *   fabric v5's image rendering has well-known quirks around
 *   resize/init timing — the background frequently fails to paint,
 *   leaving a blank/white canvas with no error thrown. An <img>
 *   underlay sidesteps the entire problem: the screenshot is rendered
 *   by the browser's normal image pipeline, which never fails.
 */

import {
  ArrowRight,
  Highlighter,
  Loader2,
  Maximize2,
  Minimize2,
  Pencil,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type Tool = "pen" | "highlight" | "arrow" | "rect" | "text";

interface Props {
  source: string;
  onExport: (dataUrl: string) => void;
}

// Order follows the design spec: Highlight → Arrow → Text → Pen →
// Rectangle. Highlight is leftmost so it's the default visual cue
// users see first.
const TOOLS: Array<{ id: Tool; label: string; Icon: typeof Pencil }> = [
  { id: "highlight", label: "Highlight", Icon: Highlighter },
  { id: "arrow", label: "Arrow", Icon: ArrowRight },
  { id: "text", label: "Text", Icon: Type },
  { id: "pen", label: "Pen", Icon: Pencil },
  { id: "rect", label: "Rectangle", Icon: Square },
];

const STROKE_COLOR = "#f59e0b"; // amber-500 — matches the modal accent
const HIGHLIGHT_COLOR = "rgba(250, 204, 21, 0.4)";

export function IssueAnnotator({ source, onExport }: Props) {
  // Container div that fabric imperatively populates. React owns this
  // div and nothing else inside the annotation stage — the <canvas>,
  // <div class="canvas-container">, and fabric's sibling upper-canvas
  // are all created/managed by fabric and JS, with zero virtual-DOM
  // representation. This prevents React reconciliation from ever
  // touching fabric's internals on re-render.
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fabricCanvasRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fabricModRef = useRef<any>(null);
  const historyRef = useRef<string[]>([]);
  const redoRef = useRef<string[]>([]);
  const dimsRef = useRef<{ width: number; height: number } | null>(null);

  const [tool, setTool] = useState<Tool>("highlight");
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dims, setDims] = useState<{ width: number; height: number } | null>(
    null,
  );
  // Natural pixel dimensions of the captured screenshot (pre-scaling).
  // Shown as an overlay badge so the user can verify the capture
  // actually used their full desktop width.
  const [naturalDims, setNaturalDims] = useState<{
    width: number;
    height: number;
  } | null>(null);
  // 'fit' → scale to wrapper width (default, annotatable)
  // 'actual' → show at natural pixel size with scroll (inspect-only)
  const [zoom, setZoom] = useState<"fit" | "actual">("fit");

  // Keep the latest `onExport` in a ref so `pushExport` below can be a
  // STABLE callback (no deps). If we depended on `onExport` directly,
  // every parent re-render would produce a new `onExport` identity,
  // which would make the fabric-init useEffect below re-run, dispose
  // the canvas, and wipe any in-progress annotations — including the
  // pen stroke the user just drew.
  const onExportRef = useRef(onExport);
  useEffect(() => {
    onExportRef.current = onExport;
  }, [onExport]);

  /**
   * Composite the underlay image + fabric annotation canvas into a
   * single JPEG. Called after every mutation.
   */
  const pushExport = useCallback(() => {
    const c = fabricCanvasRef.current;
    const img = imgRef.current;
    if (!c || !img || !dimsRef.current) return;
    try {
      const { width, height } = dimsRef.current;
      const out = document.createElement("canvas");
      out.width = width;
      out.height = height;
      const ctx = out.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, width, height);
      // Draw the fabric upper layer on top. `toCanvasElement()` returns
      // a fresh canvas sized to the fabric canvas at full resolution.
      const overlay = c.toCanvasElement ? c.toCanvasElement() : null;
      if (overlay) {
        ctx.drawImage(overlay, 0, 0, width, height);
      }
      const dataUrl = out.toDataURL("image/jpeg", 0.75);
      onExportRef.current(dataUrl);
    } catch (err) {
      console.error("[IssueAnnotator] composite export failed", err);
    }
  }, []);

  const snapshot = useCallback(() => {
    const c = fabricCanvasRef.current;
    if (!c) return;
    historyRef.current.push(JSON.stringify(c.toJSON()));
    if (historyRef.current.length > 40) historyRef.current.shift();
    redoRef.current = [];
  }, []);

  // ── Load fabric + size the overlay canvas to match the underlay image ─
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        let mod: unknown = null;
        try {
          mod = await import("fabric");
        } catch (err) {
          console.error("[IssueAnnotator] fabric import failed", err);
          setLoadError(
            `fabric.js failed to load: ${(err as Error).message || "unknown"} — run 'pnpm install'`,
          );
          return;
        }
        if (cancelled) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const modAny = mod as any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fabric: any = modAny.fabric || modAny;
        if (!fabric || !fabric.Canvas) {
          setLoadError("fabric.js resolved but Canvas class missing");
          return;
        }
        fabricModRef.current = fabric;
        console.log("[IssueAnnotator] fabric loaded, version:", fabric.version);

        // Pre-load the screenshot so we know its real dimensions.
        const probe = new Image();
        probe.src = source;
        await new Promise<void>((resolve, reject) => {
          probe.onload = () => resolve();
          probe.onerror = () =>
            reject(new Error("source image failed to load"));
        });
        if (cancelled) return;
        console.log(
          "[IssueAnnotator] image loaded:",
          probe.width,
          "x",
          probe.height,
        );

        const wrapperWidth = wrapperRef.current?.clientWidth || 800;
        const scale = Math.min(1, wrapperWidth / Math.max(1, probe.width));
        const width = Math.max(200, Math.floor(probe.width * scale));
        const height = Math.max(200, Math.floor(probe.height * scale));
        dimsRef.current = { width, height };
        setDims({ width, height });
        setNaturalDims({ width: probe.width, height: probe.height });

        // Wait a tick for React to paint the container div at the
        // new dimensions.
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        if (cancelled) return;

        const container = canvasContainerRef.current;
        if (!container) return;

        // IMPERATIVELY create the canvas inside the container. React
        // doesn't render the canvas — it only manages the outer div.
        // This means React's reconciler has no virtual-DOM entry for
        // the canvas or fabric's sibling upper-canvas, so parent
        // re-renders can never destroy or stomp on fabric's internals.
        // Pen strokes persist because nothing outside fabric's control
        // ever touches the canvas DOM again.
        //
        // Clear any previous canvas content (StrictMode double-mount,
        // re-captures, etc.) before creating a fresh one.
        while (container.firstChild) {
          container.removeChild(container.firstChild);
        }
        const canvasEl = document.createElement('canvas');
        canvasEl.width = width;
        canvasEl.height = height;
        container.appendChild(canvasEl);

        const canvas = new fabric.Canvas(canvasEl, {
          isDrawingMode: true,
          selection: false,
          backgroundColor: "transparent",
        });
        fabricCanvasRef.current = canvas;

        canvas.freeDrawingBrush.color = STROKE_COLOR;
        canvas.freeDrawingBrush.width = 3;

        // Debounced export — pushExport calls toCanvasElement() which
        // can interfere with fabric's internal render cycle if invoked
        // synchronously during path:created. Deferring to the NEXT
        // animation frame lets fabric finish painting the new object
        // to the lower-canvas before we sample its pixels. Also
        // coalesces multiple mutations (path:created + object:added
        // both fire for a single stroke) into one export.
        let exportRafId: number | null = null;
        const scheduleExport = () => {
          if (exportRafId !== null) return;
          exportRafId = requestAnimationFrame(() => {
            exportRafId = null;
            // Force a fresh render before sampling pixels — guarantees
            // the visible canvas reflects the latest object graph.
            try {
              canvas.renderAll();
            } catch {
              /* swallow */
            }
            pushExport();
          });
        };

        canvas.on("path:created", () => {
          console.log('[IssueAnnotator] path:created — objects:', canvas.getObjects().length);
          snapshot();
          // Explicit renderAll here ensures the stroke is painted
          // immediately, independent of when scheduleExport fires.
          canvas.renderAll();
          scheduleExport();
        });
        canvas.on("object:added", (e: unknown) => {
          const evt = e as { target?: { type?: string } };
          console.log('[IssueAnnotator] object:added', evt.target?.type, 'total:', canvas.getObjects().length);
          // Paths are already snapshot'd via path:created — don't
          // double-snapshot. Non-path objects (rect/arrow/text) are
          // snapshot'd by their click-to-place handler.
          canvas.renderAll();
          scheduleExport();
        });
        canvas.on("object:modified", () => {
          canvas.renderAll();
          scheduleExport();
        });

        setReady(true);
        // Fire an initial export so the parent has the un-annotated
        // image ready to submit immediately.
        pushExport();
      } catch (e) {
        console.error("[IssueAnnotator] init failed", e);
        setLoadError((e as Error).message || "Failed to initialize annotator");
      }
    })();

    return () => {
      cancelled = true;
      try {
        fabricCanvasRef.current?.dispose();
      } catch {
        /* swallow */
      }
      fabricCanvasRef.current = null;
    };
  }, [source, snapshot, pushExport]);

  // ── Switch tools ────────────────────────────────────────────────────
  useEffect(() => {
    const c = fabricCanvasRef.current;
    const fabric = fabricModRef.current;
    if (!c || !fabric) return;

    c.isDrawingMode = tool === "pen" || tool === "highlight";
    c.selection = tool === "text" || tool === "rect" || tool === "arrow";

    if (tool === "pen") {
      c.freeDrawingBrush.color = STROKE_COLOR;
      c.freeDrawingBrush.width = 3;
    } else if (tool === "highlight") {
      c.freeDrawingBrush.color = HIGHLIGHT_COLOR;
      c.freeDrawingBrush.width = 18;
    }
    // Force a render so the visible canvas reflects the current
    // object graph — belt-and-braces in case an earlier mutation
    // left the lower-canvas stale.
    try {
      c.renderAll();
    } catch {
      /* swallow */
    }
  }, [tool]);

  // ── Click-to-place handlers for non-drawing tools ──────────────────
  useEffect(() => {
    const c = fabricCanvasRef.current;
    const fabric = fabricModRef.current;
    if (!c || !fabric) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (opt: any) => {
      if (!(tool === "rect" || tool === "arrow" || tool === "text")) return;
      if (opt.target) return;
      const p = c.getPointer(opt.e);
      snapshot();

      if (tool === "rect") {
        const rect = new fabric.Rect({
          left: p.x,
          top: p.y,
          width: 120,
          height: 70,
          stroke: STROKE_COLOR,
          strokeWidth: 2,
          fill: "transparent",
          cornerColor: STROKE_COLOR,
        });
        c.add(rect).setActiveObject(rect);
      } else if (tool === "text") {
        const text = new fabric.IText("Label", {
          left: p.x,
          top: p.y,
          fontSize: 18,
          fill: STROKE_COLOR,
          fontFamily: "Inter, sans-serif",
        });
        c.add(text).setActiveObject(text);
        text.enterEditing?.();
        text.selectAll?.();
      } else if (tool === "arrow") {
        const line = new fabric.Line([p.x, p.y, p.x + 100, p.y + 60], {
          stroke: STROKE_COLOR,
          strokeWidth: 3,
          selectable: true,
        });
        const head = new fabric.Triangle({
          left: p.x + 100,
          top: p.y + 60,
          width: 14,
          height: 14,
          fill: STROKE_COLOR,
          angle: 135,
          originX: "center",
          originY: "center",
        });
        const group = new fabric.Group([line, head], {
          selectable: true,
        });
        c.add(group).setActiveObject(group);
      }
      c.requestRenderAll();
    };

    c.on("mouse:down", handler);
    return () => {
      try {
        c.off("mouse:down", handler);
      } catch {
        /* swallow */
      }
    };
  }, [tool, snapshot]);

  // ── History actions ────────────────────────────────────────────────
  const handleUndo = useCallback(() => {
    const c = fabricCanvasRef.current;
    if (!c) return;
    const state = historyRef.current.pop();
    if (!state) {
      c.clear();
      pushExport();
      return;
    }
    redoRef.current.push(JSON.stringify(c.toJSON()));
    c.loadFromJSON(state, () => {
      c.renderAll();
      pushExport();
    });
  }, [pushExport]);

  const handleRedo = useCallback(() => {
    const c = fabricCanvasRef.current;
    if (!c) return;
    const state = redoRef.current.pop();
    if (!state) return;
    historyRef.current.push(JSON.stringify(c.toJSON()));
    c.loadFromJSON(state, () => {
      c.renderAll();
      pushExport();
    });
  }, [pushExport]);

  const handleClear = useCallback(() => {
    const c = fabricCanvasRef.current;
    if (!c) return;
    snapshot();
    c.getObjects().forEach((o: unknown) => c.remove(o));
    c.requestRenderAll();
    pushExport();
  }, [snapshot, pushExport]);

  // ── Fallback when fabric fails to load ─────────────────────────────
  if (loadError) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-[12px]">
        <img
          src={source}
          alt="Screenshot preview"
          className="max-w-full max-h-[80%] rounded border border-border"
        />
        <div className="text-amber-300/80">
          Annotation unavailable: {loadError}
        </div>
        <div className="text-foreground/40">
          Screenshot will be submitted unannotated.
        </div>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="h-full flex flex-col">
      {/* Toolbar — drawing tools on the left, history actions on the
          right, separated so the layout mirrors the mock. */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-foreground/[0.03]">
        <div className="flex items-center gap-1 flex-wrap">
          {TOOLS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTool(id)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium border transition ${
                tool === id
                  ? "bg-amber-500/15 border-amber-400/40 text-amber-200"
                  : "bg-foreground/[0.04] text-foreground/70 border-border hover:bg-foreground/[0.08]"
              }`}
              title={label}
            >
              <Icon size={12} />
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {/* Zoom toggle. In 'actual' mode the preview shows the
              capture at its natural pixel size (scrollable), so the
              user can verify the full desktop layout was captured
              without the fit-to-wrapper compression. Annotations are
              disabled in this mode to keep coordinate mapping simple. */}
          <button
            type="button"
            onClick={() => setZoom((z) => (z === "fit" ? "actual" : "fit"))}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium bg-foreground/[0.04] border border-border hover:bg-foreground/[0.08]"
            title={zoom === "fit" ? "View at actual size" : "Fit to preview"}
          >
            {zoom === "fit" ? <Maximize2 size={12} /> : <Minimize2 size={12} />}
            {zoom === "fit" ? "100%" : "Fit"}
          </button>
          <div className="w-px h-5 bg-border mx-0.5" />
          <button
            type="button"
            onClick={handleUndo}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium bg-foreground/[0.04] border border-border hover:bg-foreground/[0.08]"
            title="Undo"
          >
            <Undo2 size={12} />
            Undo
          </button>
          <button
            type="button"
            onClick={handleRedo}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium bg-foreground/[0.04] border border-border hover:bg-foreground/[0.08]"
            title="Redo"
          >
            <Redo2 size={12} />
            Redo
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium bg-foreground/[0.04] border border-border hover:bg-foreground/[0.08] text-rose-300/80"
            title="Clear all annotations"
          >
            <Trash2 size={12} />
            Clear All
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto relative p-3">
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-foreground/50 z-10">
            <Loader2 size={14} className="animate-spin mr-2" />
            Loading annotator…
          </div>
        )}
        {/* Capture dimensions badge — top-left corner of the preview
            area. Tells the user exactly what resolution the capture
            came out at (e.g. "1600 × 900") so they can confirm it's
            the desktop layout, not a mobile snapshot. */}
        {naturalDims && (
          <div className="absolute top-4 left-4 z-10 px-2 py-1 rounded bg-black/70 border border-white/10 backdrop-blur-sm text-[10px] font-mono text-foreground/70 pointer-events-none">
            Captured at {naturalDims.width} × {naturalDims.height}px
          </div>
        )}
        {/* Fixed-size stage: underlay img + overlay canvas share these
            exact dimensions so pointer coordinates line up 1:1. In
            'actual' zoom mode the stage uses the screenshot's natural
            pixel size (scrollable) so the user can inspect the full
            capture at real resolution. In 'fit' mode it scales to
            the wrapper width for annotation. */}
        {(() => {
          const stageWidth =
            zoom === "actual" && naturalDims ? naturalDims.width : dims?.width;
          const stageHeight =
            zoom === "actual" && naturalDims
              ? naturalDims.height
              : dims?.height;
          return (
            <div
              className="relative mx-auto rounded-md overflow-hidden border border-border/60"
              style={
                stageWidth && stageHeight
                  ? { width: `${stageWidth}px`, height: `${stageHeight}px` }
                  : undefined
              }
            >
              <img
                ref={imgRef}
                src={source}
                alt="Screenshot"
                crossOrigin="anonymous"
                className="absolute inset-0 block pointer-events-none select-none "
                style={
                  stageWidth && stageHeight
                    ? { width: `${stageWidth}px`, height: `${stageHeight}px` }
                    : undefined
                }
                draggable={false}
              />
              {/*
                React renders ONLY this empty container div. The
                <canvas> element + fabric's generated `.canvas-container`
                wrapper + sibling upper-canvas are all created
                imperatively inside it by the useEffect, and React's
                virtual DOM has no entry for any of them. That means:
                  - Parent re-renders never touch fabric's internals
                  - fabric's class list ('lower-canvas') and inline
                    positioning styles are never overwritten
                  - Pen strokes persist after mouse-up because the
                    canvas DOM and the in-memory fabric object graph
                    stay in sync across the entire annotation session.
              */}
              <div
                ref={canvasContainerRef}
                className="absolute inset-0 block"
                style={
                  stageWidth && stageHeight
                    ? { width: `${stageWidth}px`, height: `${stageHeight}px` }
                    : undefined
                }
              />
            </div>
          );
        })()}
      </div>
    </div>
  );
}
