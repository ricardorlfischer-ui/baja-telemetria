/* Página /trem-de-forca (renderPower + renderCoast + showCoast de legacy/js/vehicleui.js):
 * de onde vem a velocidade (roda calibrada pelo GPS ou só GPS), blocos, potência na roda ×
 * velocidade, largadas (clique = ir ao ponto) com o escorregamento nos 30 m e o coast-down
 * (Crr e CdA, que podem ir para o carro ativo).
 *
 * Tudo vem de powertrainReport (core); a página só desenha. */
import { useMemo, useState } from 'react';
import { Alert, Button, Group, Paper, Select, Stack, Table, Text, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle, IconArrowRight, IconCar, IconCheck, IconFocus2, IconGauge, IconPlayerTrackNext,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { powertrainReport, type CarConfig, type RepRow, type SessionContext } from '@baja/core';
import { ChartCard, DataTable, InfoButton, PageHeader, Section, type Column } from '../components';
import { routeByPath } from '../routes';
import { useCursorTime, useCtx, useRange, useSessionStore } from '../state/session';
import { useProfiles } from '../state/profiles';
import { useLibrary } from '../library';
import { resolveColor, useChartTheme } from '../theme';
import { MissingState, NeedSensors, NoSession, RangeBadge, RepChart, RepTiles, SourceNote, VehStyles, Grid2 } from './veiculo/shared';
import { useProfilePerms } from './config/parts';

const ROUTE = '/trem-de-forca';

export default function TremDeForcaPage() {
  const r = routeByPath(ROUTE)!;
  const ctx = useCtx();
  const range = useRange();
  if (!ctx || !range) return <NoSession title={r.label} subtitle={r.question} what="a potência na roda, as largadas e o coast-down" />;
  return <Body ctx={ctx} i0={range[0]} i1={range[1]} label={range[2]} />;
}

function Body({ ctx, i0, i1, label }: { ctx: SessionContext; i0: number; i1: number; label: string }) {
  const r = routeByPath(ROUTE)!;
  const nav = useNavigate();
  const seek = useSessionStore(s => s.seek);
  const view = useSessionStore(s => s.view);
  const [coastSel, setCoastSel] = useState<string | undefined>(undefined);
  const [coastManual, setCoastManual] = useState<{ t0: number; t1: number } | null>(null);
  const rep = useMemo(() => powertrainReport(ctx, i0, i1, { coastSel, coastManual }), [ctx, i0, i1, coastSel, coastManual]);

  const carBtn = (
    <Button variant="default" size="md" leftSection={<IconCar size={18} />} onClick={() => nav('/carro')}>Dados do carro</Button>
  );
  const header = (
    <PageHeader title={r.label} subtitle={r.question} explain="power.wheelPower" sensors={rep.ok ? rep.tiles.find(t => t.key === 'pmax')?.sensors : undefined}
      actions={<><RangeBadge label={label} />{carBtn}</>} />
  );

  if (!rep.ok) {
    return (
      <>
        <VehStyles />
        {header}
        <MissingState
          icon={IconGauge} title="Este log não tem velocidade"
          action={carBtn}
        >
            <Stack gap="md">
              <Text c="dimmed">{rep.empty} Sem velocidade não dá para calcular potência na roda, largadas nem coast-down.</Text>
              <Text fw={600}>O que medir:</Text>
              <NeedSensors sensors={['wheel', 'gps']} why={{
                wheel: 'Sensor de velocidade na roda (de preferência na roda de tração): dá a aceleração precisa, a potência e o escorregamento.',
                gps: 'GPS com fix: dá a velocidade (menos precisa) e calibra o diâmetro do pneu da roda.',
              }} />
              <Text size="sm" c="dimmed">Se o canal da roda existe no log com outro nome, escolha-o na página Carro.</Text>
            </Stack>
        </MissingState>
      </>
    );
  }

  const coast = rep.coast;
  const takeWindow = () => {
    const t = ctx.S.t;
    const w = view ?? [t[0], t[t.length - 1]];
    setCoastManual({ t0: w[0], t1: w[1] });
    setCoastSel('m');
  };

  return (
    <>
      <VehStyles />
      {header}

      <Section title="De onde vem a velocidade" description="Tudo nesta página parte da velocidade do carro: a aceleração, a potência na roda, as largadas e o coast-down.">
        <SourceNote src={rep.src} label="Fonte da velocidade" icon={IconGauge}>
          <Text size="sm" c="dimmed">
            O GPS mede a distância de verdade; a roda mede a velocidade com muito mais resolução, mas depende da circunferência
            do pneu digitada na FT. Comparando as duas nos trechos sem escorregar, o app acha o fator do pneu e corrige a roda
            (bloco “A roda marca”). Pelo GPS sozinho a aceleração é bem menos precisa.
          </Text>
        </SourceNote>
        {!rep.src.sensors.includes('wheel') && (
          <Alert mt="md" color="yellow" variant="light" icon={<IconAlertTriangle size={20} />} title="Falta o sensor de velocidade da roda">
            Só com o GPS (posição a 4 Hz) a aceleração e a potência na roda são ordem de grandeza, e não dá para achar o fator do
            pneu nem o escorregamento nas largadas. Instale o sensor de rotação na roda de tração (ou, se o canal existe com outro
            nome, escolha-o na página Carro).
          </Alert>
        )}
        {rep.vmax * 3.6 < 15 && (
          <Alert mt="md" color="yellow" variant="light" icon={<IconAlertTriangle size={20} />} title="O carro quase não andou neste trecho">
            Velocidade máxima de {(rep.vmax * 3.6).toFixed(1)} km/h: potência, largadas e coast-down precisam de um teste andando.
            Grave largadas (parado → acelerador no fundo por 30 m) e um coast-down (embalar a ~40 km/h e soltar, sem frear).
          </Alert>
        )}
      </Section>

      <Section title="Números do trecho" description="Cada número abre o card com a conta e os sensores de onde saiu.">
        <RepTiles tiles={rep.tiles} />
      </Section>

      <Section title="Potência na roda × velocidade" explain="power.powerCurve" sensors={rep.curve?.sensors}
        description="P = (m·a + Crr·m·g + ½·ρ·CdA·v²)·v, percentil 90 em cada faixa de velocidade com o carro acelerando. Abaixo da curva de potência constante o limite é a tração (ou o acoplamento da CVT).">
        <RepChart
          plot={rep.curve} title="Potência na roda × velocidade" height={360}
          subtitle="Linha azul: potência que chega na roda. Linha cinza horizontal: potência do motor (Dados do carro). Reta cinza: limite de tração F·v. Pontos: cada amostra acelerando."
          emptyHint="Precisa de trechos com o carro acelerando (acima de ~5 km/h). Faça uma largada ou uma aceleração em reta com o acelerador no fundo."
        />
      </Section>

      <Section title="Largadas (parado → acelerando)" explain="power.launch" sensors={rep.launchTable?.sensors}
        description="Tempo até 10, 20 e 30 m e até 20 e 40 km/h em cada saída do carro parado. Clique numa linha para ir ao instante da largada.">
        {/* a tabela tem 10 colunas: sempre na largura toda, o gráfico embaixo */}
        <div className="bt-veh-stack">
          <LaunchTable rep={rep} seek={seek} />
          <RepChart
            plot={rep.slip} title="Escorregamento da roda de tração nos primeiros 30 m" height={300}
            subtitle="(roda − GPS) / GPS. Acima de ~10–15 % a roda está patinando: o pneu ou a calibração da CVT não seguram o torque."
            emptyHint="Precisa do sensor de velocidade na roda de tração e do GPS com fix ao mesmo tempo, e de pelo menos uma largada do carro parado."
          />
        </div>
      </Section>

      {coast && (
        <Section title="Coast-down: resistência ao rolamento e arrasto" explain="power.coastDown" sensors={coast.sensors}
          description="Em reta plana, embale, tire o pé (a CVT desacopla) ou ponha em ponto morto e deixe o carro perder velocidade sozinho, sem frear. A desaceleração dá −m·a = Crr·m·g + ½·ρ·CdA·v². O app procura esses trechos sozinho; também dá para usar o trecho dos gráficos.">
          <Paper withBorder radius="md" p="md" mb="lg">
            <Group gap="sm" wrap="wrap" align="flex-end">
              <Select
                label="Trecho analisado" size="md" style={{ flex: '1 1 360px', maxWidth: 560 }}
                data={coast.options.map(o => ({ value: o.value || '_none', label: o.label }))}
                value={coast.selected || '_none'} allowDeselect={false}
                disabled={!coast.options.some(o => o.value !== '')}
                onChange={v => v && v !== '_none' && setCoastSel(v)}
              />
              <Tooltip label="Usa a janela de tempo dos gráficos (seletor Janela no cabeçalho ou zoom na página Canais); sem janela, a sessão inteira">
                <Button size="md" variant="default" leftSection={<IconFocus2 size={18} />} onClick={takeWindow}>Usar trecho dos gráficos</Button>
              </Tooltip>
              <SeekCoastButton coast={coast} seek={seek} />
              <ApplyButton apply={coast.apply} />
            </Group>
          </Paper>
          <Grid2>
            <CoastResult coast={coast} />
            <RepChart
              plot={coast.plot} title="Força de resistência × velocidade" height={320}
              subtitle="Pontos: −m·a em cada amostra do trecho. Linha: o ajuste A + B·v² (A = rolamento, B = arrasto)."
              emptyHint="Escolha um trecho de coast-down ou use o trecho dos gráficos."
            />
          </Grid2>
        </Section>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- largadas */
function LaunchTable({ rep, seek }: { rep: ReturnType<typeof powertrainReport>; seek: (t: number) => void }) {
  const th = useChartTheme();
  const tab = rep.launchTable;
  const cursor = useCursorTime(200);
  const L = rep.launchList;
  /* largada em andamento no cursor (destaque da linha) */
  let sel = -1;
  L.forEach((l, k) => { if (cursor >= l.t0 - 0.6 && cursor <= l.t0 + 8) sel = k; });
  if (!tab) {
    return (
      <ChartCard title="Largadas" explain="power.launch" sensors={[]}>
        <Stack align="center" justify="center" gap={6} style={{ minHeight: 300 }} px="md" ta="center">
          <Text fw={600}>Nenhuma largada neste trecho</Text>
          <Text c="dimmed" size="sm" maw={460}>{rep.launchEmpty} Para medir: pare o carro, espere 1 s e acelere com tudo por pelo menos 30 m em reta.</Text>
        </Stack>
      </ChartCard>
    );
  }
  const cols: Column<RepRow>[] = tab.columns.map((h, j) => ({
    key: String(j), header: h, numeric: j > 0,
    render: (row: RepRow) => j === 0 ? (
      <Group gap={6} wrap="nowrap">
        <i style={{ width: 12, height: 12, borderRadius: 3, background: resolveColor(th, row.role) ?? th.series[0], display: 'inline-block' }} />
        {row.cells[0]}
      </Group>
    ) : j === 4 ? <b>{row.cells[j]}</b> : row.cells[j],
  }));
  cols.push({
    key: 'info', header: '', width: 40,
    render: row => <InfoButton explain={row.explain ?? tab.explain} sensors={row.sensors ?? tab.sensors} title="Largada" size="sm" />,
  });
  return (
    <ChartCard title="Tempos de cada largada" explain={tab.explain} sensors={tab.sensors}
      subtitle="Tempos em segundos. Coluna 0–30 m em destaque: é a prova de aceleração. Clique numa linha para ir ao ponto.">
      <div style={{ overflowX: 'auto' }}>
        <DataTable columns={cols} rows={tab.rows} onRowClick={row => row.seek !== undefined && seek(row.seek)} selected={sel} maxHeight={420} />
      </div>
    </ChartCard>
  );
}

/* ---------------------------------------------------------------- coast-down */
type CoastRep = NonNullable<ReturnType<typeof powertrainReport>['coast']>;

function CoastResult({ coast }: { coast: CoastRep }) {
  if (!coast.fit) {
    return (
      <ChartCard title="Resultado do coast-down" explain={coast.explain} sensors={coast.sensors}>
        <Stack gap="sm" p="xs" style={{ minHeight: 280 }} justify="center">
          <Text fw={600}>Nenhum ajuste neste trecho</Text>
          <Text c="dimmed">{coast.empty}</Text>
        </Stack>
      </ChartCard>
    );
  }
  return (
    <ChartCard title="Resultado do coast-down" explain={coast.explain} sensors={coast.sensors}>
      <Stack gap="md" p={4}>
        <Table verticalSpacing="sm" horizontalSpacing="sm" className="bt-table" withRowBorders>
          <Table.Tbody>
            {coast.rows.map((row, k) => (
              <Table.Tr key={k}>
                <Table.Td><Text>{row.cells[0]}</Text></Table.Td>
                <Table.Td className="bt-num" style={{ textAlign: 'right' }}>
                  <Text fw={k < 2 ? 700 : 500} size={k < 2 ? 'xl' : 'md'} span>{row.cells[1]}</Text>
                </Table.Td>
                <Table.Td width={40}>
                  <InfoButton explain={row.explain ?? coast.explain} sensors={row.sensors ?? coast.sensors} title={row.cells[0]} size="sm" />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {coast.warn.length > 0 && (
          <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={20} />} title="Atenção">
            {coast.warn.join('; ')}.
          </Alert>
        )}
        <Text size="sm" c="dimmed">{coast.note}</Text>
      </Stack>
    </ChartCard>
  );
}

function SeekCoastButton({ coast, seek }: { coast: CoastRep; seek: (t: number) => void }) {
  const sel = coast.selected;
  const seg = sel === 'm' ? coast.manual : sel !== '' ? coast.coasts[+sel] : null;
  return (
    <Button size="md" variant="default" leftSection={<IconPlayerTrackNext size={18} />} disabled={!seg} onClick={() => seg && seek(seg.t0)}>
      Ir ao trecho
    </Button>
  );
}

/* "Usar estes Crr e CdA no carro": muda o carro em uso (recalcula) e grava no perfil ativo.
 * Com o exemplo aberto, vai só para o carro do exemplo (memória), como no app antigo. */
function ApplyButton({ apply }: { apply: CoastRep['apply'] }) {
  const { lib, bump } = useLibrary();
  const updateConfig = useSessionStore(s => s.updateConfig);
  const demo = useSessionStore(s => s.source?.type === 'demo' || !!s.S?.demo);
  const activeCarId = useProfiles(s => s.activeCarId);
  const activeCar = useProfiles(s => s.cars.find(c => c.id === s.activeCarId));
  const carName = activeCar?.name;
  const perms = useProfilePerms();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!apply) return;
    const car: Partial<CarConfig> = { crr: apply.crr };
    if (apply.cda !== null) car.cda = apply.cda;
    updateConfig({ car });
    const what = `Crr ${apply.crr}${apply.cda !== null ? ` e CdA ${apply.cda} m²` : ' (CdA mantido)'}`;
    if (demo) {
      notifications.show({ color: 'green', icon: <IconCheck size={18} />, title: 'Carro do exemplo atualizado', message: `${what}. No exemplo o carro fica só na memória (não muda o carro real).` });
      return;
    }
    /* perfil de outra pessoa no servidor (PUT daria 403): muda só o carro em uso */
    if (activeCarId && lib && !perms.canEdit(activeCar)) {
      notifications.show({ color: 'yellow', title: 'Carro em uso atualizado, perfil não gravado', message: `${what}. ${perms.whyNot(activeCar)} Duplique o perfil na página Carro para guardar.`, autoClose: 9000 });
      return;
    }
    if (activeCarId && lib) {
      setBusy(true);
      try {
        const p = await useProfiles.getState().saveCarProfile(lib);
        bump();
        notifications.show({ color: 'green', icon: <IconCheck size={18} />, title: `Perfil “${p.name}” atualizado`, message: `${what}. A potência na roda e o modelo da CVT foram recalculados.` });
      } catch (e) {
        notifications.show({ color: 'red', title: 'Não deu para gravar no perfil', message: `${what} vale no carro em uso, mas o perfil não foi salvo: ${(e as Error).message}` });
      } finally { setBusy(false); }
    } else {
      notifications.show({ color: 'green', icon: <IconCheck size={18} />, title: 'Carro em uso atualizado', message: `${what}. Nenhum perfil de carro ativo: salve um perfil na página Carro para guardar.` });
    }
  };
  const tip = !apply ? 'Escolha um trecho com ajuste'
    : demo ? 'Aplica no carro do exemplo (só na memória)'
      : activeCarId ? `Aplica no carro em uso e grava no perfil “${carName ?? ''}”` : 'Aplica no carro em uso (nenhum perfil ativo)';
  return (
    <Tooltip label={tip}>
      <Button size="md" leftSection={<IconArrowRight size={18} />} disabled={!apply} loading={busy} onClick={() => void go()}>
        Usar estes Crr e CdA no carro
      </Button>
    </Tooltip>
  );
}
