"use client";

/**
 * CountdownRing — Glossy 3D filled circle countdown timer.
 *
 * Full filled circle that drains like a pie as time runs out.
 * Color transitions from orange to red when urgent.
 */

interface CountdownRingProps {
  /** Seconds remaining */
  remaining: number;
  /** Total seconds (for calculating fill %) */
  total: number;
  /** Size in pixels */
  size?: number;
  /** Unused — kept for API compat */
  strokeWidth?: number;
}

export function CountdownRing({
  remaining,
  total,
  size = 18,
}: CountdownRingProps) {
  const progress = Math.max(0, Math.min(1, remaining / total));
  const isUrgent = remaining <= 120;
  const isExpired = remaining <= 0;

  const r = size / 2;
  const cx = r;
  const cy = r;

  // Build pie slice path (filled arc from top, clockwise)
  const angle = progress * 360;
  const rad = ((angle - 90) * Math.PI) / 180;
  const x = cx + r * Math.cos(rad);
  const y = cy + r * Math.sin(rad);
  const largeArc = angle > 180 ? 1 : 0;

  // Pie path: move to center → line to top → arc → close
  const piePath = progress >= 1
    ? `M ${cx},0 A ${r},${r} 0 1,1 ${cx - 0.001},0 Z`
    : progress <= 0
      ? ''
      : `M ${cx},${cy} L ${cx},0 A ${r},${r} 0 ${largeArc},1 ${x},${y} Z`;

  // Read CSS variable for primary color at render time
  const fillColor = isExpired ? '#6b7280' : isUrgent ? '#ef4444' : 'var(--primary)';
  const glowColor = isExpired ? 'transparent' : isUrgent ? '#ef444460' : 'color-mix(in srgb, var(--primary) 40%, transparent)';

  return (
    <div
      className={`relative shrink-0 ${isUrgent && !isExpired ? 'animate-pulse' : ''}`}
      style={{
        width: size,
        height: size,
        filter: isExpired ? 'none' : `drop-shadow(0 0 3px ${glowColor})`,
      }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background circle (unfilled area) — uses theme border color for subtle contrast */}
        <circle cx={cx} cy={cy} r={r} fill="var(--color-border, #2a2a2a)" />

        {/* Filled pie slice — uses same color as timer text */}
        {piePath && (
          <path
            d={piePath}
            fill={fillColor}
          />
        )}

        {/* Subtle inner border for depth */}
        <circle cx={cx} cy={cy} r={r - 0.5} fill="none" stroke="white" strokeWidth={0.3} opacity={0.08} />
      </svg>
    </div>
  );
}
