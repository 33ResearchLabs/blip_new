import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, Send, Loader2 } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

interface ChatProps {
  orderId: string;
  userId: string;
  onBack: () => void;
}

interface Msg {
  id: string;
  sender_id: string;
  sender_type: string;
  content: string;
  created_at: string;
}

export function Chat({ orderId, userId, onBack }: ChatProps) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    const res = await fetchWithAuth(`/api/orders/${orderId}/messages`);
    if (res.ok) {
      const d = await res.json().catch(() => null);
      if (Array.isArray(d?.data?.messages)) setMsgs(d.data.messages);
      else if (Array.isArray(d?.data)) setMsgs(d.data);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [orderId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  const send = async () => {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    setText("");
    try {
      await fetchWithAuth(`/api/orders/${orderId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content, sender_id: userId }),
      });
      await load();
    } catch {
      setText(content);
    } finally {
      setSending(false);
    }
  };

  const isMe = (msg: Msg) => msg.sender_id === userId;

  return (
    <div style={page}>
      <header style={hdr}>
        <motion.button whileTap={{ scale: 0.92 }} onClick={onBack} style={backBtn}>
          <ChevronLeft size={18} />
        </motion.button>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>Chat</div>
          <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 1 }}>#{orderId.slice(-6).toUpperCase()}</div>
        </div>
        <div style={{ width: 32 }} />
      </header>

      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        {loading ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Loader2 size={20} color="var(--amber)" style={{ animation: "spin 1s linear infinite" }} />
          </div>
        ) : msgs.length === 0 ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <div style={{ fontSize: 28 }}>💬</div>
            <div style={{ fontSize: 13, color: "var(--text-tertiary)", fontWeight: 600 }}>No messages yet</div>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", opacity: 0.6 }}>Start the conversation</div>
          </div>
        ) : (
          msgs.map(msg => (
            <div key={msg.id} style={{ display: "flex", justifyContent: isMe(msg) ? "flex-end" : "flex-start" }}>
              <div style={{
                maxWidth: "75%", padding: "9px 13px", borderRadius: isMe(msg) ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                background: isMe(msg) ? "#fff" : "var(--bg-card)",
                border: isMe(msg) ? "none" : "1px solid var(--border)",
                color: isMe(msg) ? "#0B0F14" : "var(--text-primary)",
                fontSize: 13, lineHeight: 1.45, fontWeight: 500,
              }}>
                {msg.content}
                <div style={{ fontSize: 9, marginTop: 4, opacity: 0.5, textAlign: "right" }}>
                  {new Date(msg.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{ padding: "8px 12px 12px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "flex-end", flexShrink: 0 }}>
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
          placeholder="Type a message…"
          maxLength={1000}
          style={{
            flex: 1, padding: "10px 14px", borderRadius: 20,
            border: "1px solid var(--border)", background: "var(--bg-card)",
            color: "var(--text-primary)", fontSize: 13, outline: "none", fontFamily: "inherit",
          }}
        />
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={send}
          disabled={!text.trim() || sending}
          style={{
            width: 38, height: 38, borderRadius: "50%",
            background: text.trim() ? "#fff" : "var(--surface)",
            border: "none", cursor: text.trim() ? "pointer" : "default",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}
        >
          {sending
            ? <Loader2 size={15} color="#0B0F14" style={{ animation: "spin 1s linear infinite" }} />
            : <Send size={15} color={text.trim() ? "#0B0F14" : "var(--text-tertiary)"} />
          }
        </motion.button>
      </div>
    </div>
  );
}

const page: React.CSSProperties = { height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)", overflow: "hidden" };
const hdr: React.CSSProperties = { padding: "12px 16px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid var(--border)", flexShrink: 0 };
const backBtn: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-secondary)", cursor: "pointer", padding: "6px", display: "flex", alignItems: "center", flexShrink: 0 };
