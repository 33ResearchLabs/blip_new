// Point values for the waitlist airdrop. Aligned to the published Blip Points
// table: Join Waitlist / Successful Referral / Join via Referral / Verified
// Social Task / Complete Waitlist Profile. These numbers are a marketing/comms
// commitment to the existing waitlist, so changing them is a coordination
// decision, not a code-only one.

import type { WaitlistActorType, WaitlistTaskType } from '@/lib/types/database';

export const USER_BLIP_POINTS = {
  REGISTER: 200,      // Join Waitlist
  REFERRAL: 100,      // Successful Referral (referrer earns)
  REFEREE: 50,        // Join via Referral (new joiner earns)
  TASK_DEFAULT: 50,   // Verified Social Task
  ONBOARD_FORM: 500,  // Complete Waitlist Profile
} as const;

export const MERCHANT_BLIP_POINTS = {
  REGISTER: 1000,     // Join Waitlist
  REFERRAL: 500,      // Successful Referral (referrer earns)
  REFEREE: 250,       // Join via Referral (new joiner earns)
  TWITTER: 250,       // Verified Social Task
  TELEGRAM: 250,
  DISCORD: 250,
  RETWEET: 250,
  ONBOARD_FORM: 500,  // Complete Waitlist Profile
} as const;

export function getRegisterPoints(actorType: WaitlistActorType): number {
  return actorType === 'merchant' ? MERCHANT_BLIP_POINTS.REGISTER : USER_BLIP_POINTS.REGISTER;
}

export function getReferralPoints(actorType: WaitlistActorType): number {
  return actorType === 'merchant' ? MERCHANT_BLIP_POINTS.REFERRAL : USER_BLIP_POINTS.REFERRAL;
}

// Bonus the NEW joiner receives for signing up through a referral link
// ("Join via Referral"). This is half the referrer's "Successful Referral"
// bonus and is credited as REFERRAL_BONUS_RECEIVED.
export function getRefereePoints(actorType: WaitlistActorType): number {
  return actorType === 'merchant' ? MERCHANT_BLIP_POINTS.REFEREE : USER_BLIP_POINTS.REFEREE;
}

export function getTaskPoints(actorType: WaitlistActorType, taskType: WaitlistTaskType): number {
  if (actorType === 'merchant') {
    switch (taskType) {
      case 'TWITTER':      return MERCHANT_BLIP_POINTS.TWITTER;
      case 'TELEGRAM':     return MERCHANT_BLIP_POINTS.TELEGRAM;
      case 'DISCORD':      return MERCHANT_BLIP_POINTS.DISCORD;
      // The "Retweet a Post" quest is registered with task_type='CUSTOM' on
      // the client (see waitlist/dashboard/page.tsx). All merchant social
      // tasks now award the same 250 BLIP per the points table.
      case 'CUSTOM':       return MERCHANT_BLIP_POINTS.RETWEET;
      case 'ONBOARD_FORM': return MERCHANT_BLIP_POINTS.ONBOARD_FORM;
      // QUIZ / WHITEPAPER aren't wired to a credited quest yet — surface
      // the same default the user side uses so unknown future task types
      // don't silently inherit a social-task amount.
      default:             return USER_BLIP_POINTS.TASK_DEFAULT;
    }
  }
  // User actors: the Onboard Form tile awards the same 500 BLIP since the
  // tile is rendered for both roles. Everything else is TASK_DEFAULT.
  if (taskType === 'ONBOARD_FORM') return USER_BLIP_POINTS.ONBOARD_FORM;
  return USER_BLIP_POINTS.TASK_DEFAULT;
}
