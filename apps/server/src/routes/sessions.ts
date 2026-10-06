/* Sessões (logs) da biblioteca: enviar (multipart: file + meta JSON), listar com filtros,
 * ver, editar dados, apagar, baixar o log e recalcular o resumo.
 *
 * O log é guardado como veio (bytes originais em gzip). O resumo (sessionSummary do core)
 * é calculado no envio com o carro e a pista escolhidos e recalculado quando eles mudam. */
import crypto from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { SUMMARY_VERSION } from '@baja/core';
import { nowIso, newId, type DB, type SessionRow } from '../db';
import { canEdit, requireRole } from '../auth';
import { badRequest, conflict, describeValidation, forbidden, HttpError, notFound } from '../errors';
import { profileSnapshot, recomputeSummary } from '../recalc';
import { ID, ID_PARAMS } from './schemas';

type Row = SessionRow & { uploader_name: string | null };

const TAG = { type: 'string', minLength: 1, maxLength: 40 } as const;
const TAGS = { type: 'array', maxItems: 30, items: TAG } as const;
const NULLABLE = (s: Record<string, unknown>) => ({ ...s, type: [s.type as string, 'null'] });

/* campos editáveis (envio e PATCH) */
const META_PROPS = {
  name: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
  date: NULLABLE({ type: 'string', maxLength: 40 }),
  trackId: NULLABLE(ID),
  carId: NULLABLE(ID),
  driver: NULLABLE({ type: 'string', maxLength: 100 }),
  tags: TAGS,
  notes: NULLABLE({ type: 'string', maxLength: 10_000 }),
};
const META_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { ...META_PROPS, allowDuplicate: { type: 'boolean' } },
};

export interface SessionMetaIn {
  name?: string; date?: string | null; trackId?: string | null; carId?: string | null;
  driver?: string | null; tags?: string[]; notes?: string | null; allowDuplicate?: boolean;
}

const opt = <T>(v: T | null | undefined): T | undefined => (v === null || v === undefined ? undefined : v);
const parseJson = <T>(s: string | null, def: T): T => {
  if (!s) return def;
  try { return JSON.parse(s) as T; } catch { return def; }
};

/** Sessão como a API devolve (SessionMeta da interface). */
export const publicSession = (r: Row) => ({
  id: r.id,
  name: r.name,
  fileName: r.file_name,
  kind: r.kind,
  size: r.size,
  sha256: r.sha256,
  createdAt: r.created_at,
  uploadedBy: opt(r.uploader_name),
  uploadedById: opt(r.uploaded_by),
  date: opt(r.date),
  trackId: opt(r.track_id),
  carId: opt(r.car_id),
  driver: opt(r.driver),
  tags: parseJson<string[]>(r.tags, []),
  notes: opt(r.notes),
  summary: parseJson<unknown>(r.summary, undefined) ?? undefined,
  summaryVersion: opt(r.summary_version),
  summaryError: opt(r.summary_error),
  summaryOutdated: r.summary_version !== SUMMARY_VERSION || undefined,
});

const SELECT = `SELECT s.*, u.name AS uploader_name FROM sessions s LEFT JOIN users u ON u.id = s.uploaded_by`;
export const getSessionRow = (db: DB, id: string): Row | undefined =>
  db.prepare(`${SELECT} WHERE s.id = ?`).get(id) as Row | undefined;

const cleanTags = (tags: string[] | undefined): string[] =>
  [...new Set((tags || []).map(t => t.trim()).filter(Boolean))];
const cleanText = (s: string | null | undefined): string | null => (s === null || s === undefined ? null : s.trim() || null);

/* nome de arquivo seguro para guardar e para o Content-Disposition */
const cleanFileName = (s: string | undefined): string => {
  // eslint-disable-next-line no-control-regex
  const b = path.basename((s || '').replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (b || 'log.csv').slice(0, 200);
};

/** Cliente aceita gzip? (Accept-Encoding com gzip ou * e q > 0) */
export function acceptsGzip(header: string | string[] | undefined): boolean {
  const h = Array.isArray(header) ? header.join(',') : header || '';
  for (const part of h.split(',')) {
    const [enc, ...params] = part.trim().toLowerCase().split(';').map(x => x.trim());
    if (enc !== 'gzip' && enc !== 'x-gzip' && enc !== '*') continue;
    const q = params.find(p => p.startsWith('q='));
    if (!q || parseFloat(q.slice(2)) > 0) return true;
  }
  return false;
}

/* RFC 6266/5987: nome ASCII entre aspas (sem aspas, barra invertida nem controle) e o nome
 * original em filename* (encodeURIComponent deixa ' ( ) * soltos, que o RFC 5987 não aceita) */
const rfc5987 = (s: string): string => encodeURIComponent(s).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
export const contentDisposition = (name: string): string => {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${rfc5987(name)}`;
};

const escLike = (s: string) => s.replace(/[\\%_]/g, c => '\\' + c);

export default async function sessionsRoutes(app: FastifyInstance): Promise<void> {
  const { db, storage } = app;
  const viewer = requireRole('viewer'), member = requireRole('member');

  const mustGet = (id: string): Row => {
    const r = getSessionRow(db, id);
    if (!r) throw notFound('Sessão não encontrada');
    return r;
  };
  const checkProfiles = (b: { trackId?: string | null; carId?: string | null }) => {
    if (b.trackId && !db.prepare('SELECT 1 FROM tracks WHERE id = ?').get(b.trackId)) throw badRequest('Pista não encontrada');
    if (b.carId && !db.prepare('SELECT 1 FROM cars WHERE id = ?').get(b.carId)) throw badRequest('Carro não encontrado');
  };
  const mustEdit = (req: FastifyRequest, r: Row) => {
    if (!canEdit(req.me!, r.uploaded_by)) throw forbidden('Só quem enviou a sessão (ou um administrador) pode mudar ou apagar');
  };

  /* ------------------------------------------------------------ lista */
  app.get<{ Querystring: { q?: string; trackId?: string; carId?: string; tag?: string } }>('/sessions', {
    preHandler: viewer,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: { q: { type: 'string', maxLength: 200 }, trackId: ID, carId: ID, tag: { type: 'string', maxLength: 40 } },
      },
    },
  }, async req => {
    const where: string[] = [], args: unknown[] = [];
    const q = req.query.q?.trim();
    if (q) {
      for (const word of q.split(/\s+/)) {
        const like = `%${escLike(word)}%`;
        where.push(`(s.name LIKE ? ESCAPE '\\' OR s.driver LIKE ? ESCAPE '\\' OR s.notes LIKE ? ESCAPE '\\'
          OR s.file_name LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM json_each(s.tags) WHERE value LIKE ? ESCAPE '\\'))`);
        args.push(like, like, like, like, like);
      }
    }
    if (req.query.trackId) { where.push('s.track_id = ?'); args.push(req.query.trackId); }
    if (req.query.carId) { where.push('s.car_id = ?'); args.push(req.query.carId); }
    const tag = req.query.tag?.trim();
    if (tag) { where.push('EXISTS (SELECT 1 FROM json_each(s.tags) WHERE value = ? COLLATE NOCASE)'); args.push(tag); }
    const sql = `${SELECT}${where.length ? ' WHERE ' + where.join(' AND ') : ''}
      ORDER BY COALESCE(s.date, s.created_at) DESC, s.created_at DESC`;
    return (db.prepare(sql).all(...args) as Row[]).map(publicSession);
  });

  /* ------------------------------------------------------------ envio */
  app.post('/sessions', { preHandler: member }, async (req, reply) => {
    if (!req.isMultipart()) throw new HttpError(415, 'Envie o log como multipart/form-data (campos file e meta)');
    let raw: Buffer | null = null, fileName = '', metaText: string | undefined;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'file' || raw) { await part.toBuffer(); throw badRequest('O arquivo do log vai no campo "file" (um só)'); }
        raw = await part.toBuffer();
        fileName = cleanFileName(part.filename);
      } else if (part.fieldname === 'meta') {
        metaText = String(part.value ?? '');
      }
    }
    if (!raw) throw badRequest('Falta o arquivo do log (campo "file")');
    if (!raw.length) throw badRequest('O arquivo está vazio');

    let meta: SessionMetaIn = {};
    if (metaText && metaText.trim()) {
      let parsed: unknown;
      try { parsed = JSON.parse(metaText); } catch { throw badRequest('O campo "meta" não é um JSON válido'); }
      const validate = req.compileValidationSchema(META_SCHEMA);
      if (!validate(parsed)) throw badRequest(describeValidation(validate.errors as never));
      meta = parsed as SessionMetaIn;
    }
    checkProfiles(meta);

    const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
    const checkDuplicate = () => {
      if (meta.allowDuplicate) return;
      const dup = db.prepare('SELECT id, name FROM sessions WHERE sha256 = ? ORDER BY created_at LIMIT 1').get(sha256) as { id: string; name: string } | undefined;
      if (dup) throw conflict(`Este log já está na biblioteca ("${dup.name}")`, { id: dup.id });
    };
    checkDuplicate();

    /* guarda o arquivo e o processo de análise lê dele (log ilegível: apaga e responde 400) */
    const id = newId(), size = raw.length;
    await storage.save(id, raw);
    raw = null;   /* os bytes já estão no disco: não seguram memória durante a análise */
    try {
      const snap = profileSnapshot(db, meta.trackId, meta.carId);
      const res = await app.analyzer.run({ file: storage.pathOf(id), fileName, track: snap.track, car: snap.car });
      if (res.summaryError) req.log.warn(`resumo da sessão enviada "${fileName}": ${res.summaryError}`);
      /* daqui até o INSERT é síncrono: confere de novo o que pode ter mudado durante a análise */
      checkProfiles(meta);   /* carro/pista apagado no meio → 400, nada fica guardado */
      checkDuplicate();      /* o mesmo log enviado duas vezes ao mesmo tempo */
      const row: SessionRow = {
        id,
        name: meta.name?.trim() || fileName.replace(/\.[^.]+$/, '') || fileName,
        file_name: fileName,
        kind: res.kind,
        size,
        sha256,
        uploaded_by: req.me!.id,
        created_at: nowIso(),
        date: cleanText(meta.date) ?? res.date,
        track_id: meta.trackId ?? null,
        car_id: meta.carId ?? null,
        driver: cleanText(meta.driver),
        tags: JSON.stringify(cleanTags(meta.tags)),
        notes: cleanText(meta.notes),
        summary: res.summary ? JSON.stringify(res.summary) : null,
        summary_version: SUMMARY_VERSION,
        summary_error: res.summaryError,
      };
      db.prepare(`INSERT INTO sessions (id, name, file_name, kind, size, sha256, uploaded_by, created_at, date, track_id,
        car_id, driver, tags, notes, summary, summary_version, summary_error) VALUES (@id, @name, @file_name, @kind, @size,
        @sha256, @uploaded_by, @created_at, @date, @track_id, @car_id, @driver, @tags, @notes, @summary, @summary_version,
        @summary_error)`).run(row);
      /* os params do carro/pista mudaram durante a análise (o PUT não via esta sessão ainda) */
      if (profileSnapshot(db, meta.trackId, meta.carId).key !== snap.key) app.recalc.enqueue([id]);
    } catch (e) {
      await storage.remove(id);
      throw e;
    }
    reply.code(201);
    return publicSession(getSessionRow(db, id)!);
  });

  /* ------------------------------------------------------------ uma sessão */
  app.get<{ Params: { id: string } }>('/sessions/:id', { preHandler: viewer, schema: { params: ID_PARAMS } },
    async req => publicSession(mustGet(req.params.id)));

  app.patch<{ Params: { id: string }; Body: Omit<SessionMetaIn, 'allowDuplicate'> }>('/sessions/:id', {
    preHandler: member,
    schema: { params: ID_PARAMS, body: { type: 'object', additionalProperties: false, properties: META_PROPS } },
  }, async req => {
    const r = mustGet(req.params.id);
    mustEdit(req, r);
    const b = req.body;
    checkProfiles(b);
    const set: string[] = [], args: unknown[] = [];
    const put = (col: string, v: unknown) => { set.push(`${col} = ?`); args.push(v); };
    if (b.name !== undefined) put('name', b.name.trim());
    if (b.date !== undefined) put('date', cleanText(b.date));
    if (b.trackId !== undefined) put('track_id', b.trackId);
    if (b.carId !== undefined) put('car_id', b.carId);
    if (b.driver !== undefined) put('driver', cleanText(b.driver));
    if (b.tags !== undefined) put('tags', JSON.stringify(cleanTags(b.tags)));
    if (b.notes !== undefined) put('notes', cleanText(b.notes));
    if (set.length) db.prepare(`UPDATE sessions SET ${set.join(', ')} WHERE id = ?`).run(...args, r.id);
    /* carro ou pista mudou: o resumo muda junto */
    const profileChanged = (b.trackId !== undefined && b.trackId !== r.track_id) || (b.carId !== undefined && b.carId !== r.car_id);
    if (profileChanged) await recomputeSummary(db, storage, app.analyzer, r.id, req.log);
    return publicSession(mustGet(r.id));
  });

  app.delete<{ Params: { id: string } }>('/sessions/:id', { preHandler: member, schema: { params: ID_PARAMS } }, async (req, reply) => {
    const r = mustGet(req.params.id);
    mustEdit(req, r);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(r.id);   /* anotações vão junto (cascade) */
    await storage.remove(r.id);
    return reply.code(204).send();
  });

  /* ------------------------------------------------------------ arquivo do log */
  app.get<{ Params: { id: string } }>('/sessions/:id/file', { preHandler: viewer, schema: { params: ID_PARAMS } }, async (req, reply) => {
    const r = mustGet(req.params.id);
    const gzSize = await storage.gzSize(r.id);
    if (gzSize === null) throw notFound('O arquivo desta sessão sumiu do servidor');
    reply
      .type('text/plain; charset=utf-8')
      .header('Content-Disposition', contentDisposition(r.file_name))
      .header('Vary', 'Accept-Encoding')
      .header('Cache-Control', 'private, max-age=0, must-revalidate')
      .header('ETag', `"${r.sha256}"`);
    const gz = acceptsGzip(req.headers['accept-encoding']);
    if (gz) reply.header('Content-Encoding', 'gzip');
    if (req.method === 'HEAD') return reply.send();   /* sem abrir o arquivo */
    /* em stream: o log não vai inteiro para a memória */
    return reply.send(gz ? storage.gzStream(r.id) : storage.rawStream(r.id));
  });

  /* ------------------------------------------------------------ recalcular o resumo */
  app.post<{ Params: { id: string } }>('/sessions/:id/summary', {
    preHandler: member,
    schema: { params: ID_PARAMS, body: { type: 'object', additionalProperties: false, properties: {} } },
  }, async req => {
    const r = mustGet(req.params.id);
    await recomputeSummary(db, storage, app.analyzer, r.id, req.log);
    return publicSession(mustGet(r.id));
  });
}
