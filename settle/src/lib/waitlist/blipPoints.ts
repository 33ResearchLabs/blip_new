// Point values for the waitlist airdrop. Sourced from the futureStick build —
// these numbers must match what the marketing/comms promised the existing
// waitlist, so changing them is a coordination decision, not a code-only one.

import type { WaitlistActorType, WaitlistTaskType } from '@/lib/types/database';

export const USER_BLIP_POINTS = {
  REGISTER: 200,
  REFERRAL: 100,
  TASK_DEFAULT: 50,
  ONBOARD_FORM: 500,
} as const;

export const MERCHANT_BLIP_POINTS = {
  REGISTER: 2000,
  REFERRAL: 1000,
  TWITTER: 500,
  TELEGRAM: 500,
  DISCORD: 500,
  RETWEET: 100,
  ONBOARD_FORM: 500,
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
      case 'TWITTER':      return MERCHANT_BLIP_POINTS.TWITTER;
      case 'TELEGRAM':     return MERCHANT_BLIP_POINTS.TELEGRAM;
      case 'DISCORD':      return MERCHANT_BLIP_POINTS.DISCORD;
      // The "Retweet a Post" quest is registered with task_type='CUSTOM'.
      case 'CUSTOM':       return MERCHANT_BLIP_POINTS.RETWEET;
      case 'ONBOARD_FORM': return MERCHANT_BLIP_POINTS.ONBOARD_FORM;
      // QUIZ / WHITEPAPER aren't wired to a credited quest yet — fall
      // back to TASK_DEFAULT so unknown future task types don't silently
      // inherit the TWITTER amount.
      default:             return USER_BLIP_POINTS.TASK_DEFAULT;
    }
  }
  // User actors: the Onboard Form tile awards the same 500 BLIP since the
  // tile is rendered for both roles. Everything else is TASK_DEFAULT.
  if (taskType === 'ONBOARD_FORM') return USER_BLIP_POINTS.ONBOARD_FORM;
  return USER_BLIP_POINTS.TASK_DEFAULT;
}
