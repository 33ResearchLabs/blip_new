"use client";

import { BlinkingAvatar } from "@/components/ui/BlinkingAvatar";

const SEEDS = [
  "merchant",
  "Felix",
  "Aneka",
  "Max",
  "Luna",
  "Charlie",
  "Oliver",
  "Milo",
];

const SIZES = [28, 36, 48, 64];

export default function AvatarPreview() {
  return (
    <div style={{ background: "#08080a", minHeight: "100vh", padding: 40, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ color: "#f5f5f7", fontSize: 22, fontWeight: 700, marginBottom: 8, letterSpacing: "-0.02em" }}>
        BlinkingAvatar Preview
      </h1>
      <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 13, marginBottom: 40 }}>
        Each avatar blinks every ~5 seconds. Color and face are deterministic from seed.
      </p>

      {/* Sizes */}
      <section style={{ marginBottom: 48 }}>
        <h2 style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 20 }}>Sizes — seed "merchant"</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          {SIZES.map((size) => (
            <div key={size} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <BlinkingAvatar seed="merchant" size={size} />
              <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 11, fontWeight: 600 }}>{size}px</span>
            </div>
          ))}
        </div>
      </section>

      {/* Seeds at 48px */}
      <section style={{ marginBottom: 48 }}>
        <h2 style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 20 }}>Unique per seed — 48px</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
          {SEEDS.map((seed) => (
            <div key={seed} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <BlinkingAvatar seed={seed} size={48} />
              <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 11, fontWeight: 600 }}>{seed}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Navbar context mock */}
      <section>
        <h2 style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 20 }}>In context — navbar mock</h2>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 18px",
          background: "#111113",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 16,
          maxWidth: 420,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ borderRadius: 999, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)" }}>
              <BlinkingAvatar seed="merchant" size={32} />
            </div>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#f5f5f7" }}>@merchant</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {["Felix", "Luna", "Charlie"].map((s) => (
              <div key={s} style={{ borderRadius: 999, overflow: "hidden", border: "1px solid rgba(255,255,255,0.09)" }}>
                <BlinkingAvatar seed={s} size={28} />
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
