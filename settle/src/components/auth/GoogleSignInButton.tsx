"use client";

/**
 * Google Identity Services "Continue with Google" button.
 *
 * Loads the official GIS script once per page, initializes with our
 * NEXT_PUBLIC_GOOGLE_CLIENT_ID, and renders Google's standard button into
 * a placeholder div. On credential issuance the JWT is POSTed to
 * /api/auth/google for server-side verification and session minting; the
 * resulting user/merchant payload is handed to onSuccess so each host
 * screen can fold it into its existing post-login plumbing.
 *
 * If NEXT_PUBLIC_GOOGLE_CLIENT_ID is not configured the component renders
 * nothing — no broken UI in environments where Google sign-in isn't set up.
 */

import { useCallback, useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: GsiConfig) => void;
          renderButton: (parent: HTMLElement, options: RenderButtonOptions) => void;
          prompt: () => void;
          cancel: () => void;
        };
      };
    };
  }
}

interface GsiCredentialResponse {
  credential?: string;
  select_by?: string;
}

interface GsiConfig {
  client_id: string;
  callback: (resp: GsiCredentialResponse) => void;
  ux_mode?: "popup" | "redirect";
  auto_select?: boolean;
  itp_support?: boolean;
  use_fedcm_for_prompt?: boolean;
}

interface RenderButtonOptions {
  type?: "standard" | "icon";
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "small" | "medium" | "large";
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
  shape?: "rectangular" | "pill" | "circle" | "square";
  logo_alignment?: "left" | "center";
  width?: number;
}

const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

let scriptPromise: Promise<void> | null = null;

function loadGisScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GIS_SCRIPT_SRC}"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("GIS load failed")));
      return;
    }
    const s = document.createElement("script");
    s.src = GIS_SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("GIS load failed"));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

interface GoogleSignInButtonProps {
  role: "user" | "merchant";
  source: string;
  onSuccess: (data: any) => void;
  onError?: (msg: string) => void;
  disabled?: boolean;
  waitlist?: boolean;
  referralCode?: string;
  theme?: "light" | "dark";
}

export default function GoogleSignInButton({
  role,
  source,
  onSuccess,
  onError,
  disabled,
  waitlist,
  referralCode,
  theme = "dark",
}: GoogleSignInButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  const exchangeCredential = useCallback(
    async (credential: string) => {
      setSubmitting(true);
      try {
        const res = await fetch("/api/auth/google", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            credential,
            role,
            source,
            ...(waitlist === true ? { waitlist: true } : {}),
            ...(referralCode ? { referral_code: referralCode } : {}),
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          onError?.(data?.error || "Google sign-in failed");
          return;
        }
        onSuccess(data.data);
      } catch (err) {
        console.error("[google] credential exchange failed", err);
        onError?.("Network error — please try again");
      } finally {
        setSubmitting(false);
      }
    },
    [role, source, waitlist, referralCode, onSuccess, onError],
  );

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    let cleanupResize: (() => void) | undefined;

    loadGisScript()
      .then(() => {
        if (cancelled || !window.google?.accounts?.id || !containerRef.current) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (resp) => {
            const cred = resp?.credential;
            if (typeof cred === "string") exchangeCredential(cred);
          },
          ux_mode: "popup",
          auto_select: false,
          itp_support: true,
        });

        const renderInto = (parent: HTMLElement) => {
          parent.innerHTML = "";
          const width = parent.clientWidth || 320;
          window.google!.accounts.id.renderButton(parent, {
            type: "standard",
            theme: theme === "dark" ? "filled_black" : "outline",
            size: "large",
            text: "continue_with",
            shape: "rectangular",
            logo_alignment: "left",
            width,
          });
        };
        renderInto(containerRef.current);

        const onResize = () => {
          if (containerRef.current) renderInto(containerRef.current);
        };
        window.addEventListener("resize", onResize);
        cleanupResize = () => window.removeEventListener("resize", onResize);
      })
      .catch((err) => {
        console.error("[google] script load failed", err);
        onError?.("Could not load Google sign-in");
      });

    return () => {
      cancelled = true;
      cleanupResize?.();
    };
  }, [clientId, exchangeCredential, onError, theme]);

  if (!clientId) return null;

  return (
    <div className="relative w-full">
      <div ref={containerRef} className="w-full overflow-hidden rounded-lg" />
      {(disabled || submitting) && (
        <div
          aria-hidden
          className="absolute inset-0 bg-black/30 rounded-lg cursor-not-allowed"
        />
      )}
    </div>
  );
}
