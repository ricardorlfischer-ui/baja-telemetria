/* Página /carro — dados do carro (diálogo "Dados do carro" de legacy/index.html #carDlg +
 * opções da suspensão da aba Suspensão/Ressonância do antigo) e perfis do carro.
 *
 * Os números vão para a configuração em uso (state/profiles: draft) pelo updateConfig da
 * sessão, que recalcula a sessão aberta. Com o exemplo aberto, o carro é o simulado
 * (DEMO_CAR) e as mudanças ficam só na memória, como no app antigo (A.demoCar). */
import { useMemo } from 'react';
import { Alert, Button, Select, Stack, Switch, Text } from '@mantine/core';
import { IconFlask, IconRefresh, IconRuler } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import {
  DEFAULT_CAR, DEFAULT_SUSP, DEMO_CAR, findCvtCh, findWheelCh,
  type CarConfig, type QualityIssue, type SensorId, type SuspConfig,
} from '@baja/core';
import { NoSessionState, PageHeader, Section, StatTile } from '../components';
import { routeByPath } from '../routes';
import { useActiveProfiles, useProfiles } from '../state/profiles';
import { useCtx, useSessionStore } from '../state/session';
import { useDataQuality } from '../state/heavy';
import { ProfileManager } from './config/ProfileManager';
import { ChannelSelect, FieldGroup, IssueList, NumField, useProfilePerms } from './config/parts';

const SHOCKS: SensorId[] = ['shock_fl', 'shock_fr', 'shock_rl', 'shock_rr'];
const CORNER_OF: Record<string, string> = { shock_fl: 'FL', shock_fr: 'FR', shock_rl: 'RL', shock_rr: 'RR' };
/* avisos do dataQuality que dizem respeito ao carro (roda, CVT, amortecedores, dados digitados) */
const CAR_SENSORS = new Set<SensorId>(['wheel', 'cvt_temp', 'car_data', ...SHOCKS]);
const isCarIssue = (q: QualityIssue) => /^(car|wheel|cvt|susp)\./.test(q.id) || (!!q.channel && q.sensors.some(s => CAR_SENSORS.has(s)));

/** Valores efetivos (padrões aplicados) do que está em uso — o mesmo que normalizeConfig faz
 *  com o carro e a suspensão, sem precisar de uma sessão aberta. */
function useEffective(): { car: CarConfig; susp: SuspConfig; demo: boolean } {
  const demo = useSessionStore(s => !!s.S?.demo);
  const draft = useProfiles(s => s.draft);
  const demoCar = useProfiles(s => s.demoCar);
  return useMemo(() => {
    const car = { ...DEFAULT_CAR, ...(demo ? (demoCar || DEMO_CAR) : draft.car) } as CarConfig;
    const susp = { ...DEFAULT_SUSP, ...draft.susp } as SuspConfig;
    /* migração do antigo: curso/massa/MR moravam em susp */
    (['strokeF', 'strokeR', 'massF', 'massR', 'mrF', 'mrR'] as const).forEach(k => {
      if (!(+car[k] > 0) && +(susp[k] as number) > 0) car[k] = +(susp[k] as number);
    });
    return { car, susp, demo };
  }, [demo, draft, demoCar]);
}

export default function CarroPage() {
  const r = routeByPath('/carro')!;
  const nav = useNavigate();
  const { car, susp, demo } = useEffective();
  const ctx = useCtx();
  const S = useSessionStore(s => s.S);
  const availability = useSessionStore(s => s.availability);
  const busy = useSessionStore(s => s.busy);
  const updateConfig = useSessionStore(s => s.updateConfig);
  const seek = useSessionStore(s => s.seek);
  const { car: activeCar } = useActiveProfiles();
  const perms = useProfilePerms();
  /* perfil de outra pessoa (servidor): campos travados até duplicar ou usar sem perfil. Com o
   * exemplo aberto os dados do carro mexem só no carro do exemplo (memória): não travam. As
   * opções da suspensão valem para os logs reais também (draft): seguem o perfil ativo. */
  const suspLocked = !!activeCar && !perms.canEdit(activeCar);
  const locked = !demo && suspLocked;

  const setCar = (p: Partial<CarConfig>) => updateConfig({ car: p });
  const setSusp = (p: Partial<SuspConfig>) => updateConfig({ susp: p });

  /* canais do log aberto para roda e CVT (carFill do antigo: "automático (canal achado)") */
  const chOpts = useMemo(() => (S ? S.channels.map(c => ({ value: c.key, label: c.name })) : []), [S]);
  const autoWheel = useMemo(() => (S ? findWheelCh(S.channels) : null), [S]);
  const autoCvt = useMemo(() => (S ? findCvtCh(S.channels) : null), [S]);

  const quality = useDataQuality();
  const issues = useMemo(() => (quality ? quality.issues.filter(isCarIssue) : []), [quality]);

  /* sensores dos amortecedores com sinal neste log (chips); sem sessão, os quatro */
  const shocksOn = availability ? SHOCKS.filter(id => availability[id] === 'present') : [];
  const shockChips = shocksOn.length ? shocksOn : SHOCKS;
  const veh = ctx?.veh;
  const speedSensors: SensorId[] = veh?.src === 'roda' ? (veh.kN ? ['wheel', 'gps'] : ['wheel']) : veh?.src === 'GPS' ? ['gps'] : ['wheel', 'gps'];

  const n = (label: string, key: keyof CarConfig, unit: string | undefined, o: { min?: number; max?: number; description?: string; placeholder?: string } = {}) => (
    <NumField label={label} unit={unit} value={car[key] as number} disabled={locked} {...o}
      onCommit={v => setCar({ [key]: v } as Partial<CarConfig>)} />
  );

  return (
    <>
      <PageHeader title={r.label} subtitle={r.question} explain="sensor.car_data" sensors={['car_data']}
        actions={busy ? <Text c="dimmed" size="sm">Recalculando a sessão…</Text> : undefined} />

      {demo && (
        <Alert color="blue" variant="light" icon={<IconFlask size={18} />} title="Sessão de exemplo aberta" mb="lg">
          O exemplo usa o carro simulado: as mudanças nos dados do carro valem só para o exemplo e somem ao fechar
          (o carro de verdade e os perfis não mudam; “Salvar no perfil” grava o carro de verdade). As opções da suspensão valem também para os outros logs.
        </Alert>
      )}

      <Section title="Perfil do carro" explain="design.carProfile" sensors={['car_data']}
        description="Guarde um perfil por carro e acerto (ex.: “BJ26 — setup A”). As sessões guardadas lembram o perfil usado; escolher um perfil copia os números dele para cá e recalcula a sessão aberta.">
        <ProfileManager kind="car" explain="quality.carData" />
      </Section>

      <Section
        title="Dados do carro"
        explain="sensor.car_data" sensors={['car_data']}
        description="Usados nas contas de potência, rolagem, rigidez e CVT. Meça no carro sempre que der: as contas são tão boas quanto estes números."
        actions={(
          <Button variant="default" size="md" leftSection={<IconRefresh size={18} />} disabled={locked}
            onClick={() => useProfiles.getState().resetCar(demo)}>
            Valores padrão
          </Button>
        )}
      >
        <div className="cfg-groups">
          <FieldGroup title="Massa e geometria"
            usedIn={['susp.rollGradient', 'susp.pitchGradient', 'power.wheelPower', 'power.coastDown']}
            note="Massa com o piloto sentado e o tanque como na prova. Entre-eixos e bitolas de centro a centro das rodas (no chão).">
            {n('Massa total com piloto', 'mass', 'kg', { min: 0 })}
            {n('Entre-eixos', 'wb', 'mm', { min: 0 })}
            {n('Bitola dianteira', 'trackF', 'mm', { min: 0 })}
            {n('Bitola traseira', 'trackR', 'mm', { min: 0 })}
          </FieldGroup>

          <FieldGroup title="Suspensão"
            usedIn={['susp.travelUsed', 'susp.bottomOut', 'susp.rollGradient', 'susp.rideRates', 'susp.dampingCoeff']}
            note={<>Relação roda/amortecedor = quanto a roda sobe ÷ quanto o amortecedor comprime (ex.: 1,6). <b>0 = não informado</b>: os ângulos saem com o curso do amortecedor e ficam subestimados.</>}>
            {n('Relação roda/amortecedor diant.', 'mrF', '×', { min: 0, placeholder: '0 = não informado' })}
            {n('Relação roda/amortecedor tras.', 'mrR', '×', { min: 0, placeholder: '0 = não informado' })}
            {n('Curso total do amortecedor diant.', 'strokeF', 'mm', { min: 0 })}
            {n('Curso total do amortecedor tras.', 'strokeR', 'mm', { min: 0 })}
            {n('Massa suspensa por roda diant.', 'massF', 'kg', { min: 0 })}
            {n('Massa suspensa por roda tras.', 'massR', 'kg', { min: 0 })}
          </FieldGroup>

          <FieldGroup title="Velocidade da roda e CVT"
            sensors={['wheel', 'cvt_temp', 'car_data']}
            usedIn={['power.speedSource', 'power.tireCalibration', 'cvt.thermalModel', 'cvt.enduranceProjection']}
            note={S
              ? 'Os canais vêm do log aberto. “Automático” usa o canal achado pelo nome (entre parênteses).'
              : 'Abra um log para escolher os canais entre os dele; sem log, fica “automático” (o app procura pelo nome do canal).'}>
            <ChannelSelect label="Canal da velocidade da roda" value={car.wheelCh || ''} disabled={locked}
              firstLabel={`automático${autoWheel ? ` (${autoWheel.name})` : S ? ' (nenhum canal achado)' : ''}`}
              options={chOpts} onChange={v => setCar({ wheelCh: v })} />
            <Select label="O sensor de roda está na" size="md" allowDeselect={false} disabled={locked} style={{ gridColumn: '1 / -1' }}
              data={[{ value: '1', label: 'roda de tração (traseira / eixo)' }, { value: '0', label: 'roda livre (dianteira)' }]}
              value={car.wheelDriven ? '1' : '0'} onChange={v => setCar({ wheelDriven: v === '1' })} />
            <ChannelSelect label="Canal da temperatura da CVT" value={car.cvtCh || ''} disabled={locked}
              firstLabel={`automático${autoCvt ? ` (${autoCvt.name})` : S ? ' (nenhum canal achado)' : ''}`}
              options={chOpts} onChange={v => setCar({ cvtCh: v })} />
            {n('Temperatura ambiente', 'tAmb', '°C')}
            {n('Limite da CVT', 'tCvtMax', '°C')}
            {n('Duração do enduro', 'endurance', 'min', { min: 1 })}
          </FieldGroup>

          <FieldGroup title="Resistências e motor"
            usedIn={['power.resistances', 'power.coastDown', 'power.powerCurve', 'cvt.thermalModel']}
            note="Crr e CdA saem do coast-down (página Trem de força). B&S 10 hp ≈ 7,5 kW no motor.">
            {n('Crr (resistência ao rolamento)', 'crr', undefined, { min: 0 })}
            {n('CdA', 'cda', 'm²', { min: 0 })}
            {n('Densidade do ar', 'rho', 'kg/m³', { min: 0.5 })}
            {n('Potência do motor', 'power', 'kW', { min: 0 })}
          </FieldGroup>
        </div>
      </Section>

      <Section
        title="Opções da análise da suspensão"
        description="Como ler os potenciômetros dos amortecedores e onde procurar a frequência da carroceria. Ficam guardadas junto com o perfil do carro."
        actions={(
          <Button variant="default" size="md" leftSection={<IconRefresh size={18} />} disabled={suspLocked}
            onClick={() => setSusp({ compPos: DEFAULT_SUSP.compPos, knee: DEFAULT_SUSP.knee, moving: DEFAULT_SUSP.moving, fmin: DEFAULT_SUSP.fmin, fmax: DEFAULT_SUSP.fmax })}>
            Padrões
          </Button>
        )}
      >
        <div className="cfg-groups">
          <FieldGroup title="Amortecedores" explain="susp.velocityBands" sensors={shockChips}
            usedIn={['susp.velocityHistogram', 'susp.velocityBands', 'susp.travelHistogram', 'susp.reboundRatio']}
            note={<>A FT grava a posição do potenciômetro; se a posição <b>diminui</b> quando o amortecedor comprime, troque aqui (senão compressão e extensão saem invertidas). Lenta/rápida separa a faixa de baixa e de alta velocidade do amortecedor no histograma.</>}>
            <Select label="Compressão quando a posição" size="md" allowDeselect={false} disabled={suspLocked}
              data={[{ value: '1', label: 'aumenta' }, { value: '0', label: 'diminui' }]}
              value={susp.compPos ? '1' : '0'} onChange={v => setSusp({ compPos: v === '1' })} />
            <NumField label="Lenta / rápida" unit="mm/s" value={susp.knee || null} min={1} placeholder="100" disabled={suspLocked}
              onCommit={v => setSusp({ knee: v })} />
            <Switch size="md" style={{ gridColumn: '1 / -1' }} label="Só com o carro andando" description="histogramas sem os trechos parado (> 3 km/h)"
              disabled={suspLocked} checked={!!susp.moving} onChange={e => setSusp({ moving: e.currentTarget.checked })} />
          </FieldGroup>

          <FieldGroup title="Banda da carroceria" explain="susp.naturalFreq" sensors={shockChips}
            usedIn={['susp.naturalFreq', 'freq.spectrum', 'freq.peaks', 'freq.dropTest']}
            note="Faixa de frequência em que o app procura o pico da carroceria (modo de pulo/arfagem) no espectro e no teste de queda. Um baja fica tipicamente entre 1 e 3 Hz; acima de ~6 Hz já é a roda (massa não suspensa).">
            <NumField label="De" unit="Hz" value={susp.fmin || null} min={0} placeholder="0.6" disabled={suspLocked} onCommit={v => setSusp({ fmin: v })} />
            <NumField label="Até" unit="Hz" value={susp.fmax || null} min={0} placeholder="4.5" disabled={suspLocked} onCommit={v => setSusp({ fmax: v })} />
          </FieldGroup>
        </div>
      </Section>

      <Section
        title="O que o log aberto diz sobre o carro"
        description="Canais que entraram nas contas e o que falta medir. Cada aviso diz o sensor e o que fazer para o próximo teste."
        explain="quality.carData" sensors={['car_data']}
      >
        {ctx && veh ? (
          <Stack gap="lg">
            <div className="cfg-stats">
              <StatTile label="Velocidade do carro vem de" explain="power.speedSource" sensors={speedSensors}
                value={veh.src === 'roda' ? 'roda' : veh.src === 'GPS' ? 'GPS' : 'nenhum'}
                hint={veh.src === 'roda' ? 'sensor de roda (corrigido pelo GPS)' : veh.src === 'GPS' ? 'sem roda: mais ruído na aceleração' : 'sem roda e sem GPS'} />
              <StatTile label="Canal da roda" explain="sensor.wheel" sensors={['wheel']}
                value={veh.wheel ? veh.wheel.name : veh.wheelAny ? 'sem sinal' : 'nenhum'}
                hint={!veh.wheel && veh.wheelAny ? `${veh.wheelAny.name} ficou constante` : car.wheelCh ? 'escolhido aqui' : 'automático'} />
              <StatTile label="Correção da roda pelo GPS" explain="power.tireCalibration" sensors={['wheel', 'gps']}
                value={veh.kN ? veh.k.toFixed(4) : null} unit="×"
                hint={veh.kN ? `${veh.kN} amostras comparadas` : 'sem calibração neste log'} />
              <StatTile label="Canal da CVT" explain="cvt.source" sensors={['cvt_temp']}
                value={veh.cvt ? veh.cvt.name : veh.cvtAny ? 'sem sinal' : 'nenhum'}
                hint={!veh.cvt && veh.cvtAny ? `${veh.cvtAny.name} ficou constante` : car.cvtCh ? 'escolhido aqui' : 'automático'} />
              <StatTile label="Amortecedores com sinal" explain="susp.shocksActive" sensors={shockChips}
                value={availability ? `${shocksOn.length} de 4` : null}
                hint={shocksOn.length ? shocksOn.map(id => CORNER_OF[id]).join(', ') : 'nenhum potenciômetro com sinal'}
                status={shocksOn.length === 4 ? 'good' : shocksOn.length ? 'warn' : 'serious'}
                statusText={shocksOn.length === 4 ? 'Todos' : shocksOn.length ? 'Faltam cantos' : 'Sem suspensão'} />
              <StatTile label="Dados do carro" explain="quality.carData" sensors={['car_data']}
                value={availability?.car_data === 'present' ? 'completos' : 'incompletos'}
                status={availability?.car_data === 'present' ? 'good' : 'warn'}
                hint={availability?.car_data === 'present' ? 'massa, MR, curso e massa suspensa' : 'veja o aviso abaixo'} />
            </div>
            <IssueList issues={issues} seekLabel="Ver no gráfico"
              onSeek={t => { seek(t); nav('/canais'); }}
              empty={<Text c="dimmed">Nenhum aviso sobre o carro neste log.</Text>} />
          </Stack>
        ) : (
          <NoSessionState icon={IconRuler}
            description="Os dados do carro valem sem log. Abra uma sessão para escolher os canais da roda e da CVT entre os do log e ver quais sensores do carro mandaram sinal." />
        )}
      </Section>
    </>
  );
}
