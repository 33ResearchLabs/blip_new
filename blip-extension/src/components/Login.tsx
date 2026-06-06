import { useState } from "react";
import { motion } from "framer-motion";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { setAuth, setRefreshToken } from "@/lib/auth";

const GOOGLE_CLIENT_ID = "722454220824-mbserknlggmb8fs3q210donqv1qk3529.apps.googleusercontent.com";

async function googleSignIn(): Promise<string> {
  const redirectUrl = chrome.identity.getRedirectURL();
  console.log("[blip] OAuth redirect URI:", redirectUrl);
  const nonce = crypto.randomUUID().replace(/-/g, "");

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  authUrl.searchParams.set("response_type", "id_token");
  authUrl.searchParams.set("redirect_uri", redirectUrl);
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("nonce", nonce);
  authUrl.searchParams.set("prompt", "select_account");

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl.toString(), interactive: true },
      (responseUrl) => {
        if (chrome.runtime.lastError || !responseUrl) {
          reject(new Error(chrome.runtime.lastError?.message || "Auth cancelled"));
          return;
        }
        const hash = new URL(responseUrl).hash.slice(1);
        const idToken = new URLSearchParams(hash).get("id_token");
        if (idToken) resolve(idToken);
        else reject(new Error("No id_token in response"));
      },
    );
  });
}

interface LoginProps { onLogin: () => void; }

export function Login({ onLogin }: LoginProps) {
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");

  const handleAuthData = async (data: any) => {
    const token = data?.accessToken ?? data?.access_token;
    const refreshTok = data?.refresh_token ?? data?.refreshToken;
    const user = data?.user;
    if (!token) { setError("Sign-in failed — please try again"); return; }
    await setAuth({
      accessToken: token,
      refreshToken: refreshTok ?? "",
      userId: user?.id ?? "",
      userName: user?.username ?? user?.email ?? "You",
      userAvatar: user?.avatar_url ?? null,
      expiresAt: Date.now() + 14 * 60 * 1000,
    });
    if (refreshTok) await setRefreshToken(refreshTok);
    onLogin();
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    setError("");
    try {
      const idToken = await googleSignIn();
      const res = await apiFetch("/api/auth/google", {
        method: "POST",
        body: JSON.stringify({ credential: idToken, role: "user", source: "extension" }),
      });
      const data = await res.json().catch(() => null);
      console.log("[blip] google auth response:", res.status, JSON.stringify(data));
      if (!res.ok) { setError(data?.error || "Google sign-in failed"); return; }
      await handleAuthData(data?.data);
    } catch (err: any) {
      if (err?.message !== "Auth cancelled") setError("Google sign-in failed — try again");
    } finally {
      setGoogleLoading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setError("");
    setLoading(true);
    try {
      const endpoint = mode === "signin" ? "/api/auth/login" : "/api/auth/register";
      const res = await apiFetch(endpoint, {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(data?.error || "Invalid credentials"); return; }
      await handleAuthData(data?.data);
    } catch {
      setError("Network error — check your connection");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={shell}>
      {/* Logo */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 28, fontWeight: 800, color: "#fff", letterSpacing: "-0.05em", lineHeight: 1 }}>
          blip<span style={{ color: "var(--amber)" }}>.</span>
        </div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 6, fontWeight: 500 }}>
          {mode === "signin" ? "Sign in to your account" : "Create your account"}
        </div>
      </div>

      {/* Google */}
      <motion.button
        whileTap={{ scale: 0.98 }}
        onClick={handleGoogle}
        disabled={googleLoading}
        style={googleBtn}
      >
        {googleLoading
          ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite", flexShrink: 0 }} />
          : <GoogleLogo />
        }
        {googleLoading ? "Signing in…" : "Continue with Google"}
      </motion.button>

      {/* Divider */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0" }}>
        <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontWeight: 500 }}>or</span>
        <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
      </div>

      {/* Form */}
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Field label="Email">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            maxLength={254}
            autoFocus
            required
            style={inputStyle}
          />
        </Field>

        <Field label="Password">
          <div style={{ position: "relative" }}>
            <input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              maxLength={100}
              required
              style={{ ...inputStyle, paddingRight: 42 }}
            />
            <button type="button" onClick={() => setShowPw(v => !v)} style={eyeBtn}>
              {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </Field>

        {error && <div style={errorBox}>{error}</div>}

        <motion.button
          type="submit"
          disabled={loading}
          whileTap={{ scale: 0.98 }}
          style={{ ...submitBtn, opacity: loading ? 0.75 : 1 }}
        >
          {loading
            ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />
            : mode === "signin" ? "Sign In" : "Create Account"
          }
        </motion.button>
      </form>

      <button
        onClick={() => { setMode(m => m === "signin" ? "register" : "signin"); setError(""); }}
        style={toggleBtn}
      >
        {mode === "signin" ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.45)", letterSpacing: "0.2px" }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function GoogleLogo() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const shell: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  padding: "36px 26px 20px",
  background: "radial-gradient(60% 40% at 50% 0%, rgba(255,176,46,0.06), transparent 70%), #0B0F14",
  overflowY: "auto",
};

const googleBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  width: "100%",
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.06)",
  color: "rgba(255,255,255,0.92)",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px 13px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.05)",
  color: "rgba(255,255,255,0.92)",
  fontSize: 14,
  outline: "none",
};

const eyeBtn: React.CSSProperties = {
  position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
  background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: 0,
};

const errorBox: React.CSSProperties = {
  fontSize: 12,
  color: "#b91c1c",
  padding: "8px 12px",
  background: "#fef2f2",
  borderRadius: 8,
  border: "1px solid #fecaca",
  lineHeight: 1.4,
};

const submitBtn: React.CSSProperties = {
  marginTop: 2,
  width: "100%",
  padding: "13px",
  borderRadius: 12,
  border: "none",
  background: "#ffffff",
  color: "#0B0F14",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
};

const toggleBtn: React.CSSProperties = {
  marginTop: 14,
  background: "none",
  border: "none",
  color: "rgba(255,255,255,0.35)",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  textAlign: "center",
  padding: 0,
};
