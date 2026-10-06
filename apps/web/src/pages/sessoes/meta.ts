/* Utilidades das páginas Sessões e Visão geral: data do teste (tirada do nome do arquivo da
 * FT ou do cabeçalho do BUSMASTER, igual ao servidor), formatação de datas, configuração das
 * contas para um carro/pista escolhidos e o download do log original.
 * Nada aqui é conta de engenharia: só orquestração e texto. */
import type { AnalysisConfigInput, Session } from '@baja/core';
import type { Library, SessionMeta, SessionPatch } from '../../library';
import { configInput, useProfiles } from '../../state/profiles';

/* ---------------------------------------------------------------- data do teste */
const pad = (n: number | string) => String(n).padStart(2, '0');
const okDate = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h >= 0 && h < 24 && mi >= 0 && mi < 60;

/** Data do teste (AAAA-MM-DDTHH:MM ou AAAA-MM-DD) pelo nome do arquivo e, no BUSMASTER, pelo
 *  cabeçalho "***START DATE AND TIME 5:10:2026 16:34:30:698***". Mesmo critério de
 *  guessDate em apps/server/src/analysis.ts (sem o recurso do dia do envio).
 *  "Log 3_20261005-1644.csv" → 2026-10-05T16:44. */
export function guessDate(fileName: string, head = ''): string | null {
  const base = fileName.replace(/^.*[\\/]/, '');
  let m = /(20\d{2})(\d{2})(\d{2})[-_ T]?(\d{2})(\d{2})/.exec(base);
  if (m && okDate(+m[1], +m[2], +m[3], +m[4], +m[5])) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
  m = /START DATE AND TIME\s+(\d{1,2}):(\d{1,2}):(\d{4})\s+(\d{1,2}):(\d{1,2})/.exec(head.slice(0, 2000));
  if (m && okDate(+m[3], +m[2], +m[1], +m[4], +m[5])) return `${m[3]}-${pad(m[2])}-${pad(m[1])}T${pad(m[4])}:${pad(m[5])}`;
  m = /(20\d{2})-(\d{2})-(\d{2})/.exec(base);
  if (m && okDate(+m[1], +m[2], +m[3])) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /(20\d{2})(\d{2})(\d{2})/.exec(base);
  if (m && okDate(+m[1], +m[2], +m[3])) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

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
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = m.fileName || `${m.name}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const msgOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
