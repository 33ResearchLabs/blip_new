'use client';

// /waitlist/merchant — merchant registration. Ported design from
// futureStick's MerchantRegister.tsx: shared waitlist navbar, AuthPageLayout
// with the merchant variant of the phone-card visual, "Merchant
// Registration" badge + "Join Merchant Waitlist" heading, and a 6-tile
// "WHAT MERCHANTS GET" grid below. Layout pinned to 100vh.

import { Suspense } from 'react';
import { Gift, HandCoins, Zap, Activity, Users, Wallet } from 'lucide-react';
import AuthPageLayout from '@/components/waitlist/AuthPageLayout';
import RegisterForm from '@/components/waitlist/RegisterForm';
import WaitlistAuthNavbar from '@/components/waitlist/WaitlistAuthNavbar';

const MERCHANT_FEATURES = [
  { icon: Activity,  title: 'Early App Access',         desc: 'Test the merchant dashboard before public launch.' },
  { icon: HandCoins, title: 'Zero Settlement Fees',     desc: 'Early merchants receive reduced or zero fees during the beta phase.' },
  { icon: Zap,       title: 'Priority Routing',         desc: 'Merchant nodes get faster matching and network priority.' },
  { icon: Users,     title: 'Referral Rewards',         desc: 'Refer other merchants and unlock priority access perks.' },
  { icon: Wallet,    title: 'Direct Settlement',        desc: 'Get paid directly on-chain — no banks, no chargebacks.' },
  { icon: Gift,      title: 'Founding Merchant Status', desc: 'Recognised as a founding partner during the beta.' },
];

function Content() {
  // 100vh outer shell, scroll happens inside <main> so the navbar stays put
  // and the merchant perks grid (bottomContent) is reachable via scroll.
  return (
    <div className="h-screen flex flex-col bg-[#FAF8F5] dark:bg-black text-black dark:text-white overflow-hidden">
      <WaitlistAuthNavbar current="merchant-register" />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-6 py-4 md:py-6">
          <AuthPageLayout
            badge="Merchant Registration"
            heading="Join Merchant Waitlist"
            description="Join the Blip P2P merchant network before public launch."
            variant="merchant"
            bottomContent={
              <div className="mt-16 w-full max-w-5xl mx-auto">
                <p className="text-center text-xs tracking-widest text-black/40 dark:text-white/50 mb-8">
                  WHAT MERCHANTS GET
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {MERCHANT_FEATURES.map(({ icon: Icon, title, desc }) => (
                    <div key={title}
                      className="p-6 border border-black/10 dark:border-white/10 rounded-xl hover:border-black/20 dark:hover:border-white/20 transition">
                      <Icon className="w-5 h-5 text-black/60 dark:text-white/50 mb-4" />
                      <h3 className="text-sm font-semibold text-black dark:text-white mb-2">{title}</h3>
                      <p className="text-xs text-black/50 dark:text-white/50 leading-relaxed">{desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            }
          >
            <RegisterForm role="merchant" />
          </AuthPageLayout>
        </div>
      </main>
    </div>
  );
}

export default function WaitlistMerchantSignupPage() {
  return (
    <Suspense fallback={<div className="h-screen bg-[#FAF8F5] dark:bg-black" />}>
      <Content />
    </Suspense>
  );
}
