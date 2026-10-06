/* Painel "Agora" do mapa (card Agora + tabela de canais do app antigo, updateNow): velocidade,
 * estado do GPS, tempo, volta, X/Y, lat/lon e o valor de cada canal no cursor. Clicar num
 * canal colore o mapa por ele; cada número abre o card de explicação com os sensores.
 * Re-renderiza ~20×/s no play (useCursorTime); as linhas da tabela são memorizadas. */
import { memo, useMemo } from 'react';
import { Divider, Group, Paper, ScrollArea, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import { IconAlertCircle, IconAlertTriangle, IconCircleCheck, IconAntennaOff, type Icon } from '@tabler/icons-react';
import { decimalsFor, detectRoles, fmtTime, fmtVal, getChannel, idxAt, posAt, type SensorId, type SessionContext } from '@baja/core';
import { InfoButton, SensorChips, useExplain } from '../../components';
import { STATUS_COLOR, type Status } from '../../theme';
import { useCursorTime, useSessionStore } from '../../state/session';
import { channelInfo, clockAt, lapAt, type ChannelInfo } from './common';

interface GpsBadge { status: Status | null; text: string; icon: Icon }

/* estado do GPS no cursor (gpsBadge do antigo) */
function gpsBadge(ctx: SessionContext, i: number): GpsBadge {
  const tr = ctx.track;
  if (!tr.ok) return { status: null, text: 'Sem GPS', icon: IconAntennaOff };
  if (!tr.valid[i]) return { status: 'serious', text: 'Sem posição', icon: IconAlertCircle };
  if (tr.sat[i]) return { status: 'warn', text: 'Na borda da área', icon: IconAlertTriangle };
  return { status: 'good', text: 'GPS ok', icon: IconCircleCheck };
}

/** Rótulo clicável (abre o card) + ⓘ, para os números do painel. */
function Label({ text, explain, sensors }: { text: string; explain: string; sensors: SensorId[] }) {
  const { open } = useExplain();
  return (
    <Group gap={2} wrap="nowrap">
      <UnstyledButton className="bt-card-title--link bt-mapa-now-label" onClick={() => open(explain, { sensors, title: text })}>{text}</UnstyledButton>
      <InfoButton explain={explain} sensors={sensors} title={text} size="sm" />
    </Group>
  );
}

const Row = memo(function Row({ info, value, active, onPick }: { info: ChannelInfo; value: string; active: boolean; onPick: (k: string) => void }) {
  const c = info.ch;
  return (
    <tr data-active={active ? '' : undefined} data-const={c.constant ? '' : undefined}
      onClick={() => onPick(c.key)} title="Clique para colorir o mapa por este canal">
      <td className="bt-mapa-now-name">{c.name}</td>
      <td className="bt-num bt-mapa-now-val">{value}<span className="bt-mapa-now-unit">{c.unit}</span></td>
      <td className="bt-mapa-now-i"><InfoButton explain={info.explain} sensors={info.sensors} title={c.name} size="sm" /></td>
    </tr>
  );
});

export function NowPanel({ ctx, colorKey }: { ctx: SessionContext; colorKey: string }) {
  /* uma assinatura só do cursor (~20×/s no play): o índice sai do tempo */
  const cur = useCursorTime();
  const i = useMemo(() => Math.max(0, ctx.S.t.length ? idxAt(ctx.S.t, cur) : 0), [ctx, cur]);
  const setColorKey = useSessionStore(s => s.setColorKey);
  const { open } = useExplain();
  const S = ctx.S, tr = ctx.track;

  /* canais na ordem do antigo: os que variam, depois os constantes; com sensores e card */
  const rows = useMemo(() => {
    const roles = detectRoles(ctx.S, ctx.cfg);
    const list = ctx.all.filter(c => !c.constant).concat(ctx.all.filter(c => c.constant));
    return list.map(c => ({ info: channelInfo(ctx, c, roles), dec: decimalsFor(c.lo, c.hi), group: c.constant ? 'Constantes' : c.group || 'Do log' }));
  }, [ctx]);

  const color = rows.find(r => r.info.ch.key === colorKey);
  const L = lapAt(ctx.laps, cur);
  const badge = gpsBadge(ctx, i);
  const BIco = badge.icon;

  /* velocidade: da roda quando há sensor de roda com sinal, senão do GPS (heroSpeed do antigo) */
  const wheel = !!ctx.veh.wheel && !!ctx.veh.v;
  const spd = wheel ? ctx.veh.v![i] * 3.6 : tr.ok && tr.valid[i] ? tr.speed[i] : NaN;
  const spdKey = wheel ? 'veh:v' : 'gps:speed';
  const spdCh = getChannel(ctx, spdKey);
  const spdInfo = spdCh ? channelInfo(ctx, spdCh) : null;
  const spdSensors: SensorId[] = spdInfo?.sensors ?? (wheel ? ['wheel'] : ['gps']);

  const p = tr.ok ? posAt(S, tr, cur) : null;
  const xy = p ? `${p.x.toFixed(1)} / ${p.y.toFixed(1)} m` : '—';
  const ll = tr.ok && tr.lat && tr.lon && tr.valid[i] ? `${tr.lat[i].toFixed(6)}, ${tr.lon[i].toFixed(6)}` : '—';

  let grp = '';
  return (
    <Paper withBorder radius="md" className="bt-mapa-now">
      <Stack gap="md" p="md" pb="sm">
        <Group justify="space-between" wrap="nowrap">
          <Title order={2}>Agora</Title>
          <UnstyledButton
            className="bt-mapa-gps" data-status={badge.status ?? 'none'}
            style={{ ['--bt-status' as string]: badge.status ? STATUS_COLOR[badge.status] : 'var(--mantine-color-dimmed)' }}
            onClick={() => open('track.gpsPosition', { sensors: ['gps'], title: 'Estado do GPS' })}
            title="Estado do GPS neste instante (abre a explicação)"
          >
            <BIco size={17} stroke={2} aria-hidden />{badge.text}
          </UnstyledButton>
        </Group>

        {/* velocidade em destaque */}
        <div>
          <Label text={wheel ? 'Velocidade (roda)' : 'Velocidade (GPS)'} explain={spdInfo?.explain ?? 'channel.gps_speed'} sensors={spdSensors} />
          <div className="bt-mapa-hero">
            <span className="bt-mapa-hero-num bt-num">{isFinite(spd) ? spd.toFixed(0) : '—'}</span>
            <span className="bt-mapa-hero-unit">km/h · {wheel ? 'roda' : 'GPS'}</span>
          </div>
        </div>

        <div className="bt-mapa-now-grid">
          <Label text="Tempo" explain="sensor.logger" sensors={['logger']} />
          <span className="bt-num">{fmtTime(cur)}{S.clock0 ? ' · ' + clockAt(S.clock0, cur) : ''}</span>
          <Label text="Volta" explain="laps.table" sensors={['gps', 'logger']} />
          <span className="bt-num">{L ? `${L.n} · ${fmtTime(cur - L.t0)}` : '—'}</span>
          <Label text="X / Y" explain="channel.gps_xy" sensors={['gps']} />
          <span className="bt-num">{xy}</span>
          <Label text="Lat / Lon" explain="track.gpsPosition" sensors={['gps']} />
          <span className="bt-num">{ll}</span>
        </div>

        {color && (
          <>
            <Divider />
            <div>
              <Text size="sm" c="dimmed" mb={2}>Canal que colore o mapa</Text>
              <Label text={color.info.ch.name} explain={color.info.explain} sensors={color.info.sensors} />
              <div className="bt-mapa-hero bt-mapa-hero--sm">
                <span className="bt-mapa-hero-num bt-num">{fmtVal(color.info.ch.data[i], color.dec)}</span>
                <span className="bt-mapa-hero-unit">{color.info.ch.unit}</span>
              </div>
              <SensorChips sensors={color.info.sensors} />
            </div>
          </>
        )}
        <Divider />
        <Group justify="space-between" gap="xs">
          <Text fw={600}>Todos os canais no cursor</Text>
          <Text size="sm" c="dimmed">clique = colorir o mapa</Text>
        </Group>
      </Stack>
      <ScrollArea type="auto" className="bt-mapa-now-scroll" offsetScrollbars>
        <table className="bt-mapa-now-table">
          <tbody>
            {rows.map(r => {
              const head = r.group !== grp ? (grp = r.group) : null;
              return [
                head && <tr key={'g:' + head} className="bt-mapa-now-grp"><td colSpan={3}>{head}</td></tr>,
                <Row key={r.info.ch.key} info={r.info} value={fmtVal(r.info.ch.data[i], r.dec)} active={r.info.ch.key === colorKey} onPick={setColorKey} />,
              ];
            })}
          </tbody>
        </table>
      </ScrollArea>
    </Paper>
  );
}
