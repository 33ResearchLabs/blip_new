'use client';

// /waitlist/merchant-login — merchant sign-in. Ported design from futureStick's
// MerchantLogin.tsx: shared waitlist navbar, AuthPageLayout with the phone-
// card visual, the login form, and a 6-tile "What Merchants Get" grid below.

import { HandCoins, Activity, Zap, Wallet, Gift, Users } from 'lucide-react';
import AuthPageLayout from '@/components/waitlist/AuthPageLayout';
import LoginForm from '@/components/waitlist/LoginForm';
import WaitlistAuthNavbar from '@/components/waitlist/WaitlistAuthNavbar';

const MERCHANT_PERKS = [
  { icon: Gift,      title: 'Genesis Token Allocation', desc: 'Earn BLIP allocation for onboarding early and providing volume.' },
  { icon: HandCoins, title: 'Zero Settlement Fees',     desc: 'Early merchants receive reduced or zero fees during test phase.' },
  { icon: Zap,       title: 'Priority Routing',         desc: 'Merchant nodes get faster matching + network priority.' },
  { icon: Activity,  title: 'Early App Access',         desc: 'Test merchant dashboard before public launch.' },
  { icon: Users,     title: 'Governance Rights',        desc: 'Vote on fees, routes, and network policies.' },
  { icon: Wallet,    title: 'Liquidity Rewards',        desc: 'Earn rewards for committing settlement volume.' },
];

export default function WaitlistMerchantLoginPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#FAF8F5] dark:bg-black text-black dark:text-white">
      <WaitlistAuthNavbar current="merchant-login" />
      <main className="flex-1">
        <div className="max-w-7xl mx-auto px-6 pt-10 pb-16">
          <AuthPageLayout
            badge="Merchant Portal"
            heading="Merchant Sign In"
            description="Access your merchant dashboard and manage your business"
            variant="merchant"
            bottomContent={
              <div className="mt-16 w-full max-w-5xl mx-auto">
                <p className="text-center text-xs tracking-widest text-black/40 dark:text-white/50 mb-8">
                  WHAT MERCHANTS GET
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {MERCHANT_PERKS.map(({ icon: Icon, title, desc }) => (
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
            <LoginForm role="merchant" />
          </AuthPageLayout>
        </div>
      </main>
    </div>
  );
}
