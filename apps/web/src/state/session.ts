/* Estado da sessão aberta (docs/ARQUITETURA.md 4.3): a sessão (S), o que o core calculou
 * (ctx = computeSession), o cursor do tempo, o play, a volta selecionada e o trecho.
 *
 * É o objeto A de legacy/js/app.js: abrir log/exemplo (setSession + recompute), seek, play,
 * pause, o laço frame() com playBounds(), selectLap(), setLine() e a janela dos gráficos
 * (Charts.setView/followCursor). As contas são do @baja/core; aqui só a orquestração.
 *
 * Desempenho: o cursor muda 60×/s no play. Gráficos e mapa assinam com useCursorEffect (ou
 * useSessionStore.subscribe) e se redesenham sem re-render do React; textos usam
 * useCursorTime/useCursorIndex (~20×/s). Abrir/recalcular cede o frame antes da conta
 * (status 'loading' ou busy) para o aviso aparecer mesmo com um log de 28 MB. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { notifications } from '@mantine/notifications';
import {
  clamp, computeSession, demoCSV, idxAt, parseCSV, parseLog, rangeOf, sensorAvailability,
  type AnalysisConfig, type AnalysisConfigInput, type Channel, type Lap, type Pt, type RangeMode, type SensorId,
  type SensorState, type Session, type SessionContext,
} from '@baja/core';
import type { Library, SessionMeta } from '../library/types';
import { ApiError } from '../library/remote';
import { LocalDuplicateError } from '../library/local';
import { storageErrorMessage } from '../library/storage';
import { configInput, useProfiles } from './profiles';
import { addLogToLibrary } from './librarySave';
import { forgetSession, rememberSession } from './reopen';

export type SessionStatus = 'empty' | 'loading' | 'ready' | 'error';
export type XAxis = 'time' | 'dist';

/** De onde veio a sessão aberta. */
export interface SessionSource {
  type: 'file' | 'text' | 'demo' | 'library';
  /** nome mostrado (arquivo ou nome na biblioteca) */
  name: string;
  /** id na biblioteca (aberta de lá ou guardada ao abrir) */
  libraryId?: string;
  meta?: SessionMeta;
}

export interface SessionState {
  status: SessionStatus;
  /** mensagem do último erro ao abrir/recalcular (null = sem erro) */
  error: string | null;
  /** texto do que está sendo feito ("Lendo…", "Calculando…") enquanto status = 'loading' */
  loadingText: string | null;
  /** recalculando depois de mudar a configuração (a sessão continua na tela) */
  busy: boolean;
  source: SessionSource | null;
  /** texto do log aberto sem salvar (arquivo, arrastar, texto): permite "Guardar na biblioteca"
   *  depois sem pedir o arquivo de novo. null para o exemplo e para sessões da biblioteca */
  unsavedText: string | null;
  /** saveToLibrary em andamento (os botões "Guardar na biblioteca" de todas as telas esperam) */
  savingToLibrary: boolean;
  S: Session | null;
  /** SessionContext do core (computeSession) */
  ctx: SessionContext | null;
  /** = ctx.cfg (atalho) */
  cfg: AnalysisConfig | null;
  /** sensorAvailability(ctx): presente / ausente / sugerido neste log */
  availability: Record<SensorId, SensorState> | null;
  /** tempo do cursor (s, mesma base de S.t) */
  cursor: number;
  playing: boolean;
  /** velocidade do play (0,25×–16×) */
  speed: number;
  loop: boolean;
  /** volta selecionada (índice em ctx.laps; -1 = sessão inteira) */
  selLap: number;
  /** trecho das análises: sessão inteira, volta selecionada ou janela dos gráficos */
  rangeMode: RangeMode;
  /** janela dos gráficos [t0, t1] (s); null = sessão inteira */
  view: [number, number] | null;
  /** no play, a janela acompanha o cursor (followCursor do antigo) */
  follow: boolean;
  /** canal que colore o mapa */
  colorKey: string;
  /** eixo X da página Canais */
  xAxis: XAxis;

  /* ações */
  openText: (text: string, name: string, source?: Partial<SessionSource>) => Promise<boolean>;
  openFile: (file: File, opts?: { saveTo?: Library | null }) => Promise<boolean>;
  openDemo: () => Promise<boolean>;
  /** silent: sem aviso de erro (reabrir a última sessão ao carregar o app) */
  openFromLibrary: (meta: SessionMeta, lib?: Library | null, opts?: { silent?: boolean }) => Promise<boolean>;
  /** guarda na biblioteca a sessão aberta sem salvar (com o texto já carregado, sem reabrir o
   *  log): a sessão aberta passa a ser da biblioteca. Log repetido liga à sessão que já existe
   *  (duplicate). null = nada a guardar. Erros (sem espaço: LocalQuotaError) sobem. Chamado de
   *  novo enquanto guarda a mesma sessão: devolve a mesma promessa (não guarda duas vezes) */
  saveToLibrary: (lib?: Library | null) => Promise<{ meta: SessionMeta; duplicate: boolean } | null>;
  /** fecha a sessão (se ela é a última sessão lembrada, esquece: não reabre ao carregar o app) */
  close: () => void;
  updateConfig: (patch: AnalysisConfigInput) => void;
  setLine: (pts: Pt[] | null) => void;
  /** recalcula agora com a configuração em uso (perfis, fórmulas) */
  recompute: () => Promise<void>;
  seek: (t: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  setSpeed: (v: number) => void;
  setLoop: (v: boolean) => void;
  setLap: (k: number) => void;
  setRangeMode: (m: RangeMode) => void;
  setView: (v: [number, number] | null) => void;
  /** volta a janela para a volta selecionada (±2 %) ou a sessão inteira (resetChartView) */
  resetView: () => void;
  /** zoom da janela em torno de tc (f < 1 aproxima) — Charts.zoom do antigo */
  zoomView: (f: number, tc?: number) => void;
  setFollow: (v: boolean) => void;
  setColorKey: (k: string) => void;
  setXAxis: (x: XAxis) => void;
  clearError: () => void;
  /** dados da sessão na biblioteca mudaram (editar, recalcular o resumo): atualiza source.meta
   *  sem reabrir o log (só se for a mesma sessão aberta) */
  setSourceMeta: (meta: SessionMeta) => void;
  /** a sessão foi apagada da biblioteca: se for a aberta, ela continua na tela, mas como
   *  "aberta sem salvar" (sem dados para editar nem anotações, que dariam 404) */
  detachFromLibrary: (id: string) => void;
}

/* ---------------------------------------------------------------- biblioteca registrada
 * A biblioteca vive num contexto React (useLibrary); LibrarySync registra aqui a ativa para
 * openFromLibrary(meta) funcionar sem passar a biblioteca. */
let activeLib: Library | null = null;
export const setSessionLibrary = (lib: Library | null): void => { activeLib = lib; };

/* ---------------------------------------------------------------- utilidades */
/** Cede o frame: o navegador pinta o aviso de "carregando" antes da conta pesada. Com a aba
 *  em segundo plano o requestAnimationFrame não roda; o setTimeout garante que segue. */
const yieldFrame = (): Promise<void> => new Promise(res => {
  let done = false;
  const go = () => { if (!done) { done = true; setTimeout(res, 0); } };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
  setTimeout(go, 60);
});

const msgOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Id da sessão que já existe quando o log é repetido (409 do servidor ou sha256 igual no local). */
const duplicateIdOf = (e: unknown): string | null =>
  e instanceof LocalDuplicateError ? e.existingId : e instanceof ApiError && e.status === 409 ? e.existingId : null;

/* canal que colore o mapa ao abrir um log: mantém o escolhido se ele existir e variar neste
 * log; senão gps:speed ou o primeiro não constante (recompute() do antigo). Sem a checagem
 * de variação, abrir um log sem voltas depois do exemplo deixava o mapa colorido por
 * "Tempo na volta", todo NaN. */
function pickColorKey(all: Channel[], cur: string): string {
  const varies = (c: Channel | undefined) => !!c && !c.constant && c.count > 0;
  if (varies(all.find(c => c.key === cur))) return cur;
  if (varies(all.find(c => c.key === 'gps:speed'))) return 'gps:speed';
  return (all.find(varies) || all.find(c => c.key === cur) || all[0] || { key: '' }).key;
}

/* trecho do play: a volta selecionada ou a sessão inteira (playBounds do antigo) */
function playBounds(st: Pick<SessionState, 'S' | 'ctx' | 'selLap'>): [number, number] {
  const t = st.S!.t;
  const l = st.selLap >= 0 && st.ctx ? st.ctx.laps[st.selLap] : undefined;
  if (l) return [l.t0, l.t1];
  return [t[0], t[t.length - 1]];
}

/* janela dos gráficos com o mínimo de 0,2 s e dentro da sessão (Charts.setView do antigo) */
function clampView(S: Session, t0: number, t1: number): [number, number] {
  const t = S.t, a = t[0], b = t[t.length - 1];
  let w = Math.max(t1 - t0, Math.min(0.2, b - a));
  if (w > b - a) w = b - a;
  t0 = clamp(t0, a, b - w);
  return [t0, t0 + w];
}

/* janela de uma volta: a volta ±2 % (selectLap do antigo) */
const lapWindow = (S: Session, l: Lap): [number, number] => clampView(S, l.t0 - l.time * 0.02, l.t1 + l.time * 0.02);

/** Depois de uma conta nova (linha, volta mínima, perfil de pista...), a volta selecionada
 *  continua só se a MESMA volta (mesmas amostras) existir; o índice pode mudar. O antigo
 *  comparava só o índice: com uma volta a menos antes dela, o índice passava a apontar para a
 *  volta seguinte, o trecho "Volta" e o play iam para ela e a janela ficava na antiga.
 *  Devolve o índice novo e, quando a volta some, a janela (null se ela estava na volta). */
export function keepLap(
  S: Session, oldLaps: readonly Lap[], newLaps: readonly Lap[], sel: number, view: [number, number] | null,
): { selLap: number; view: [number, number] | null } {
  if (sel < 0) return { selLap: -1, view };
  const o = oldLaps[sel];
  const k = o ? newLaps.findIndex(l => l.i0 === o.i0 && l.i1 === o.i1) : -1;
  if (k >= 0) return { selLap: k, view };
  /* a volta sumiu: a janela que mostrava a volta volta para a sessão inteira */
  const w = o ? lapWindow(S, o) : null;
  const onLap = !!view && !!w && Math.abs(view[0] - w[0]) < 1e-9 && Math.abs(view[1] - w[1]) < 1e-9;
  return { selLap: -1, view: onLap ? null : view };
}

/* ---------------------------------------------------------------- store */
let gen = 0;                 /* geração da abertura (abrir outra cancela a anterior) */
let raf = 0, lastWall = 0;   /* laço do play */
/* saveToLibrary em andamento: a sessão (S) e a promessa. Dois botões "Guardar na biblioteca"
 * (menu da sessão, aviso e cartão da Visão geral) clicados juntos guardavam o log duas vezes */
type SaveResult = { meta: SessionMeta; duplicate: boolean } | null;
let saving: { S: Session; p: Promise<SaveResult> } | null = null;

const EMPTY = {
  status: 'empty' as SessionStatus, error: null, loadingText: null, busy: false, source: null, unsavedText: null, savingToLibrary: false,
  S: null, ctx: null, cfg: null, availability: null,
  cursor: 0, playing: false, selLap: -1, view: null,
};

export const useSessionStore = create<SessionState>((set, get) => {
  /* ---------------------------------------------------------- play: um único laço rAF */
  const requestFrame = () => { if (!raf && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(frame); };

  function frame(now: number) {
    raf = 0;
    const st = get();
    if (!st.playing || !st.S) return;
    const dt = Math.min(0.25, (now - lastWall) / 1000);
    lastWall = now;
    const [a, b] = playBounds(st);
    let cur = st.cursor + dt * st.speed, playing = true;
    if (cur >= b) {
      if (st.loop) cur = a + (cur - b);
      else { cur = b; playing = false; }
    }
    const patch: Partial<SessionState> = { cursor: cur, playing };
    /* durante o play, mantém o cursor na janela dos gráficos (followCursor do antigo) */
    if (st.follow && st.view) {
      const [t0, t1] = st.view, w = t1 - t0;
      if (cur > t1 - 0.15 * w) patch.view = clampView(st.S, cur - 0.85 * w, cur + 0.15 * w);
      else if (cur < t0) patch.view = clampView(st.S, cur - 0.1 * w, cur + 0.9 * w);
    }
    set(patch);
    if (playing) requestFrame();
  }

  const pause = () => { if (get().playing) set({ playing: false }); };

  /* ---------------------------------------------------------- abrir */
  /** setSession + recompute(true) do antigo, com a configuração dos perfis */
  async function finish(S: Session, source: SessionSource, myGen: number, rawText: string | null = null): Promise<boolean> {
    set({ loadingText: `Calculando ${S.name}…` });
    await yieldFrame();
    if (myGen !== gen) return false;
    const demo = !!S.demo;
    const ctx = computeSession(S, configInput(demo), { autoLine: demo });
    const P = useProfiles.getState();
    /* o exemplo guarda a linha automática na memória (A.demoLine); o log real grava os
     * canais X/Y adivinhados na configuração em uso (saveCfg em setSession) */
    if (demo) { if (!P.demoLine && ctx.cfg.line) P.setDemoLine(ctx.cfg.line); }
    else P.syncGuessedChannels({ chX: ctx.cfg.chX, chY: ctx.cfg.chY, chStatus: ctx.cfg.chStatus });
    const st = get();
    set({
      status: 'ready', error: null, loadingText: null, busy: false, source,
      unsavedText: source.libraryId || demo ? null : rawText,
      /* um guardar da sessão anterior pode seguir sozinho; os botões são da sessão nova */
      savingToLibrary: false,
      S, ctx, cfg: ctx.cfg, availability: sensorAvailability(ctx),
      cursor: S.t.length ? S.t[0] : 0, playing: false, selLap: -1, view: null,
      /* sessão nova começa sem volta: o trecho "Volta" (de outro log) vira "Sessão" */
      rangeMode: st.rangeMode === 'lap' ? 'session' : st.rangeMode,
      colorKey: pickColorKey(ctx.all, st.colorKey),
    });
    return true;
  }

  function fail(e: unknown, name: string, myGen: number): false {
    if (myGen !== gen) return false;
    console.error(e);
    const msg = msgOf(e);
    const had = get().S !== null;
    /* com uma sessão aberta, ela continua (como o antigo, que só mostrava o erro) */
    set({ status: had ? 'ready' : 'error', error: `${name}: ${msg}`, loadingText: null, busy: false });
    notifications.show({ color: 'red', title: 'Não consegui abrir o log', message: `${name}: ${msg}`, autoClose: 8000 });
    return false;
  }

  async function begin(text: string): Promise<number> {
    pause();
    const myGen = ++gen;
    set({ status: 'loading', loadingText: text, error: null });
    await yieldFrame();
    return myGen;
  }

  /* ---------------------------------------------------------- recalcular */
  let pending = false;
  const scheduleRecompute = () => {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; void get().recompute(); }, 0);
  };
  /* perfis, carro, pista ou fórmulas mudaram → recalcula (só com sessão pronta; durante a
   * abertura a conta já usa a configuração nova) */
  useProfiles.subscribe((s, p) => { if (s.rev !== p.rev && get().status === 'ready') scheduleRecompute(); });

  return {
    ...EMPTY,
    speed: 1,
    loop: false,
    rangeMode: 'session',
    follow: true,
    colorKey: 'gps:speed',
    xAxis: 'time',

    openText: async (text, name, source) => {
      const myGen = await begin(`Lendo ${name}…`);
      if (myGen !== gen) return false;
      try {
        const S = parseLog(text, name);
        return await finish(S, { type: 'text', name, ...source }, myGen, text);
      } catch (e) { return fail(e, name, myGen); }
    },

    openFile: async (file, opts) => {
      const myGen = await begin(`Lendo ${file.name}…`);
      if (myGen !== gen) return false;
      try {
        const text = await file.text();
        if (myGen !== gen) return false;
        const S = parseLog(text, file.name);
        const ok = await finish(S, { type: 'file', name: file.name }, myGen, text);
        if (ok && opts?.saveTo) {
          /* guarda na biblioteca (resumo calculado aqui no modo local); log repetido liga a
           * sessão aberta à que já existe, em vez de duplicar */
          try {
            const r = await get().saveToLibrary(opts.saveTo);
            if (r?.duplicate && myGen === gen) {
              notifications.show({ title: 'Este log já estava na biblioteca', message: `Abri “${r.meta.name}” sem guardar de novo.`, autoClose: 6000 });
            }
          } catch (e) {
            if (myGen === gen) notifications.show({ color: 'yellow', title: 'O log abriu, mas não foi guardado na biblioteca', message: storageErrorMessage(e), autoClose: 10_000 });
          }
        }
        return ok;
      } catch (e) { return fail(e, file.name, myGen); }
    },

    openDemo: async () => {
      const myGen = await begin('Gerando a sessão de exemplo…');
      if (myGen !== gen) return false;
      try {
        /* como o botão do antigo: parseCSV(demoCSV()), demo = true, carro DEMO_CAR, linha automática */
        const S = parseCSV(demoCSV(), 'exemplo_baja.csv');
        S.demo = true;
        const ok = await finish(S, { type: 'demo', name: 'Sessão de exemplo' }, myGen);
        if (ok) notifications.show({ title: 'Sessão de exemplo carregada', message: 'Aperte ▶ (ou espaço) para reproduzir', autoClose: 4000 });
        return ok;
      } catch (e) { return fail(e, 'exemplo', myGen); }
    },

    openFromLibrary: async (meta, lib, opts) => {
      const L = lib ?? activeLib;
      const myGen = await begin(`Baixando ${meta.name}…`);
      if (myGen !== gen) return false;
      try {
        if (!L) throw new Error('a biblioteca ainda não está pronta');
        /* perfis da sessão (carro/pista escolhidos ao guardar), quando existem aqui */
        const P = useProfiles.getState();
        if (meta.carId && meta.carId !== P.activeCarId && P.cars.some(c => c.id === meta.carId)) P.setActiveCar(meta.carId);
        if (meta.trackId && meta.trackId !== P.activeTrackId && P.tracks.some(t => t.id === meta.trackId)) P.setActiveTrack(meta.trackId);
        const text = await L.getSessionText(meta.id);
        if (myGen !== gen) return false;
        set({ loadingText: `Lendo ${meta.name}…` });
        await yieldFrame();
        if (myGen !== gen) return false;
        const S = parseLog(text, meta.fileName || meta.name);
        const ok = await finish(S, { type: 'library', name: meta.name, libraryId: meta.id, meta }, myGen);
        if (ok) rememberSession(L, meta.id);
        return ok;
      } catch (e) {
        if (opts?.silent) {
          /* reabrir ao carregar o app: sem aviso; a tela volta a "nenhuma sessão" */
          if (myGen !== gen) return false;
          console.warn('Não consegui reabrir a última sessão', e);
          set(get().S ? { status: 'ready', loadingText: null } : { ...EMPTY });
          return false;
        }
        return fail(e, meta.name, myGen);
      }
    },

    saveToLibrary: lib => {
      const L = lib ?? activeLib;
      const st = get();
      const { S, source, unsavedText: text } = st;
      if (!S || !source || source.libraryId || text === null || S.demo || st.status !== 'ready') return Promise.resolve(null);
      /* já guardando esta sessão (outro botão, duplo clique): a mesma promessa */
      if (saving && saving.S === S) return saving.p;
      if (!L) return Promise.reject(new Error('a biblioteca ainda não está pronta'));
      const p = (async (): Promise<SaveResult> => {
        let meta: SessionMeta, duplicate = false;
        try {
          meta = await addLogToLibrary(L, { name: source.name, text }, {}, st.ctx);
        } catch (e) {
          const dupId = duplicateIdOf(e);
          const existing = dupId ? await L.getSession(dupId).catch(() => null) : null;
          if (!existing) throw e;
          meta = existing; duplicate = true;
        }
        /* outra sessão abriu (ou fechou) enquanto guardava: a guardada fica só na biblioteca */
        if (get().S !== S) return { meta, duplicate };
        set(s => ({
          source: s.source ? { ...s.source, type: 'library', name: meta.name, libraryId: meta.id, meta } : s.source,
          unsavedText: null,
        }));
        rememberSession(L, meta.id);
        return { meta, duplicate };
      })();
      saving = { S, p };
      set({ savingToLibrary: true });
      const done = () => { if (saving?.p === p) { saving = null; set({ savingToLibrary: false }); } };
      p.then(done, done);
      return p;
    },

    close: () => {
      gen++;
      /* "Fechar sessão" da sessão lembrada: não reabre ao carregar o app. Fechar o exemplo ou um
       * log aberto sem salvar não esquece a última sessão da biblioteca (abrir o exemplo pelo
       * link ?exemplo=1 e fechar não pode apagar a memória do que a pessoa estava vendo) */
      const id = get().source?.libraryId;
      if (id) forgetSession(id);
      set({ ...EMPTY });
    },

    updateConfig: patch => {
      const st = get();
      const demo = !!st.S?.demo;
      const p = { ...patch } as Record<string, unknown>;
      /* canais X/Y/status andam juntos: sem o par, normalizeConfig adivinharia os dois de novo */
      if (st.cfg && ('chX' in p || 'chY' in p || 'chStatus' in p)) {
        if (!('chX' in p)) p.chX = st.cfg.chX;
        if (!('chY' in p)) p.chY = st.cfg.chY;
        if (!('chStatus' in p)) p.chStatus = st.cfg.chStatus;
      }
      useProfiles.getState().applyPatch(p, demo);   /* rev muda → recalcula */
    },

    setLine: pts => {
      /* A.setLine do antigo: arredonda a 2 casas, zera a volta selecionada e recalcula. A
       * janela que mostrava a volta zerada volta para a sessão inteira (as voltas vão mudar) */
      const l = pts ? pts.map(q => ({ x: +q.x.toFixed(2), y: +q.y.toFixed(2) })) : null;
      const st = get();
      if (st.S && st.ctx && st.selLap >= 0) set(keepLap(st.S, st.ctx.laps, [], st.selLap, st.view));
      else set({ selLap: -1 });
      useProfiles.getState().applyPatch({ line: l }, !!st.S?.demo);
    },

    recompute: async () => {
      const st0 = get();
      if (st0.status !== 'ready' || !st0.S) return;
      const myGen = gen;
      set({ busy: true });
      await yieldFrame();
      const st = get();
      if (myGen !== gen || !st.S || st.status !== 'ready') { set({ busy: false }); return; }
      try {
        const S = st.S, demo = !!S.demo;
        const ctx = computeSession(S, configInput(demo), {});
        if (!demo) useProfiles.getState().syncGuessedChannels({ chX: ctx.cfg.chX, chY: ctx.cfg.chY, chStatus: ctx.cfg.chStatus });
        const t = S.t;
        const now = get();
        /* recompute() do antigo: a volta selecionada some se não existir mais (aqui pela
         * identidade da volta, não só pelo índice: keepLap) */
        const kept = now.ctx && now.S === S ? keepLap(S, now.ctx.laps, ctx.laps, now.selLap, now.view) : { selLap: -1, view: now.view };
        set({
          ctx, cfg: ctx.cfg, availability: sensorAvailability(ctx), busy: false, error: null, ...kept,
          cursor: t.length ? clamp(now.cursor, t[0], t[t.length - 1]) : 0,
          colorKey: pickColorKey(ctx.all, now.colorKey),
        });
      } catch (e) {
        console.error(e);
        set({ busy: false, error: msgOf(e) });
        notifications.show({ color: 'red', title: 'Erro ao recalcular', message: msgOf(e) });
      }
    },

    seek: tc => {
      const st = get();
      if (!st.S || !st.S.t.length) return;
      const t = st.S.t;
      const cur = clamp(tc, t[0], t[t.length - 1]);
      if (st.playing) lastWall = performance.now();
      if (cur !== st.cursor) set({ cursor: cur });
    },

    play: () => {
      const st = get();
      if (!st.S || !st.S.t.length) return;
      const [a, b] = playBounds(st);
      let cur = st.cursor;
      if (cur >= b - 1e-6 || cur < a) cur = a;
      lastWall = performance.now();
      set({ playing: true, cursor: cur });
      requestFrame();
    },

    pause,

    togglePlay: () => (get().playing ? get().pause() : get().play()),

    setSpeed: v => set({ speed: v > 0 && isFinite(v) ? v : 1 }),
    setLoop: v => set({ loop: v }),

    setLap: k => {
      /* selectLap do antigo: volta selecionada → janela na volta ±2 % e cursor no começo dela */
      const st = get();
      if (!st.S || !st.ctx) return;
      const l = k >= 0 ? st.ctx.laps[k] : undefined;
      if (l) {
        set({ selLap: k, view: lapWindow(st.S, l) });
        get().seek(l.t0);
      } else set({ selLap: -1, view: null });
    },

    setRangeMode: m => set({ rangeMode: m }),

    setView: v => {
      const S = get().S;
      if (!S || !S.t.length) return;
      set({ view: v ? clampView(S, v[0], v[1]) : null });
    },

    resetView: () => {
      const st = get();
      if (!st.S || !st.ctx) return;
      const l = st.selLap >= 0 ? st.ctx.laps[st.selLap] : undefined;
      set({ view: l ? lapWindow(st.S, l) : null });
    },

    zoomView: (f, tc) => {
      const st = get();
      if (!st.S || !st.S.t.length) return;
      const t = st.S.t;
      const [t0, t1] = st.view ?? [t[0], t[t.length - 1]];
      const c = tc ?? st.cursor;
      set({ view: clampView(st.S, c - (c - t0) * f, c + (t1 - c) * f) });
    },

    setFollow: v => set({ follow: v }),
    setColorKey: k => set({ colorKey: k }),
    setXAxis: x => set({ xAxis: x }),
    clearError: () => set(s => ({ error: null, status: s.status === 'error' ? 'empty' : s.status })),
    setSourceMeta: meta => set(s => (s.source && s.source.libraryId === meta.id
      ? { source: { ...s.source, name: meta.name, meta } }
      : {})),
    detachFromLibrary: id => set(s => (s.source && s.source.libraryId === id
      ? { source: { type: 'file', name: s.source.name } }
      : {})),
  };
});

/** Leitura fora do React. */
export const getSession = (): SessionState => useSessionStore.getState();

/* ---------------------------------------------------------------- hooks */

/** Há uma sessão aberta e calculada? (habilita as páginas com needsSession) */
export const useHasSession = (): boolean => useSessionStore(s => s.S !== null && s.status === 'ready');

/** Sessão pronta (S e ctx calculados). */
export const useSessionReady = (): boolean => useSessionStore(s => s.status === 'ready' && s.ctx !== null);

/** O SessionContext do core (null sem sessão). */
export const useCtx = (): SessionContext | null => useSessionStore(s => s.ctx);

/** Trecho das análises [i0, i1, rótulo] = rangeOf(ctx, rangeMode, selLap, view). null sem sessão.
 *  Use nos relatórios: useMemo(() => report(ctx, i0, i1), [ctx, i0, i1]). */
export function useRange(): [number, number, string] | null {
  const ctx = useSessionStore(s => s.ctx);
  const mode = useSessionStore(s => s.rangeMode);
  const sel = useSessionStore(s => s.selLap);
  /* a janela só entra no trecho "Janela": nos outros modos mexer no zoom (ou escolher uma
   * volta, que move a janela) não pode recalcular os relatórios */
  const view = useSessionStore(s => (s.rangeMode === 'view' ? s.view : null));
  const r = useMemo(() => (ctx ? rangeOf(ctx, mode, sel, view ?? undefined) : null), [ctx, mode, sel, view]);
  /* mesmo trecho → o mesmo array (as páginas usam o trecho como dependência de useMemo) */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => r, [ctx, r === null, r?.[0], r?.[1], r?.[2]]);
}

/** Tempo do cursor com limitação (~20×/s no play; imediato parado) — para textos e tabelas. */
export function useCursorTime(intervalMs = 50): number {
  const [t, setT] = useState(() => useSessionStore.getState().cursor);
  useEffect(() => {
    let last = 0, timer: ReturnType<typeof setTimeout> | undefined;
    setT(useSessionStore.getState().cursor);
    const unsub = useSessionStore.subscribe((s, p) => {
      if (s.cursor === p.cursor) return;
      const now = performance.now();
      if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
      if (!s.playing || now - last >= intervalMs) { last = now; setT(s.cursor); }
      else {
        timer = setTimeout(() => { timer = undefined; last = performance.now(); setT(useSessionStore.getState().cursor); }, intervalMs - (now - last));
      }
    });
    return () => { unsub(); if (timer !== undefined) clearTimeout(timer); };
  }, [intervalMs]);
  return t;
}

/** Índice da amostra no cursor (idxAt(S.t, cursor)), com a mesma limitação; -1 sem sessão. */
export function useCursorIndex(intervalMs = 50): number {
  const S = useSessionStore(s => s.S);
  const t = useCursorTime(intervalMs);
  return useMemo(() => (S && S.t.length ? idxAt(S.t, t) : -1), [S, t]);
}

/** Chama fn(cursor) a cada mudança do cursor (60×/s no play) SEM re-render: para gráficos e
 *  mapa (ref.current.setCursor(t), setCursorTime(t), setHi...). Também chama ao montar. */
export function useCursorEffect(fn: (t: number, s: SessionState) => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const s0 = useSessionStore.getState();
    if (s0.S) ref.current(s0.cursor, s0);
    return useSessionStore.subscribe((s, p) => {
      if (s.cursor !== p.cursor || s.S !== p.S) ref.current(s.cursor, s);
    });
  }, []);
}

/* depuração no navegador (só em desenvolvimento): window.__baja.session.getState() */
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __baja?: object }).__baja = { session: useSessionStore, profiles: useProfiles };
}
