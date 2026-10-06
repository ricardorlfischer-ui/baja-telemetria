/* Perfis de carro e de pista (mesmo CRUD para as duas tabelas). Os params são validados de
 * forma leniente: precisa ser um objeto, os campos conhecidos têm o tipo conferido e os
 * desconhecidos são mantidos. Mudou params (ou apagou o perfil)? Os resumos das sessões que
 * usam o perfil são recalculados em segundo plano.
 *
 * Papéis: viewer lê; member cria; mudar (PUT) e apagar só quem criou ou um administrador
 * (ARQUITETURA 5.3, "member edita o que é seu"). */
import type { FastifyInstance } from 'fastify';
import { nowIso, newId, type ProfileRow, type UserRow } from '../db';
import { canEdit, requireRole } from '../auth';
import { forbidden, notFound } from '../errors';
import { ID_PARAMS, NAME } from './schemas';

const NUM = { type: 'number' } as const;
const NUM0 = { type: 'number', minimum: 0 } as const;
/* tamanho da área do GPS em m: valores absurdos (ex.: 6e9) fazem o core alocar até estourar a memória */
const SIZE = { type: 'number', minimum: 0, maximum: 100_000 } as const;
const STR = { type: 'string', maxLength: 200 } as const;
const BOOL = { type: 'boolean' } as const;

/** CarConfig + susp (SuspConfig) opcional. */
export const CAR_PARAMS = {
  type: 'object', additionalProperties: true,
  properties: {
    mass: NUM0, wb: NUM0, trackF: NUM0, trackR: NUM0, mrF: NUM0, mrR: NUM0, strokeF: NUM0, strokeR: NUM0,
    massF: NUM0, massR: NUM0, wheelCh: STR, wheelDriven: BOOL, cvtCh: STR, tAmb: NUM, tCvtMax: NUM,
    endurance: NUM0, crr: NUM0, cda: NUM0, rho: NUM0, power: NUM0,
    susp: {
      type: 'object', additionalProperties: true,
      properties: {
        compPos: BOOL, knee: NUM0, moving: BOOL, fmin: NUM0, fmax: NUM0,
        strokeF: NUM0, strokeR: NUM0, massF: NUM0, massR: NUM0, mrF: NUM0, mrR: NUM0,
      },
    },
  },
} as const;

const PT = { type: 'object', required: ['x', 'y'], additionalProperties: true, properties: { x: NUM, y: NUM } } as const;
/** TrackConfig (track_config.h, canais X/Y, formato, linha de largada). */
export const TRACK_PARAMS = {
  type: 'object', additionalProperties: true,
  properties: {
    lat0: { type: 'number', minimum: -90, maximum: 90 }, lon0: { type: 'number', minimum: -180, maximum: 180 },
    centerFixed: BOOL, sizeX: SIZE, sizeY: SIZE, margin: SIZE, chX: STR, chY: STR, chStatus: STR,
    fmt: { type: 'string', enum: ['auto', 'V', 'mV', 'code', 'm'] }, smooth: NUM0, minLap: NUM0,
    line: { type: ['array', 'null'], minItems: 2, maxItems: 2, items: PT },
  },
} as const;

type ListRow = ProfileRow & { created_by_name: string | null; sessions: number };

const publicProfile = (r: ListRow) => {
  let params: unknown = {};
  try { params = JSON.parse(r.params); } catch { /* fica {} */ }
  return {
    id: r.id, name: r.name, params, createdBy: r.created_by ?? undefined, createdByName: r.created_by_name ?? undefined,
    updatedAt: r.updated_at, sessions: r.sessions,
  };
};

interface Opts {
  table: 'cars' | 'tracks'; route: string; column: 'car_id' | 'track_id'; params: object;
  label: string; genero: 'o' | 'a';
}

/** Registra GET/POST /<route> e GET/PUT/DELETE /<route>/:id. */
export function profileRoutes(app: FastifyInstance, o: Opts): void {
  const { db, recalc } = app;
  const viewer = requireRole('viewer'), member = requireRole('member');
  const SELECT = `SELECT p.*, u.name AS created_by_name,
    (SELECT COUNT(*) FROM sessions s WHERE s.${o.column} = p.id) AS sessions
    FROM ${o.table} p LEFT JOIN users u ON u.id = p.created_by`;
  const get = (id: string) => db.prepare(`${SELECT} WHERE p.id = ?`).get(id) as ListRow | undefined;
  const mustGet = (id: string) => {
    const r = get(id);
    if (!r) throw notFound(`${o.label} não encontrad${o.genero}`);
    return r;
  };
  const mustEdit = (u: UserRow, r: ListRow) => {
    if (!canEdit(u, r.created_by)) {
      throw forbidden(`Só quem criou ${o.genero} ${o.label.toLowerCase()} (ou um administrador) pode mudar ou apagar`);
    }
  };
  const body = {
    type: 'object', required: ['name'], additionalProperties: false, properties: { name: NAME, params: o.params },
  };

  app.get(`/${o.route}`, { preHandler: viewer, schema: { querystring: { type: 'object', additionalProperties: false, properties: {} } } },
    async () => (db.prepare(`${SELECT} ORDER BY p.name COLLATE NOCASE`).all() as ListRow[]).map(publicProfile));

  app.get<{ Params: { id: string } }>(`/${o.route}/:id`, { preHandler: viewer, schema: { params: ID_PARAMS } },
    async req => publicProfile(mustGet(req.params.id)));

  app.post<{ Body: { name: string; params?: Record<string, unknown> } }>(`/${o.route}`, {
    preHandler: member, schema: { body },
  }, async (req, reply) => {
    const id = newId();
    db.prepare(`INSERT INTO ${o.table} (id, name, params, created_by, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run(id, req.body.name.trim(), JSON.stringify(req.body.params ?? {}), req.me!.id, nowIso());
    reply.code(201);
    return publicProfile(mustGet(id));
  });

  app.put<{ Params: { id: string }; Body: { name: string; params?: Record<string, unknown> } }>(`/${o.route}/:id`, {
    preHandler: member, schema: { params: ID_PARAMS, body },
  }, async req => {
    const r = mustGet(req.params.id);
    /* ARQUITETURA 5.3: member edita o que é seu. Mudar os params de um perfil muda o resumo
     * de todas as sessões que o usam (inclusive as de outras pessoas). */
    mustEdit(req.me!, r);
    const params = req.body.params === undefined ? r.params : JSON.stringify(req.body.params);
    db.prepare(`UPDATE ${o.table} SET name = ?, params = ?, updated_at = ? WHERE id = ?`)
      .run(req.body.name.trim(), params, nowIso(), r.id);
    if (params !== r.params) recalc.enqueue(recalc.sessionsUsing(o.column, r.id));
    return publicProfile(mustGet(r.id));
  });

  app.delete<{ Params: { id: string } }>(`/${o.route}/:id`, { preHandler: member, schema: { params: ID_PARAMS } }, async (req, reply) => {
    const r = mustGet(req.params.id);
    mustEdit(req.me!, r);
    const using = recalc.sessionsUsing(o.column, r.id);
    db.prepare(`DELETE FROM ${o.table} WHERE id = ?`).run(r.id);   /* as sessões ficam sem o perfil (SET NULL) */
    recalc.enqueue(using);
    return reply.code(204).send();
  });
}
