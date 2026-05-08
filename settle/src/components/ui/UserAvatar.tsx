"use client";

import { memo, useState } from "react";
import { defaultAvatarUrl } from "@/lib/avatars";

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
}

/**
 * Square avatar that prefers an explicit URL but always falls back to a
 * deterministic DiceBear avatar derived from `seed`. Renders nothing
 * placeholder-y — once the seed/src is known there is always an image.
 */
export const UserAvatar = memo(function UserAvatar({
  src,
  seed,
  size = 28,
  className = "",
  alt,
}: UserAvatarProps) {
  const [errored, setErrored] = useState(false);
  const fallback = defaultAvatarUrl(seed || "anonymous");
  const url = !errored && src && src.trim() ? src : fallback;

  return (
    <img
      src={url}
      alt={alt || seed || "user"}
      width={size}
      height={size}
      onError={() => setErrored(true)}
      className={`rounded-full bg-foreground/[0.04] object-cover shrink-0 ${className}`}
      style={{ width: size, height: size }}
    />
  );
});
