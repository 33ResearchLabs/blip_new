import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Login } from "@/components/Login";
import { Home } from "@/components/Home";
import { TradeForm } from "@/components/TradeForm";
import { OrderDetail } from "@/components/OrderDetail";
import { Chat } from "@/components/Chat";
import { getAuth, type StoredAuth } from "@/lib/auth";
import { Loader2 } from "lucide-react";

type Screen = "loading" | "login" | "home" | "trade" | "order" | "chat";

const slide = {
  initial: { opacity: 0, x: "6%" },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: "-6%" },
  transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const },
};

export function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [auth, setAuthState] = useState<StoredAuth | null>(null);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);

  useEffect(() => {
    getAuth().then((a) => {
      setAuthState(a);
      setScreen(a ? "home" : "login");
    });
  }, []);

  const handleLogin = async () => {
    const a = await getAuth();
    setAuthState(a);
    setScreen("home");
  };

  const handleLogout = () => {
    setAuthState(null);
    setScreen("login");
  };

  const openOrder = (id: string) => {
    setActiveOrderId(id);
    setScreen("order");
  };

  const openChat = (id: string) => {
    setActiveOrderId(id);
    setScreen("chat");
  };

  if (screen === "loading") {
    return (
      <div style={{ width: 400, height: 600, background: "#0B0F14", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
        <div style={{ fontSize: 28, fontWeight: 900, color: "#fff", letterSpacing: "-1px" }}>
          blip<span style={{ color: "#ffb02e" }}>.</span>
        </div>
        <Loader2 size={18} color="#ffb02e" style={{ animation: "spin 1s linear infinite" }} />
      </div>
    );
  }

  return (
    <div style={{ width: 400, height: 600, background: "#0B0F14", overflow: "hidden", position: "relative" }}>
      <AnimatePresence mode="wait">
        {screen === "login" && (
          <motion.div key="login" {...slide} style={{ position: "absolute", inset: 0 }}>
            <Login onLogin={handleLogin} />
          </motion.div>
        )}

        {screen === "home" && auth && (
          <motion.div key="home" {...slide} style={{ position: "absolute", inset: 0 }}>
            <Home
              auth={auth}
              onLogout={handleLogout}
              onTrade={() => setScreen("trade")}
              onOrder={openOrder}
            />
          </motion.div>
        )}

        {screen === "trade" && auth && (
          <motion.div key="trade" {...slide} style={{ position: "absolute", inset: 0 }}>
            <TradeForm
              userId={auth.userId}
              onBack={() => setScreen("home")}
              onOrderCreated={(id) => { setActiveOrderId(id); setScreen("order"); }}
            />
          </motion.div>
        )}

        {screen === "order" && activeOrderId && auth && (
          <motion.div key="order" {...slide} style={{ position: "absolute", inset: 0 }}>
            <OrderDetail
              orderId={activeOrderId}
              userId={auth.userId}
              onBack={() => setScreen("home")}
              onChat={() => openChat(activeOrderId)}
            />
          </motion.div>
        )}

        {screen === "chat" && activeOrderId && auth && (
          <motion.div key="chat" {...slide} style={{ position: "absolute", inset: 0 }}>
            <Chat
              orderId={activeOrderId}
              userId={auth.userId}
              onBack={() => setScreen("order")}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
