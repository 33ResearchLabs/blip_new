'use client';

// Shared order card primitives used by both MobileOrdersView and PendingOrdersPanel.
import { useRef, useState } from 'react';
import { ArrowRight, Check, Loader2 } from 'lucide-react';

/* ── Avatar: gradient + initials fallback, optional green verified ring ── */
export function OrderAvatar({ name, avatarUrl, size = 44, verified = false }: {
  name: string; avatarUrl?: string; size?: number; verified?: boolean;
}) {
  const initials = name.split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase()).slice(0, 2).join('');
  const ring = verified ? { boxShadow: '0 0 0 2px #17171a, 0 0 0 3.5px #22e29a' } : {};
  if (avatarUrl) {
    return (
      <img src={avatarUrl} alt={name} width={size} height={size}
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size, ...ring }} />
    );
  }
  return (
    <div
      className="shrink-0 rounded-full flex items-center justify-center text-white font-black"
      style={{
        width: size, height: size, flexShrink: 0,
        background: 'linear-gradient(150deg,#ff8a3d,#ff5d73)',
        fontSize: Math.round(size * 0.36), letterSpacing: '-0.02em', ...ring,
      }}>
      {initials || '?'}
    </div>
  );
}

/* ── HoldSwipe: drag knob right OR press-and-hold 950ms to confirm ── */
export function HoldSwipe({ onAccept, loading = false, height = 52 }: {
  onAccept: () => void; loading?: boolean; height?: number;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [x, setXRaw] = useState(0);
  const [done, setDone] = useState(false);
  const [active, setActive] = useState(false);
  const xRef = useRef(0);
  const s = useRef({ dragging: false, moved: false, startX: 0, holdStart: 0, raf: 0 });
  const knob = height - 8;
  const HOLD_MS = 950;

  const maxX = () => trackRef.current ? trackRef.current.clientWidth - knob - 8 : 0;
  const setX = (v: number) => { xRef.current = v; setXRaw(v); };
  const complete = () => { setDone(true); setActive(false); setX(maxX()); onAccept(); };

  const onDown = (e: React.PointerEvent) => {
    if (done || loading) return;
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch (_) {}
    const st = s.current;
    st.dragging = true; st.moved = false; st.startX = e.clientX; st.holdStart = performance.now();
    setActive(true);
    const loop = (t: number) => {
      if (!st.dragging || st.moved) return;
      const p = Math.min(1, (t - st.holdStart) / HOLD_MS);
      setX(p * maxX());
      if (p >= 1) { st.dragging = false; complete(); return; }
      st.raf = requestAnimationFrame(loop);
    };
    st.raf = requestAnimationFrame(loop);
  };

  const onMove = (e: React.PointerEvent) => {
    const st = s.current;
    if (!st.dragging || done) return;
    if (Math.abs(e.clientX - st.startX) > 4) { st.moved = true; cancelAnimationFrame(st.raf); }
    if (st.moved && trackRef.current) {
      const rect = trackRef.current.getBoundingClientRect();
      setX(Math.max(0, Math.min(e.clientX - rect.left - knob / 2 - 4, maxX())));
    }
  };

  const onUp = () => {
    const st = s.current;
    if (!st.dragging || done) return;
    st.dragging = false; cancelAnimationFrame(st.raf); setActive(false);
    if (xRef.current >= maxX() - 4 && maxX() > 0) complete(); else setX(0);
  };

  const frac = maxX() ? x / maxX() : 0;

  return (
    <div
      ref={trackRef}
      className="relative flex-1 overflow-hidden select-none"
      style={{
        height, borderRadius: height / 2,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.14)',
        touchAction: 'none',
      }}
    >
      {/* Fill */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: height / 2, background: '#22e29a',
        opacity: done ? 1 : 0.16 + frac * 0.55,
        width: done ? '100%' : x + knob + 8,
        transition: active ? 'none' : 'width .28s, opacity .28s',
      }} />
      {/* Label */}
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
        justifyContent: 'center', gap: 8, fontWeight: 700, fontSize: 14,
        color: done ? '#04130c' : 'rgba(255,255,255,0.5)',
        opacity: done ? 1 : Math.max(0, 1 - frac * 1.4),
        paddingLeft: knob, userSelect: 'none',
      }}>
        {done ? <><Check className="w-4 h-4" /> Accepted</> : 'Hold or slide to accept'}
      </div>
      {/* Knob */}
      {!done && (
        <div
          onPointerDown={onDown} onPointerMove={onMove}
          onPointerUp={onUp} onPointerCancel={onUp}
          style={{
            position: 'absolute', top: 4, left: 4, width: knob, height: knob,
            borderRadius: '999px',
            background: loading ? 'rgba(34,226,154,0.5)' : '#22e29a',
            color: '#04130c', display: 'flex', alignItems: 'center', justifyContent: 'center',
            transform: `translateX(${x}px)`,
            transition: active ? 'none' : 'transform .28s',
            cursor: active ? 'grabbing' : 'grab',
            boxShadow: '0 4px 16px rgba(34,226,154,0.4)',
            touchAction: 'none',
          }}
        >
          {loading
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <ArrowRight className="w-5 h-5" />}
        </div>
      )}
    </div>
  );
}
