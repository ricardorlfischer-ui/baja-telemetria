// @vitest-environment jsdom
/* ?exemplo na URL abre a sessão de exemplo ao carregar o app (para apresentar aos juízes e
 * para as capturas de tela): antes do # ou na rota do HashRouter. */
import { describe, expect, it } from 'vitest';
import { wantsDemoFromUrl } from '../src/state/SessionSync';

const w = (search: string, hash: string) => wantsDemoFromUrl({ search, hash });

describe('wantsDemoFromUrl', () => {
  it('pede o exemplo', () => {
    expect(w('', '#/canais?exemplo=1')).toBe(true);
    expect(w('', '#/?exemplo')).toBe(true);
    expect(w('?exemplo', '#/mapa')).toBe(true);
    expect(w('?exemplo=1', '')).toBe(true);
    expect(w('', '#/sessao?tema=claro&exemplo=sim')).toBe(true);
  });
  it('não pede', () => {
    expect(w('', '#/canais')).toBe(false);
    expect(w('', '')).toBe(false);
    expect(w('?exemplo=0', '#/canais')).toBe(false);
    expect(w('', '#/canais?exemplo=false')).toBe(false);
    expect(w('?exemplos=1', '#/canais?x=exemplo')).toBe(false);
  });
});
