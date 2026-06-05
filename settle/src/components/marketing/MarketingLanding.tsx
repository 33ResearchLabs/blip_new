/**
 * MarketingLanding — full-bleed public landing for the user app.
 *
 * Ported from the previous static public/marketing.html iframe into a
 * proper Next.js component. The page markup is rendered directly in the
 * React tree; styles live in ./marketing.css and are isolated via the
 * CSS @scope at-rule scoped to `.marketing-scope`, so the page's own
 * html/body/header/font resets cannot leak into the rest of the app.
 *
 * Fonts:
 *  - Inter      → loaded by root layout (--font-geist-sans)
 *  - JetBrains  → loaded by root layout (--font-mono)
 *  - Instrument Serif → loaded here via next/font (--font-instrument-serif)
 *    so the additional weight only ships on routes that mount this page.
 *
 * No inline scripts to port — the live counters / pulse ribbon were
 * removed before the port.
 */

import Link from "next/link";
import { Instrument_Serif } from "next/font/google";
import "./marketing.css";

const instrumentSerif = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-instrument-serif",
  display: "swap",
});

export function MarketingLanding() {
  return (
    <div
      className={`marketing-scope ${instrumentSerif.variable}`}
      style={{ position: "fixed", inset: 0, overflow: "hidden auto" }}
    >
      
      <div className="ticker">
        <div className="ticker-inner">
          <div className="ticker-l">USDT / INR · LIVE</div>
          <div className="ticker-feed">
            <div className="feed-track">
              <span className="feed-item"><span className="corr">USDT / INR</span><span>BUY</span><span className="am">₹100.30</span><span>SELL</span><span className="am">₹103.70</span><span className="tm">spread 3.40</span></span>
              <span className="feed-item"><span className="corr">USDC / INR</span><span>BUY</span><span className="am">₹100.20</span><span>SELL</span><span className="am">₹103.60</span><span className="tm">spread 3.40</span></span>
              <span className="feed-item"><span className="corr">USDT / INR</span><span>BUY</span><span className="am">₹100.30</span><span>SELL</span><span className="am">₹103.70</span><span className="tm">spread 3.40</span></span>
              <span className="feed-item"><span className="corr">USDC / INR</span><span>BUY</span><span className="am">₹100.20</span><span>SELL</span><span className="am">₹103.60</span><span className="tm">spread 3.40</span></span>
              <span className="feed-item"><span className="corr">USDT / INR</span><span>BUY</span><span className="am">₹100.30</span><span>SELL</span><span className="am">₹103.70</span><span className="tm">spread 3.40</span></span>
              <span className="feed-item"><span className="corr">USDC / INR</span><span>BUY</span><span className="am">₹100.20</span><span>SELL</span><span className="am">₹103.60</span><span className="tm">spread 3.40</span></span>
              <span className="feed-item"><span className="corr">USDT / INR</span><span>BUY</span><span className="am">₹100.30</span><span>SELL</span><span className="am">₹103.70</span><span className="tm">spread 3.40</span></span>
              <span className="feed-item"><span className="corr">USDC / INR</span><span>BUY</span><span className="am">₹100.20</span><span>SELL</span><span className="am">₹103.60</span><span className="tm">spread 3.40</span></span>
            </div>
          </div>
        </div>
      </div>
      
      
      <header>
       <div className="hdr-in">
        <div className="brand">
          <span className="bolt"><svg viewBox="0 0 70 60" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 36 L16 36 L25 8 L38 52 L47 28 L66 28" stroke="#ffffff" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
          <span><span className="b">Blip</span><span className="i">money</span></span>
        </div>
        <div className="nav-r">
          <a className="btn-pill ghost" href="/login" target="_top">Sign in</a>
        </div>
       </div>
      </header>
      
      
      <section className="hero">
        <div className="hero-l">
          <span className="ey">Open Liquidity Network</span>
          <h1 className="hero-h">
            Money,<br/>
            <span className="strike"><span>with banks.</span></span><br/>
            <span className="it">with no middle.</span>
          </h1>
          <p className="lead">Send across borders in <b style={{ color: "var(--ink)" }}>under 60 seconds</b>. Real merchants compete on rate. Escrow on-chain. No FX hidden in the spread.</p>
          <div className="hero-cta">
            <Link href="/user/login" className="btn btn-ink">Send money →</Link>
            <a href="/market/login" target="_top" className="btn btn-outline">Run a desk · Blip Market</a>
          </div>
          
          <div className="channels" aria-label="Coming soon channels">
            <span className="lab">Also coming</span>
            <span className="ch-pill" role="status">
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.7L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/></svg>
              Telegram Bot
              <span className="soon">Coming Soon</span>
            </span>
            <span className="ch-pill" role="status">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
              Web API
              <span className="soon">Coming Soon</span>
            </span>
          </div>
          <div className="pf">
            <div className="pf-stack">
              <div className="av a1">M</div>
              <div className="av a2">A</div>
              <div className="av a3">P</div>
              <div className="av a4">+</div>
            </div>
            <span><b>122 users</b> and <b>38 desks</b> already on the network</span>
          </div>
        </div>
      
        <div className="hero-r">
          
          <div className="meter">
            <div className="lab">Early access · pre-launch</div>
            <div className="big"><span className="it">122</span> + waiting</div>
            <div className="small">Users · desks · operators on the list</div>
            <div className="row">
              <div className="x"><div className="l">Desks committed</div><div className="v">38</div></div>
              <div className="x"><div className="l">Corridors</div><div className="v it">12</div></div>
              <div className="x"><div className="l">Launch</div><div className="v">Soon</div></div>
            </div>
          </div>
      
          
          <div className="corr-stack">
            <div className="corr-card">
              <div className="flag f1">IN</div>
              <div className="meta">
                <div className="t">India <span className="ar">→</span> <span className="it">UAE</span></div>
                <div className="s">USDC · launching soon</div>
              </div>
              <div className="am">₹83.46<div className="t-dn">preview</div></div>
            </div>
            <div className="corr-card">
              <div className="flag f2">NG</div>
              <div className="meta">
                <div className="t">Nigeria <span className="ar">→</span> <span className="it">UK</span></div>
                <div className="s">USDT · launching soon</div>
              </div>
              <div className="am">₦1,648<div className="t-dn">preview</div></div>
            </div>
            <div className="corr-card">
              <div className="flag f3">PH</div>
              <div className="meta">
                <div className="t">Philippines <span className="ar">→</span> <span className="it">Saudi</span></div>
                <div className="s">USDC · launching soon</div>
              </div>
              <div className="am">₱58.20<div className="t-dn">preview</div></div>
            </div>
          </div>
      
          
          <div className="notif">
            <div className="av">M</div>
            <div className="body">
              <div className="t">+ ₹2,400.00 <span className="it">from Meera</span></div>
              <div className="s">India → Dubai · <span className="live">preview</span></div>
            </div>
          </div>
        </div>
      </section>
      
      
      <section className="stat-band">
        <div className="stat-inner">
          <div className="st"><div className="v"><span className="it">122</span> +</div><div className="l">On the waitlist</div></div>
          <div className="st"><div className="v">38</div><div className="l">Desks committed</div></div>
          <div className="st"><div className="v"><span className="it">12</span></div><div className="l">Corridors planned</div></div>
          <div className="st"><div className="v">Soon</div><div className="l">Mainnet launch</div></div>
        </div>
      </section>
      
      
      <div className="dash-wrap">
        <div className="dash-lab">
          <div className="dot">The Market · Live</div>
          <h3>One screen where the <span className="it">whole market</span> moves.</h3>
          <p>Requests, merchant offers, escrowed liquidity and settlement status — every quote, every fill, every release in one frame.</p>
        </div>
      
      
      
        <div className="lmd">
          
          <div className="lmd-top">
            <div className="brand">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
              Blip <span className="mk">Market</span>
            </div>
            <div className="tabs">
              <span className="tb on"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>Dashboard</span>
              <span className="tb"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>Analytics</span>
              <span className="tb"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>Stats</span>
              <span className="tb"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>Liquidity</span>
              <span className="tb"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>Compliance<span className="dot"></span></span>
            </div>
            <div className="search">
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input readOnly placeholder="Search orders, merchants, txns…" />
              <span className="k">⌘K</span>
            </div>
            <div className="right">
              <div className="pill-d"><span className="l">Earned 24h</span><span className="v">$1,247</span><span className="ch">↑ 12.4%</span></div>
              <div className="ic-btn"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg><span className="badge">3</span></div>
              <div className="ic-btn"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg></div>
              <div className="ic-btn"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></div>
              <div className="rep"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>500</div>
              <div className="rep gold"><svg fill="currentColor" viewBox="0 0 24 24"><polygon points="12 2 15 9 22 9 17 14 19 21 12 17 5 21 7 14 2 9 9 9"/></svg>500</div>
              <div className="profile">
                <div className="info"><div className="nm">Alex Wei</div><div className="tier">Tier 2 · Verified</div></div>
                <div className="av">🐝<span className="live"></span></div>
              </div>
            </div>
          </div>
      
          
          <div className="lmd-grid">
      
            
            <div className="lmd-c1">
              <div className="top">
                <div className="lhs">
                  <span className="stat shield"><span className="ic"><svg width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>547</span>
                  <span className="stat points"><span className="ic"></span>500</span>
                </div>
                <div className="live"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.93 19.07A10 10 0 0 1 4.93 4.93"/><path d="M7.76 16.24a6 6 0 0 1 0-8.48"/><path d="M16.24 7.76a6 6 0 0 1 0 8.48"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><circle cx="12" cy="12" r="2"/></svg></div>
              </div>
              <div className="bal">
                <div className="glow"></div>
                <div className="lbl">Available Balance</div>
                <div className="amt">$45,000<span className="cents">.00</span></div>
                <div className="sym">USDT</div>
                <div className="made-card">
                  <div className="ml">Made today</div>
                  <div className="mv">+ $1,247<span className="mc">.50</span></div>
                  <div className="ms">↑ 12.4% vs yesterday · 38 fills</div>
                </div>
              </div>
              <div className="qa">
                <button><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg><span className="l">SWAP</span></button>
                <button><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5"/><polyline points="5 12 12 5 19 12"/></svg><span className="l">SEND</span></button>
                <button><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><polyline points="19 12 12 19 5 12"/></svg><span className="l">DEPOSIT</span></button>
              </div>
              <div className="corr">
                <button><span className="pair">USDT/AED</span><span className="rate">3.67</span></button>
                <button className="on"><span className="pair">USDT/INR</span><span className="rate">₹103.70</span></button>
              </div>
              <div className="menu-r">
                <span>Cash & Market</span>
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
              <div className="menu-r">
                <span className="ic-lhs"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>Corridor</span>
                <span>4 online</span>
              </div>
      
              <div className="form">
                <div className="row">
                  <div className="lhs"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>Amount <span className="badge">USDT / INR</span></div>
                  <span className="rhs">MAX 1,500</span>
                </div>
                <input readOnly value="" placeholder="0" />
                <div className="row" style={{ marginBottom: "4px" }}><div className="lhs">Spread</div></div>
                <div className="triple">
                  <button><span className="lb">Fast</span><span className="pc">+2.5%</span></button>
                  <button className="on"><span className="lb">Best</span><span className="pc">+2%</span></button>
                  <button><span className="lb">Cheap</span><span className="pc">+1.5%</span></button>
                </div>
                <div className="row" style={{ marginBottom: "4px" }}><div className="lhs">Boost</div><span className="rhs">manual</span></div>
                <div className="quad">
                  <button className="on">0%</button><button>5%</button><button>10%</button><button>15%</button>
                </div>
                <div className="buy-sell">
                  <button className="buy">BUY</button>
                  <button className="sell">SELL</button>
                </div>
              </div>
            </div>
      
            
            <div className="lmd-col">
              <div className="head">
                <div className="tabs">
                  <button>All</button>
                  <button className="on">Pending</button>
                  <button>Mine</button>
                </div>
                <div className="right">
                  <span className="live">Live</span>
                  <span className="cnt">4</span>
                </div>
              </div>
              <div className="search-row">
                <div className="s"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input readOnly placeholder="Search..." /></div>
                <button className="filter"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
              </div>
              <div className="list">
                <div className="lmd-ord featured">
                  <div className="top-row">
                    <div className="lhs"><span className="av">🐯</span><div className="who"><span className="nm">parth.sol</span><span className="id">#A82F1</span></div></div>
                    <span className="side-pill">BUY</span>
                  </div>
                  <div className="body-row">
                    <div className="info"><div className="am">200 <span className="u">USDT</span></div><div className="pr">@ ₹103.70</div></div>
                    <button className="acc-btn white">Accept <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>
                  </div>
                </div>
                <div className="lmd-ord">
                  <div className="top-row">
                    <div className="lhs"><span className="av">🦊</span><div className="who"><span className="nm">maya.eth</span><span className="id">#A82E8</span></div></div>
                    <span className="side-pill">SELL</span>
                  </div>
                  <div className="body-row">
                    <div className="info"><div className="am">100 <span className="u">USDT</span></div><div className="pr">@ ₹100.30</div></div>
                    <button className="acc-btn">Accept <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>
                  </div>
                </div>
                <div className="lmd-ord">
                  <div className="top-row">
                    <div className="lhs"><span className="av">🐰</span><div className="who"><span className="nm">arjun.x</span><span className="id">#A82D1</span></div></div>
                    <span className="side-pill">BUY</span>
                  </div>
                  <div className="body-row">
                    <div className="info"><div className="am">350 <span className="u">USDT</span></div><div className="pr">@ ₹103.85</div></div>
                    <button className="acc-btn">Accept <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>
                  </div>
                </div>
                <div className="lmd-ord">
                  <div className="top-row">
                    <div className="lhs"><span className="av">🦁</span><div className="who"><span className="nm">sana.dxb</span><span className="id">#A82B4</span></div></div>
                    <span className="side-pill">BUY</span>
                  </div>
                  <div className="body-row">
                    <div className="info"><div className="am">820 <span className="u">USDT</span></div><div className="pr">@ AED 3.67</div></div>
                    <button className="acc-btn">Accept <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>
                  </div>
                </div>
              </div>
            </div>
      
            
            <div className="lmd-col">
              <div className="head">
                <div className="tabs">
                  <button className="on">In Progress</button>
                  <button>Escrowed</button>
                  <button>Paid</button>
                </div>
                <div className="right">
                  <span className="cnt">3</span>
                </div>
              </div>
              <div className="list">
                <div className="lmd-ord">
                  <div className="top-row">
                    <div className="lhs"><span className="av">🐺</span><div className="who"><span className="nm">nasha_desk</span><span className="id">#A82A7</span></div></div>
                    <span className="side-pill" style={{ background: "rgba(204,120,92,0.15)", borderColor: "rgba(204,120,92,0.35)", color: "var(--accent-2)" }}>ESC</span>
                  </div>
                  <div className="body-row">
                    <div className="info"><div className="am">300 <span className="u">USDT</span></div><div className="pr">@ ₹103.70</div></div>
                    <span className="prog">60%</span>
                  </div>
                  <div className="pbar"><div className="fill" style={{ width: "60%" }}></div></div>
                </div>
                <div className="lmd-ord">
                  <div className="top-row">
                    <div className="lhs"><span className="av">🐬</span><div className="who"><span className="nm">paolo.fx</span><span className="id">#A82A1</span></div></div>
                    <span className="side-pill" style={{ background: "rgba(204,120,92,0.15)", borderColor: "rgba(204,120,92,0.35)", color: "var(--accent-2)" }}>ESC</span>
                  </div>
                  <div className="body-row">
                    <div className="info"><div className="am">196 <span className="u">USDT</span></div><div className="pr">@ ₹103.85</div></div>
                    <span className="prog">40%</span>
                  </div>
                  <div className="pbar"><div className="fill" style={{ width: "40%" }}></div></div>
                </div>
                <div className="lmd-ord">
                  <div className="top-row">
                    <div className="lhs"><span className="av">🦅</span><div className="who"><span className="nm">deep_finance</span><span className="id">#A82F9</span></div></div>
                    <span className="side-pill" style={{ background: "rgba(74,222,128,0.16)", borderColor: "rgba(74,222,128,0.35)", color: "#7eea9c" }}>PAID</span>
                  </div>
                  <div className="body-row">
                    <div className="info"><div className="am">390 <span className="u">USDT</span></div><div className="pr">@ ₹103.65</div></div>
                    <span className="prog">100%</span>
                  </div>
                  <div className="pbar"><div className="fill" style={{ width: "100%" }}></div></div>
                </div>
              </div>
            </div>
      
            
            <div className="lmd-rail">
              <div className="head">
                <div className="t">Activity</div>
                <div className="cnt">live</div>
              </div>
              <div className="lmd-mini">
                <div className="l"><span>Earned this week</span><span>$</span></div>
                <div className="v">$8,420</div>
                <div className="ch">↑ 18.2% vs last week</div>
              </div>
              <div className="list">
                <div className="lmd-nf"><div className="ic good">✓</div><div className="body"><div className="t">Settled <strong>200 USDT</strong> @ ₹103.70</div><div className="tm">2 min ago</div></div></div>
                <div className="lmd-nf"><div className="ic acc">↑</div><div className="body"><div className="t">New best quote · <strong>nasha_desk</strong></div><div className="tm">5 min ago</div></div></div>
                <div className="lmd-nf"><div className="ic">🔒</div><div className="body"><div className="t">Escrow locked · <strong>#A82F1</strong></div><div className="tm">8 min ago</div></div></div>
                <div className="lmd-nf"><div className="ic good">✓</div><div className="body"><div className="t">Settled <strong>196 USDT</strong> @ ₹103.85</div><div className="tm">12 min ago</div></div></div>
                <div className="lmd-nf"><div className="ic acc">↑</div><div className="body"><div className="t">Bid raised by <strong>paolo.fx</strong></div><div className="tm">18 min ago</div></div></div>
              </div>
            </div>
      
            
            <div className="lmd-rail">
              <div className="head">
                <div className="t">Notifications</div>
                <div className="cnt">3 new</div>
              </div>
              <div className="list">
                <div className="lmd-nf"><div className="ic acc">!</div><div className="body"><div className="t"><strong>parth.sol</strong> wants to BUY 200 USDT</div><div className="tm">just now</div></div></div>
                <div className="lmd-nf"><div className="ic good">✓</div><div className="body"><div className="t">KYB approved · You&apos;re <strong>Tier 2</strong></div><div className="tm">1 hr ago</div></div></div>
                <div className="lmd-nf"><div className="ic">★</div><div className="body"><div className="t">+50 reputation from settled trades</div><div className="tm">3 hr ago</div></div></div>
                <div className="lmd-nf"><div className="ic acc">→</div><div className="body"><div className="t">New corridor live · <strong>USDT/PHP</strong></div><div className="tm">yesterday</div></div></div>
              </div>
            </div>
      
          </div>
        </div>
      </div>
      
      
      <section className="s">
        <div className="s-h">
          <h2>One engine.<br/><span className="it">Four</span> doors.</h2>
          <p>The Blip Market settles every fill. Choose the surface that fits your day — phone in your pocket, browser at your desk, Telegram on the move, or your own stack.</p>
        </div>
        <div className="surfaces">
          <div className="surf">
            <div className="top"><span className="num">01 —</span><div className="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/></svg></div></div>
            <h4>Send & <span className="it">spend</span></h4>
            <p>Consumer app for sending, swapping, and paying merchants.</p>
            <div className="plts"><span className="pl">Web</span><span className="pl">iOS</span><span className="pl">Android</span></div>
          </div>
          <div className="surf">
            <div className="top"><span className="num">02 —</span><div className="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg></div></div>
            <h4>Desk <span className="it">dashboard</span></h4>
            <p>Operator console — order book, escrow, settlement, earnings.</p>
            <div className="plts"><span className="pl">Web</span></div>
          </div>
          <div className="surf">
            <div className="top"><span className="num">03 —<span className="soon-tag">Coming Soon</span></span><div className="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-11 11"/><path d="M22 2 15 22l-4-9-9-4 20-7Z"/></svg></div></div>
            <h4>Telegram <span className="it">bot</span></h4>
            <p>Take fills from chat. Built for desks running flow on the move.</p>
            <div className="plts"><span className="pl">@blipmoneybot</span></div>
          </div>
          <div className="surf">
            <div className="top"><span className="num">04 —<span className="soon-tag">Coming Soon</span></span><div className="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></div></div>
            <h4>Developer <span className="it">API</span></h4>
            <p>REST + websockets. Build your own client on the Blip engine.</p>
            <div className="plts"><span className="pl">REST</span><span className="pl">WS</span><span className="pl">Beta</span></div>
          </div>
        </div>
      </section>
      
      
      <section className="s" style={{ paddingTop: 0 }}>
        <div className="s-h">
          <h2>You&apos;re sending.<br/><span className="it">Someone</span> is earning.</h2>
          <p>Same network, two jobs. Same login on both sides — switch surfaces any time without signing in again.</p>
        </div>
        <div className="duo">
          <div className="panel light">
            <span className="ey-line">— For users</span>
            <h3>Send anywhere.<br/><span className="it">Settled</span> in 60s.</h3>
            <p className="l">Quote in your currency. Three-part fee shown upfront — merchant rate, service fee, optional boost. Confirm, done.</p>
            <div className="ks">
              <div className="kr"><span>Merchant rate</span><span className="v">₹83.42</span></div>
              <div className="kr"><span>Service fee</span><span className="v">₹6.00</span></div>
              <div className="kr"><span>Boost <span className="it" style={{ color: "var(--ink-3)" }}>(optional)</span></span><span className="v">—</span></div>
              <div className="kr total"><span>You pay</span><span className="v">₹2,406.00</span></div>
            </div>
            <Link href="/user/login" className="btn btn-ink" style={{ alignSelf: "flex-start" }}>Open the app →</Link>
          </div>
      
          <div className="panel dark">
            <span className="ey-line">— For desks</span>
            <h3>Set the <span className="it">rate.</span> Take the fill.</h3>
            <p className="l">Your rate competes live. Win by price first, reputation second. Lock escrow, confirm payment, paid on-chain in seconds.</p>
            <div className="ks">
              <div className="kr"><span>Top desk · 24h fee</span><span className="v acc">₹1,840</span></div>
              <div className="kr"><span>Median fill time</span><span className="v">38s</span></div>
              <div className="kr"><span>Founding fee</span><span className="v green">0.00%</span></div>
              <div className="kr total"><span>KYB</span><span className="v">24–48h</span></div>
            </div>
            <a href="/market/login" target="_top" className="btn btn-accent" style={{ alignSelf: "flex-start" }}>Apply to run a desk →</a>
          </div>
        </div>
      </section>
      
      
      <section className="closing">
        <div className="closing-inner">
          <h2>Money,<br/>at the <span className="it">speed</span><br/>of <span className="it">trust.</span></h2>
          <p>122 users and 38 desks already on the network. Open the app or apply to run a desk — both take less than a minute.</p>
          <div className="cta-row">
            <Link href="/user/login" className="btn btn-ink">Send money →</Link>
            <a href="/market/login" target="_top" className="btn btn-accent">Apply to run a desk</a>
          </div>
        </div>
      </section>
      
      
      <footer>
        <div className="ft-b">
          <span>© 2026 BLIP MONEY · V0.4 MAINNET</span>
          <span>ESCROW-PROTECTED · ON-CHAIN SETTLEMENT</span>
          <span>PRIVACY · TERMS</span>
        </div>
      </footer>
    </div>
  );
}

export default MarketingLanding;
