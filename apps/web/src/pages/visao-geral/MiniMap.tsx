/* Mini-mapa da Visão geral: trajetória do trecho colorida pela velocidade do GPS, com o carro
 * no cursor (60×/s sem re-render) e clique = ir ao ponto. Sem trajetória: diz o que falta. */
import { useMemo, useRef, useState } from 'react';
import { Button, Group, Text } from '@mantine/core';
import { IconMap2, IconRoute } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { decimalsFor, getChannel, spanOf, type SessionContext } from '@baja/core';
import { ChartCard, EmptyState, MapLegend, TrackMap, type MapLegendInfo, type MapSource, type TrackMapHandle } from '../../components';
import { useCursorEffect, useSessionStore } from '../../state/session';

export function MiniMap({ ctx, i0, i1, rangeLabel }: { ctx: SessionContext; i0: number; i1: number; rangeLabel: string }) {
  const nav = useNavigate();
  const selLap = useSessionStore(s => s.selLap);
  const seek = useSessionStore(s => s.seek);
  const mapRef = useRef<TrackMapHandle>(null);
  const [leg, setLeg] = useState<MapLegendInfo>({ lo: NaN, hi: NaN, dark: true });
  useCursorEffect(t => mapRef.current?.setCursor(t));

  const S = ctx.S;
  const ok = !!ctx.track && ctx.track.ok;
  const source = useMemo<MapSource>(() => ({
    t: S.t,
    track: ctx.track,
    hasLatLon: !!S.gps,
    span: spanOf(ctx.cfg),
    range: [i0, i1],
    laps: ctx.laps,
    selLap,
    colorValues: null,
    line: ctx.cfg.line,
    cursor: useSessionStore.getState().cursor,
    onSeek: seek,
  }), [S, ctx, i0, i1, selLap, seek]);

  const sp = getChannel(ctx, 'gps:speed');
  const dec = sp ? decimalsFor(sp.lo, sp.hi) : 1;

  return (
    <ChartCard
      title="Trajetória colorida pela velocidade"
      subtitle={ok ? `Trecho: ${rangeLabel} · roda = zoom · arrastar = mover · clique = ir ao ponto · duplo clique = enquadrar` : undefined}
      explain="chart.miniMap" sensors={ok ? ['gps'] : []}
      actions={<Button size="xs" variant="subtle" leftSection={<IconMap2 size={15} />} onClick={() => nav('/mapa')}>Mapa grande</Button>}
      flush
      footer={ok ? <MapLegend lo={leg.lo} hi={leg.hi} dark={leg.dark} label="Velocidade (GPS)" unit="km/h" decimals={dec} /> : undefined}
    >
      {ok ? (
        <TrackMap source={source} ref={mapRef} height={400} onLegend={setLeg} />
      ) : (
        <EmptyState bare icon={IconRoute} title="Sem trajetória do GPS neste log"
          description={(
            <>
              <Text c="dimmed" component="span">{ctx.track?.msg ? `${ctx.track.msg.replace(/\.+\s*$/, '')}. ` : ''}</Text>
              {S.kind === 'BUSMASTER'
                ? 'O BUSMASTER só traz posição quando o módulo GPS tem fix: grave com céu aberto e espere o fix antes de sair.'
                : 'Confira os canais X/Y do GPS (entradas 7/8 da FT) e o centro da pista em Pista e GPS. Sem GPS não há mapa nem voltas.'}
            </>
          )}
          action={(
            <Group gap="sm" justify="center">
              <Button variant="light" leftSection={<IconRoute size={16} />} onClick={() => nav('/pista')}>Pista e GPS</Button>
              <Button variant="default" onClick={() => nav('/aquisicao')}>Ver a qualidade dos dados</Button>
            </Group>
          )} />
      )}
    </ChartCard>
  );
}
