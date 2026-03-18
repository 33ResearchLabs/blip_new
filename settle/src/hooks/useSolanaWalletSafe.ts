"use client";

// Re-export useSolanaWallet directly — it now returns safe defaults when no provider is mounted
export { useSolanaWallet as useSolanaWalletSafe } from "@/context/SolanaWalletContext";
