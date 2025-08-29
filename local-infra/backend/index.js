const fastify = require('fastify')({ logger: true });


fastify.get('/health', async () => ({ status: 'ok' }));


const port = process.env.PORT || 3000;
fastify.listen({ port, host: '0.0.0.0' }).then(() => {
fastify.log.info(`health on :${port}/health`);
});