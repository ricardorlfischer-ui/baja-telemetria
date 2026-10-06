/* Reabrir a última sessão ao abrir o app (Preferências → "Reabrir a última sessão ao abrir o
 * app", ligada por padrão). Quem usa o app pelo endereço fixo (GitHub Pages) recarrega a
 * página e continua no log em que estava, como num programa instalado.
 *
 *  - abrir uma sessão da biblioteca (openFromLibrary) ou guardar na biblioteca a sessão aberta
 *    lembra o id dela nas preferências (rememberSession), junto com QUAL biblioteca (local ou o
 *    endereço do servidor): o id de uma não vale na outra;
 *  - fechar a sessão lembrada (SessionChip → Fechar sessão) esquece (forgetSession); fechar o
 *    exemplo ou um log aberto sem salvar não mexe na memória;
 *  - ao carregar o app (LibrarySync, depois de carregar os perfis), com nada aberto e sem
 *    ?exemplo na URL, reabre em silêncio; no servidor, só depois do login; se a sessão não
 *    existe mais, esquece o id.
 *
 * Sem React e sem importar o store da sessão (session.ts importa este arquivo): as decisões
 * são funções puras, testadas em test/local-memory.test.ts. */
import type { Library, SessionMeta } from '../library/types';
import { LocalNotFoundError } from '../library/local';
import { ApiError } from '../library/remote';
import { getPrefs, usePrefs, type LastSession } from './prefs';

/** Chave da biblioteca: 'local' ou 'remote:<endereço>' ('remote:' = servidor na mesma origem). */
export function libKeyOf(lib: Library): string {
  if (lib.mode === 'local') return 'local';
  const base = (lib as { baseUrl?: unknown }).baseUrl;
  return `remote:${typeof base === 'string' ? base : ''}`;
}

/** Lembra a sessão aberta da biblioteca (para reabrir ao carregar o app). */
export function rememberSession(lib: Library | null | undefined, id: string): void {
  if (!lib || !id) return;
  const cur = getPrefs().lastSession;
  const key = libKeyOf(lib);
  if (cur && cur.id === id && cur.lib === key) return;
  usePrefs.getState().set({ lastSession: { id, lib: key } });
}

/** Esquece a última sessão (toda, ou só se for este id). */
export function forgetSession(id?: string): void {
  const cur = getPrefs().lastSession;
  if (!cur || (id !== undefined && cur.id !== id)) return;
  usePrefs.getState().set({ lastSession: null });
}

export type ReopenPlan =
  /** ainda não dá para decidir (biblioteca detectando, servidor sem login) */
  | { action: 'wait' }
  /** não reabre nesta carga da página */
  | { action: 'skip' }
  | { action: 'open'; id: string };

export interface ReopenInput {
  reopenLast: boolean;
  last: LastSession | null;
  lib: Library | null;
  libLoading: boolean;
  /** usuário conectado (só conta no servidor) */
  signedIn: boolean;
  /** status do store da sessão: só reabre com nada aberto ('empty') */
  sessionStatus: 'empty' | 'loading' | 'ready' | 'error';
  /** a URL pede o exemplo (?exemplo): ele ganha */
  wantsDemo: boolean;
}

/** Decide se reabre a última sessão agora. */
export function planReopen(p: ReopenInput): ReopenPlan {
  if (!p.reopenLast || !p.last || p.wantsDemo) return { action: 'skip' };
  if (p.sessionStatus !== 'empty') return { action: 'skip' };
  if (p.libLoading || !p.lib) return { action: 'wait' };
  /* id de outra biblioteca (local × servidor, ou outro servidor): não vale aqui; fica guardado */
  if (libKeyOf(p.lib) !== p.last.lib) return { action: 'skip' };
  if (p.lib.mode === 'remote' && !p.signedIn) return { action: 'wait' };
  return { action: 'open', id: p.last.id };
}

/** A sessão não existe mais (apagada): 404 do servidor ou não achada no IndexedDB. */
export const isNotFound = (e: unknown): boolean =>
  e instanceof LocalNotFoundError || (e instanceof ApiError && e.status === 404);

export type ReopenResult = 'opened' | 'missing' | 'failed' | 'skipped';

/** Reabre a sessão `id` em silêncio. Sessão apagada → esquece o id ('missing'); servidor fora
 *  do ar ou outro erro → mantém o id para a próxima vez ('failed'); algo foi aberto enquanto
 *  esperava a biblioteca → 'skipped'. */
export async function reopenLastSession(
  lib: Library,
  id: string,
  deps: {
    isEmpty: () => boolean;
    openFromLibrary: (meta: SessionMeta, lib: Library, opts: { silent: boolean }) => Promise<boolean>;
  },
): Promise<ReopenResult> {
  let meta: SessionMeta;
  try {
    meta = await lib.getSession(id);
  } catch (e) {
    if (isNotFound(e)) { forgetSession(id); return 'missing'; }
    return 'failed';
  }
  if (!deps.isEmpty()) return 'skipped';
  return (await deps.openFromLibrary(meta, lib, { silent: true })) ? 'opened' : 'failed';
}
