'use client';

import { useState, FormEvent } from 'react';

export default function DevLockPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/dev-unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        window.location.href = '/';
      } else {
        setError(data.error || 'Wrong password');
        setPassword('');
      }
    } catch {
      setError('Network error. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0a0a0a',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <form onSubmit={handleSubmit} style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        width: '100%',
        maxWidth: '360px',
        padding: '40px',
        borderRadius: '12px',
        background: '#141414',
        border: '1px solid #222',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '8px' }}>
          <div style={{ fontSize: '24px', marginBottom: '4px' }}>&#128274;</div>
          <h1 style={{ color: '#fff', fontSize: '20px', fontWeight: 600, margin: 0 }}>
            Development Access
          </h1>
          <p style={{ color: '#666', fontSize: '14px', marginTop: '8px' }}>
            Enter the team password to continue
          </p>
        </div>

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          required
          maxLength={100}
          style={{
            padding: '12px 16px',
            borderRadius: '8px',
            border: '1px solid #333',
            background: '#0a0a0a',
            color: '#fff',
            fontSize: '16px',
            outline: 'none',
          }}
        />

        {error && (
          <p style={{ color: '#ef4444', fontSize: '14px', margin: 0, textAlign: 'center' }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !password}
          style={{
            padding: '12px',
            borderRadius: '8px',
            border: 'none',
            background: loading || !password ? '#333' : '#fff',
            color: loading || !password ? '#666' : '#000',
            fontSize: '16px',
            fontWeight: 600,
            cursor: loading || !password ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Verifying...' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
