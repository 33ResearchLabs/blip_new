'use client';

import BlipLogo from '@/components/shared/BlipLogo';
import { useState, useRef, useEffect, FormEvent } from 'react';

export default function DevLockPage() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/dev-unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: code.trim() }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        window.location.href = data.redirect || '/';
      } else {
        setError(data.error || 'Invalid invite code.');
        setCode('');
        inputRef.current?.focus();
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#060606',
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Inter, Arial, sans-serif',
      WebkitFontSmoothing: 'antialiased',
      padding: '16px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Radial glow */}
      <div style={{
        position: 'fixed',
        inset: 0,
        background:
          'radial-gradient(ellipse 60% 50% at 50% 0%, rgba(124,58,237,0.12), transparent 70%),' +
          'radial-gradient(ellipse 40% 40% at 80% 100%, rgba(14,165,233,0.07), transparent 70%)',
        pointerEvents: 'none',
      }} />

      <div style={{ position: 'relative', width: '100%', maxWidth: '360px' }}>
        {/* Logo */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '40px' }}>
          <div style={{
            width: '52px',
            height: '52px',
            borderRadius: '16px',
            // background: '#000',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '16px',
            // boxShadow: '0 0 0 1px rgba(255,255,255,0.08), 0 8px 24px -4px rgba(0,0,0,0.6)',
          }}>
            {/* Blip "B" wordmark */}
            <BlipLogo size={46} priority/>
          </div>
          <h1 style={{ color: '#ffffff', fontSize: '22px', fontWeight: 600, margin: 0, letterSpacing: '-0.025em' }}>
            Blip Money
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '13px', marginTop: '6px' }}>
            Private beta · Merchant testing
          </p>
        </div>

        {/* Card */}
        <div style={{
          borderRadius: '20px',
          border: '1px solid rgba(255,255,255,0.07)',
          background: 'rgba(255,255,255,0.03)',
          backdropFilter: 'blur(20px)',
          padding: '24px',
        }}>
          <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: '14px', marginBottom: '20px', lineHeight: 1.6, margin: '0 0 20px' }}>
            Enter your invite code to access the Blip merchant beta.
          </p>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <input
              ref={inputRef}
              type="text"
              value={code}
              onChange={(e) => { setCode(e.target.value); setError(''); }}
              placeholder="BLIP-XXXX-XXXX"
              spellCheck={false}
              autoComplete="off"
              maxLength={50}
              style={{
                width: '100%',
                padding: '12px 16px',
                borderRadius: '12px',
                border: `1px solid ${error ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.08)'}`,
                background: 'rgba(255,255,255,0.04)',
                color: '#ffffff',
                fontSize: '14px',
                fontFamily: 'SF Mono, ui-monospace, monospace',
                letterSpacing: '0.12em',
                outline: 'none',
                boxSizing: 'border-box',
                transition: 'border-color 0.15s, background 0.15s',
              }}
              onFocus={(e) => { e.target.style.borderColor = 'rgba(255,255,255,0.22)'; e.target.style.background = 'rgba(255,255,255,0.06)'; }}
              onBlur={(e) => { e.target.style.borderColor = error ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.08)'; e.target.style.background = 'rgba(255,255,255,0.04)'; }}
            />

            {error && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#f87171', flexShrink: 0 }} />
                <p style={{ color: '#f87171', fontSize: '12px', margin: 0 }}>{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !code.trim()}
              style={{
                width: '100%',
                padding: '13px',
                borderRadius: '12px',
                border: 'none',
                background: loading || !code.trim() ? 'rgba(255,255,255,0.12)' : '#ffffff',
                color: loading || !code.trim() ? 'rgba(255,255,255,0.3)' : '#000000',
                fontSize: '14px',
                fontWeight: 600,
                cursor: loading || !code.trim() ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'background 0.15s, color 0.15s',
                marginTop: '4px',
              }}
            >
              {loading ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 0.8s linear infinite' }}>
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="30" strokeLinecap="round"/>
                  </svg>
                  Verifying…
                </>
              ) : (
                <>
                  Enter
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                  </svg>
                </>
              )}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: '12px', marginTop: '24px' }}>
          Need access? Contact the Blip team.
        </p>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
