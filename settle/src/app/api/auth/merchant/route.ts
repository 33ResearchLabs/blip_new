import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, action } = body;

    if (action === 'login') {
      if (!email || !password) {
        return NextResponse.json(
          { success: false, error: 'Email and password are required' },
          { status: 400 }
        );
      }

      // Query merchant by email
      const rows = await query(
        `SELECT id, email, display_name, business_name, balance, wallet_address, rating, total_trades, is_online
         FROM merchants
         WHERE email = $1 AND status = 'active'`,
        [email]
      );

      if (rows.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Invalid credentials' },
          { status: 401 }
        );
      }

      // For demo, simple password check
      if (password !== 'merchant123') {
        return NextResponse.json(
          { success: false, error: 'Invalid credentials' },
          { status: 401 }
        );
      }

      const merchant = rows[0] as {
        id: string;
        email: string;
        display_name: string;
        business_name: string;
        balance: number;
        wallet_address: string;
        rating: number;
        total_trades: number;
        is_online: boolean;
      };

      // Update online status
      await query(
        `UPDATE merchants SET is_online = true, last_seen_at = NOW() WHERE id = $1`,
        [merchant.id]
      );

      console.log('[API] Merchant login successful - id:', merchant.id, 'display_name:', merchant.display_name, 'email:', merchant.email);

      return NextResponse.json({
        success: true,
        data: {
          merchant: {
            id: merchant.id,
            email: merchant.email,
            display_name: merchant.display_name,
            business_name: merchant.business_name,
            balance: parseFloat(String(merchant.balance)) || 0,
            wallet_address: merchant.wallet_address,
            rating: parseFloat(String(merchant.rating)) || 5,
            total_trades: merchant.total_trades || 0,
          },
        },
      });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid action' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Merchant auth error:', error);
    return NextResponse.json(
      { success: false, error: 'Authentication failed', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// PATCH - Update merchant wallet address
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { merchant_id, wallet_address } = body;

    if (!merchant_id || !wallet_address) {
      return NextResponse.json(
        { success: false, error: 'merchant_id and wallet_address are required' },
        { status: 400 }
      );
    }

    // Validate wallet address format (Solana base58)
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet_address)) {
      return NextResponse.json(
        { success: false, error: 'Invalid Solana wallet address format' },
        { status: 400 }
      );
    }

    // Update merchant wallet address
    const result = await query(
      `UPDATE merchants SET wallet_address = $1, updated_at = NOW() WHERE id = $2 RETURNING id, wallet_address`,
      [wallet_address, merchant_id]
    );

    if (result.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Merchant not found' },
        { status: 404 }
      );
    }

    console.log('[API] Merchant wallet updated - id:', merchant_id, 'wallet:', wallet_address);

    return NextResponse.json({
      success: true,
      data: {
        merchant_id,
        wallet_address,
      },
    });
  } catch (error) {
    console.error('Merchant wallet update error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update wallet', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
