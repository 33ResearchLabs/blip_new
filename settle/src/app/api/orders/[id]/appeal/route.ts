import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { proxyCoreApi } from '@/lib/proxy/coreApi';
import { requireAuth, requireApiKeyScope, canAccessOrder, forbiddenResponse } from '@/lib/middleware/auth';
import { checkRateLimit, STRICT_LIMIT } from '@/lib/middleware/rateLimit';
import { validateFields } from '@/lib/middleware/validation';
import { getOrderWithRelations } from '@/lib/db/repositories/orders';
import { resolveTradeRole } from '@/lib/orders/handleOrderAction';
import { normalizeStatus } from '@/lib/orders/statusNormalizer';
import { getIdempotencyKey, requireIdempotencyKey } from '@/lib/idempotency';
import { getAppealIssue } from '@/lib/appeals/issues';
import { notifyNewMessage } from '@/lib/pusher/server';
import { wsBroadcastNewMessage } from '@/lib/websocket/broadcast';
import { logger } from 'settlement-core';

// Statuses on which an appeal may be opened — visible once the order is accepted.
const APPEAL_OPEN_STATUSES = ['accepted', 'escrowed', 'payment_sent'];

// Open an appeal for an order (peer-resolution stage before a dispute).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Rate limit: 10 appeal operations per minute (matches dispute).
  const rateLimitResponse = await checkRateLimit(request, 'appeal:create', STRICT_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id: orderId } = await params;
    const body = await request.json();

    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const scopeErr = requireApiKeyScope(auth, 'orders:write');
    if (scopeErr) return scopeErr;

    // Idempotency-Key required (opening an appeal pauses timers + notifies the
    // counterparty). Settle forwards the key; core-api commits it atomically.
    const missingKey = requireIdempotencyKey(request);
    if (missingKey) return missingKey;

    const canAccess = await canAccessOrder(auth, orderId);
    if (!canAccess) {
      return forbiddenResponse('You do not have access to this order');
    }

    const { issue_key, description, initiated_by, user_id, merchant_id } = body;

    if (!issue_key) {
      return NextResponse.json(
        { success: false, error: 'issue_key is required' },
        { status: 400 }
      );
    }

    const issue = getAppealIssue(issue_key);
    if (!issue || issue.systemOnly) {
      return NextResponse.json(
        { success: false, error: 'Unknown appeal issue', code: 'INVALID_ISSUE' },
        { status: 400 }
      );
    }

    const lengthError = validateFields([[description, 'description']]);
    if (lengthError) {
      return NextResponse.json({ success: false, error: lengthError }, { status: 400 });
    }

    if (!initiated_by || !['user', 'merchant'].includes(initiated_by)) {
      return NextResponse.json(
        { success: false, error: 'initiated_by must be user or merchant' },
        { status: 400 }
      );
    }

    const actorId = initiated_by === 'user' ? (user_id || '') : (merchant_id || '');

    // Security: actor must match the authenticated identity (JWT only).
    if (actorId !== auth.actorId) {
      return forbiddenResponse('actor_id does not match authenticated identity');
    }
    if (initiated_by === 'merchant' && auth.actorType !== 'merchant') {
      return forbiddenResponse("initiated_by='merchant' requires a merchant token");
    }

    // ── STATUS + ROLE VALIDATION ──
    const appealOrder = await getOrderWithRelations(orderId);
    if (!appealOrder) {
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 }
      );
    }

    const minimalStatus = normalizeStatus(appealOrder.status);
    if (!APPEAL_OPEN_STATUSES.includes(minimalStatus)) {
      return NextResponse.json(
        {
          success: false,
          error: `Cannot open an appeal from status '${minimalStatus}'. Appeals are available once an order is accepted (accepted, escrowed, or payment_sent).`,
          code: 'INVALID_STATUS_FOR_APPEAL',
        },
        { status: 400 }
      );
    }

    const role = resolveTradeRole(appealOrder, actorId);
    if (role !== 'buyer' && role !== 'seller') {
      return NextResponse.json(
        { success: false, error: 'Only the buyer or seller can open an appeal.', code: 'NOT_PARTICIPANT' },
        { status: 403 }
      );
    }

    const idempotencyKey = getIdempotencyKey(request);
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Idempotency-Key header is required for opening an appeal.' },
        { status: 400 }
      );
    }

    logger.info('[Appeal] Opening', { orderId, issueKey: issue_key, role });

    const resp = await proxyCoreApi(`/v1/orders/${orderId}/appeal`, {
      method: 'POST',
      body: {
        issue_key,
        issue_group: issue.group,
        issue_label: issue.label,
        opener_role: role,
        description,
        initiated_by,
        actor_id: actorId,
      },
      actorType: initiated_by,
      actorId,
      idempotencyKey,
    });

    // Best-effort live chat broadcast: push the system "appeal raised" message
    // over Pusher so it appears instantly in an open chat and on the
    // counterparty's private channel. Never fail the request on a broadcast error.
    try {
      const json = await resp.clone().json();
      if (json?.success && json?.chatMessage) {
        const cm = json.chatMessage as {
          id: string;
          sender_id: string | null;
          content: string;
          created_at: string;
        };
        const createdAtIso =
          typeof cm.created_at === 'string'
            ? cm.created_at
            : new Date(cm.created_at).toISOString();
        // Pusher path (prod / non-WS clients). messageType is 'text' to match the
        // stored row (see core-api note) — a system-sender 'text' message renders
        // as a system pill and isn't filtered out of the chat history fetch.
        await notifyNewMessage({
          orderId,
          messageId: cm.id,
          senderType: 'system',
          senderId: cm.sender_id ?? orderId,
          content: cm.content || '',
          messageType: 'text',
          createdAt: createdAtIso,
          userId: appealOrder.user_id,
          merchantId: appealOrder.merchant_id,
          buyerMerchantId: appealOrder.buyer_merchant_id ?? null,
          clientId: null,
          seq: null,
        });
        // Custom WS server path (localhost / WS-connected clients). The chat
        // client dedupes by message id, so firing both transports is safe. This
        // is what makes the system message appear live in an open chat — the
        // message was inserted via SQL in core-api and never went through the
        // WS server's own send path.
        wsBroadcastNewMessage({
          orderId,
          messageId: cm.id,
          senderType: 'system',
          senderId: cm.sender_id ?? orderId,
          senderName: 'System',
          content: cm.content || '',
          messageType: 'text',
          createdAt: createdAtIso,
        });
      }
    } catch (broadcastErr) {
      logger.warn('[Appeal] live chat broadcast failed (non-fatal)', {
        orderId,
        error: broadcastErr instanceof Error ? broadcastErr.message : String(broadcastErr),
      });
    }

    return resp;
  } catch (error) {
    console.error('Failed to open appeal:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to open appeal' },
      { status: 500 }
    );
  }
}

// Get the current appeal for an order (read-only, stays local — no core-api proxy).
// Returns the latest appeal + its evidence + the viewer's trade role so the UI
// can render the correct actions. When no appeal exists, returns 200 with
// { appeal: null } rather than a 404 so the UI can poll cheaply.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const scopeErr = requireApiKeyScope(auth, 'orders:read');
    if (scopeErr) return scopeErr;

    const { id: orderId } = await params;

    const canAccess = await canAccessOrder(auth, orderId);
    if (!canAccess) {
      return forbiddenResponse('You do not have access to this order');
    }

    const appeals = await query<{
      id: string;
      order_id: string;
      opened_by: string;
      opener_id: string;
      issue_key: string;
      issue_group: string;
      description: string | null;
      status: string;
      proposed_resolution: string | null;
      proposed_by: string | null;
      proposed_at: string | null;
      appeal_deadline: string;
      resolved_at: string | null;
      escalated_at: string | null;
      created_at: string;
      updated_at: string;
      order_number: string | number | null;
      order_status: string;
    }>(
      `SELECT a.*, o.order_number, o.status AS order_status
       FROM appeals a
       JOIN orders o ON a.order_id = o.id
       WHERE a.order_id = $1
       ORDER BY a.created_at DESC
       LIMIT 1`,
      [orderId]
    );

    // Resolve the viewer's role (buyer/seller) so the UI knows which actions to show.
    let viewerRole: string | null = null;
    const order = await getOrderWithRelations(orderId);
    if (order && auth.actorId) {
      viewerRole = resolveTradeRole(order, auth.actorId);
    }

    if (appeals.length === 0) {
      return NextResponse.json({
        success: true,
        data: { appeal: null, evidence: [], viewerRole },
      });
    }

    const appeal = appeals[0];

    const evidence = await query<{
      id: string;
      uploaded_by: string;
      actor_id: string;
      cloudinary_url: string;
      public_id: string | null;
      created_at: string;
    }>(
      `SELECT id, uploaded_by, actor_id, cloudinary_url, public_id, created_at
       FROM appeal_evidence
       WHERE appeal_id = $1
       ORDER BY created_at ASC`,
      [appeal.id]
    );

    return NextResponse.json({
      success: true,
      data: { appeal, evidence, viewerRole },
    });
  } catch (error) {
    console.error('Failed to get appeal:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get appeal' },
      { status: 500 }
    );
  }
}

// Respond to / resolve an active appeal.
//   action: 'propose' → record a standing resolution (resolution: complete|mutual_cancel).
//           'accept'  → execute it: complete = seller releases crypto to the buyer
//                       (MOCK credits the buyer; real mode returns releaseRequired so the
//                       seller signs on-chain); mutual_cancel = cancel + refund seller.
//           'agree'   → back-compat: accept the opener's mutual_cancel appeal.
//           'reject'  → escalate to a formal dispute (order → disputed).
// Identity is taken ONLY from the verified JWT (the body's actor is advisory and
// can go stale — same rationale as the cancel-request respond path). Mutations
// are proxied to core-api, which owns the state machine + escrow refund/release.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResponse = await checkRateLimit(request, 'appeal:respond', STRICT_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id: orderId } = await params;
    const body = await request.json();

    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const scopeErr = requireApiKeyScope(auth, 'orders:write');
    if (scopeErr) return scopeErr;

    if (auth.actorType !== 'user' && auth.actorType !== 'merchant') {
      return forbiddenResponse('Only a user or merchant can respond to an appeal');
    }

    const action = body?.action;
    if (!['propose', 'accept', 'agree', 'reject', 'withdraw'].includes(action)) {
      return NextResponse.json(
        { success: false, error: "action must be 'propose', 'accept', 'agree', 'reject' or 'withdraw'" },
        { status: 400 }
      );
    }
    const resolution = body?.resolution;
    if (resolution !== undefined && resolution !== 'complete' && resolution !== 'mutual_cancel') {
      return NextResponse.json(
        { success: false, error: "resolution must be 'complete' or 'mutual_cancel'" },
        { status: 400 }
      );
    }
    if (action === 'propose' && !resolution) {
      return NextResponse.json(
        { success: false, error: 'resolution is required to propose' },
        { status: 400 }
      );
    }

    // Idempotency-Key required — responding agrees-and-refunds or escalates to a
    // dispute. core-api commits the idempotency record atomically with the mutation.
    const missingKey = requireIdempotencyKey(request);
    if (missingKey) return missingKey;
    const idempotencyKey = getIdempotencyKey(request);
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Idempotency-Key header is required for responding to an appeal.' },
        { status: 400 }
      );
    }

    const canAccess = await canAccessOrder(auth, orderId);
    if (!canAccess) {
      return forbiddenResponse('You do not have access to this order');
    }

    logger.info('[Appeal] Responding', { orderId, action });

    const resp = await proxyCoreApi(`/v1/orders/${orderId}/appeal`, {
      method: 'PUT',
      body: { action, resolution, actor_type: auth.actorType, actor_id: auth.actorId },
      actorType: auth.actorType,
      actorId: auth.actorId,
      idempotencyKey,
    });

    // Best-effort live chat broadcast of the system message (cancelled/disputed),
    // mirroring the open handler. Never fail the request on a broadcast error.
    try {
      const json = await resp.clone().json();
      if (json?.success && json?.chatMessage) {
        const order = await getOrderWithRelations(orderId);
        if (order) {
          const cm = json.chatMessage as {
            id: string;
            sender_id: string | null;
            content: string;
            created_at: string;
          };
          const createdAtIso =
            typeof cm.created_at === 'string' ? cm.created_at : new Date(cm.created_at).toISOString();
          await notifyNewMessage({
            orderId,
            messageId: cm.id,
            senderType: 'system',
            senderId: cm.sender_id ?? orderId,
            content: cm.content || '',
            messageType: 'text',
            createdAt: createdAtIso,
            userId: order.user_id,
            merchantId: order.merchant_id,
            buyerMerchantId: order.buyer_merchant_id ?? null,
            clientId: null,
            seq: null,
          });
          wsBroadcastNewMessage({
            orderId,
            messageId: cm.id,
            senderType: 'system',
            senderId: cm.sender_id ?? orderId,
            senderName: 'System',
            content: cm.content || '',
            messageType: 'text',
            createdAt: createdAtIso,
          });
        }
      }
    } catch (broadcastErr) {
      logger.warn('[Appeal] live chat broadcast failed (non-fatal)', {
        orderId,
        error: broadcastErr instanceof Error ? broadcastErr.message : String(broadcastErr),
      });
    }

    return resp;
  } catch (error) {
    console.error('Failed to respond to appeal:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to respond to appeal' },
      { status: 500 }
    );
  }
}
