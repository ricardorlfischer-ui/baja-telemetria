/* Blocos grandes da Visão geral: os números do resumo da sessão (sessionSummary do core),
 * cada um com o card de explicação e os sensores que entraram na conta. Quando o número não
 * sai neste log, o bloco diz o que falta (qual sensor ou ajuste) em vez de ficar só "—". */
import { SimpleGrid } from '@mantine/core';
import { fmtTime, type DesignReport, type SessionContext, type SessionSummary, type SummaryMetric } from '@baja/core';
import { StatTile } from '../../components';

export interface TilesProps {
  ctx: SessionContext;
  summary: SessionSummary;
  design: DesignReport;
  /** rótulo do trecho (rangeOf) */
  rangeLabel: string;
  /** o trecho é a sessão inteira */
  whole: boolean;
}

const CORNERS = ['FL', 'FR', 'RL', 'RR'] as const;
const has = (m: SummaryMetric | undefined): m is SummaryMetric & { value: number } => !!m && m.value !== null && isFinite(m.value);

export function Tiles({ ctx, summary, design, rangeLabel, whole }: TilesProps) {
  const get = (k: string) => summary.metrics.find(x => x.key === k);
  const sessionHint = whole ? 'sessão inteira' : 'sessão inteira (não depende do trecho)';
  const rangeHint = whole ? 'sessão inteira' : `no trecho: ${rangeLabel}`;
  const trackOk = !!ctx.track && ctx.track.ok;
  const anyShock = !!ctx.susp && ctx.susp.shocks.some(k => k.pos !== null);
  const shocks = design.facts.shocks;

  /* ---- duração, distância */
  const dur = get('session.duration');
  const dist = get('session.distance');
  const distKm = has(dist) && dist.value >= 1000;

  /* ---- voltas */
  const laps = get('session.laps');
  const best = get('session.bestLap');
  const bestLap = has(best) ? ctx.laps.find(l => l.time === best.value) : undefined;
  const lapMissing = !trackOk
    ? 'precisa da trajetória do GPS'
    : !ctx.cfg.line ? 'defina a linha de largada no Mapa'
      : 'nenhuma volta completa cruzando a linha';

  /* ---- velocidade, CVT */
  const vmax = get('session.vmax');
  const cvt = get('cvt.tmax');

  /* ---- curso máximo usado: o canto que mais usou */
  let travel = undefined as SummaryMetric | undefined, travelCorner = '';
  for (const id of CORNERS) {
    const m = get(`susp.travel.${id}`);
    if (has(m) && (!has(travel) || m.value > travel.value)) { travel = m; travelCorner = id; }
  }
  const axle = travelCorner ? design.facts.axle[travelCorner[0] as 'F' | 'R'] : undefined;
  const pctTxt = axle && axle.pct !== null && isFinite(axle.pct) ? ` · ${axle.pct.toFixed(0)} % do curso do eixo` : '';
  const shockNote = shocks.length && shocks.length < 4 ? ` · só ${shocks.join(', ')} com sinal (${shocks.length} de 4)` : '';

  /* ---- saltos */
  const jumps = get('susp.jumps');
  const air = get('susp.jumpAirMax');
  const h = get('susp.jumpHeightMax');

  return (
    <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="lg" verticalSpacing="lg">
      <StatTile label="Duração" value={has(dur) ? fmtTime(dur.value) : null} hint={sessionHint}
        explain={dur?.explain ?? 'design.duration'} sensors={dur?.sensors} />
      <StatTile label="Distância" value={has(dist) ? (distKm ? (dist.value / 1000).toFixed(2) : dist.text) : null} unit={distKm ? 'km' : 'm'}
        hint={has(dist) ? `${sessionHint} · ${dist.sensors.includes('gps') ? 'pelo GPS' : 'pela roda'}` : 'precisa do GPS ou do sensor da roda'}
        explain={dist?.explain ?? 'track.distance'} sensors={dist?.sensors} />
      <StatTile label="Voltas" value={has(laps) ? laps.text : null}
        hint={has(laps) && laps.value > 0 ? sessionHint : lapMissing}
        explain={laps?.explain ?? 'laps.lapTimes'} sensors={laps?.sensors} />
      <StatTile label="Melhor volta" value={has(best) ? fmtTime(best.value) : null}
        hint={has(best) ? (bestLap ? `volta ${bestLap.n} · ${bestLap.vavg.toFixed(1)} km/h de média` : sessionHint) : lapMissing}
        explain={best?.explain ?? 'laps.lapTimes'} sensors={best?.sensors} />
      <StatTile label="Velocidade máxima" value={has(vmax) ? vmax.text : null} unit="km/h"
        hint={has(vmax) ? rangeHint : 'precisa do GPS ou do sensor da roda'}
        explain={vmax?.explain ?? 'power.vmax'} sensors={vmax?.sensors} />
      <StatTile label="Temperatura máx. da CVT" value={has(cvt) ? cvt.text : null} unit="°C"
        hint={has(cvt) ? rangeHint : 'sem sensor de temperatura da CVT neste log'}
        explain={cvt?.explain ?? 'cvt.maxTemp'} sensors={cvt?.sensors} />
      <StatTile label="Curso máximo usado" value={has(travel) ? travel.text : null} unit="mm"
        hint={has(travel)
          ? `no ${travelCorner}${pctTxt}${shockNote}${travel.value < 1 ? ' · menos de 1 mm: parece só ruído do sensor' : ''} · ${rangeHint}`
          : anyShock ? 'os amortecedores não tiveram sinal (constantes): confira cabos e calibração' : 'precisa dos potenciômetros dos amortecedores'}
        explain={travel?.explain ?? 'susp.travelUsed'} sensors={travel?.sensors} />
      <StatTile label="Saltos" value={has(jumps) ? jumps.text : null}
        hint={has(jumps)
          ? (jumps.value > 0 && has(air) ? `maior: ${air.text} ms no ar${has(h) ? `, ~${h.text} cm` : ''} · ${rangeHint}` : rangeHint)
          : 'precisa dos amortecedores com sinal e da velocidade (GPS ou roda)'}
        explain={jumps?.explain ?? 'susp.jumps'} sensors={jumps?.sensors} />
    </SimpleGrid>
  );
}
