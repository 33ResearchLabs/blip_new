'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronLeft,
  ChevronDown,
  Search,
  Wallet,
  ArrowLeftRight,
  CreditCard,
  ShieldCheck,
  Scale,
  Coins,
  HelpCircle,
} from 'lucide-react';
import { useUserTheme } from '@/hooks/useUserTheme';

const CARD = 'bg-surface-card border border-border-subtle';
const SECTION_LABEL = 'text-[10px] font-bold tracking-[0.22em] text-text-tertiary uppercase';

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
        q: 'What is Blip?',
        a: 'Blip is a peer-to-peer (P2P) marketplace where you can buy and sell USDT for local currency. You trade directly with verified merchants — Blip holds the crypto in an on-chain escrow until your payment is confirmed, so neither side can walk away mid-trade.',
      },
      {
        q: 'How do I create an account?',
        a: 'Download the app, pick a username, and you\'re in. A wallet is created for you automatically — no separate setup required. You can always link an external Solana wallet later from Profile → Wallet.',
      },
      {
        q: 'Do I need a Solana wallet?',
        a: 'Every Blip account has a built-in Solana wallet — you don\'t need to bring your own. If you prefer to use Phantom, Backpack, or another Solana wallet, you can connect it from Profile → Wallet at any time.',
      },
      {
        q: 'How do I switch between dark and light mode?',
        a: 'Open the Profile tab, scroll down to Preferences, and tap Appearance. Your choice is saved on this device.',
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
        a: 'Tap Trade, select Buy, and enter the amount you want to spend. Choose a merchant offer that suits your preferred payment method and rate. Once you accept, the merchant locks USDT in escrow — send the fiat payment and mark it sent in the app. After the merchant confirms receipt, the USDT lands in your wallet.',
      },
      {
        q: 'How do I sell USDT?',
        a: 'Tap Trade, select Sell, and enter the USDT amount. Pick a buyer offer, then lock your USDT into escrow. The buyer sends you fiat — once you receive it and confirm in the app, the escrow releases automatically.',
      },
      {
        q: 'How long does a trade take?',
        a: 'Most trades complete in 5–15 minutes. The order window is 120 minutes from acceptance — if both sides stay active in the chat it usually wraps up much faster.',
      },
      {
        q: "What happens if the buyer doesn't pay in time?",
        a: 'If payment is not marked sent within the trade window, the order is cancelled. If escrow was already locked, the USDT is automatically refunded to the seller on-chain. Repeated no-shows can lower your trader reputation.',
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
        a: 'Go to Profile → Payment Methods and tap Add. Choose the type — Bank Transfer, UPI, Cash, or Other — fill in the details, and save. You can add as many as you like.',
      },
      {
        q: 'What is the default payment method?',
        a: 'Your default method is pre-selected whenever you start a sell order. Tap the star icon next to any method to make it the new default. Only one method can be default at a time.',
      },
      {
        q: 'Can I edit or delete a payment method?',
        a: 'Yes — tap the edit icon to update details, or the delete icon to remove it. Deleting requires a second confirmation tap to prevent accidents. If you remove your default, you\'ll need to pick a new one before your next trade.',
      },
      {
        q: 'Which payment method should I use?',
        a: 'UPI is fastest for Indian traders. Bank transfers work everywhere but settle slower. Always check what the merchant supports before accepting an offer — the trade chat is the right place to confirm before sending money.',
      },
    ],
  },
  {
    id: 'security',
    label: 'Security',
    Icon: ShieldCheck,
    items: [
      {
        q: 'How does App Lock work?',
        a: 'When App Lock is on, you\'ll be asked for your PIN every time you reopen Blip after switching away. Five wrong attempts in 15 minutes will temporarily lock the PIN entry. Set or change it under Profile → Security.',
      },
      {
        q: 'Should I enable Biometric Unlock?',
        a: 'Yes — Face ID or fingerprint is faster than typing your PIN and equally secure. Your PIN remains the fallback if biometrics aren\'t available. Enable it under Profile → Security → Biometric Unlock.',
      },
      {
        q: 'What are Trusted Devices?',
        a: 'Every device you sign in on appears in Profile → Security → Trusted Devices. Review this list periodically. If you spot a device you don\'t recognise, remove it immediately — this revokes its session.',
      },
      {
        q: 'I forgot my PIN — what do I do?',
        a: 'Sign out from another device where you\'re still logged in, then sign back in on this device to reset the PIN. If you have no other active session, contact support — account recovery requires identity verification.',
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
        a: 'Escrow is a smart contract on Solana that holds the seller\'s USDT during the trade. The crypto cannot be moved until the buyer\'s fiat payment is confirmed — or until a compliance reviewer decides the outcome of a dispute. It protects both sides.',
      },
      {
        q: 'When can I open a dispute?',
        a: 'You can raise a dispute on any order that has USDT locked in escrow or where payment has been marked sent. Open the order, tap Dispute, and describe the issue. Our team will review the chat history and any payment proof you share.',
      },
      {
        q: 'What happens after I raise a dispute?',
        a: 'Both parties are notified and have 24 hours to submit evidence — receipts, screenshots, bank statements. A compliance reviewer will examine everything and release the escrowed USDT to the rightful party.',
      },
      {
        q: 'What happens to an order that times out?',
        a: 'If escrow was never locked, the order expires with no asset movement. If USDT was already in escrow, the order moves to dispute and our team handles the resolution. You\'ll always be notified before anything is finalised.',
      },
    ],
  },
  {
    id: 'fees-limits',
    label: 'Fees & Limits',
    Icon: Coins,
    items: [
      {
        q: 'What fees does Blip charge?',
        a: 'Blip charges a small platform fee on each completed trade, displayed clearly before you confirm. Merchants set their own rate — the difference between the market price and the merchant\'s quoted rate goes to them. You always see the exact amount you\'ll receive before accepting.',
      },
      {
        q: 'Are there trading limits?',
        a: 'Yes — new accounts start with conservative per-trade and daily limits to reduce fraud risk. Limits increase automatically as your trading history grows. If you need a higher limit sooner, contact support.',
      },
      {
        q: 'Are there Solana network fees?',
        a: 'Solana transactions cost a tiny fraction of a cent in SOL. Keep a small SOL balance in your wallet for escrow operations. Blip will warn you before any transaction that would fail due to insufficient SOL.',
      },
      {
        q: 'Why was the rate slightly different from what I saw?',
        a: 'Merchant rates are live — if the corridor price moves between when you viewed an offer and when you accepted it, the final rate reflects the live price at acceptance. Any significant move will prompt you to re-confirm before the order is placed.',
      },
    ],
  },
];

export default function FaqPage() {
  const router = useRouter();
  const { theme } = useUserTheme();
  const isLight = theme === 'light';

  const [query, setQuery] = useState('');
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
    <div
      className={`user-scope ${isLight ? 'user-light' : ''} min-h-dvh`}
      style={{ background: 'var(--color-surface-base)' }}
    >
      <div className="mx-auto w-full max-w-[560px]">
        {/* Header — back-navigable pattern matching SupportTicketScreen */}
        <header className="px-5 pt-4 pb-4 shrink-0">
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={() => router.back()}
            aria-label="Back"
            className={`w-9 h-9 rounded-[14px] flex items-center justify-center mb-3 ${CARD}`}
          >
            <ChevronLeft className="w-5 h-5 text-text-secondary" />
          </motion.button>
          <p className="text-[26px] font-extrabold tracking-[-0.03em] text-text-primary leading-none">
            FAQs
          </p>
        </header>

        <div className="px-5 pb-28">
          {/* Search */}
          <div className={`flex items-center gap-3 px-4 py-3.5 rounded-[16px] mb-6 ${CARD}`}>
            <Search className="w-[18px] h-[18px] text-text-tertiary shrink-0" strokeWidth={2} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search questions..."
              maxLength={100}
              className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[13.5px] font-medium text-text-primary placeholder:text-text-tertiary"
            />
          </div>

          {/* Empty state */}
          {filtered.length === 0 && (
            <div className={`rounded-[18px] py-10 px-5 flex flex-col items-center justify-center text-center ${CARD}`}>
              <span className="w-12 h-12 rounded-full bg-surface-active border border-border-subtle flex items-center justify-center mb-3">
                <HelpCircle className="w-[18px] h-[18px] text-text-tertiary" strokeWidth={2} />
              </span>
              <p className="text-[13.5px] font-bold text-text-primary mb-1">
                No results for &ldquo;{query}&rdquo;
              </p>
              <p className="text-[11.5px] font-medium text-text-tertiary">
                Try a different keyword or raise a support ticket.
              </p>
            </div>
          )}

          {/* Categories */}
          {filtered.map((cat) => {
            const Icon = cat.Icon;
            const open = openByCat[cat.id] ?? null;
            return (
              <section key={cat.id} className="mb-6">
                <div className="flex items-center gap-1.5 mb-2.5 px-1">
                  <Icon className="w-3.5 h-3.5 text-text-quaternary" strokeWidth={2} />
                  <span className={SECTION_LABEL}>{cat.label}</span>
                </div>

                <div className={`rounded-[20px] overflow-hidden ${CARD}`}>
                  {cat.items.map((item, idx, arr) => {
                    const isOpen = open === idx;
                    return (
                      <div
                        key={item.q}
                        className={idx < arr.length - 1 ? 'border-b border-border-subtle' : ''}
                      >
                        <button
                          type="button"
                          onClick={() => toggle(cat.id, idx)}
                          aria-expanded={isOpen}
                          className="w-full px-4 py-4 flex items-start gap-3 text-left"
                        >
                          <span className="flex-1 min-w-0 text-[14px] font-bold tracking-[-0.01em] leading-snug text-text-primary">
                            {item.q}
                          </span>
                          <ChevronDown
                            className={`w-4 h-4 mt-0.5 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''} text-text-tertiary`}
                            strokeWidth={2.2}
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
                              <p className="px-4 pb-4 -mt-1 text-[13.5px] leading-relaxed text-text-secondary">
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

          <p className="mt-2 text-center text-[12px] font-medium text-text-tertiary">
            Still stuck? Go to Profile → Support to raise a ticket.
          </p>
        </div>
      </div>
    </div>
  );
}
