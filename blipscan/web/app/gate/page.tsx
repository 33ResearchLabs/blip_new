'use client';

import { useState, useRef, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { BarChart3, ArrowRight, Loader2 } from 'lucide-react';

export default function GatePage() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const next = searchParams.get('next') || '/';

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim(), next }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Invalid invite code.');
        setLoading(false);
        return;
      }

      router.push(data.redirect || '/');
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#060606] flex flex-col items-center justify-center px-4">
      {/* Subtle radial glow */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 50% 0%, hsl(258 90% 60% / 0.12), transparent 70%),' +
            'radial-gradient(ellipse 40% 40% at 80% 100%, hsl(199 95% 55% / 0.07), transparent 70%)',
        }}
      />

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <div className="w-12 h-12 rounded-2xl bg-white text-black flex items-center justify-center mb-4 shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_8px_24px_-4px_rgba(0,0,0,0.6)]">
            <BarChart3 size={20} strokeWidth={2.5} />
          </div>
          <h1 className="text-[22px] font-semibold tracking-tight text-white">BlipScan</h1>
          <p className="text-[13px] text-white/40 mt-1">Private preview</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] backdrop-blur p-6">
          <p className="text-[14px] text-white/70 mb-5 leading-relaxed">
            Enter your invite code to access the Blip escrow explorer.
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                value={code}
                onChange={(e) => { setCode(e.target.value); setError(''); }}
                placeholder="BLIP-XXXX-XXXX"
                spellCheck={false}
                autoComplete="off"
                className={`w-full px-4 py-3 rounded-xl bg-white/[0.04] border text-white text-[14px] font-mono tracking-widest placeholder:text-white/20 placeholder:tracking-normal focus:outline-none transition-all ${
                  error
                    ? 'border-red-500/60 focus:border-red-500/80'
                    : 'border-white/[0.08] focus:border-white/[0.22] focus:bg-white/[0.06]'
                }`}
              />
            </div>

            {error && (
              <p className="text-[12px] text-red-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !code.trim()}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-white text-black text-[14px] font-semibold hover:bg-white/90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed mt-1"
            >
              {loading ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <>
                  Enter <ArrowRight size={15} strokeWidth={2.5} />
                </>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-[12px] text-white/25 mt-6">
          Need access? Contact the Blip team.
        </p>
      </div>
    </div>
  );
}
