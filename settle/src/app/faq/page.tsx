'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  ChevronDown,
  Search,
  Wallet,
  ArrowLeftRight,
  CreditCard,
  ShieldCheck,
  Scale,
  Coins,
  LifeBuoy,
} from 'lucide-react';

/**
 * FAQ
 * ───
 * Self-contained help page. Static content — no API calls — so the page
 * renders instantly and works offline. Q&A grouped by category; one item
 * open at a time within a category to keep the page compact on mobile.
 * Lightweight client-side filter narrows down by keyword.
 */

interface QA {
  q: string;
  a: string;
}

interface Category {
  id: string;
  label: string;
  Icon: typeof Wallet;
  items: QA[];
}

const CATEGORIES: Category[] = [
  {
    id: 'getting-started',
    label: 'Getting Started',
    Icon: Wallet,
    items: [
      {
        q: 'What is Blip Money?',
        a: 'Blip Money is a peer-to-peer (P2P) marketplace where you can buy and sell USDT (Tether) for fiat currency. Orders are matched between users and merchants, and crypto is held in an on-chain escrow until the fiat payment is confirmed.',
      },
      {
        q: 'How do I create an account?',
        a: 'Open the app and choose a username on the home screen. You can sign in with a connected Solana wallet or use the embedded wallet flow on your device. No KYC is required to start browsing, but verified merchants may have higher limits.',
      },
      {
        q: 'Do I need a Solana wallet?',
        a: 'Yes — every Blip Money account is tied to a Solana wallet so escrow can lock and release USDT on-chain. You can either connect an external wallet (Phantom, Backpack, Solflare) or create an embedded wallet inside the app.',
      },
      {
        q: 'How do I switch between dark and light mode?',
        a: 'Open the Profile tab (You), scroll to Preferences, and tap the Appearance toggle. Your choice is remembered on this device.',
      },
    ],
  },
  {
    id: 'trading',
    label: 'Trading',
    Icon: ArrowLeftRight,
    items: [
      {
        q: 'How do I buy USDT?',
        a: "Tap the Trade tab, pick Buy, enter the fiat amount, then select a merchant offer. After accepting, the merchant locks USDT in escrow and you send the fiat through your chosen payment method. Once the merchant confirms receipt, the USDT releases to your wallet.",
      },
      {
        q: 'How do I sell USDT?',
        a: "From the Trade tab, pick Sell, enter the amount, choose a payment method to receive fiat, and accept a buyer's offer. You then lock USDT in escrow. After the buyer sends fiat and you confirm receipt, the USDT releases to them.",
      },
      {
        q: 'How long does a trade take?',
        a: 'Most trades complete in 5–15 minutes. After accepting an offer you have 120 minutes for the escrow lock and payment cycle before the order auto-cancels or moves to dispute. If you stay in the chat, both sides usually finish much faster.',
      },
      {
        q: "What happens if I don't pay in time?",
        a: 'If the buyer does not mark payment sent within the trade window, the order is cancelled. If escrow was already locked, the crypto is automatically refunded to the seller. Repeated no-shows can affect your trader reputation.',
      },
    ],
  },
  {
    id: 'payment-methods',
    label: 'Payment Methods',
    Icon: CreditCard,
    items: [
      {
        q: 'How do I add a payment method?',
        a: 'Open Profile (You), find the Payment Methods card, and tap Add. Choose the type (Bank, UPI, Cash, Other), enter the details, and save. You can add as many methods as you like.',
      },
      {
        q: 'What is the "Default" payment method?',
        a: 'The default is the method shown first in pickers and pre-selected when you start a new sell order. Tap the ⭐ star next to any method to make it the new default. Only one method can be default at a time.',
      },
      {
        q: 'Can I edit or remove a payment method later?',
        a: 'Yes — tap the pencil icon to edit, or the trash icon to delete. Deletion uses a two-tap "confirm" pattern to prevent accidental removal. Removing the default does not auto-promote another method; you choose the new default yourself.',
      },
      {
        q: 'Which payment method should I use?',
        a: 'Pick whichever your trading partner supports. UPI is fastest in India; bank transfers work everywhere but settle slower; cash and other methods (Wise, PayPal, etc.) depend on local merchant availability. Always confirm in chat before sending.',
      },
    ],
  },
  {
    id: 'security',
    label: 'Security',
    Icon: ShieldCheck,
    items: [
      {
        q: 'How does App Lock PIN work?',
        a: 'When enabled, the app prompts for your 4-digit PIN every time you reopen it after switching away. Five wrong attempts in 15 minutes will temporarily lock the PIN. Set or change it in Profile → Security & Privacy → App Lock PIN.',
      },
      {
        q: 'Should I turn on Biometric Unlock?',
        a: "Yes if your device supports Face ID, Touch ID, or Windows Hello — it's faster and just as safe as typing the PIN. You still need a PIN as the fallback. Enable it in Profile → Security & Privacy → Biometric Unlock.",
      },
      {
        q: 'What are Trusted Devices?',
        a: 'Every device you sign in on is listed in Profile → Security & Privacy → Trusted Devices. Review this list periodically; if you see a device you don\'t recognise, remove it immediately and change your password.',
      },
      {
        q: 'I forgot my PIN — what now?',
        a: 'You can sign out from any other device where you are still logged in, then sign back in on this device to reset the PIN. If you have no other device, contact support — recovery requires identity verification.',
      },
    ],
  },
  {
    id: 'escrow-disputes',
    label: 'Escrow & Disputes',
    Icon: Scale,
    items: [
      {
        q: 'What is escrow?',
        a: 'Escrow is an on-chain smart contract that holds the seller\'s USDT until the buyer\'s fiat payment is confirmed. The seller cannot reclaim the crypto without the buyer\'s confirmation (or a compliance ruling), and the buyer cannot get the crypto without paying first.',
      },
      {
        q: 'When can I open a dispute?',
        a: 'You can dispute any order that has been escrowed or has the "payment sent" status. Open the chat for that order and tap Dispute. A compliance reviewer will look at the chat history, payment proof, and account history.',
      },
      {
        q: 'What happens after I open a dispute?',
        a: 'Both parties are notified. You have 24 hours to share evidence (receipts, screenshots) before automatic resolution. A compliance reviewer will decide; the escrowed crypto is then released to the rightful party.',
      },
      {
        q: 'How are auto-cancelled orders handled?',
        a: 'If escrow was never locked, the order simply expires with no asset movement. If escrow was locked but the trade timed out, the USDT is automatically refunded to the seller via an atomic on-chain refund.',
      },
    ],
  },
  {
    id: 'fees-limits',
    label: 'Fees & Limits',
    Icon: Coins,
    items: [
      {
        q: 'What fees do I pay?',
        a: 'Blip charges a small platform fee per completed trade, shown transparently before you confirm. Merchants may also include a spread in their quoted rate — always check the "You receive" / "You pay" panel before accepting.',
      },
      {
        q: 'Are there trading limits?',
        a: 'New accounts start with conservative per-trade and daily limits to reduce fraud risk. Limits increase automatically as you build a successful trading history. Verified merchants have higher limits from day one.',
      },
      {
        q: 'Are there network fees for the wallet?',
        a: 'Yes — Solana transactions cost a tiny amount of SOL (typically a fraction of a cent). Keep a small SOL balance for escrow operations. The app warns you before any transaction that would fail due to insufficient SOL.',
      },
      {
        q: 'Why was my rate slightly different at execution?',
        a: 'Quoted rates are valid for a short window. If the corridor price moves before you accept, the order uses the live rate at acceptance. Large moves will require you to re-confirm.',
      },
    ],
  },
];

export default function FaqPage() {
  const [query, setQuery] = useState('');
  // Per-category open index — only one item open per category to keep the
  // page short on mobile. Map keys are category ids.
  const [openByCat, setOpenByCat] = useState<Record<string, number | null>>({});

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CATEGORIES;
    return CATEGORIES
      .map((c) => ({
        ...c,
        items: c.items.filter(
          (it) => it.q.toLowerCase().includes(q) || it.a.toLowerCase().includes(q),
        ),
      }))
      .filter((c) => c.items.length > 0);
  }, [query]);

  const toggle = (catId: string, idx: number) =>
    setOpenByCat((prev) => ({
      ...prev,
      [catId]: prev[catId] === idx ? null : idx,
    }));

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Ambient background — same pattern as /console */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-1/3 w-[600px] h-[400px] bg-white/[0.03] rounded-full blur-[150px]" />
        <div className="absolute bottom-0 left-1/4 w-[500px] h-[300px] bg-white/[0.02] rounded-full blur-[150px]" />
      </div>

      <header className="sticky top-0 z-50 bg-black/95 backdrop-blur-sm border-b border-white/[0.04]">
        <div className="px-4 h-14 flex items-center gap-3 max-w-[480px] mx-auto">
          <Link
            href="/"
            className="p-2 -ml-2 hover:bg-white/5 rounded-lg transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5 text-white/70" />
          </Link>
          <div className="flex-1">
            <h1 className="text-sm font-semibold text-white/95">FAQs</h1>
            <p className="text-[10px] text-white/45">Frequently asked questions</p>
          </div>
          <LifeBuoy className="w-4 h-4 text-white/35" />
        </div>
      </header>

      <main className="relative z-10 px-4 py-5 pb-24 max-w-[480px] mx-auto">
        {/* Search */}
        <div className="relative mb-5">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search questions"
            maxLength={100}
            className="w-full h-11 pl-9 pr-3 rounded-[12px] bg-white/[0.04] border border-white/[0.06] text-[13px] text-white/95 placeholder:text-white/30 outline-none focus:border-white/[0.18] transition"
          />
        </div>

        {filtered.length === 0 && (
          <div className="rounded-[16px] border border-white/[0.06] bg-white/[0.02] p-6 text-center">
            <p className="text-[13px] text-white/55">
              No results for &ldquo;{query}&rdquo;.
            </p>
            <p className="mt-1 text-[11px] text-white/35">
              Try a different keyword or contact support.
            </p>
          </div>
        )}

        {filtered.map((cat) => {
          const Icon = cat.Icon;
          const open = openByCat[cat.id] ?? null;
          return (
            <section key={cat.id} className="mb-6">
              <div className="flex items-center gap-1.5 mb-2 px-1">
                <Icon className="w-3.5 h-3.5 text-white/40" />
                <span className="text-[10px] font-bold tracking-[0.22em] uppercase text-white/45">
                  {cat.label}
                </span>
              </div>

              <div className="rounded-[20px] overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,0.025)_0%,rgba(255,255,255,0.015)_100%)] border border-white/[0.07] shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_8px_24px_-12px_rgba(0,0,0,0.6)] divide-y divide-white/[0.05]">
                {cat.items.map((item, idx) => {
                  const isOpen = open === idx;
                  return (
                    <div key={item.q}>
                      <button
                        type="button"
                        onClick={() => toggle(cat.id, idx)}
                        aria-expanded={isOpen}
                        className="w-full px-4 py-3.5 flex items-start gap-3 text-left hover:bg-white/[0.025] active:bg-white/[0.04] transition"
                      >
                        <span className="flex-1 min-w-0 text-[13.5px] font-semibold tracking-[-0.01em] text-white/95 leading-snug">
                          {item.q}
                        </span>
                        <ChevronDown
                          className={`w-4 h-4 mt-0.5 text-white/35 shrink-0 transition-transform duration-200 ${
                            isOpen ? 'rotate-180 text-white/75' : ''
                          }`}
                        />
                      </button>
                      <AnimatePresence initial={false}>
                        {isOpen && (
                          <motion.div
                            key="answer"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                            className="overflow-hidden"
                          >
                            <p className="px-4 pb-4 -mt-1 text-[12.5px] text-white/65 leading-relaxed">
                              {item.a}
                            </p>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}

        <p className="mt-6 text-center text-[11px] text-white/35">
          Can&apos;t find what you need? Tap Contact Support from your profile.
        </p>
      </main>
    </div>
  );
}
