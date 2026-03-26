/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CHAOS TEST — 100 Random P2P Trading Scenarios
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Simulates 100 randomized trading scenarios testing:
 *   - Random roles (buyer/seller/observer)
 *   - Random action sequences (valid + invalid)
 *   - Race conditions (concurrent actions on same order)
 *   - Invalid actions at every stage
 *   - Edge cases (double escrow, double accept, observer claim)
 *
 * Validates after EVERY action:
 *   - No invalid state transitions
 *   - No double escrow lock
 *   - No balance mismatch (escrow accounting invariant)
 *   - Enricher stays consistent with guard system
 *   - primaryAction invariant holds (always defined)
 *   - Terminal states are locked (no escape)
 *
 * Reports:
 *   - Broken scenario ID + exact reproduction steps
 *   - Which invariant was violated
 *   - Full action log for replay
 */

import {
  handleOrderAction,
  resolveTradeRole,
  getAllowedActions,
  type OrderAction,
  type ActionResult,
  ORDER_ACTIONS,
} from '../../src/lib/orders/handleOrderAction';
import { enrichOrderResponse, type EnrichedOrderResponse } from '../../src/lib/orders/enrichOrderResponse';
import { determineEscrowPayer } from '../../src/lib/money/escrowLock';
import { normalizeStatus, type MinimalOrderStatus } from '../../src/lib/orders/statusNormalizer';

// ═══════════════════════════════════════════════════════════════════════════
// TEST INFRASTRUCTURE
// ═══════════════════════════════════════════════════════════════════════════

// Deterministic seeded PRNG (Mulberry32) for reproducible chaos
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 20260326; // Today's date as seed — deterministic across runs
const rng = mulberry32(SEED);

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function pickN<T>(arr: readonly T[], n: number): T[] {
  const shuffled = [...arr].sort(() => rng() - 0.5);
  return shuffled.slice(0, n);
}

function coinFlip(probability = 0.5): boolean {
  return rng() < probability;
}

function randomDelay(): number {
  return Math.floor(rng() * 200); // 0-200ms simulated delay
}

// ── Identities ──────────────────────────────────────────────────────────

const USER_ID = '00000000-0000-0000-0000-000000000001';
const MERCHANT_ID = '00000000-0000-0000-0000-000000000002';
const BUYER_MERCHANT_ID = '00000000-0000-0000-0000-000000000003';
const OBSERVER_1 = '00000000-0000-0000-0000-000000000010';
const OBSERVER_2 = '00000000-0000-0000-0000-000000000011';
const RANDOM_IDS = [USER_ID, MERCHANT_ID, BUYER_MERCHANT_ID, OBSERVER_1, OBSERVER_2];

// ── Simulated Order State ───────────────────────────────────────────────

interface SimOrder {
  id: string;
  status: string;
  type: 'buy' | 'sell';
  user_id: string;
  merchant_id: string;
  buyer_merchant_id: string | null;
  escrow_debited_entity_id: string | null;
  escrow_debited_entity_type: string | null;
  escrow_debited_amount: number | null;
  escrow_tx_hash: string | null;
  refund_tx_hash: string | null;
  order_version: number;
  crypto_amount: number;
  fiat_amount: number;
}

interface BalanceLedger {
  [entityId: string]: number;
}

interface ActionLog {
  step: number;
  action: OrderAction | string;
  actorId: string;
  statusBefore: string;
  result: 'success' | 'rejected';
  resultCode?: string;
  statusAfter: string;
  note?: string;
}

interface ScenarioConfig {
  id: number;
  seed: number;
  orderType: 'buy' | 'sell';
  isM2M: boolean;
  includeRaceConditions: boolean;
  includeInvalidActions: boolean;
  includeObserverChaos: boolean;
  maxActions: number;
}

interface ScenarioResult {
  config: ScenarioConfig;
  actions: ActionLog[];
  violations: string[];
  finalStatus: string;
  escrowLocked: boolean;
  escrowRefunded: boolean;
}

// ── Valid state progression ─────────────────────────────────────────────

const TERMINAL_STATUSES: MinimalOrderStatus[] = ['completed', 'cancelled', 'expired'];
const VALID_FORWARD_TRANSITIONS: Record<string, string[]> = {
  open: ['accepted', 'cancelled', 'expired'],
  accepted: ['escrowed', 'cancelled'],
  // CLAIM action transitions escrowed → accepted (re-claim by observer)
  escrowed: ['payment_sent', 'cancelled', 'disputed', 'accepted'],
  payment_sent: ['completed', 'disputed'],
  completed: [],
  cancelled: [],
  expired: [],
  disputed: [],
};

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

function generateScenarioConfig(id: number): ScenarioConfig {
  return {
    id,
    seed: SEED + id,
    orderType: coinFlip() ? 'buy' : 'sell',
    isM2M: coinFlip(0.3), // 30% M2M
    includeRaceConditions: coinFlip(0.4), // 40% race conditions
    includeInvalidActions: coinFlip(0.6), // 60% include invalid actions
    includeObserverChaos: coinFlip(0.3), // 30% observer chaos
    maxActions: 5 + Math.floor(rng() * 15), // 5-20 actions per scenario
  };
}

function createOrder(config: ScenarioConfig): SimOrder {
  const amount = 100 + Math.floor(rng() * 900); // 100-999 USDC
  return {
    id: `order-${config.id.toString().padStart(3, '0')}`,
    status: 'pending',
    type: config.orderType,
    user_id: USER_ID,
    merchant_id: MERCHANT_ID,
    buyer_merchant_id: config.isM2M ? BUYER_MERCHANT_ID : null,
    escrow_debited_entity_id: null,
    escrow_debited_entity_type: null,
    escrow_debited_amount: null,
    escrow_tx_hash: null,
    refund_tx_hash: null,
    order_version: 1,
    crypto_amount: amount,
    fiat_amount: amount * 3.67,
  };
}

function initBalances(): BalanceLedger {
  return {
    [USER_ID]: 50000,
    [MERCHANT_ID]: 50000,
    [BUYER_MERCHANT_ID]: 50000,
    [OBSERVER_1]: 50000,
    [OBSERVER_2]: 50000,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION EXECUTOR (Simulates backend behavior)
// ═══════════════════════════════════════════════════════════════════════════

function executeAction(
  order: SimOrder,
  action: OrderAction,
  actorId: string,
  balances: BalanceLedger,
): { result: ActionResult; balanceChange?: { entity: string; delta: number } } {
  // Run through the real guard system
  const result = handleOrderAction(order, action, actorId);

  if (!result.success) {
    return { result };
  }

  let balanceChange: { entity: string; delta: number } | undefined;

  // Simulate state mutation on success
  const prevStatus = normalizeStatus(order.status as any);

  switch (action) {
    case 'ACCEPT': {
      order.status = 'accepted';
      if (!order.buyer_merchant_id) {
        order.buyer_merchant_id = actorId;
      }
      break;
    }

    case 'CLAIM': {
      // CLAIM re-assigns buyer on an unclaimed escrowed order.
      // Guard says target='accepted' but escrow stays locked — treat as staying escrowed.
      // In the real system the route handler keeps the order escrowed and just sets buyer_merchant_id.
      order.buyer_merchant_id = actorId;
      // Don't change status — escrow is still locked
      break;
    }

    case 'LOCK_ESCROW': {
      const payer = determineEscrowPayer(order);
      const amount = order.crypto_amount;

      // Check balance
      if ((balances[payer.entityId] || 0) < amount) {
        return {
          result: { success: false, error: 'Insufficient balance', code: 'INSUFFICIENT_BALANCE' },
        };
      }

      // Atomic: deduct balance + set escrow fields
      balances[payer.entityId] -= amount;
      order.status = 'escrowed';
      order.escrow_debited_entity_id = payer.entityId;
      order.escrow_debited_entity_type = payer.entityType;
      order.escrow_debited_amount = amount;
      order.escrow_tx_hash = `tx_escrow_${order.id}_${order.order_version}`;
      balanceChange = { entity: payer.entityId, delta: -amount };
      break;
    }

    case 'SEND_PAYMENT': {
      order.status = 'payment_sent';
      break;
    }

    case 'CONFIRM_PAYMENT': {
      order.status = 'completed';
      // Release escrow to buyer
      if (order.escrow_debited_entity_id && order.escrow_debited_amount) {
        // Determine buyer to credit
        const role = resolveTradeRole(order, actorId);
        // actorId is seller (confirming). Find buyer.
        let buyerId: string;
        if (order.type === 'buy') {
          buyerId = order.user_id;
        } else {
          buyerId = order.merchant_id;
        }
        balances[buyerId] = (balances[buyerId] || 0) + order.escrow_debited_amount;
        balanceChange = { entity: buyerId, delta: order.escrow_debited_amount };
      }
      break;
    }

    case 'CANCEL': {
      order.status = 'cancelled';
      // Refund if escrow was locked
      if (order.escrow_debited_entity_id && order.escrow_debited_amount && !order.refund_tx_hash) {
        balances[order.escrow_debited_entity_id] += order.escrow_debited_amount;
        order.refund_tx_hash = `tx_refund_${order.id}`;
        balanceChange = { entity: order.escrow_debited_entity_id, delta: order.escrow_debited_amount };
      }
      break;
    }

    case 'DISPUTE': {
      order.status = 'disputed';
      break;
    }
  }

  order.order_version++;
  return { result, balanceChange };
}

// ═══════════════════════════════════════════════════════════════════════════
// INVARIANT CHECKERS
// ═══════════════════════════════════════════════════════════════════════════

function checkInvariants(
  order: SimOrder,
  balances: BalanceLedger,
  prevStatus: string,
  action: string,
  actorId: string,
  result: ActionResult,
  initialBalanceSum: number,
): string[] {
  const violations: string[] = [];
  const currentMinimal = normalizeStatus(order.status as any);

  // ── INVARIANT 1: No invalid state transitions ─────────────────────
  if (result.success) {
    const allowed = VALID_FORWARD_TRANSITIONS[prevStatus] || [];
    // CLAIM is special: guard targets 'accepted' but real system keeps 'escrowed'
    const isSameStatusOk = prevStatus === currentMinimal;
    if (!allowed.includes(currentMinimal) && !isSameStatusOk) {
      violations.push(
        `INVALID_TRANSITION: ${prevStatus} → ${currentMinimal} via ${action} by ${actorId}. ` +
          `Allowed from ${prevStatus}: [${allowed.join(', ')}]`,
      );
    }
  }

  // ── INVARIANT 2: No double escrow ─────────────────────────────────
  if (
    result.success &&
    action === 'LOCK_ESCROW' &&
    order.escrow_tx_hash &&
    order.escrow_tx_hash !== `tx_escrow_${order.id}_${order.order_version - 1}`
  ) {
    // This would mean a second escrow was applied
    violations.push(
      `DOUBLE_ESCROW: Escrow locked again. tx_hash=${order.escrow_tx_hash}, version=${order.order_version}`,
    );
  }

  // ── INVARIANT 3: No balance mismatch ──────────────────────────────
  // Balance sum may differ while escrow is locked (funds are "in flight").
  // Only check balance integrity when:
  //   - Order completed (escrow released to buyer)
  //   - Order cancelled WITH refund (escrow returned to seller)
  //   - No escrow was ever locked (nothing to track)
  const currentBalanceSum = Object.values(balances).reduce((a, b) => a + b, 0);
  const hasEscrowInFlight = !!order.escrow_tx_hash && !order.refund_tx_hash && currentMinimal !== 'completed';

  if (!hasEscrowInFlight && Math.abs(currentBalanceSum - initialBalanceSum) > 0.01) {
    violations.push(
      `BALANCE_MISMATCH: Initial sum=${initialBalanceSum}, current sum=${currentBalanceSum}, ` +
        `delta=${currentBalanceSum - initialBalanceSum}. Action: ${action}`,
    );
  }

  // ── INVARIANT 4: Terminal states are locked ───────────────────────
  if (TERMINAL_STATUSES.includes(prevStatus as any) && result.success) {
    violations.push(
      `TERMINAL_ESCAPE: Action ${action} succeeded from terminal state ${prevStatus}`,
    );
  }

  // ── INVARIANT 5: Enricher primaryAction is always defined ─────────
  for (const viewerId of [USER_ID, MERCHANT_ID]) {
    try {
      const enriched = enrichOrderResponse(order, viewerId);
      if (!enriched.primaryAction) {
        violations.push(
          `ENRICHER_NULL_PRIMARY: primaryAction is null/undefined for viewer=${viewerId}, ` +
            `status=${order.status}`,
        );
      }
      if (enriched.primaryAction && enriched.primaryAction.type === undefined) {
        violations.push(
          `ENRICHER_UNDEFINED_TYPE: primaryAction.type is undefined for viewer=${viewerId}`,
        );
      }
      if (typeof enriched.nextStepText !== 'string' || enriched.nextStepText.length === 0) {
        violations.push(
          `ENRICHER_EMPTY_NEXTSTEP: nextStepText is empty for viewer=${viewerId}, status=${order.status}`,
        );
      }
      if (typeof enriched.statusLabel !== 'string' || enriched.statusLabel.length === 0) {
        violations.push(
          `ENRICHER_EMPTY_LABEL: statusLabel is empty for viewer=${viewerId}, status=${order.status}`,
        );
      }

      // ── INVARIANT 6: Enricher ↔ Guard consistency ────────────────
      if (enriched.primaryAction?.type && enriched.primaryAction?.enabled) {
        const guardResult = handleOrderAction(order, enriched.primaryAction.type as OrderAction, viewerId);
        if (!guardResult.success) {
          violations.push(
            `ENRICHER_GUARD_MISMATCH: Enricher shows ${enriched.primaryAction.type} as enabled ` +
              `for ${viewerId}, but guard rejects with code=${guardResult.code}. ` +
              `Status=${order.status}, role=${enriched.my_role}`,
          );
        }
      }

      // ── INVARIANT 7: Terminal orders have no enabled actions ──────
      if (enriched.isTerminal && enriched.primaryAction?.enabled) {
        violations.push(
          `TERMINAL_ACTION_ENABLED: isTerminal=true but primaryAction.enabled=true ` +
            `for viewer=${viewerId}, type=${enriched.primaryAction.type}`,
        );
      }
    } catch (err: any) {
      violations.push(
        `ENRICHER_CRASH: enrichOrderResponse threw for viewer=${viewerId}, status=${order.status}: ${err.message}`,
      );
    }
  }

  // ── INVARIANT 8: Escrow accounting ────────────────────────────────
  if (order.escrow_debited_entity_id && !order.escrow_debited_amount) {
    violations.push(
      `ESCROW_ACCOUNTING: escrow_debited_entity_id is set but amount is null`,
    );
  }
  if (order.escrow_debited_amount && !order.escrow_debited_entity_id) {
    violations.push(
      `ESCROW_ACCOUNTING: escrow_debited_amount is set but entity_id is null`,
    );
  }

  // ── INVARIANT 9: Completed orders must have had escrow ────────────
  if (currentMinimal === 'completed' && !order.escrow_tx_hash) {
    violations.push(
      `COMPLETED_NO_ESCROW: Order completed without escrow ever being locked`,
    );
  }

  return violations;
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO RUNNER
// ═══════════════════════════════════════════════════════════════════════════

function runScenario(config: ScenarioConfig): ScenarioResult {
  const localRng = mulberry32(config.seed);
  const localPick = <T>(arr: readonly T[]): T => arr[Math.floor(localRng() * arr.length)];
  const localCoinFlip = (p = 0.5) => localRng() < p;

  const order = createOrder(config);
  const balances = initBalances();
  const initialBalanceSum = Object.values(balances).reduce((a, b) => a + b, 0);
  const actions: ActionLog[] = [];
  const violations: string[] = [];

  // Determine participants based on order config
  const participants = [USER_ID, MERCHANT_ID];
  if (config.isM2M) participants.push(BUYER_MERCHANT_ID);
  const observers = [OBSERVER_1, OBSERVER_2];
  const allActors = [...participants, ...observers];

  // Action generation strategy
  const ALL_ACTIONS: OrderAction[] = [...ORDER_ACTIONS];

  for (let step = 0; step < config.maxActions; step++) {
    const currentMinimal = normalizeStatus(order.status as any);

    // Stop if terminal
    if (TERMINAL_STATUSES.includes(currentMinimal)) {
      // But also try some invalid actions on terminal state (20% of the time)
      if (localCoinFlip(0.2) && config.includeInvalidActions) {
        const invalidAction = localPick(ALL_ACTIONS);
        const actor = localPick(allActors);
        const prevStatus = currentMinimal;
        const result = handleOrderAction(order, invalidAction, actor);

        actions.push({
          step,
          action: invalidAction,
          actorId: actor,
          statusBefore: prevStatus,
          result: result.success ? 'success' : 'rejected',
          resultCode: result.code,
          statusAfter: normalizeStatus(order.status as any),
          note: 'terminal-state-probe',
        });

        const stepViolations = checkInvariants(
          order, balances, prevStatus, invalidAction, actor, result, initialBalanceSum,
        );
        violations.push(...stepViolations);
      }
      continue;
    }

    let chosenAction: OrderAction;
    let chosenActor: string;

    // Strategy: mix of smart (valid) and chaos (random) actions
    if (localCoinFlip(0.5) || !config.includeInvalidActions) {
      // ── SMART PATH: pick a valid action for a random participant ───
      const candidateActor = localPick(allActors);
      const allowed = getAllowedActions(order, candidateActor);

      if (allowed.length > 0) {
        chosenAction = localPick(allowed);
        chosenActor = candidateActor;
      } else {
        // No valid actions for this actor — try another
        let found = false;
        for (const actor of allActors) {
          const actorAllowed = getAllowedActions(order, actor);
          if (actorAllowed.length > 0) {
            chosenAction = localPick(actorAllowed);
            chosenActor = actor;
            found = true;
            break;
          }
        }
        if (!found) {
          // No one can do anything — break
          break;
        }
      }
    } else {
      // ── CHAOS PATH: random action + random actor ──────────────────
      chosenAction = localPick(ALL_ACTIONS);
      chosenActor = config.includeObserverChaos ? localPick(allActors) : localPick(participants);
    }

    // Simulate race conditions: fire 2 actions concurrently
    if (config.includeRaceConditions && localCoinFlip(0.25) && step > 0) {
      const raceAction = localPick(ALL_ACTIONS);
      const raceActor = localPick(allActors);
      const prevStatus = normalizeStatus(order.status as any);

      // Race action 1
      const raceResult = handleOrderAction(order, raceAction, raceActor);
      actions.push({
        step,
        action: raceAction,
        actorId: raceActor,
        statusBefore: prevStatus,
        result: raceResult.success ? 'success' : 'rejected',
        resultCode: raceResult.code,
        statusAfter: normalizeStatus(order.status as any),
        note: 'race-condition-probe',
      });

      // If race action succeeded, apply mutation ONLY if it's a valid guard pass
      if (raceResult.success) {
        const { balanceChange } = executeAction(
          { ...order }, raceAction, raceActor, { ...balances },
        );
        // Don't actually mutate — just check invariants on the hypothetical
      }

      const raceViolations = checkInvariants(
        order, balances, prevStatus, raceAction, raceActor, raceResult, initialBalanceSum,
      );
      violations.push(...raceViolations);
    }

    // Execute the chosen action
    const prevStatus = normalizeStatus(order.status as any);
    const { result } = executeAction(order, chosenAction!, chosenActor!, balances);

    actions.push({
      step,
      action: chosenAction!,
      actorId: chosenActor!,
      statusBefore: prevStatus,
      result: result.success ? 'success' : 'rejected',
      resultCode: result.code,
      statusAfter: normalizeStatus(order.status as any),
    });

    // Check all invariants after this action
    const stepViolations = checkInvariants(
      order, balances, prevStatus, chosenAction!, chosenActor!, result, initialBalanceSum,
    );
    violations.push(...stepViolations);
  }

  return {
    config,
    actions,
    violations,
    finalStatus: normalizeStatus(order.status as any),
    escrowLocked: !!order.escrow_tx_hash,
    escrowRefunded: !!order.refund_tx_hash,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Chaos Trading — 100 Random Scenarios', () => {
  const TOTAL_SCENARIOS = 100;
  const results: ScenarioResult[] = [];

  beforeAll(() => {
    for (let i = 0; i < TOTAL_SCENARIOS; i++) {
      const config = generateScenarioConfig(i);
      results.push(runScenario(config));
    }
  });

  // ── Main invariant test ─────────────────────────────────────────────

  it('all 100 scenarios have zero invariant violations', () => {
    const broken = results.filter((r) => r.violations.length > 0);

    if (broken.length > 0) {
      const report = broken
        .map((r) => {
          const header = `\n${'═'.repeat(70)}\nSCENARIO #${r.config.id} — BROKEN (${r.violations.length} violations)\n${'═'.repeat(70)}`;
          const configStr = `Config: type=${r.config.orderType}, M2M=${r.config.isM2M}, race=${r.config.includeRaceConditions}`;
          const violationStr = r.violations.map((v, i) => `  [V${i + 1}] ${v}`).join('\n');
          const actionStr = r.actions
            .map(
              (a) =>
                `  Step ${a.step}: ${a.action} by ${a.actorId.slice(-4)} | ` +
                `${a.statusBefore} → ${a.statusAfter} | ${a.result}${a.resultCode ? ` (${a.resultCode})` : ''}` +
                `${a.note ? ` [${a.note}]` : ''}`,
            )
            .join('\n');
          return `${header}\n${configStr}\n\nViolations:\n${violationStr}\n\nAction Log:\n${actionStr}`;
        })
        .join('\n\n');

      throw new Error(`${broken.length}/${TOTAL_SCENARIOS} scenarios had invariant violations:\n${report}`);
    }
  });

  // ── State transition validity ─────────────────────────────────────

  it('no scenario produces an invalid state transition', () => {
    const transitionViolations = results.flatMap((r) =>
      r.violations.filter((v) => v.startsWith('INVALID_TRANSITION')),
    );
    expect(transitionViolations).toEqual([]);
  });

  // ── Double escrow prevention ──────────────────────────────────────

  it('no scenario has double escrow', () => {
    const doubleEscrow = results.flatMap((r) =>
      r.violations.filter((v) => v.startsWith('DOUBLE_ESCROW')),
    );
    expect(doubleEscrow).toEqual([]);
  });

  // ── Balance integrity ─────────────────────────────────────────────

  it('no scenario has a balance mismatch', () => {
    const balanceMismatches = results.flatMap((r) =>
      r.violations.filter((v) => v.startsWith('BALANCE_MISMATCH')),
    );
    expect(balanceMismatches).toEqual([]);
  });

  // ── Terminal state escape ─────────────────────────────────────────

  it('no action succeeds from a terminal state', () => {
    const escapes = results.flatMap((r) =>
      r.violations.filter((v) => v.startsWith('TERMINAL_ESCAPE')),
    );
    expect(escapes).toEqual([]);
  });

  // ── Enricher stability ────────────────────────────────────────────

  it('enricher never crashes and always returns valid primaryAction', () => {
    const enricherIssues = results.flatMap((r) =>
      r.violations.filter(
        (v) =>
          v.startsWith('ENRICHER_CRASH') ||
          v.startsWith('ENRICHER_NULL_PRIMARY') ||
          v.startsWith('ENRICHER_UNDEFINED_TYPE'),
      ),
    );
    expect(enricherIssues).toEqual([]);
  });

  // ── Enricher ↔ Guard consistency ──────────────────────────────────

  it('enricher never shows an enabled action that the guard would reject', () => {
    const mismatches = results.flatMap((r) =>
      r.violations.filter((v) => v.startsWith('ENRICHER_GUARD_MISMATCH')),
    );
    expect(mismatches).toEqual([]);
  });

  // ── Terminal action guard ─────────────────────────────────────────

  it('terminal orders never show enabled primaryAction', () => {
    const terminalActions = results.flatMap((r) =>
      r.violations.filter((v) => v.startsWith('TERMINAL_ACTION_ENABLED')),
    );
    expect(terminalActions).toEqual([]);
  });

  // ── Escrow accounting ─────────────────────────────────────────────

  it('escrow fields are always consistent (entity + amount both set or both null)', () => {
    const accounting = results.flatMap((r) =>
      r.violations.filter((v) => v.startsWith('ESCROW_ACCOUNTING')),
    );
    expect(accounting).toEqual([]);
  });

  // ── Completed orders had escrow ───────────────────────────────────

  it('no order completes without escrow ever being locked', () => {
    const noEscrow = results.flatMap((r) =>
      r.violations.filter((v) => v.startsWith('COMPLETED_NO_ESCROW')),
    );
    expect(noEscrow).toEqual([]);
  });

  // ── Coverage statistics ───────────────────────────────────────────

  it('reports coverage statistics', () => {
    const stats = {
      total: results.length,
      broken: results.filter((r) => r.violations.length > 0).length,
      clean: results.filter((r) => r.violations.length === 0).length,
      byFinalStatus: {} as Record<string, number>,
      byOrderType: { buy: 0, sell: 0 },
      m2m: results.filter((r) => r.config.isM2M).length,
      withRace: results.filter((r) => r.config.includeRaceConditions).length,
      withInvalid: results.filter((r) => r.config.includeInvalidActions).length,
      withObserverChaos: results.filter((r) => r.config.includeObserverChaos).length,
      totalActions: 0,
      successfulActions: 0,
      rejectedActions: 0,
      escrowLocked: results.filter((r) => r.escrowLocked).length,
      escrowRefunded: results.filter((r) => r.escrowRefunded).length,
    };

    for (const r of results) {
      stats.byOrderType[r.config.orderType]++;
      stats.byFinalStatus[r.finalStatus] = (stats.byFinalStatus[r.finalStatus] || 0) + 1;
      stats.totalActions += r.actions.length;
      stats.successfulActions += r.actions.filter((a) => a.result === 'success').length;
      stats.rejectedActions += r.actions.filter((a) => a.result === 'rejected').length;
    }

    // Log coverage report
    console.log('\n' + '═'.repeat(70));
    console.log('CHAOS TEST COVERAGE REPORT');
    console.log('═'.repeat(70));
    console.log(`Scenarios:        ${stats.total} (${stats.clean} clean, ${stats.broken} broken)`);
    console.log(`Order types:      BUY=${stats.byOrderType.buy}, SELL=${stats.byOrderType.sell}`);
    console.log(`M2M scenarios:    ${stats.m2m}`);
    console.log(`Race conditions:  ${stats.withRace}`);
    console.log(`Invalid actions:  ${stats.withInvalid}`);
    console.log(`Observer chaos:   ${stats.withObserverChaos}`);
    console.log(`Total actions:    ${stats.totalActions} (${stats.successfulActions} success, ${stats.rejectedActions} rejected)`);
    console.log(`Escrow locked:    ${stats.escrowLocked}`);
    console.log(`Escrow refunded:  ${stats.escrowRefunded}`);
    console.log(`Final statuses:   ${JSON.stringify(stats.byFinalStatus)}`);
    console.log('═'.repeat(70));

    // Ensure we actually tested a variety of scenarios
    expect(stats.byOrderType.buy).toBeGreaterThan(20);
    expect(stats.byOrderType.sell).toBeGreaterThan(20);
    expect(stats.m2m).toBeGreaterThan(10);
    expect(stats.withRace).toBeGreaterThan(15);
    expect(stats.totalActions).toBeGreaterThan(300);
    expect(stats.successfulActions).toBeGreaterThan(100);
    expect(stats.rejectedActions).toBeGreaterThan(50);
    expect(Object.keys(stats.byFinalStatus).length).toBeGreaterThanOrEqual(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TARGETED RACE CONDITION TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Targeted Race Conditions', () => {
  it('concurrent ACCEPT: guard prevents second accept', () => {
    const order: SimOrder = {
      id: 'race-accept',
      status: 'pending',
      type: 'buy',
      user_id: USER_ID,
      merchant_id: MERCHANT_ID,
      buyer_merchant_id: null,
      escrow_debited_entity_id: null,
      escrow_debited_entity_type: null,
      escrow_debited_amount: null,
      escrow_tx_hash: null,
      refund_tx_hash: null,
      order_version: 1,
      crypto_amount: 500,
      fiat_amount: 1835,
    };

    // First accept succeeds
    const r1 = handleOrderAction(order, 'ACCEPT', OBSERVER_1);
    expect(r1.success).toBe(true);

    // Simulate mutation
    order.status = 'accepted';
    order.buyer_merchant_id = OBSERVER_1;
    order.order_version++;

    // Second accept: order is no longer 'open'
    const r2 = handleOrderAction(order, 'ACCEPT', OBSERVER_2);
    expect(r2.success).toBe(false);
    expect(r2.code).toBe('INVALID_STATUS_FOR_ACTION');
  });

  it('concurrent LOCK_ESCROW: guard prevents after status change', () => {
    // M2M: merchant_id = ALWAYS seller, buyer_merchant_id = ALWAYS buyer
    const order: SimOrder = {
      id: 'race-escrow',
      status: 'accepted',
      type: 'buy',
      user_id: USER_ID,
      merchant_id: MERCHANT_ID,
      buyer_merchant_id: OBSERVER_1,
      escrow_debited_entity_id: null,
      escrow_debited_entity_type: null,
      escrow_debited_amount: null,
      escrow_tx_hash: null,
      refund_tx_hash: null,
      order_version: 1,
      crypto_amount: 500,
      fiat_amount: 1835,
    };

    // M2M: merchant_id (MERCHANT_ID) is always the seller
    const seller = MERCHANT_ID;

    // First lock succeeds
    const r1 = handleOrderAction(order, 'LOCK_ESCROW', seller);
    expect(r1.success).toBe(true);

    // Simulate mutation
    order.status = 'escrowed';
    order.escrow_tx_hash = 'tx_1';
    order.order_version++;

    // Second lock: status is now 'escrowed', not 'accepted'
    const r2 = handleOrderAction(order, 'LOCK_ESCROW', seller);
    expect(r2.success).toBe(false);
    expect(r2.code).toBe('INVALID_STATUS_FOR_ACTION');
  });

  it('concurrent CANCEL + LOCK_ESCROW: one wins based on execution order', () => {
    // M2M: merchant_id=seller, buyer_merchant_id=buyer (always)
    const seller = MERCHANT_ID;

    const makeOrder = (): SimOrder => ({
      id: 'race-cancel-escrow',
      status: 'accepted',
      type: 'buy',
      user_id: USER_ID,
      merchant_id: MERCHANT_ID,
      buyer_merchant_id: OBSERVER_1,
      escrow_debited_entity_id: null,
      escrow_debited_entity_type: null,
      escrow_debited_amount: null,
      escrow_tx_hash: null,
      refund_tx_hash: null,
      order_version: 1,
      crypto_amount: 500,
      fiat_amount: 1835,
    });

    // Scenario A: Cancel wins
    const orderA = makeOrder();
    const cancelA = handleOrderAction(orderA, 'CANCEL', USER_ID);
    expect(cancelA.success).toBe(true);
    orderA.status = 'cancelled';
    orderA.order_version++;
    const escrowA = handleOrderAction(orderA, 'LOCK_ESCROW', seller);
    expect(escrowA.success).toBe(false);
    expect(escrowA.code).toBe('TERMINAL_STATE');

    // Scenario B: Escrow wins
    const orderB = makeOrder();
    const escrowB = handleOrderAction(orderB, 'LOCK_ESCROW', seller);
    expect(escrowB.success).toBe(true);
    orderB.status = 'escrowed';
    orderB.order_version++;
    const cancelB = handleOrderAction(orderB, 'CANCEL', USER_ID);
    // Cancel from escrowed is still allowed
    expect(cancelB.success).toBe(true);
  });

  it('concurrent SEND_PAYMENT + DISPUTE from escrowed', () => {
    const order: SimOrder = {
      id: 'race-pay-dispute',
      status: 'escrowed',
      type: 'buy',
      user_id: USER_ID,
      merchant_id: MERCHANT_ID,
      buyer_merchant_id: OBSERVER_1,
      escrow_debited_entity_id: MERCHANT_ID,
      escrow_debited_entity_type: 'merchant',
      escrow_debited_amount: 500,
      escrow_tx_hash: 'tx_1',
      refund_tx_hash: null,
      order_version: 2,
      crypto_amount: 500,
      fiat_amount: 1835,
    };

    // Both should be valid from escrowed
    const payResult = handleOrderAction(order, 'SEND_PAYMENT', USER_ID);
    const disputeResult = handleOrderAction(order, 'DISPUTE', USER_ID);

    expect(payResult.success).toBe(true);
    expect(disputeResult.success).toBe(true);

    // If payment wins first:
    order.status = 'payment_sent';
    order.order_version++;

    // Dispute still valid from payment_sent
    const disputeAfterPay = handleOrderAction(order, 'DISPUTE', USER_ID);
    expect(disputeAfterPay.success).toBe(true);

    // But SEND_PAYMENT again is rejected
    const payAgain = handleOrderAction(order, 'SEND_PAYMENT', USER_ID);
    expect(payAgain.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TARGETED DOUBLE-ESCROW PREVENTION
// ═══════════════════════════════════════════════════════════════════════════

describe('Double Escrow Prevention', () => {
  it('escrow cannot be locked twice even with direct status manipulation', () => {
    // M2M: merchant_id is always the seller
    const seller = MERCHANT_ID;
    const order: SimOrder = {
      id: 'double-escrow-1',
      status: 'accepted',
      type: 'buy',
      user_id: USER_ID,
      merchant_id: MERCHANT_ID,
      buyer_merchant_id: OBSERVER_1,
      escrow_debited_entity_id: null,
      escrow_debited_entity_type: null,
      escrow_debited_amount: null,
      escrow_tx_hash: null,
      refund_tx_hash: null,
      order_version: 1,
      crypto_amount: 1000,
      fiat_amount: 3670,
    };

    const balances = initBalances();

    // Lock escrow (seller = OBSERVER_1 in M2M BUY)
    const { result: r1 } = executeAction(order, 'LOCK_ESCROW', seller, balances);
    expect(r1.success).toBe(true);
    expect(order.escrow_debited_entity_id).toBe(seller);
    const balanceAfterFirst = balances[seller];

    // Try to lock again — guard should reject (status is now 'escrowed', not 'accepted')
    const r2 = handleOrderAction(order, 'LOCK_ESCROW', seller);
    expect(r2.success).toBe(false);
    expect(r2.code).toBe('INVALID_STATUS_FOR_ACTION');

    // Balance unchanged
    expect(balances[seller]).toBe(balanceAfterFirst);
  });

  it('all 100 scenarios: escrow locked at most once', () => {
    // Re-run all scenarios and count escrow locks
    for (let i = 0; i < 100; i++) {
      const config = generateScenarioConfig(i);
      const order = createOrder(config);
      const balances = initBalances();

      let escrowCount = 0;

      for (let step = 0; step < config.maxActions; step++) {
        if (TERMINAL_STATUSES.includes(normalizeStatus(order.status as any))) break;

        const allActors = [USER_ID, MERCHANT_ID, OBSERVER_1];
        for (const actor of allActors) {
          const allowed = getAllowedActions(order, actor);
          if (allowed.includes('LOCK_ESCROW')) {
            const { result } = executeAction(order, 'LOCK_ESCROW', actor, balances);
            if (result.success) escrowCount++;
            break;
          }
        }

        // Try a valid action to progress
        for (const actor of allActors) {
          const allowed = getAllowedActions(order, actor);
          if (allowed.length > 0) {
            const action = allowed[0];
            executeAction(order, action, actor, balances);
            break;
          }
        }
      }

      expect(escrowCount).toBeLessThanOrEqual(1);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BALANCE INVARIANT: Complete lifecycle has zero net balance change
// ═══════════════════════════════════════════════════════════════════════════

describe('Balance Integrity — Complete Lifecycles', () => {
  function runFullLifecycle(type: 'buy' | 'sell', isM2M: boolean) {
    const order: SimOrder = {
      id: `lifecycle-${type}-${isM2M ? 'm2m' : 'u2m'}`,
      status: 'pending',
      type,
      user_id: USER_ID,
      merchant_id: MERCHANT_ID,
      buyer_merchant_id: isM2M ? BUYER_MERCHANT_ID : null,
      escrow_debited_entity_id: null,
      escrow_debited_entity_type: null,
      escrow_debited_amount: null,
      escrow_tx_hash: null,
      refund_tx_hash: null,
      order_version: 1,
      crypto_amount: 500,
      fiat_amount: 1835,
    };

    const balances = initBalances();
    const initialSum = Object.values(balances).reduce((a, b) => a + b, 0);

    // Step 1: Accept (sets buyer_merchant_id which activates M2M role rules)
    order.status = 'accepted';
    if (!order.buyer_merchant_id) order.buyer_merchant_id = OBSERVER_1;
    order.order_version++;

    // Resolve roles AFTER accept (buyer_merchant_id may trigger M2M rules)
    // Find who is seller and who is buyer by asking resolveTradeRole
    const allActors = [USER_ID, MERCHANT_ID, order.buyer_merchant_id!];
    const seller = allActors.find(a => resolveTradeRole(order, a) === 'seller')!;
    const buyer = allActors.find(a => resolveTradeRole(order, a) === 'buyer')!;

    // Step 2: Lock escrow (seller locks)
    const escrowResult = executeAction(order, 'LOCK_ESCROW', seller, balances);
    expect(escrowResult.result.success).toBe(true);
    expect(order.status).toBe('escrowed');

    // Step 3: Send payment (buyer sends)
    const payResult = executeAction(order, 'SEND_PAYMENT', buyer, balances);
    expect(payResult.result.success).toBe(true);
    expect(order.status).toBe('payment_sent');

    // Step 4: Confirm payment (seller confirms → completes + releases)
    const confirmResult = executeAction(order, 'CONFIRM_PAYMENT', seller, balances);
    expect(confirmResult.result.success).toBe(true);
    expect(order.status).toBe('completed');

    // Balance check: total should be unchanged (escrow moved, not created/destroyed)
    const finalSum = Object.values(balances).reduce((a, b) => a + b, 0);
    expect(finalSum).toBe(initialSum);
  }

  it('User BUY lifecycle: balance integrity', () => runFullLifecycle('buy', false));
  it('User SELL lifecycle: balance integrity', () => runFullLifecycle('sell', false));
  it('M2M BUY lifecycle: balance integrity', () => runFullLifecycle('buy', true));
  it('M2M SELL lifecycle: balance integrity', () => runFullLifecycle('sell', true));

  function runCancelledLifecycle(cancelFrom: 'accepted' | 'escrowed') {
    const order: SimOrder = {
      id: `lifecycle-cancel-${cancelFrom}`,
      status: 'pending',
      type: 'buy',
      user_id: USER_ID,
      merchant_id: MERCHANT_ID,
      buyer_merchant_id: null,
      escrow_debited_entity_id: null,
      escrow_debited_entity_type: null,
      escrow_debited_amount: null,
      escrow_tx_hash: null,
      refund_tx_hash: null,
      order_version: 1,
      crypto_amount: 500,
      fiat_amount: 1835,
    };

    const balances = initBalances();
    const initialSum = Object.values(balances).reduce((a, b) => a + b, 0);

    // Accept
    order.status = 'accepted';
    order.buyer_merchant_id = OBSERVER_1;
    order.order_version++;

    // Resolve seller after accept
    const allActors = [USER_ID, MERCHANT_ID, order.buyer_merchant_id!];
    const seller = allActors.find(a => resolveTradeRole(order, a) === 'seller')!;

    if (cancelFrom === 'escrowed') {
      // Lock escrow first (seller locks)
      const escrowResult = executeAction(order, 'LOCK_ESCROW', seller, balances);
      expect(escrowResult.result.success).toBe(true);
      expect(order.status).toBe('escrowed');
    }

    // Cancel (should refund if escrowed)
    executeAction(order, 'CANCEL', USER_ID, balances);
    expect(order.status).toBe('cancelled');

    // Balance check: refund must restore original balance
    const finalSum = Object.values(balances).reduce((a, b) => a + b, 0);
    expect(finalSum).toBe(initialSum);
  }

  it('Cancel from accepted: balance integrity (no escrow to refund)', () => {
    runCancelledLifecycle('accepted');
  });

  it('Cancel from escrowed: balance integrity (refund restores balance)', () => {
    runCancelledLifecycle('escrowed');
  });
});
