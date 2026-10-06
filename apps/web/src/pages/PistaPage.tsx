/* Página /pista — Pista e GPS (diálogo #cfgDlg de legacy/index.html + cfgFill/cfgInfo/cfgRead
 * de legacy/js/app.js): centro e tamanho da pista do track_config.h, canais X/Y/status,
 * formato, trocar X↔Y, suavização, volta mínima, nota da calibração das entradas 7/8 da FT,
 * "Valores do track_config.h" e um mini-mapa para conferir e desenhar a linha de largada.
 * Perfis de pista por cima (um por pista: "Pista da faculdade", "Pista da competição"). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Group, List, Paper, Select, Stack, Switch, Text } from '@mantine/core';
import {
  IconArrowsExchange, IconPencil, IconRefresh, IconRoute, IconSparkles, IconTrash,
} from '@tabler/icons-react';
import {
  DEFAULT_CFG, FMT_LABEL, autoLine, spanOf, trackConfigInfo,
  type QualityIssue, type TrackConfig,
} from '@baja/core';
import {
  ChartCard, InfoButton, NoSessionState, PageHeader, Section, StatTile, TrackMap, type MapSource, type TrackMapHandle,
} from '../components';
import { routeByPath } from '../routes';
import { useActiveProfiles, useProfiles } from '../state/profiles';
import { useCtx, useCursorEffect, useSessionStore } from '../state/session';
import { useDataQuality } from '../state/heavy';
import { ProfileManager } from './config/ProfileManager';
import { ChannelSelect, FieldGroup, IssueList, NumField, useProfilePerms } from './config/parts';

const ONE = new Float64Array([0]);   /* sem sessão: o mapa mostra só a grade e a área */
const isGpsIssue = (q: QualityIssue) => /^gps\./.test(q.id) || (!!q.channel && q.sensors.includes('gps'));

/** Configuração da pista em uso com os padrões (o que normalizeConfig faz com a pista). */
function useTrackCfg(): TrackConfig {
  const draft = useProfiles(s => s.draft.track);
  const demoLine = useProfiles(s => s.demoLine);
  const demo = useSessionStore(s => !!s.S?.demo);
  const cfg = useSessionStore(s => s.cfg);
  return useMemo(() => {
    const c = { ...DEFAULT_CFG, ...draft } as TrackConfig;
    if (demo) c.line = demoLine;
    /* canais X/Y/status: os efetivos da sessão (adivinhados quando os salvos não existem no log) */
    if (cfg) { c.chX = cfg.chX; c.chY = cfg.chY; c.chStatus = cfg.chStatus; }
    return c;
  }, [draft, demoLine, demo, cfg]);
}

export default function PistaPage() {
  const r = routeByPath('/pista')!;
  const cfg = useTrackCfg();
  const ctx = useCtx();
  const S = useSessionStore(s => s.S);
  const busy = useSessionStore(s => s.busy);
  const updateConfig = useSessionStore(s => s.updateConfig);
  const setLine = useSessionStore(s => s.setLine);
  const seek = useSessionStore(s => s.seek);
  const { track: activeTrack } = useActiveProfiles();
  const perms = useProfilePerms();
  const locked = !!activeTrack && !perms.canEdit(activeTrack);
  const bm = !!S?.gps;          /* BUSMASTER: posição direto da lat/lon, sem canais X/Y */

  const set = (p: Partial<TrackConfig>) => updateConfig(p);

  /* textos do diálogo antigo (cfgInfo): vão, resolução, de onde vem a posição, calibração */
  const info = useMemo(() => trackConfigInfo({ S, cfg, track: ctx?.track ?? null }), [S, cfg, ctx]);
  const quality = useDataQuality();
  const issues = useMemo(() => (quality ? quality.issues.filter(isGpsIssue) : []), [quality]);

  const chOpts = useMemo(() => (S ? S.channels.map(c => ({ value: c.key, label: c.name })) : []), [S]);

  /* ---------------------------------------------------------------- mini-mapa */
  const mapRef = useRef<TrackMapHandle>(null);
  const [lineMode, setLineMode] = useState(false);
  const [sat, setSat] = useState(false);
  const line = ctx ? ctx.cfg.line : cfg.line;
  const span = useMemo(() => spanOf(cfg), [cfg]);
  const source: MapSource = useMemo(() => ({
    t: ctx ? ctx.S.t : ONE,
    track: ctx ? ctx.track : null,
    hasLatLon: !!ctx?.S.gps,
    span,
    laps: ctx?.laps,
    selLap: -1,
    line,
    cursor: useSessionStore.getState().cursor,
    onSeek: t => seek(t),
    onLineDrawn: pts => { setLine(pts); setLineMode(false); },
  }), [ctx, span, line, seek, setLine]);
  useCursorEffect(t => mapRef.current?.setCursor(t));
  /* sem sessão, reenquadra a área quando o tamanho muda (com sessão o TrackMap já reenquadra
   * quando a trajetória muda) */
  useEffect(() => { if (!ctx) mapRef.current?.fit(); }, [ctx, span]);

  const trackOk = !!ctx?.track.ok;
  const auto = () => {
    if (!ctx || !ctx.track.ok) return;
    const l = autoLine(ctx.S, ctx.track);
    if (l) setLine(l);
  };
  /* linha do exemplo fica na memória: pode mexer mesmo com um perfil travado */
  const lineLocked = locked && !ctx?.S.demo;
  const canAuto = trackOk && !!ctx && ctx.track.ok && !!autoLine(ctx.S, ctx.track);

  const fmtText = ctx?.track.fmt ? FMT_LABEL[ctx.track.fmt] : bm ? 'lat/lon (BUSMASTER)' : null;

  return (
    <>
      <PageHeader title={r.label} subtitle={r.question} explain="track.gpsPosition" sensors={['gps']}
        actions={busy ? <Text c="dimmed" size="sm">Recalculando a sessão…</Text> : undefined} />

      <Section title="Perfil da pista" explain="track.profile" sensors={['gps']}
        description="Um perfil por pista, com os números do track_config.h gravado no PIC. As sessões guardadas lembram a pista usada; escolher um perfil copia os números para cá e recalcula a sessão aberta.">
        <ProfileManager kind="track" explain="track.gpsPosition" />
      </Section>

      <Section title="Números do track_config.h e canais"
        explain="track.gpsPosition" sensors={['gps']}
        description={<>Use os mesmos números do <code>track_config.h</code> gravado no PIC.</>}
        actions={(
          <Button variant="default" size="md" leftSection={<IconRefresh size={18} />} disabled={locked}
            onClick={() => set({
              lat0: DEFAULT_CFG.lat0, lon0: DEFAULT_CFG.lon0, centerFixed: DEFAULT_CFG.centerFixed,
              sizeX: DEFAULT_CFG.sizeX, sizeY: DEFAULT_CFG.sizeY, margin: DEFAULT_CFG.margin,
              fmt: DEFAULT_CFG.fmt, smooth: DEFAULT_CFG.smooth, minLap: DEFAULT_CFG.minLap,
            })}>
            Valores do track_config.h
          </Button>
        )}
      >
        <div className="cfg-groups">
          <FieldGroup title="Centro da pista" explain="track.gpsPosition" sensors={['gps']}
            usedIn={['track.gpsPosition', 'chart.trackMap']}
            note={<>O centro dá o fundo de satélite e a conversão para lat/lon. Com o centro <b>automático</b> o PIC usa o primeiro fix como centro e o vão é o dobro do tamanho (o carro pode ligar na borda da pista).</>}>
            <NumField label="Latitude" unit="°" value={cfg.lat0} min={-90} max={90} disabled={locked} onCommit={v => set({ lat0: v })} />
            <NumField label="Longitude" unit="°" value={cfg.lon0} min={-180} max={180} disabled={locked} onCommit={v => set({ lon0: v })} />
            <Switch size="md" disabled={locked} checked={!!cfg.centerFixed} onChange={e => set({ centerFixed: e.currentTarget.checked })}
              label={<>Centro fixo pelas coordenadas</>} description={<code>TRACK_CENTER_FIXED 1</code>} style={{ gridColumn: '1 / -1' }} />
          </FieldGroup>

          <FieldGroup title="Tamanho" explain="track.gpsPosition" sensors={['gps']}
            usedIn={['quality.gpsBorder', 'track.gpsPosition']}
            note={<>{info.resolution.text}</>}>
            <NumField label="Pista X · Leste-Oeste" unit="m" value={cfg.sizeX} min={1} max={100000} disabled={locked} onCommit={v => set({ sizeX: v })} />
            <NumField label="Pista Y · Norte-Sul" unit="m" value={cfg.sizeY} min={1} max={100000} disabled={locked} onCommit={v => set({ sizeY: v })} />
            <NumField label="Margem de cada lado" unit="m" value={cfg.margin} min={0} max={100000} disabled={locked} onCommit={v => set({ margin: v })} />
          </FieldGroup>

          <FieldGroup title="Canais no log da FT" explain="channel.gps_code" sensors={['gps']}
            usedIn={['quality.gpsCalibration', 'channel.gps_xy']}
            actions={(
              <Button variant="default" size="sm" leftSection={<IconArrowsExchange size={16} />} disabled={bm || locked || !S}
                onClick={() => set({ chX: cfg.chY, chY: cfg.chX })}>
                Trocar X ↔ Y
              </Button>
            )}
            note={bm
              ? 'Log do BUSMASTER: a posição vem direto da latitude/longitude do módulo GPS (0x028); os canais e o formato não se aplicam.'
              : <>{info.source || (S ? '' : 'Abra um log para escolher os canais entre os dele; sem log, o app procura X/Y pelo nome (Back_pressure / O2_General na FT).')}</>}>
            <ChannelSelect label="X · Leste (entrada 7)" value={cfg.chX || ''} options={chOpts} firstLabel="— escolha —"
              disabled={bm || locked} onChange={v => set({ chX: v })} />
            <ChannelSelect label="Y · Norte (entrada 8)" value={cfg.chY || ''} options={chOpts} firstLabel="— escolha —"
              disabled={bm || locked} onChange={v => set({ chY: v })} />
            <ChannelSelect label="Status do GPS (opcional)" value={cfg.chStatus || ''} options={chOpts} firstLabel="— nenhum —"
              disabled={bm || locked} onChange={v => set({ chStatus: v })} />
            <Select label="Valor gravado" size="md" allowDeselect={false} disabled={bm || locked}
              data={[
                { value: 'auto', label: 'automático' }, { value: 'V', label: 'volts 0–5' }, { value: 'mV', label: 'mV 0–5000' },
                { value: 'code', label: 'código 0–255' }, { value: 'm', label: 'metros' },
              ]}
              value={cfg.fmt} onChange={v => set({ fmt: (v ?? 'auto') as TrackConfig['fmt'] })} />
          </FieldGroup>

          <FieldGroup title="Processamento" explain="track.gpsPosition" sensors={['gps']}
            usedIn={['channel.gps_speed', 'laps.lapTimes', 'laps.delta']}
            note="A suavização é uma média móvel da posição reconstruída (os degraus de ~0,86 m do código 0–255): mais suave = velocidade e raio com menos ruído, mas curvas fechadas um pouco “cortadas”. Volta mínima evita contar duas voltas quando o carro cruza a linha duas vezes seguidas.">
            <NumField label="Suavização da posição" unit="s" value={cfg.smooth} min={0} max={3} disabled={locked} onCommit={v => set({ smooth: v })} />
            <NumField label="Volta mínima" unit="s" value={cfg.minLap} min={1} disabled={locked} onCommit={v => set({ minLap: v })} />
          </FieldGroup>
        </div>

        <Paper withBorder radius="md" p="lg" mt="lg">
          <Group gap={6} wrap="nowrap" mb={6}>
            <Text fw={650}>{info.calibration.title}</Text>
            <InfoButton explain={info.calibration.explain} sensors={info.calibration.sensors} title="Calibração das entradas 7 e 8" />
          </Group>
          <List spacing={6} size="md">
            {info.calibration.items.map((it, k) => <List.Item key={k}>{it}</List.Item>)}
          </List>
        </Paper>
      </Section>

      <Section title="Prévia e linha de largada" explain="track.startLine" sensors={['gps']}
        description="Confira se o traçado cai dentro da área dos códigos (retângulo tracejado) e ponha a linha de largada: as voltas, o delta e a comparação entre voltas dependem dela. Clique na pista para ir àquele ponto do log.">
        <div className="cfg-map-layout">
          <ChartCard title="Mini-mapa da pista" explain="chart.miniMap" sensors={['gps']} flush
            subtitle={ctx ? (trackOk ? 'Arraste para mover, roda = zoom, duplo clique = enquadrar, clique na pista = ir àquele ponto.' : undefined) : 'Sem sessão: só a área coberta pelos códigos 0–255.'}
            footer={lineMode ? 'Clique em dois pontos, um de cada lado da pista, cruzando o traçado.' : line ? `Linha de largada: (${line[0].x}, ${line[0].y}) → (${line[1].x}, ${line[1].y}) m${ctx?.S.demo ? ' — do exemplo (só na memória)' : ''}.` : 'Sem linha de largada: sem voltas.'}
          >
            <Group gap="xs" wrap="wrap" px="md" pb="sm">
              <Text fw={600} mr={4}>Linha de largada:</Text>
              <Button size="sm" variant={lineMode ? 'filled' : 'default'} leftSection={<IconPencil size={16} />}
                disabled={lineLocked} onClick={() => setLineMode(m => !m)}>
                {lineMode ? 'Cancelar o desenho' : 'Desenhar (2 cliques)'}
              </Button>
              <Button size="sm" variant="default" leftSection={<IconSparkles size={16} />} disabled={!canAuto || lineLocked}
                title={canAuto ? 'Linha perpendicular ao primeiro trecho acima de 8 km/h' : 'Precisa de uma trajetória com o carro andando acima de 8 km/h'}
                onClick={auto}>
                Automática
              </Button>
              <Button size="sm" variant="default" color="red" leftSection={<IconTrash size={16} />} disabled={!line || lineLocked}
                onClick={() => setLine(null)}>
                Apagar
              </Button>
            </Group>
            <div style={{ position: 'relative' }}>
              <TrackMap ref={mapRef} source={source} height={460} satellite={sat} onSatelliteChange={setSat}
                lineMode={lineMode} onLineModeChange={setLineMode} />
              {ctx && !ctx.track.ok && (
                <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', padding: 16 }}>
                  <Paper withBorder radius="md" p="md" maw={440} style={{ pointerEvents: 'auto' }}>
                    <Text fw={650} mb={4}>Sem trajetória neste log</Text>
                    <Text size="sm" c="dimmed">{ctx.track.msg}</Text>
                    <Text size="sm" mt={6}>
                      {bm
                        ? 'O módulo GPS não teve fix 3D: grave com céu aberto e espere o fix antes de sair (quadro 0x023).'
                        : 'Confira os canais X/Y (entradas 7 e 8) e o formato acima. Sem GPS não há mapa, voltas, aceleração lateral nem calibração da roda.'}
                    </Text>
                  </Paper>
                </div>
              )}
            </div>
          </ChartCard>

          <Stack gap="md">
            <div className="cfg-stats">
              <StatTile label="Voltas" explain="laps.lapTimes" sensors={['gps']}
                value={ctx ? ctx.laps.length : null}
                hint={!ctx ? 'abra uma sessão' : !line ? 'sem linha de largada' : `volta mínima ${cfg.minLap} s`} />
              <StatTile label="Vão coberto" explain={info.resolution.explain} sensors={info.resolution.sensors}
                value={`${info.span.x} × ${info.span.y}`} unit="m"
                hint={cfg.centerFixed ? 'centro fixo' : 'centro automático (dobro)'} />
              <StatTile label="Resolução por passo" explain={info.resolution.explain} sensors={info.resolution.sensors}
                value={`${info.stepX.toFixed(1)} × ${info.stepY.toFixed(1)}`} unit="cm" hint="X × Y (vão ÷ 255)" />
              <StatTile label="GPS na borda da área" explain="quality.gpsBorder" sensors={['gps']}
                value={quality?.gpsBorderPct ?? null} decimals={1} unit="%"
                status={quality?.gpsBorderPct == null ? undefined : quality.gpsBorderPct > 1 ? 'warn' : 'good'}
                hint={quality?.gpsBorderPct == null ? (ctx ? 'sem trajetória' : 'abra uma sessão') : 'do tempo com posição'} />
              <StatTile label="Atualização da posição" explain="quality.sampleRate" sensors={['gps', 'logger']}
                value={quality && isFinite(quality.gpsUpdateHz) ? quality.gpsUpdateHz : null} decimals={1} unit="Hz"
                status={quality && isFinite(quality.gpsUpdateHz) ? (quality.gpsUpdateHz < 3 ? 'warn' : 'good') : undefined}
                hint={bm ? 'lat/lon do 0x028' : 'o módulo manda 4 Hz'} />
              <StatTile label="Formato lido" explain="quality.gpsCalibration" sensors={['gps']}
                value={fmtText} hint={cfg.fmt === 'auto' ? 'detectado automaticamente' : 'escolhido aqui'} />
            </div>
          </Stack>
        </div>
      </Section>

      <Section title="O que o log aberto diz sobre o GPS" explain="track.gpsPosition" sensors={['gps']}
        description="Avisos da posição: canais, formato, borda da área, taxa e GPS parado. Cada aviso diz o que mudar no track_config.h, na FT ou no próximo teste.">
        {ctx ? (
          <IssueList issues={issues} onSeek={t => seek(t)} seekLabel="Ver no mapa"
            empty={<Alert color="green" variant="light" title="Nenhum aviso do GPS">A posição deste log está dentro da área e atualizando normalmente.</Alert>} />
        ) : (
          <NoSessionState icon={IconRoute}
            description="A configuração da pista vale sem log. Abra uma sessão para escolher os canais X/Y entre os do log, conferir o traçado no mapa e pôr a linha de largada." />
        )}
      </Section>
    </>
  );
}
