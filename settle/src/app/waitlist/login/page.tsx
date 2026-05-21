'use client';

// /waitlist/login — user sign-in. Ported design from futureStick's UserLogin
// "waitlist" view: shared waitlist navbar, AuthPageLayout with the phone-
// card visual on the left, the login form on the right, and a 4-tile "What
// you get" grid below the form.

import { Gift, Zap, Users, Shield } from 'lucide-react';
import AuthPageLayout from '@/components/waitlist/AuthPageLayout';
import LoginForm from '@/components/waitlist/LoginForm';
import WaitlistAuthNavbar from '@/components/waitlist/WaitlistAuthNavbar';

const BENEFITS = [
  { icon: Gift,   text: '200 Bonus Points' },
  { icon: Zap,    text: 'Early Access' },
  { icon: Users,  text: 'Referral Rewards' },
  { icon: Shield, text: 'Priority Support' },
];

export default function WaitlistUserLoginPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#FAF8F5] dark:bg-black text-black dark:text-white">
      <WaitlistAuthNavbar current="user-login" />
      <main className="flex-1">
        <div className="max-w-7xl mx-auto px-6 pt-10 pb-16">
          <AuthPageLayout
            badge="Welcome Back"
            heading="Sign In to Blip"
            description="Access your dashboard and start earning rewards"
            variant="user"
          >
            <LoginForm role="user" />
            <div className="border-t border-black/[0.06] dark:border-white/[0.06] mt-8">
              <p className="text-[10px] text-black/80 dark:text-white/40 uppercase tracking-wider mb-4 text-center mt-4 font-medium">
                What you get
              </p>
              <div className="grid grid-cols-2 gap-4">
                {BENEFITS.map(({ icon: Icon, text }) => (
                  <div key={text}
                    className="flex items-center gap-3 p-3 rounded-xl bg-white/80 dark:bg-white/[0.02] border border-black/[0.06] dark:border-white/[0.05]">
                    <Icon className="w-4 h-4 text-black/80 dark:text-white/60" />
                    <span className="text-xs text-black/80 font-medium dark:text-white/60">{text}</span>
                  </div>
                ))}
              </div>
            </div>
          </AuthPageLayout>
        </div>
      </main>
    </div>
  );
}
