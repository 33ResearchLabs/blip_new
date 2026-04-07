import { FastifyInstance } from 'fastify';
import { calculateMerchantReputation, calculateUserReputation } from '../reputation/calculate';
import { getMerchantReputation, getUserReputation } from '../reputation/matching';

export async function reputationRoutes(fastify: FastifyInstance) {
  /**
   * GET /v1/reputation/:entityType/:id
   * Full reputation breakdown (triggers calculation if stale)
   */
  fastify.get<{ Params: { entityType: string; id: string } }>(
    '/reputation/:entityType/:id',
    async (request, reply) => {
      const { entityType, id } = request.params;

      if (entityType !== 'merchant' && entityType !== 'user') {
        return reply.status(400).send({ error: 'entityType must be "merchant" or "user"' });
      }

      const result = entityType === 'merchant'
        ? await calculateMerchantReputation(id)
        : await calculateUserReputation(id);

      if (!result) {
        return reply.status(404).send({ error: `${entityType} not found` });
      }

      return reply.send({
        id: result.entity_id,
        type: result.entity_type,
        score: result.total_score,
        tier: result.tier,
        quick: {
          score: result.total_score,
          tier: result.tier,
        },
        details: result.breakdown,
        badges: result.badges,
        flags: result.abuse_flags,
        penalties: result.penalties,
        wash_trading_detected: result.wash_trading_detected,
        trade_count: result.trade_count,
        cold_start: result.cold_start,
        calculated_at: result.calculated_at,
      });
    }
  );

  /**
   * GET /v1/reputation/:entityType/:id/quick
   * Fast read from entity table (for matching engine, no calculation)
   */
  fastify.get<{ Params: { entityType: string; id: string } }>(
    '/reputation/:entityType/:id/quick',
    async (request, reply) => {
      const { entityType, id } = request.params;

      if (entityType !== 'merchant' && entityType !== 'user') {
        return reply.status(400).send({ error: 'entityType must be "merchant" or "user"' });
      }

      const rep = entityType === 'merchant'
        ? await getMerchantReputation(id)
        : await getUserReputation(id);

      return reply.send({
        id,
        type: entityType,
        score: rep.score,
        tier: rep.tier,
      });
    }
  );
}
