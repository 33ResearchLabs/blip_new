'use client';

// /waitlist — landing page. Pick User or Merchant and head to the matching
// signup form. Visual language ported from futureStick JoinWaitlist.tsx:
// #050505 background, #39ff14 neon accent, monospace tracking-wider labels.
//
// Referral codes: the same code refers either a user or a merchant. When
// the landing URL carries ?ref=CODE, we forward it through every segment
// link so the signup form picks it up. The backend's findReferrerByCode
// already searches users + merchants without caring about segment.

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, ShieldCheck, Wallet, Zap, Users, Store } from 'lucide-react';

function withRef(path: string, ref: string): string {
  return ref ? `${path}?ref=${encodeURIComponent(ref)}` : path;
}

function Landing() {
  const ref = useSearchParams().get('ref') ?? '';
  return (
    <div className="min-h-screen bg-[#050505] text-zinc-100 font-sans selection:bg-[#39ff14] selection:text-black">
      {/* Top nav */}
      <nav className="border-b border-zinc-800/50 bg-[#050505]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <Link href="/waitlist" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-zinc-900 border border-zinc-700 flex items-center justify-center relative overflow-hidden">
              <div className="w-1.5 h-1.5 bg-[#39ff14] rounded-full shadow-[0_0_8px_#39ff14]" />
            </div>
            <span className="text-xl font-bold tracking-tight">
              Blip<span className="text-zinc-500 text-lg font-normal">.money</span>
            </span>
          </Link>
          <div className="flex items-center gap-4 text-sm font-medium">
            <Link href="/waitlist/login" className="text-zinc-400 hover:text-white transition-colors">
              User log in →
            </Link>
            <span className="text-zinc-700">·</span>
            <Link href="/waitlist/merchant-login" className="text-zinc-400 hover:text-white transition-colors">
              Merchant log in →
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-20 pb-12 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#39ff14]/30 bg-[#39ff14]/5 text-[10px] font-bold uppercase tracking-widest text-[#39ff14] mb-8">
          <span className="w-1.5 h-1.5 bg-[#39ff14] rounded-full shadow-[0_0_8px_#39ff14] animate-pulse" />
          Waitlist Open
        </div>
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-6">
          Reserve your spot in the
          <br />
          <span className="text-[#39ff14] text-glow">Blip protocol</span>
        </h1>
        <p className="text-zinc-400 text-lg max-w-2xl mx-auto mb-12">
          Cross-border P2P trading. Real escrow, real settlement. Pick who you are below — points start earning today.
        </p>

        {/* Two choices */}
        <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
          <Link
            href={withRef('/waitlist/user', ref)}
            className="group relative border border-zinc-800 hover:border-[#39ff14]/50 bg-zinc-950 rounded-lg p-8 text-left transition-all hover:bg-zinc-900"
          >
            <div className="flex items-center gap-3 mb-4">
              <Users className="text-[#39ff14]" size={28} />
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">For traders</span>
            </div>
            <h2 className="text-2xl font-bold mb-2">Join as User</h2>
            <p className="text-zinc-400 text-sm mb-6">Buy and sell crypto across borders. Built for individuals and small traders.</p>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#39ff14] font-mono font-bold">+200 BLIP</span>
              <span className="flex items-center gap-1 text-zinc-300 group-hover:text-[#39ff14] transition-colors">
                Continue <ArrowRight size={14} />
              </span>
            </div>
          </Link>

          <Link
            href={withRef('/waitlist/merchant', ref)}
            className="group relative border border-zinc-800 hover:border-[#39ff14]/50 bg-zinc-950 rounded-lg p-8 text-left transition-all hover:bg-zinc-900"
          >
            <div className="flex items-center gap-3 mb-4">
              <Store className="text-[#39ff14]" size={28} />
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">For businesses</span>
            </div>
            <h2 className="text-2xl font-bold mb-2">Join as Merchant</h2>
            <p className="text-zinc-400 text-sm mb-6">Run a P2P desk. Liquidity, escrow, dispute tools, settlement APIs.</p>
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#39ff14] font-mono font-bold">+2,000 BLIP</span>
              <span className="flex items-center gap-1 text-zinc-300 group-hover:text-[#39ff14] transition-colors">
                Continue <ArrowRight size={14} />
              </span>
            </div>
          </Link>
        </div>
      </section>

      {/* Feature strip */}
      <section className="max-w-5xl mx-auto px-6 py-16 border-t border-zinc-900">
        <div className="grid md:grid-cols-3 gap-8 text-sm">
          <div>
            <ShieldCheck className="text-[#39ff14] mb-3" size={22} />
            <h3 className="font-bold mb-1">On-chain escrow</h3>
            <p className="text-zinc-500">Funds locked in Solana programs — never custodied.</p>
          </div>
          <div>
            <Zap className="text-[#39ff14] mb-3" size={22} />
            <h3 className="font-bold mb-1">Sub-second matching</h3>
            <p className="text-zinc-500">Order book and broadcast intents, deterministic settlement.</p>
          </div>
          <div>
            <Wallet className="text-[#39ff14] mb-3" size={22} />
            <h3 className="font-bold mb-1">Real fiat rails</h3>
            <p className="text-zinc-500">Pay/get-paid via local bank, UPI, mobile money.</p>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function WaitlistLandingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#050505]" />}>
      <Landing />
    </Suspense>
  );
}
