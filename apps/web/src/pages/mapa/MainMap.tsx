/* Aba "Mapa": o mapa grande colorido pelo canal escolhido (card Mapa do app antigo) com
 * "cor por", legenda, satélite, seguir carro, enquadrar, linha de largada (Desenhar 2
 * cliques / Automática / Apagar) e o painel "Agora" ao lado. O trecho do cabeçalho
 * (useRange) é o que fica colorido; o resto da sessão aparece apagado. */
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Group, Paper, Select, Stack, Text, Tooltip } from '@mantine/core';
import { useNavigate } from 'react-router';
import {
  IconAlertTriangle, IconCurrentLocation, IconFocusCentered, IconMinus, IconPencil, IconPlus, IconRoute,
  IconSparkles, IconTrash, IconWorld, IconX,
} from '@tabler/icons-react';
import { decimalsFor, esc, fmtVal, getChannel, mergeSensors, type Pt, type SessionContext } from '@baja/core';
import {
  ChartCard, InfoButton, MapLegend, TrackMap, type MapLegendInfo, type MapSource, type TrackMapHandle,
} from '../../components';
import { lsGet, lsSet } from '../../state/prefs';
import { useCursorEffect, useRange, useSessionStore } from '../../state/session';
import { applyAutoLine, channelInfo, colorByGroups, lapAt } from './common';
import { NowPanel } from './NowPanel';

const SAT_KEY = 'bt.mapa.sat';
/* canais que só existem com voltas (linha de largada) */
const LAP_KEYS = ['gps:lap', 'gps:delta'];

export function MainMap({ ctx }: { ctx: SessionContext }) {
  const S = ctx.S, tr = ctx.track;
  const range = useRange();
  const i0 = range ? range[0] : 0, i1 = range ? range[1] : S.t.length - 1;
  const selLap = useSessionStore(s => s.selLap);
  const colorKey = useSessionStore(s => s.colorKey);
  const setColorKey = useSessionStore(s => s.setColorKey);
  const seek = useSessionStore(s => s.seek);
  const setLine = useSessionStore(s => s.setLine);
  const nav = useNavigate();

  const [sat, setSatState] = useState(() => lsGet(SAT_KEY) === '1');
  const setSat = (on: boolean) => { setSatState(on); lsSet(SAT_KEY, on ? '1' : '0'); };
  const [follow, setFollow] = useState(false);
  const [lineMode, setLineMode] = useState(false);
  const [leg, setLeg] = useState<MapLegendInfo>({ lo: NaN, hi: NaN, dark: true });
  const mapRef = useRef<TrackMapHandle>(null);

  /* o carro anda 60×/s sem re-render */
  useCursorEffect(t => mapRef.current?.setCursor(t));

  const color = getChannel(ctx, colorKey) ?? getChannel(ctx, 'gps:speed') ?? null;
  const info = useMemo(() => (color ? channelInfo(ctx, color) : null), [ctx, color]);
  const groups = useMemo(() => colorByGroups(ctx.all), [ctx]);
  const dec = color ? decimalsFor(color.lo, color.hi) : 1;

  /* tooltip do ponto (A.tipHtml do antigo) */
  const tipHtml = useCallback((i: number) => {
    if (!tr.ok) return '';
    const L = lapAt(ctx.laps, S.t[i]);
    let h = `<b>t ${S.t[i].toFixed(2)} s</b>${L ? ` · volta ${L.n}` : ''}<br>`;
    h += `${tr.speed[i].toFixed(1)} km/h<br>`;
    if (color && color.key !== 'gps:speed') h += `<span>${esc(color.name)}</span> ${fmtVal(color.data[i], dec)} ${esc(color.unit || '')}`;
    return h;
  }, [ctx, S, tr, color, dec]);

  const onLineDrawn = useCallback((pts: Pt[]) => setLine(pts), [setLine]);
  const source = useMemo<MapSource>(() => ({
    t: S.t, track: tr, hasLatLon: !!S.gps, span: tr.span, range: [i0, i1], laps: ctx.laps, selLap,
    colorValues: color ? color.data : null, line: ctx.cfg.line ?? null, tipHtml, onSeek: seek, onLineDrawn,
  }), [S, tr, ctx, i0, i1, selLap, color, tipHtml, seek, onLineDrawn]);

  const sensors = mergeSensors('gps', info?.sensors ?? []);
  const hasLine = !!ctx.cfg.line;
  const nLaps = ctx.laps.length;
  const canSat = !!tr.center;
  const distTotal = tr.ok ? tr.dist[tr.dist.length - 1] : NaN;

  return (
    <div className="bt-mapa-grid">
      <ChartCard
        title={color ? `Trajetória colorida por: ${color.name}` : 'Trajetória'}
        subtitle="roda = zoom · arrastar = mover · clique = ir ao ponto · duplo clique = enquadrar"
        explain="chart.trackMap" sensors={sensors} flush
      >
        {/* barra: cor por + legenda + vista */}
        <Group className="bt-mapa-bar" gap="md" wrap="wrap" align="flex-end">
          <Group gap={4} wrap="nowrap" align="flex-end">
            <Select
              label="Cor por" data={groups} value={color?.key ?? null} onChange={v => v && setColorKey(v)}
              searchable allowDeselect={false} w={280} maxDropdownHeight={420} comboboxProps={{ withinPortal: true }}
              nothingFoundMessage="Nenhum canal com esse nome"
            />
            {info && <InfoButton explain={info.explain} sensors={info.sensors} title={info.ch.name} size="lg" />}
          </Group>
          <Box miw={200} style={{ flex: '1 1 200px', maxWidth: 300 }}>
            <MapLegend lo={leg.lo} hi={leg.hi} dark={leg.dark} unit={color?.unit} decimals={dec} />
          </Box>
        </Group>

        {color?.constant && tr.ok && (
          <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={18} />} mx="md" mb="sm"
            title={isFinite(color.lo) ? `${color.name} é constante neste log` : `${color.name} não tem valores neste log`}>
            <Stack gap={8} align="flex-start">
              <span>
                {!isFinite(color.lo)
                  ? (LAP_KEYS.includes(color.key)
                    ? 'Este canal sai das voltas e ainda não há voltas: defina a linha de largada aqui embaixo (Desenhar ou Automática).'
                    : 'Nenhuma amostra válida, então a pista fica sem cor. Escolha outro canal em “Cor por”.')
                  : <>Vale {fmtVal(color.lo, 3)} {color.unit} o tempo todo, então a pista fica de uma cor só. Se este canal deveria variar,
                    o sensor ficou sem sinal: confira o cabo, a alimentação e a entrada na FT antes do próximo teste.</>}
              </span>
              {color.key !== 'gps:speed' && getChannel(ctx, 'gps:speed') && (
                <Button size="xs" variant="default" onClick={() => setColorKey('gps:speed')}>Colorir pela velocidade do GPS</Button>
              )}
            </Stack>
          </Alert>
        )}

        <div className="bt-mapa-map">
          <TrackMap
            ref={mapRef} source={source} height="max(440px, calc(100dvh - 560px))" controls={false}
            satellite={sat && canSat} onSatelliteChange={setSat} follow={follow} onFollowChange={setFollow}
            lineMode={lineMode} onLineModeChange={setLineMode} onLegend={setLeg}
          />
          <Group gap={6} wrap="wrap" justify="flex-end" className="bt-mapa-tools">
            <Tooltip label="Afastar"><Button variant="default" aria-label="Afastar" onClick={() => mapRef.current?.zoom(1 / 1.5)}><IconMinus size={18} /></Button></Tooltip>
            <Tooltip label="Aproximar"><Button variant="default" aria-label="Aproximar" onClick={() => mapRef.current?.zoom(1.5)}><IconPlus size={18} /></Button></Tooltip>
            <Tooltip label="Enquadrar (ou duplo clique no mapa)">
              <Button variant="default" leftSection={<IconFocusCentered size={18} />} onClick={() => { setFollow(false); mapRef.current?.fit(); }}>Enquadrar</Button>
            </Tooltip>
            <Tooltip label="O mapa acompanha o carro">
              <Button variant={follow ? 'filled' : 'default'} aria-pressed={follow} leftSection={<IconCurrentLocation size={18} />}
                disabled={!tr.ok} onClick={() => setFollow(!follow)}>Seguir carro</Button>
            </Tooltip>
            <Tooltip label={canSat ? 'Fundo de satélite (precisa de internet e do centro da pista em lat/lon)' : 'Satélite precisa do centro da pista em lat/lon (Pista e GPS)'}>
              <Button variant={sat && canSat ? 'filled' : 'default'} aria-pressed={sat && canSat} leftSection={<IconWorld size={18} />}
                disabled={!canSat} onClick={() => setSat(!sat)}>Satélite</Button>
            </Tooltip>
          </Group>
          {!tr.ok && (
            <Paper className="bt-mapa-msg" withBorder radius="md" p="lg" shadow="md">
              <Stack gap="xs" align="flex-start">
                <Text fw={650} size="lg">Sem trajetória</Text>
                <Text c="dimmed">{tr.msg || 'Este log não tem posição de GPS.'}</Text>
                <Text size="sm" c="dimmed">
                  O mapa precisa do GPS: canais X/Y nas entradas 7 e 8 da FT (com o track_config.h igual ao gravado no PIC) ou
                  latitude/longitude no log do BUSMASTER com fix. Os outros canais continuam no painel ao lado e na página Canais.
                </Text>
                <Button variant="default" leftSection={<IconRoute size={18} />} onClick={() => nav('/pista')}>Conferir Pista e GPS</Button>
              </Stack>
            </Paper>
          )}
        </div>

        {/* linha de largada */}
        <Group className="bt-mapa-line" gap="sm" wrap="wrap">
          <Group gap={4} wrap="nowrap">
            <Text fw={600}>Linha de largada</Text>
            <InfoButton explain="track.startLine" sensors={['gps', 'logger']} title="Linha de largada e voltas" />
          </Group>
          <Button variant={lineMode ? 'filled' : 'default'} disabled={!tr.ok}
            leftSection={lineMode ? <IconX size={18} /> : <IconPencil size={18} />} onClick={() => setLineMode(!lineMode)}>
            {lineMode ? 'Cancelar' : 'Desenhar (2 cliques)'}
          </Button>
          <Tooltip label="Perpendicular ao movimento no primeiro trecho com o carro andando">
            <Button variant="default" disabled={!tr.ok} leftSection={<IconSparkles size={18} />} onClick={() => { setLineMode(false); applyAutoLine(); }}>Automática</Button>
          </Tooltip>
          <Button variant="default" color="red" disabled={!hasLine} leftSection={<IconTrash size={18} />} onClick={() => setLine(null)}>Apagar</Button>
          <Text size="sm" c="dimmed" className="bt-num">
            {!tr.ok ? 'precisa de GPS' : !hasLine ? (distTotal < 100 ? `o carro andou só ${distTotal.toFixed(0)} m neste log: sem voltas` : 'sem linha: as voltas não são separadas')
              : nLaps ? `${nLaps} ${nLaps === 1 ? 'volta completa' : 'voltas completas'}` : 'nenhuma volta completa cruzando a linha'}
          </Text>
        </Group>
      </ChartCard>

      <div className="bt-mapa-side">
        <NowPanel ctx={ctx} colorKey={color?.key ?? ''} />
      </div>
    </div>
  );
}
