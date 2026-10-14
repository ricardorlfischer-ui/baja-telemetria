/* Juntar vários logs (merge.ts, novo): os logs de 14/10 (só RPM e Sonda_Geral = GPS Y) e
 * CSVs montados aqui. O que importa: cada trecho tem exatamente os números do arquivo
 * original, na ordem do nome, separados por uma linha sem dado. */
import { describe, it, expect } from 'vitest';
import { readFixture } from './legacy';
import { parseLog, looksBinary } from '../src/parsers';
import { mergeLogs, mergeOrder, logLabel } from '../src/merge';
import { guessDate } from '../src/logdate';
import { computeSession } from '../src/pipeline';

const DIA = ['Log 8_20261014-1038_20261014-1040.csv', 'Log 1_20261014-1038_20261014-1038.csv',
  'Log 7_20261014-1038_20261014-1039.csv', 'Log 4_20261014-1038_20261014-1039.csv'];
const files = () => DIA.map(name => ({ name, text: readFixture('teste_1410/' + name)! }));

describe('logLabel e ordem', () => {
  it('tira as datas da FT', () => {
    expect(logLabel('Log 6_20261014-1038_20261014-1039_20261014-1437.csv')).toBe('Log 6');
    expect(logLabel('C:\\x\\Log 3_20261005-1644.csv')).toBe('Log 3');
    expect(logLabel('teste chacara.csv')).toBe('teste chacara');
  });
  it('ordem natural do nome (Log 2 antes de Log 10) e data antes do nome', () => {
    const o = mergeOrder([{ name: 'Log 10_20261014-1038.csv' }, { name: 'Log 2_20261014-1038.csv' }, { name: 'Log 1_20261014-1040.csv' }]);
    expect(o.map(x => logLabel(x.name))).toEqual(['Log 2', 'Log 10', 'Log 1']);
  });
});

describe('mergeLogs', () => {
  it('os logs de 14/10: cada trecho igual ao arquivo, na ordem, com a linha sem dado no meio', () => {
    const r = mergeLogs(files());
    expect(r.parts.map(p => p.label)).toEqual(['Log 1', 'Log 4', 'Log 7', 'Log 8']);
    expect(r.name).toBe('Log 1 a Log 8 (4 logs)');
    expect(guessDate(r.fileName)).toBe('2026-10-14T10:38');
    const M = parseLog(r.text, r.fileName);
    expect(M.kind).toBe('FT');
    expect(M.channels.map(c => c.key)).toEqual(['RPM', 'Sonda_Geral']);
    /* cada trecho: mesmos valores do arquivo sozinho */
    let i = 0;
    r.parts.forEach((p, k) => {
      const S = parseLog(files().find(f => f.name === p.name)!.text, p.name);
      if (k > 0) { expect(M.channels.every(c => !(c.data[i] === c.data[i]))).toBe(true); i++; }   /* linha sem dado */
      expect(M.t[i]).toBeCloseTo(p.t0, 9);
      for (let j = 0; j < S.t.length; j++, i++) {
        for (const c of S.channels) {
          const v = M.channels.find(x => x.key === c.key)!.data[i];
          if (c.data[j] === c.data[j]) expect(v).toBe(c.data[j]); else expect(v).toBeNaN();
        }
        expect(M.t[i] - p.t0).toBeCloseTo(S.t[j] - S.t[0], 9);
      }
    });
    expect(i).toBe(M.t.length);
    /* tempo crescente, contínuo (passo de 0,04 s) */
    for (let k = 1; k < M.t.length; k++) expect(M.t[k] - M.t[k - 1]).toBeCloseTo(0.04, 6);
    expect(r.duration).toBeCloseTo(r.parts.reduce((s, p) => s + p.t1 - p.t0, 0), 9);
    /* abre e calcula como qualquer log */
    const ctx = computeSession(M, {});
    expect(ctx.all.length).toBeGreaterThan(0);
  });

  it('união dos canais: o que falta num arquivo fica sem dado naquele trecho; unidades passam', () => {
    const a = { name: 'Log 1_20261014-1000.csv', text: 'TIME,RPM,CVT_temp\ns,rpm,C\n0.04,1000,30\n0.08,1100,31\n0.12,1200,32\n' };
    const b = { name: 'Log 2_20261014-1010.csv', text: 'TIME,RPM,Wheel_speed\n0.04,2000,10\n0.08,2100,11\n' };
    const r = mergeLogs([b, a]);
    const M = parseLog(r.text, r.fileName);
    expect(M.channels.map(c => [c.key, c.unit])).toEqual([['RPM', 'rpm'], ['CVT_temp', 'C'], ['Wheel_speed', '']]);
    const get = (k: string) => Array.from(M.channels.find(c => c.key === k)!.data);
    expect(get('RPM')).toEqual([1000, 1100, 1200, NaN, 2000, 2100]);
    expect(get('CVT_temp')).toEqual([30, 31, 32, NaN, NaN, NaN]);
    expect(get('Wheel_speed')).toEqual([NaN, NaN, NaN, NaN, 10, 11]);
    expect(Array.from(M.t)).toEqual([0.04, 0.08, 0.12, 0.16, 0.2, 0.24]);
  });

  it('recusa menos de 2 arquivos, BUSMASTER e binário', () => {
    const ok = { name: 'a.csv', text: 'TIME,RPM\n0.04,1\n0.08,2\n' };
    expect(() => mergeLogs([ok])).toThrow(/pelo menos 2/);
    const bm = readFixture('busmaster_14.log')!;
    expect(() => mergeLogs([ok, { name: 'b.log', text: bm }])).toThrow(/BUSMASTER/);
    const bin = { name: 'Log 6.csv', text: '\u0000\ufffd\ufffdx'.repeat(300) };
    expect(looksBinary(bin.text)).toBe(true);
    expect(looksBinary(ok.text)).toBe(false);
    expect(() => mergeLogs([ok, bin])).toThrow(/Log 6\.csv: O arquivo é binário/);
    expect(() => parseLog(bin.text, bin.name)).toThrow(/ftml/);
  });
});

describe('avisos dos logs de 14/10 (exportação incompleta do FT Manager)', () => {
  it('um eixo do GPS só e log curto', async () => {
    const { dataQuality } = await import('../src/quality');
    const S = parseLog(readFixture('teste_1410/Log 8_20261014-1038_20261014-1040.csv')!, 'Log 8.csv');
    const ids = dataQuality(S, computeSession(S, {})).issues.map(i => i.id + ': ' + i.text);
    expect(ids.find(x => x.startsWith('gps.missing'))).toMatch(/só um eixo do GPS \(Sonda_Geral\); falta o X/);
    expect(ids.find(x => x.startsWith('log.short'))).toMatch(/10\.0 s/);
  });
});
