/* Limpeza da trajetória do GPS (gpsclean.ts, novo): no exemplo limpo nada sai; com os
 * defeitos vistos nos logs de 14/10 injetados (centro "sem posição" do PIC, borda, salto,
 * passagem única longe do centro), cada um sai com o motivo certo e a velocidade fica no
 * limite. Desligada, a trajetória é a do app antigo. */
import { describe, it, expect } from 'vitest';
import { parseCSV, finishChannel } from '../src/parsers';
import { demoCSV as demoCSVSim, DEMO_SIM_V1, DEMO_CAR_V1 as DEMO_CAR } from '../src/demo';
import { computeSession } from '../src/pipeline';
import { computeTrack } from '../src/gps';
import { dataQuality } from '../src/quality';
import { gpsCleanOpts, GPS_CLEAN_DEFAULT } from '../src/gpsclean';
import { getExplain } from '../src/explain';
import { idxAt } from '../src/util';

const BASE = parseCSV(demoCSVSim(DEMO_SIM_V1), 'exemplo.csv');
const demo = () => ({ ...BASE, channels: BASE.channels.map(c => ({ ...c, data: Float64Array.from(c.data) })) });
const RES = 220 / 255;                                   /* área padrão: 200 m + 2 × 10 m */
const volts = (m: number) => (m / RES + 127.5) / 51;     /* metros → volts como o PIC manda */
const meters = (v: number) => (v * 51 - 127.5) * RES;
const maxOf = (a: ArrayLike<number>) => { let m = -Infinity; for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m; };

/* o exemplo com os defeitos dos logs reais */
function broken() {
  const S = demo(), t = S.t;
  const X = S.channels.find(c => c.key === 'Back_pressure')!, Y = S.channels.find(c => c.key === 'O2_General')!;
  const at = (s: number) => idxAt(t, s);
  /* acha um instante andando longe do centro (> 25 m) para os saltos ficarem grandes */
  let k0 = at(40);
  while (k0 < t.length && Math.hypot(meters(X.data[k0]), meters(Y.data[k0])) < 25) k0++;
  const t0 = t[k0];
  /* sem posição do PIC: 2,51 V nos dois eixos por 1,5 s */
  for (let i = at(t0); i <= at(t0 + 1.5); i++) { X.data[i] = 2.51; Y.data[i] = 2.51; }
  /* borda: X travado em 5 V por 3 s */
  for (let i = at(t0 + 20); i <= at(t0 + 23); i++) X.data[i] = 5;
  /* salto: 0,2 s 60 m para o lado (para dentro: o PIC nunca passa de 5 V) */
  for (let i = at(t0 + 40); i <= at(t0 + 40.2); i++) X.data[i] = volts(meters(X.data[i]) - 60);
  /* passagem única longe: vai a (80, −80) m e volta em 16 s, a ~14 m/s */
  const a = at(t0 + 60), b = at(t0 + 76);
  const P = { x: meters(X.data[a]), y: meters(Y.data[a]) }, R = { x: meters(X.data[b]), y: meters(Y.data[b]) }, Q = { x: 80, y: -80 };
  for (let i = a; i <= b; i++) {
    const u = (t[i] - t[a]) / (t[b] - t[a]), [p, q, w] = u < 0.5 ? [P, Q, u * 2] : [Q, R, u * 2 - 1];
    X.data[i] = volts(p.x + (q.x - p.x) * w); Y.data[i] = volts(p.y + (q.y - p.y) * w);
  }
  finishChannel(X); finishChannel(Y);
  return { S, t0, far: [a, b] as [number, number] };
}

describe('limpeza do GPS', () => {
  it('opções: padrão e campos da pista', () => {
    expect(gpsCleanOpts({})).toEqual(GPS_CLEAN_DEFAULT);
    expect(gpsCleanOpts({ gpsVmax: 60, gpsCore: 30, gpsMinPasses: 3 })).toEqual({ vmax: 60, core: 30, minPasses: 3 });
    expect(gpsCleanOpts({ gpsVmax: 0, gpsCore: -1, gpsMinPasses: 0 })).toEqual(GPS_CLEAN_DEFAULT);
    expect(getExplain('track.gpsClean')).toBeDefined();
  });

  it('exemplo limpo: não tira nada e a trajetória é a mesma do antigo', () => {
    const S = demo();
    const on = computeSession(S, { car: DEMO_CAR }, { autoLine: true }), off = computeSession(S, { car: DEMO_CAR, gpsClean: false }, { autoLine: true });
    expect(on.gpsClean!.removed).toBe(0);
    expect(off.gpsClean).toBeUndefined();
    expect(Array.from(on.track.ok ? on.track.speed : [])).toEqual(Array.from(off.track.ok ? off.track.speed : []));
    expect(on.laps.length).toBe(off.laps.length);
  });

  it('com os defeitos dos logs reais: cada um sai com o motivo e a velocidade fica no limite', () => {
    const { S, far } = broken();
    const raw = computeTrack(S, computeSession(S, { gpsClean: false }).cfg);
    expect(raw.ok && maxOf(raw.speed)).toBeGreaterThan(150);          /* sem limpeza: absurdo */
    const ctx = computeSession(S, { car: DEMO_CAR }, { autoLine: true });
    const r = ctx.gpsClean!;
    expect(r.counts.edge).toBeGreaterThan(50);                         /* 3 s × 25 Hz */
    expect(r.counts.noPos).toBeGreaterThan(30);                        /* 1,5 s */
    expect(r.counts.jump).toBeGreaterThan(0);
    expect(r.counts.once).toBeGreaterThan(50);
    expect(r.breaks).toBeGreaterThan(0);
    expect(r.vmaxRaw).toBeGreaterThan(150);
    expect(r.vmax).toBeLessThanOrEqual(GPS_CLEAN_DEFAULT.vmax);
    expect(ctx.track.ok && maxOf(ctx.track.speed)).toBeLessThanOrEqual(GPS_CLEAN_DEFAULT.vmax);
    /* da passagem única só fica o que coincide com a pista (onde o carro passou nas voltas):
     * nada perto da ponta (80, −80) m, por onde ele passou uma vez só */
    const tr = ctx.track;
    if (!tr.ok) throw new Error('sem trajetória');
    let kept = 0;
    for (let i = far[0]; i <= far[1]; i++) if (tr.valid[i]) { kept++; expect(Math.hypot(tr.x[i] - 80, tr.y[i] + 80)).toBeGreaterThan(25); }
    expect(kept).toBeLessThan((far[1] - far[0]) / 2);
    /* a maior parte do log continua (só tira o que tem motivo) */
    expect(r.pct).toBeLessThan(10);
    /* a qualidade avisa o que saiu e continua avisando da borda */
    const q = dataQuality(S, ctx);
    expect(q.issues.find(i => i.id === 'gps.clean')!.text).toMatch(/limpeza do GPS tirou/);
    expect(q.issues.find(i => i.id === 'gps.border')).toBeDefined();
  });

  it('desligada (gpsClean: false): posições todas, como o app antigo', () => {
    const { S } = broken();
    const ctx = computeSession(S, { car: DEMO_CAR, gpsClean: false });
    expect(ctx.gpsClean).toBeUndefined();
    expect(ctx.track.ok && maxOf(ctx.track.speed)).toBeGreaterThan(150);
  });

  it('centro exato a que o carro chega andando (sem salto) fica', () => {
    const S = demo(), t = S.t;
    const X = S.channels.find(c => c.key === 'Back_pressure')!, Y = S.channels.find(c => c.key === 'O2_General')!;
    /* o log inteiro parado no centro: não há salto, é o carro mesmo */
    const n = idxAt(t, 5);
    const P = { ...S, t: t.slice(0, n), channels: S.channels.map(c => ({ ...c, data: c.data.slice(0, n) })) };
    for (const c of P.channels) if (c.key === X.key || c.key === Y.key) c.data.fill(2.51);
    const ctx = computeSession(P, {});
    expect(ctx.gpsClean!.counts.noPos).toBe(0);
  });
});
