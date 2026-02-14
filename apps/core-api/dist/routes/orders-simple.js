export const orderRoutes = async (fastify) => {
    // GET /v1/orders/:id
    fastify.get('/orders/:id', async (request, reply) => {
        const { id } = request.params;
        // Phase 1: Return mock response
        // TODO Phase 2: Import and call getOrderWithRelations()
        return reply.send({
            success: true,
            data: {
                id,
                status: 'escrowed',
                minimal_status: 'escrowed',
                order_version: 1,
                _phase: 1,
                _note: 'Phase 1 stub - wiring settle imports in Phase 2'
            },
        });
    });
    // POST /v1/orders/:id/events
    fastify.post('/orders/:id/events', async (request, reply) => {
        const { id } = request.params;
        const { event_type, tx_hash } = request.body;
        // Extract actor from headers
        const actorType = request.headers['x-actor-type'];
        const actorId = request.headers['x-actor-id'];
        if (!actorType || !actorId) {
            return reply.status(401).send({
                success: false,
                error: 'Actor headers required',
            });
        }
        if (event_type === 'release') {
            if (!tx_hash) {
                return reply.status(400).send({
                    success: false,
                    error: 'tx_hash required',
                });
            }
            // Phase 1: Mock success
            // TODO Phase 2: Execute atomic release transaction
            fastify.log.info({ id, tx_hash, actorType, actorId }, 'Phase 1 release event');
            return reply.send({
                success: true,
                data: {
                    order_id: id,
                    status: 'completed',
                    _phase: 1,
                },
            });
        }
        else if (event_type === 'refund') {
            // Phase 1: Mock success
            // TODO Phase 2: Execute atomic refund transaction
            fastify.log.info({ id, actorType, actorId }, 'Phase 1 refund event');
            return reply.send({
                success: true,
                data: {
                    order_id: id,
                    status: 'cancelled',
                    _phase: 1,
                },
            });
        }
        else {
            return reply.status(400).send({
                success: false,
                error: 'Invalid event_type',
            });
        }
    });
};
