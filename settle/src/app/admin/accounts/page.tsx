"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";

// Lazy-load the existing pages so we don't duplicate hundreds of lines.
// Each child renders its own admin header (which already points "Accounts"
// at this route, so the active-pill highlight stays correct).
const UsersPage = dynamic(() => import("../users/page"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-foreground/20 border-t-primary rounded-full animate-spin" />
    </div>
  ),
});

const MerchantsPage = dynamic(() => import("../merchants/page"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-foreground/20 border-t-primary rounded-full animate-spin" />
    </div>
  ),
});

type Tab = "users" | "merchants";

function AccountsInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tab: Tab = searchParams.get("tab") === "merchants" ? "merchants" : "users";

  const switchTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    router.replace(`/admin/accounts?${params.toString()}`);
  };

  return (
    <div className="relative">
      {tab === "users" ? <UsersPage /> : <MerchantsPage />}

      {/* Fixed floating Users / Merchants switcher — pinned to bottom-center,
          always visible above the embedded page's sticky header */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100]">
        <div className="inline-flex items-center gap-0.5 bg-card-solid rounded-full p-[4px] border border-border shadow-2xl shadow-black/40">
          <button
            onClick={() => switchTab("users")}
            className={`px-5 py-2 rounded-full text-[12px] font-medium transition-colors ${
              tab === "users"
                ? "bg-primary text-foreground shadow-lg shadow-primary/30"
                : "text-foreground/50 hover:text-foreground/80"
            }`}
          >
            Users
          </button>
          <button
            onClick={() => switchTab("merchants")}
            className={`px-5 py-2 rounded-full text-[12px] font-medium transition-colors ${
              tab === "merchants"
                ? "bg-primary text-foreground shadow-lg shadow-primary/30"
                : "text-foreground/50 hover:text-foreground/80"
            }`}
          >
            Merchants
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AccountsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-foreground/20 border-t-primary rounded-full animate-spin" />
        </div>
      }
    >
      <AccountsInner />
    </Suspense>
  );
}
