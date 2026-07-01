'use client';

/**
 * ChatImageViewer — Telegram-style full-screen image viewer.
 *
 * One presentational overlay, shared by User, Merchant, and Compliance chat
 * (mounted via ImageViewerProvider). Given the ordered list of images in a
 * conversation and the index of the tapped one, it shows:
 *   - dark full-screen backdrop (tap empty area / X / Esc to close)
 *   - zoom (buttons + scroll wheel + double-click) with drag-to-pan
 *   - rotate
 *   - prev/next (chevrons + ←/→ keys), clamped at the ends
 *   - a thumbnail filmstrip of every image in the conversation
 *   - download + forward
 *
 * Rendered through a portal to <body> so it escapes chat scroll/overflow
 * containers and sits above all surface chrome.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Download,
  Forward,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-react';

export interface ViewerImage {
  url: string;
  caption?: string | null;
  senderName?: string | null;
  timestamp?: Date | string | number | null;
}

interface ChatImageViewerProps {
  images: ViewerImage[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  /**
   * Optional in-app forward handler. When omitted, Forward falls back to the
   * native share sheet (mobile) or copy-link (desktop) — see handleForward.
   */
  onForward?: (image: ViewerImage, index: number) => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 5;

function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

function formatWhen(ts?: ViewerImage['timestamp']): string {
  if (ts == null) return '';
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fileNameFor(url: string, index: number): string {
  try {
    const path = new URL(url, window.location.href).pathname;
    const last = path.split('/').pop();
    if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return decodeURIComponent(last);
  } catch {
    /* fall through to generated name */
  }
  return `image-${index + 1}.jpg`;
}

export function ChatImageViewer({
  images,
  index,
  onIndexChange,
  onClose,
  onForward,
}: ChatImageViewerProps) {
  const current = images[index];

  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(
    null,
  );

  const total = images.length;
  const canPrev = index > 0;
  const canNext = index < total - 1;

  const goPrev = useCallback(() => {
    if (index > 0) onIndexChange(index - 1);
  }, [index, onIndexChange]);
  const goNext = useCallback(() => {
    if (index < total - 1) onIndexChange(index + 1);
  }, [index, total, onIndexChange]);

  const resetTransform = useCallback(() => {
    setScale(1);
    setRotation(0);
    setTx(0);
    setTy(0);
  }, []);

  const zoomBy = useCallback((delta: number) => {
    setScale((s) => {
      const next = clampScale(s + delta);
      if (next === 1) {
        setTx(0);
        setTy(0);
      }
      return next;
    });
  }, []);

  // Reset pan/zoom/rotation whenever the shown image changes.
  useEffect(() => {
    resetTransform();
  }, [index, resetTransform]);

  // Lock body scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Keyboard: Esc close, ←/→ navigate, +/-/0 zoom.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowLeft':
          goPrev();
          break;
        case 'ArrowRight':
          goNext();
          break;
        case '+':
        case '=':
          zoomBy(0.5);
          break;
        case '-':
        case '_':
          zoomBy(-0.5);
          break;
        case '0':
          resetTransform();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, goPrev, goNext, zoomBy, resetTransform]);

  // Wheel to zoom (non-passive so we can preventDefault the page scroll).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 0.3 : -0.3);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  // Keep the active thumbnail in view.
  useEffect(() => {
    const active = stripRef.current?.querySelector(
      '[data-active="true"]',
    ) as HTMLElement | null;
    active?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [index]);

  // Auto-dismiss the transient note (e.g. "Link copied").
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 1600);
    return () => clearTimeout(t);
  }, [note]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (scale <= 1) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, tx, ty };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setTx(dragRef.current.tx + (e.clientX - dragRef.current.x));
    setTy(dragRef.current.ty + (e.clientY - dragRef.current.y));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const handleDownload = async () => {
    if (!current) return;
    try {
      setBusy(true);
      const res = await fetch(current.url);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = fileNameFor(current.url, index);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch {
      // Cross-origin / CORS-blocked blob fetch: fall back to opening the URL.
      window.open(current.url, '_blank', 'noopener');
    } finally {
      setBusy(false);
    }
  };

  const handleForward = async () => {
    if (!current) return;
    if (onForward) {
      onForward(current, index);
      return;
    }
    // Phase-1 fallback: native share sheet (mobile) → forwards genuinely;
    // otherwise copy the link. Phase 2 replaces this with in-app chat forward.
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ url: current.url });
        return;
      }
    } catch {
      return; // user dismissed the share sheet
    }
    try {
      await navigator.clipboard.writeText(current.url);
      setNote('Link copied');
    } catch {
      window.open(current.url, '_blank', 'noopener');
    }
  };

  if (typeof document === 'undefined' || !current) return null;

  const iconBtn =
    'p-2 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed';

  const overlay = (
    <div
      className="fixed inset-0 z-[100000] flex flex-col bg-black/95 select-none"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      {/* Top bar */}
      <div
        className="flex items-center gap-3 px-4 py-3 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">
            {current.senderName || 'Photo'}
          </p>
          <p className="text-[11px] text-white/50 truncate">
            {[formatWhen(current.timestamp), total > 1 ? `${index + 1} of ${total}` : '']
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-0.5">
          <button className={iconBtn} onClick={() => zoomBy(-0.5)} title="Zoom out" aria-label="Zoom out">
            <ZoomOut className="w-5 h-5" />
          </button>
          <span className="w-11 text-center text-xs text-white/60 tabular-nums">
            {Math.round(scale * 100)}%
          </span>
          <button className={iconBtn} onClick={() => zoomBy(0.5)} title="Zoom in" aria-label="Zoom in">
            <ZoomIn className="w-5 h-5" />
          </button>
          <button
            className={iconBtn}
            onClick={() => setRotation((r) => r + 90)}
            title="Rotate"
            aria-label="Rotate"
          >
            <RotateCw className="w-5 h-5" />
          </button>
          <button
            className={iconBtn}
            onClick={handleDownload}
            disabled={busy}
            title="Download"
            aria-label="Download"
          >
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
          </button>
          <button
            className={iconBtn}
            onClick={handleForward}
            title="Forward"
            aria-label="Forward"
          >
            <Forward className="w-5 h-5" />
          </button>
          <button className={iconBtn} onClick={onClose} title="Close (Esc)" aria-label="Close">
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Image stage */}
      <div
        ref={stageRef}
        className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden"
      >
        {total > 1 && (
          <button
            className={`absolute left-2 sm:left-4 z-10 p-2 rounded-full bg-black/40 ${iconBtn}`}
            onClick={(e) => {
              e.stopPropagation();
              goPrev();
            }}
            disabled={!canPrev}
            aria-label="Previous image"
          >
            <ChevronLeft className="w-7 h-7" />
          </button>
        )}

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.url}
          alt={current.caption || 'Image'}
          draggable={false}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            e.stopPropagation();
            setScale((s) => (s > 1 ? 1 : 2.5));
            if (scale > 1) {
              setTx(0);
              setTy(0);
            }
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="max-w-full max-h-full object-contain"
          style={{
            transform: `translate(${tx}px, ${ty}px) scale(${scale}) rotate(${rotation}deg)`,
            transition: dragRef.current ? 'none' : 'transform 120ms ease-out',
            cursor: scale > 1 ? 'grab' : 'default',
            touchAction: 'none',
          }}
        />

        {total > 1 && (
          <button
            className={`absolute right-2 sm:right-4 z-10 p-2 rounded-full bg-black/40 ${iconBtn}`}
            onClick={(e) => {
              e.stopPropagation();
              goNext();
            }}
            disabled={!canNext}
            aria-label="Next image"
          >
            <ChevronRight className="w-7 h-7" />
          </button>
        )}

        {note && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-white/15 text-white text-xs backdrop-blur">
            {note}
          </div>
        )}
      </div>

      {/* Caption */}
      {current.caption && (
        <div
          className="px-4 pb-2 text-center text-sm text-white/80"
          onClick={(e) => e.stopPropagation()}
        >
          {current.caption}
        </div>
      )}

      {/* Filmstrip */}
      {total > 1 && (
        <div
          ref={stripRef}
          className="flex gap-2 px-4 py-3 overflow-x-auto justify-start sm:justify-center scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"
          onClick={(e) => e.stopPropagation()}
        >
          {images.map((im, i) => (
            <button
              key={`${im.url}-${i}`}
              data-active={i === index}
              onClick={() => onIndexChange(i)}
              className={`shrink-0 w-14 h-14 rounded-md overflow-hidden border-2 transition-colors ${
                i === index
                  ? 'border-white'
                  : 'border-transparent opacity-50 hover:opacity-90'
              }`}
              aria-label={`Image ${i + 1}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={im.url}
                alt=""
                draggable={false}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return createPortal(overlay, document.body);
}

export default ChatImageViewer;
