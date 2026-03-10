'use client';

import { useState } from 'react';
import { Loader2, X } from 'lucide-react';

interface LandingPageProps {
  loginForm: { username: string; password: string };
  setLoginForm: (f: { username: string; password: string }) => void;
  authMode: 'login' | 'register';
  setAuthMode: (m: 'login' | 'register') => void;
  handleUserLogin: () => void;
  handleUserRegister: () => void;
  isLoggingIn: boolean;
  loginError: string;
  setLoginError: (e: string) => void;
}

export function LandingPage({
  loginForm, setLoginForm, authMode, setAuthMode,
  handleUserLogin, handleUserRegister, isLoggingIn, loginError, setLoginError,
}: LandingPageProps) {
  const [showAuth, setShowAuth] = useState(false);

  const openAuth = () => { setShowAuth(true); setLoginError(''); };
  const closeAuth = () => { setShowAuth(false); setLoginError(''); };

  return (
    <div style={{ background: '#090909', color: '#fff', fontFamily: 'Inter, sans-serif', minHeight: '100dvh', overflowX: 'hidden' }}>
      <style>{`
        @keyframes blip-flow {
          0%   { background-position: 100% 50%; }
          50%  { background-position:   0% 50%; }
          100% { background-position: 100% 50%; }
        }
        @keyframes blip-progress {
          0%   { width: 0%;  opacity: 1; }
          55%  { width: 73%; opacity: 1; }
          72%  { width: 75%; opacity: 1; }
          88%  { width: 75%; opacity: 0; }
          100% { width: 0%;  opacity: 0; }
        }
        @keyframes blip-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
        .blip-gradient-text {
          background: linear-gradient(90deg, #fff 0%, #ffe8dc 18%, #ffb899 30%, #ff8c50 42%, #ff6b35 50%, #ff8c50 58%, #ffb899 70%, #ffe8dc 82%, #fff 100%);
          background-size: 300% 100%;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: blip-flow 7s ease-in-out infinite;
        }
        .blip-progress-bar { animation: blip-progress 5.5s ease-in-out infinite; }
        .blip-dot { animation: blip-pulse 2.4s ease-in-out infinite; }
        .blip-dot-delay { animation: blip-pulse 2.4s ease-in-out 0.8s infinite; }
        .blip-badge-dot { animation: blip-pulse 1.6s ease-in-out infinite; }
        .blip-prob-card {
          transition: transform 0.32s cubic-bezier(0.25,0.46,0.45,0.94), box-shadow 0.32s cubic-bezier(0.25,0.46,0.45,0.94);
          cursor: default;
        }
        .blip-prob-card:hover { transform: translateY(-4px); }
        .blip-card-cost:hover  { box-shadow: inset 0 1px 0 rgba(255,255,255,0.09), 0 0 100px 36px rgba(255,122,69,0.13), 0 8px 20px rgba(0,0,0,0.55), 0 28px 64px rgba(0,0,0,0.7) !important; }
        .blip-card-wait:hover  { box-shadow: inset 0 1px 0 rgba(255,255,255,0.09), 0 0 100px 36px rgba(106,168,255,0.13), 0 8px 20px rgba(0,0,0,0.55), 0 28px 64px rgba(0,0,0,0.7) !important; }
        .blip-card-exp:hover   { box-shadow: inset 0 1px 0 rgba(255,255,255,0.09), 0 0 100px 36px rgba(176,124,255,0.13), 0 8px 20px rgba(0,0,0,0.55), 0 28px 64px rgba(0,0,0,0.7) !important; }
        .blip-enter-card { transition: transform 0.32s cubic-bezier(0.25,0.46,0.45,0.94), box-shadow 0.32s cubic-bezier(0.25,0.46,0.45,0.94); }
        .blip-enter-card:hover { transform: translateY(-3px); }
        .blip-btn-primary:hover { background: #e8e8e8 !important; transform: translateY(-1px); }
        .blip-btn-secondary:hover { border-color: rgba(255,255,255,0.45) !important; background: rgba(255,255,255,0.04) !important; transform: translateY(-1px); }
        .blip-cta-btn:hover { background: #ff7e4a !important; transform: translateY(-1px); }
        .blip-bento-stat:hover { background: rgba(255,255,255,0.03) !important; }
      `}</style>

      {/* ── NAV ── */}
      <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 32px', background: 'rgba(9,9,9,0.85)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,0.08)', zIndex: 100 }}>
        <a href="#" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600, color: '#fff', textDecoration: 'none', letterSpacing: '-0.3px' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
          Blip money
        </a>
        <ul style={{ display: 'flex', alignItems: 'center', gap: 28, listStyle: 'none', margin: 0, padding: 0 }}>
          {['How it works', 'Merchant', 'Research', 'Blog'].map(l => (
            <li key={l}><a href="#" style={{ fontSize: 13.5, fontWeight: 500, color: '#888', textDecoration: 'none' }}>{l}</a></li>
          ))}
        </ul>
        <button onClick={openAuth} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', background: '#fff', color: '#090909', fontSize: 13.5, fontWeight: 600, borderRadius: 999, border: 'none', cursor: 'pointer', letterSpacing: '-0.2px' }} className="blip-btn-primary">
          Get Started →
        </button>
      </nav>

      {/* ── HERO ── */}
      <main style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', paddingTop: 156, paddingBottom: 0, paddingLeft: 24, paddingRight: 24, position: 'relative' }}>
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -60%)', width: 700, height: 400, background: 'radial-gradient(ellipse at center, rgba(224,112,64,0.07) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '2.5px', textTransform: 'uppercase', color: '#555', marginBottom: 28 }}>The Settlement Protocol</p>
        <h1 style={{ fontSize: 'clamp(3.5rem, 7vw, 7rem)', fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.04em', color: '#fff', maxWidth: 1000, marginBottom: 32 }}>
          Borderless finance.<br />
          <span className="blip-gradient-text">Settled on-chain.</span>
        </h1>
        <p style={{ fontSize: 18, fontWeight: 500, color: '#fff', letterSpacing: '-0.4px', marginBottom: 14 }}>Send value to anyone, anywhere.</p>
        <p style={{ fontSize: 13.5, color: '#888', maxWidth: 340, lineHeight: 1.6, marginBottom: 36 }}>Powered by open, permissionless infrastructure and non-custodial liquidity.</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 64 }}>
          <button onClick={openAuth} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '11px 24px', background: '#fff', color: '#090909', fontSize: 14, fontWeight: 600, borderRadius: 999, border: 'none', cursor: 'pointer', letterSpacing: '-0.2px', transition: 'background 0.2s, transform 0.15s' }} className="blip-btn-primary">
            Launch App →
          </button>
          <a href="/merchant" style={{ display: 'flex', alignItems: 'center', padding: '11px 24px', background: 'transparent', color: '#fff', fontSize: 14, fontWeight: 500, borderRadius: 999, border: '1px solid rgba(255,255,255,0.2)', textDecoration: 'none', letterSpacing: '-0.2px', transition: 'border-color 0.2s, background 0.2s, transform 0.15s' }} className="blip-btn-secondary">
            Become a Merchant
          </a>
        </div>

        {/* App mockup */}
        <div style={{ position: 'relative', width: '100%', maxWidth: 1160 }}>
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '52%', background: 'linear-gradient(to bottom, transparent 0%, #090909 100%)', pointerEvents: 'none', zIndex: 2 }} />
          <div style={{ borderRadius: '16px 16px 0 0', border: '1px solid rgba(255,255,255,0.09)', borderBottom: 'none', background: '#0c0c0c', overflow: 'hidden', boxShadow: '0 -4px 80px rgba(0,0,0,0.6), 0 40px 100px rgba(0,0,0,0.9)' }}>
            <div style={{ height: 40, background: '#141414', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', padding: '0 14px', gap: 10 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {[0,1,2].map(i => <span key={i} style={{ width: 11, height: 11, borderRadius: '50%', background: 'rgba(255,255,255,0.12)', display: 'block' }} />)}
              </div>
              <div style={{ flex: 1, maxWidth: 260, margin: '0 auto', background: 'rgba(255,255,255,0.04)', borderRadius: 6, padding: '4px 12px', fontSize: 11, color: 'rgba(255,255,255,0.22)', textAlign: 'center' }}>app.blipmoney.io/dashboard</div>
            </div>
            <div style={{ display: 'flex', height: 560 }}>
              <div style={{ width: 52, background: '#0e0e0e', borderRight: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '14px 0', gap: 6 }}>
                {[true, false, false, false].map((active, i) => (
                  <div key={i} style={{ width: 36, height: 36, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', background: active ? 'rgba(255,255,255,0.07)' : 'transparent' }}>
                    <div style={{ width: 16, height: 16, background: 'rgba(255,255,255,0.15)', borderRadius: 3 }} />
                  </div>
                ))}
              </div>
              <div style={{ flex: 1, padding: '22px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.88)', letterSpacing: '-0.02em' }}>Dashboard</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', marginTop: 2 }}>Last 7 days · Updated just now</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ padding: '4px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 999, fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)' }}>7D</div>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg, #ff6b35, #ff8c50)' }} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
                  {[['Total settled','$48,340','↑ 12.4% this week'],['Average fee','0.09%','↓ 6.91% vs traditional'],['Settlement speed','<2s','All transactions'],['Transactions','1,284','↑ 8.2% this week']].map(([label, val, delta]) => (
                    <div key={label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.055)', borderRadius: 12, padding: '14px 16px' }}>
                      <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.2)', marginBottom: 7 }}>{label}</div>
                      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.04em', color: '#fff', lineHeight: 1, marginBottom: 6 }}>{val}</div>
                      <div style={{ fontSize: 10.5, color: '#3ddc84' }}>{delta}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
                  <div style={{ flex: 1, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.055)', borderRadius: 12, padding: '16px 18px', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.5, color: 'rgba(255,255,255,0.3)', marginBottom: 14, textTransform: 'uppercase' }}>Settlement volume</div>
                    <svg viewBox="0 0 580 160" style={{ width: '100%', flex: 1 }} preserveAspectRatio="xMidYMax meet">
                      {[20,55,90,125].map(y => <line key={y} x1="0" y1={y} x2="580" y2={y} stroke="rgba(255,255,255,0.04)" strokeWidth="1"/>)}
                      {[[14,95,45],[96,72,68],[178,83,57],[260,48,92],[342,62,78],[424,38,102]].map(([x,y,h]) => (
                        <rect key={x} x={x} y={y} width="60" height={h} rx="5" fill="rgba(255,255,255,0.06)"/>
                      ))}
                      <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="rgba(255,140,80,0.9)"/><stop offset="100%" stopColor="rgba(255,107,53,0.4)"/></linearGradient></defs>
                      <rect x="506" y="14" width="60" height="126" rx="5" fill="url(#bg)"/>
                      {[['Mon',44],['Tue',126],['Wed',208],['Thu',290],['Fri',372],['Sat',454]].map(([d,x]) => (
                        <text key={d} x={x} y="150" textAnchor="middle" fill="rgba(255,255,255,0.18)" fontSize="11" fontFamily="Inter,sans-serif">{d}</text>
                      ))}
                      <text x="536" y="150" textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="11" fontFamily="Inter,sans-serif" fontWeight="600">Today</text>
                    </svg>
                  </div>
                  <div style={{ width: 290, flexShrink: 0, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.055)', borderRadius: 12, padding: '16px 18px' }}>
                    <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.5, color: 'rgba(255,255,255,0.3)', marginBottom: 14, textTransform: 'uppercase' }}>Recent settlements</div>
                    {[['U','usdc','@merchant_co','Just now','+$840.00'],['T','usdt','@global_store','2 min ago','+$2,100.00'],['U','usdc','@asia_market','8 min ago','+$340.00'],['T','usdt','@eu_retailer','15 min ago','+$1,200.00'],['U','usdc','@local_shop','22 min ago','+$75.00']].map(([icon,,name,time,amt]) => (
                      <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <div style={{ width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, background: icon === 'U' ? 'rgba(39,130,255,0.12)' : 'rgba(38,161,123,0.12)', color: icon === 'U' ? '#4b94f5' : '#26a17b' }}>{icon}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>{name}</div>
                          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.18)', marginTop: 1 }}>{time}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.82)' }}>{amt}</div>
                          <div style={{ fontSize: 9, fontWeight: 600, color: '#3ddc84', marginTop: 2 }}>Settled</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* ── BROKEN SECTION ── */}
      <section style={{ background: '#080808', padding: '100px 48px 90px', position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 80% 40% at 50% 0%, rgba(255,255,255,0.015) 0%, transparent 100%)', pointerEvents: 'none' }} />
        <div style={{ maxWidth: 1120, margin: '0 auto', position: 'relative', zIndex: 1 }}>
          <p style={{ textAlign: 'center', fontSize: 10, fontWeight: 600, letterSpacing: 3, textTransform: 'uppercase', color: '#3a3a3a', marginBottom: 28 }}>Why now</p>
          <h2 style={{ textAlign: 'center', fontSize: 'clamp(2.8rem, 5.5vw, 5rem)', fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1.08, marginBottom: 20 }}>
            <span style={{ color: '#fff', display: 'block' }}>Global payments</span>
            <span style={{ color: '#333', display: 'block' }}>are broken.</span>
          </h2>
          <p style={{ textAlign: 'center', fontSize: 14, color: '#555', lineHeight: 1.7, maxWidth: 420, margin: '0 auto 64px' }}>
            The traditional financial system was built for a different era. Stablecoin adoption is rising. Merchants are stuck. The timing is now.
          </p>

          {/* Problem cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 14 }}>
            {/* Card 1: Cost */}
            <div className="blip-prob-card blip-card-cost" style={{ position: 'relative', background: '#0f0f0f', borderRadius: 24, overflow: 'hidden', height: 360, border: '1px solid rgba(255,255,255,0.085)', backdropFilter: 'blur(20px)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 0 80px 28px rgba(255,122,69,0.08), 0 2px 4px rgba(0,0,0,0.55), 0 16px 48px rgba(0,0,0,0.65)' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.11) 50%, transparent 100%)' }} />
              {[{s:170,t:-35,r:-18,rot:-12,c:'$'},{s:90,b:24,l:-14,rot:9,c:'€'},{s:65,t:55,r:62,rot:5,c:'£'},{s:52,b:72,r:28,rot:-5,c:'¥'}].map(({s,t,b,r,l,rot,c},i) => (
                <span key={i} style={{ position: 'absolute', fontSize: s, fontWeight: 700, color: '#fff', opacity: 0.035, pointerEvents: 'none', lineHeight: 1, zIndex: 1, top: t, bottom: b, right: r, left: l, transform: `rotate(${rot}deg)` }}>{c}</span>
              ))}
              <div style={{ position: 'relative', zIndex: 2, padding: '32px 32px 36px', display: 'flex', flexDirection: 'column', height: '100%' }}>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '2.5px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.22)', marginBottom: 22 }}>The Cost</span>
                <div style={{ fontSize: 'clamp(3.8rem, 5.5vw, 5.2rem)', fontWeight: 700, letterSpacing: '-0.05em', lineHeight: 0.95, marginBottom: 12, background: 'linear-gradient(135deg, #fff 25%, #ffb07a 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>7%</div>
                <div style={{ fontSize: 'clamp(1rem, 1.6vw, 1.2rem)', fontWeight: 500, color: 'rgba(255,255,255,0.38)', letterSpacing: '-0.02em' }}>Lost before it arrives.</div>
                <div style={{ marginTop: 'auto', paddingTop: 20, fontSize: 11.5, color: 'rgba(255,255,255,0.16)' }}>Every cross-border transfer.</div>
              </div>
            </div>

            {/* Card 2: Wait */}
            <div className="blip-prob-card blip-card-wait" style={{ position: 'relative', background: '#0f0f0f', borderRadius: 24, overflow: 'hidden', height: 360, border: '1px solid rgba(255,255,255,0.085)', backdropFilter: 'blur(20px)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 0 80px 28px rgba(106,168,255,0.08), 0 2px 4px rgba(0,0,0,0.55), 0 16px 48px rgba(0,0,0,0.65)' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.11) 50%, transparent 100%)' }} />
              <div style={{ position: 'relative', zIndex: 2, padding: '32px 32px 36px', display: 'flex', flexDirection: 'column', height: '100%' }}>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '2.5px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.22)', marginBottom: 22 }}>The Wait</span>
                <div style={{ fontSize: 'clamp(3.8rem, 5.5vw, 5.2rem)', fontWeight: 700, letterSpacing: '-0.05em', lineHeight: 0.95, marginBottom: 12, background: 'linear-gradient(135deg, #fff 25%, #6aa8ff 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>3–5 Days</div>
                <div style={{ fontSize: 'clamp(1rem, 1.6vw, 1.2rem)', fontWeight: 500, color: 'rgba(255,255,255,0.38)', letterSpacing: '-0.02em' }}>To settle.</div>
                <div style={{ marginTop: 'auto', paddingTop: 20, fontSize: 11.5, color: 'rgba(255,255,255,0.16)' }}>Global payments shouldn't crawl.</div>
              </div>
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: 'rgba(255,255,255,0.04)', zIndex: 3 }}>
                <div className="blip-progress-bar" style={{ height: '100%', background: 'rgba(255,255,255,0.22)', borderRadius: '0 2px 2px 0', width: 0 }} />
              </div>
            </div>

            {/* Card 3: Exposure */}
            <div className="blip-prob-card blip-card-exp" style={{ position: 'relative', borderRadius: 24, overflow: 'hidden', height: 360, border: '1px solid rgba(255,255,255,0.085)', backdropFilter: 'blur(20px)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 0 80px 28px rgba(176,124,255,0.08), 0 2px 4px rgba(0,0,0,0.55), 0 16px 48px rgba(0,0,0,0.65)', backgroundColor: '#0f0f0f', backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.07) 1px, transparent 1px)', backgroundSize: '22px 22px' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.11) 50%, transparent 100%)' }} />
              <div style={{ position: 'relative', zIndex: 2, padding: '32px 32px 36px', display: 'flex', flexDirection: 'column', height: '100%' }}>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '2.5px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.22)', marginBottom: 22 }}>The Exposure</span>
                <span style={{ fontSize: 'clamp(1.1rem, 1.8vw, 1.35rem)', fontWeight: 500, color: 'rgba(255,255,255,0.42)', letterSpacing: '-0.02em', lineHeight: 1.3, marginBottom: 4 }}>Every transaction</span>
                <div style={{ fontSize: 'clamp(3.8rem, 5.5vw, 5.2rem)', fontWeight: 700, letterSpacing: '-0.05em', lineHeight: 0.95, marginBottom: 12, background: 'linear-gradient(135deg, #fff 25%, #b07cff 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Tracked.</div>
                <div style={{ marginTop: 'auto', paddingTop: 20, fontSize: 11.5, color: 'rgba(255,255,255,0.16)' }}>Stored. Shared. Permanent.</div>
              </div>
            </div>
          </div>

          {/* Enter Blip card */}
          <div className="blip-enter-card" style={{ background: '#0f0f0f', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: '40px 48px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 48, overflow: 'hidden', position: 'relative', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 0 60px 22px rgba(255,107,53,0.07), 0 2px 4px rgba(0,0,0,0.5), 0 20px 60px rgba(0,0,0,0.65)' }}>
            <div style={{ position: 'absolute', top: -60, left: -60, width: 280, height: 280, background: 'radial-gradient(circle, rgba(255,107,53,0.08) 0%, transparent 70%)', pointerEvents: 'none' }} />
            <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '4px 10px', background: 'rgba(255,107,53,0.12)', border: '1px solid rgba(255,107,53,0.2)', borderRadius: 999, fontSize: 9, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: '#ff6b35', marginBottom: 16 }}>
                <div className="blip-badge-dot" style={{ width: 5, height: 5, borderRadius: '50%', background: '#ff6b35' }} />
                The Fix
              </div>
              <div style={{ fontSize: 'clamp(2.6rem, 4.2vw, 4rem)', fontWeight: 700, letterSpacing: '-0.05em', lineHeight: 0.95, marginBottom: 14, background: 'linear-gradient(140deg, #fff 25%, #ff8c50 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Enter Blip.</div>
              <div style={{ fontSize: 14, lineHeight: 1.65, color: 'rgba(255,255,255,0.32)', marginBottom: 28, letterSpacing: '-0.01em', maxWidth: 340 }}>Instant settlement. Minimal fees.<br />Complete privacy.</div>
              <button onClick={openAuth} className="blip-cta-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 22px', background: 'rgba(255,107,53,0.9)', borderRadius: 999, fontSize: 13, fontWeight: 600, color: '#fff', border: 'none', cursor: 'pointer', letterSpacing: '-0.01em', transition: 'background 0.22s, transform 0.22s' }}>
                Get Started →
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', width: 380, flexShrink: 0, borderRadius: 18, border: '1px solid rgba(255,255,255,0.075)', overflow: 'hidden' }}>
              {[['<2s','Settlement','1'],['0.1%','Fee','0'],['Non-custodial','You keep control','0'],['On-chain','Full transparency','0']].map(([val, lbl, accent], i) => (
                <div key={lbl} className="blip-bento-stat" style={{ padding: '26px 28px 22px', background: accent === '1' ? 'rgba(255,107,53,0.05)' : 'rgba(255,255,255,0.012)', borderRight: i % 2 === 0 ? '1px solid rgba(255,255,255,0.075)' : undefined, borderBottom: i < 2 ? '1px solid rgba(255,255,255,0.075)' : undefined, transition: 'background 0.22s' }}>
                  <div style={{ fontSize: 'clamp(1.25rem, 2vw, 1.75rem)', fontWeight: 700, letterSpacing: '-0.04em', marginBottom: 5, lineHeight: 1, ...(accent === '1' ? { background: 'linear-gradient(135deg, #fff 20%, #ff8c50 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' } : { color: '#fff' }) }}>{val}</div>
                  <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.22)' }}>{lbl}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── STATUS BAR ── */}
      <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 20, zIndex: 50 }}>
        {[['#3ddc84','Base','blip-dot'],['#4b94f5','Solana','blip-dot-delay']].map(([color, label, cls]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 500, color: '#555' }}>
            <div className={cls} style={{ width: 7, height: 7, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}` }} />
            <span>{label}</span>
          </div>
        ))}
      </div>

      {/* ── AUTH MODAL ── */}
      {showAuth && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={closeAuth} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)' }} />
          <div style={{ position: 'relative', width: '100%', maxWidth: 400, background: '#111', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 24, padding: 32, boxShadow: '0 24px 80px rgba(0,0,0,0.8)' }}>
            <button onClick={closeAuth} style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#888' }}>
              <X size={16} />
            </button>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6, letterSpacing: '-0.03em' }}>
              {authMode === 'login' ? 'Welcome back' : 'Create account'}
            </h2>
            <p style={{ fontSize: 13, color: '#555', marginBottom: 24 }}>
              {authMode === 'login' ? 'Sign in to your Blip account' : 'Join Blip Money today'}
            </p>

            {/* Toggle */}
            <div style={{ display: 'flex', background: '#1a1a1a', borderRadius: 12, padding: 4, marginBottom: 20 }}>
              {(['login','register'] as const).map(m => (
                <button key={m} onClick={() => { setAuthMode(m); setLoginError(''); }} style={{ flex: 1, padding: '8px 0', borderRadius: 9, fontSize: 13.5, fontWeight: 500, border: 'none', cursor: 'pointer', background: authMode === m ? 'rgba(255,255,255,0.08)' : 'transparent', color: authMode === m ? '#fff' : '#555', transition: 'all 0.2s' }}>
                  {m === 'login' ? 'Sign In' : 'Create Account'}
                </button>
              ))}
            </div>

            {loginError && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12, padding: '10px 14px', fontSize: 13, color: '#f87171', marginBottom: 16 }}>
                {loginError}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: '#555', marginBottom: 6, display: 'block' }}>Username</label>
                <input
                  type="text"
                  value={loginForm.username}
                  onChange={e => setLoginForm({ ...loginForm, username: e.target.value })}
                  placeholder={authMode === 'register' ? 'Choose a username' : 'Enter your username'}
                  autoCapitalize="none"
                  autoCorrect="off"
                  style={{ width: '100%', background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '12px 16px', color: '#fff', fontSize: 15, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#555', marginBottom: 6, display: 'block' }}>Password</label>
                <input
                  type="password"
                  value={loginForm.password}
                  onChange={e => setLoginForm({ ...loginForm, password: e.target.value })}
                  placeholder={authMode === 'register' ? 'Create a password (min 6 chars)' : 'Enter your password'}
                  onKeyDown={e => { if (e.key === 'Enter') { authMode === 'login' ? handleUserLogin() : handleUserRegister(); } }}
                  style={{ width: '100%', background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '12px 16px', color: '#fff', fontSize: 15, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <button
                onClick={authMode === 'login' ? handleUserLogin : handleUserRegister}
                disabled={isLoggingIn}
                style={{ width: '100%', padding: '13px 0', background: '#fff', color: '#090909', fontSize: 15, fontWeight: 600, borderRadius: 12, border: 'none', cursor: isLoggingIn ? 'not-allowed' : 'pointer', opacity: isLoggingIn ? 0.6 : 1, marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'opacity 0.2s' }}
              >
                {isLoggingIn ? <Loader2 size={18} className="animate-spin" /> : authMode === 'login' ? 'Sign In' : 'Create Account'}
              </button>
              <p style={{ fontSize: 12, color: '#444', textAlign: 'center' }}>
                You can connect your wallet after signing in to enable on-chain trading
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
