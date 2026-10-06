/* Aba "Canais do log": cada canal gravado, o papel que o app reconheceu (e com isso o sensor
 * de onde ele vem), amostras válidas, taxa, faixa e o estado (constante, travado, saltos).
 * Tudo vem de dataQuality do core; aqui só a tabela. Embaixo, os canais que o app calcula
 * (GPS, veículo, suspensão, fórmulas) com os sensores de onde cada um sai. */
import { useMemo, useState } from 'react';
import { ActionIcon, Group, SegmentedControl, SimpleGrid, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import {
  IconAlertCircle, IconAlertOctagon, IconAlertTriangle, IconCircleCheck, IconCrosshair, IconSearch, type Icon,
} from '@tabler/icons-react';
import {
  SHOCK_STILL_MM, channelExplainId, sensorsOfChannel, type Channel, type ChannelQuality, type DataQuality, type SensorId, type SessionContext,
} from '@baja/core';
import { DataTable, InfoButton, Section, SensorChips, StatTile, type Column } from '../../components';
import { STATUS_COLOR, type Status } from '../../theme';
import { ExplainText, decFor, fmtN, goToTime } from './common';

interface Flag { status: Status; text: string; explain: string; t?: number }

const ICON: Record<Status, Icon> = { good: IconCircleCheck, warn: IconAlertTriangle, serious: IconAlertCircle, crit: IconAlertOctagon };

/* estado do canal: o que a qualidade achou (cada item abre o card do problema) */
function flagsOf(c: ChannelQuality): Flag[] {
  const out: Flag[] = [];
  if (!c.valid) return [{ status: c.role ? 'crit' : 'warn', text: 'Sem nenhum dado', explain: 'quality.validSamples' }];
  if (c.constant) out.push({ status: c.role ? 'crit' : 'warn', text: c.role ? 'Constante: sensor sem sinal' : 'Constante', explain: 'quality.constant' });
  /* posição do amortecedor com sinal mas quase parada no log inteiro (o mesmo limite do aviso
   * susp.still do core: máx − mín < SHOCK_STILL_MM) */
  else if (c.role && c.role.startsWith('shock_pos_') && c.hi - c.lo < SHOCK_STILL_MM) {
    out.push({ status: 'warn', text: `Quase parado: mexe só ${(c.hi - c.lo).toFixed(1)} mm`, explain: 'quality.shockStill' });
  }
  if (c.validPct < 50) out.push({ status: 'warn', text: `Só ${c.validPct.toFixed(0)} % com dado`, explain: 'quality.validSamples' });
  if (c.stuck.length) out.push({ status: 'warn', text: `Travado ${c.stuckS.toFixed(1)} s andando`, explain: 'quality.stuck', t: c.stuck[0].t0 });
  if (c.jumpCount) out.push({ status: 'warn', text: `${c.jumpCount} salto(s) impossível(is)`, explain: 'quality.jumps', t: c.jumps[0]?.t });
  if (c.outOfRange) out.push({ status: 'warn', text: `${c.outOfRange} fora da faixa`, explain: 'quality.jumps' });
  if (!out.length) out.push({ status: 'good', text: 'OK', explain: 'quality.validSamples' });
  return out;
}

function FlagList({ flags, sensors }: { flags: Flag[]; sensors: SensorId[] }) {
  return (
    <Stack gap={4}>
      {flags.map((f, k) => {
        const I = ICON[f.status];
        return (
          <Group key={k} gap={4} wrap="nowrap">
            <ExplainText explain={f.explain} sensors={sensors} title={f.text}>
              <span className="bt-status" style={{ ['--bt-status' as string]: STATUS_COLOR[f.status] }}>
                <I size={16} stroke={2} aria-hidden />{f.text}
              </span>
            </ExplainText>
            {f.t !== undefined && (
              <Tooltip label={`Ir ao ponto (t = ${f.t.toFixed(1)} s)`}>
                <ActionIcon variant="subtle" color="gray" size="md" aria-label="Ir ao ponto" onClick={() => goToTime(f.t!)}>
                  <IconCrosshair size={17} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
        );
      })}
    </Stack>
  );
}

type Filter = 'all' | 'roles' | 'problems';

export function CanaisTab({ ctx, quality }: { ctx: SessionContext; quality: DataQuality }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const Q = quality;

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return Q.channels.filter(c => {
      if (s && !(c.name.toLowerCase().includes(s) || c.key.toLowerCase().includes(s) || c.roleLabel.toLowerCase().includes(s))) return false;
      if (filter === 'roles') return !!c.role;
      if (filter === 'problems') return flagsOf(c).some(f => f.status !== 'good');
      return true;
    });
  }, [Q, filter, q]);

  const live = Q.channels.filter(c => !c.constant && c.valid > 0).length;
  const withRole = Q.channels.filter(c => c.role).length;
  const sensOf = (c: ChannelQuality): SensorId[] => (c.sensor ? [c.sensor] : ['logger']);

  const columns: Column<ChannelQuality>[] = [
    {
      key: 'name', header: 'Canal', width: '22%',
      render: c => (
        <Stack gap={0}>
          <ExplainText explain={channelExplainId(c.key, c.sensor)} sensors={sensOf(c)} title={c.name} strong>{c.name}</ExplainText>
          <Text size="xs" c="dimmed" ff="monospace" style={{ wordBreak: 'break-all' }}>{c.key}</Text>
        </Stack>
      ),
    },
    {
      key: 'role', header: 'Papel detectado', width: '20%',
      render: c => (c.role
        ? <Text size="sm">{c.roleLabel}</Text>
        : <Text size="sm" c="dimmed">sem papel (não entra nas análises automáticas)</Text>),
    },
    { key: 'sensor', header: 'Sensor', render: c => <SensorChips sensors={sensOf(c)} size="sm" /> },
    {
      key: 'unit', header: 'Unidade',
      render: c => (c.unit ? c.unit : <Tooltip label="O CSV do FT Manager não traz a unidade; vale a calibração da entrada na FT"><Text span c="dimmed">—</Text></Tooltip>),
    },
    {
      key: 'valid', header: 'Válidas', numeric: true,
      render: c => <ExplainText explain="quality.validSamples" sensors={sensOf(c)} title={`Amostras válidas · ${c.name}`}>{c.validPct.toFixed(0)} %</ExplainText>,
    },
    {
      key: 'rate', header: 'Taxa', numeric: true,
      render: c => (
        <Stack gap={0} align="flex-end">
          <ExplainText explain="quality.sampleRate" sensors={sensOf(c)} title={`Taxa · ${c.name}`}>{fmtN(c.rateHz, 0)} Hz</ExplainText>
          {isFinite(c.updateHz) && Math.abs(c.updateHz - c.rateHz) > 0.5 && (
            <Text size="xs" c="dimmed">muda a {fmtN(c.updateHz, 1)} Hz</Text>
          )}
        </Stack>
      ),
    },
    {
      key: 'range', header: 'Mín – máx', numeric: true,
      render: c => {
        const d = decFor(c.lo, c.hi);
        return (
          <ExplainText explain={channelExplainId(c.key, c.sensor)} sensors={sensOf(c)} title={c.name}>
            {c.valid ? `${fmtN(c.lo, d)} – ${fmtN(c.hi, d)}` : '—'}
          </ExplainText>
        );
      },
    },
    { key: 'state', header: 'Estado', width: '20%', render: c => <FlagList flags={flagsOf(c)} sensors={sensOf(c)} /> },
  ];

  /* canais calculados pelo app (GPS, veículo, suspensão, fórmulas) */
  const calc = useMemo(() => ctx.all.filter(c => c.src !== 'log').map(c => ({ c, sensors: sensorsOfChannel(ctx, c) })), [ctx]);
  const SRC_LABEL: Record<Channel['src'], string> = { gps: 'GPS', calc: 'Calculado', formula: 'Fórmula', log: 'Log' };
  const calcCols: Column<{ c: Channel; sensors: SensorId[] }>[] = [
    {
      key: 'name', header: 'Canal calculado', width: '34%',
      render: ({ c, sensors }) => (
        <Stack gap={0}>
          <ExplainText explain={channelExplainId(c.key)} sensors={sensors} title={c.name} strong>{c.name}</ExplainText>
          <Text size="xs" c="dimmed" ff="monospace">{c.key}</Text>
        </Stack>
      ),
    },
    { key: 'src', header: 'Origem', render: ({ c }) => SRC_LABEL[c.src] },
    { key: 'unit', header: 'Unidade', render: ({ c }) => c.unit || '—' },
    { key: 'sensors', header: 'Sai dos sensores', render: ({ sensors }) => <SensorChips sensors={sensors} size="sm" /> },
    {
      key: 'range', header: 'Mín – máx', numeric: true,
      render: ({ c, sensors }) => {
        const d = decFor(c.lo, c.hi);
        return (
          <ExplainText explain={channelExplainId(c.key)} sensors={sensors} title={c.name}>
            {c.count && !c.constant ? `${fmtN(c.lo, d)} – ${fmtN(c.hi, d)}` : c.count ? `constante ${fmtN(c.lo, d)}` : 'sem dado'}
          </ExplainText>
        );
      },
    },
  ];

  const gpsSens: SensorId[] = ['gps'];
  return (
    <div>
      <Section title="Resumo do log" description="A qualidade vale para o log inteiro (o trecho do cabeçalho não muda estes números).">
        <SimpleGrid cols={{ base: 1, xs: 2, md: 3, xl: 6 }} spacing="md">
          <StatTile label="Duração" value={Q.duration / 60} decimals={1} unit="min" hint={`${Q.duration.toFixed(0)} s`} explain="design.duration" sensors={['logger']} />
          <StatTile label="Taxa do log" value={Q.logRateHz} decimals={0} unit="Hz" hint={isFinite(Q.logRateHz) ? `enxerga até ${(Q.logRateHz / 2).toFixed(1)} Hz` : undefined} explain="quality.sampleRate" sensors={['logger']} />
          <StatTile label="Canais com sinal" value={`${live} de ${Q.channels.length}`} explain="quality.constant" sensors={['logger']}
            status={live === Q.channels.length ? 'good' : undefined} hint="os outros ficaram constantes ou vazios" />
          <StatTile label="Canais reconhecidos" value={`${withRole}`} hint="com papel (sensor) detectado" explain="design.sensorCoverage" sensors={['logger']} />
          <StatTile label="GPS atualiza a" value={Q.gpsUpdateHz} decimals={1} unit="Hz" explain="quality.sampleRate" sensors={gpsSens}
            hint={isFinite(Q.gpsUpdateHz) ? 'o módulo manda 4 Hz' : 'sem canais X/Y com sinal'}
            status={isFinite(Q.gpsUpdateHz) ? (Q.gpsUpdateHz >= 3 ? 'good' : 'warn') : undefined} />
          <StatTile label="GPS na borda da área" value={Q.gpsBorderPct} decimals={1} unit="%" explain="quality.gpsBorder" sensors={gpsSens}
            hint={Q.gpsBorderPct === null ? 'sem trajetória do GPS' : 'posição falsa nesses trechos'}
            status={Q.gpsBorderPct === null ? undefined : Q.gpsBorderPct > 1 ? 'warn' : 'good'} />
        </SimpleGrid>
      </Section>

      <Section
        title={`Canais gravados (${Q.channels.length})`}
        description="Papel = o que o app reconheceu no canal (pelas mesmas regras das contas): é assim que cada número das análises sabe de qual sensor saiu. Clique no nome, nos números ou no estado para ver o card de explicação; a mira vai ao ponto do problema."
        explain="quality.validSamples" sensors={['logger']}
        actions={(
          <Group gap="sm" wrap="wrap">
            <TextInput size="md" placeholder="Procurar canal" leftSection={<IconSearch size={17} />} value={q} onChange={e => setQ(e.currentTarget.value)} w={220} aria-label="Procurar canal" />
            <SegmentedControl size="md" value={filter} onChange={v => setFilter(v as Filter)} data={[
              { value: 'all', label: 'Todos' }, { value: 'roles', label: 'Com papel' }, { value: 'problems', label: 'Com problema' },
            ]} />
          </Group>
        )}
      >
        <div className="bt-acq-hscroll">
          <div style={{ minWidth: 980 }}>
            <DataTable columns={columns} rows={rows} rowKey={c => c.key} empty="Nenhum canal com esse filtro." />
          </div>
        </div>
      </Section>

      <Section
        title={`Canais calculados pelo app (${calc.length})`}
        description="Saem dos canais do log: velocidade, distância e acelerações do GPS e da roda, potência, ângulos e rugosidade da suspensão e as fórmulas da equipe. Os chips dizem de quais sensores cada um sai."
        explain="channel.formula" sensors={['logger']}
      >
        {calc.length ? (
          <div className="bt-acq-hscroll">
            <div style={{ minWidth: 820 }}>
              <DataTable columns={calcCols} rows={calc} rowKey={r => r.c.key} />
            </div>
          </div>
        ) : (
          <Group gap="xs"><Text c="dimmed">Nenhum canal calculado: sem GPS, roda nem amortecedores com sinal neste log.</Text><InfoButton explain="design.sensorCoverage" /></Group>
        )}
      </Section>
    </div>
  );
}
