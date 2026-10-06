/* Utilidades das páginas Sessões e Visão geral: data do teste, formatação de datas,
 * configuração das contas para um carro/pista escolhidos e o download do log original.
 * Nada aqui é conta de engenharia: só orquestração e texto. */
import type { AnalysisConfigInput, Session } from '@baja/core';
import type { Library, SessionMeta, SessionPatch } from '../../library';
import { configInput, useProfiles } from '../../state/profiles';
import { downloadText } from '../../components/download';

/* ---------------------------------------------------------------- data do teste */
/* A data do teste (pelo nome do arquivo da FT ou pelo cabeçalho do BUSMASTER) vem do
 * guessDate do core, o mesmo que o servidor usa (docs/ARQUITETURA.md 3.3). */

/* formatação das datas: a mesma de toda a interface (library/format.ts) */
export { fmtSessionDate as fmtDate, fmtDateTime as fmtIso } from '../../library';

/** Separa a data do teste em dia (AAAA-MM-DD) e hora (HH:MM) para os campos nativos. */
export const splitDate = (d: string | null | undefined): { day: string; time: string } => {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(d || '');
  return m ? { day: m[1], time: m[2] || '' } : { day: '', time: '' };
};
export const joinDate = (day: string, time: string): string => (day ? (time ? `${day}T${time}` : day) : '');

/** Tamanho do arquivo legível. */
export const fmtSize = (b: number): string =>
  b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${(b / 1024).toFixed(0)} kB` : `${b} B`;

export const kindLabel = (k: Session['kind'] | string | undefined): string => (k === 'BUSMASTER' ? 'CAN · BUSMASTER' : 'FT450 · FT Manager');

/* ---------------------------------------------------------------- configuração das contas */
/** Configuração para calcular um log com o carro e a pista escolhidos no envio (o mesmo que
 *  setActiveCar/setActiveTrack fariam com o draft), sem mexer no perfil ativo. */
export function configFor(carId?: string | null, trackId?: string | null): AnalysisConfigInput {
  const P = useProfiles.getState();
  let input = configInput(false);
  const car = carId && carId !== P.activeCarId ? P.cars.find(c => c.id === carId) : undefined;
  if (car) {
    const { susp, ...c } = car.params;
    input = { ...input, car: { ...c }, susp: { ...(susp || {}) } } as AnalysisConfigInput;
  }
  const tr = trackId && trackId !== P.activeTrackId ? P.tracks.find(t => t.id === trackId) : undefined;
  if (tr) input = { ...input, ...tr.params } as AnalysisConfigInput;
  return input;
}

/* ---------------------------------------------------------------- dados editáveis */
export interface MetaDraft {
  name: string;
  day: string;
  time: string;
  trackId: string | null;
  carId: string | null;
  driver: string;
  tags: string[];
  notes: string;
}

export const draftOf = (m?: Partial<SessionMeta> | null): MetaDraft => {
  const { day, time } = splitDate(m?.date);
  return {
    name: m?.name || '', day, time,
    trackId: m?.trackId || null, carId: m?.carId || null,
    driver: m?.driver || '', tags: m?.tags ? [...m.tags] : [], notes: m?.notes || '',
  };
};

/** Patch para updateSession. Campo apagado vai como null (o servidor limpa; o local guarda
 *  null, que a interface lê como vazio). */
export function patchOf(d: MetaDraft): SessionPatch {
  const date = joinDate(d.day, d.time);
  const p: Record<string, unknown> = {
    date: date || null,
    trackId: d.trackId || null,
    carId: d.carId || null,
    driver: d.driver.trim() || null,
    tags: d.tags.map(s => s.trim()).filter(Boolean),
    notes: d.notes.trim() || null,
  };
  if (d.name.trim()) p.name = d.name.trim();
  return p as SessionPatch;
}

/* ---------------------------------------------------------------- baixar o log original */
export async function downloadLog(lib: Library, m: SessionMeta): Promise<void> {
  const text = await lib.getSessionText(m.id);
  downloadText(m.fileName || `${m.name}.csv`, text, 'text/plain;charset=utf-8');
}

export const msgOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
