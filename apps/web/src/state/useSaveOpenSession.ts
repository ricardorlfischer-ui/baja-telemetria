/* "Guardar na biblioteca" a sessão aberta sem salvar ("Abrir arquivo sem salvar", "Abrir
 * arquivo…" das páginas sem sessão): usa o texto já carregado (store.unsavedText), guarda com o
 * resumo (addLogToLibrary) e a sessão aberta passa a ser da biblioteca, sem reabrir o log.
 * Usado pelo menu da sessão (SessionChip), pelo aviso e pelo cartão "Dados da sessão" da Visão
 * geral. O "guardando" é do store (savingToLibrary): clicar num botão deixa todos esperando, e
 * um segundo clique não guarda o log de novo. */
import { notifications } from '@mantine/notifications';
import { useLibrary } from '../library/context';
import { storageErrorMessage } from '../library/storage';
import { getPrefs } from './prefs';
import { useSessionStore } from './session';

export interface SaveOpenSession {
  /** dá para guardar agora (sessão sem biblioteca, com o texto, biblioteca pronta e permissão) */
  canSave: boolean;
  saving: boolean;
  save: () => Promise<void>;
}

export function useSaveOpenSession(): SaveOpenSession {
  const { lib, mode, user, offline, bump } = useLibrary();
  const pending = useSessionStore(s =>
    s.status === 'ready' && !!s.S && !s.S.demo && !!s.source && !s.source.libraryId && s.unsavedText !== null);
  const saving = useSessionStore(s => s.savingToLibrary);
  const allowed = !!lib && !offline && (mode === 'local' || (!!user && user.role !== 'viewer'));

  const save = async () => {
    if (!lib || useSessionStore.getState().savingToLibrary) return;
    try {
      const r = await useSessionStore.getState().saveToLibrary(lib);
      if (!r) return;
      bump();
      notifications.show(r.duplicate
        ? { title: 'Este log já estava na biblioteca', message: `A sessão aberta agora é “${r.meta.name}”, sem guardar de novo.`, autoClose: 6000 }
        : {
          color: 'green', title: 'Sessão guardada na biblioteca',
          message: mode === 'local'
            ? `“${r.meta.name}” ficou neste navegador${getPrefs().reopenLast ? ' e abre sozinha quando você voltar ao app' : ''}.`
            : `“${r.meta.name}” está no servidor da equipe.`,
          autoClose: 6000,
        });
    } catch (e) {
      notifications.show({ color: 'red', title: 'Não consegui guardar na biblioteca', message: storageErrorMessage(e), autoClose: 12_000 });
    }
  };

  return { canSave: pending && allowed, saving, save };
}
