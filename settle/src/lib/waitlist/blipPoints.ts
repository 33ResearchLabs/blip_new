// Point values for the waitlist airdrop. Sourced from the futureStick build —
// these numbers must match what the marketing/comms promised the existing
// waitlist, so changing them is a coordination decision, not a code-only one.

import type { WaitlistActorType, WaitlistTaskType } from '@/lib/types/database';

export const USER_BLIP_POINTS = {
  REGISTER: 200,
  REFERRAL: 100,
  TASK_DEFAULT: 50,
} as const;

export const MERCHANT_BLIP_POINTS = {
  REGISTER: 2000,
  REFERRAL: 1000,
  TWITTER: 500,
  TELEGRAM: 500,
  DISCORD: 500,
  RETWEET: 100,
} as const;

export function getRegisterPoints(actorType: WaitlistActorType): number {
  return actorType === 'merchant' ? MERCHANT_BLIP_POINTS.REGISTER : USER_BLIP_POINTS.REGISTER;
}

export function getReferralPoints(actorType: WaitlistActorType): number {
  return actorType === 'merchant' ? MERCHANT_BLIP_POINTS.REFERRAL : USER_BLIP_POINTS.REFERRAL;
}

export function getTaskPoints(actorType: WaitlistActorType, taskType: WaitlistTaskType): number {
  if (actorType === 'merchant') {
    switch (taskType) {
      case 'TWITTER':  return MERCHANT_BLIP_POINTS.TWITTER;
      case 'TELEGRAM': return MERCHANT_BLIP_POINTS.TELEGRAM;
      case 'DISCORD':  return MERCHANT_BLIP_POINTS.DISCORD;
      // The "Retweet a Post" quest is registered with task_type='CUSTOM' on
      // the client (see waitlist/dashboard/page.tsx). Without an explicit
      // arm it used to fall through to the TWITTER amount (500), so the UI
      // promised +100 while the server credited +500.
      case 'CUSTOM':   return MERCHANT_BLIP_POINTS.RETWEET;
      // QUIZ / WHITEPAPER aren't wired to a credited quest yet — surface
      // the same default the user side uses so unknown future task types
      // don't silently inherit the TWITTER amount.
      default:         return USER_BLIP_POINTS.TASK_DEFAULT;
    }
  }
  return USER_BLIP_POINTS.TASK_DEFAULT;
}
