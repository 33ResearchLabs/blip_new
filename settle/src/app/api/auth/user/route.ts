import { NextRequest, NextResponse } from 'next/server';
import {
  getUserByWallet,
  createUser,
  checkUsernameAvailable,
  updateUsername,
  getUserById,
} from '@/lib/db/repositories/users';
import { verifyWalletSignature } from '@/lib/solana/verifySignature';

/**
 * POST /api/auth/user
 * Actions: wallet_login, set_username, check_username
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, username, wallet_address, signature, message } = body;

    // Check username availability
    if (action === 'check_username') {
      if (!username) {
        return NextResponse.json(
          { success: false, error: 'Username is required' },
          { status: 400 }
        );
      }

      try {
        console.log('[API] Checking username availability:', username);
        const available = await checkUsernameAvailable(username);
        console.log('[API] Username availability result:', { username, available });
        return NextResponse.json({
          success: true,
          data: { available },
        });
      } catch (checkError) {
        console.error('[API] Error checking username availability:', checkError);
        return NextResponse.json(
          { success: false, error: 'Failed to check username availability', details: checkError instanceof Error ? checkError.message : String(checkError) },
          { status: 500 }
        );
      }
    }

    // Login/Signup with wallet signature
    if (action === 'wallet_login') {
      if (!wallet_address || !signature || !message) {
        return NextResponse.json(
          { success: false, error: 'wallet_address, signature, and message are required' },
          { status: 400 }
        );
      }

      // Verify the wallet signature
      const isValid = await verifyWalletSignature(wallet_address, signature, message);
      if (!isValid) {
        return NextResponse.json(
          { success: false, error: 'Invalid wallet signature' },
          { status: 401 }
        );
      }

      // Check if user exists
      let user = await getUserByWallet(wallet_address);
      let isNewUser = false;
      let needsUsername = false;

      if (!user) {
        // Create new user without username (will be set later)
        user = await createUser({
          wallet_address,
          username: `user_${wallet_address.slice(0, 8)}`, // Temporary username
        });
        isNewUser = true;
        needsUsername = true;
      } else if (!user.username || user.username.startsWith('user_')) {
        // Existing user without a proper username
        needsUsername = true;
      }

      console.log('[API] User authenticated via wallet:', user.id, user.username, { isNewUser, needsUsername });

      return NextResponse.json({
        success: true,
        data: {
          user,
          isNewUser,
          needsUsername,
        },
      });
    }

    // Set username for first-time users
    if (action === 'set_username') {
      if (!wallet_address || !signature || !message || !username) {
        return NextResponse.json(
          { success: false, error: 'wallet_address, signature, message, and username are required' },
          { status: 400 }
        );
      }

      // Verify the wallet signature
      const isValid = await verifyWalletSignature(wallet_address, signature, message);
      if (!isValid) {
        return NextResponse.json(
          { success: false, error: 'Invalid wallet signature' },
          { status: 401 }
        );
      }

      // Validate username
      if (username.length < 3 || username.length > 20) {
        return NextResponse.json(
          { success: false, error: 'Username must be 3-20 characters' },
          { status: 400 }
        );
      }

      if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return NextResponse.json(
          { success: false, error: 'Username can only contain letters, numbers, and underscores' },
          { status: 400 }
        );
      }

      // Check username availability
      const available = await checkUsernameAvailable(username);
      if (!available) {
        return NextResponse.json(
          { success: false, error: 'Username already taken' },
          { status: 409 }
        );
      }

      // Get user by wallet
      const user = await getUserByWallet(wallet_address);
      if (!user) {
        return NextResponse.json(
          { success: false, error: 'User not found' },
          { status: 404 }
        );
      }

      // Check if user already has a non-temporary username
      if (user.username && !user.username.startsWith('user_')) {
        return NextResponse.json(
          { success: false, error: 'Username already set and cannot be changed' },
          { status: 400 }
        );
      }

      // Update username
      const updatedUser = await updateUsername(user.id, username);
      if (!updatedUser) {
        return NextResponse.json(
          { success: false, error: 'Failed to update username' },
          { status: 500 }
        );
      }

      console.log('[API] Username set for user:', user.id, username);

      return NextResponse.json({
        success: true,
        data: { user: updatedUser },
      });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid action' },
      { status: 400 }
    );
  } catch (error) {
    console.error('User auth error:', error);
    return NextResponse.json(
      { success: false, error: 'Authentication failed', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/auth/user?id=xxx
 * Get user by ID
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('id');

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'User ID is required' },
        { status: 400 }
      );
    }

    const user = await getUserById(userId);
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: { user },
    });
  } catch (error) {
    console.error('Get user error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get user' },
      { status: 500 }
    );
  }
}
