/* Biblioteca local: IndexedDB do navegador (funciona sem internet e sem servidor).
 * O texto do log é guardado comprimido com CompressionStream('gzip') quando o navegador tem;
 * senão, como texto puro. Carros, pistas e anotações também ficam aqui. */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { SUMMARY_VERSION } from '@baja/core';
import { LocalQuotaError, ensurePersisted, isQuotaError } from './storage';
import type {
  CarProfile, Comment, Library, LogInput, SessionKind, SessionMeta, SessionPatch, SessionQuery, TrackProfile,
} from './types';

interface StoredFile { id: string; gz: boolean; data: Blob | string }

interface BajaDB extends DBSchema {
  sessions: { key: string; value: SessionMeta; indexes: { createdAt: string } };
  files: { key: string; value: StoredFile };
  cars: { key: string; value: CarProfile };
  tracks: { key: string; value: TrackProfile };
  comments: { key: string; value: Comment; indexes: { sessionId: string } };
}

/* resumo calculado com uma versão antiga das contas (como o summaryOutdated do servidor);
 * o campo só existe na leitura, não é gravado */
const withFlags = (m: SessionMeta): SessionMeta => {
  const { summaryOutdated: _old, ...rest } = m;
  return rest.summary && rest.summary.version !== SUMMARY_VERSION ? { ...rest, summaryOutdated: true } : rest;
};

const DB_NAME = 'baja-telemetria';
const DB_VERSION = 1;

export const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

/* ---------------------------------------------------------------- gzip */
export const hasCompression = (): boolean =>
  typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

export async function gzipText(text: string): Promise<Blob> {
  const s = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(s).blob();
}
export async function gunzipToText(b: Blob): Promise<string> {
  const s = b.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(s).text();
}

/** Tipo do log pelo conteúdo (mesmo critério de parseLog). Quem já leu a Session deve passar
 *  meta.kind = S.kind; isto é só o padrão. */
export function guessKind(_name: string, text: string): SessionKind {
  const head = text.slice(0, 4000);
  if (/\*\*\*BUSMASTER/.test(head) || head.includes('<Time><Tx/Rx>')) return 'BUSMASTER';
  return 'FT';
}

const byteLength = (s: string): number => new Blob([s]).size;

/** sha256 do texto do log (hex), como o servidor guarda; null sem crypto.subtle (http sem TLS). */
export async function sha256Hex(text: string): Promise<string | null> {
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle) return null;
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}

/** Log repetido na biblioteca local (mesmo comportamento do 409 do servidor). */
export class LocalDuplicateError extends Error {
  readonly existingId: string;
  constructor(message: string, existingId: string) {
    super(message);
    this.name = 'LocalDuplicateError';
    this.existingId = existingId;
  }
}

/** Sessão que não existe (mais) na biblioteca local (como o 404 do servidor). */
export class LocalNotFoundError extends Error {
  constructor(message = 'Sessão não encontrada na biblioteca local') {
    super(message);
    this.name = 'LocalNotFoundError';
  }
}

async function readInput(f: LogInput): Promise<{ name: string; text: string }> {
  if (typeof File !== 'undefined' && f instanceof File) return { name: f.name, text: await f.text() };
  return f as { name: string; text: string };
}

const matches = (m: SessionMeta, q?: SessionQuery): boolean => {
  if (!q) return true;
  if (q.trackId && m.trackId !== q.trackId) return false;
  if (q.carId && m.carId !== q.carId) return false;
  if (q.tag && !m.tags.includes(q.tag)) return false;
  if (q.q) {
    const s = q.q.toLowerCase();
    const hay = [m.name, m.fileName, m.driver, m.notes, ...m.tags].filter(Boolean).join(' ').toLowerCase();
    if (!hay.includes(s)) return false;
  }
  return true;
};

/* fila do addSession (da página, não da instância: o StrictMode e o redetect criam outras) */
let addQueue: Promise<unknown> = Promise.resolve();

export class LocalLibrary implements Library {
  readonly mode = 'local' as const;
  private dbp: Promise<IDBPDatabase<BajaDB>> | null = null;

  private db(): Promise<IDBPDatabase<BajaDB>> {
    if (!this.dbp) {
      this.dbp = openDB<BajaDB>(DB_NAME, DB_VERSION, {
        upgrade(db) {
          const s = db.createObjectStore('sessions', { keyPath: 'id' });
          s.createIndex('createdAt', 'createdAt');
          db.createObjectStore('files', { keyPath: 'id' });
          db.createObjectStore('cars', { keyPath: 'id' });
          db.createObjectStore('tracks', { keyPath: 'id' });
          const c = db.createObjectStore('comments', { keyPath: 'id' });
          c.createIndex('sessionId', 'sessionId');
        },
      }).catch(e => {
        this.dbp = null;
        throw new Error('Não consegui abrir a biblioteca local do navegador (IndexedDB bloqueado ou aba anônima?): ' + (e as Error).message);
      });
    }
    return this.dbp;
  }

  /* ------------------------------------------------------------ sessões */
  async listSessions(q?: SessionQuery): Promise<SessionMeta[]> {
    const all = await (await this.db()).getAll('sessions');
    return all.filter(m => matches(m, q)).sort((a, b) => (b.date || b.createdAt).localeCompare(a.date || a.createdAt)).map(withFlags);
  }

  async getSession(id: string): Promise<SessionMeta> {
    const m = await (await this.db()).get('sessions', id);
    if (!m) throw new LocalNotFoundError();
    return withFlags(m);
  }

  async getSessionText(id: string): Promise<string> {
    const f = await (await this.db()).get('files', id);
    if (!f) throw new LocalNotFoundError('O arquivo desta sessão não está na biblioteca local');
    if (!f.gz) return typeof f.data === 'string' ? f.data : await f.data.text();
    if (!hasCompression()) throw new Error('Este navegador não sabe descomprimir o log guardado (sem DecompressionStream)');
    return gunzipToText(f.data as Blob);
  }

  /** Guarda o log. Mesmo sha256 de uma sessão já guardada → LocalDuplicateError (a não ser
   *  com meta.allowDuplicate), como o 409 do servidor. Um de cada vez nesta aba: a procura do
   *  sha256 e a gravação são passos separados (o gzip fica no meio), e dois guardar do mesmo log
   *  ao mesmo tempo (página Sessões + "Guardar na biblioteca") passariam os dois pela procura. */
  addSession(file: LogInput, meta: Parameters<Library['addSession']>[1] & { allowDuplicate?: boolean } = {}): Promise<SessionMeta> {
    const run = addQueue.then(() => this.addSessionNow(file, meta));
    addQueue = run.catch(() => undefined);
    return run;
  }

  private async addSessionNow(file: LogInput, meta: Parameters<Library['addSession']>[1] & { allowDuplicate?: boolean }): Promise<SessionMeta> {
    const { name, text } = await readInput(file);
    const sha256 = await sha256Hex(text);
    if (sha256 && !meta.allowDuplicate) {
      const dup = (await (await this.db()).getAll('sessions')).find(s => s.sha256 === sha256);
      if (dup) throw new LocalDuplicateError(`Este log já está na biblioteca ("${dup.name}")`, dup.id);
    }
    const id = newId();
    const m: SessionMeta = {
      id,
      name: meta.name || name.replace(/\.[^.]+$/, ''),
      fileName: name,
      kind: meta.kind || guessKind(name, text),
      size: byteLength(text),
      createdAt: new Date().toISOString(),
      tags: meta.tags || [],
      ...(meta.date ? { date: meta.date } : {}),
      ...(meta.trackId ? { trackId: meta.trackId } : {}),
      ...(meta.carId ? { carId: meta.carId } : {}),
      ...(meta.driver ? { driver: meta.driver } : {}),
      ...(meta.notes ? { notes: meta.notes } : {}),
      ...(meta.summary ? { summary: meta.summary } : {}),
      ...(sha256 ? { sha256 } : {}),
    };
    const stored: StoredFile = hasCompression()
      ? { id, gz: true, data: await gzipText(text) }
      : { id, gz: false, data: text };
    const db = await this.db();
    const tx = db.transaction(['sessions', 'files'], 'readwrite');
    try {
      await Promise.all([tx.objectStore('sessions').put(m), tx.objectStore('files').put(stored), tx.done]);
    } catch (e) {
      /* sem espaço: o put pode falhar com AbortError e a transação com QuotaExceededError */
      if (isQuotaError(e) || isQuotaError(tx.error)) throw new LocalQuotaError();
      throw e;
    }
    /* 1ª sessão guardada (ou ainda sem proteção): pede ao navegador para não apagar os logs
     * sozinho quando faltar espaço no disco (uma vez por carga da página) */
    void ensurePersisted();
    return m;
  }

  async updateSession(id: string, patch: SessionPatch): Promise<SessionMeta> {
    const db = await this.db();
    const m = await db.get('sessions', id);
    if (!m) throw new LocalNotFoundError();
    const { summaryOutdated: _o, ...n } = { ...m, ...patch, id } as SessionMeta;
    await db.put('sessions', n);
    return withFlags(n);
  }

  async deleteSession(id: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['sessions', 'files', 'comments'], 'readwrite');
    const cs = await tx.objectStore('comments').index('sessionId').getAllKeys(id);
    await Promise.all([
      tx.objectStore('sessions').delete(id),
      tx.objectStore('files').delete(id),
      ...cs.map(k => tx.objectStore('comments').delete(k)),
      tx.done,
    ]);
  }

  /* ------------------------------------------------------------ carros e pistas */
  async listCars(): Promise<CarProfile[]> {
    return (await (await this.db()).getAll('cars')).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }
  async saveCar(p: Omit<CarProfile, 'id'> & { id?: string }): Promise<CarProfile> {
    const c: CarProfile = { ...p, id: p.id || newId(), updatedAt: new Date().toISOString() };
    await (await this.db()).put('cars', c);
    return c;
  }
  async deleteCar(id: string): Promise<void> { await (await this.db()).delete('cars', id); }

  async listTracks(): Promise<TrackProfile[]> {
    return (await (await this.db()).getAll('tracks')).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }
  async saveTrack(p: Omit<TrackProfile, 'id'> & { id?: string }): Promise<TrackProfile> {
    const t: TrackProfile = { ...p, id: p.id || newId(), updatedAt: new Date().toISOString() };
    await (await this.db()).put('tracks', t);
    return t;
  }
  async deleteTrack(id: string): Promise<void> { await (await this.db()).delete('tracks', id); }

  /* ------------------------------------------------------------ anotações */
  async listComments(sessionId: string): Promise<Comment[]> {
    const cs = await (await this.db()).getAllFromIndex('comments', 'sessionId', sessionId);
    return cs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async addComment(sessionId: string, c: { t?: number | null; text: string }): Promise<Comment> {
    const text = c.text.trim();
    if (!text) throw new Error('A anotação está vazia');
    const n: Comment = { id: newId(), sessionId, t: c.t ?? null, text, createdAt: new Date().toISOString() };
    await (await this.db()).put('comments', n);
    return n;
  }
  async deleteComment(id: string): Promise<void> { await (await this.db()).delete('comments', id); }
}
