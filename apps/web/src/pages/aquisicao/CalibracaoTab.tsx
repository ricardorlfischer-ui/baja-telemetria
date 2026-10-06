/* Aba "Calibração e testes":
 *  - calibração das entradas 7/8 da FT450 para o GPS (cfgInfo() de legacy/js/app.js →
 *    trackConfigInfo do core, e a seção "GPS no log da FT" do legacy/README.md);
 *  - os 5 testes para fazer com o carro (legacy/README.md), como lista de conferência: o que
 *    cada teste mede, como fazer e quais sensores usa (marcações ficam neste navegador). */
import { useMemo, useState, type ReactNode } from 'react';
import { Alert, Checkbox, Code, Group, List, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconInfoCircle } from '@tabler/icons-react';
import { DEFAULT_CFG, trackConfigInfo, type DataQuality, type SensorId, type SessionContext, type TrackConfig } from '@baja/core';
import { InfoButton, Section, SensorChips, StatTile } from '../../components';
import { useProfiles } from '../../state/profiles';
import { lsGet, lsSet } from '../../state/prefs';
import { ExplainText } from './common';

interface CarTest {
  id: string;
  title: string;
  how: string;
  measures: string;
  explain: string;
  sensors: SensorId[];
  /* análises que o teste alimenta (cards) */
  feeds: { explain: string; label: string }[];
}

/* os 5 testes do legacy/README.md ("Testes para fazer com o carro"), com o que cada um mede */
const TESTS: CarTest[] = [
  {
    id: 'drop', title: '1. Teste de queda (parado)',
    how: 'Com o log gravando e o carro parado, empurre e solte a dianteira e depois a traseira, umas 3 vezes cada, com uns 5 s entre elas (ou deixe o carro cair uns 5 cm). O app acha o evento sozinho.',
    measures: 'Frequência natural e amortecimento (ζ) de cada eixo pelo decaimento: período entre picos e decremento logarítmico. Com a massa suspensa, k = m·(2π·f)² e c = 2ζ·√(k·m).',
    explain: 'freq.dropTest', sensors: ['shock_fl', 'shock_fr', 'shock_rl', 'shock_rr', 'gps', 'car_data'],
    feeds: [{ explain: 'susp.naturalFreq', label: 'Frequência natural e ζ' }, { explain: 'susp.rideRates', label: 'Rigidez e amortecimento na roda' }],
  },
  {
    id: 'coast', title: '2. Coast-down',
    how: 'Reta plana: embale a ~40 km/h e deixe desacelerar sem frear até ~10 km/h (tire o pé: a CVT desacopla, ou ponha em ponto morto). Faça nos dois sentidos.',
    measures: 'Resistência ao rolamento e arrasto: −m·a = Crr·m·g + ½·ρ·CdA·v². Crr e CdA reais para o simulador do carro novo.',
    explain: 'power.coastDown', sensors: ['wheel', 'gps', 'car_data'],
    feeds: [{ explain: 'power.coastDown', label: 'Crr e CdA' }, { explain: 'power.resistances', label: 'Resistências ao movimento' }],
  },
  {
    id: 'launch', title: '3. Largadas',
    how: '3 largadas do carro parado de pelo menos 30 m, em piso plano.',
    measures: 'Tempos 0–10/20/30 m e 0–20/40 km/h, força trativa e o escorregamento da roda de tração.',
    explain: 'power.launch', sensors: ['wheel', 'gps', 'car_data'],
    feeds: [{ explain: 'power.launch', label: 'Tempos de largada' }, { explain: 'power.launchSlip', label: 'Escorregamento na largada' }, { explain: 'power.tractiveForce', label: 'Força trativa' }],
  },
  {
    id: 'cvt', title: '4. CVT: log longo',
    how: 'Um log longo (≥ 15 min) andando e depois parado com o motor ligado, para o modelo ver o aquecimento e o resfriamento.',
    measures: 'Modelo térmico dT/dt = θ₁·P − (θ₂ + θ₃·v)·(T − T_amb): constante de tempo, temperatura de regime e projeção para o enduro.',
    explain: 'cvt.thermalModel', sensors: ['cvt_temp', 'wheel', 'gps', 'car_data'],
    feeds: [{ explain: 'cvt.enduranceProjection', label: 'Projeção do enduro' }, { explain: 'cvt.coolingNeed', label: 'Troca de calor que falta' }],
  },
  {
    id: 'car', title: '5. Medidas do carro',
    how: 'Meça e coloque em Carro: massa com piloto, massa suspensa por roda (balança por roda menos a massa não suspensa), relação roda/amortecedor, curso total, bitolas e entre-eixos.',
    measures: 'Transformam medida em grandeza de projeto: curso em ângulo de rolagem/arfagem, frequência em rigidez e amortecimento, aceleração em força e potência, % do curso e fim de curso.',
    explain: 'quality.carData', sensors: ['car_data'],
    feeds: [{ explain: 'susp.rollGradient', label: 'Gradiente de rolagem (°/g)' }, { explain: 'susp.bottomOut', label: 'Fim de curso' }, { explain: 'power.wheelPower', label: 'Potência na roda' }],
  },
];

const K_TESTS = 'baja:aquisicao:testes';
const readDone = (): Record<string, boolean> => {
  try { const v = JSON.parse(lsGet(K_TESTS) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
};

export function CalibracaoTab({ ctx, quality }: { ctx: SessionContext | null; quality: DataQuality | null }) {
  const draftTrack = useProfiles(s => s.draft.track);
  const cfg: TrackConfig = useMemo(() => (ctx ? ctx.cfg : { ...DEFAULT_CFG, ...draftTrack }), [ctx, draftTrack]);
  const info = useMemo(() => trackConfigInfo({ S: ctx?.S ?? null, cfg, track: ctx?.track ?? null }), [ctx, cfg]);
  const [done, setDone] = useState<Record<string, boolean>>(readDone);
  const toggle = (id: string, v: boolean) => {
    const next = { ...done, [id]: v };
    setDone(next);
    lsSet(K_TESTS, JSON.stringify(next));
  };
  const gpsIssues = (quality?.issues ?? []).filter(i => i.explain === 'quality.gpsCalibration' || i.explain === 'quality.gpsBorder');
  const gps: SensorId[] = ['gps'];
  const nDone = TESTS.filter(t => done[t.id]).length;

  return (
    <div>
      <Section
        title="Calibração das entradas 7 e 8 da FT (GPS)"
        description="O PIC (pic_gps_expander) manda a posição como código 0–255 nas entradas 7 (X, Leste) e 8 (Y, Norte) do expander. Os números da pista (centro, tamanho, margem) ficam em Pista e GPS e têm que ser iguais aos do track_config.h gravado no PIC."
        explain="quality.gpsCalibration" sensors={gps}
      >
        <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing="md" mb="lg">
          <StatTile label="Vão coberto X × Y" value={`${info.span.x} × ${info.span.y}`} unit="m" explain="track.gpsPosition" sensors={gps}
            hint={cfg.centerFixed ? 'centro fixo' : 'centro automático: vão dobrado'} />
          <StatTile label="Resolução X (Leste)" value={info.stepX} decimals={1} unit="cm" hint="por passo do código" explain="track.gpsPosition" sensors={gps} />
          <StatTile label="Resolução Y (Norte)" value={info.stepY} decimals={1} unit="cm" hint="por passo do código" explain="track.gpsPosition" sensors={gps} />
          <StatTile label="Formato do log" value={ctx?.track.fmt ? ({ V: 'volts', mV: 'mV', code: 'código', m: 'metros' } as Record<string, string>)[ctx.track.fmt] ?? ctx.track.fmt : '—'}
            hint={ctx ? (ctx.S.gps ? 'BUSMASTER: lat/lon do módulo' : cfg.fmt === 'auto' ? 'detectado automaticamente' : 'escolhido em Pista e GPS') : 'abra uma sessão'}
            explain="quality.gpsCalibration" sensors={gps} />
        </SimpleGrid>

        <Grid2>
          <Paper withBorder radius="md" p="lg">
            <Group justify="space-between" wrap="nowrap" mb="xs">
              <Title order={3}>{info.calibration.title}</Title>
              <InfoButton explain={info.calibration.explain} sensors={info.calibration.sensors} title="Calibração na FT" />
            </Group>
            <List spacing="xs" size="md">
              {info.calibration.items.map((t, k) => <List.Item key={k}>{t}</List.Item>)}
            </List>
            <Text size="sm" c="dimmed" mt="md">{info.resolution.text}</Text>
            {info.source && <Text size="sm" mt={6}><Text span fw={600}>Neste log: </Text>{info.source}</Text>}
          </Paper>

          <Paper withBorder radius="md" p="lg">
            <Group justify="space-between" wrap="nowrap" mb="xs">
              <Title order={3}>GPS no log da FT</Title>
              <InfoButton explain="track.gpsPosition" sensors={gps} title="GPS no log da FT" />
            </Group>
            <List spacing="xs" size="md">
              <List.Item><Text span fw={600}>X (Leste) = <Code>Back_pressure</Code></Text> (DataID 0x0177)</List.Item>
              <List.Item><Text span fw={600}>Y (Norte) = <Code>O2_General</Code></Text> (DataID 0x0027)</List.Item>
            </List>
            <Text size="sm" mt="sm">Isso vem da ordem dos DataIDs no bloco 0x2FF do log do BUSMASTER. Para conferir, ande para o Norte: o Y tem que subir. Se estiver trocado, use Pista e GPS → Trocar X ↔ Y. Também dá para ligar o fundo de satélite e ver se o traçado cai em cima da pista.</Text>
            <Text fw={600} mt="md" mb={4}>Conversão (a mesma do gps_pos.c):</Text>
            <pre className="bt-acq-pre">{'código = V × 51            (log em volts)\nresolução = (tamanho + 2 × margem) / 255\n   ex.: 200 m + 2×10 m → 0,863 m por passo\nmetros = (código − 127,5) × resolução'}</pre>
          </Paper>
        </Grid2>

        {gpsIssues.length > 0 && (
          <Stack gap="sm" mt="lg">
            {gpsIssues.map(i => (
              <Alert key={i.id} variant="light" color={i.level === 'info' ? 'blue' : 'yellow'} radius="md"
                icon={i.level === 'info' ? <IconInfoCircle size={20} /> : <IconAlertTriangle size={20} />}
                title={<ExplainText explain={i.explain} sensors={i.sensors} title={i.text}>{i.text}</ExplainText>}>
                <Text size="md"><Text span fw={600}>O que fazer: </Text>{i.action}</Text>
              </Alert>
            ))}
          </Stack>
        )}
      </Section>

      <Section
        title={`Testes para fazer com o carro (${nDone} de ${TESTS.length} feitos)`}
        description="Cada teste mede uma coisa que o carro andando na pista não mede bem. Marque o que já foi feito (fica salvo neste navegador). Grave também uns 5 s parado no começo de todo log (carro no chão, piloto sentado, GPS com fix): é a altura de rodagem de onde se mede o curso."
        explain="quality.staticRef" sensors={['shock_fl', 'shock_fr', 'shock_rl', 'shock_rr', 'gps']}
      >
        <Stack gap="md">
          {TESTS.map(t => (
            <Paper key={t.id} withBorder radius="md" p="lg" className="bt-acq-test" data-done={done[t.id] || undefined}>
              <Group align="flex-start" wrap="nowrap" gap="md">
                <Checkbox size="lg" mt={2} checked={!!done[t.id]} onChange={e => toggle(t.id, e.currentTarget.checked)} aria-label={`${t.title}: feito`} />
                <Stack gap={8} style={{ flex: 1, minWidth: 0 }}>
                  <Group justify="space-between" wrap="nowrap" align="flex-start">
                    <ExplainText explain={t.explain} sensors={t.sensors} title={t.title} strong>
                      <Text fw={650} size="lg">{t.title}</Text>
                    </ExplainText>
                    <InfoButton explain={t.explain} sensors={t.sensors} title={t.title} />
                  </Group>
                  <Text size="md"><Text span fw={600}>Como fazer: </Text>{t.how}</Text>
                  <Text size="md"><Text span fw={600}>O que mede: </Text>{t.measures}</Text>
                  <Group gap="sm" wrap="wrap">
                    <Text size="sm" c="dimmed">Sensores:</Text>
                    <SensorChips sensors={t.sensors} size="sm" />
                  </Group>
                  <Group gap="sm" wrap="wrap">
                    <Text size="sm" c="dimmed">Alimenta:</Text>
                    {t.feeds.map(f => (
                      <ExplainText key={f.explain} explain={f.explain} sensors={t.sensors} title={f.label}>
                        <Text span size="sm" className="bt-acq-feed">{f.label}</Text>
                      </ExplainText>
                    ))}
                  </Group>
                </Stack>
              </Group>
            </Paper>
          ))}
        </Stack>
      </Section>
    </div>
  );
}

/* duas colunas a partir de 1200 px */
function Grid2({ children }: { children: ReactNode }) {
  return <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">{children}</SimpleGrid>;
}
