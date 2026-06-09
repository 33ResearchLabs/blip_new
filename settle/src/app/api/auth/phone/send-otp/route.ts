import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { z } from 'zod';
import { requireTokenAuth, validationErrorResponse, errorResponse } from '@/lib/middleware/auth';
import { checkRateLimit, STRICT_LIMIT } from '@/lib/middleware/rateLimit';
import { query as dbQuery } from '@/lib/db';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const schema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Phone must be in E.164 format e.g. +919876543210'),
});

function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('Twilio credentials not configured');
  return twilio(sid, token);
}

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = await checkRateLimit(request, 'phone:send-otp', STRICT_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  const auth = await requireTokenAuth(request);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error.errors.map(e => e.message));
  }

  const { phone } = parsed.data;
  const userId = auth.actorId;

  // Check phone not already taken by another account
  const existing = await dbQuery<{ id: string }>(
    'SELECT id FROM users WHERE phone = $1 AND id != $2',
    [phone, userId]
  );
  if (existing.length > 0) {
    return NextResponse.json(
      { success: false, error: 'PHONE_TAKEN', message: 'This phone number is linked to another account.' },
      { status: 409 }
    );
  }

  const code = generateOtp();

  try {
    const client = getTwilioClient();
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;
    if (!fromNumber) throw new Error('TWILIO_PHONE_NUMBER not configured');

    await client.messages.create({
      to: `whatsapp:${phone}`,
      from: `whatsapp:${fromNumber}`,
      body: `Your Blip verification code is *${code}*\n\nValid for 10 minutes. Do not share this with anyone.\n\n_Blip Money_`,
    });

    // Invalidate previous codes for this user + store new one
    await dbQuery(
      `UPDATE phone_otp_codes SET used = TRUE WHERE user_id = $1 AND used = FALSE`,
      [userId]
    );
    await dbQuery(
      `INSERT INTO phone_otp_codes (user_id, phone, code, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '10 minutes')`,
      [userId, phone, code]
    );

    // Save phone on user row (unverified) so verify step knows what to check
    await dbQuery(
      'UPDATE users SET phone = $1, phone_verified = FALSE WHERE id = $2',
      [phone, userId]
    );

    logger.info('[Phone] OTP sent', { userId, phone: phone.slice(0, 6) + '****' });
    return NextResponse.json({ success: true, message: 'OTP sent' });
  } catch (err) {
    const e = err as any;
    logger.error('[Phone] Failed to send OTP', { error: e.message, code: e.code });
    return errorResponse(`Failed to send OTP: ${e.message ?? 'unknown error'}`);
  }
}
