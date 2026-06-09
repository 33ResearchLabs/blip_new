/**
 * reCAPTCHA Enterprise helpers for SMS fraud assessment.
 *
 * Required env vars:
 *   RECAPTCHA_API_KEY        — Google Cloud API key with reCAPTCHA Enterprise enabled
 *   NEXT_PUBLIC_FIREBASE_PROJECT_ID — reused as the GCP project ID (same project)
 *   NEXT_PUBLIC_RECAPTCHA_SITE_KEY  — score-based site key
 */

import { logger } from '@/lib/logger';

const BASE_URL = 'https://recaptchaenterprise.googleapis.com/v1';

function getApiKey(): string {
  const key = process.env.RECAPTCHA_API_KEY;
  if (!key) throw new Error('RECAPTCHA_API_KEY not configured');
  return key;
}

function getProjectId(): string {
  const id = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!id) throw new Error('NEXT_PUBLIC_FIREBASE_PROJECT_ID not configured');
  return id;
}

function getSiteKey(): string {
  const key = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  if (!key) throw new Error('NEXT_PUBLIC_RECAPTCHA_SITE_KEY not configured');
  return key;
}

export interface AssessmentResult {
  assessmentId: string;
  risk: number | null;
  allowed: boolean;
}

/**
 * Create a reCAPTCHA Enterprise assessment for a phone OTP send.
 * Returns the assessment ID (needed for annotation) and the fraud risk score.
 * Risk 0.0 = likely legitimate, 1.0 = likely fraudulent.
 * Blocks when risk > RISK_THRESHOLD (0.5 by default).
 */
export async function createPhoneAssessment(
  token: string,
  phone: string,
  accountId: string,
  riskThreshold = 0.5,
): Promise<AssessmentResult> {
  const projectId = getProjectId();
  const apiKey = getApiKey();
  const siteKey = getSiteKey();

  const url = `${BASE_URL}/projects/${projectId}/assessments?key=${apiKey}`;
  const body = {
    event: {
      token,
      siteKey,
      userInfo: {
        accountId,
        userIds: [{ phoneNumber: phone }],
      },
    },
  };

  let assessmentId = '';
  let risk: number | null = null;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.warn('[reCAPTCHA] Assessment failed', { status: res.status, body: text });
      // Fail open — don't block legitimate users if the API is down
      return { assessmentId: '', risk: null, allowed: true };
    }

    const data = await res.json();
    assessmentId = data.name ?? '';
    risk = data.phoneFraudAssessment?.smsTollFraudVerdict?.risk ?? null;

    logger.info('[reCAPTCHA] Assessment created', {
      assessmentId,
      risk,
      phone: phone.slice(0, 5) + '****',
    });
  } catch (err) {
    logger.warn('[reCAPTCHA] Assessment error', { error: (err as Error).message });
    return { assessmentId: '', risk: null, allowed: true };
  }

  const allowed = risk === null || risk <= riskThreshold;
  return { assessmentId, risk, allowed };
}

type AnnotationReason =
  | 'INITIATED_TWO_FACTOR'
  | 'PASSED_TWO_FACTOR'
  | 'FAILED_TWO_FACTOR';

type AnnotationLabel = 'LEGITIMATE' | 'FRAUDULENT';

/**
 * Annotate a reCAPTCHA assessment after OTP send/verify/fail.
 * Must be called within 10 minutes of the assessment for best accuracy.
 */
export async function annotatePhoneAssessment(opts: {
  assessmentId: string;
  phone: string;
  reason: AnnotationReason;
  annotation?: AnnotationLabel;
}): Promise<void> {
  if (!opts.assessmentId) return;

  const apiKey = getApiKey();
  const url = `${BASE_URL}/${opts.assessmentId}:annotate?key=${apiKey}`;
  const body: Record<string, unknown> = {
    reasons: [opts.reason],
    phoneAuthenticationEvent: { phoneNumber: opts.phone },
  };
  if (opts.annotation) body.annotation = opts.annotation;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      logger.warn('[reCAPTCHA] Annotation failed', { status: res.status });
    }
  } catch (err) {
    logger.warn('[reCAPTCHA] Annotation error', { error: (err as Error).message });
  }
}
