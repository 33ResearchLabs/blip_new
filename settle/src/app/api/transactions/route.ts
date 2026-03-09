import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { successResponse, errorResponse } from '@/lib/middleware/auth';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

// Normalize 12-state status to 8-state minimal
const STATUS_MAP: Record<string, string> = {
  pending: 'open',
  accepted: 'accepted',
  escrow_pending: 'accepted',
  escrowed: 'escrowed',
  payment_pending: 'escrowed',
  payment_sent: 'payment_sent',
  payment_confirmed: 'payment_sent',
  releasing: 'completed',
  completed: 'completed',
  cancelled: 'cancelled',
  disputed: 'disputed',
  expired: 'expired',
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Order Created',
  accepted: 'Order Accepted',
  escrowed: 'Escrow Locked',
  payment_sent: 'Payment Sent',
  completed: 'Trade Completed',
  cancelled: 'Order Cancelled',
  disputed: 'Dispute Opened',
  expired: 'Order Expired',
};

const TYPE_LABELS: Record<string, string> = {
  trade_intent: 'Trade Intent',
  escrow_lock: 'Escrow Lock',
  escrow_release: 'Escrow Release',
  escrow_refund: 'Escrow Refund',
  order_completed: 'Order Completed',
  order_cancelled: 'Order Cancelled',
  fee_deduction: 'Fee Deduction',
  synthetic_conversion: 'Synthetic Conversion',
  manual_adjustment: 'Manual Adjustment',
};

interface UnifiedTransaction {
  id: string;
  source: 'order' | 'onchain' | 'inapp';
  timestamp: string;
  order_id: string | null;
  order_number: string | null;
  status: string | null;
  amount: number;
  fiat_amount: number | null;
  crypto_currency: string | null;
  fiat_currency: string | null;
  type: string;
  type_label: string;
  description: string;
  tx_hash: string | null;
  tx_type: 'escrow' | 'release' | 'refund' | null;
  escrow_trade_pda: string | null;
  escrow_creator_wallet: string | null;
  balance_before: number | null;
  balance_after: number | null;
  rate: number | null;
  order_type: string | null;
  payment_method: string | null;
  counterparty: string | null;
  seller_name: string | null;
  buyer_name: string | null;
  // Admin timeline fields
  expires_at: string | null;
  accepted_at: string | null;
  escrowed_at: string | null;
  payment_sent_at: string | null;
  created_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const merchantId = searchParams.get('merchant_id'); // optional — if omitted, show ALL orders (admin)
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');
    const tab = searchParams.get('tab') || 'all';
    const statusFilter = searchParams.get('status') || '';
    const search = searchParams.get('search') || '';

    // --- Summary query (all orders or scoped to merchant) ---
    const merchantFilter = merchantId
      ? 'WHERE merchant_id = $1 OR buyer_merchant_id = $1'
      : '';
    const summaryParams = merchantId ? [merchantId] : [];

    const summaryRows = await query<{
      total_volume: string;
      completed_count: string;
      in_escrow_amount: string;
      disputed_count: string;
      total_orders: string;
    }>(
      `SELECT
        COALESCE(SUM(CASE WHEN status = 'completed' THEN crypto_amount ELSE 0 END), 0) as total_volume,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count,
        COALESCE(SUM(CASE WHEN status IN ('escrowed', 'payment_pending', 'payment_sent', 'payment_confirmed') THEN crypto_amount ELSE 0 END), 0) as in_escrow_amount,
        COUNT(CASE WHEN status = 'disputed' THEN 1 END) as disputed_count,
        COUNT(*) as total_orders
      FROM orders
      ${merchantFilter}`,
      summaryParams
    );

    const summary = {
      total_volume: parseFloat(summaryRows[0]?.total_volume || '0'),
      completed_count: parseInt(summaryRows[0]?.completed_count || '0'),
      in_escrow_amount: parseFloat(summaryRows[0]?.in_escrow_amount || '0'),
      disputed_count: parseInt(summaryRows[0]?.disputed_count || '0'),
      total_orders: parseInt(summaryRows[0]?.total_orders || '0'),
    };

    // --- Build unified results ---
    const transactions: UnifiedTransaction[] = [];

    // ========================
    // ALL ORDERS (main view)
    // ========================
    if (tab === 'all' || tab === 'orders' || tab === 'onchain' || tab === 'disputed') {
      const params: (string | number)[] = [];
      const conditions: string[] = [];
      let paramIdx = 1;

      // Merchant scope (optional)
      if (merchantId) {
        conditions.push(`(o.merchant_id = $${paramIdx} OR o.buyer_merchant_id = $${paramIdx})`);
        params.push(merchantId);
        paramIdx++;
      }

      if (statusFilter) {
        const matchingStatuses = Object.entries(STATUS_MAP)
          .filter(([, v]) => v === statusFilter)
          .map(([k]) => k);
        if (matchingStatuses.length > 0) {
          conditions.push(`o.status = ANY($${paramIdx}::text[])`);
          params.push(`{${matchingStatuses.join(',')}}`);
          paramIdx++;
        } else {
          conditions.push('FALSE');
        }
      }
      if (search) {
        conditions.push(`(o.order_number ILIKE $${paramIdx} OR o.escrow_tx_hash ILIKE $${paramIdx} OR o.release_tx_hash ILIKE $${paramIdx} OR o.refund_tx_hash ILIKE $${paramIdx} OR u.username ILIKE $${paramIdx} OR m_seller.display_name ILIKE $${paramIdx} OR m_buyer.display_name ILIKE $${paramIdx})`);
        params.push(`%${search}%`);
        paramIdx++;
      }
      if (tab === 'disputed') {
        conditions.push("o.status = 'disputed'");
      }
      if (tab === 'onchain') {
        conditions.push("(o.escrow_tx_hash IS NOT NULL OR o.release_tx_hash IS NOT NULL OR o.refund_tx_hash IS NOT NULL)");
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const orderRows = await query<{
        id: string;
        order_number: string;
        status: string;
        type: string;
        crypto_amount: string;
        fiat_amount: string;
        crypto_currency: string;
        fiat_currency: string;
        rate: string;
        payment_method: string;
        escrow_tx_hash: string | null;
        release_tx_hash: string | null;
        refund_tx_hash: string | null;
        escrow_trade_pda: string | null;
        escrow_creator_wallet: string | null;
        created_at: string;
        accepted_at: string | null;
        escrowed_at: string | null;
        payment_sent_at: string | null;
        completed_at: string | null;
        cancelled_at: string | null;
        expires_at: string | null;
        merchant_id: string;
        buyer_merchant_id: string | null;
        seller_name: string | null;
        buyer_merchant_name: string | null;
        user_name: string | null;
        user_display_name: string | null;
      }>(
        `SELECT
          o.id, o.order_number, o.status, o.type,
          o.crypto_amount, o.fiat_amount, o.crypto_currency, o.fiat_currency,
          o.rate, o.payment_method,
          o.escrow_tx_hash, o.release_tx_hash, o.refund_tx_hash,
          o.escrow_trade_pda, o.escrow_creator_wallet,
          o.created_at, o.accepted_at, o.escrowed_at, o.payment_sent_at,
          o.completed_at, o.cancelled_at, o.expires_at,
          o.merchant_id, o.buyer_merchant_id,
          m_seller.display_name as seller_name,
          m_buyer.display_name as buyer_merchant_name,
          u.username as user_name,
          u.name as user_display_name
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        LEFT JOIN merchants m_seller ON o.merchant_id = m_seller.id
        LEFT JOIN merchants m_buyer ON o.buyer_merchant_id = m_buyer.id
        ${whereClause}
        ORDER BY o.created_at DESC`,
        params
      );

      for (const row of orderRows) {
        const minStatus = STATUS_MAP[row.status] || row.status;
        // Pick the most recent timestamp (not just first non-null)
        const allTimestamps = [row.completed_at, row.cancelled_at, row.payment_sent_at, row.escrowed_at, row.accepted_at, row.created_at].filter(Boolean);
        const latestTimestamp = allTimestamps.length > 1
          ? new Date(Math.max(...allTimestamps.map(t => new Date(t!).getTime()))).toISOString()
          : (allTimestamps[0] || row.created_at);

        // Resolve clean names — never show open_order_* or m2m_* placeholders
        const sellerName = row.seller_name || 'Unknown Seller';
        const isPlaceholderUser = row.user_name?.startsWith('open_order_') || row.user_name?.startsWith('m2m_');
        let buyerName: string;
        if (row.buyer_merchant_name) {
          buyerName = row.buyer_merchant_name; // M2M: buyer merchant display name
        } else if (!isPlaceholderUser && row.user_display_name && row.user_display_name !== 'Open Order' && row.user_display_name !== 'M2M Trade') {
          buyerName = row.user_display_name; // Real user display name
        } else if (!isPlaceholderUser && row.user_name) {
          buyerName = row.user_name; // Real username
        } else {
          buyerName = 'Waiting...'; // Unmatched open order
        }

        const timelineFields = {
          expires_at: row.expires_at,
          accepted_at: row.accepted_at,
          escrowed_at: row.escrowed_at,
          payment_sent_at: row.payment_sent_at,
          created_at: row.created_at,
          completed_at: row.completed_at,
          cancelled_at: row.cancelled_at,
        };

        // Main order event — skip for onchain-only tab
        if (tab !== 'onchain') {
          transactions.push({
            id: row.id + '_order',
            source: 'order',
            timestamp: latestTimestamp,
            order_id: row.id,
            order_number: row.order_number,
            status: minStatus,
            amount: parseFloat(row.crypto_amount),
            fiat_amount: parseFloat(row.fiat_amount),
            crypto_currency: row.crypto_currency,
            fiat_currency: row.fiat_currency,
            type: `order_${minStatus}`,
            type_label: STATUS_LABELS[minStatus] || minStatus,
            description: `${parseFloat(row.crypto_amount)} ${row.crypto_currency || 'USDC'} ${row.type} — ${sellerName} ↔ ${buyerName}`,
            tx_hash: null,
            tx_type: null,
            escrow_trade_pda: row.escrow_trade_pda,
            escrow_creator_wallet: row.escrow_creator_wallet,
            balance_before: null,
            balance_after: null,
            rate: parseFloat(row.rate),
            order_type: row.type,
            payment_method: row.payment_method,
            counterparty: buyerName,
            seller_name: sellerName,
            buyer_name: buyerName,
            ...timelineFields,
          });
        }

        // On-chain sub-events — skip for orders-only tab
        if (tab !== 'orders' && row.escrow_tx_hash) {
          // Distinguish trade intent (BUY, no funds locked) from actual escrow lock (SELL)
          const isTradeIntent = !row.escrowed_at || row.status === 'pending';
          const escrowType = isTradeIntent ? 'trade_intent' : 'escrow_lock';
          const escrowLabel = isTradeIntent ? 'Trade Intent' : 'Escrow Lock';
          const escrowDesc = isTradeIntent
            ? `Signed intent for ${parseFloat(row.crypto_amount)} ${row.crypto_currency || 'USDC'} #${row.order_number}`
            : `Locked ${parseFloat(row.crypto_amount)} ${row.crypto_currency || 'USDC'} for #${row.order_number}`;

          transactions.push({
            id: row.id + '_escrow',
            source: 'onchain',
            timestamp: row.escrowed_at || row.created_at,
            order_id: row.id,
            order_number: row.order_number,
            status: minStatus,
            amount: parseFloat(row.crypto_amount),
            fiat_amount: parseFloat(row.fiat_amount),
            crypto_currency: row.crypto_currency,
            fiat_currency: row.fiat_currency,
            type: escrowType,
            type_label: escrowLabel,
            description: escrowDesc,
            tx_hash: row.escrow_tx_hash,
            tx_type: 'escrow',
            escrow_trade_pda: row.escrow_trade_pda,
            escrow_creator_wallet: row.escrow_creator_wallet,
            balance_before: null,
            balance_after: null,
            rate: parseFloat(row.rate),
            order_type: row.type,
            payment_method: row.payment_method,
            counterparty: buyerName,
            seller_name: sellerName,
            buyer_name: buyerName,
            ...timelineFields,
          });
        }
        if (tab !== 'orders' && row.release_tx_hash) {
          transactions.push({
            id: row.id + '_release',
            source: 'onchain',
            timestamp: row.completed_at || row.created_at,
            order_id: row.id,
            order_number: row.order_number,
            status: minStatus,
            amount: parseFloat(row.crypto_amount),
            fiat_amount: parseFloat(row.fiat_amount),
            crypto_currency: row.crypto_currency,
            fiat_currency: row.fiat_currency,
            type: 'escrow_release',
            type_label: 'Escrow Release',
            description: `Released ${parseFloat(row.crypto_amount)} ${row.crypto_currency || 'USDC'} for #${row.order_number}`,
            tx_hash: row.release_tx_hash,
            tx_type: 'release',
            escrow_trade_pda: row.escrow_trade_pda,
            escrow_creator_wallet: row.escrow_creator_wallet,
            balance_before: null,
            balance_after: null,
            rate: parseFloat(row.rate),
            order_type: row.type,
            payment_method: row.payment_method,
            counterparty: buyerName,
            seller_name: sellerName,
            buyer_name: buyerName,
            ...timelineFields,
          });
        }
        if (tab !== 'orders' && row.refund_tx_hash) {
          transactions.push({
            id: row.id + '_refund',
            source: 'onchain',
            timestamp: row.cancelled_at || row.created_at,
            order_id: row.id,
            order_number: row.order_number,
            status: minStatus,
            amount: parseFloat(row.crypto_amount),
            fiat_amount: parseFloat(row.fiat_amount),
            crypto_currency: row.crypto_currency,
            fiat_currency: row.fiat_currency,
            type: 'escrow_refund',
            type_label: 'Escrow Refund',
            description: `Refunded ${parseFloat(row.crypto_amount)} ${row.crypto_currency || 'USDC'} for #${row.order_number}`,
            tx_hash: row.refund_tx_hash,
            tx_type: 'refund',
            escrow_trade_pda: row.escrow_trade_pda,
            escrow_creator_wallet: row.escrow_creator_wallet,
            balance_before: null,
            balance_after: null,
            rate: parseFloat(row.rate),
            order_type: row.type,
            payment_method: row.payment_method,
            counterparty: buyerName,
            seller_name: sellerName,
            buyer_name: buyerName,
            ...timelineFields,
          });
        }
      }
    }

    // ========================
    // IN-APP BALANCE CHANGES (only when merchant_id is specified)
    // ========================
    if (merchantId && (tab === 'all' || tab === 'inapp')) {
      const inappParams: (string | number)[] = [merchantId];
      const inappConditions: string[] = [];
      let inappIdx = 2;

      if (statusFilter) {
        inappConditions.push(`AND mt.type = $${inappIdx}`);
        inappParams.push(statusFilter);
        inappIdx++;
      }
      if (search) {
        inappConditions.push(`AND (mt.description ILIKE $${inappIdx} OR o.order_number ILIKE $${inappIdx})`);
        inappParams.push(`%${search}%`);
        inappIdx++;
      }

      const inappRows = await query<{
        id: string;
        order_id: string | null;
        order_number: string | null;
        order_status: string | null;
        type: string;
        amount: string;
        balance_before: string;
        balance_after: string;
        description: string;
        created_at: string;
        fiat_amount: string | null;
        fiat_currency: string | null;
        crypto_currency: string | null;
        rate: string | null;
      }>(
        `SELECT
          mt.id, mt.order_id,
          o.order_number, o.status as order_status,
          mt.type, mt.amount, mt.balance_before, mt.balance_after,
          mt.description, mt.created_at,
          o.fiat_amount, o.fiat_currency, o.crypto_currency, o.rate
        FROM merchant_transactions mt
        LEFT JOIN orders o ON mt.order_id = o.id
        WHERE mt.merchant_id = $1
          ${inappConditions.join(' ')}
        ORDER BY mt.created_at DESC`,
        inappParams
      );

      for (const row of inappRows) {
        transactions.push({
          id: row.id,
          source: 'inapp',
          timestamp: row.created_at,
          order_id: row.order_id,
          order_number: row.order_number,
          status: row.order_status ? (STATUS_MAP[row.order_status] || row.order_status) : null,
          amount: parseFloat(row.amount),
          fiat_amount: row.fiat_amount ? parseFloat(row.fiat_amount) : null,
          crypto_currency: row.crypto_currency || 'USDT',
          fiat_currency: row.fiat_currency || 'AED',
          type: row.type,
          type_label: TYPE_LABELS[row.type] || row.type,
          description: row.description,
          tx_hash: null,
          tx_type: null,
          escrow_trade_pda: null,
          escrow_creator_wallet: null,
          balance_before: parseFloat(row.balance_before),
          balance_after: parseFloat(row.balance_after),
          rate: row.rate ? parseFloat(row.rate) : null,
          order_type: null,
          payment_method: null,
          counterparty: null,
          seller_name: null,
          buyer_name: null,
          expires_at: null,
          accepted_at: null,
          escrowed_at: null,
          payment_sent_at: null,
          created_at: row.created_at,
          completed_at: null,
          cancelled_at: null,
        });
      }
    }

    // Sort all by timestamp desc
    transactions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Paginate
    const total = transactions.length;
    const paginated = transactions.slice(offset, offset + limit);

    logger.api.request('GET', '/api/transactions');
    return successResponse({ summary, transactions: paginated, total });
  } catch (error) {
    logger.api.error('GET', '/api/transactions', error as Error);
    return errorResponse('Internal server error');
  }
}
