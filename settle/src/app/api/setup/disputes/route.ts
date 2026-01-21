import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Setup endpoint to run migrations for disputes feature
export async function GET() {
  const results: string[] = [];

  try {
    // 1. Add confirmation columns to disputes table
    try {
      await query(`
        ALTER TABLE disputes
        ADD COLUMN IF NOT EXISTS proposed_resolution VARCHAR(50),
        ADD COLUMN IF NOT EXISTS proposed_by UUID,
        ADD COLUMN IF NOT EXISTS proposed_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS resolution_notes TEXT,
        ADD COLUMN IF NOT EXISTS user_confirmed BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS merchant_confirmed BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS split_percentage JSONB,
        ADD COLUMN IF NOT EXISTS assigned_to UUID
      `);
      results.push('✓ Added confirmation columns to disputes table');
    } catch (e) {
      results.push(`Note: Columns may already exist - ${e instanceof Error ? e.message : String(e)}`);
    }

    // 2. Create compliance_team table if not exists
    try {
      await query(`
        CREATE TABLE IF NOT EXISTS compliance_team (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          email VARCHAR(255) UNIQUE NOT NULL,
          name VARCHAR(255) NOT NULL,
          role VARCHAR(50) DEFAULT 'support',
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      results.push('✓ Created compliance_team table');
    } catch (e) {
      results.push(`Note: compliance_team - ${e instanceof Error ? e.message : String(e)}`);
    }

    // 3. Seed compliance members
    try {
      await query(`
        INSERT INTO compliance_team (email, name, role)
        VALUES
          ('support@settle.com', 'Support Agent', 'support'),
          ('compliance@settle.com', 'Compliance Officer', 'compliance'),
          ('admin@settle.com', 'Admin', 'admin')
        ON CONFLICT (email) DO NOTHING
      `);
      results.push('✓ Seeded compliance team members');
    } catch (e) {
      results.push(`Note: Seeding - ${e instanceof Error ? e.message : String(e)}`);
    }

    // 4. Create order_status_history table if not exists
    try {
      await query(`
        CREATE TABLE IF NOT EXISTS order_status_history (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
          previous_status VARCHAR(50),
          new_status VARCHAR(50) NOT NULL,
          actor_type VARCHAR(50),
          actor_id VARCHAR(255),
          metadata JSONB,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      results.push('✓ Created order_status_history table');
    } catch (e) {
      results.push(`Note: order_status_history - ${e instanceof Error ? e.message : String(e)}`);
    }

    // 5. Check disputes table structure
    const disputesCheck = await query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'disputes'
      ORDER BY ordinal_position
    `);
    results.push(`✓ Disputes table columns: ${(disputesCheck as { column_name: string }[]).map((c) => c.column_name).join(', ')}`);

    // 6. Check if we have the enums
    try {
      const enumCheck = await query(`
        SELECT enumlabel FROM pg_enum
        WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'dispute_reason')
      `);
      results.push(`✓ dispute_reason enum values: ${(enumCheck as { enumlabel: string }[]).map((e) => e.enumlabel).join(', ')}`);
    } catch (e) {
      results.push(`Note: enum check - ${e instanceof Error ? e.message : String(e)}`);
    }

    return NextResponse.json({
      success: true,
      message: 'Disputes setup complete',
      results,
    });
  } catch (error) {
    console.error('Setup failed:', error);
    return NextResponse.json({
      success: false,
      error: 'Setup failed',
      details: error instanceof Error ? error.message : String(error),
      results,
    }, { status: 500 });
  }
}
