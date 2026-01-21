import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateUser,
  createUser,
  getUserByWallet,
  linkWalletToUser,
  checkUsernameAvailable,
  updateUsername,
  updatePassword,
  getUserById,
} from '@/lib/db/repositories/users';

/**
 * POST /api/auth/user
 * Actions: login, signup, check_username
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, username, password, wallet_address } = body;

    // Check username availability
    if (action === 'check_username') {
      if (!username) {
        return NextResponse.json(
          { success: false, error: 'Username is required' },
          { status: 400 }
        );
      }

      const available = await checkUsernameAvailable(username);
      return NextResponse.json({
        success: true,
        data: { available },
      });
    }

    // Login with username + password
    if (action === 'login') {
      if (!username || !password) {
        return NextResponse.json(
          { success: false, error: 'Username and password are required' },
          { status: 400 }
        );
      }

      const user = await authenticateUser(username, password);
      if (!user) {
        return NextResponse.json(
          { success: false, error: 'Invalid username or password' },
          { status: 401 }
        );
      }

      console.log('[API] User logged in:', user.id, user.username);

      return NextResponse.json({
        success: true,
        data: { user },
      });
    }

    // Signup with username + password (optionally with wallet)
    if (action === 'signup') {
      if (!username || !password) {
        return NextResponse.json(
          { success: false, error: 'Username and password are required' },
          { status: 400 }
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

      // Validate password
      if (password.length < 6) {
        return NextResponse.json(
          { success: false, error: 'Password must be at least 6 characters' },
          { status: 400 }
        );
      }

      // If wallet provided, check it's not already linked
      if (wallet_address) {
        const existingUser = await getUserByWallet(wallet_address);
        if (existingUser) {
          return NextResponse.json(
            { success: false, error: 'Wallet already linked to another account' },
            { status: 409 }
          );
        }
      }

      const user = await createUser({
        username,
        password,
        wallet_address: wallet_address || undefined,
      });

      console.log('[API] User created:', user.id, user.username);

      return NextResponse.json({
        success: true,
        data: { user },
      });
    }

    // Login with wallet (if wallet is already linked to an account)
    if (action === 'wallet_login') {
      if (!wallet_address) {
        return NextResponse.json(
          { success: false, error: 'Wallet address is required' },
          { status: 400 }
        );
      }

      const user = await getUserByWallet(wallet_address);
      if (!user) {
        return NextResponse.json(
          { success: false, error: 'No account linked to this wallet. Please sign up first.' },
          { status: 404 }
        );
      }

      console.log('[API] User logged in via wallet:', user.id, user.username);

      return NextResponse.json({
        success: true,
        data: { user },
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
 * PATCH /api/auth/user
 * Update user: link wallet, change username, change password
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id, action, wallet_address, new_username, current_password, new_password } = body;

    if (!user_id) {
      return NextResponse.json(
        { success: false, error: 'user_id is required' },
        { status: 400 }
      );
    }

    // Link wallet to account
    if (action === 'link_wallet') {
      if (!wallet_address) {
        return NextResponse.json(
          { success: false, error: 'wallet_address is required' },
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

      try {
        const user = await linkWalletToUser(user_id, wallet_address);
        if (!user) {
          return NextResponse.json(
            { success: false, error: 'User not found' },
            { status: 404 }
          );
        }

        console.log('[API] Wallet linked to user:', user_id, wallet_address);

        return NextResponse.json({
          success: true,
          data: { user },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to link wallet';
        return NextResponse.json(
          { success: false, error: message },
          { status: 409 }
        );
      }
    }

    // Change username
    if (action === 'change_username') {
      if (!new_username) {
        return NextResponse.json(
          { success: false, error: 'new_username is required' },
          { status: 400 }
        );
      }

      // Validate username
      if (new_username.length < 3 || new_username.length > 20) {
        return NextResponse.json(
          { success: false, error: 'Username must be 3-20 characters' },
          { status: 400 }
        );
      }

      if (!/^[a-zA-Z0-9_]+$/.test(new_username)) {
        return NextResponse.json(
          { success: false, error: 'Username can only contain letters, numbers, and underscores' },
          { status: 400 }
        );
      }

      try {
        const user = await updateUsername(user_id, new_username);
        if (!user) {
          return NextResponse.json(
            { success: false, error: 'User not found' },
            { status: 404 }
          );
        }

        console.log('[API] Username changed:', user_id, new_username);

        return NextResponse.json({
          success: true,
          data: { user },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to change username';
        return NextResponse.json(
          { success: false, error: message },
          { status: 409 }
        );
      }
    }

    // Change password
    if (action === 'change_password') {
      if (!current_password || !new_password) {
        return NextResponse.json(
          { success: false, error: 'current_password and new_password are required' },
          { status: 400 }
        );
      }

      if (new_password.length < 6) {
        return NextResponse.json(
          { success: false, error: 'New password must be at least 6 characters' },
          { status: 400 }
        );
      }

      const success = await updatePassword(user_id, current_password, new_password);
      if (!success) {
        return NextResponse.json(
          { success: false, error: 'Current password is incorrect' },
          { status: 401 }
        );
      }

      console.log('[API] Password changed for user:', user_id);

      return NextResponse.json({
        success: true,
        data: { message: 'Password changed successfully' },
      });
    }

    // Default: link wallet (backwards compatibility)
    if (wallet_address) {
      // Validate wallet address format (Solana base58)
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet_address)) {
        return NextResponse.json(
          { success: false, error: 'Invalid Solana wallet address format' },
          { status: 400 }
        );
      }

      try {
        const user = await linkWalletToUser(user_id, wallet_address);
        if (!user) {
          return NextResponse.json(
            { success: false, error: 'User not found' },
            { status: 404 }
          );
        }

        console.log('[API] Wallet linked to user:', user_id, wallet_address);

        return NextResponse.json({
          success: true,
          data: { user_id, wallet_address },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to link wallet';
        return NextResponse.json(
          { success: false, error: message },
          { status: 409 }
        );
      }
    }

    return NextResponse.json(
      { success: false, error: 'Invalid action or missing parameters' },
      { status: 400 }
    );
  } catch (error) {
    console.error('User update error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update user', details: error instanceof Error ? error.message : String(error) },
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
