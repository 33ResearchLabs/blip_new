'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Copy, Check, ExternalLink, Sun, Moon, Users } from 'lucide-react';

interface Merchant {
  merchant_pubkey: string;
  display_name: string | null;
  business_name: string | null;
  total_trades: number;
  total_volume: string;
  rating: string | null;
  rating_count: number;
  is_online: boolean;
  last_seen_at: string | null;
  created_at: string;
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('blipscan-theme', next ? 'dark' : 'light');
  };
  return (
    <button onClick={toggle} className="p-2 rounded-lg hover:bg-secondary transition-colors" title="Toggle theme">
      {dark ? <Sun size={16} className="text-foreground" /> : <Moon size={16} className="text-foreground" />}
    </button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy} className="p-1 rounded hover:bg-secondary transition-colors" title="Copy">
      {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} className="text-muted-foreground" />}
    </button>
  );
}

export default function MerchantsPage() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/merchants')
      .then((res) => res.json())
      .then((data) => setMerchants(data.merchants || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const formatAddress = (address: string) => `${address.slice(0, 4)}...${address.slice(-4)}`;

  const formatAmount = (amount: string) => {
    const num = parseInt(amount) / 1_000_000;
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatTime = (timestamp: string | null) => {
    if (!timestamp) return '—';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  const solscanAccount = (addr: string) => `https://solscan.io/account/${addr}?cluster=devnet`;

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
                <span className="text-white font-bold text-xs">B</span>
              </div>
              <span className="font-semibold text-foreground text-sm">BlipScan</span>
            </Link>
            <div className="hidden sm:flex items-center gap-4 text-xs">
              <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">Trades</Link>
              <Link href="/merchants" className="text-foreground font-medium">Merchants</Link>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-400">
              Devnet
            </span>
            <ThemeToggle />
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center gap-2 mb-6">
          <Users size={18} className="text-primary" />
          <h1 className="text-lg font-semibold text-foreground">Merchants</h1>
          <span className="text-xs text-muted-foreground ml-1">({merchants.length})</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : merchants.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-sm text-muted-foreground">No merchants found</p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">#</th>
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Merchant</th>
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Name</th>
                    <th className="text-center px-4 py-2.5 text-muted-foreground font-medium">Rating</th>
                    <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Trades</th>
                    <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Volume</th>
                    <th className="text-center px-4 py-2.5 text-muted-foreground font-medium">Status</th>
                    <th className="text-right px-4 py-2.5 text-muted-foreground font-medium">Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {merchants.map((m, index) => {
                    const rating = parseFloat(m.rating || '0');
                    const ratingColor = rating >= 4 ? 'text-emerald-600 dark:text-emerald-400' : rating >= 3 ? 'text-yellow-600 dark:text-yellow-400' : rating > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground';
                    return (
                    <tr key={m.merchant_pubkey} className="border-b border-border/50 last:border-0 hover:bg-card-hover transition-colors">
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {index + 1}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <Link href={`/merchant/${m.merchant_pubkey}`} className="font-mono text-primary hover:underline">
                            {formatAddress(m.merchant_pubkey)}
                          </Link>
                          <CopyButton text={m.merchant_pubkey} />
                          <a href={solscanAccount(m.merchant_pubkey)} target="_blank" rel="noopener noreferrer"
                            className="p-0.5 rounded hover:bg-secondary transition-colors">
                            <ExternalLink size={10} className="text-muted-foreground" />
                          </a>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-foreground">
                        {m.display_name || m.business_name || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <span className={`font-medium ${ratingColor}`}>
                            {rating > 0 ? rating.toFixed(1) : '—'}
                          </span>
                          {rating > 0 && <span className="text-yellow-500">&#9733;</span>}
                          {m.rating_count > 0 && (
                            <span className="text-muted-foreground text-[10px]">({m.rating_count})</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-foreground">
                        {(m.total_trades ?? 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-foreground">
                        ${formatAmount(m.total_volume || '0')}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <div className={`w-1.5 h-1.5 rounded-full ${m.is_online ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                          <span className={`text-xs ${m.is_online ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                            {m.is_online ? 'Online' : 'Offline'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground">
                        {formatTime(m.last_seen_at)}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
