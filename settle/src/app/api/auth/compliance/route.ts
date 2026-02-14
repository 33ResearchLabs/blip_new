import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { isComplianceWallet, addComplianceWallet, COMPLIANCE_WALLETS } from '@/lib/solana/v2/config';

// Compliance team authentication (supports both email/password and wallet)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, action, wallet_address } = body;

    // Wallet-based authentication (DAO/multi-sig style)
    if (action === 'wallet_login') {
      if (!wallet_address) {
        return NextResponse.json(
          { success: false, error: 'Wallet address is required' },
          { status: 400 }
        );
      }

      // Check if wallet is in the authorized compliance list
      if (!isComplianceWallet(wallet_address)) {
        return NextResponse.json(
          { success: false, error: 'Wallet not authorized for compliance access' },
          { status: 403 }
        );
      }

      // Ensure table exists with wallet_address column
      try {
        await query(`
          CREATE TABLE IF NOT EXISTS compliance_team (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email VARCHAR(255) UNIQUE,
            wallet_address VARCHAR(64) UNIQUE,
            name VARCHAR(255) NOT NULL,
            role VARCHAR(50) DEFAULT 'support',
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
          )
        `);

        // Try to add wallet_address column if it doesn't exist
        await query(`
          ALTER TABLE compliance_team
          ADD COLUMN IF NOT EXISTS wallet_address VARCHAR(64) UNIQUE
        `).catch(() => {});
      } catch (tableError) {
        console.error('Table setup error:', tableError);
      }

      // Check if wallet already has a compliance member record
      let rows = await query(
        `SELECT id, email, wallet_address, name, role, created_at
         FROM compliance_team
         WHERE wallet_address = $1 AND is_active = true`,
        [wallet_address]
      );

      // If no record exists, create one for this wallet
      if (rows.length === 0) {
        const shortWallet = `${wallet_address.slice(0, 4)}...${wallet_address.slice(-4)}`;
        await query(
          `INSERT INTO compliance_team (wallet_address, name, role)
           VALUES ($1, $2, 'compliance')
           ON CONFLICT (wallet_address) DO NOTHING`,
          [wallet_address, `DAO Member (${shortWallet})`]
        );

        rows = await query(
          `SELECT id, email, wallet_address, name, role, created_at
           FROM compliance_team
           WHERE wallet_address = $1 AND is_active = true`,
          [wallet_address]
        );
      }

      if (rows.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Failed to create compliance member' },
          { status: 500 }
        );
      }

      const member = rows[0] as { id: string; email: string | null; wallet_address: string; name: string; role: string };

      return NextResponse.json({
        success: true,
        data: {
          member: {
            id: member.id,
            email: member.email,
            wallet_address: member.wallet_address,
            name: member.name,
            role: member.role,
          },
          authMethod: 'wallet',
        },
      });
    }

    // Traditional email/password login
    if (action === 'login') {
      if (!email || !password) {
        return NextResponse.json(
          { success: false, error: 'Email and password are required' },
          { status: 400 }
        );
      }

      // Check if table exists, if not create it
      try {
        await query(`
          CREATE TABLE IF NOT EXISTS compliance_team (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email VARCHAR(255) UNIQUE,
            wallet_address VARCHAR(64) UNIQUE,
            name VARCHAR(255) NOT NULL,
            role VARCHAR(50) DEFAULT 'support',
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
          )
        `);

        // Seed default compliance members if table was just created
        await query(`
          INSERT INTO compliance_team (email, name, role)
          VALUES
            ('support@blip.money', 'Support Agent', 'support'),
            ('compliance@blip.money', 'Compliance Officer', 'compliance'),
            ('admin@blip.money', 'Admin', 'admin')
          ON CONFLICT (email) DO NOTHING
        `);
      } catch (tableError) {
        console.error('Table creation error:', tableError);
      }

      // Query compliance team member
      const rows = await query(
        `SELECT id, email, wallet_address, name, role, created_at
         FROM compliance_team
         WHERE email = $1 AND is_active = true`,
        [email]
      );

      if (rows.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Invalid credentials' },
          { status: 401 }
        );
      }

      const member = rows[0] as { id: string; email: string; wallet_address: string | null; name: string; role: string };

      // Compliance password from env vars (with dev fallback)
      const compliancePassword = process.env.COMPLIANCE_PASSWORD || 'compliance123';
      if (password !== compliancePassword) {
        return NextResponse.json(
          { success: false, error: 'Invalid credentials' },
          { status: 401 }
        );
      }

      return NextResponse.json({
        success: true,
        data: {
          member: {
            id: member.id,
            email: member.email,
            wallet_address: member.wallet_address,
            name: member.name,
            role: member.role,
          },
          authMethod: 'email',
        },
      });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid action' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Compliance auth error:', error);
    return NextResponse.json(
      { success: false, error: 'Authentication failed' },
      { status: 500 }
    );
  }
}

// Create compliance team table and seed data
export async function PUT() {
  try {
    // Create compliance_team table if not exists
    await query(`
      CREATE TABLE IF NOT EXISTS compliance_team (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE,
        wallet_address VARCHAR(64) UNIQUE,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'support',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Seed default compliance members
    await query(`
      INSERT INTO compliance_team (email, name, role)
      VALUES
        ('support@blip.money', 'Support Agent', 'support'),
        ('compliance@blip.money', 'Compliance Officer', 'compliance'),
        ('admin@blip.money', 'Admin', 'admin')
      ON CONFLICT (email) DO NOTHING
    `);

    return NextResponse.json({
      success: true,
      message: 'Compliance team table created and seeded',
    });
  } catch (error) {
    console.error('Compliance setup error:', error);
    return NextResponse.json(
      { success: false, error: 'Setup failed' },
      { status: 500 }
    );
  }
}

// GET - Get list of authorized compliance wallets (for client-side validation)
export async function GET() {
  return NextResponse.json({
    success: true,
    data: {
      wallets: COMPLIANCE_WALLETS.map(w => w.toBase58()),
      count: COMPLIANCE_WALLETS.length,
    },
  });
}

// PATCH - Add a new compliance wallet (admin only - requires existing compliance member)
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { wallet_address, admin_id, name } = body;

    if (!wallet_address || !admin_id) {
      return NextResponse.json(
        { success: false, error: 'wallet_address and admin_id are required' },
        { status: 400 }
      );
    }

    // Verify admin is an active compliance member with admin role
    const adminCheck = await query(
      `SELECT id, role FROM compliance_team WHERE id = $1 AND is_active = true AND role = 'admin'`,
      [admin_id]
    );

    if (adminCheck.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Admin authorization required' },
        { status: 403 }
      );
    }

    // Add wallet to runtime config
    addComplianceWallet(wallet_address);

    // Also add to database
    const shortWallet = `${wallet_address.slice(0, 4)}...${wallet_address.slice(-4)}`;
    await query(
      `INSERT INTO compliance_team (wallet_address, name, role)
       VALUES ($1, $2, 'compliance')
       ON CONFLICT (wallet_address) DO UPDATE SET is_active = true`,
      [wallet_address, name || `DAO Member (${shortWallet})`]
    );

    return NextResponse.json({
      success: true,
      message: 'Compliance wallet added',
      data: { wallet_address },
    });
  } catch (error) {
    console.error('Failed to add compliance wallet:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to add compliance wallet' },
      { status: 500 }
    );
  }
}
