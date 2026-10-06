/* Fórmulas (formulas.ts): parser, mensagens de erro com a posição, avaliação vetorizada,
 * NaN, deriv/smooth iguais às do core e applyFormulas. */
import { describe, it, expect } from 'vitest';
import { parseFormula, evalFormula, validateFormula, applyFormulas, formulaRefs, formulaKey, FormulaError, FORMULA_FUNCS, type FormulaEnv } from '../src/formulas';
import { deriv } from '../src/analysis';
import { smooth } from '../src/gps';
import { finishChannel } from '../src/parsers';
import type { Channel } from '../src/types';

const N = 50;
const t = Float64Array.from({ length: N }, (_, i) => i * 0.04);
const A = Float64Array.from({ length: N }, (_, i) => Math.sin(i / 5) * 10);
const B = Float64Array.from({ length: N }, (_, i) => (i % 7 === 3 ? NaN : i - 20));
const chans: Record<string, Float64Array> = { a: A, b: B, 'Shock_-_Front_Left': A, 'gps:speed': B };
const env: FormulaEnv = { t, channel: k => chans[k] };
const ev = (s: string) => evalFormula(s, env);
const scalar = (s: string) => ev(s)[0];
const err = (s: string): FormulaError => {
  try { ev(s); } catch (e) { return e as FormulaError; }
  throw new Error('não deu erro: ' + s);
};

describe('aritmética e precedência', () => {
  const cases: [string, number][] = [
    ['1 + 2 * 3', 7], ['(1 + 2) * 3', 9], ['2 ^ 3 ^ 2', 512], ['-2 ^ 2', -4], ['2 ^ -1', 0.5], ['(-2) ^ 2', 4],
    ['10 / 4', 2.5], ['10 - 4 - 3', 3], ['2 * -3', -6], ['--3', 3], ['+3', 3], ['1.5e2', 150], ['.5', 0.5], ['3.', 3],
    ['1 + 2 < 4', 1], ['1 < 2 == 1', 1], ['2 >= 3', 0], ['2 <= 2', 1], ['3 != 3', 0], ['3 == 3', 1], ['5 > 4', 1],
    ['pi', Math.PI], ['PI', Math.PI], ['e', Math.E], ['g', 9.81], ['2 * pi', 2 * Math.PI],
    ['abs(-3)', 3], ['sqrt(16)', 4], ['min(3, 1, 2)', 1], ['max(3, 1, 2)', 3], ['sin(0)', 0], ['cos(0)', 1], ['tan(0)', 0],
    ['atan2(1, 1)', Math.PI / 4], ['exp(0)', 1], ['ln(e)', 1], ['log10(1000)', 3], ['clamp(5, 0, 2)', 2], ['clamp(-5, 0, 2)', 0],
    ['if(1, 10, 20)', 10], ['if(0, 10, 20)', 20], ['if(2 > 1, 10, 20)', 10], ['1/0', Infinity], ['  7  ', 7],
  ];
  it.each(cases)('%s = %s', (s, v) => {
    const r = ev(s);
    expect(r.length).toBe(N);
    expect(r[0]).toBeCloseTo(v, 12);
    expect(r[N - 1]).toBeCloseTo(v, 12);
  });
  it('NaN se propaga', () => {
    for (const s of ['sqrt(-1)', '0/0', 'ln(-1)', 'if(0/0, 1, 2)', '(0/0) > 1', '(0/0) == (0/0)', 'clamp(0/0, 0, 1)', 'min(1, 0/0)']) expect(Number.isNaN(scalar(s))).toBe(true);
  });
});

describe('canais', () => {
  it('amostra a amostra, com NaN onde falta dado', () => {
    const r = ev('[a] * 2 + [b]');
    for (let i = 0; i < N; i++) {
      if (B[i] !== B[i]) expect(Number.isNaN(r[i])).toBe(true);
      else expect(r[i]).toBeCloseTo(A[i] * 2 + B[i], 12);
    }
  });
  it('chaves com espaços, hífens e dois-pontos', () => {
    expect(Array.from(ev('[Shock_-_Front_Left] - [ gps:speed ]'))).toEqual(Array.from(A, (x, i) => x - B[i]));
  });
  it('comparação vetorial e if', () => {
    const r = ev('if([a] > 0, [a], 0)');
    for (let i = 0; i < N; i++) expect(r[i]).toBe(A[i] > 0 ? A[i] : 0);
    const c = ev('[b] >= 0');
    for (let i = 0; i < N; i++) expect(Number.isNaN(c[i]) ? 'nan' : c[i]).toBe(B[i] !== B[i] ? 'nan' : B[i] >= 0 ? 1 : 0);
  });
  it('t = tempo do log', () => {
    expect(Array.from(ev('t * 2'))).toEqual(Array.from(t, x => x * 2));
    const r = ev('t');
    expect(r).not.toBe(t);            /* nunca devolve o próprio vetor de tempo */
  });
  it('deriv usa deriv() do core com H = 1,5 amostra; deriv(x, H) com H dado', () => {
    expect(Array.from(ev('deriv([a])'))).toEqual(Array.from(deriv(t, A, (t[N - 1] - t[0]) / (N - 1) * 1.5)));
    expect(Array.from(ev('deriv([b], 0.2)'))).toEqual(Array.from(deriv(t, B, 0.2)));
    expect(scalar('deriv(5)')).toBe(0);
  });
  it('smooth usa smooth() do GPS', () => {
    expect(Array.from(ev('smooth([b], 0.3)'))).toEqual(Array.from(smooth(t, B, 0.3)));
    expect(scalar('smooth(4, 1)')).toBe(4);
  });
  it('formulaRefs', () => {
    expect(formulaRefs(parseFormula('[a] + max([b], [a]) - deriv([c])'))).toEqual(['a', 'b', 'c']);
  });
});

describe('erros em português com a posição', () => {
  const cases: [string, RegExp, number][] = [
    ['(1 + 2', /Esperava '\)' na posição 7/, 7],
    ['1 + ', /incompleta.*posição 5/, 5],
    ['1 + * 2', /Esperava um número, canal, função ou '\(' na posição 5/, 5],
    ['[a', /Esperava '\]' na posição 3/, 3],
    ['[]', /Nome de canal vazio na posição 1/, 1],
    ['a]', /'\]' sem '\[' na posição 2/, 2],
    ['foo(1)', /Função desconhecida 'foo' na posição 1/, 1],
    ['velocidade * 2', /Nome desconhecido 'velocidade' na posição 1.*\[velocidade\]/, 1],
    ['2 # 3', /Caractere inesperado '#' na posição 3/, 3],
    ['abs(1, 2)', /'abs' precisa de 1 argumento \(recebeu 2\)/, 1],
    ['min(1)', /'min' precisa de pelo menos 2 argumentos/, 1],
    ['deriv()', /'deriv' precisa de 1 ou 2 argumentos/, 1],
    ['1 = 2', /Use '==' para comparar \(posição 3\)/, 3],
    ['1 2', /Esperava um operador na posição 3/, 3],
    ['(1))', /'\)' sem '\(' na posição 4/, 4],
    ['2pi', /Número malformado na posição 1/, 1],
    ['', /Fórmula vazia/, 1],
    ['   ', /Fórmula vazia/, 1],
    ['abs', /Esperava '\(' depois de 'abs' na posição 4/, 4],
    ['[x] + 1', /Canal desconhecido \[x\] na posição 1/, 1],
    ['deriv([a], 0)', /H tem que ser um número > 0/, 1],
    ['smooth([a], [a])', /s tem que ser um número/, 1],
    ['constructor(1)', /Função desconhecida 'constructor'/, 1],
    ['toString', /Nome desconhecido 'toString'/, 1],
  ];
  it.each(cases)('%s', (s, re, pos) => {
    const e = err(s);
    expect(e).toBeInstanceOf(FormulaError);
    expect(e.message).toMatch(re);
    expect(e.pos).toBe(pos);
  });
});

describe('validateFormula', () => {
  it('ok com os canais existentes', () => {
    expect(validateFormula('[a] - [b]', ['a', 'b'])).toEqual({ ok: true, refs: ['a', 'b'] });
    expect(validateFormula('[a] - 1', [{ key: 'a' }])).toEqual({ ok: true, refs: ['a'] });
  });
  it('canal inexistente com a posição', () => {
    expect(validateFormula('1 + [zz]', ['a'])).toEqual({ ok: false, msg: 'Canal desconhecido [zz] na posição 5', pos: 5 });
  });
  it('erro de sintaxe com a posição', () => {
    const r = validateFormula('max(1, 2', ['a']);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.pos).toBe(9); expect(r.msg).toContain("Esperava ')'"); }
  });
  it('não usa eval nem Function', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/formulas.ts', import.meta.url), 'utf8');
    expect(/\beval\s*\(|new Function|\bFunction\s*\(/.test(src)).toBe(false);
  });
  it('toda função documentada tem número de argumentos coerente', () => {
    for (const f of Object.values(FORMULA_FUNCS)) expect(f.min).toBeLessThanOrEqual(f.max);
  });
});

describe('applyFormulas', () => {
  const all: Channel[] = [finishChannel({ key: 'a', name: 'A', unit: 'mm', data: A, src: 'log' }), finishChannel({ key: 'b', name: 'B', unit: '', data: B, src: 'log' })];
  it('canais em ordem, cada um vê os anteriores; erros separados', () => {
    const errors: any[] = [];
    const out = applyFormulas({ S: { t }, all }, [
      { id: 'x', name: 'X', unit: 'mm', expr: '[a] * 2' },
      { id: 'y', name: '', unit: '', expr: '[f:x] + 1' },
      { id: 'z', name: 'Z', unit: '', expr: '[f:w]' },
      { id: 'v', name: 'vazia', unit: '', expr: '  ' },
      { id: 'c', name: 'C', unit: '', expr: '[a]' },
      { id: 'k', name: 'K', unit: 'g', expr: '3' },
    ], errors);
    expect(out.map(c => c.key)).toEqual(['f:x', 'f:y', 'f:c', 'f:k']);
    expect(out[1].name).toBe('[f:x] + 1');
    expect(out[1].data[10]).toBeCloseTo(A[10] * 2 + 1, 12);
    expect(out[2].data).not.toBe(A);                  /* cópia: não compartilha o vetor */
    expect(Array.from(out[2].data)).toEqual(Array.from(A));
    expect(out[3].constant).toBe(true);
    expect(out[3].lo).toBe(3);
    out.forEach(c => { expect(c.src).toBe('formula'); expect(c.group).toBe('Fórmulas'); });
    expect(errors).toEqual([{ id: 'z', name: 'Z', msg: 'Canal desconhecido [f:w] na posição 1', pos: 1 }]);
    expect(formulaKey({ id: 'q' })).toBe('f:q');
  });
});
