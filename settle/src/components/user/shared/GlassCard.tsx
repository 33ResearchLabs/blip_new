"use client";

import { ReactNode } from "react";

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export default function GlassCard({ children, className = "", onClick, style }: GlassCardProps) {
  return (
    <div
      onClick={onClick}
      className={`rounded-[22px] ${className}`}
      style={{
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid rgba(255,255,255,0.055)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
