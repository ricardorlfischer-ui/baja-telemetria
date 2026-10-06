/* Envio de um log para a biblioteca, com as etapas para a barra de progresso:
 *  - local: lê o arquivo, analisa no navegador (parseLog + computeSession + sessionSummary,
 *    via addLogToLibrary) e guarda no IndexedDB;
 *  - servidor: RemoteLibrary.addSession com progresso (XMLHttpRequest), espera a
 *    análise do servidor e trata o 409 de log duplicado ({ error, id }). */
import { computeSession, parseLog } from '@baja/core';
import { ApiError, LocalDuplicateError, sha256Hex, type Library, type RemoteLibrary, type SessionMeta } from '../../library';
import { addLogToLibrary } from '../../state/librarySave';
import { configFor } from './meta';

export type UploadPhase = 'pending' | 'reading' | 'analyzing' | 'saving' | 'uploading' | 'server' | 'done' | 'duplicate' | 'error' | 'skipped';

export interface UploadMeta {
  date?: string;
  trackId?: string;
  carId?: string;
  driver?: string;
  tags?: string[];
  notes?: string;
  allowDuplicate?: boolean;
}

export class DuplicateError extends Error {
  readonly existingId: string | null;
  constructor(message: string, existingId: string | null) {
    super(message);
    this.name = 'DuplicateError';
    this.existingId = existingId;
  }
}

/** Cede o frame para a barra pintar antes da conta pesada. */
const yieldFrame = () => new Promise<void>(res => {
  let done = false;
  const go = () => { if (!done) { done = true; setTimeout(res, 0); } };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
  setTimeout(go, 60);
});

/** Modo local: lê, analisa com o carro/pista escolhidos e guarda com o resumo. */
export async function saveLocal(
  lib: Library, file: File, meta: UploadMeta, existing: SessionMeta[],
  onPhase: (p: UploadPhase, progress?: number) => void,
): Promise<SessionMeta> {
  onPhase('reading', 0.15);
  await yieldFrame();
  const text = await file.text();
  /* duplicado antes da conta: mesmo sha256 (como o servidor); sessões antigas guardadas sem
   * sha256 caem no critério de mesmo nome + mesmo tamanho */
  if (!meta.allowDuplicate) {
    const sha = await sha256Hex(text);
    const dup = existing.find(m => (sha && m.sha256 ? m.sha256 === sha : m.fileName === file.name && m.size === file.size));
    if (dup) throw new DuplicateError(`Este log já está na biblioteca ("${dup.name}")`, dup.id);
  }
  onPhase('analyzing', 0.45);
  await yieldFrame();
  const S = parseLog(text, file.name);
  const ctx = computeSession(S, configFor(meta.carId, meta.trackId), {});
  onPhase('saving', 0.85);
  await yieldFrame();
  const m: Parameters<Library['addSession']>[1] = {};
  if (meta.date) m.date = meta.date;
  if (meta.trackId) m.trackId = meta.trackId;
  if (meta.carId) m.carId = meta.carId;
  if (meta.driver) m.driver = meta.driver;
  if (meta.tags?.length) m.tags = meta.tags;
  if (meta.notes) m.notes = meta.notes;
  try {
    return await addLogToLibrary(lib, { name: file.name, text }, { ...m, ...(meta.allowDuplicate ? { allowDuplicate: true } : {}) }, ctx);
  } catch (e) {
    if (e instanceof LocalDuplicateError) throw new DuplicateError(e.message, e.existingId);
    throw e;
  }
}

/** Servidor da equipe: multipart (file + meta JSON) com progresso do envio
 *  (RemoteLibrary.addSession com onProgress). O 409 de log duplicado vira DuplicateError. */
export async function uploadRemote(
  remote: RemoteLibrary, file: File, meta: UploadMeta,
  onPhase: (p: UploadPhase, progress?: number) => void,
): Promise<SessionMeta> {
  const m: Parameters<RemoteLibrary['addSession']>[1] = {};
  if (meta.date) m.date = meta.date;
  if (meta.trackId) m.trackId = meta.trackId;
  if (meta.carId) m.carId = meta.carId;
  if (meta.driver) m.driver = meta.driver;
  if (meta.tags?.length) m.tags = meta.tags;
  if (meta.notes) m.notes = meta.notes;
  if (meta.allowDuplicate) m.allowDuplicate = true;
  try {
    return await remote.addSession(file, m, { onProgress: (phase, f) => onPhase(phase, f) });
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) throw new DuplicateError(e.message || 'Este log já está na biblioteca', e.existingId);
    if (e instanceof ApiError && e.status === 403) throw new Error(e.message || 'Sem permissão para enviar logs (papel "leitor")');
    throw e;
  }
}
