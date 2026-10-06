/* Backup da biblioteca LOCAL (IndexedDB) num arquivo JSON: perfis de carro e pista, sessões
 * com o texto do log, anotações, a configuração em uso, fórmulas e layouts da página Canais.
 * Serve para levar tudo para outro computador ou para o servidor da equipe, e para não perder
 * nada ao limpar o navegador. Só lê e grava pela LocalLibrary; nenhuma conta muda. */
import type { Formula } from '@baja/core';
import { LocalLibrary, type CarProfile, type Comment, type SessionMeta, type TrackProfile } from '../../library';
import { usePrefs, type ChannelLayout } from '../../state/prefs';
import { useProfiles, type ConfigDraft } from '../../state/profiles';

export const BACKUP_FORMAT = 'baja-telemetria-backup';
export const BACKUP_VERSION = 1;

export interface BackupSession { meta: SessionMeta; text: string; comments: Comment[] }
export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  app: string;
  cars: CarProfile[];
  tracks: TrackProfile[];
  sessions: BackupSession[];
  config?: { draft: ConfigDraft; activeCarId: string | null; activeTrackId: string | null };
  formulas?: Formula[];
  channelLayouts?: Record<string, ChannelLayout>;
}

export interface BackupCounts { cars: number; tracks: number; sessions: number; comments: number; bytes: number }

/** Monta o backup (lê o texto de cada sessão: pode demorar com logs grandes). */
export async function exportBackup(appVersion: string, onProgress?: (done: number, total: number) => void): Promise<Backup> {
  const lib = new LocalLibrary();
  const [cars, tracks, metas] = await Promise.all([lib.listCars(), lib.listTracks(), lib.listSessions()]);
  const sessions: BackupSession[] = [];
  for (let k = 0; k < metas.length; k++) {
    onProgress?.(k, metas.length);
    const m = metas[k];
    const text = await lib.getSessionText(m.id);
    const comments = await lib.listComments(m.id);
    sessions.push({ meta: m, text, comments });
  }
  onProgress?.(metas.length, metas.length);
  const P = useProfiles.getState();
  return {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), app: appVersion,
    cars, tracks, sessions,
    config: { draft: P.draft, activeCarId: P.activeCarId, activeTrackId: P.activeTrackId },
    formulas: P.formulas,
    channelLayouts: usePrefs.getState().channelLayouts,
  };
}

/** Confere o arquivo e conta o que tem dentro (erro em português se não for um backup). */
export function parseBackup(text: string): { backup: Backup; counts: BackupCounts } {
  let b: Backup;
  try { b = JSON.parse(text) as Backup; } catch { throw new Error('O arquivo não é um JSON válido.'); }
  if (!b || typeof b !== 'object' || b.format !== BACKUP_FORMAT) throw new Error('Este arquivo não é um backup da Telemetria da Mauá Racing Baja.');
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) throw new Error('Backup de uma versão mais nova do app: atualize o app antes de importar.');
  const arr = <T,>(x: unknown): T[] => (Array.isArray(x) ? x as T[] : []);
  b.cars = arr<CarProfile>(b.cars).filter(c => c && typeof c.id === 'string' && typeof c.name === 'string');
  b.tracks = arr<TrackProfile>(b.tracks).filter(t => t && typeof t.id === 'string' && typeof t.name === 'string');
  b.sessions = arr<BackupSession>(b.sessions).filter(s => s && s.meta && typeof s.text === 'string');
  const comments = b.sessions.reduce((a, s) => a + arr(s.comments).length, 0);
  const bytes = b.sessions.reduce((a, s) => a + s.text.length, 0);
  return { backup: b, counts: { cars: b.cars.length, tracks: b.tracks.length, sessions: b.sessions.length, comments, bytes } };
}

export interface ImportOptions { profiles: boolean; sessions: boolean; config: boolean }
export interface ImportResult { cars: number; tracks: number; sessions: number; skipped: number; comments: number }

/** Grava o backup na biblioteca local. Perfis com o mesmo id são substituídos; sessões que já
 *  existem (mesmo arquivo e tamanho) são puladas para não duplicar. */
export async function importBackup(b: Backup, o: ImportOptions, onProgress?: (done: number, total: number) => void): Promise<ImportResult> {
  const lib = new LocalLibrary();
  const res: ImportResult = { cars: 0, tracks: 0, sessions: 0, skipped: 0, comments: 0 };
  if (o.profiles) {
    for (const c of b.cars) { await lib.saveCar({ id: c.id, name: c.name, params: c.params || {} }); res.cars++; }
    for (const t of b.tracks) { await lib.saveTrack({ id: t.id, name: t.name, params: t.params || {} }); res.tracks++; }
  }
  if (o.sessions) {
    const have = await lib.listSessions();
    const key = (m: Pick<SessionMeta, 'fileName' | 'size'>) => `${m.fileName}|${m.size}`;
    const seen = new Set(have.map(key));
    for (let k = 0; k < b.sessions.length; k++) {
      onProgress?.(k, b.sessions.length);
      const s = b.sessions[k], m = s.meta;
      if (seen.has(key(m))) { res.skipped++; continue; }
      const added = await lib.addSession({ name: m.fileName || m.name, text: s.text }, {
        name: m.name, kind: m.kind, tags: m.tags || [], date: m.date, trackId: m.trackId, carId: m.carId,
        driver: m.driver, notes: m.notes, summary: m.summary,
      });
      seen.add(key(added));
      res.sessions++;
      for (const c of Array.isArray(s.comments) ? s.comments : []) {
        try { await lib.addComment(added.id, { t: c.t ?? null, text: c.text }); res.comments++; } catch { /* anotação vazia */ }
      }
    }
    onProgress?.(b.sessions.length, b.sessions.length);
  }
  if (o.config) {
    const d = b.config?.draft;
    if (d && typeof d === 'object') {
      /* troca a configuração em uso pela do backup (o carro é substituído; pista e suspensão
       * recebem os campos do backup) e recalcula a sessão aberta */
      const P = useProfiles.getState();
      P.resetCar(false);
      P.applyPatch({ ...(d.track || {}), car: { ...(d.car || {}) }, susp: { ...(d.susp || {}) } }, false);
    }
    if (Array.isArray(b.formulas)) useProfiles.getState().setFormulas(b.formulas);
    if (b.channelLayouts && typeof b.channelLayouts === 'object') {
      usePrefs.getState().set({ channelLayouts: { ...usePrefs.getState().channelLayouts, ...b.channelLayouts } });
    }
  }
  return res;
}
