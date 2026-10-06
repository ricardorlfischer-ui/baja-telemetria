/* Página Canais (#/canais, docs/ARQUITETURA.md 4.2): a tela principal de análise, no estilo
 * AiM RaceStudio / MoTeC i2. Lista de canais com valor no cursor e mín/máx (clique = ir ao
 * ponto), painéis empilhados com cursor compartilhado (um ou vários canais da mesma unidade
 * por painel, arrastar canal para painel), eixo X em tempo ou distância, faixa de voltas no
 * topo, volta de referência sobreposta, visão geral da sessão embaixo, mini-mapa e layouts
 * salvos. É o "Canais" do app antigo (legacy/js/charts.js, mesmas interações), com uPlot.
 *
 * A página só desenha: os canais (do log e calculados) vêm prontos do core (ctx.all), os
 * sensores de cada um de sensorsOfChannel e o card de cada um de channelExplainId. As peças
 * ficam em pages/canais/. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon, Button, Drawer, Group, Modal, Paper, SegmentedControl, Select, Stack, Text, TextInput, Tooltip,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle, IconHelpCircle, IconInfoCircle, IconStack2, IconChartLine, IconDeviceFloppy, IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand, IconListDetails, IconPlus, IconTrash, IconZoomIn, IconZoomOut,
} from '@tabler/icons-react';
import { fmtTime, mergeSensors, spanOf, type Channel, type SessionContext } from '@baja/core';
import {
  ChartCard, EmptyState, NoSessionState, PageHeader, TrackMap, type MapSource, type TrackMapHandle,
} from '../components';
import { useChartTheme } from '../theme';
import { routeByPath } from '../routes';
import { useCursorEffect, useSessionStore } from '../state/session';
import { usePrefs } from '../state/prefs';
import { ChartsCtl } from './canais/ctl';
import {
  PRESETS, buildPreset, channelInfo, distanceSource, fromSaved, mkPanel, panelColors, unitOf, xAxisData,
  type Note, type Overlay, type PanelDef, type PresetId,
} from './canais/model';
import { ChannelPanel, type PanelActions } from './canais/ChannelPanel';
import { ChannelList } from './canais/ChannelList';
import { AxisRow, LapStrip, Overview } from './canais/Navigators';
import { droppedKey, isChannelDrag } from './canais/dnd';
import './canais/canais.css';

/* layout em uso, lembrado ao sair e voltar para a página com a mesma sessão */
let memo: { S: object; panels: PanelDef[]; layout: string; notes: Note[]; dirty: boolean } | null = null;

const HINT = 'Clique/arraste = cursor · Shift+arrastar = zoom no trecho · Ctrl+roda = zoom · Shift+roda = andar · duplo clique = tudo';

export default function CanaisPage() {
  const r = routeByPath('/canais')!;
  const ctx = useSessionStore(s => (s.status === 'ready' ? s.ctx : null));

  if (!ctx) {
    return (
      <>
        <PageHeader title={r.label} subtitle={r.question} />
        <NoSessionState icon={IconChartLine} title="Abra uma sessão para ver os canais"
          description="Os gráficos aparecem aqui, um por canal do log, todos no mesmo eixo de tempo (ou de distância): velocidade, amortecedores, temperatura da CVT e os canais calculados pelo app. Abra um CSV do FT Manager ou um log do BUSMASTER, escolha um na biblioteca, ou veja com os dados de exemplo." />
      </>
    );
  }
  return <Workspace ctx={ctx} />;
}

/* ====================================================================== área de trabalho */
function Workspace({ ctx }: { ctx: SessionContext }) {
  const r = routeByPath('/canais')!;
  const th = useChartTheme();
  const wide = useMediaQuery('(min-width: 1200px)', true, { getInitialValueInEffect: false });
  const S = ctx.S;
  const selLap = useSessionStore(s => s.selLap);
  const follow = useSessionStore(s => s.follow);
  const xAxisPref = useSessionStore(s => s.xAxis);
  const store = useSessionStore.getState;
  const prefs = usePrefs();

  const info = useMemo(() => channelInfo(ctx), [ctx]);
  const dist = useMemo(() => distanceSource(ctx), [ctx]);
  const mode = xAxisPref === 'dist' && dist ? 'dist' : 'time';
  const ax = useMemo(() => xAxisData(ctx, mode), [ctx, mode]);

  /* ---------------------------------------------------------------- painéis */
  const initial = () => {
    if (memo && memo.S === S) return memo;
    const last = prefs.lastChannelLayout && prefs.channelLayouts[prefs.lastChannelLayout];
    if (last) { const res = fromSaved(last, info); if (res.panels.length) return { S, panels: res.panels, layout: 'saved:' + last.name, notes: res.notes, dirty: false }; }
    const res = buildPreset('tudo', ctx, info);
    return { S, panels: res.panels, layout: 'preset:tudo', notes: res.notes, dirty: false };
  };
  const [state, setState] = useState(initial);
  const { panels, layout, notes, dirty } = state;
  const [notesOpen, setNotesOpen] = useState(false);
  const [sideOpen, setSideOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [refLap, setRefLap] = useState<number | null>(null);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [stackDrop, setStackDrop] = useState(false);
  const [addSearch, setAddSearch] = useState('');

  /* sessão nova → layout inicial; recálculo → tira canais que deixaram de existir */
  const lastS = useRef(S);
  useEffect(() => {
    if (lastS.current !== S) { lastS.current = S; memo = null; setState(initial()); setRefLap(null); return; }
    setState(st => {
      const panels2 = st.panels.map(p => ({ ...p, keys: p.keys.filter(k => !!info.chan(k)) })).filter(p => p.keys.length);
      const same = panels2.length === st.panels.length && panels2.every((p, i) => p.keys.length === st.panels[i].keys.length);
      return same ? st : { ...st, panels: panels2 };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [S, info]);
  useEffect(() => { memo = state; }, [state]);

  const setPanels = useCallback((fn: (p: PanelDef[]) => PanelDef[]) => setState(st => ({ ...st, panels: fn(st.panels), dirty: true })), []);
  /* painéis atuais para decidir fora do setState (avisos e rolagem não podem ir no atualizador) */
  const panelsRef = useRef(panels);
  panelsRef.current = panels;

  const applyLayout = (value: string) => {
    let res: { panels: PanelDef[]; notes: Note[] } | null = null;
    if (value.startsWith('preset:')) res = buildPreset(value.slice(7) as PresetId, ctx, info);
    else if (value.startsWith('saved:')) {
      const l = prefs.channelLayouts[value.slice(6)];
      if (l) {
        res = fromSaved(l, info);
        if (l.xAxis) store().setXAxis(l.xAxis);
        prefs.set({ lastChannelLayout: l.name });
      }
    }
    if (!res) return;
    if (value.startsWith('preset:')) prefs.set({ lastChannelLayout: null });
    setState({ S, panels: res.panels, layout: value, notes: res.notes, dirty: false });
    setNotesOpen(false);
    rootRef.current?.scrollTo({ top: 0 });
  };

  const actions = useMemo<PanelActions>(() => ({
    removeKey: (id, key) => setPanels(ps => ps.map(p => (p.id === id ? { ...p, keys: p.keys.filter(k => k !== key) } : p)).filter(p => p.keys.length)),
    removePanel: id => setPanels(ps => ps.filter(p => p.id !== id)),
    move: (id, dir) => setPanels(ps => {
      const i = ps.findIndex(p => p.id === id), j = i + dir;
      if (i < 0 || j < 0 || j >= ps.length) return ps;
      const out = ps.slice();
      [out[i], out[j]] = [out[j], out[i]];
      return out;
    }),
    resize: (id, h) => setPanels(ps => ps.map(p => (p.id === id ? { ...p, height: h } : p))),
    drop: (id, key) => {
      const c = info.chan(key);
      const p = panelsRef.current.find(q => q.id === id);
      if (!c || !p || p.keys.includes(key)) return;
      const u0 = unitOf(info.chan(p.keys[0]));
      if (unitOf(c) === u0) { setPanels(ps => ps.map(q => (q.id === id ? { ...q, keys: [...q.keys, key] } : q))); return; }
      /* um eixo Y por painel: unidade diferente vai para um painel novo logo abaixo */
      const np = mkPanel([key]);
      setPanels(ps => {
        const i = ps.findIndex(q => q.id === id);
        const out = ps.slice();
        out.splice(i < 0 ? out.length : i + 1, 0, np);
        return out;
      });
      setScrollTarget(np.id);
      notifications.show({
        title: 'Unidade diferente: painel novo',
        message: `${c.name} (${c.unit || 'sem unidade'}) não divide o eixo com ${u0 || 'sem unidade'}: um eixo Y por painel. Criei um painel logo abaixo.`,
        autoClose: 5000,
      });
    },
  }), [info, setPanels]);

  const addPanel = (key: string) => {
    if (!info.chan(key)) return;
    const np = mkPanel([key]);
    setPanels(ps => [...ps, np]);
    setScrollTarget(np.id);
  };

  /* clique na lista: mostrar (painel novo no fim) ou ocultar (de todos os painéis) */
  const toggle = useCallback((key: string) => {
    if (panelsRef.current.some(p => p.keys.includes(key))) {
      setPanels(ps => ps.map(p => ({ ...p, keys: p.keys.filter(k => k !== key) })).filter(p => p.keys.length));
      return;
    }
    const np = mkPanel([key]);
    setPanels(ps => [...ps, np]);
    setScrollTarget(np.id);
  }, [setPanels]);

  /* ---------------------------------------------------------------- volta de referência */
  const laps = ctx.laps;
  const overlay = useMemo<Overlay | null>(() => {
    if (refLap === null || selLap < 0 || refLap === selLap) return null;
    const sel = laps[selLap], ref = laps[refLap];
    return sel && ref ? { sel, ref } : null;
  }, [refLap, selLap, laps]);
  useEffect(() => { if (refLap !== null && !laps[refLap]) setRefLap(null); }, [laps, refLap]);
  const chooseRef = (v: string | null) => {
    if (v === null) { setRefLap(null); return; }
    const k = +v;
    setRefLap(k);
    /* sem volta selecionada: seleciona a melhor (ou a primeira que não é a referência) */
    if (store().selLap < 0 || store().selLap === k) {
      const best = laps.reduce((b, l, i) => (l.time < laps[b].time ? i : b), 0);
      store().setLap(best !== k ? best : laps.findIndex((_, i) => i !== k));
    }
  };

  /* ---------------------------------------------------------------- controlador */
  const ctlRef = useRef<ChartsCtl | null>(null);
  if (!ctlRef.current) ctlRef.current = new ChartsCtl();
  const ctl = ctlRef.current;
  ctl.ctx = ctx; ctl.info = info; ctl.ax = ax; ctl.th = th; ctl.overlay = overlay;
  useEffect(() => ctl.attach(), [ctl]);
  /* depuração no navegador (só em desenvolvimento): window.__baja.canais */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __baja?: Record<string, unknown> };
    if (w.__baja) w.__baja.canais = ctl;
    return () => { if (w.__baja) delete w.__baja.canais; };
  }, [ctl]);
  useEffect(() => { ctl.applyView(); ctl.applyCursor(); ctl.redrawAll(); ctl.updateLive(); }, [ctl, ctx, ax, overlay, th]);

  /* ---------------------------------------------------------------- cores e sensores */
  const colors = useMemo(() => {
    const m = new Map<string, string>();
    panels.forEach(p => { const cs = panelColors(p.keys, info, th); p.keys.forEach((k, i) => { if (!m.has(k)) m.set(k, cs[i]); }); });
    return m;
  }, [panels, info, th]);
  const allSensors = useMemo(() => mergeSensors(...panels.flatMap(p => p.keys.map(k => info.sensors(k))), mode === 'dist' ? ax.sensors : [], overlay ? ['gps'] : []),
    [panels, info, mode, ax, overlay]);

  const overviewChan = useMemo<Channel | null>(() => {
    const pick = (k: string) => ctx.all.find(c => c.key === k && !c.constant);
    return pick('veh:v') ?? pick('gps:speed') ?? ctx.all.find(c => !c.constant) ?? null;
  }, [ctx]);

  /* ---------------------------------------------------------------- mini-mapa */
  const mapRef = useRef<TrackMapHandle>(null);
  const mapSource = useMemo<MapSource>(() => ({
    t: S.t, track: ctx.track, hasLatLon: !!S.gps, span: spanOf(ctx.cfg), laps: ctx.laps, selLap, line: ctx.cfg.line,
    cursor: store().cursor, onSeek: tc => ctl.goTo(tc),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [S, ctx, selLap, ctl]);
  useCursorEffect(tc => mapRef.current?.setCursor(tc));
  /* TrackMap: o primeiro desenho (rAF) mede o canvas antes do ResizeObserver e aí o
   * enquadramento inicial não acontece. Enquadra dois quadros depois de montar. */
  useEffect(() => {
    let a = 0, b = 0;
    a = requestAnimationFrame(() => { b = requestAnimationFrame(() => mapRef.current?.fit()); });
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b); };
  }, [ctx.track, sideOpen, wide, drawerOpen]);

  /* ---------------------------------------------------------------- altura da área */
  /* A barra de ferramentas fica presa no topo ao rolar; a área de trabalho ocupa o resto da
   * tela embaixo dela (rolando a página só o título sai de vista). */
  const rootRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const [workH, setWorkH] = useState(640);
  useLayoutEffect(() => {
    const measure = () => {
      const main = document.querySelector('.bt-main');
      const padB = main ? parseFloat(getComputedStyle(main).paddingBottom) || 84 : 84;
      const head = document.querySelector('.bt-header')?.getBoundingClientRect().height ?? 60;
      const sticky = stickyRef.current?.getBoundingClientRect().height ?? 80;
      setWorkH(Math.max(460, Math.round(window.innerHeight - padB - head - sticky - 14)));
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = new ResizeObserver(measure);
    if (stickyRef.current) ro.observe(stickyRef.current);
    return () => { window.removeEventListener('resize', measure); ro.disconnect(); };
  }, []);

  /* ---------------------------------------------------------------- layouts salvos */
  const savedNames = Object.keys(prefs.channelLayouts).sort((a, b) => a.localeCompare(b));
  const layoutData = [
    { group: 'Prontos', items: PRESETS.map(p => ({ value: 'preset:' + p.id, label: p.label })) },
    ...(savedNames.length ? [{ group: 'Salvos', items: savedNames.map(n => ({ value: 'saved:' + n, label: n })) }] : []),
  ];
  const presetHint = layout.startsWith('preset:') ? PRESETS.find(p => 'preset:' + p.id === layout)?.hint : 'layout salvo neste navegador';
  const doSave = () => {
    const name = saveName.trim();
    if (!name) return;
    prefs.saveChannelLayout({ name, panels: panels.map(p => ({ keys: p.keys, height: p.height })), xAxis: mode });
    setState(st => ({ ...st, layout: 'saved:' + name, dirty: false }));
    setSaveOpen(false);
    notifications.show({ title: 'Layout salvo', message: `“${name}” fica neste navegador e abre com qualquer sessão (os canais que faltarem são avisados).`, autoClose: 4000 });
  };

  /* ---------------------------------------------------------------- toolbar */
  const lapOptions = laps.map((l, k) => ({ value: String(k), label: `Volta ${l.n} · ${fmtTime(l.time)}` }));
  const canOverlay = laps.length >= 2;
  const ovText = overlay
    ? `V${overlay.sel.n} (forte) × V${overlay.ref.n} (referência, mais clara) · ${mode === 'dist' ? 'pela distância normalizada' : 'alinhadas pelo início da volta'}`
    : refLap !== null && selLap === refLap ? 'Escolha outra volta: a referência é a volta selecionada' : null;

  const lbl = (txt: string, opt = false) => <Text span size="sm" c="dimmed" className={opt ? 'cn-tb-label cn-tb-label--opt' : 'cn-tb-label'}>{txt}</Text>;
  const toolbar = (
    <Paper withBorder radius="md" className="cn-toolbar">
      <Group gap="sm" wrap="wrap" align="center">
        {wide ? (
          <Tooltip label={sideOpen ? 'Esconder a lista de canais' : 'Mostrar a lista de canais'}>
            <ActionIcon variant="default" size={36} onClick={() => setSideOpen(o => !o)} aria-label="Lista de canais">
              {sideOpen ? <IconLayoutSidebarLeftCollapse size={20} /> : <IconLayoutSidebarLeftExpand size={20} />}
            </ActionIcon>
          </Tooltip>
        ) : (
          <Button variant="default" leftSection={<IconListDetails size={18} />} onClick={() => setDrawerOpen(true)}>Canais</Button>
        )}
        <Group gap={8} wrap="nowrap">
          {lbl('Eixo X', true)}
          <Tooltip label="Sem GPS nem sensor de roda neste log: não há como medir a distância percorrida" disabled={!!dist}>
            <SegmentedControl
              value={mode} onChange={v => store().setXAxis(v as 'time' | 'dist')}
              data={[{ value: 'time', label: 'Tempo' }, { value: 'dist', label: 'Distância', disabled: !dist }]}
              aria-label="Eixo X"
            />
          </Tooltip>
        </Group>
        <Group gap={6} wrap="nowrap">
          {lbl(dirty ? 'Layout*' : 'Layout')}
          <Select data={layoutData} value={layout} onChange={v => v && applyLayout(v)} w={150} allowDeselect={false}
            aria-label="Layout dos painéis" title={dirty ? 'Layout alterado (salve para guardar)' : presetHint}
            comboboxProps={{ withinPortal: true, width: 340, position: 'bottom-start' }} maxDropdownHeight={380}
            renderOption={({ option }) => {
              const h = PRESETS.find(q => 'preset:' + q.id === option.value)?.hint ?? 'layout salvo neste navegador';
              return <div><Text size="sm" fw={600}>{option.label}</Text><Text size="xs" c="dimmed">{h}</Text></div>;
            }} />
          <Tooltip label="Salvar o layout atual com um nome (fica neste navegador)">
            <ActionIcon variant="default" size={36} onClick={() => { setSaveName(layout.startsWith('saved:') ? layout.slice(6) : ''); setSaveOpen(true); }} aria-label="Salvar layout">
              <IconDeviceFloppy size={19} />
            </ActionIcon>
          </Tooltip>
          {layout.startsWith('saved:') && (
            <Tooltip label="Apagar este layout salvo">
              <ActionIcon variant="default" size={36} aria-label="Apagar layout salvo" onClick={() => {
                prefs.deleteChannelLayout(layout.slice(6));
                setState(st => ({ ...st, layout: 'preset:tudo', dirty: true }));
              }}><IconTrash size={18} /></ActionIcon>
            </Tooltip>
          )}
        </Group>
        <Group gap={8} wrap="nowrap">
          {lbl('Sobrepor', true)}
          <Tooltip label={ctx.track.ok ? 'Precisa de pelo menos 2 voltas: defina a linha de largada na página Mapa' : 'Precisa do GPS para separar as voltas'} disabled={canOverlay}>
            <Select data={lapOptions} value={refLap === null ? null : String(refLap)} onChange={chooseRef} placeholder={canOverlay ? 'sobrepor volta…' : 'sem voltas'}
              leftSection={<IconStack2 size={16} />}
              clearable disabled={!canOverlay} w={168} aria-label="Volta de referência para sobrepor" comboboxProps={{ withinPortal: true }} />
          </Tooltip>
        </Group>
        <Text size="sm" c="dimmed" className="cn-toolbar-hint">{HINT}</Text>
        <Tooltip label={HINT} multiline maw={300}>
          <ActionIcon variant="subtle" color="gray" size={36} className="cn-hint-btn" aria-label={'Como usar: ' + HINT}><IconHelpCircle size={20} /></ActionIcon>
        </Tooltip>
        <Group gap={6} ml="auto" wrap="nowrap">
          <Tooltip label="Menos zoom"><ActionIcon variant="default" size={36} onClick={() => ctl.zoomAt(2)} aria-label="Menos zoom"><IconZoomOut size={19} /></ActionIcon></Tooltip>
          <Tooltip label="Mais zoom (em torno do cursor)"><ActionIcon variant="default" size={36} onClick={() => ctl.zoomAt(0.5)} aria-label="Mais zoom"><IconZoomIn size={19} /></ActionIcon></Tooltip>
          <Tooltip label="Tudo: a volta selecionada ou a sessão inteira (duplo clique no gráfico)">
            <Button variant="default" onClick={() => ctl.reset()} px={14}>Tudo</Button>
          </Tooltip>
          <Tooltip label="No play, a janela de tempo acompanha o cursor">
            <Button variant={follow ? 'filled' : 'default'} aria-pressed={follow} onClick={() => store().setFollow(!follow)}>Acompanhar</Button>
          </Tooltip>
        </Group>
      </Group>
      {(ovText || mode === 'dist') && (
        <Text size="sm" c="dimmed" mt={8}>
          {ovText && <><b>Sobreposição:</b> {ovText}</>}
          {ovText && mode === 'dist' && ' · '}
          {mode === 'dist' && <>Eixo X: distância pela {ax.src}</>}
        </Text>
      )}
    </Paper>
  );

  /* ---------------------------------------------------------------- lista + mini-mapa */
  const list = <ChannelList ctx={ctx} info={info} ctl={ctl} colors={colors} onToggle={toggle} />;
  const miniMap = (
    <ChartCard title="Mini-mapa" explain="chart.miniMap" sensors={ctx.track.ok ? ['gps'] : []} flush>
      {ctx.track.ok ? (
        <TrackMap ref={mapRef} source={mapSource} height={wide ? (workH >= 720 ? 240 : workH >= 580 ? 180 : 140) : 220} controls={false} />
      ) : (
        <Text size="sm" c="dimmed" px="md" pb="md">
          Sem GPS neste log{ctx.track.msg ? `: ${ctx.track.msg.replace(/.$/, '')}` : ''}. Com o módulo GPS ligado (entradas 7/8 da FT) o mini-mapa mostra onde cada coisa aconteceu.
        </Text>
      )}
    </ChartCard>
  );

  /* ---------------------------------------------------------------- painéis */
  const stackDropProps = {
    onDragOver: (e: React.DragEvent) => { if (isChannelDrag(e)) { e.preventDefault(); if (!stackDrop) setStackDrop(true); } },
    onDragLeave: () => setStackDrop(false),
    onDrop: (e: React.DragEvent) => { if (!isChannelDrag(e)) return; e.preventDefault(); setStackDrop(false); const k = droppedKey(e); if (k) addPanel(k); },
  };
  const presetEmpty = layout === 'preset:suspensao'
    ? 'Este log não tem amortecedores com sinal: o layout Suspensão fica vazio.'
    : 'Nenhum painel neste layout.';
  const emptyHow = layout === 'preset:suspensao'
    ? 'Os potenciômetros lineares dos amortecedores (FL, FR, RL, RR) ligados nas entradas da FT dão curso, velocidade do amortecedor, arfagem e rolagem. Enquanto isso, clique num canal da lista (ou arraste para cá) para criar um painel, ou escolha o layout Tudo.'
    : 'Clique num canal da lista (ou arraste para cá) para criar um painel, ou escolha o layout Tudo.';

  const main = (
    <div className="cn-main">
      <ChartCard
        title={mode === 'dist' ? 'Canais por distância' : 'Canais no tempo'}
        explain={overlay ? 'chart.lapOverlay' : mode === 'dist' ? 'chart.distanceAxis' : 'chart.stackedChannels'}
        sensors={allSensors}
      >
        <LapStrip ctx={ctx} selLap={selLap} onSelect={k => { store().setLap(k); if (k < 0) setRefLap(null); }} />
        {notes.length > 0 && (
          <div className="cn-notes" data-level={notes.some(n => n.level === 'warn') ? 'warn' : 'info'}>
            {notes.some(n => n.level === 'warn') ? <IconAlertTriangle size={18} /> : <IconInfoCircle size={18} />}
            <div className="cn-notes-body">
              {notesOpen
                ? <ul>{notes.map((n, i) => <li key={i}>{n.text}</li>)}</ul>
                : <span>{notes.map(n => n.short).join(' · ')}</span>}
            </div>
            <Button variant="subtle" size="compact-sm" onClick={() => setNotesOpen(o => !o)}>{notesOpen ? 'Menos' : 'O que fazer'}</Button>
          </div>
        )}
        <div ref={rootRef} className="cn-stack">
          {panels.length === 0 ? (
            <EmptyState bare icon={IconChartLine} title={presetEmpty}
              description={emptyHow}
              action={<Button variant="default" onClick={() => applyLayout('preset:tudo')}>Layout Tudo</Button>} />
          ) : panels.map((p, i) => (
            <ChannelPanel key={p.id} p={p} index={i} count={panels.length} ctl={ctl} info={info} ax={ax} th={th} overlay={overlay}
              rootRef={rootRef} actions={actions} scrollTo={scrollTarget === p.id} />
          ))}
          <div className="cn-add" data-drop={stackDrop || undefined} {...stackDropProps}>
            <IconPlus size={18} />
            <Select
              data={ctx.all.map(c => ({ value: c.key, label: `${c.name}${c.unit ? ` (${c.unit})` : ''}${c.constant ? ' · constante' : ''}` }))}
              value={null} onChange={v => { if (v) addPanel(v); setAddSearch(''); }} searchable searchValue={addSearch} onSearchChange={setAddSearch}
              placeholder="Painel novo: escolha um canal ou arraste da lista"
              w={420} maw="100%" aria-label="Painel novo com o canal" comboboxProps={{ withinPortal: true }} nothingFoundMessage="Nenhum canal"
            />
          </div>
          {panels.length > 0 && <div className="cn-axis-wrap"><AxisRow ctl={ctl} ax={ax} th={th} laps={laps} /></div>}
        </div>
        <div className="cn-overview-wrap">
          <Overview ctl={ctl} ctx={ctx} th={th} chan={overviewChan} />
        </div>
      </ChartCard>
    </div>
  );

  return (
    <div className="cn-root">
      <PageHeader title={r.label} subtitle={r.question} explain="chart.stackedChannels" />
      <div ref={stickyRef} className="cn-sticky">{toolbar}</div>
      <div className="cn-work" data-side={wide && sideOpen ? 'open' : 'closed'} style={{ height: workH }}>
        {wide && sideOpen && (
          <div className="cn-side">
            {list}
            {miniMap}
          </div>
        )}
        {main}
      </div>

      <Drawer opened={!wide && drawerOpen} onClose={() => setDrawerOpen(false)} title="Canais" size={340} padding="sm">
        <div className="cn-drawer">{list}</div>
        <div style={{ marginTop: 12 }}>{miniMap}</div>
      </Drawer>

      <Modal opened={saveOpen} onClose={() => setSaveOpen(false)} title="Salvar layout dos painéis" centered>
        <Stack>
          <Text size="sm" c="dimmed">Os painéis ({panels.length}), os canais de cada um, as alturas e o eixo X ({mode === 'dist' ? 'distância' : 'tempo'}). Fica neste navegador e serve para qualquer sessão.</Text>
          <TextInput label="Nome" value={saveName} onChange={e => setSaveName(e.currentTarget.value)} placeholder="ex.: Suspensão traseira + CVT" data-autofocus
            onKeyDown={e => { if (e.key === 'Enter') doSave(); }} />
          {savedNames.includes(saveName.trim()) && <Text size="sm" c="yellow">Já existe um layout com esse nome: ele será substituído.</Text>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setSaveOpen(false)}>Cancelar</Button>
            <Button onClick={doSave} disabled={!saveName.trim()}>Salvar</Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}
