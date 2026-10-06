/* Canais calculados pelo usuário (docs/ARQUITETURA.md 3.7), sem eval nem Function:
 * tokenizador + parser recursivo → árvore → avaliação vetorizada amostra a amostra.
 *
 *   [Shock_-_Front_Left] - [Shock_-_Front_Right]          canais pela chave entre colchetes
 *   ([veh:P] * 1000) / max([veh:v] / 3.6, 1)              também os calculados (gps:, veh:, susp:)
 *   if([gps:speed] > 5, [susp:rough], 0)                  comparações dão 1 ou 0
 *
 * Precedência (da menor para a maior): comparação < > <= >= == !=, depois + -, * /,
 * sinal (- +), potência ^ (associa à direita: 2^3^2 = 2^9; -2^2 = -4).
 * NaN se propaga (amostra sem dado continua sem dado; comparação com NaN dá NaN).
 * Constantes: pi, e, g (9,81 m/s², o mesmo G0 das contas do carro), t (tempo do log, s).
 * Funções: abs sqrt min max sin cos tan atan2 exp ln log10 deriv(x[, H]) smooth(x, s)
 * clamp(x, a, b) if(c, a, b). Ângulos em radianos.
 * deriv(x) = derivada no tempo (por segundo) com a mesma diferença central de analysis.ts;
 * sem H usa ±1,5 amostra, o mesmo H com que o app deriva a velocidade dos amortecedores
 * quando a FT não grava (suspPrep). smooth(x, s) = média móvel centrada de s segundos
 * (a mesma do GPS). */
import type { Channel, Formula, Session } from './types';
import { deriv } from './analysis';
import { smooth } from './gps';
import { finishChannel } from './parsers';

/** Erro de sintaxe ou de canal; pos = posição (1 = primeiro caractere). */
export class FormulaError extends Error {
  pos: number;
  constructor(msg: string, pos: number) { super(msg); this.name = 'FormulaError'; this.pos = pos; }
}

/** Nó da árvore da fórmula. pos = posição no texto (1 = primeiro caractere). */
export type FormulaNode =
  | { type: 'num'; value: number; pos: number }
  | { type: 'chan'; key: string; pos: number }
  | { type: 'const'; name: string; pos: number }
  | { type: 'neg'; arg: FormulaNode; pos: number }
  | { type: 'bin'; op: '+' | '-' | '*' | '/' | '^' | '<' | '>' | '<=' | '>=' | '==' | '!='; a: FormulaNode; b: FormulaNode; pos: number }
  | { type: 'call'; name: string; args: FormulaNode[]; pos: number };

/** Constantes aceitas sem colchetes. */
export const FORMULA_CONSTS: Record<string, { value?: number; desc: string }> = {
  pi: { value: Math.PI, desc: 'π = 3,14159…' },
  e: { value: Math.E, desc: 'número de Euler = 2,71828…' },
  g: { value: 9.81, desc: 'gravidade, 9,81 m/s² (a mesma das contas do carro)' },
  t: { desc: 'tempo do log (s)' },
};

/** Funções aceitas: número de argumentos [mín, máx] e descrição para a ajuda da interface. */
export const FORMULA_FUNCS: Record<string, { min: number; max: number; desc: string }> = {
  abs: { min: 1, max: 1, desc: 'valor absoluto' },
  sqrt: { min: 1, max: 1, desc: 'raiz quadrada' },
  min: { min: 2, max: 16, desc: 'menor dos valores' },
  max: { min: 2, max: 16, desc: 'maior dos valores' },
  sin: { min: 1, max: 1, desc: 'seno (radianos)' },
  cos: { min: 1, max: 1, desc: 'cosseno (radianos)' },
  tan: { min: 1, max: 1, desc: 'tangente (radianos)' },
  atan2: { min: 2, max: 2, desc: 'atan2(y, x), ângulo em radianos' },
  exp: { min: 1, max: 1, desc: 'eˣ' },
  ln: { min: 1, max: 1, desc: 'logaritmo natural' },
  log10: { min: 1, max: 1, desc: 'logaritmo na base 10' },
  deriv: { min: 1, max: 2, desc: 'derivada no tempo (por s); deriv(x, H) usa a diferença central em ±H s' },
  smooth: { min: 2, max: 2, desc: 'smooth(x, s): média móvel centrada de s segundos' },
  clamp: { min: 3, max: 3, desc: 'clamp(x, a, b): limita x entre a e b' },
  if: { min: 3, max: 3, desc: 'if(c, a, b): a onde c ≠ 0, b onde c = 0 (NaN onde c é NaN)' },
};

/* ---------------------------------------------------------------- tokenizador */
type Tok =
  | { k: 'num'; v: number; pos: number }
  | { k: 'chan'; v: string; pos: number }
  | { k: 'id'; v: string; pos: number }
  | { k: 'op'; v: string; pos: number }
  | { k: 'end'; pos: number };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    const pos = i + 1;
    if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i))!;
      if (/^[eE]/.test(src.slice(i + m[0].length)) || /^[A-Za-z_]/.test(src.slice(i + m[0].length))) {
        throw new FormulaError(`Número malformado na posição ${pos}`, pos);
      }
      out.push({ k: 'num', v: parseFloat(m[0]), pos });
      i += m[0].length;
      continue;
    }
    if (c === '[') {
      const j = src.indexOf(']', i + 1);
      if (j < 0) throw new FormulaError(`Esperava ']' na posição ${n + 1}`, n + 1);
      const key = src.slice(i + 1, j).trim();
      if (!key) throw new FormulaError(`Nome de canal vazio na posição ${pos}`, pos);
      out.push({ k: 'chan', v: key, pos });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ k: 'id', v: m[0], pos });
      i += m[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '==' || two === '!=') { out.push({ k: 'op', v: two, pos }); i += 2; continue; }
    if ('+-*/^(),<>'.includes(c)) { out.push({ k: 'op', v: c, pos }); i++; continue; }
    if (c === ']') throw new FormulaError(`']' sem '[' na posição ${pos}`, pos);
    if (c === '=') throw new FormulaError(`Use '==' para comparar (posição ${pos})`, pos);
    throw new FormulaError(`Caractere inesperado '${c}' na posição ${pos}`, pos);
  }
  out.push({ k: 'end', pos: n + 1 });
  return out;
}

/* ---------------------------------------------------------------- parser */
const tokText = (t: Tok) => (t.k === 'end' ? 'o fim' : t.k === 'chan' ? `[${t.v}]` : `'${t.v}'`);

/** Lê a fórmula e devolve a árvore. Lança FormulaError com a posição. */
export function parseFormula(expr: string): FormulaNode {
  const src = String(expr ?? '');
  const toks = tokenize(src);
  if (toks.length === 1) throw new FormulaError('Fórmula vazia', 1);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => { const t = toks[p]; return t.k === 'op' && t.v === v; };
  const expect = (v: string) => {
    const t = toks[p];
    if (!(t.k === 'op' && t.v === v)) throw new FormulaError(`Esperava '${v}' na posição ${t.pos} (achei ${tokText(t)})`, t.pos);
    p++;
  };

  const comparison = (): FormulaNode => {
    let a = additive();
    for (;;) {
      const t = peek();
      if (t.k === 'op' && ['<', '>', '<=', '>=', '==', '!='].includes(t.v)) {
        p++;
        a = { type: 'bin', op: t.v as '<', a, b: additive(), pos: t.pos };
      } else return a;
    }
  };
  const additive = (): FormulaNode => {
    let a = multiplicative();
    for (;;) {
      const t = peek();
      if (t.k === 'op' && (t.v === '+' || t.v === '-')) { p++; a = { type: 'bin', op: t.v, a, b: multiplicative(), pos: t.pos }; }
      else return a;
    }
  };
  const multiplicative = (): FormulaNode => {
    let a = unary();
    for (;;) {
      const t = peek();
      if (t.k === 'op' && (t.v === '*' || t.v === '/')) { p++; a = { type: 'bin', op: t.v, a, b: unary(), pos: t.pos }; }
      else return a;
    }
  };
  const unary = (): FormulaNode => {
    const t = peek();
    if (t.k === 'op' && t.v === '-') { p++; return { type: 'neg', arg: unary(), pos: t.pos }; }
    if (t.k === 'op' && t.v === '+') { p++; return unary(); }
    return power();
  };
  const power = (): FormulaNode => {
    const a = primary();
    const t = peek();
    if (t.k === 'op' && t.v === '^') { p++; return { type: 'bin', op: '^', a, b: unary(), pos: t.pos }; }
    return a;
  };
  const primary = (): FormulaNode => {
    const t = peek();
    if (t.k === 'num') { p++; return { type: 'num', value: t.v, pos: t.pos }; }
    if (t.k === 'chan') { p++; return { type: 'chan', key: t.v, pos: t.pos }; }
    if (t.k === 'op' && t.v === '(') {
      p++;
      const e = comparison();
      expect(')');
      return e;
    }
    if (t.k === 'id') {
      p++;
      const name = t.v.toLowerCase();
      if (isOp('(')) {
        const f = Object.hasOwn(FORMULA_FUNCS, name) ? FORMULA_FUNCS[name] : undefined;
        if (!f) throw new FormulaError(`Função desconhecida '${t.v}' na posição ${t.pos}`, t.pos);
        p++;
        const args: FormulaNode[] = [];
        if (!isOp(')')) {
          args.push(comparison());
          while (isOp(',')) { p++; args.push(comparison()); }
        }
        expect(')');
        if (args.length < f.min || args.length > f.max) {
          const want = f.min === f.max ? `${f.min}` : f.max > 3 ? `pelo menos ${f.min}` : `${f.min} ou ${f.max}`;
          throw new FormulaError(`'${name}' precisa de ${want} argumento${f.max > 1 ? 's' : ''} (recebeu ${args.length}) na posição ${t.pos}`, t.pos);
        }
        return { type: 'call', name, args, pos: t.pos };
      }
      if (Object.hasOwn(FORMULA_CONSTS, name)) return { type: 'const', name, pos: t.pos };
      if (Object.hasOwn(FORMULA_FUNCS, name)) throw new FormulaError(`Esperava '(' depois de '${t.v}' na posição ${t.pos + t.v.length}`, t.pos + t.v.length);
      throw new FormulaError(`Nome desconhecido '${t.v}' na posição ${t.pos}: canais vão entre colchetes, ex. [${t.v}]`, t.pos);
    }
    if (t.k === 'end') throw new FormulaError(`Fórmula incompleta: esperava um número, canal, função ou '(' na posição ${t.pos}`, t.pos);
    throw new FormulaError(`Esperava um número, canal, função ou '(' na posição ${t.pos} (achei ${tokText(t)})`, t.pos);
  };

  const root = comparison();
  const t = peek();
  if (t.k !== 'end') {
    if (t.k === 'op' && t.v === ')') throw new FormulaError(`')' sem '(' na posição ${t.pos}`, t.pos);
    throw new FormulaError(`Esperava um operador na posição ${t.pos} (achei ${tokText(t)})`, t.pos);
  }
  return root;
}

/** Chaves de canal usadas na fórmula (na ordem em que aparecem, sem repetir). */
export function formulaRefs(node: FormulaNode): string[] {
  const out: string[] = [];
  const walk = (x: FormulaNode) => {
    if (x.type === 'chan') { if (!out.includes(x.key)) out.push(x.key); }
    else if (x.type === 'neg') walk(x.arg);
    else if (x.type === 'bin') { walk(x.a); walk(x.b); }
    else if (x.type === 'call') x.args.forEach(walk);
  };
  walk(node);
  return out;
}

/** Resultado de validateFormula (para a interface mostrar o erro ao digitar). */
export type FormulaCheck = { ok: true; refs: string[] } | { ok: false; msg: string; pos: number };

/* posição de um canal na fórmula (para a mensagem de canal inexistente) */
function findChan(node: FormulaNode, key: string): number {
  let pos = 1;
  const walk = (x: FormulaNode): boolean => {
    if (x.type === 'chan' && x.key === key) { pos = x.pos; return true; }
    if (x.type === 'neg') return walk(x.arg);
    if (x.type === 'bin') return walk(x.a) || walk(x.b);
    if (x.type === 'call') return x.args.some(walk);
    return false;
  };
  walk(node);
  return pos;
}

/** Confere sintaxe e canais. channels = chaves disponíveis (ou os próprios canais). */
export function validateFormula(expr: string, channels: readonly (string | { key: string })[]): FormulaCheck {
  try {
    const node = parseFormula(expr);
    const keys = new Set(channels.map(c => (typeof c === 'string' ? c : c.key)));
    const refs = formulaRefs(node);
    for (const k of refs) {
      if (!keys.has(k)) { const pos = findChan(node, k); return { ok: false, msg: `Canal desconhecido [${k}] na posição ${pos}`, pos }; }
    }
    return { ok: true, refs };
  } catch (e) {
    if (e instanceof FormulaError) return { ok: false, msg: e.message, pos: e.pos };
    throw e;
  }
}

/* ---------------------------------------------------------------- avaliação */
/** O que a avaliação precisa: o tempo e um jeito de achar o canal pela chave. */
export interface FormulaEnv {
  t: Float64Array;
  channel: (key: string) => ArrayLike<number> | undefined;
}

type Val = number | Float64Array;

/* aplica f amostra a amostra (escalar × vetor = vetor) */
function map1(a: Val, f: (x: number) => number): Val {
  if (typeof a === 'number') return f(a);
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = f(a[i]);
  return out;
}
function mapN(args: Val[], n: number, f: (xs: number[]) => number): Val {
  if (args.every(a => typeof a === 'number')) return f(args as number[]);
  const out = new Float64Array(n), xs = new Array<number>(args.length);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < args.length; k++) { const a = args[k]; xs[k] = typeof a === 'number' ? a : a[i]; }
    out[i] = f(xs);
  }
  return out;
}
const vec = (a: Val, n: number): Float64Array => (typeof a === 'number' ? new Float64Array(n).fill(a) : a);
/* comparação: 1/0, NaN se algum lado for NaN */
const cmp = (ok: boolean, x: number, y: number) => (x !== x || y !== y ? NaN : ok ? 1 : 0);

const BIN: Record<string, (x: number, y: number) => number> = {
  '+': (x, y) => x + y,
  '-': (x, y) => x - y,
  '*': (x, y) => x * y,
  '/': (x, y) => x / y,
  '^': (x, y) => Math.pow(x, y),
  '<': (x, y) => cmp(x < y, x, y),
  '>': (x, y) => cmp(x > y, x, y),
  '<=': (x, y) => cmp(x <= y, x, y),
  '>=': (x, y) => cmp(x >= y, x, y),
  '==': (x, y) => cmp(x === y, x, y),
  '!=': (x, y) => cmp(x !== y, x, y),
};
const FN1: Record<string, (x: number) => number> = {
  abs: Math.abs, sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, ln: Math.log, log10: Math.log10,
};
/* min/max com NaN: NaN (como Math.min/Math.max) */
const FNN: Record<string, (xs: number[]) => number> = {
  min: xs => Math.min(...xs),
  max: xs => Math.max(...xs),
  atan2: xs => Math.atan2(xs[0], xs[1]),
  clamp: xs => (xs[0] !== xs[0] || xs[1] !== xs[1] || xs[2] !== xs[2] ? NaN : Math.min(Math.max(xs[0], xs[1]), xs[2])),
  if: xs => (xs[0] !== xs[0] ? NaN : xs[0] !== 0 ? xs[1] : xs[2]),
};

/* H padrão de deriv(x): ±1,5 amostra, como suspPrep (dt = período médio do log) */
const defaultH = (t: Float64Array) => {
  const n = t.length, dt = n > 1 ? (t[n - 1] - t[0]) / (n - 1) : 0.04;
  return dt * 1.5;
};

function evalNode(x: FormulaNode, env: FormulaEnv, borrowed: Set<Float64Array>): Val {
  const n = env.t.length;
  switch (x.type) {
    case 'num': return x.value;
    case 'const': if (x.name === 't') { borrowed.add(env.t); return env.t; } return FORMULA_CONSTS[x.name].value!;
    case 'chan': {
      const d = env.channel(x.key);
      if (!d) throw new FormulaError(`Canal desconhecido [${x.key}] na posição ${x.pos}`, x.pos);
      if (d.length !== n) throw new FormulaError(`O canal [${x.key}] não tem o tamanho do log (posição ${x.pos})`, x.pos);
      if (!(d instanceof Float64Array)) return Float64Array.from(d);
      borrowed.add(d);
      return d;
    }
    case 'neg': return map1(evalNode(x.arg, env, borrowed), v => -v);
    case 'bin': {
      const a = evalNode(x.a, env, borrowed), b = evalNode(x.b, env, borrowed), f = BIN[x.op];
      if (typeof a === 'number' && typeof b === 'number') return f(a, b);
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) out[i] = f(typeof a === 'number' ? a : a[i], typeof b === 'number' ? b : b[i]);
      return out;
    }
    case 'call': {
      const args = x.args.map(a => evalNode(a, env, borrowed));
      if (Object.hasOwn(FN1, x.name)) return map1(args[0], FN1[x.name]);
      if (x.name === 'deriv') {
        const H = args.length > 1 ? args[1] : defaultH(env.t);
        if (typeof H !== 'number' || !(H > 0)) throw new FormulaError(`deriv(x, H): H tem que ser um número > 0 (s), na posição ${x.pos}`, x.pos);
        return typeof args[0] === 'number' ? 0 : deriv(env.t, args[0], H);
      }
      if (x.name === 'smooth') {
        const s = args[1];
        if (typeof s !== 'number' || !(s >= 0)) throw new FormulaError(`smooth(x, s): s tem que ser um número ≥ 0 (s), na posição ${x.pos}`, x.pos);
        return typeof args[0] === 'number' ? args[0] : smooth(env.t, args[0], s);
      }
      return mapN(args, n, FNN[x.name]);
    }
  }
}

/** Avalia a fórmula (texto ou árvore) em todas as amostras. Sempre devolve um vetor novo
 *  do tamanho do log (fórmula constante = vetor constante; nunca o vetor de um canal ou do
 *  tempo). Lança FormulaError. */
export function evalFormula(expr: string | FormulaNode, env: FormulaEnv): Float64Array {
  const node = typeof expr === 'string' ? parseFormula(expr) : expr;
  const borrowed = new Set<Float64Array>();
  const r = evalNode(node, env, borrowed);
  if (typeof r !== 'number' && borrowed.has(r)) return Float64Array.from(r);
  return vec(r, env.t.length);
}

/** Problema numa fórmula (aparece na interface ao lado dela). */
export interface FormulaIssue { id: string; name: string; msg: string; pos?: number }

/** Chave do canal de uma fórmula. */
export const formulaKey = (f: Pick<Formula, 'id'>): string => 'f:' + f.id;

/** Canais das fórmulas (grupo 'Fórmulas', src 'formula'), em ordem: cada fórmula enxerga
 *  todos os canais de ctx.all e as fórmulas anteriores. As que dão erro ficam de fora e
 *  vão para `errors` (se passado). */
export function applyFormulas(ctx: { S: Pick<Session, 't'>; all: Channel[] }, formulas: Formula[], errors?: FormulaIssue[]): Channel[] {
  const out: Channel[] = [];
  const t = ctx.S.t;
  const find = (key: string) => (out.find(c => c.key === key) || ctx.all.find(c => c.key === key))?.data;
  for (const f of formulas || []) {
    if (!f || !String(f.expr ?? '').trim()) continue;
    try {
      const data = evalFormula(f.expr, { t, channel: find });     /* sempre um vetor novo */
      out.push(finishChannel({ key: formulaKey(f), name: f.name || f.expr, unit: f.unit || '', data, src: 'formula', group: 'Fórmulas' }));
    } catch (e) {
      if (!(e instanceof FormulaError)) throw e;
      if (errors) errors.push({ id: f.id, name: f.name, msg: e.message, pos: e.pos });
    }
  }
  return out;
}
