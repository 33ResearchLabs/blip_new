'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Copy, Check, ExternalLink, Clock, User, CheckCircle2, XCircle, Lock, ChevronRight, Sun, Moon, ArrowRight, Wallet, DollarSign } from 'lucide-react';

interface Trade {
  id: string;
  escrow_address: string;
  deal_id: string;
  merchant_pubkey: string;
  buyer_pubkey: string | null;
  arbiter_pubkey: string;
  treasury_pubkey: string;
  mint_address: string;
  amount: string;
  fee_bps: number;
  status: string;
  created_at: string;
  locked_at: string | null;
  released_at: string | null;
  created_slot: number;
  locked_slot: number | null;
  released_slot: number | null;
  protocol_version: string;
  lane_id: number;
  created_signature: string | null;
  locked_signature: string | null;
  released_signature: string | null;
  refunded_signature: string | null;
}

interface Transaction {
  id: number;
  program_id: string;
  version: string;
  signature: string;
  instruction_type: string;
  trade_pda: string;
  slot: number;
  block_time: string;
}

interface Event {
  id: string;
  event_type: string;
  signature: string;
  slot: number;
  block_time: string;
  signer: string;
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

function Row({ label, children, mono = false }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start py-2.5 border-b border-border/50 last:border-0">
      <span className="text-xs text-muted-foreground w-40 shrink-0 pt-0.5">{label}</span>
      <span className={`text-sm text-foreground flex-1 min-w-0 ${mono ? 'font-mono' : ''}`}>{children}</span>
    </div>
  );
}

function AddressCell({ address, link, label }: { address: string; link?: string; label?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {link ? (
        <Link href={link} className="text-muted-foreground hover:text-foreground hover:underline text-xs font-mono">
          {address}
        </Link>
      ) : (
        <span className="text-xs font-mono text-foreground">{address}</span>
      )}
      <CopyButton text={address} />
      <a href={`https://solscan.io/account/${address}?cluster=devnet`} target="_blank" rel="noopener noreferrer"
        className="p-1 rounded hover:bg-secondary transition-colors">
        <ExternalLink size={11} className="text-muted-foreground" />
      </a>
    </div>
  );
}

export default function TradePage({ params }: { params: { escrow: string } }) {
  const [trade, setTrade] = useState<Trade | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAll();
  }, [params.escrow]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [tradeRes, txRes, eventsRes] = await Promise.all([
        fetch(`/api/trades/${params.escrow}`),
        fetch(`/api/transactions?trade_pda=${params.escrow}&limit=50`),
        fetch(`/api/events/${params.escrow}`),
      ]);
      const [tradeData, txData, eventsData] = await Promise.all([
        tradeRes.json(),
        txRes.json(),
        eventsRes.json(),
      ]);
      setTrade(tradeData.error ? null : tradeData);
      setTransactions(txData.transactions || []);
      setEvents(eventsData.events || []);
    } catch (error) {
      console.error('Error fetching trade data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatAddr = (address: string, chars = 4) => {
    if (!address) return '—';
    return `${address.slice(0, chars)}...${address.slice(-chars)}`;
  };

  const formatAmount = (amount: string) => {
    const num = parseInt(amount) / 1_000_000;
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatTime = (timestamp: string | null) => {
    if (!timestamp) return '—';
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  };

  const timeAgo = (timestamp: string | null) => {
    if (!timestamp) return '';
    const diff = Date.now() - new Date(timestamp).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  };

  const solscanTx = (sig: string) => `https://solscan.io/tx/${sig}?cluster=devnet`;
  const solscanAccount = (addr: string) => `https://solscan.io/account/${addr}?cluster=devnet`;

  const statusConfig: Record<string, { dot: string; text: string; bg: string }> = {
    created: { dot: 'bg-gray-400', text: 'text-gray-600 dark:text-gray-400', bg: 'bg-gray-50 dark:bg-gray-500/10' },
    funded: { dot: 'bg-blue-500', text: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-500/10' },
    locked: { dot: 'bg-yellow-500', text: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-50 dark:bg-yellow-500/10' },
    payment_sent: { dot: 'bg-purple-500', text: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-500/10' },
    disputed: { dot: 'bg-orange-500', text: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-500/10' },
    released: { dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
    refunded: { dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-500/10' },
  };

  const getStatus = (s: string) => statusConfig[s?.toLowerCase()] || statusConfig.created;

  const instructionLabel = (type: string) => {
    const map: Record<string, string> = {
      create_trade: 'Create Trade',
      create_escrow: 'Create Escrow',
      lock_escrow: 'Lock Escrow',
      lock_for_taker: 'Lock for Taker',
      release_escrow: 'Release Escrow',
      release_to_taker: 'Release to Taker',
      refund_escrow: 'Refund Escrow',
      refund_to_maker: 'Refund to Maker',
      match_offer: 'Match Offer',
      match_offer_lane: 'Match Offer (Lane)',
      fund_lane: 'Fund Lane',
      create_lane: 'Create Lane',
      withdraw_lane: 'Withdraw Lane',
    };
    return map[type] || type;
  };

  const instructionColor = (type: string) => {
    if (type.includes('create') || type.includes('fund')) return 'text-blue-600 dark:text-blue-400';
    if (type.includes('lock') || type.includes('match')) return 'text-yellow-600 dark:text-yellow-400';
    if (type.includes('release')) return 'text-emerald-600 dark:text-emerald-400';
    if (type.includes('refund')) return 'text-red-600 dark:text-red-400';
    return 'text-muted-foreground';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!trade) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">Trade not found</p>
          <Link href="/" className="text-sm text-primary hover:underline mt-2 inline-block">Back to explorer</Link>
        </div>
      </div>
    );
  }

  const sc = getStatus(trade.status);

  // Build lifecycle steps from trade data
  const lifecycle = [
    { label: 'Created', sig: trade.created_signature, time: trade.created_at, slot: trade.created_slot, active: true },
    { label: 'Locked', sig: trade.locked_signature, time: trade.locked_at, slot: trade.locked_slot, active: !!trade.locked_at },
    { label: trade.status === 'refunded' ? 'Refunded' : 'Released', sig: trade.status === 'refunded' ? trade.refunded_signature : trade.released_signature, time: trade.released_at, slot: trade.released_slot, active: trade.status === 'released' || trade.status === 'refunded' },
  ];

  // Calculate timing
  const createdMs = new Date(trade.created_at).getTime();
  const lockedMs = trade.locked_at ? new Date(trade.locked_at).getTime() : null;
  const releasedMs = trade.released_at ? new Date(trade.released_at).getTime() : null;
  const lockTime = lockedMs ? Math.round((lockedMs - createdMs) / 1000) : null;
  const releaseTime = lockedMs && releasedMs ? Math.round((releasedMs - lockedMs) / 1000) : null;
  const totalTime = releasedMs ? Math.round((releasedMs - createdMs) / 1000) : null;

  const formatDuration = (seconds: number | null) => {
    if (seconds === null) return '—';
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m < 60) return `${m}m ${s}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  };

  const feeAmount = trade.fee_bps > 0 ? (parseInt(trade.amount) * trade.fee_bps / 10000 / 1_000_000) : 0;
  const netAmount = parseInt(trade.amount) / 1_000_000 - feeAmount;

  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
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
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-400">Devnet</span>
            <ThemeToggle />
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-5">
          <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
          <ChevronRight size={12} />
          <span className="text-foreground">Escrow Details</span>
        </div>

        {/* Page header with status badge */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-foreground">Escrow</h1>
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full ${sc.bg}`}>
              <div className={`w-2 h-2 rounded-full ${sc.dot}`} />
              <span className={`text-xs font-medium capitalize ${sc.text}`}>{trade.status}</span>
            </div>
            {trade.protocol_version && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-secondary text-muted-foreground">
                {trade.protocol_version}
              </span>
            )}
          </div>
          <a href={solscanAccount(trade.escrow_address)} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            View on Solscan <ExternalLink size={11} />
          </a>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="p-3 rounded-lg bg-card border border-border">
            <p className="text-xs text-muted-foreground mb-1">Amount</p>
            <p className="text-lg font-semibold text-foreground">${formatAmount(trade.amount)}</p>
            <p className="text-[10px] text-muted-foreground font-mono">{parseInt(trade.amount).toLocaleString()} lamports</p>
          </div>
          <div className="p-3 rounded-lg bg-card border border-border">
            <p className="text-xs text-muted-foreground mb-1">Fee</p>
            <p className="text-lg font-semibold text-foreground">{trade.fee_bps > 0 ? `${(trade.fee_bps / 100).toFixed(2)}%` : '0%'}</p>
            <p className="text-[10px] text-muted-foreground">{trade.fee_bps > 0 ? `$${feeAmount.toFixed(2)} (${trade.fee_bps} bps)` : 'No fee'}</p>
          </div>
          <div className="p-3 rounded-lg bg-card border border-border">
            <p className="text-xs text-muted-foreground mb-1">Net Payout</p>
            <p className="text-lg font-semibold text-foreground">${netAmount.toFixed(2)}</p>
            <p className="text-[10px] text-muted-foreground">After fee deduction</p>
          </div>
          <div className="p-3 rounded-lg bg-card border border-border">
            <p className="text-xs text-muted-foreground mb-1">Total Time</p>
            <p className="text-lg font-semibold text-foreground">{formatDuration(totalTime)}</p>
            <p className="text-[10px] text-muted-foreground">{totalTime !== null ? 'Create → Release' : 'In progress'}</p>
          </div>
        </div>

        {/* Escrow lifecycle progress */}
        <div className="rounded-lg border border-border bg-card mb-4 p-4">
          <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-4">Escrow Lifecycle</h2>
          <div className="flex items-center justify-between">
            {lifecycle.map((step, i) => (
              <div key={step.label} className="flex items-center flex-1">
                <div className="flex flex-col items-center text-center flex-1">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center mb-2 ${
                    step.active ? 'bg-emerald-100 dark:bg-emerald-500/20 border-2 border-emerald-500' : 'bg-secondary border-2 border-border'
                  }`}>
                    {step.label === 'Created' && <Wallet size={14} className={step.active ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'} />}
                    {step.label === 'Locked' && <Lock size={14} className={step.active ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'} />}
                    {(step.label === 'Released' || step.label === 'Refunded') && <DollarSign size={14} className={step.active ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'} />}
                  </div>
                  <p className={`text-xs font-medium ${step.active ? 'text-foreground' : 'text-muted-foreground'}`}>{step.label}</p>
                  {step.time && <p className="text-[10px] text-muted-foreground mt-0.5">{timeAgo(step.time)}</p>}
                </div>
                {i < lifecycle.length - 1 && (
                  <div className="flex flex-col items-center mx-2 mb-6">
                    <ArrowRight size={14} className="text-muted-foreground" />
                    {i === 0 && lockTime !== null && <span className="text-[10px] text-muted-foreground mt-0.5">{formatDuration(lockTime)}</span>}
                    {i === 1 && releaseTime !== null && <span className="text-[10px] text-muted-foreground mt-0.5">{formatDuration(releaseTime)}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Details section */}
        <div className="rounded-lg border border-border bg-card mb-4">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider">Details</h2>
          </div>
          <div className="px-4">
            <Row label="Escrow PDA" mono>
              <AddressCell address={trade.escrow_address} />
            </Row>
            <Row label="Trade / Deal ID" mono>
              <span className="text-xs break-all">{trade.deal_id || '—'}</span>
            </Row>
            {trade.lane_id !== undefined && trade.lane_id > 0 && (
              <Row label="Lane ID">
                <span className="font-mono">#{trade.lane_id}</span>
              </Row>
            )}
            <Row label="Mint" mono>
              <AddressCell address={trade.mint_address} />
            </Row>
          </div>
        </div>

        {/* Participants section */}
        <div className="rounded-lg border border-border bg-card mb-4">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider">Participants</h2>
          </div>
          <div className="px-4">
            <Row label="Creator / Seller" mono>
              <AddressCell address={trade.merchant_pubkey} link={`/merchant/${trade.merchant_pubkey}`} />
            </Row>
            <Row label="Counterparty / Buyer" mono>
              {trade.buyer_pubkey ? (
                <AddressCell address={trade.buyer_pubkey} link={`/merchant/${trade.buyer_pubkey}`} />
              ) : (
                <span className="text-muted-foreground italic text-xs">Awaiting counterparty</span>
              )}
            </Row>
            {trade.arbiter_pubkey && (
              <Row label="Arbiter" mono>
                <AddressCell address={trade.arbiter_pubkey} />
              </Row>
            )}
            {trade.treasury_pubkey && (
              <Row label="Treasury" mono>
                <AddressCell address={trade.treasury_pubkey} />
              </Row>
            )}
          </div>
        </div>

        {/* ALL Transactions section — the main event */}
        <div className="rounded-lg border border-border bg-card mb-4">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider">Transactions</h2>
            <span className="text-[10px] text-muted-foreground">{transactions.length + (lifecycle.filter(s => s.sig).length)} total</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium w-8">#</th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Instruction</th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Signature</th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Time</th>
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium hidden sm:table-cell">Slot</th>
                  <th className="text-right px-4 py-2.5 text-muted-foreground font-medium w-16"></th>
                </tr>
              </thead>
              <tbody>
                {/* First, show tx from unified transactions table */}
                {transactions.length > 0 ? (
                  transactions.map((tx, idx) => (
                    <tr key={tx.signature} className="border-b border-border/50 last:border-0 hover:bg-card-hover transition-colors">
                      <td className="px-4 py-3 text-muted-foreground">{idx + 1}</td>
                      <td className="px-4 py-3">
                        <span className={`font-medium ${instructionColor(tx.instruction_type)}`}>
                          {instructionLabel(tx.instruction_type)}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-foreground">
                        <div className="flex items-center gap-1.5">
                          <span>{tx.signature.slice(0, 20)}...{tx.signature.slice(-6)}</span>
                          <CopyButton text={tx.signature} />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <div>{formatTime(tx.block_time)}</div>
                        <div className="text-[10px]">{timeAgo(tx.block_time)}</div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground font-mono hidden sm:table-cell">
                        {tx.slot ? tx.slot.toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <a href={solscanTx(tx.signature)} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                          <ExternalLink size={12} />
                        </a>
                      </td>
                    </tr>
                  ))
                ) : (
                  /* Fallback: show lifecycle signatures from trade record */
                  lifecycle.filter(s => s.sig).map((step, idx) => (
                    <tr key={step.sig} className="border-b border-border/50 last:border-0 hover:bg-card-hover transition-colors">
                      <td className="px-4 py-3 text-muted-foreground">{idx + 1}</td>
                      <td className="px-4 py-3">
                        <span className={`font-medium ${
                          step.label === 'Created' ? 'text-blue-600 dark:text-blue-400' :
                          step.label === 'Locked' ? 'text-yellow-600 dark:text-yellow-400' :
                          step.label === 'Released' ? 'text-emerald-600 dark:text-emerald-400' :
                          'text-red-600 dark:text-red-400'
                        }`}>
                          {step.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-foreground">
                        <div className="flex items-center gap-1.5">
                          <span>{step.sig!.slice(0, 20)}...{step.sig!.slice(-6)}</span>
                          <CopyButton text={step.sig!} />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <div>{formatTime(step.time)}</div>
                        <div className="text-[10px]">{timeAgo(step.time)}</div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground font-mono hidden sm:table-cell">
                        {step.slot ? Number(step.slot).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <a href={solscanTx(step.sig!)} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                          <ExternalLink size={12} />
                        </a>
                      </td>
                    </tr>
                  ))
                )}
                {transactions.length === 0 && lifecycle.filter(s => s.sig).length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      No transactions recorded yet. The indexer may still be catching up.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* V1 Event Timeline (only for V1 trades with events) */}
        {events.length > 0 && (
          <div className="rounded-lg border border-border bg-card mb-4">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider">Event Log</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Event</th>
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Signature</th>
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Slot</th>
                    <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">Time</th>
                    <th className="text-right px-4 py-2.5 text-muted-foreground font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id} className="border-b border-border/50 last:border-0 hover:bg-card-hover transition-colors">
                      <td className="px-4 py-2.5 font-medium capitalize text-foreground">{event.event_type}</td>
                      <td className="px-4 py-2.5 font-mono text-foreground">
                        <div className="flex items-center gap-1.5">
                          <span>{event.signature.slice(0, 16)}...{event.signature.slice(-6)}</span>
                          <CopyButton text={event.signature} />
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground font-mono">{event.slot.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{formatTime(event.block_time)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <a href={solscanTx(event.signature)} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                          <ExternalLink size={12} />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Timestamps section */}
        <div className="rounded-lg border border-border bg-card">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider">Timestamps</h2>
          </div>
          <div className="px-4">
            <Row label="Created">
              {formatTime(trade.created_at)}
              {trade.created_slot && <span className="text-xs text-muted-foreground ml-2">Slot {Number(trade.created_slot).toLocaleString()}</span>}
            </Row>
            {trade.locked_at && (
              <Row label="Locked">
                {formatTime(trade.locked_at)}
                {trade.locked_slot && <span className="text-xs text-muted-foreground ml-2">Slot {Number(trade.locked_slot).toLocaleString()}</span>}
                {lockTime !== null && <span className="text-xs text-muted-foreground ml-2">({formatDuration(lockTime)} after creation)</span>}
              </Row>
            )}
            {trade.released_at && (
              <Row label={trade.status === 'refunded' ? 'Refunded' : 'Released'}>
                {formatTime(trade.released_at)}
                {trade.released_slot && <span className="text-xs text-muted-foreground ml-2">Slot {Number(trade.released_slot).toLocaleString()}</span>}
                {totalTime !== null && <span className="text-xs text-muted-foreground ml-2">({formatDuration(totalTime)} total)</span>}
              </Row>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
