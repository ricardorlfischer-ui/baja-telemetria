/* Esqueleto: substituído pela implementação do servidor. */
import Fastify from 'fastify';

const app = Fastify({ logger: true });
app.get('/api/health', async () => ({ ok: true }));
await app.listen({ port: Number(process.env.PORT ?? 8080), host: '0.0.0.0' });
