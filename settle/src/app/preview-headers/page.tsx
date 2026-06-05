"use client";

// TEMPORARY preview route — used to screenshot standardized screen headers.
// Safe to delete. Renders one screen full-viewport based on ?screen= and
// ?theme= query params, inside the user theme scope so design tokens resolve.
import { useEffect, useState } from "react";
import { SupportScreen } from "@/components/user/screens/SupportScreen";
import { UpiPayScreen } from "@/components/user/UpiPayScreen";

const noop = () => {};

export default function PreviewHeadersPage() {
  const [screen, setScreen] = useState("support");
  const [theme, setTheme] = useState("light");

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setScreen(p.get("screen") || "support");
    setTheme(p.get("theme") || "light");
  }, []);

  return (
    <div
      className={`user-scope ${theme === "light" ? "user-light" : ""} min-h-dvh`}
      style={{ background: "var(--color-surface-base)" }}
    >
      {screen === "support" && (
        <SupportScreen setScreen={noop} previousScreen={"profile" as never} />
      )}
      {screen === "scan" && (
        <UpiPayScreen
          onClose={noop}
          currentRate={98}
          usdtBalance={0}
          walletReady={false}
          walletCta={{ label: "Connect wallet", onClick: noop }}
          onConfirm={noop}
        />
      )}
    </div>
  );
}
