"use client";

/**
 * <IssueAnnotatorInner /> — react-konva annotation canvas.
 *
 * All shapes are kept as plain JSON objects in `shapes` state. Konva
 * renders them; nothing mutates the scene graph directly. This replaces
 * the previous fabric.js implementation, which owned its own imperative
 * object graph and was hard to keep in sync with React state.
 *
 * Tools:
 *   - select : click a shape to select, drag/resize via Transformer
 *   - rect   : drag to create a rectangle
 *   - arrow  : drag to create an arrow
 *   - pen    : free-draw polyline
 *   - text   : click to place editable label
 *
 * Selection / interaction:
 *   - Clicking any shape activates it + attaches a Transformer so the
 *     user can drag or resize.
 *   - Delete / Backspace removes the selected shape.
 *   - The toolbar exposes Undo / Redo / Clear All / Delete selected.
 *   - Cursor changes based on the active tool (crosshair while drawing,
 *     text-caret while placing text, default in select mode).
 */

import {
  ArrowRight,
  Highlighter,
  Maximize2,
  MousePointer2,
  Minimize2,
  Pencil,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import {
  Arrow,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  Stage,
  Text as KonvaText,
  Transformer,
} from "react-konva";

type Tool = "select" | "rect" | "arrow" | "pen" | "highlight" | "text";

interface BaseShape {
  id: string;
  type: Tool;
}
interface RectShape extends BaseShape {
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  stroke: string;
  strokeWidth: number;
  rotation?: number;
}
interface ArrowShape extends BaseShape {
  type: "arrow";
  points: [number, number, number, number];
  stroke: string;
  strokeWidth: number;
}
interface PenShape extends BaseShape {
  type: "pen";
  points: number[];
  stroke: string;
  strokeWidth: number;
  opacity: number;
}
interface TextShape extends BaseShape {
  type: "text";
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fill: string;
  rotation?: number;
}
type Shape = RectShape | ArrowShape | PenShape | TextShape;

interface Props {
  source: string;
  onExport: (dataUrl: string) => void;
}

const STROKE_COLOR = "#f59e0b"; // amber-500
const HIGHLIGHT_COLOR = "rgba(250, 204, 21, 0.45)";
const MAX_HISTORY = 40;

const TOOLS: Array<{ id: Tool; label: string; Icon: typeof Pencil }> = [
  { id: "select", label: "Select", Icon: MousePointer2 },
  { id: "highlight", label: "Highlight", Icon: Highlighter },
  { id: "arrow", label: "Arrow", Icon: ArrowRight },
  { id: "text", label: "Text", Icon: Type },
  { id: "pen", label: "Pen", Icon: Pencil },
  { id: "rect", label: "Rectangle", Icon: Square },
];

function makeId(): string {
  return `s_${Math.random().toString(36).slice(2, 10)}`;
}

function cursorForTool(tool: Tool): string {
  switch (tool) {
    case "select":
      return "default";
    case "text":
      return "text";
    case "rect":
    case "arrow":
    case "pen":
    case "highlight":
      return "crosshair";
    default:
      return "default";
  }
}

export function IssueAnnotatorInner({ source, onExport }: Props) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const imgRef = useRef<Konva.Image | null>(null);

  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [naturalDims, setNaturalDims] = useState<{
    width: number;
    height: number;
  } | null>(null);
  // Measured wrapper width — driven by ResizeObserver, consumed by the
  // `stageDims` memo below. Kept separate from `stageDims` so we don't
  // call setState-in-effect for derived values.
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const [zoom, setZoom] = useState<"fit" | "actual">("fit");
  const [tool, setTool] = useState<Tool>("select");
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // In-progress shape while the user is dragging. Committed to `shapes`
  // on pointer-up. Kept separate so undo history isn't polluted with
  // the intermediate frames of a drag.
  const [draft, setDraft] = useState<Shape | null>(null);
  const isDrawingRef = useRef(false);

  // History stacks live in state (not refs) so the Undo/Redo buttons
  // can read their `.length` during render for the disabled prop. The
  // arrays only change on user actions (commit/undo/redo), never in a
  // mid-render branch, so re-renders here are cheap.
  const [history, setHistory] = useState<Shape[][]>([]);
  const [redo, setRedo] = useState<Shape[][]>([]);

  // Stable onExport ref — prevents export deps from cycling state.
  const onExportRef = useRef(onExport);
  useEffect(() => {
    onExportRef.current = onExport;
  }, [onExport]);

  // ── Load the screenshot + compute stage dims ──────────────────────
  useEffect(() => {
    let cancelled = false;
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.src = source;
    img.onload = () => {
      if (cancelled) return;
      setImage(img);
      setNaturalDims({ width: img.width, height: img.height });
    };
    img.onerror = () => {
      if (cancelled) return;
      setLoadError("Screenshot failed to load");
    };
    return () => {
      cancelled = true;
    };
  }, [source]);

  // Observe the wrapper's clientWidth so the stage resizes with its
  // container. The observer is the ONLY writer to `measuredWidth`; the
  // derived `stageDims` memo below depends on it.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const measure = () => setMeasuredWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const stageDims = useMemo(() => {
    if (!naturalDims) return null;
    if (zoom === "actual") {
      return { width: naturalDims.width, height: naturalDims.height };
    }
    const w = measuredWidth ?? 800;
    const scale = Math.min(1, w / Math.max(1, naturalDims.width));
    return {
      width: Math.max(200, Math.floor(naturalDims.width * scale)),
      height: Math.max(200, Math.floor(naturalDims.height * scale)),
    };
  }, [naturalDims, zoom, measuredWidth]);

  // ── History helpers ───────────────────────────────────────────────
  const commit = useCallback(
    (next: Shape[] | ((prev: Shape[]) => Shape[])) => {
      setShapes((prev) => {
        setHistory((h) => {
          const nh = [...h, prev];
          if (nh.length > MAX_HISTORY) nh.shift();
          return nh;
        });
        setRedo([]);
        return typeof next === "function" ? next(prev) : next;
      });
    },
    [],
  );

  const handleUndo = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      const nh = h.slice(0, -1);
      setShapes((curr) => {
        setRedo((r) => [...r, curr]);
        return prev;
      });
      return nh;
    });
    setSelectedId(null);
  }, []);

  const handleRedo = useCallback(() => {
    setRedo((r) => {
      if (r.length === 0) return r;
      const next = r[r.length - 1];
      const nr = r.slice(0, -1);
      setShapes((curr) => {
        setHistory((h) => [...h, curr]);
        return next;
      });
      return nr;
    });
    setSelectedId(null);
  }, []);

  const handleClear = useCallback(() => {
    if (shapes.length === 0) return;
    commit([]);
    setSelectedId(null);
  }, [commit, shapes.length]);

  const handleDeleteSelected = useCallback(() => {
    if (!selectedId) return;
    commit((prev) => prev.filter((s) => s.id !== selectedId));
    setSelectedId(null);
  }, [commit, selectedId]);

  // ── Keyboard — Delete/Backspace removes the selected shape ────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (target?.isContentEditable) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        handleDeleteSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleDeleteSelected, selectedId]);

  // ── Transformer attach — wires resize handles to the selected node ─
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    const stage = stageRef.current;
    if (!stage) {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
      return;
    }
    if (!selectedId) {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
      return;
    }
    const node = stage.findOne<Konva.Node>(`#${selectedId}`);
    if (node) {
      tr.nodes([node]);
    } else {
      tr.nodes([]);
    }
    tr.getLayer()?.batchDraw();
  }, [selectedId, shapes]);

  // ── Export composite (screenshot + stage) after any shape change ─
  useEffect(() => {
    if (!stageRef.current || !naturalDims) return;
    // Defer one frame so Konva finishes drawing, then sample pixels.
    const id = requestAnimationFrame(() => {
      try {
        const stage = stageRef.current!;
        // Export at the stage's current pixel size (fit or actual). The
        // Konva Image node IS the screenshot — we don't need a separate
        // underlay since it's already on the bottom layer.
        const dataUrl = stage.toDataURL({
          mimeType: "image/jpeg",
          quality: 0.85,
          pixelRatio: naturalDims.width / (stage.width() || 1),
        });
        onExportRef.current(dataUrl);
      } catch (err) {
        console.error("[IssueAnnotator] export failed", err);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [shapes, stageDims, naturalDims, image]);

  // ── Stage pointer handlers ────────────────────────────────────────
  const handleMouseDown = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      const stage = e.target.getStage();
      if (!stage) return;
      const pos = stage.getPointerPosition();
      if (!pos) return;

      // Click on empty area → deselect.
      const clickedEmpty =
        e.target === stage || e.target === imgRef.current;

      if (tool === "select") {
        if (clickedEmpty) setSelectedId(null);
        return;
      }

      // Non-select tools always begin on empty area (avoid hijacking a
      // click on an existing shape's transformer handle).
      if (!clickedEmpty) return;

      if (tool === "text") {
        // Create a text immediately, then pop an inline editor.
        const id = makeId();
        const shape: TextShape = {
          id,
          type: "text",
          x: pos.x,
          y: pos.y,
          text: "Double-click to edit",
          fontSize: 18,
          fill: STROKE_COLOR,
        };
        commit((prev) => [...prev, shape]);
        setSelectedId(id);
        setTool("select");
        return;
      }

      isDrawingRef.current = true;
      const id = makeId();
      if (tool === "rect") {
        setDraft({
          id,
          type: "rect",
          x: pos.x,
          y: pos.y,
          width: 0,
          height: 0,
          stroke: STROKE_COLOR,
          strokeWidth: 2,
        });
      } else if (tool === "arrow") {
        setDraft({
          id,
          type: "arrow",
          points: [pos.x, pos.y, pos.x, pos.y],
          stroke: STROKE_COLOR,
          strokeWidth: 3,
        });
      } else if (tool === "pen") {
        setDraft({
          id,
          type: "pen",
          points: [pos.x, pos.y],
          stroke: STROKE_COLOR,
          strokeWidth: 3,
          opacity: 1,
        });
      } else if (tool === "highlight") {
        setDraft({
          id,
          type: "pen",
          points: [pos.x, pos.y],
          stroke: HIGHLIGHT_COLOR,
          strokeWidth: 18,
          opacity: 0.5,
        });
      }
    },
    [commit, tool],
  );

  const handleMouseMove = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (!isDrawingRef.current) return;
      const stage = e.target.getStage();
      if (!stage) return;
      const pos = stage.getPointerPosition();
      if (!pos) return;

      setDraft((d) => {
        if (!d) return d;
        if (d.type === "rect") {
          return { ...d, width: pos.x - d.x, height: pos.y - d.y };
        }
        if (d.type === "arrow") {
          return { ...d, points: [d.points[0], d.points[1], pos.x, pos.y] };
        }
        if (d.type === "pen") {
          return { ...d, points: [...d.points, pos.x, pos.y] };
        }
        return d;
      });
    },
    [],
  );

  const handleMouseUp = useCallback(() => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    if (!draft) return;

    // Discard degenerate shapes (a click with no drag shouldn't leave
    // a zero-sized rect / zero-length arrow lying around).
    let keep: Shape | null = draft;
    if (draft.type === "rect") {
      if (Math.abs(draft.width) < 4 || Math.abs(draft.height) < 4) keep = null;
      else {
        // Normalise negative dimensions (user dragged up/left).
        const nx = draft.width < 0 ? draft.x + draft.width : draft.x;
        const ny = draft.height < 0 ? draft.y + draft.height : draft.y;
        keep = {
          ...draft,
          x: nx,
          y: ny,
          width: Math.abs(draft.width),
          height: Math.abs(draft.height),
        };
      }
    } else if (draft.type === "arrow") {
      const [x1, y1, x2, y2] = draft.points;
      if (Math.hypot(x2 - x1, y2 - y1) < 6) keep = null;
    } else if (draft.type === "pen") {
      if (draft.points.length < 4) keep = null;
    }

    if (keep) {
      const committed = keep;
      commit((prev) => [...prev, committed]);
    }
    setDraft(null);
  }, [commit, draft]);

  // ── Shape-level handlers (drag end, transform end, select) ───────
  const updateShape = useCallback(
    (id: string, patch: Partial<Shape>) => {
      commit((prev) =>
        prev.map((s) => (s.id === id ? ({ ...s, ...patch } as Shape) : s)),
      );
    },
    [commit],
  );

  const onShapeClick = useCallback(
    (id: string) => (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (tool !== "select") return;
      e.cancelBubble = true;
      setSelectedId(id);
    },
    [tool],
  );

  // Inline text editor — mounted as a DOM <input> over the Konva text
  // node while editing. Konva has no native editable text, so this is
  // the standard pattern from the react-konva docs.
  const [editingText, setEditingText] = useState<{
    id: string;
    value: string;
    x: number;
    y: number;
    fontSize: number;
  } | null>(null);

  const beginEditText = useCallback(
    (shape: TextShape) => {
      const stage = stageRef.current;
      if (!stage) return;
      const node = stage.findOne<Konva.Text>(`#${shape.id}`);
      if (!node) return;
      const box = node.getClientRect();
      setEditingText({
        id: shape.id,
        value: shape.text,
        x: box.x,
        y: box.y,
        fontSize: shape.fontSize,
      });
    },
    [],
  );

  const commitTextEdit = useCallback(() => {
    if (!editingText) return;
    const { id, value } = editingText;
    setEditingText(null);
    updateShape(id, { text: value.length ? value : "Label" } as Partial<TextShape>);
  }, [editingText, updateShape]);

  // ── Render ────────────────────────────────────────────────────────
  const showFallback = !!loadError;

  const stageWidth = stageDims?.width ?? 0;
  const stageHeight = stageDims?.height ?? 0;

  // Scale factor applied to the Konva Image so it matches the stage
  // (the image data is at natural resolution, but the stage may be
  // scaled down in 'fit' mode). We scale the IMAGE, not the stage, so
  // annotation coordinates are expressed in stage-pixel space —
  // exporting via `stage.toDataURL({ pixelRatio })` upsamples back to
  // native resolution without distorting the annotations.
  const imageScaleX = naturalDims && stageWidth
    ? stageWidth / naturalDims.width
    : 1;
  const imageScaleY = naturalDims && stageHeight
    ? stageHeight / naturalDims.height
    : 1;

  const cursor = useMemo(() => cursorForTool(tool), [tool]);

  if (showFallback) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-[12px]">
        {/* Plain img on purpose — this is a data: URL passthrough on an
            error path; next/image would error on the data URI. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
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
      {/* Toolbar — compact icon-only buttons so the whole row fits
          under any modal width. Native `title` tooltips surface labels
          on hover. Active tool gets an amber wash + subtle ring. */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border bg-foreground/[0.03]">
        <div className="flex items-center gap-0.5">
          {TOOLS.map(({ id, label, Icon }) => {
            const active = tool === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setTool(id);
                  if (id !== "select") setSelectedId(null);
                }}
                className={`flex items-center justify-center h-7 w-7 rounded-md transition ${
                  active
                    ? "bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/50"
                    : "text-foreground/60 hover:bg-foreground/[0.08] hover:text-foreground/90"
                }`}
                title={label}
                aria-label={label}
                aria-pressed={active}
              >
                <Icon size={14} />
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setZoom((z) => (z === "fit" ? "actual" : "fit"))}
            className="flex items-center justify-center h-7 w-7 rounded-md text-foreground/60 hover:bg-foreground/[0.08] hover:text-foreground/90 transition"
            title={zoom === "fit" ? "View at actual size (100%)" : "Fit to preview"}
            aria-label={zoom === "fit" ? "View at actual size" : "Fit to preview"}
          >
            {zoom === "fit" ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
          </button>
          <div className="w-px h-4 bg-border mx-1" />
          <button
            type="button"
            onClick={handleUndo}
            disabled={history.length === 0}
            className="flex items-center justify-center h-7 w-7 rounded-md text-foreground/60 hover:bg-foreground/[0.08] hover:text-foreground/90 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-foreground/60 disabled:cursor-not-allowed transition"
            title="Undo"
            aria-label="Undo"
          >
            <Undo2 size={14} />
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={redo.length === 0}
            className="flex items-center justify-center h-7 w-7 rounded-md text-foreground/60 hover:bg-foreground/[0.08] hover:text-foreground/90 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-foreground/60 disabled:cursor-not-allowed transition"
            title="Redo"
            aria-label="Redo"
          >
            <Redo2 size={14} />
          </button>
          <button
            type="button"
            onClick={handleDeleteSelected}
            disabled={!selectedId}
            className="flex items-center justify-center h-7 w-7 rounded-md text-foreground/60 hover:bg-foreground/[0.08] hover:text-foreground/90 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-foreground/60 disabled:cursor-not-allowed transition"
            title="Delete selected (Delete key)"
            aria-label="Delete selected"
          >
            <X size={14} />
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="flex items-center justify-center h-7 w-7 rounded-md text-rose-300/70 hover:bg-rose-500/10 hover:text-rose-300 transition"
            title="Clear all annotations"
            aria-label="Clear all annotations"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto relative p-3">
        {naturalDims && (
          <div className="absolute top-4 left-4 z-10 px-2 py-1 rounded bg-black/70 border border-white/10 backdrop-blur-sm text-[10px] font-mono text-foreground/70 pointer-events-none">
            Captured at {naturalDims.width} × {naturalDims.height}px
          </div>
        )}
        <div
          className="relative mx-auto rounded-md overflow-hidden border border-border/60"
          style={stageWidth && stageHeight ? { width: stageWidth, height: stageHeight } : undefined}
        >
          {stageDims && image && (
            <Stage
              ref={stageRef}
              width={stageWidth}
              height={stageHeight}
              onMouseDown={handleMouseDown}
              onMousemove={handleMouseMove}
              onMouseup={handleMouseUp}
              onTouchStart={handleMouseDown}
              onTouchMove={handleMouseMove}
              onTouchEnd={handleMouseUp}
              style={{ cursor, background: "#000" }}
            >
              {/* Layer 1 — the screenshot underlay */}
              <Layer listening={false}>
                <KonvaImage
                  ref={imgRef}
                  image={image}
                  x={0}
                  y={0}
                  scaleX={imageScaleX}
                  scaleY={imageScaleY}
                />
              </Layer>

              {/* Layer 2 — annotation shapes + transformer */}
              <Layer>
                {shapes.map((s) => (
                  <ShapeView
                    key={s.id}
                    shape={s}
                    draggable={tool === "select"}
                    onSelect={onShapeClick(s.id)}
                    onChange={(patch) => updateShape(s.id, patch)}
                    onTextDblClick={
                      s.type === "text" ? () => beginEditText(s) : undefined
                    }
                  />
                ))}
                {draft && (
                  <ShapeView
                    shape={draft}
                    draggable={false}
                    onSelect={() => undefined}
                    onChange={() => undefined}
                  />
                )}
                <Transformer
                  ref={transformerRef}
                  rotateEnabled={false}
                  boundBoxFunc={(oldBox, newBox) => {
                    if (newBox.width < 10 || newBox.height < 10) return oldBox;
                    return newBox;
                  }}
                />
              </Layer>
            </Stage>
          )}

          {/* Inline text editor overlay */}
          {editingText && (
            <input
              autoFocus
              value={editingText.value}
              maxLength={200}
              onChange={(e) =>
                setEditingText({ ...editingText, value: e.target.value })
              }
              onBlur={commitTextEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") {
                  e.preventDefault();
                  commitTextEdit();
                }
              }}
              style={{
                position: "absolute",
                left: editingText.x,
                top: editingText.y,
                fontSize: editingText.fontSize,
                color: STROKE_COLOR,
                background: "rgba(0,0,0,0.85)",
                border: `1px solid ${STROKE_COLOR}`,
                borderRadius: 4,
                padding: "2px 6px",
                outline: "none",
                fontFamily: "Inter, sans-serif",
                minWidth: 80,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * ShapeView — renders one Shape using the appropriate Konva component.
 * Kept separate so the parent's render stays readable and so each shape
 * type can carry its own onDragEnd / onTransformEnd wiring.
 */
function ShapeView({
  shape,
  draggable,
  onSelect,
  onChange,
  onTextDblClick,
}: {
  shape: Shape;
  draggable: boolean;
  onSelect: (e: KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onChange: (patch: Partial<Shape>) => void;
  onTextDblClick?: () => void;
}) {
  const commonHandlers = {
    id: shape.id,
    draggable,
    onClick: onSelect as (e: KonvaEventObject<MouseEvent>) => void,
    onTap: onSelect as (e: KonvaEventObject<TouchEvent>) => void,
    onDragEnd: (e: KonvaEventObject<DragEvent>) => {
      const node = e.target;
      onChange({ x: node.x(), y: node.y() } as Partial<Shape>);
    },
  };

  if (shape.type === "rect") {
    return (
      <Rect
        {...commonHandlers}
        x={shape.x}
        y={shape.y}
        width={shape.width}
        height={shape.height}
        stroke={shape.stroke}
        strokeWidth={shape.strokeWidth}
        rotation={shape.rotation || 0}
        onTransformEnd={(e) => {
          const node = e.target as Konva.Rect;
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();
          node.scaleX(1);
          node.scaleY(1);
          onChange({
            x: node.x(),
            y: node.y(),
            width: Math.max(5, node.width() * scaleX),
            height: Math.max(5, node.height() * scaleY),
            rotation: node.rotation(),
          } as Partial<RectShape>);
        }}
      />
    );
  }

  if (shape.type === "arrow") {
    return (
      <Arrow
        {...commonHandlers}
        points={shape.points}
        stroke={shape.stroke}
        strokeWidth={shape.strokeWidth}
        fill={shape.stroke}
        pointerLength={12}
        pointerWidth={12}
        onDragEnd={(e) => {
          // Arrows use absolute points, so we fold x/y offset back into
          // the points array and reset node position to (0,0).
          const node = e.target;
          const dx = node.x();
          const dy = node.y();
          const pts = shape.points.map((p, i) =>
            i % 2 === 0 ? p + dx : p + dy,
          ) as [number, number, number, number];
          node.position({ x: 0, y: 0 });
          onChange({ points: pts } as Partial<ArrowShape>);
        }}
      />
    );
  }

  if (shape.type === "pen") {
    return (
      <Line
        {...commonHandlers}
        points={shape.points}
        stroke={shape.stroke}
        strokeWidth={shape.strokeWidth}
        opacity={shape.opacity}
        tension={0.3}
        lineCap="round"
        lineJoin="round"
        onDragEnd={(e) => {
          const node = e.target;
          const dx = node.x();
          const dy = node.y();
          const pts = shape.points.map((p, i) =>
            i % 2 === 0 ? p + dx : p + dy,
          );
          node.position({ x: 0, y: 0 });
          onChange({ points: pts } as Partial<PenShape>);
        }}
      />
    );
  }

  // text
  return (
    <KonvaText
      {...commonHandlers}
      x={shape.x}
      y={shape.y}
      text={shape.text}
      fontSize={shape.fontSize}
      fill={shape.fill}
      rotation={shape.rotation || 0}
      fontFamily="Inter, sans-serif"
      onDblClick={onTextDblClick}
      onDblTap={onTextDblClick}
      onTransformEnd={(e) => {
        const node = e.target as Konva.Text;
        const scaleX = node.scaleX();
        node.scaleX(1);
        node.scaleY(1);
        onChange({
          x: node.x(),
          y: node.y(),
          fontSize: Math.max(8, shape.fontSize * scaleX),
          rotation: node.rotation(),
        } as Partial<TextShape>);
      }}
    />
  );
}
