/* Monta o servidor (sem escutar porta): usado por index.ts e pelos testes, que passam um
 * DATA_DIR temporário. Ordem: plugins (CORS, limite de tentativas, JWT, multipart), erros em
 * português, cabeçalhos de segurança, rotas /api e por último o app web em /. */
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { loadConfig, trustProxyOption, type ServerConfig } from './config';
import { openDb, type DB } from './db';
import { Storage } from './storage';
import { RecalcQueue } from './recalc';
import { Analyzer } from './analyzer';
import { loadSecret, TOKEN_TTL } from './auth';
import { installErrorHandler } from './errors';
import { registerWeb } from './web';
import infoRoutes from './routes/info';
import healthRoutes from './routes/health';
import authRoutes from './routes/auth';
import usersRoutes from './routes/users';
import invitesRoutes from './routes/invites';
import sessionsRoutes from './routes/sessions';
import carsRoutes from './routes/cars';
import tracksRoutes from './routes/tracks';
import commentsRoutes from './routes/comments';

declare module 'fastify' {
  interface FastifyInstance {
    db: DB;
    cfg: ServerConfig;
    storage: Storage;
    recalc: RecalcQueue;
    analyzer: Analyzer;
  }
}

export interface BuildOptions extends Partial<ServerConfig> {
  /** logger do Fastify (padrão: desligado; index.ts liga) */
  logger?: FastifyServerOptions['logger'];
  /** recalcular na subida os resumos de versão antiga (padrão: sim) */
  recalcOnStart?: boolean;
  /** limite de tentativas de login por IP por minuto (padrão 10) */
  loginMax?: number;
}

/* nunca registrar senha nem token */
export const LOG_REDACT = {
  paths: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password', 'req.body.oldPassword',
    'req.body.newPassword', 'res.headers["set-cookie"]'],
  censor: '[oculto]',
};

export async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const { logger = false, recalcOnStart = true, loginMax = 10, ...over } = opts;
  const cfg: ServerConfig = { ...loadConfig(), ...Object.fromEntries(Object.entries(over).filter(([, v]) => v !== undefined)) };

  /* antes de abrir qualquer coisa: JWT_SECRET fraco para a subida aqui */
  const secret = loadSecret(cfg.dataDir, cfg.jwtSecret);

  const app = Fastify({
    logger,
    /* nunca true do Fastify (confiar em todos os saltos do X-Forwarded-For deixa o cliente escolher o IP) */
    trustProxy: trustProxyOption(cfg.trustProxy),
    bodyLimit: 2 * 1024 * 1024,
    ajv: { customOptions: { allErrors: false, removeAdditional: true, coerceTypes: 'array', useDefaults: true } },
  });

  const db = openDb(cfg.dataDir);
  const storage = new Storage(cfg.dataDir);
  const analyzer = new Analyzer({ memoryMb: cfg.analysisMemoryMb, timeoutMs: cfg.analysisTimeoutS * 1000, log: app.log });
  const recalc = new RecalcQueue(db, storage, analyzer, app.log);
  app.decorate('db', db);
  app.decorate('cfg', cfg);
  app.decorate('storage', storage);
  app.decorate('recalc', recalc);
  app.decorate('analyzer', analyzer);
  app.decorateRequest('me', null);
  app.addHook('onClose', async () => {
    recalc.close();
    await analyzer.close();
    await recalc.idle();
    db.close();
  });

  installErrorHandler(app, cfg.maxUploadMb);

  /* pedido sem corpo (ex.: POST /sessions/:id/summary) vale como {} para o JSON Schema */
  app.addHook('preValidation', async req => {
    if ((req.body === undefined || req.body === null) && req.method !== 'GET' && req.method !== 'HEAD' && !req.isMultipart()) {
      req.body = {};
    }
  });

  /* cabeçalhos de segurança básicos (sem dependência nova) */
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    return payload;
  });

  /* CORS: só as origens de CORS_ORIGINS; vazio = só a mesma origem (sem cabeçalhos CORS) */
  const origins = new Set(cfg.corsOrigins.map(o => o.replace(/\/+$/, '')));
  await app.register(cors, {
    origin: origins.size ? (origin, cb) => cb(null, !!origin && origins.has(origin)) : false,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    exposedHeaders: ['Content-Disposition'],
    maxAge: 600,
  });

  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, ctx) => Object.assign(
      new Error(`Muitas tentativas: espere ${Math.max(1, Math.ceil(ctx.ttl / 1000))} s e tente de novo`),
      { statusCode: ctx.statusCode, pt: true }),
  });

  await app.register(jwt, {
    secret,
    sign: { expiresIn: TOKEN_TTL, algorithm: 'HS256' },
    /* exp e iat obrigatórios e idade máxima pelo iat: um token sem validade nunca vale */
    verify: { algorithms: ['HS256'], requiredClaims: ['sub', 'iat', 'exp'], maxAge: TOKEN_TTL },
  });

  await app.register(multipart, {
    limits: {
      fileSize: Math.round(cfg.maxUploadMb * 1024 * 1024),
      files: 1,
      fields: 5,
      fieldSize: 64 * 1024,
      parts: 6,
    },
  });

  await app.register(async api => {
    await api.register(infoRoutes);
    await api.register(healthRoutes);
    await api.register(authRoutes, { loginMax });
    await api.register(usersRoutes);
    await api.register(invitesRoutes);
    await api.register(sessionsRoutes);
    await api.register(carsRoutes);
    await api.register(tracksRoutes);
    await api.register(commentsRoutes);
  }, { prefix: '/api' });

  await registerWeb(app, cfg.webDist);

  await app.ready();
  if (recalcOnStart) recalc.enqueueOutdated();
  return app;
}
