/* Navegação da página Canais: o eixo X fixo embaixo dos painéis (rótulos só ali, como o
 * axisrow do antigo), a faixa de voltas no topo (como o RaceStudio) e a visão geral da
 * sessão inteira embaixo, com a janela visível destacada (arrastar a janela move a visão). */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router';
import { Tooltip, UnstyledButton } from '@mantine/core';
import { IconStarFilled, IconX } from '@tabler/icons-react';
import { clamp, fmtTime, niceTicks, type Channel, type Lap, type SessionContext } from '@baja/core';
import { setupCanvas, useElementSize, useExplain } from '../../components';
import type { ChartTheme } from '../../theme';
import { useSessionStore } from '../../state/session';
import { PAD_R, Y_AXIS, type ChartsCtl } from './ctl';
import { tickDecimals, type XAxisData } from './model';

/* ================================================================ eixo X */
export function AxisRow({ ctl, ax, th, laps }: { ctl: ChartsCtl; ax: XAxisData; th: ChartTheme; laps: Lap[] }) {
  const cv = useRef<HTMLCanvasElement>(null);
  /* tamanho guardado pelo ResizeObserver: o desenho roda 60×/s e não lê o layout */
  const size = useRef({ w: 0, h: 0 });
  const drawRef = useRef<() => void>(() => {});
  drawRef.current = () => {
    const c = cv.current;
    const { w: cw, h: ch } = size.current;
    if (!c || !cw) return;
    const [g, w] = setupCanvas(c, cw, ch);
    const pl = Y_AXIS, pw = w - Y_AXIS - PAD_R;
    if (pw < 20) return;
    const [a, b] = ctl.viewX();
    const X = (v: number) => pl + (v - a) / (b - a) * pw;
    g.strokeStyle = th.axis; g.lineWidth = 1;
    g.beginPath(); g.moveTo(pl, 0.5); g.lineTo(pl + pw, 0.5); g.stroke();
    const ticks = niceTicks(a, b, Math.max(2, pw / 95));
    const step = ticks.length > 1 ? ticks[1] - ticks[0] : 1, dec = tickDecimals(step);
    g.font = `12px ${th.font}`; g.fillStyle = th.text; g.textAlign = 'center';
    g.beginPath();
    ticks.forEach(tk => {
      const x = Math.round(X(tk)) + 0.5;
      if (x < pl - 1 || x > pl + pw + 1) return;
      g.moveTo(x, 0); g.lineTo(x, 5);
      if (x > pl + 16 && x < pl + pw - 16) g.fillText(tk.toFixed(dec), x, 19);
    });
    g.stroke();
    /* nome do eixo na calha do eixo Y */
    g.textAlign = 'right'; g.fillStyle = th.fg2; g.font = `600 12px ${th.font}`;
    g.fillText(ax.mode === 'dist' ? 'distância' : 'tempo', pl - 8, 17);
    g.font = `12px ${th.font}`; g.fillStyle = th.text;
    g.fillText(`(${ax.unit})`, pl - 8, 33);
    /* voltas (V1, V2... como o antigo) */
    g.textAlign = 'center'; g.fillStyle = th.fg2; g.font = `600 11.5px ${th.font}`;
    laps.forEach(l => { const x = X(ax.X[l.i0]); if (x >= pl && x <= pl + pw) g.fillText('V' + l.n, x, 36); });
    /* bandeira do cursor */
    const cx = ctl.cursorX(), x = X(cx);
    if (x >= pl - 1 && x <= pl + pw + 1) {
      const txt = ax.mode === 'dist' ? `${cx.toFixed(0)} m` : `${cx.toFixed(2)} s`;
      g.font = `600 12px ${th.font}`;
      const tw = g.measureText(txt).width + 12, bx = clamp(x - tw / 2, pl, pl + pw - tw);
      g.fillStyle = th.cursor; g.beginPath(); g.roundRect(bx, 6, tw, 18, 4); g.fill();
      g.fillRect(Math.round(x) - 1, 0, 2, 6);
      g.fillStyle = th.surface; g.fillText(txt, bx + tw / 2, 19.5);
    }
  };
  useEffect(() => {
    const draw = () => drawRef.current();
    const offV = ctl.onView(draw), offC = ctl.onCursor(draw);
    const measure = () => { const c = cv.current; if (c) { size.current = { w: c.clientWidth, h: c.clientHeight }; draw(); } };
    const ro = new ResizeObserver(measure);
    if (cv.current) ro.observe(cv.current);
    measure();
    return () => { offV(); offC(); ro.disconnect(); };
  }, [ctl]);
  useEffect(() => { drawRef.current(); }, [ax, th, laps]);
  return <canvas ref={cv} className="cn-axis" aria-label={`Eixo X: ${ax.label}`} />;
}

/* ================================================================ faixa de voltas */
export function LapStrip({ ctx, selLap, onSelect }: { ctx: SessionContext; selLap: number; onSelect: (k: number) => void }) {
  const { open } = useExplain();
  const box = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(box);
  const t = ctx.S.t, a = t.length ? t[0] : 0, b = t.length ? t[t.length - 1] : 1, span = b - a || 1;
  const laps = ctx.laps;
  const best = laps.length ? laps.reduce((k, l, i) => (l.time < laps[k].time ? i : k), 0) : -1;
  let msg: React.ReactNode = null;
  if (!ctx.track.ok) msg = <>Sem voltas: elas saem do GPS, e este log não tem trajetória.</>;
  else if (!ctx.cfg.line) msg = <>Sem voltas: defina a linha de largada na página <Link to="/mapa">Mapa</Link> (ou <Link to="/pista">Pista e GPS</Link>).</>;
  else if (!laps.length) msg = <>Nenhuma volta completa cruzando a linha de largada: ajuste a linha ou a volta mínima em <Link to="/pista">Pista e GPS</Link>.</>;
  return (
    <div className="cn-laps">
      <div className="cn-laps-gutter" style={{ width: Y_AXIS }}>
        {selLap >= 0 ? (
          <Tooltip label="Voltar para a sessão inteira">
            <UnstyledButton className="cn-laps-all" onClick={() => onSelect(-1)} aria-label="Sessão inteira">
              <IconX size={13} /> Sessão
            </UnstyledButton>
          </Tooltip>
        ) : (
          <Tooltip label="Tempos de volta: de onde saem (GPS + relógio do logger) e como usar">
            <UnstyledButton className="cn-laps-label" onClick={() => open('laps.table', { sensors: ctx.laps.length ? ['gps', 'logger'] : [], title: 'Voltas' })}>Voltas</UnstyledButton>
          </Tooltip>
        )}
      </div>
      <div ref={box} className="cn-laps-track" style={{ marginRight: PAD_R }}>
        {msg ? <span className="cn-laps-msg">{msg}</span> : laps.map((l, k) => {
          const left = (l.t0 - a) / span * 100, w = (l.t1 - l.t0) / span * 100, px = w / 100 * width;
          const label = px > 112 ? `V${l.n} · ${fmtTime(l.time)}` : px > 34 ? `V${l.n}` : px > 16 ? `${l.n}` : '';
          return (
            <Tooltip key={k} label={`Volta ${l.n} · ${fmtTime(l.time)}${k === best ? ' (melhor)' : ''} — clique para ver só ela`}>
              <UnstyledButton className="cn-lap" data-sel={k === selLap || undefined} data-best={k === best || undefined} data-odd={k % 2 === 1 || undefined}
                style={{ left: left + '%', width: w + '%' }} onClick={() => onSelect(k === selLap ? -1 : k)}
                aria-pressed={k === selLap} aria-label={`Volta ${l.n}, ${fmtTime(l.time)}`}>
                {k === best && px > 50 && <IconStarFilled size={11} aria-hidden />}
                <span>{label}</span>
              </UnstyledButton>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

/* ================================================================ visão geral */
export function Overview({ ctl, ctx, th, chan }: { ctl: ChartsCtl; ctx: SessionContext; th: ChartTheme; chan: Channel | null }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const off = useRef<HTMLCanvasElement | null>(null);
  const selLap = useSessionStore(s => s.selLap);
  const t = ctx.S.t;
  const a = t.length ? t[0] : 0, b = t.length ? t[t.length - 1] : 1, span = b - a || 1;
  const geo = useRef({ w: 0, h: 0 });

  /* camada fixa: o traço da sessão inteira (mín/máx por coluna de pixel), voltas */
  const drawStatic = useMemo(() => () => {
    const c = cv.current;
    if (!c) return;
    const w = c.clientWidth, h = c.clientHeight;
    geo.current = { w, h };
    if (!w || !h) return;
    const o = off.current ?? (off.current = document.createElement('canvas'));
    o.style.width = w + 'px'; o.style.height = h + 'px';
    const [g] = setupCanvas(o, w, h);
    g.fillStyle = th.surface; g.fillRect(0, 0, w, h);
    const pl = Y_AXIS, pw = w - Y_AXIS - PAD_R;
    const X = (tt: number) => pl + (tt - a) / span * pw;
    /* voltas */
    ctx.laps.forEach((l, k) => {
      g.fillStyle = k === selLap ? th.sel : k % 2 ? (th.dark ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.03)') : 'transparent';
      g.fillRect(X(l.t0), 0, X(l.t1) - X(l.t0), h);
      g.fillStyle = th.axis; g.fillRect(Math.round(X(l.t0)), 0, 1, h);
    });
    if (chan && chan.count > 0 && pw > 10) {
      const d = chan.data;
      let lo = chan.lo, hi = chan.hi;
      if (!(hi - lo > 1e-9)) { lo -= 1; hi += 1; }
      const T = 6, B = 6, Y = (v: number) => T + (hi - v) / (hi - lo) * (h - T - B);
      g.strokeStyle = th.series[0]; g.lineWidth = 1.25; g.beginPath();
      let col = -1, mn = 0, mx = 0, pen = false;
      const flush = () => {
        if (col < 0) return;
        if (pen) g.lineTo(col, Y(mn)); else { g.moveTo(col, Y(mn)); pen = true; }
        g.lineTo(col, Y(mx));
      };
      for (let i = 0; i < d.length; i++) {
        const v = d[i];
        if (!(v === v)) { flush(); col = -1; pen = false; continue; }
        const cx = Math.round(X(t[i]));
        if (cx !== col) { flush(); col = cx; mn = mx = v; }
        else { if (v < mn) mn = v; if (v > mx) mx = v; }
      }
      flush();
      g.stroke();
    }
    /* calha: rótulo */
    g.fillStyle = th.surface; g.fillRect(0, 0, pl - 2, h);
    g.fillStyle = th.fg2; g.font = `600 12px ${th.font}`; g.textAlign = 'right';
    g.fillText('sessão', pl - 8, h / 2 - 2);
    g.fillStyle = th.text; g.font = `12px ${th.font}`;
    g.fillText(fmtTime(span), pl - 8, h / 2 + 13);
  }, [th, ctx, chan, selLap, a, span, t]);

  /* camada de cima: janela visível e cursor */
  const drawRef = useRef<() => void>(() => {});
  drawRef.current = () => {
    const c = cv.current, o = off.current;
    if (!c || !o) return;
    const { w, h } = geo.current;
    if (!w || !h) return;
    const [g] = setupCanvas(c, w, h);
    g.drawImage(o, 0, 0, w, h);
    const pl = Y_AXIS, pw = w - Y_AXIS - PAD_R;
    const X = (tt: number) => pl + (tt - a) / span * pw;
    const v = useSessionStore.getState().view;
    if (v) {
      const x0 = X(v[0]), x1 = X(v[1]);
      g.fillStyle = th.dark ? 'rgba(0,0,0,.45)' : 'rgba(255,255,255,.6)';
      g.fillRect(pl, 0, Math.max(0, x0 - pl), h);
      g.fillRect(x1, 0, Math.max(0, pl + pw - x1), h);
      g.strokeStyle = th.series[0]; g.lineWidth = 2;
      g.strokeRect(x0, 1, Math.max(2, x1 - x0), h - 2);
      /* alças */
      g.fillStyle = th.series[0];
      g.fillRect(x0 - 2, h / 2 - 9, 4, 18); g.fillRect(x1 - 2, h / 2 - 9, 4, 18);
    }
    const cx = Math.round(X(useSessionStore.getState().cursor));
    g.fillStyle = th.cursor; g.fillRect(cx - 1, 0, 2, h);
  };

  useLayoutEffect(() => {
    const c = cv.current;
    if (!c) return;
    const redraw = () => { drawStatic(); drawRef.current(); };
    redraw();
    const ro = new ResizeObserver(redraw);
    ro.observe(c);
    return () => ro.disconnect();
  }, [drawStatic]);
  useEffect(() => {
    const d = () => drawRef.current();
    const offV = ctl.onView(d), offC = ctl.onCursor(d);
    return () => { offV(); offC(); };
  }, [ctl]);

  /* arrastar: mover a janela, mudar as bordas ou desenhar uma janela nova */
  const tAt = (clientX: number) => {
    const r = cv.current!.getBoundingClientRect();
    const pw = r.width - Y_AXIS - PAD_R;
    return clamp(a + (clientX - r.left - Y_AXIS) / (pw || 1) * span, a, b);
  };
  const pxPerS = () => { const r = cv.current!.getBoundingClientRect(); return (r.width - Y_AXIS - PAD_R) / span; };
  const hit = (clientX: number): 'move' | 'l' | 'r' | null => {
    const v = useSessionStore.getState().view;
    if (!v) return null;
    const r = cv.current!.getBoundingClientRect(), k = pxPerS();
    const x = clientX - r.left - Y_AXIS, x0 = (v[0] - a) * k, x1 = (v[1] - a) * k;
    if (Math.abs(x - x0) <= 7) return 'l';
    if (Math.abs(x - x1) <= 7) return 'r';
    if (x > x0 && x < x1) return 'move';
    return null;
  };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const st = useSessionStore.getState();
    const mode = hit(e.clientX), t0 = tAt(e.clientX), v0 = st.view;
    const el = e.currentTarget;
    try { el.setPointerCapture(e.pointerId); } catch { /* ponteiro sintético */ }
    let moved = false;
    const x0 = e.clientX;
    const mv = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - x0) > 3) moved = true;
      if (!moved) return;
      const tc = tAt(ev.clientX);
      if (mode === 'move' && v0) { const d = tc - t0; st.setView([v0[0] + d, v0[1] + d]); }
      else if (mode === 'l' && v0) st.setView([Math.min(tc, v0[1] - 0.2), v0[1]]);
      else if (mode === 'r' && v0) st.setView([v0[0], Math.max(tc, v0[0] + 0.2)]);
      else st.setView([Math.min(t0, tc), Math.max(t0, tc)]);
    };
    const end = () => {
      el.removeEventListener('pointermove', mv);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      if (!moved) ctl.goTo(t0);
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.buttons) return;
    const m = hit(e.clientX);
    e.currentTarget.style.cursor = m === 'l' || m === 'r' ? 'ew-resize' : m === 'move' ? 'grab' : 'crosshair';
  };

  return (
    <canvas ref={cv} className="cn-overview" onPointerDown={onDown} onPointerMove={onMove}
      onDoubleClick={() => ctl.reset()}
      title={`Visão geral da sessão inteira: ${chan ? chan.name + (chan.unit ? ` (${chan.unit})` : "") : "sem canal"}. Arraste a janela para mover a visão, fora dela para escolher um trecho; clique = ir ao ponto; duplo clique = tudo`}
      aria-label="Visão geral da sessão: arraste a janela para mover a visão, arraste fora dela para escolher um trecho, clique para ir ao ponto" />
  );
}
