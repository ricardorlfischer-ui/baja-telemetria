/* Comparação profunda entre o resultado do app antigo (outro realm, ver legacy.ts) e o do
 * @baja/core. Números com tolerância relativa, NaN == NaN, typed arrays e arrays elemento a
 * elemento, objetos chave a chave (funções ignoradas). Retorna a lista de diferenças (vazia =
 * igual) para a mensagem do teste dizer exatamente onde divergiu. */

export interface CmpOpts {
  rel?: number;        /* tolerância relativa (padrão 1e-9) */
  abs?: number;        /* tolerância absoluta (padrão 1e-9) */
  ignore?: string[];   /* nomes de chaves a ignorar em qualquer nível */
  maxDiffs?: number;   /* para de listar depois de N diferenças (padrão 20) */
}

const isArrayLike = (v: unknown): v is ArrayLike<unknown> =>
  Array.isArray(v) || (ArrayBuffer.isView(v) && !(v instanceof DataView)) ||
  /* typed array de outro realm: ArrayBuffer.isView falha, mas o toString diz o tipo */
  (v !== null && typeof v === 'object' && /^\[object (Float(32|64)|U?Int(8|16|32)|Uint8Clamped)Array\]$/.test(Object.prototype.toString.call(v)));

export function numClose(a: number, b: number, rel = 1e-9, abs = 1e-9): boolean {
  if (a === b) return true;
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= Math.max(abs, rel * Math.max(Math.abs(a), Math.abs(b)));
}

export function diff(legacy: unknown, ported: unknown, opts: CmpOpts = {}, at = '$', out: string[] = []): string[] {
  const max = opts.maxDiffs ?? 20;
  if (out.length >= max) return out;
  const rel = opts.rel ?? 1e-9, abs = opts.abs ?? 1e-9;
  if (typeof legacy === 'function' || typeof ported === 'function') return out;
  if (typeof legacy === 'number' && typeof ported === 'number') {
    if (!numClose(legacy, ported, rel, abs)) out.push(`${at}: antigo ${legacy} ≠ novo ${ported}`);
    return out;
  }
  if (legacy === null || ported === null || legacy === undefined || ported === undefined || typeof legacy !== 'object' || typeof ported !== 'object') {
    if (legacy !== ported) out.push(`${at}: antigo ${JSON.stringify(legacy)?.slice(0, 120)} ≠ novo ${JSON.stringify(ported)?.slice(0, 120)}`);
    return out;
  }
  if (isArrayLike(legacy) || isArrayLike(ported)) {
    if (!isArrayLike(legacy) || !isArrayLike(ported)) { out.push(`${at}: um é array e o outro não`); return out; }
    if (legacy.length !== ported.length) { out.push(`${at}: tamanho antigo ${legacy.length} ≠ novo ${ported.length}`); return out; }
    for (let i = 0; i < legacy.length && out.length < max; i++) diff(legacy[i], ported[i], opts, `${at}[${i}]`, out);
    return out;
  }
  const ign = new Set(opts.ignore ?? []);
  const ka = Object.keys(legacy as object).filter(k => !ign.has(k) && typeof (legacy as any)[k] !== 'function');
  const kb = Object.keys(ported as object).filter(k => !ign.has(k) && typeof (ported as any)[k] !== 'function');
  for (const k of ka) if (!kb.includes(k) && (legacy as any)[k] !== undefined) out.push(`${at}.${k}: falta no novo`);
  for (const k of kb) if (!ka.includes(k) && (ported as any)[k] !== undefined) out.push(`${at}.${k}: sobra no novo`);
  for (const k of ka) if (kb.includes(k)) diff((legacy as any)[k], (ported as any)[k], opts, `${at}.${k}`, out);
  return out;
}

/** Para usar no teste: expect(same(a, b)).toEqual([]) mostra as diferenças se houver. */
export const same = (legacy: unknown, ported: unknown, opts?: CmpOpts) => diff(legacy, ported, opts);
