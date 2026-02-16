import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/merchant/:merchantId/telegram
 * Update merchant's Telegram chat ID for push notifications
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: merchantId } = await params;
    const body = await request.json();
    const { telegram_chat_id } = body;

    if (!telegram_chat_id) {
      return NextResponse.json(
        { success: false, error: 'telegram_chat_id is required' },
        { status: 400 }
      );
    }

    // Update merchant's telegram_chat_id
    await query(
      `UPDATE merchants
       SET telegram_chat_id = $1
       WHERE id = $2`,
      [telegram_chat_id, merchantId]
    );

    return NextResponse.json({
      success: true,
      data: { merchantId, telegram_chat_id },
    });
  } catch (error) {
    console.error('[Telegram] Error updating chat_id:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
