/* Juntar vários logs da FT450 numa sessão só (novo). A FT grava um arquivo por vez que o
 * carro liga ("Log 1", "Log 2", ...); num dia de teste saem vários, e a equipe quer ver o
 * dia inteiro numa visualização e com as contas feitas de uma vez.
 *
 * Cada arquivo passa pelo parseLog de sempre (os números de cada um não mudam). Os trechos
 * vão um atrás do outro, na ordem do nome (Log 2 antes de Log 10): o tempo do arquivo
 * seguinte começa uma amostra depois do fim do anterior, com uma linha sem dado no meio
 * (o gráfico mostra o corte e nenhuma conta liga o fim de um log ao começo do outro). O
 * tempo parado entre um log e outro (FT desligada) não entra: o relógio é o do carro ligado.
 *
 * A saída é um CSV no formato do FT Manager (TIME + um canal por coluna, a união dos canais
 * dos arquivos; canal que falta num arquivo fica sem dado naquele trecho), então guarda,
 * envia ao servidor e abre como qualquer outro log. Só CSV da FT: o log do BUSMASTER tem a
 * posição em latitude/longitude (S.gps), que o CSV não carrega. */
import type { Session } from './types';
import { guessDate } from './logdate';
import { parseLog } from './parsers';

/** Um arquivo para juntar (nome do arquivo e o texto inteiro). */
export interface MergeInput { name: string; text: string }

/** Trecho de cada arquivo no log juntado. */
export interface MergePart {
  name: string;                  /* nome do arquivo */
  label: string;                 /* nome curto ("Log 3") */
  t0: number; t1: number;        /* s, no tempo do log juntado */
  n: number;                     /* amostras */
  channels: string[];            /* chaves dos canais que este arquivo tem */
}

export interface MergeResult {
  name: string;                  /* nome da sessão ("Log 1 a Log 8 (8 logs)") */
  fileName: string;              /* nome do arquivo .csv (com a data da FT, para o guessDate) */
  text: string;                  /* o CSV juntado */
  parts: MergePart[];            /* na ordem em que entraram */
  channels: string[];            /* união dos canais, na ordem em que apareceram */
  duration: number;              /* s de log (sem os intervalos entre arquivos) */
}

/* "Log 3_20261014-1038_20261014-1039.csv" → "Log 3" (tira extensão e as datas da FT) */
export const logLabel = (fileName: string): string => {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  const s = base.replace(/(_\d{8}-\d{4})+$/, '').replace(/_/g, ' ').trim();
  return s || base;
};

/* ordem natural: "Log 2" antes de "Log 10" */
const natural = (a: string, b: string): number => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' });

/** Ordem dos arquivos: pela data/hora do nome (quando todos têm), depois pelo nome em ordem
 *  natural. A FT põe a hora com minuto só, então no mesmo minuto vale o número do log. */
export function mergeOrder<T extends { name: string }>(files: T[]): T[] {
  return files.slice().sort((a, b) => {
    const da = guessDate(a.name) || '', db = guessDate(b.name) || '';
    if (da && db && da !== db) return da < db ? -1 : 1;
    return natural(logLabel(a.name), logLabel(b.name));
  });
}

/* número como o FT Manager escreve (sem dado = vazio; o parseCSV lê vazio como NaN) */
const cell = (v: number): string => (v === v ? String(v) : '');

/** Junta os CSV da FT na ordem de mergeOrder. Erro (Error com mensagem em português) se
 *  houver menos de 2 arquivos, um log do BUSMASTER, um arquivo binário ou um que não lê. */
export function mergeLogs(files: MergeInput[]): MergeResult {
  if (files.length < 2) throw new Error('Escolha pelo menos 2 logs para juntar.');
  const ordered = mergeOrder(files);
  const sessions: { f: MergeInput; S: Session }[] = ordered.map(f => {
    let S: Session;
    try { S = parseLog(f.text, f.name); } catch (e) {
      throw new Error(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (S.kind !== 'FT') throw new Error(`${f.name}: só dá para juntar CSV da FT450 (o log do BUSMASTER vai como sessão separada).`);
    return { f, S };
  });

  /* união dos canais e das unidades, na ordem em que aparecem */
  const keys: string[] = [], units = new Map<string, string>();
  for (const { S } of sessions) for (const c of S.channels) {
    if (!units.has(c.key)) { keys.push(c.key); units.set(c.key, c.unit); }
    else if (!units.get(c.key) && c.unit) units.set(c.key, c.unit);
  }

  const lines: string[] = [['TIME', ...keys].join(',')];
  if (keys.some(k => units.get(k))) lines.push(['s', ...keys.map(k => units.get(k) || '')].join(','));
  const blank = ',' + keys.map(() => '').join(',');
  const parts: MergePart[] = [];
  let next = 0, duration = 0;
  sessions.forEach(({ f, S }, si) => {
    const t = S.t, n = t.length;
    const dt = n > 1 ? (t[n - 1] - t[0]) / (n - 1) : 0.04;
    const step = dt > 0 ? dt : 0.04;
    /* linha sem dado entre um arquivo e o outro */
    if (si > 0) { lines.push(fx(next) + blank); next += step; }
    const shift = si > 0 ? next - t[0] : 0;      /* o primeiro fica com o tempo dele */
    const cols = keys.map(k => S.channels.find(c => c.key === k)?.data ?? null);
    for (let i = 0; i < n; i++) {
      const row = [fx(t[i] + shift)];
      for (const d of cols) row.push(d ? cell(d[i]) : '');
      lines.push(row.join(','));
    }
    const t0 = t[0] + shift, t1 = t[n - 1] + shift;
    parts.push({ name: f.name, label: logLabel(f.name), t0, t1, n, channels: S.channels.map(c => c.key) });
    duration += t1 - t0;
    next = t1 + step;
  });

  const first = parts[0].label, last = parts[parts.length - 1].label;
  const name = `${first} a ${last} (${parts.length} logs)`;
  /* data/hora do primeiro arquivo no nome, no formato da FT, para o guessDate achar */
  const d = ordered.map(f => guessDate(f.name)).find(x => !!x && x.includes('T'));
  const stamp = d ? '_' + d.replace(/-/g, '').replace('T', '-').replace(':', '') : '';
  return { name, fileName: `${name}${stamp}.csv`, text: lines.join('\n') + '\n', parts, channels: keys, duration };
}

/* tempo com 3 casas, como o FT Manager (passos de 0,04 s não acumulam erro de soma) */
const fx = (v: number): string => (Math.round(v * 1000) / 1000).toFixed(3);

