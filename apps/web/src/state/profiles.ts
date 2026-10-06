/* Perfis de carro e pista, configuração em uso e fórmulas (docs/ARQUITETURA.md 4.3).
 *
 * Como no app antigo, existe UMA configuração em uso (o "cfg" que o antigo guardava no
 * localStorage): `draft` = pista (track_config.h, canais X/Y, formato, linha...) + carro +
 * suspensão. Os perfis da biblioteca ("BJ26 — setup A", "Pista da faculdade") são pontos de
 * partida com nome: escolher um perfil copia os parâmetros dele para o draft; "salvar no
 * perfil" grava o draft de volta. As páginas Carro e Pista editam o draft pelo
 * useSessionStore().updateConfig(patch), que também recalcula a sessão aberta.
 *
 * Exemplo (sessão de demonstração): usa os dados do carro simulado (DEMO_CAR) e uma linha de
 * largada só na memória, sem sobrescrever o carro e a linha reais — a mesma lógica de
 * setSession/realCar/demoCar/demoLine de legacy/js/app.js. As edições do carro feitas com o
 * exemplo aberto ficam no demoCar (memória) e voltam quando o exemplo for reaberto.
 *
 * Tudo que muda a conta incrementa `rev`; a store da sessão assina `rev` e recalcula. */
import { create } from 'zustand';
import {
  DEMO_CAR, type AnalysisConfigInput, type CarConfig, type Formula, type Pt, type SuspConfig, type TrackConfig,
} from '@baja/core';
import type { CarProfile, CarProfileParams, Library, TrackProfile } from '../library/types';
import { lsGet, lsSet } from './prefs';

/** Configuração em uso (o que o app antigo guardava como 'cfg'). */
export interface ConfigDraft {
  track: Partial<TrackConfig>;
  car: Partial<CarConfig>;
  susp: Partial<SuspConfig>;
}

export interface ProfilesState {
  cars: CarProfile[];
  tracks: TrackProfile[];
  /** perfis carregados da biblioteca ativa */
  loaded: boolean;
  loadError: string | null;
  activeCarId: string | null;
  activeTrackId: string | null;
  /** configuração em uso (persistida neste navegador) */
  draft: ConfigDraft;
  /** o draft mudou depois de escolher/salvar o perfil ativo */
  carDirty: boolean;
  trackDirty: boolean;
  /** canais calculados pelo usuário (persistidos neste navegador) */
  formulas: Formula[];
  /** carro e linha do exemplo (só na memória, como A.demoCar / A.demoLine do antigo) */
  demoCar: Partial<CarConfig> | null;
  demoLine: Pt[] | null;
  /** incrementa a cada mudança que altera a conta (a sessão assina e recalcula) */
  rev: number;

  /** carrega os perfis da biblioteca (LibrarySync chama quando a biblioteca muda) */
  load: (lib: Library | null) => Promise<void>;
  setActiveCar: (id: string | null) => void;
  setActiveTrack: (id: string | null) => void;
  /** grava o draft no perfil (novo com `name`, ou o ativo) e o torna ativo */
  saveCarProfile: (lib: Library, name?: string) => Promise<CarProfile>;
  saveTrackProfile: (lib: Library, name?: string) => Promise<TrackProfile>;
  deleteCarProfile: (lib: Library, id: string) => Promise<void>;
  deleteTrackProfile: (lib: Library, id: string) => Promise<void>;
  setFormulas: (f: Formula[]) => void;
  /** aplica um patch de configuração no lugar certo (draft, ou demoCar/demoLine com o exemplo) */
  applyPatch: (patch: AnalysisConfigInput, demo: boolean) => void;
  /** volta o carro aos padrões (do exemplo, se demo) — como o botão "padrões" do antigo */
  resetCar: (demo: boolean) => void;
  /** guarda a linha automática do exemplo sem recalcular de novo */
  setDemoLine: (l: Pt[] | null) => void;
  /** grava canais X/Y/status adivinhados no draft (setSession do antigo fazia saveCfg) */
  syncGuessedChannels: (c: { chX: string; chY: string; chStatus: string }) => void;
}

const K_DRAFT = 'baja:cfg';
const K_ACTIVE = 'baja:profiles';
const K_FORMULAS = 'baja:formulas';

const readJSON = <T,>(k: string, d: T): T => {
  const raw = lsGet(k);
  if (!raw) return d;
  try { const v = JSON.parse(raw) as T; return v && typeof v === 'object' ? v : d; } catch { return d; }
};

const EMPTY_DRAFT: ConfigDraft = { track: {}, car: {}, susp: {} };
function loadDraft(): ConfigDraft {
  const d = readJSON<Partial<ConfigDraft>>(K_DRAFT, {});
  return {
    track: d.track && typeof d.track === 'object' ? d.track : {},
    car: d.car && typeof d.car === 'object' ? d.car : {},
    susp: d.susp && typeof d.susp === 'object' ? d.susp : {},
  };
}
const active0 = readJSON<{ car?: string | null; track?: string | null }>(K_ACTIVE, {});
const formulas0 = readJSON<Formula[]>(K_FORMULAS, []);

/* chaves da configuração da pista (o resto do patch é car/susp/formulas) */
const TRACK_KEYS: (keyof TrackConfig)[] = ['lat0', 'lon0', 'centerFixed', 'sizeX', 'sizeY', 'margin', 'chX', 'chY', 'chStatus', 'fmt', 'smooth', 'minLap', 'line'];

/** separa os parâmetros de um perfil de carro em carro + suspensão */
function splitCar(p: CarProfileParams): { car: Partial<CarConfig>; susp: Partial<SuspConfig> } {
  const { susp, ...car } = p;
  return { car: { ...car }, susp: { ...(susp || {}) } };
}

export const useProfiles = create<ProfilesState>((set, get) => {
  const saveDraft = () => lsSet(K_DRAFT, JSON.stringify(get().draft));
  const saveActive = () => lsSet(K_ACTIVE, JSON.stringify({ car: get().activeCarId, track: get().activeTrackId }));
  const bump = () => set(s => ({ rev: s.rev + 1 }));

  return {
    cars: [],
    tracks: [],
    loaded: false,
    loadError: null,
    activeCarId: typeof active0.car === 'string' ? active0.car : null,
    activeTrackId: typeof active0.track === 'string' ? active0.track : null,
    draft: loadDraft(),
    carDirty: false,
    trackDirty: false,
    formulas: Array.isArray(formulas0) ? formulas0 : [],
    demoCar: null,
    demoLine: null,
    rev: 0,

    load: async lib => {
      if (!lib) { set({ cars: [], tracks: [], loaded: false }); return; }
      try {
        const [cars, tracks] = await Promise.all([lib.listCars(), lib.listTracks()]);
        set(s => ({
          cars, tracks, loaded: true, loadError: null,
          /* perfil ativo que não existe nesta biblioteca: fica só o draft */
          activeCarId: s.activeCarId && cars.some(c => c.id === s.activeCarId) ? s.activeCarId : null,
          activeTrackId: s.activeTrackId && tracks.some(t => t.id === s.activeTrackId) ? s.activeTrackId : null,
        }));
        saveActive();
      } catch (e) {
        set({ cars: [], tracks: [], loaded: true, loadError: (e as Error).message });
      }
    },

    setActiveCar: id => {
      const p = id ? get().cars.find(c => c.id === id) : undefined;
      if (id && !p) return;
      if (p) {
        const { car, susp } = splitCar(p.params);
        set(s => ({ activeCarId: id, carDirty: false, draft: { ...s.draft, car, susp } }));
        saveDraft();
      } else set({ activeCarId: null, carDirty: false });
      saveActive();
      bump();
    },

    setActiveTrack: id => {
      const p = id ? get().tracks.find(t => t.id === id) : undefined;
      if (id && !p) return;
      if (p) {
        set(s => ({ activeTrackId: id, trackDirty: false, draft: { ...s.draft, track: { ...p.params } } }));
        saveDraft();
      } else set({ activeTrackId: null, trackDirty: false });
      saveActive();
      bump();
    },

    saveCarProfile: async (lib, name) => {
      const s = get();
      const cur = !name && s.activeCarId ? s.cars.find(c => c.id === s.activeCarId) : undefined;
      const params: CarProfileParams = { ...s.draft.car, susp: { ...s.draft.susp } };
      const saved = await lib.saveCar({ ...(cur ? { id: cur.id } : {}), name: name || cur?.name || 'Carro', params });
      set(st => ({
        cars: [...st.cars.filter(c => c.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
        activeCarId: saved.id, carDirty: false,
      }));
      saveActive();
      return saved;
    },

    saveTrackProfile: async (lib, name) => {
      const s = get();
      const cur = !name && s.activeTrackId ? s.tracks.find(t => t.id === s.activeTrackId) : undefined;
      const saved = await lib.saveTrack({ ...(cur ? { id: cur.id } : {}), name: name || cur?.name || 'Pista', params: { ...s.draft.track } });
      set(st => ({
        tracks: [...st.tracks.filter(t => t.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
        activeTrackId: saved.id, trackDirty: false,
      }));
      saveActive();
      return saved;
    },

    deleteCarProfile: async (lib, id) => {
      await lib.deleteCar(id);
      set(s => ({ cars: s.cars.filter(c => c.id !== id), activeCarId: s.activeCarId === id ? null : s.activeCarId }));
      saveActive();
    },

    deleteTrackProfile: async (lib, id) => {
      await lib.deleteTrack(id);
      set(s => ({ tracks: s.tracks.filter(t => t.id !== id), activeTrackId: s.activeTrackId === id ? null : s.activeTrackId }));
      saveActive();
    },

    setFormulas: f => {
      set({ formulas: f });
      lsSet(K_FORMULAS, JSON.stringify(f));
      bump();
    },

    applyPatch: (patch, demo) => {
      const s = get();
      const track: Partial<TrackConfig> = { ...s.draft.track };
      let car = s.draft.car, susp = s.draft.susp, demoCar = s.demoCar, demoLine = s.demoLine;
      let carTouched = false, trackTouched = false;
      const p = patch as Record<string, unknown>;
      for (const k of TRACK_KEYS) {
        if (!(k in p)) continue;
        if (k === 'line') {
          const l = (p.line as Pt[] | null) ?? null;
          /* a linha do exemplo fica só na memória para não apagar a da pista real */
          if (demo) demoLine = l; else { track.line = l; trackTouched = true; }
        } else { (track as Record<string, unknown>)[k] = p[k]; trackTouched = true; }
      }
      if (patch.car) {
        if (demo) demoCar = { ...(demoCar || DEMO_CAR), ...patch.car };
        else { car = { ...car, ...patch.car }; carTouched = true; }
      }
      if (patch.susp) { susp = { ...susp, ...patch.susp }; carTouched = true; }
      const formulas = patch.formulas ?? s.formulas;
      set({
        draft: { track, car, susp }, demoCar, demoLine, formulas,
        carDirty: s.carDirty || (carTouched && !!s.activeCarId),
        trackDirty: s.trackDirty || (trackTouched && !!s.activeTrackId),
      });
      saveDraft();
      if (patch.formulas) lsSet(K_FORMULAS, JSON.stringify(formulas));
      bump();
    },

    resetCar: demo => {
      if (demo) set({ demoCar: { ...DEMO_CAR } });
      else { set(s => ({ draft: { ...s.draft, car: {} }, carDirty: !!s.activeCarId })); saveDraft(); }
      bump();
    },

    setDemoLine: l => set({ demoLine: l }),

    syncGuessedChannels: c => {
      const t = get().draft.track;
      if (t.chX === c.chX && t.chY === c.chY && (t.chStatus ?? '') === c.chStatus) return;
      set(s => ({ draft: { ...s.draft, track: { ...s.draft.track, chX: c.chX, chY: c.chY, chStatus: c.chStatus } } }));
      saveDraft();
    },
  };
});

/** Configuração parcial para o computeSession (pipeline.normalizeConfig aplica os padrões).
 *  demo = sessão de exemplo: carro simulado e linha da memória, como setSession do antigo. */
export function configInput(demo: boolean): AnalysisConfigInput {
  const s = useProfiles.getState();
  const d = s.draft;
  const input: AnalysisConfigInput = {
    ...d.track,
    susp: { ...d.susp },
    car: demo ? { ...(s.demoCar || DEMO_CAR) } : { ...d.car },
  };
  if (demo) input.line = s.demoLine;
  if (s.formulas.length) input.formulas = s.formulas.map(f => ({ ...f }));
  return input;
}

/** Perfil ativo (objetos) — atalho para as páginas. */
export const useActiveProfiles = () => {
  const cars = useProfiles(s => s.cars), tracks = useProfiles(s => s.tracks);
  const carId = useProfiles(s => s.activeCarId), trackId = useProfiles(s => s.activeTrackId);
  return {
    car: carId ? cars.find(c => c.id === carId) ?? null : null,
    track: trackId ? tracks.find(t => t.id === trackId) ?? null : null,
  };
};

export { EMPTY_DRAFT };
