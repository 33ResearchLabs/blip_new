"use client";

const DEFAULT_DATA = [28, 42, 33, 58, 44, 70, 55, 82, 69, 98, 87, 115, 102, 138];

interface SparklineProps {
  data?: number[];
  width?: number;
  height?: number;
  color?: string;
}

export default function Sparkline({ data = DEFAULT_DATA, width = 300, height = 56, color = '#10b981' }: SparklineProps) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const rng = max - min || 1;
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * width,
    y: height - 6 - ((v - min) / rng) * (height - 14),
  }));
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const last = pts[pts.length - 1];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full">
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
        <filter id="sparkGlow">
          <feGaussianBlur stdDeviation="2.5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <path d={area} fill="url(#sparkGrad)" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last.x} cy={last.y} r="3.5" fill={color} filter="url(#sparkGlow)" />
      <circle cx={last.x} cy={last.y} r="7" fill="none" stroke={color} strokeWidth="1" opacity="0.35" />
    </svg>
  );
}
