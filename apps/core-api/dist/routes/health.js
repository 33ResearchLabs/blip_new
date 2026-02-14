export const healthRoutes = async (fastify) => {
    fastify.get('/health', async () => {
        return {
            ok: true,
            service: 'core-api',
            timestamp: new Date().toISOString(),
        };
    });
};
