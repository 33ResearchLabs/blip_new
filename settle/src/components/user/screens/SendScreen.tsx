"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, X, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { UserAvatar } from "@/components/ui/UserAvatar";
import type { Screen, Order } from "./types";

interface SolanaWallet {
  connected: boolean;
  walletAddress: string | null;
  usdtBalance: number | null;
  sendUsdt?: (to: string, amount: number) => Promise<{ success: boolean; txHash?: string; error?: string }>;
}

interface SendScreenProps {
  orders: Order[];
  setScreen: (s: Screen) => void;
  solanaWallet: SolanaWallet;
}

interface Contact {
  id: string;
  name: string;
  avatarUrl?: string | null;
  walletAddress?: string;
}

export function SendScreen({ orders, setScreen, solanaWallet }: SendScreenProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Contact | null>(null);
  const [toAddress, setToAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [txResult, setTxResult] = useState<{ success: boolean; txHash?: string; error?: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  // Pre-fill wallet address when a contact is selected
  useEffect(() => {
    if (selected?.walletAddress) setToAddress(selected.walletAddress);
    else setToAddress("");
    setAmount("");
    setTxResult(null);
    if (selected) setTimeout(() => amountRef.current?.focus(), 80);
  }, [selected]);

  // Deduplicate merchants — most recent trade with each person first
  const seen = new Set<string>();
  const recentContacts: Contact[] = orders
    .filter(o => {
      if (seen.has(o.merchant.id)) return false;
      seen.add(o.merchant.id);
      return true;
    })
    .map(o => ({
      id: o.merchant.id,
      name: o.merchant.name,
      avatarUrl: o.merchant.avatarUrl,
      walletAddress: o.merchant.walletAddress ?? undefined,
    }));

  const filtered = query.trim()
    ? recentContacts.filter(c => c.name.toLowerCase().includes(query.toLowerCase()))
    : recentContacts;

  const handleSend = async () => {
    if (!solanaWallet.sendUsdt) return;
    const amt = parseFloat(amount);
    if (!toAddress.trim() || !amt || amt <= 0) return;
    setSending(true);
    setTxResult(null);
    const result = await solanaWallet.sendUsdt(toAddress.trim(), amt);
    setTxResult(result);
    setSending(false);
  };

  const resetSend = () => {
    setSelected(null);
    setToAddress("");
    setAmount("");
    setTxResult(null);
  };

  const amtNum = parseFloat(amount) || 0;
  const balance = solanaWallet.usdtBalance ?? 0;
  const isOverBalance = amtNum > balance;
  const canSend = !!solanaWallet.sendUsdt && !!toAddress.trim() && amtNum > 0 && !isOverBalance && !sending;

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 10,
      background: "#f4f3f1",
      display: "flex", flexDirection: "column",
      fontFamily: "Manrope, sans-serif",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        flexShrink: 0,
        background: "linear-gradient(160deg, #1e1e24 0%, #0f0f12 55%, #161619 100%)",
        padding: "16px 20px 24px",
        borderBottomLeftRadius: 28, borderBottomRightRadius: 28,
        boxShadow: "0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <button
            onClick={() => setScreen("home")}
            style={{
              width: 36, height: 36, borderRadius: 11,
              background: "rgba(255,255,255,0.1)", border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <ChevronLeft size={18} strokeWidth={2.2} style={{ color: "#fff" }} />
          </button>
          <span style={{ fontSize: 16, fontWeight: 800, color: "#fff", letterSpacing: "-0.01em" }}>
            Send USDT
          </span>
        </div>

        {/* Search */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "11px 14px", borderRadius: 16,
          background: "rgba(255,255,255,0.1)",
          border: "1px solid rgba(255,255,255,0.12)",
        }}>
          <svg viewBox="0 0 24 24" width={17} height={17} fill="none"
            stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name"
            maxLength={100}
            style={{
              flex: 1, background: "none", border: "none", outline: "none",
              fontSize: 14, fontWeight: 600, color: "#fff",
              fontFamily: "Manrope, sans-serif",
            }}
          />
          {query ? (
            <button onClick={() => setQuery("")} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}>
              <X size={14} strokeWidth={2.2} style={{ color: "rgba(255,255,255,0.5)" }} />
            </button>
          ) : null}
        </div>
      </div>

      {/* Contact list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 16px 32px", color: "#000000" }}>
        {/* debug — remove later */}
        {process.env.NODE_ENV === "development" && (
          <p style={{ fontSize: 10, color: "#666", marginBottom: 8 }}>
            {orders.length} orders · {recentContacts.length} contacts · names: {recentContacts.map(c => c.name || "(empty)").join(", ")}
          </p>
        )}
        {filtered.length > 0 ? (
          <>
            <p style={{
              fontSize: 11, fontWeight: 700, color: "#8a8a90",
              letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 10,
            }}>
              {query.trim() ? "Results" : "Recent"}
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px 8px" }}>
              {filtered.map((contact) => (
                <motion.button
                  key={contact.id}
                  whileTap={{ scale: 0.93 }}
                  onClick={() => setSelected(contact)}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 7,
                    background: "none", border: "none", cursor: "pointer", padding: 0, color: "#14151a",
                  }}
                >
                  <UserAvatar
                    src={contact.avatarUrl}
                    seed={contact.name}
                    size={56}
                    style={{ borderRadius: 999, flexShrink: 0 }}
                  />
                  <div style={{
                    fontSize: 12, fontWeight: 700,
                    color: "#000000 !important" as any,
                    textAlign: "center",
                    width: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    marginTop: 4,
                    background: "transparent",
                  }}>
                    <b style={{ color: "#111", fontWeight: 700, fontSize: 12 }}>{contact.name}</b>
                  </div>
                </motion.button>
              ))}
            </div>
          </>
        ) : (
          <div style={{ paddingTop: 60, textAlign: "center" }}>
            <div style={{
              width: 56, height: 56, borderRadius: 18,
              background: "rgba(20,21,26,0.06)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 14px",
            }}>
              <svg viewBox="0 0 24 24" width={24} height={24} fill="none"
                stroke="rgba(20,21,26,0.35)" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" />
              </svg>
            </div>
            <p style={{ fontSize: 14, fontWeight: 700, color: "#14151a", marginBottom: 4 }}>
              {query.trim() ? "No results" : "No recent contacts"}
            </p>
            <p style={{ fontSize: 12.5, fontWeight: 500, color: "#8a8a90" }}>
              {query.trim() ? "Try a different name" : "Complete a trade to see people here"}
            </p>
          </div>
        )}
      </div>

      {/* Send sheet — slides up when a contact is selected */}
      <AnimatePresence>
        {selected && (
          <>
            <motion.div
              key="send-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={resetSend}
              style={{ position: "absolute", inset: 0, zIndex: 20, background: "rgba(0,0,0,0.35)", backdropFilter: "blur(4px)" }}
            />
            <motion.div
              key="send-sheet"
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 420, damping: 38 }}
              style={{
                position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 21,
                background: "#fff",
                borderTopLeftRadius: 28, borderTopRightRadius: 28,
                padding: "0 20px calc(env(safe-area-inset-bottom, 16px) + 24px)",
                boxShadow: "0 -8px 40px rgba(0,0,0,0.18)",
              }}
            >
              {/* Drag handle */}
              <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 8px" }}>
                <span style={{ width: 36, height: 4, borderRadius: 999, background: "rgba(20,21,26,0.12)", display: "block" }} />
              </div>

              {/* Recipient */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <UserAvatar src={selected.avatarUrl} seed={selected.name} size={44} style={{ borderRadius: 14 }} />
                  <div>
                    <p style={{ fontSize: 15, fontWeight: 800, color: "#14151a", letterSpacing: "-0.01em" }}>
                      {selected.name}
                    </p>
                    <p style={{ fontSize: 11.5, fontWeight: 500, color: "#8a8a90", marginTop: 1 }}>
                      Solana · USDT
                    </p>
                  </div>
                </div>
                <button onClick={resetSend} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                  <X size={18} strokeWidth={2} style={{ color: "rgba(20,21,26,0.4)" }} />
                </button>
              </div>

              {/* Wallet address — always shown; pre-filled if known, editable otherwise */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#8a8a90", letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: 8 }}>
                  Wallet address
                </label>
                <input
                  type="text"
                  value={toAddress}
                  onChange={e => setToAddress(e.target.value)}
                  placeholder="Paste Solana wallet address"
                  maxLength={44}
                  readOnly={!!selected.walletAddress}
                  style={{
                    width: "100%", padding: "12px 14px", borderRadius: 14,
                    border: "1.5px solid rgba(20,21,26,0.12)",
                    fontSize: 12, fontWeight: 600, color: "#14151a",
                    fontFamily: "ui-monospace, monospace",
                    background: selected.walletAddress ? "rgba(20,21,26,0.04)" : "#f9f8f6",
                    outline: "none", boxSizing: "border-box",
                    opacity: selected.walletAddress ? 0.75 : 1,
                  }}
                />
              </div>

              {/* Amount */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "#8a8a90", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    Amount (USDT)
                  </label>
                  <button
                    onClick={() => setAmount(balance.toFixed(2))}
                    style={{ fontSize: 11.5, fontWeight: 700, color: "#ffb02e", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                  >
                    Max · {balance.toFixed(2)}
                  </button>
                </div>
                <input
                  ref={amountRef}
                  type="number"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0.00"
                  max={balance}
                  maxLength={14}
                  style={{
                    width: "100%", padding: "14px", borderRadius: 14,
                    border: `1.5px solid ${isOverBalance ? "var(--color-error-border)" : "rgba(20,21,26,0.12)"}`,
                    fontSize: 28, fontWeight: 800, color: "#14151a",
                    fontFamily: "ui-monospace, monospace", textAlign: "center",
                    background: "#f9f8f6", outline: "none", boxSizing: "border-box",
                  }}
                />
                {isOverBalance && (
                  <p style={{ fontSize: 11.5, fontWeight: 600, color: "var(--color-error)", marginTop: 6 }}>
                    Insufficient balance
                  </p>
                )}
              </div>

              {/* Result states */}
              <AnimatePresence>
                {txResult && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    style={{
                      marginBottom: 14, padding: "12px 14px", borderRadius: 14,
                      background: txResult.success ? "rgba(63,174,106,0.08)" : "var(--color-error-dim)",
                      border: `1px solid ${txResult.success ? "rgba(63,174,106,0.25)" : "var(--color-error-border)"}`,
                      display: "flex", alignItems: "center", gap: 10,
                    }}
                  >
                    {txResult.success
                      ? <CheckCircle2 size={18} style={{ color: "#3fae6a", flexShrink: 0 }} />
                      : <AlertCircle size={18} style={{ color: "var(--color-error)", flexShrink: 0 }} />
                    }
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 700, color: txResult.success ? "#2d8c52" : "var(--color-error)" }}>
                        {txResult.success ? "Sent successfully" : "Send failed"}
                      </p>
                      {txResult.txHash && (
                        <p style={{ fontSize: 11, fontWeight: 500, color: "#8a8a90", marginTop: 2, fontFamily: "ui-monospace, monospace" }}>
                          TX: {txResult.txHash.slice(0, 16)}…
                        </p>
                      )}
                      {txResult.error && (
                        <p style={{ fontSize: 11.5, fontWeight: 500, color: "var(--color-error)", marginTop: 2 }}>
                          {txResult.error}
                        </p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Send button */}
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={handleSend}
                disabled={!canSend}
                style={{
                  width: "100%", padding: "15px", borderRadius: 16,
                  border: "none", cursor: canSend ? "pointer" : "not-allowed",
                  background: canSend ? "#0f0f12" : "rgba(20,21,26,0.1)",
                  color: canSend ? "#fff" : "rgba(20,21,26,0.35)",
                  fontSize: 15, fontWeight: 800, letterSpacing: "-0.01em",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  boxSizing: "border-box",
                }}
              >
                {sending ? (
                  <><Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> Sending…</>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" width={17} height={17} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
                    </svg>
                    Send USDT on Solana
                  </>
                )}
              </motion.button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
