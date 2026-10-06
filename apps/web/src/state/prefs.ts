/* Preferências do usuário neste navegador (docs/ARQUITETURA.md 4.3): tema, endereço do
 * servidor da equipe, layouts da página Canais, barra lateral recolhida.
 * Ficam no localStorage, sempre com try/catch (aba anônima, armazenamento bloqueado...):
 * sem localStorage o app funciona com os padrões. */
import { create } from 'zustand';
import type { MantineColorScheme, MantineColorSchemeManager } from '@mantine/core';

export type ThemePref = 'dark' | 'light' | 'auto';

/** Um painel da página Canais: um ou vários canais (chaves) no mesmo eixo Y. */
export interface ChannelPanel {
  keys: string[];
  height?: number;        /* px */
}
/** Layout salvo da página Canais. */
export interface ChannelLayout {
  name: string;
  panels: ChannelPanel[];
  xAxis?: 'time' | 'dist';
  updatedAt?: string;
}

export interface Prefs {
  theme: ThemePref;
  serverUrl: string;                          /* '' = sem servidor salvo (detecta /api/info na mesma origem) */
  channelLayouts: Record<string, ChannelLayout>;
  lastChannelLayout: string | null;
  navCollapsed: boolean;                       /* barra lateral recolhida no computador */
}

const KEY = 'baja:prefs';
export const DEFAULT_PREFS: Prefs = {
  theme: 'dark',
  serverUrl: '',
  channelLayouts: {},
  lastChannelLayout: null,
  navCollapsed: false,
};

/* ---------------------------------------------------------------- localStorage seguro */
export function lsGet(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
export function lsSet(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* sem armazenamento: fica só na memória */ }
}

function load(): Prefs {
  const raw = lsGet(KEY);
  if (!raw) return { ...DEFAULT_PREFS };
  try {
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      ...DEFAULT_PREFS,
      ...p,
      theme: p.theme === 'light' || p.theme === 'auto' || p.theme === 'dark' ? p.theme : 'dark',
      serverUrl: typeof p.serverUrl === 'string' ? p.serverUrl : '',
      channelLayouts: p.channelLayouts && typeof p.channelLayouts === 'object' ? p.channelLayouts : {},
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

interface PrefsStore extends Prefs {
  set: (patch: Partial<Prefs>) => void;
  saveChannelLayout: (layout: ChannelLayout) => void;
  deleteChannelLayout: (name: string) => void;
}

export const usePrefs = create<PrefsStore>((set, get) => {
  const save = () => {
    const { theme, serverUrl, channelLayouts, lastChannelLayout, navCollapsed } = get();
    lsSet(KEY, JSON.stringify({ theme, serverUrl, channelLayouts, lastChannelLayout, navCollapsed }));
  };
  return {
    ...load(),
    set: patch => { set(patch); save(); },
    saveChannelLayout: layout => {
      set(s => ({
        channelLayouts: { ...s.channelLayouts, [layout.name]: { ...layout, updatedAt: new Date().toISOString() } },
        lastChannelLayout: layout.name,
      }));
      save();
    },
    deleteChannelLayout: name => {
      set(s => {
        const c = { ...s.channelLayouts };
        delete c[name];
        return { channelLayouts: c, lastChannelLayout: s.lastChannelLayout === name ? null : s.lastChannelLayout };
      });
      save();
    },
  };
});

/** Leitura fora do React. */
export const getPrefs = (): Prefs => usePrefs.getState();

/** Normaliza o endereço do servidor: sem barra no fim; vazio = mesma origem. */
export const normalizeServerUrl = (u: string): string => u.trim().replace(/\/+$/, '');

/* ---------------------------------------------------------------- tema do Mantine
 * O Mantine guarda o esquema de cor pelo "manager": este grava nas preferências, assim o tema
 * fica junto com o resto e a página Preferências só usa usePrefs/useMantineColorScheme. */
export function prefsColorSchemeManager(): MantineColorSchemeManager {
  let unsub: (() => void) | null = null;
  return {
    get: def => {
      const t = usePrefs.getState().theme;
      return t ?? def;
    },
    set: (value: MantineColorScheme) => {
      if (usePrefs.getState().theme !== value) usePrefs.getState().set({ theme: value });
    },
    subscribe: onUpdate => {
      unsub = usePrefs.subscribe((s, prev) => { if (s.theme !== prev.theme) onUpdate(s.theme); });
    },
    unsubscribe: () => { unsub?.(); unsub = null; },
    clear: () => usePrefs.getState().set({ theme: DEFAULT_PREFS.theme }),
  };
}
