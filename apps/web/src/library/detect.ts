/* Decide a biblioteca (docs/ARQUITETURA.md 4.4): servidor salvo nas preferências (ou o padrão
 * do build, VITE_API_URL) > servidor na mesma origem (/api/info responde) > local (IndexedDB).
 *
 * Hospedagem estática (VITE_STATIC=1, o build do GitHub Pages): o endereço não tem servidor,
 * então nem pergunta /api/info na mesma origem (sem 404 no console e sem esperar 1,5 s ao
 * abrir); vai direto para a biblioteca local, a não ser que haja um servidor salvo ou do build. */
import { serverUrlInUse } from '../state/prefs';
import { LocalLibrary } from './local';
import { RemoteLibrary } from './remote';
import type { Library, ServerInfo } from './types';

export interface Detected {
  lib: Library;
  /** resposta de /api/info (só remoto e se respondeu) */
  info: ServerInfo | null;
  /** servidor salvo nas preferências mas sem resposta agora */
  offline?: boolean;
}

/** Build para hospedagem estática (GitHub Pages): sem /api na mesma origem. */
export const isStaticHost = (): boolean => import.meta.env.VITE_STATIC === '1';

async function probe(r: RemoteLibrary, ms: number): Promise<ServerInfo | null> {
  const t = new Promise<null>(res => setTimeout(() => res(null), ms));
  const q = r.info()
    .then(i => (i && typeof i === 'object' && 'name' in i ? i : null))
    .catch(() => null);
  return Promise.race([q, t]);
}

/** Decide a biblioteca: servidor salvo > servidor na mesma origem (fora da hospedagem
 *  estática) > local. `staticHost` só para os testes (padrão: VITE_STATIC do build). */
export async function detectLibrary(opts: { staticHost?: boolean } = {}): Promise<Detected> {
  const saved = serverUrlInUse();
  if (saved) {
    const r = new RemoteLibrary(saved);
    const info = await probe(r, 4000);
    return { lib: r, info, offline: !info };
  }
  if (opts.staticHost ?? isStaticHost()) return { lib: new LocalLibrary(), info: null };
  const same = new RemoteLibrary('');
  const info = await probe(same, 1500);
  if (info) return { lib: same, info };
  return { lib: new LocalLibrary(), info: null };
}
