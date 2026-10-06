/* Aba "Mapas por canal" (renderMaps + frameMaps do app antigo): um mini-mapa por canal, cada
 * um com a própria escala (2–98 % do trecho), o valor no cursor e o carro. Clique num mapa =
 * colorir o mapa principal por ele e voltar à aba Mapa. As faixas de cor de cada pedaço vêm
 * prontas do core (channelMaps); aqui só se desenha. */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Badge, Group, Paper, Switch, Text, UnstyledButton } from '@mantine/core';
import { IconMapOff } from '@tabler/icons-react';
import {
  channelMaps, fmtVal, getChannel, heat, heatGradientCss, idxAt, miniMapTransform, posAt,
  type Channel, type ChannelMap, type ChannelMapsReport, type SessionContext, type TrackOk,
} from '@baja/core';
import { EmptyState, InfoButton, SensorChips, setupCanvas, useElementSize } from '../../components';
import { useChartTheme, type ChartTheme } from '../../theme';
import { lsGet, lsSet } from '../../state/prefs';
import { useCursorEffect, useRange, useSessionStore } from '../../state/session';

const CONST_KEY = 'bt.mapa.includeConst';
const MINI_H = 210;

type Pos = { x: number; y: number } | null;
interface MiniApi { frame(p: Pos, i: number): void }

interface MiniProps {
  item: ChannelMap;
  ch: Channel;
  rep: ChannelMapsReport;
  track: TrackOk;
  th: ChartTheme;
  active: boolean;
  onPick: (key: string) => void;
  register: (key: string, api: MiniApi | null) => void;
}

const MiniMap = memo(function MiniMap({ item, ch, rep, track, th, active, onPick, register }: MiniProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const valRef = useRef<HTMLSpanElement>(null);
  const off = useRef<HTMLCanvasElement | null>(null);
  const geo = useRef<{ X: (x: number) => number; Y: (y: number) => number; w: number; h: number } | null>(null);
  const last = useRef<{ p: Pos; i: number }>({ p: null, i: -1 });
  const { width, height } = useElementSize(boxRef);

  const frame = useCallback((p: Pos, i: number) => {
    last.current = { p, i };
    const cv = cvRef.current, G = geo.current;
    if (valRef.current) valRef.current.textContent = i >= 0 ? `${fmtVal(ch.data[i], item.dec)} ${item.unit || ''}` : '—';
    if (!cv || !G || !off.current) return;
    const [g] = setupCanvas(cv, G.w, G.h);
    g.drawImage(off.current, 0, 0, G.w, G.h);
    if (p) {
      g.fillStyle = th.car; g.strokeStyle = th.surface; g.lineWidth = 2;
      g.beginPath(); g.arc(G.X(p.x), G.Y(p.y), 4.5, 0, 7); g.stroke(); g.fill();
    }
  }, [ch, item, th]);

  /* camada estática: contorno da pista + 16 faixas de cor (renderMaps) */
  useLayoutEffect(() => {
    const w = width, h = height;
    if (!w || !h) return;
    const b = rep.bounds, { s, ox, oy } = miniMapTransform(b, w, h, 10);
    const X = (x: number) => ox + (x - b.x0) * s, Y = (y: number) => h - oy - (y - b.y0) * s;
    const c = off.current ?? (off.current = document.createElement('canvas'));
    const [g] = setupCanvas(c, w, h);
    g.fillStyle = th.surface; g.fillRect(0, 0, w, h);
    g.lineJoin = 'round'; g.lineCap = 'round';
    const full = new Path2D();
    let pen = false;
    for (let i = rep.i0; i <= rep.i1; i++) {
      if (!track.valid[i]) { pen = false; continue; }
      if (pen) full.lineTo(X(track.x[i]), Y(track.y[i])); else { full.moveTo(X(track.x[i]), Y(track.y[i])); pen = true; }
    }
    g.strokeStyle = 'rgba(12,12,12,.55)'; g.lineWidth = 4.5; g.stroke(full);
    const P = Array.from({ length: rep.nb }, () => new Path2D());
    for (let i = rep.i0 + 1; i <= rep.i1; i++) {
      const k = item.bins[i];
      if (k < 0) continue;
      P[k].moveTo(X(track.x[i - 1]), Y(track.y[i - 1])); P[k].lineTo(X(track.x[i]), Y(track.y[i]));
    }
    g.lineWidth = 2.5;
    if (!item.any) { g.strokeStyle = th.mutedLine; g.stroke(full); }
    P.forEach((p, k) => { g.strokeStyle = heat((k + 0.5) / rep.nb, th.dark); g.stroke(p); });
    geo.current = { X, Y, w, h };
    frame(last.current.p, last.current.i);
  }, [width, height, rep, item, track, th, frame]);

  useEffect(() => {
    register(item.key, { frame });
    return () => register(item.key, null);
  }, [item.key, frame, register]);

  const pick = () => onPick(item.key);
  return (
    <Paper withBorder radius="md" className="bt-mm" data-active={active ? '' : undefined}>
      <div className="bt-mm-head">
        <Group justify="space-between" wrap="nowrap" gap={4} align="flex-start">
          <UnstyledButton className="bt-mm-name bt-card-title--link" onClick={pick} title="Clique para colorir o mapa principal por este canal">
            {item.name}
          </UnstyledButton>
          <InfoButton explain={item.explain} sensors={item.sensors} title={item.name} />
        </Group>
        <Group gap={8} wrap="wrap" mt={2}>
          <Text size="sm" c="dimmed" className="bt-num">{item.rangeText}</Text>
          {item.constant && <Badge variant="light" color="yellow" size="sm">constante</Badge>}
          {!item.any && <Badge variant="light" color="gray" size="sm">sem dados no trecho</Badge>}
        </Group>
        <SensorChips sensors={item.sensors} />
      </div>
      <div ref={boxRef} className="bt-mm-box" style={{ height: MINI_H }} onClick={pick} role="button" tabIndex={0}
        aria-label={`Colorir o mapa por ${item.name}`} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } }}>
        <canvas ref={cvRef} className="bt-mm-canvas" />
      </div>
      <div className="bt-mm-foot">
        <i className="bt-mm-bar" style={{ background: heatGradientCss(th.dark) }} />
        <span ref={valRef} className="bt-num bt-mm-val">—</span>
      </div>
    </Paper>
  );
});

export function ChannelMaps({ ctx, onPicked }: { ctx: SessionContext; onPicked: () => void }) {
  const range = useRange();
  const i0 = range ? range[0] : 0, i1 = range ? range[1] : ctx.S.t.length - 1;
  const [inc, setIncState] = useState(() => lsGet(CONST_KEY) === '1');
  const setInc = (v: boolean) => { setIncState(v); lsSet(CONST_KEY, v ? '1' : '0'); };
  const colorKey = useSessionStore(s => s.colorKey);
  const setColorKey = useSessionStore(s => s.setColorKey);
  const th = useChartTheme();

  const rep = useMemo(() => channelMaps(ctx, i0, i1, { includeConst: inc }), [ctx, i0, i1, inc]);
  const nConst = useMemo(() => ctx.all.filter(c => c.constant).length, [ctx]);
  const constNames = useMemo(() => ctx.all.filter(c => c.constant).map(c => c.name), [ctx]);

  /* cursor: posição uma vez por quadro, todos os mini-mapas redesenham só o carro */
  const minis = useRef(new Map<string, MiniApi>());
  const lastRef = useRef<{ p: Pos; i: number }>({ p: null, i: -1 });
  const register = useCallback((key: string, api: MiniApi | null) => {
    if (api) { minis.current.set(key, api); api.frame(lastRef.current.p, lastRef.current.i); } else minis.current.delete(key);
  }, []);
  useCursorEffect((t, s) => {
    const S = s.S, tr = s.ctx?.track;
    if (!S) return;
    const p = tr && tr.ok ? posAt(S, tr, t) : null;
    const i = idxAt(S.t, t);
    lastRef.current = { p, i };
    minis.current.forEach(m => m.frame(p, i));
  });

  const pick = useCallback((key: string) => { setColorKey(key); onPicked(); }, [setColorKey, onPicked]);

  if (!rep.ok || !ctx.track.ok) {
    return (
      <EmptyState icon={IconMapOff} title="Sem trajetória de GPS"
        description={`${(rep.empty || 'Sem GPS').replace(/\.$/, '')}. Os mapas por canal precisam da posição do GPS (canais X/Y da FT ou lat/lon do BUSMASTER com fix). Para ver os canais ao longo do tempo, use a página Canais.`} />
    );
  }
  const track = ctx.track;
  return (
    <>
      <Group justify="space-between" align="center" wrap="wrap" gap="md" mb="md">
        <Text c="dimmed" maw={760}>
          Um mapa por canal, cada um com a própria escala (de 2 % a 98 % dos valores do trecho: {range?.[2] ?? 'sessão inteira'}).
          Clique num mapa para colorir o mapa principal por ele. Cores iguais em mapas diferentes não são o mesmo valor.
        </Text>
        <Switch size="md" label="incluir canais constantes" checked={inc} onChange={e => setInc(e.currentTarget.checked)} />
      </Group>
      {!inc && nConst > 0 && (
        <Text size="sm" c="dimmed" mb="md" title={constNames.join(', ')}>
          {nConst} {nConst === 1 ? 'canal constante oculto' : 'canais constantes ocultos'} (pintariam a pista de uma cor só
          {constNames.length ? `: ${constNames.slice(0, 6).join(', ')}${constNames.length > 6 ? '…' : ''}` : ''}).
          Um sensor que deveria variar e aparece aqui ficou sem sinal no teste.
        </Text>
      )}
      {rep.items.length === 0 ? (
        <EmptyState icon={IconMapOff} title="Nenhum canal para mostrar" description="Todos os canais são constantes neste log. Ligue “incluir canais constantes”." />
      ) : (
        <div className="bt-mm-grid">
          {rep.items.map(item => {
            const ch = getChannel(ctx, item.key);
            if (!ch) return null;
            return (
              <MiniMap key={item.key} item={item} ch={ch} rep={rep} track={track} th={th}
                active={item.key === colorKey} onPick={pick} register={register} />
            );
          })}
        </div>
      )}
    </>
  );
}
