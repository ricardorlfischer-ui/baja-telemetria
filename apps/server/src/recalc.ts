/* Recálculo dos resumos: na hora (PATCH que troca carro/pista, POST /summary) ou em segundo
 * plano (resumos de versão antiga na subida, perfil de carro/pista alterado ou apagado).
 * A conta roda no processo de análise (src/analyzer.ts); a fila manda uma sessão por vez.
 *
 * Corridas: o resumo só é gravado se o carro/pista da sessão (e os params deles) ainda são os
 * mesmos de quando a conta começou. Se mudaram no meio, o resultado é descartado: quem mudou
 * já pediu outro recálculo (o PATCH recalcula na hora; o PUT/DELETE do perfil põe na fila; o
 * envio confere ao gravar). Assim o resumo guardado é sempre o do carro/pista atuais. */
import type { FastifyBaseLogger } from 'fastify';
import { SUMMARY_VERSION } from '@baja/core';
import type { DB, ProfileRow, SessionRow } from './db';
import type { Storage } from './storage';
import type { Analyzer } from './analyzer';
import { HttpError } from './errors';
import type { Params } from './analysis';

const parseParams = (row: Pick<ProfileRow, 'params'> | undefined): Params | null => {
  if (!row) return null;
  try { return JSON.parse(row.params) as Params; } catch { return {}; }
};

/** Perfis que entram na conta de uma sessão, com uma chave que muda quando qualquer um deles
 *  muda (troca de carro/pista, params editados, perfil apagado). */
export interface ProfileSnapshot { track: Params | null; car: Params | null; key: string }

export function profileSnapshot(db: DB, trackId: string | null | undefined, carId: string | null | undefined): ProfileSnapshot {
  const raw = (table: 'cars' | 'tracks', id: string | null | undefined) =>
    id ? (db.prepare(`SELECT params FROM ${table} WHERE id = ?`).get(id) as { params: string } | undefined)?.params ?? '∅' : '';
  const t = raw('tracks', trackId), c = raw('cars', carId);
  return {
    track: trackId && t !== '∅' ? parseParams({ params: t }) : null,
    car: carId && c !== '∅' ? parseParams({ params: c }) : null,
    key: JSON.stringify([trackId ?? null, t, carId ?? null, c]),
  };
}

/* erro do recálculo em português, sem caminho do servidor nem detalhe interno */
function summaryErrorOf(e: unknown): string {
  const code = (e as { code?: string } | null)?.code;
  if (code === 'ENOENT') return 'O arquivo do log desta sessão não está mais no servidor';
  if (e instanceof HttpError) return e.message;
  if (code === 'Z_DATA_ERROR' || code === 'Z_BUF_ERROR') return 'O arquivo do log desta sessão está corrompido no servidor';
  return 'Não deu para calcular o resumo: erro interno no servidor';
}

/** Recalcula e grava o resumo da sessão com o carro/pista atuais dela. Falha do cálculo fica
 *  em summary_error (o resumo fica vazio). Devolve false se a sessão não existe. */
export async function recomputeSummary(db: DB, storage: Storage, analyzer: Analyzer, id: string, log?: FastifyBaseLogger): Promise<boolean> {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  if (!row) return false;
  const snap = profileSnapshot(db, row.track_id, row.car_id);
  let summary: string | null = null, error: string | null = null;
  try {
    const res = await analyzer.run({ file: storage.pathOf(id), fileName: row.file_name, track: snap.track, car: snap.car });
    summary = res.summary ? JSON.stringify(res.summary) : null;
    error = res.summaryError;
  } catch (e) {
    if (e instanceof HttpError && e.statusCode === 503) throw e;   /* servidor encerrando: não grava nada */
    if (!(e instanceof HttpError)) log?.warn({ err: e }, `falha ao recalcular o resumo da sessão ${id}`);
    error = summaryErrorOf(e);
  }
  /* daqui até o UPDATE é tudo síncrono: ninguém muda a sessão no meio */
  const now = db.prepare('SELECT track_id, car_id FROM sessions WHERE id = ?').get(id) as Pick<SessionRow, 'track_id' | 'car_id'> | undefined;
  if (!now) return false;
  if (profileSnapshot(db, now.track_id, now.car_id).key !== snap.key) return true;   /* mudou no meio: outro recálculo grava */
  db.prepare('UPDATE sessions SET summary = ?, summary_version = ?, summary_error = ? WHERE id = ?')
    .run(summary, SUMMARY_VERSION, error, id);
  return true;
}

export class RecalcQueue {
  private queue = new Set<string>();
  private running = false;
  private closed = false;
  private waiters: (() => void)[] = [];

  constructor(private db: DB, private storage: Storage, private analyzer: Analyzer, private log: FastifyBaseLogger) {}

  /** Põe sessões na fila (sem repetir). */
  enqueue(ids: Iterable<string>): void {
    if (this.closed) return;
    for (const id of ids) this.queue.add(id);
    if (!this.running && this.queue.size) {
      this.running = true;
      setImmediate(() => void this.loop());
    }
  }

  /** Sessões que usam o carro/pista (para recalcular quando o perfil muda). */
  sessionsUsing(column: 'car_id' | 'track_id', id: string): string[] {
    return (this.db.prepare(`SELECT id FROM sessions WHERE ${column} = ?`).all(id) as { id: string }[]).map(r => r.id);
  }

  /** Resumos que faltam ou são de versão antiga das contas. */
  enqueueOutdated(): number {
    const ids = (this.db.prepare('SELECT id FROM sessions WHERE summary_version IS NULL OR summary_version <> ?')
      .all(SUMMARY_VERSION) as { id: string }[]).map(r => r.id);
    if (ids.length) this.log.info(`recalculando ${ids.length} resumo(s) de versão antiga em segundo plano`);
    this.enqueue(ids);
    return ids.length;
  }

  get pending(): number { return this.queue.size + (this.running ? 1 : 0); }

  /** Resolve quando a fila esvaziar. */
  idle(): Promise<void> {
    if (!this.running && !this.queue.size) return Promise.resolve();
    return new Promise(res => this.waiters.push(res));
  }

  close(): void {
    this.closed = true;
    this.queue.clear();
  }

  private async loop(): Promise<void> {
    while (this.queue.size && !this.closed) {
      const id = this.queue.values().next().value as string;
      this.queue.delete(id);
      try {
        await recomputeSummary(this.db, this.storage, this.analyzer, id, this.log);
      } catch (e) {
        if (this.closed) break;
        this.log.error({ err: e }, `falha ao recalcular o resumo da sessão ${id}`);
      }
      await new Promise<void>(res => setImmediate(res));
    }
    this.running = false;
    const w = this.waiters.splice(0);
    w.forEach(f => f());
  }
}
