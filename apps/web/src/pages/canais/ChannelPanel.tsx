/* Um painel da página Canais: 1+ canais da mesma unidade num eixo Y, cabeçalho com
 * "NOME valor unidade" de cada canal no cursor (como o RaceStudio), chips dos sensores, ⓘ,
 * remover canal, reordenar, remover painel e redimensionar (arrastar a borda de baixo).
 * Recebe canais arrastados da lista. O uPlot só é criado quando o painel aparece na tela
 * (logs com ~40 canais: só os visíveis desenham). */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, CloseButton, Menu, Tooltip, UnstyledButton } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconInfoCircle, IconTrash } from '@tabler/icons-react';
import type uPlot from 'uplot';
import { channelExplainId, mergeSensors, type SensorId } from '@baja/core';
import { InfoButton, SensorChips, UPlotChart, useExplain, type UPlotHandle, type UPlotSeries } from '../../components';
import type { ChartTheme } from '../../theme';
import { PAD_R, Y_AXIS, type ChartsCtl } from './ctl';
import {
  PANEL_MAX_H, PANEL_MIN_H, lighter, overlayArray, panelColors, plotArray, tickDecimals, unitOf,
  type ChannelInfo, type Overlay, type PanelDef, type XAxisData,
} from './model';
import { drag, droppedKey, isChannelDrag } from './dnd';

/** Card de explicação de um canal (calculados têm card próprio; os do log, o do sensor). */
export function channelExplain(info: ChannelInfo, key: string): string {
  const s = info.sensors(key);
  const sensor = s.length === 1 && s[0] !== 'logger' ? s[0] : null;
  return channelExplainId(key, sensor);
}

export interface PanelActions {
  removeKey: (panelId: string, key: string) => void;
  removePanel: (panelId: string) => void;
  move: (panelId: string, dir: -1 | 1) => void;
  resize: (panelId: string, h: number) => void;
  drop: (panelId: string, key: string) => void;
}

interface Props {
  p: PanelDef;
  index: number;
  count: number;
  ctl: ChartsCtl;
  info: ChannelInfo;
  ax: XAxisData;
  th: ChartTheme;
  overlay: Overlay | null;
  /** contêiner que rola (para criar o gráfico só quando aparece) */
  rootRef: React.RefObject<HTMLDivElement | null>;
  actions: PanelActions;
  scrollTo: boolean;
}

const fmtTick = (_u: uPlot, vals: number[]) => {
  const step = vals.length > 1 ? Math.abs(vals[1] - vals[0]) : 1;
  const d = tickDecimals(step);
  return vals.map(v => (v == null ? '' : v.toFixed(d)));
};

export const ChannelPanel = memo(function ChannelPanel({ p, index, count, ctl, info, ax, th, overlay, rootRef, actions, scrollTo }: Props) {
  const { open } = useExplain();
  const boxRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const up = useRef<UPlotHandle>(null);
  const hovered = useRef(false);
  const [visible, setVisible] = useState(false);
  const [h, setH] = useState(p.height);
  const [dropHint, setDropHint] = useState<null | 'same' | 'other'>(null);
  useEffect(() => setH(p.height), [p.height]);

  const chans = useMemo(() => p.keys.map(k => info.chan(k)).filter((c): c is NonNullable<typeof c> => !!c), [p.keys, info]);
  const keys = useMemo(() => chans.map(c => c.key), [chans]);
  const colors = useMemo(() => panelColors(keys, info, th), [keys, info, th]);
  const unit = unitOf(chans[0]);
  /* sensores dos canais do painel (os do eixo de distância e das voltas aparecem no cartão de cima) */
  const sensors = useMemo<SensorId[]>(() => mergeSensors(...keys.map(k => info.sensors(k))), [keys, info]);

  /* só cria o gráfico quando o painel está perto da área visível */
  useEffect(() => {
    const el = boxRef.current, root = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(es => { for (const e of es) setVisible(e.isIntersecting); }, { root, rootMargin: '240px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [rootRef]);

  useEffect(() => {
    if (scrollTo) boxRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [scrollTo]);

  /* dados: [x, canais..., volta de referência...] */
  const t = ctl.t;
  const data = useMemo(() => {
    const ys = chans.map(c => plotArray(c));
    const refs = overlay ? chans.map(c => overlayArray(c, t, ax.X, overlay)) : [];
    return [ax.X, ...ys, ...refs] as unknown as uPlot.AlignedData;
  }, [chans, ax, overlay, t]);

  const series = useMemo<UPlotSeries[]>(() => [
    ...chans.map((c, i) => ({ label: c.name, id: colors[i], width: 1.6 })),
    ...(overlay ? chans.map((c, i) => ({ label: `${c.name} (ref.)`, id: lighter(colors[i]), width: 1.4 })) : []),
  ], [chans, colors, overlay]);

  const keysRef = useRef(keys);
  keysRef.current = keys;
  const colorsRef = useRef(colors);
  colorsRef.current = colors;

  const options = useMemo<Partial<uPlot.Options>>(() => ({
    padding: [8, PAD_R, 2, 0],
    cursor: {
      sync: { key: 'canais', setSeries: false },
      drag: { x: false, y: false, setScale: false },
      y: false,
      points: { size: 7, width: 2 },
      /* o duplo clique do uPlot voltaria ao todo sozinho; aqui ele é "Tudo" do antigo (ctl) */
      bind: { dblclick: () => null } as unknown as uPlot.Cursor.Bind,
    },
    axes: [
      { show: true, size: 0, values: () => [], ticks: { show: false }, grid: { stroke: th.grid, width: 1 }, stroke: th.text },
      {
        size: Y_AXIS, gap: 4, space: 26,
        stroke: th.text, font: `12px ${th.font}`,
        grid: { stroke: th.grid, width: 1 }, ticks: { stroke: th.axis, width: 1, size: 4 },
        values: fmtTick,
      },
    ],
    plugins: [ctl.plugin(() => keysRef.current)],
  }), [th, ctl]);

  /* registra no controlador (janela e cursor imperativos) */
  useLayoutEffect(() => {
    if (!visible || !up.current) return;
    return ctl.register(p.id, up.current);
  }, [visible, ctl, p.id]);

  /* dados novos: o uPlot volta ao todo; reaplica a janela */
  useEffect(() => {
    if (!visible || !up.current) return;
    const [a, b] = ctl.viewX();
    up.current.setXRange(a, b);
    up.current.setCursorTime(ctl.cursorX());
  }, [data, visible, ctl]);

  /* dica do mouse (só no painel sob o mouse) */
  const onCursor = useCallback((_x: number | null, idx: number | null) => {
    const tip = tipRef.current;
    if (!tip) return;
    const u = up.current?.getPlot();
    if (!hovered.current || idx === null || !u || u.cursor.left === undefined || u.cursor.left < 0) { tip.hidden = true; return; }
    tip.innerHTML = ctl.tipHtml(keysRef.current, colorsRef.current, idx);
    tip.hidden = false;
    const left = u.over.offsetLeft + (u.cursor.left ?? 0);
    const tw = tip.offsetWidth, W = u.over.offsetLeft + u.over.clientWidth;
    tip.style.left = (left + 14 + tw > W ? left - tw - 14 : left + 14) + 'px';
    tip.style.top = '10px';
  }, [ctl]);

  /* redimensionar pela borda de baixo */
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const y0 = e.clientY, h0 = h;
    const el = e.currentTarget as HTMLElement;
    try { el.setPointerCapture(e.pointerId); } catch { /* ponteiro sintético */ }
    let cur = h0;
    const mv = (ev: PointerEvent) => { cur = Math.max(PANEL_MIN_H, Math.min(PANEL_MAX_H, Math.round(h0 + ev.clientY - y0))); setH(cur); };
    const end = () => {
      el.removeEventListener('pointermove', mv);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      actions.resize(p.id, cur);
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };

  /* soltar canal da lista */
  const onDragOver = (e: React.DragEvent) => {
    if (!isChannelDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const k = drag.key;
    const hint = k && unit !== unitOf(info.chan(k)) ? 'other' : 'same';
    if (hint !== dropHint) setDropHint(hint);
  };
  const onDrop = (e: React.DragEvent) => {
    if (!isChannelDrag(e)) return;
    e.preventDefault();
    setDropHint(null);
    const k = droppedKey(e);
    if (k) actions.drop(p.id, k);
  };

  const first = chans[0];
  const xpl = (k: string) => channelExplain(info, k);
  const openCh = (k: string, name: string) => open(xpl(k), { sensors: info.sensors(k), title: name });

  return (
    <div
      ref={boxRef} className="cn-panel" data-drop={dropHint ?? undefined}
      onDragOver={onDragOver} onDragLeave={() => setDropHint(null)} onDrop={onDrop}
    >
      <div className="cn-ph">
        <div className="cn-ph-chans">
          {chans.map((c, i) => (
            <div key={c.key} className="cn-ph-ch">
              <i className="cn-swatch" style={{ background: colors[i] }} aria-hidden />
              <UnstyledButton className="cn-ph-name" onClick={() => openCh(c.key, c.name)} title={`${c.name} — o que é, de qual sensor sai`}>
                {c.name}
              </UnstyledButton>
              <span className="cn-ph-val bt-num" ref={el => (el ? ctl.bindValue(el, c.key) : undefined)} />
              {c.unit && <span className="cn-ph-unit">{c.unit}</span>}
              {overlay && (
                <span className="cn-ph-ref" title="Valor da volta de referência no mesmo ponto">
                  <i className="cn-swatch cn-swatch--ref" style={{ background: lighter(colors[i]) }} aria-hidden />
                  ref. <span className="bt-num" ref={el => (el ? ctl.bindValue(el, c.key, 'ref') : undefined)} />
                </span>
              )}
              <CloseButton size="sm" aria-label={`Tirar ${c.name} do painel`} title="Tirar do painel" onClick={() => actions.removeKey(p.id, c.key)} />
            </div>
          ))}
        </div>
        <div className="cn-ph-tools">
          <SensorChips sensors={sensors} />
          {chans.length === 1 && first ? (
            <InfoButton explain={xpl(first.key)} sensors={info.sensors(first.key)} title={first.name} />
          ) : (
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <Tooltip label="O que é cada canal, de quais sensores sai e como usar no projeto">
                  <ActionIcon variant="subtle" color="gray" radius="xl" aria-label="Explicação dos canais do painel"><IconInfoCircle size={18} stroke={1.8} /></ActionIcon>
                </Tooltip>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Explicação de cada canal</Menu.Label>
                {chans.map((c, i) => (
                  <Menu.Item key={c.key} leftSection={<i className="cn-swatch" style={{ background: colors[i] }} />} onClick={() => openCh(c.key, c.name)}>
                    {c.name}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          )}
          <Tooltip label="Subir o painel"><ActionIcon variant="subtle" color="gray" disabled={index === 0} onClick={() => actions.move(p.id, -1)} aria-label="Subir o painel"><IconArrowUp size={17} /></ActionIcon></Tooltip>
          <Tooltip label="Descer o painel"><ActionIcon variant="subtle" color="gray" disabled={index === count - 1} onClick={() => actions.move(p.id, 1)} aria-label="Descer o painel"><IconArrowDown size={17} /></ActionIcon></Tooltip>
          <Tooltip label="Remover o painel"><ActionIcon variant="subtle" color="gray" onClick={() => actions.removePanel(p.id)} aria-label="Remover o painel"><IconTrash size={17} /></ActionIcon></Tooltip>
        </div>
      </div>
      <div className="cn-pchart" style={{ height: h }}
        onPointerEnter={() => { hovered.current = true; }}
        onPointerLeave={() => { hovered.current = false; if (tipRef.current) tipRef.current.hidden = true; }}>
        {visible && chans.length > 0 && (
          <UPlotChart ref={up} data={data} series={series} height={h} legend={false} options={options}
            xRange={ctl.viewX()} onCursor={onCursor} />
        )}
        <div ref={tipRef} className="bt-plot-tip cn-tip" hidden />
        {dropHint && (
          <div className="cn-drop-hint">
            {dropHint === 'same' ? `Soltar para sobrepor neste painel (${unit || 'sem unidade'})` : `Unidade diferente de ${unit || 'sem unidade'}: vai para um painel novo logo abaixo`}
          </div>
        )}
      </div>
      <div className="cn-resize" onPointerDown={startResize} role="separator" aria-orientation="horizontal" aria-label="Arraste para mudar a altura do painel" title="Arraste para mudar a altura" />
    </div>
  );
});
