/* Todo id de card de explicação escrito na interface existe no catálogo do core
 * (docs/ARQUITETURA.md 3.8 e 4.6). Os ids que vêm dos relatórios já são conferidos em
 * packages/core/test/explain.test.ts; aqui ficam os escritos à mão nas páginas
 * (explain="...", open('...'), { explain: '...' }). Id fora do catálogo abre um card de aviso. */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getExplain } from '@baja/core';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?)$/.test(f) ? [p] : [];
  });
}

/* explain="x.y", explain={'x.y'}, explain: 'x.y', open('x.y' */
const PATTERNS = [
  /explain=["']([a-z]+\.[A-Za-z0-9_]+)["']/g,
  /explain=\{\s*["']([a-z]+\.[A-Za-z0-9_]+)["']\s*\}/g,
  /explain:\s*["']([a-z]+\.[A-Za-z0-9_]+)["']/g,
  /\bopen\(\s*["']([a-z]+\.[A-Za-z0-9_]+)["']/g,
];

describe('ids de explicação usados na interface', () => {
  const found = new Map<string, string[]>();
  for (const f of files(SRC)) {
    const text = readFileSync(f, 'utf8');
    for (const re of PATTERNS) {
      for (const m of text.matchAll(re)) {
        const at = path.relative(SRC, f);
        found.set(m[1], [...(found.get(m[1]) ?? []), at]);
      }
    }
  }

  it('achou os ids das páginas', () => {
    expect(found.size).toBeGreaterThan(60);
  });

  it('todos existem no catálogo EXPLAIN do core', () => {
    const missing = [...found.entries()].filter(([id]) => !getExplain(id)).map(([id, at]) => `${id} (${[...new Set(at)].join(', ')})`);
    expect(missing).toEqual([]);
  });
});
