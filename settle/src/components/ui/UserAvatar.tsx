"use client";

import { memo, useState } from "react";
import type React from "react";
import { BlinkingAvatar } from "@/components/ui/BlinkingAvatar";

interface UserAvatarProps {
  /** Stored avatar URL if the backend already provided one. */
  src?: string | null;
  /** Fallback seed (username / email / pubkey) — same id always renders same avatar. */
  seed?: string | null;
  /** Render size in px. Component is square. */
  size?: number;
  /** Extra classes for the wrapper. */
  className?: string;
  /** Title / aria label. */
  alt?: string;
  /** Inline styles (e.g. custom borderRadius). */
  style?: React.CSSProperties;
}

/**
 * Avatar component. When a custom photo URL is provided it renders that;
 * otherwise falls back to the BlinkingAvatar — a deterministic animated
 * face that blinks every few seconds, unique per seed.
 */
export const UserAvatar = memo(function UserAvatar({
  src,
  seed,
  size = 28,
  className = "",
  alt,
  style,
}: UserAvatarProps) {
  const [errored, setErrored] = useState(false);

  // blip:classic:{seed} — stored when merchant picks a Classics avatar
  if (src && src.startsWith("blip:classic:")) {
    const classicSeed = src.slice("blip:classic:".length) || seed;
    return (
      <BlinkingAvatar
        seed={classicSeed}
        size={size}
        className={className}
        style={style}
      />
    );
  }

  const hasPhoto = !errored && src && src.trim();

  if (hasPhoto) {
    return (
      <img
        src={src!}
        alt={alt || seed || "user"}
        width={size}
        height={size}
        onError={() => setErrored(true)}
        className={`rounded-full bg-foreground/[0.04] object-cover shrink-0 ${className}`}
        style={{ width: size, height: size, ...style }}
      />
    );
  }

  return (
    <BlinkingAvatar
      seed={seed}
      size={size}
      className={className}
      style={style}
    />
  );
});
