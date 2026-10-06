/* Adaptador para o @baja/core: lê o log (parseLog), calcula a sessão (computeSession) com o
 * carro e a pista escolhidos e tira o resumo (sessionSummary). As contas são todas do core;
 * aqui só se monta a configuração a partir dos perfis guardados no banco.
 *
 *   pista: params do perfil de pista = TrackConfig (centro, tamanho, margem, canais X/Y,
 *          formato, suavização, volta mínima, linha). Sem linha salva → linha automática.
 *   carro: params do perfil do carro = CarConfig + susp (SuspConfig) opcional.
 *   sem perfil: padrões do core (DEFAULT_CFG / DEFAULT_CAR / DEFAULT_SUSP). */
import { computeSession, parseLog, sessionSummary, type AnalysisConfigInput, type Session, type SessionSummary } from '@baja/core';
import { badRequest } from './errors';

export type Params = Record<string, unknown>;

/** Texto do log a partir dos bytes enviados (UTF-8, BOM descartado). */
export const decodeLog = (raw: Buffer | Uint8Array): string => new TextDecoder('utf-8').decode(raw);

/** parseLog com o erro do parser virando 400 em português. */
export function parseOrFail(text: string, fileName: string): Session {
  let S: Session;
  try {
    S = parseLog(text, fileName);
  } catch (e) {
    const msg = e instanceof Error && e.message ? e.message : String(e);
    throw badRequest(`Não consegui ler o log "${fileName}": ${msg}`);
  }
  if (!S.t || S.t.length < 2) throw badRequest(`Não consegui ler o log "${fileName}": nenhuma amostra com tempo válido`);
  return S;
}

const isObj = (v: unknown): v is Params => !!v && typeof v === 'object' && !Array.isArray(v);

/** Configuração da análise a partir dos perfis (os campos desconhecidos passam adiante;
 *  o core ignora o que não usa). */
export function analysisConfig(track?: Params | null, car?: Params | null): { cfg: AnalysisConfigInput; autoLine: boolean } {
  const t: Params = isObj(track) ? { ...track } : {};
  const c: Params = isObj(car) ? { ...car } : {};
  const susp = isObj(c.susp) ? { ...c.susp } : undefined;
  delete c.susp;
  delete t.car; delete t.susp; delete t.formulas;
  const cfg = { ...t, car: c, ...(susp ? { susp } : {}) } as AnalysisConfigInput;
  const line = cfg.line;
  const hasLine = Array.isArray(line) && line.length >= 2;
  if (!hasLine) cfg.line = null;
  return { cfg, autoLine: !hasLine };
}

/** Resumo da sessão com o carro e a pista dados. */
export function summarize(S: Session, track?: Params | null, car?: Params | null): SessionSummary {
  const { cfg, autoLine } = analysisConfig(track, car);
  return sessionSummary(computeSession(S, cfg, { autoLine }));
}

/* ---------------------------------------------------------------- trabalho do processo de análise */
/** O que a análise (analysis-worker.ts) usa: os bytes do log e os perfis. */
export interface AnalyzeJob {
  raw: Uint8Array;
  fileName: string;
  track: Params | null;
  car: Params | null;
  /** agora (ms) para a data do BUSMASTER sem cabeçalho */
  now: number;
}

/** Mensagens da análise, em ordem: leu (ou não leu) o log, depois o resumo. Assim, se o
 *  processo morrer no resumo (memória, tempo), o servidor ainda sabe o tipo e a data do log. */
export type AnalyzeMsg =
  | { type: 'readError'; code: string }
  | { type: 'parseError'; message: string }
  | { type: 'parsed'; kind: Session['kind']; date: string | null }
  | { type: 'done'; summary: SessionSummary | null; summaryError: string | null };

/** Lê o log e calcula o resumo, avisando cada etapa por `emit`. */
export function analyzeLog(job: AnalyzeJob, emit: (m: AnalyzeMsg) => void): void {
  let text: string, S: Session;
  try {
    text = decodeLog(job.raw);
    S = parseOrFail(text, job.fileName);
  } catch (e) {
    emit({ type: 'parseError', message: e instanceof Error && e.message ? e.message : String(e) });
    return;
  }
  emit({ type: 'parsed', kind: S.kind, date: guessDate(job.fileName, text, S, new Date(job.now)) });
  text = '';   /* o texto do log não serve mais: libera antes das contas */
  try {
    emit({ type: 'done', summary: summarize(S, job.track, job.car), summaryError: null });
  } catch (e) {
    emit({ type: 'done', summary: null, summaryError: `Não deu para calcular o resumo: ${e instanceof Error && e.message ? e.message : String(e)}` });
  }
}

/* ---------------------------------------------------------------- data do teste */
const pad = (n: number | string) => String(n).padStart(2, '0');
const okDate = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h >= 0 && h < 24 && mi >= 0 && mi < 60;

/** Data do teste (AAAA-MM-DDTHH:MM ou AAAA-MM-DD) quando o usuário não informou:
 *  - nome do arquivo da FT: "Log 3_20261005-1644.csv" → 2026-10-05T16:44;
 *  - BUSMASTER: "***START DATE AND TIME 5:10:2026 16:34:30:698***" do cabeçalho; sem ele,
 *    só a hora do primeiro quadro (clock0) com o dia do envio;
 *  - data AAAA-MM-DD solta no nome do arquivo. */
export function guessDate(fileName: string, text: string, S: Pick<Session, 'kind' | 'clock0'>, now = new Date()): string | null {
  const base = fileName.replace(/^.*[\\/]/, '');
  let m = /(20\d{2})(\d{2})(\d{2})[-_ T]?(\d{2})(\d{2})/.exec(base);
  if (m && okDate(+m[1], +m[2], +m[3], +m[4], +m[5])) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
  if (S.kind === 'BUSMASTER') {
    m = /START DATE AND TIME\s+(\d{1,2}):(\d{1,2}):(\d{4})\s+(\d{1,2}):(\d{1,2})/.exec(text.slice(0, 2000));
    if (m && okDate(+m[3], +m[2], +m[1], +m[4], +m[5])) return `${m[3]}-${pad(m[2])}-${pad(m[1])}T${pad(m[4])}:${pad(m[5])}`;
    const c = /^(\d{1,2}):(\d{2})/.exec(S.clock0 || '');
    if (c && +c[1] < 24 && +c[2] < 60) {
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(c[1])}:${c[2]}`;
    }
  }
  m = /(20\d{2})-(\d{2})-(\d{2})/.exec(base);
  if (m && okDate(+m[1], +m[2], +m[3])) return `${m[1]}-${m[2]}-${m[3]}`;
  if (m === null) {
    m = /(20\d{2})(\d{2})(\d{2})/.exec(base);
    if (m && okDate(+m[1], +m[2], +m[3])) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  return null;
}
