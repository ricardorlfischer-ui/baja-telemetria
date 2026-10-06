/* Barra de reprodução (rodapé, 64 px) das páginas Visão geral, Canais, Mapa e Voltas
 * (docs/ARQUITETURA.md 4.2), como o player do app antigo: ⏮ −1 s ▶/❚❚ +1 s, velocidade
 * 0,25×–16×, barra de tempo com as voltas marcadas, tempo atual / total e repetir.
 * Atalhos (state/hotkeys.ts): espaço, ← → (Shift = 1 s), Home, End.
 *
 * A barra de tempo e o texto do tempo são atualizados direto no DOM a cada mudança do cursor
 * (60×/s no play), sem re-render do React. */
import { useEffect, useMemo, useRef } from 'react';
import { ActionIcon, Group, Select, Tooltip } from '@mantine/core';
import { IconPlayerPauseFilled, IconPlayerPlayFilled, IconPlayerSkipBack, IconRepeat } from '@tabler/icons-react';
import { clamp, fmtTime } from '@baja/core';
import { useSessionStore } from '../state/session';
import './session.css';

const SPEEDS = ['0.25', '0.5', '1', '2', '4', '8', '16'];

/** Barra de tempo: sessão inteira, voltas marcadas (a selecionada em destaque), cursor. */
function ScrubBar() {
  const S = useSessionStore(s => s.S);
  const ctx = useSessionStore(s => s.ctx);
  const selLap = useSessionStore(s => s.selLap);
  const seek = useSessionStore(s => s.seek);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const a = S && S.t.length ? S.t[0] : 0, b = S && S.t.length ? S.t[S.t.length - 1] : 1;
  const span = b - a || 1;

  /* posição do cursor sem re-render */
  useEffect(() => {
    const place = (cur: number) => {
      const p = clamp((cur - a) / span, 0, 1) * 100;
      if (fillRef.current) fillRef.current.style.width = p + '%';
      if (thumbRef.current) thumbRef.current.style.left = p + '%';
      if (barRef.current) {
        barRef.current.setAttribute('aria-valuenow', cur.toFixed(2));
        barRef.current.setAttribute('aria-valuetext', fmtTime(cur - a));
      }
    };
    place(useSessionStore.getState().cursor);
    return useSessionStore.subscribe((s, p) => { if (s.cursor !== p.cursor) place(s.cursor); });
  }, [a, span]);

  const tAt = (clientX: number) => {
    const r = barRef.current!.getBoundingClientRect();
    return a + clamp((clientX - r.left) / (r.width || 1), 0, 1) * span;
  };

  const laps = ctx?.laps ?? [];
  const bands = useMemo(() => laps.map((l, k) => ({
    k, n: l.n, left: ((l.t0 - a) / span) * 100, width: ((l.t1 - l.t0) / span) * 100, time: l.time,
  })), [laps, a, span]);

  return (
    <div
      ref={barRef} className="bt-scrub" role="slider" tabIndex={0} aria-label="Posição no log"
      aria-valuemin={a} aria-valuemax={b} data-disabled={!S || undefined}
      onPointerDown={e => {
        if (!S) return;
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        seek(tAt(e.clientX));
      }}
      onPointerMove={e => { if (dragging.current) seek(tAt(e.clientX)); }}
      onPointerUp={() => { dragging.current = false; }}
      onPointerCancel={() => { dragging.current = false; }}
    >
      <div className="bt-scrub-track">
        {bands.map(L => (
          <div key={L.k} className="bt-scrub-lap" data-sel={L.k === selLap || undefined} data-odd={L.k % 2 === 1 || undefined}
            style={{ left: L.left + '%', width: L.width + '%' }} title={`Volta ${L.n} · ${fmtTime(L.time)}`}>
            {L.width > 4 && <span>{L.n}</span>}
          </div>
        ))}
        <div ref={fillRef} className="bt-scrub-fill" />
      </div>
      <div ref={thumbRef} className="bt-scrub-thumb" />
    </div>
  );
}

/** Tempo atual / total, atualizado direto no DOM. */
function TimeText() {
  const S = useSessionStore(s => s.S);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!S || !S.t.length) { if (ref.current) ref.current.textContent = '0:00.00 / 0:00.00'; return; }
    const b = S.t[S.t.length - 1];
    const put = (cur: number) => { if (ref.current) ref.current.textContent = `${fmtTime(cur)} / ${fmtTime(b)}`; };
    put(useSessionStore.getState().cursor);
    return useSessionStore.subscribe((s, p) => { if (s.cursor !== p.cursor) put(s.cursor); });
  }, [S]);
  return <span ref={ref} className="bt-player-time bt-num" />;
}

export function PlayerBar() {
  const S = useSessionStore(s => s.S);
  const ready = useSessionStore(s => s.status === 'ready' && s.S !== null);
  const playing = useSessionStore(s => s.playing);
  const speed = useSessionStore(s => s.speed);
  const loop = useSessionStore(s => s.loop);
  const st = useSessionStore.getState;
  const off = !ready;

  /* começo do trecho do play (volta selecionada ou sessão) */
  const toStart = () => {
    const s = st();
    if (!s.S) return;
    const l = s.selLap >= 0 && s.ctx ? s.ctx.laps[s.selLap] : undefined;
    s.seek(l ? l.t0 : s.S.t[0]);
  };

  return (
    <Group h="100%" px="md" gap="sm" wrap="nowrap" className="bt-player">
      <Tooltip label="Início (Home)">
        <ActionIcon variant="subtle" color="gray" size="lg" disabled={off} aria-label="Ir para o início" onClick={toStart}>
          <IconPlayerSkipBack size={18} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="−1 s (Shift + ←)">
        <ActionIcon variant="subtle" color="gray" size="lg" disabled={off} aria-label="Voltar 1 segundo" onClick={() => st().seek(st().cursor - 1)}
          className="bt-player-step" visibleFrom="xs">−1s</ActionIcon>
      </Tooltip>
      <Tooltip label="Play / pausa (espaço)">
        <ActionIcon variant="filled" size="xl" radius="xl" disabled={off} aria-label={playing ? 'Pausar' : 'Play'}
          onClick={() => st().togglePlay()}>
          {playing ? <IconPlayerPauseFilled size={20} /> : <IconPlayerPlayFilled size={20} />}
        </ActionIcon>
      </Tooltip>
      <Tooltip label="+1 s (Shift + →)">
        <ActionIcon variant="subtle" color="gray" size="lg" disabled={off} aria-label="Avançar 1 segundo" onClick={() => st().seek(st().cursor + 1)}
          className="bt-player-step" visibleFrom="xs">+1s</ActionIcon>
      </Tooltip>
      <Select
        size="xs" w={92} disabled={off} aria-label="Velocidade de reprodução" allowDeselect={false} visibleFrom="sm"
        value={String(speed)} onChange={v => v && st().setSpeed(+v)} comboboxProps={{ withinPortal: true }}
        data={SPEEDS.map(v => ({ value: v, label: v.replace('.', ',') + '×' }))}
      />
      <div style={{ flex: 1, minWidth: 60 }}>{S ? <ScrubBar /> : <div className="bt-scrub" data-disabled />}</div>
      <TimeText />
      <Tooltip label={loop ? 'Repetir: ligado' : 'Repetir: desligado'}>
        <ActionIcon variant={loop ? 'light' : 'subtle'} color={loop ? 'brand' : 'gray'} size="lg" disabled={off}
          aria-label="Repetir" aria-pressed={loop} onClick={() => st().setLoop(!loop)}>
          <IconRepeat size={18} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}
