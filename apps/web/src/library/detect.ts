/* Decide a biblioteca (docs/ARQUITETURA.md 4.4): servidor salvo nas preferências >
 * servidor na mesma origem (/api/info responde) > local (IndexedDB). */
import { getPrefs, normalizeServerUrl } from '../state/prefs';
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

async function probe(r: RemoteLibrary, ms: number): Promise<ServerInfo | null> {
  const t = new Promise<null>(res => setTimeout(() => res(null), ms));
  const q = r.info()
    .then(i => (i && typeof i === 'object' && 'name' in i ? i : null))
    .catch(() => null);
  return Promise.race([q, t]);
}

/** Decide a biblioteca: servidor salvo > servidor na mesma origem > local. */
export async function detectLibrary(): Promise<Detected> {
  const saved = normalizeServerUrl(getPrefs().serverUrl);
  if (saved) {
    const r = new RemoteLibrary(saved);
    const info = await probe(r, 4000);
    return { lib: r, info, offline: !info };
  }
  const same = new RemoteLibrary('');
  const info = await probe(same, 1500);
  if (info) return { lib: same, info };
  return { lib: new LocalLibrary(), info: null };
}
