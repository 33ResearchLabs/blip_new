"use client";

const WAVE_D = "M20 60 L36 60 L48 24 L72 96 L84 60 L100 60";

interface BlipBouncyLogoProps {
  size?: number;
  variant?: "light" | "dark";
  /** Border radius as a fraction of size (default 0.26) */
  radiusFraction?: number;
}

export function BlipBouncyLogo({
  size = 280,
  variant = "light",
  radiusFraction = 0.26,
}: BlipBouncyLogoProps) {
  const isLight = variant === "light";
  const bg = isLight ? "#ffffff" : "#0b0b0c";
  const stroke = isLight ? "#0b0b0c" : "#ffffff";
  const beadFill = isLight ? "#ffffff" : "#0b0b0c";
  const br = size * radiusFraction;

  const boxShadow = isLight
    ? "0 1px 0 rgba(0,0,0,0.04), 0 14px 34px -16px rgba(0,0,0,0.32), inset 0 0 0 1px rgba(0,0,0,0.06)"
    : "0 14px 34px -16px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.08)";

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: br,
        background: bg,
        boxShadow,
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
        position: "relative",
        flexShrink: 0,
      }}
    >
      <svg viewBox="0 0 120 120" width="100%" height="100%">
        <path
          d={WAVE_D}
          fill="none"
          stroke={stroke}
          strokeWidth="11"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <g>
          <animateMotion
            dur="1.8s"
            repeatCount="indefinite"
            path={WAVE_D}
            calcMode="spline"
            keyTimes="0;0.5;1"
            keyPoints="0;0.5;1"
            keySplines="0.45 0 0.55 1;0.45 0 0.55 1"
          />
          <ellipse rx="5" ry="5" fill={beadFill}>
            <animate
              attributeName="ry"
              values="5;3.4;6;3.4;5"
              keyTimes="0;0.25;0.5;0.75;1"
              dur="1.8s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="rx"
              values="5;6.2;4;6.2;5"
              keyTimes="0;0.25;0.5;0.75;1"
              dur="1.8s"
              repeatCount="indefinite"
            />
          </ellipse>
        </g>
      </svg>
    </div>
  );
}
