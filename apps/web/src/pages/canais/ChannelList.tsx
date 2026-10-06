/* Lista de canais (coluna da esquerda): busca, canais agrupados (grupos do ctx.all, os
 * constantes no fim, recolhidos), e em cada linha a cor, o nome, o valor no cursor e a
 * unidade (como a tabela "Agora" do antigo). Clique = mostrar/ocultar (painel novo no fim);
 * arrastar para um painel = sobrepor. Passando o mouse: mínimo e máximo no trecho com
 * "ir ao ponto" (padrão do UltraLog), sensores e o card de explicação. */
import { memo, useMemo, useState } from 'react';
import { ActionIcon, Button, Group, HoverCard, ScrollArea, Stack, Text, TextInput, Tooltip, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconEye, IconEyeOff, IconHelpCircle, IconMapPin, IconSearch } from '@tabler/icons-react';
import { fmtVal, type Channel, type SessionContext } from '@baja/core';
import { InfoButton, SensorChips } from '../../components';
import { useRange } from '../../state/session';
import type { ChartsCtl } from './ctl';
import { extremes, fold, type ChannelInfo } from './model';
import { endDrag, startDrag } from './dnd';
import { channelExplain } from './ChannelPanel';

interface Group_ { name: string; chans: Channel[]; constant: boolean }

interface Props {
  ctx: SessionContext;
  info: ChannelInfo;
  ctl: ChartsCtl;
  /** cor de cada canal mostrado (do painel onde está) */
  colors: Map<string, string>;
  onToggle: (key: string) => void;
}

/* card do mouse: faixa no trecho e "ir ao ponto" */
function ChannelCard({ c, info, ctl, shown, onToggle }: { c: Channel; info: ChannelInfo; ctl: ChartsCtl; shown: boolean; onToggle: () => void }) {
  const rng = useRange();
  const t = ctl.t;
  const [i0, i1, label] = rng ?? [0, t.length - 1, 'sessão inteira'];
  const e = useMemo(() => extremes(c.data, i0, i1), [c, i0, i1]);
  const dec = info.dec(c.key);
  const sensors = info.sensors(c.key);
  const go = (i: number) => { if (i >= 0) ctl.goTo(t[i]); };
  return (
    <Stack gap={8}>
      <Group justify="space-between" wrap="nowrap" align="flex-start" gap={6}>
        <div style={{ minWidth: 0 }}>
          <Text fw={650} size="md" style={{ wordBreak: 'break-word' }}>{c.name}</Text>
          <Text size="xs" c="dimmed">{c.group}{c.unit ? ` · ${c.unit}` : ''} · <span className="cn-mono">{c.key}</span></Text>
        </div>
        <InfoButton explain={channelExplain(info, c.key)} sensors={sensors} title={c.name} />
      </Group>
      <SensorChips sensors={sensors} size="sm" />
      {c.count === 0 ? (
        <Text size="sm" c="dimmed">Nenhuma amostra válida neste log: o canal existe, mas veio vazio.</Text>
      ) : c.constant ? (
        <Text size="sm">Constante em <b>{fmtVal(c.lo, dec)} {c.unit}</b> no log inteiro: sem variação (sensor sem sinal ou desligado?).</Text>
      ) : e.n === 0 ? (
        <Text size="sm" c="dimmed">Sem dados no trecho ({label}).</Text>
      ) : (
        <>
          <Text size="sm" c="dimmed">No trecho: {label}</Text>
          <div className="cn-ext">
            <span>mín</span><b className="bt-num">{fmtVal(e.lo, dec)} {c.unit}</b>
            <span className="bt-num cn-ext-t">t {t[e.iLo].toFixed(2)} s</span>
            <Button size="compact-sm" variant="light" leftSection={<IconMapPin size={14} />} onClick={() => go(e.iLo)}>Ir ao ponto</Button>
            <span>máx</span><b className="bt-num">{fmtVal(e.hi, dec)} {c.unit}</b>
            <span className="bt-num cn-ext-t">t {t[e.iHi].toFixed(2)} s</span>
            <Button size="compact-sm" variant="light" leftSection={<IconMapPin size={14} />} onClick={() => go(e.iHi)}>Ir ao ponto</Button>
          </div>
        </>
      )}
      <Button size="xs" variant="default" leftSection={shown ? <IconEyeOff size={14} /> : <IconEye size={14} />} onClick={onToggle}>
        {shown ? 'Ocultar dos painéis' : 'Mostrar num painel novo'}
      </Button>
    </Stack>
  );
}

const Row = memo(function Row({ c, info, ctl, color, onToggle }: { c: Channel; info: ChannelInfo; ctl: ChartsCtl; color: string | undefined; onToggle: (k: string) => void }) {
  const shown = color !== undefined;
  return (
    <HoverCard position="right-start" openDelay={450} closeDelay={120} width={330} shadow="md" withinPortal offset={10}>
      <HoverCard.Target>
        <div
          className="cn-row" data-on={shown || undefined} data-const={c.constant || undefined}
          role="button" tabIndex={0} draggable
          aria-pressed={shown} aria-label={`${c.name}: ${shown ? 'ocultar' : 'mostrar'}`}
          onClick={() => onToggle(c.key)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(c.key); } }}
          onDragStart={e => startDrag(e, c.key)} onDragEnd={endDrag}
        >
          <i className="cn-swatch cn-swatch--row" style={color ? { background: color, borderColor: color } : undefined} aria-hidden />
          <span className="cn-row-name">{c.name}</span>
          <span className="cn-row-val bt-num" ref={el => (el ? ctl.bindValue(el, c.key) : undefined)} />
          <span className="cn-row-unit">{c.unit}</span>
        </div>
      </HoverCard.Target>
      <HoverCard.Dropdown>
        <ChannelCard c={c} info={info} ctl={ctl} shown={shown} onToggle={() => onToggle(c.key)} />
      </HoverCard.Dropdown>
    </HoverCard>
  );
});

export function ChannelList({ ctx, info, ctl, colors, onToggle }: Props) {
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<Record<string, boolean>>({ Constantes: true });
  const groups = useMemo<Group_[]>(() => {
    const out: Group_[] = [];
    const by = new Map<string, Group_>();
    ctx.all.forEach(c => {
      const name = c.constant ? 'Constantes' : (c.group || 'Do log');
      let g = by.get(name);
      if (!g) { g = { name, chans: [], constant: c.constant }; by.set(name, g); if (!c.constant) out.push(g); }
      g.chans.push(c);
    });
    const k = by.get('Constantes');
    if (k) out.push(k);
    return out;
  }, [ctx]);
  const fq = fold(q.trim());
  const shownCount = ctx.all.filter(c => colors.has(c.key)).length;

  return (
    <div className="cn-list">
      <div className="cn-list-head">
        <Group gap={4} wrap="nowrap">
          <Text fw={650} size="md">Canais</Text>
          <Tooltip label="Clique = mostrar/ocultar (painel novo no fim) · arraste para um painel = sobrepor · passe o mouse = mínimo e máximo no trecho, com “ir ao ponto”" multiline maw={300}>
            <ActionIcon variant="subtle" color="gray" size="sm" aria-label="Como usar a lista de canais"><IconHelpCircle size={16} /></ActionIcon>
          </Tooltip>
        </Group>
        <Text size="sm" c="dimmed">{shownCount} de {ctx.all.length} nos painéis</Text>
      </div>
      <TextInput
        value={q} onChange={e => setQ(e.currentTarget.value)} placeholder="Buscar canal…" size="sm"
        leftSection={<IconSearch size={16} />} aria-label="Buscar canal" mx={10} mb={6}
      />
      <ScrollArea className="cn-list-scroll" type="auto" offsetScrollbars>
        {groups.map(g => {
          const list = fq ? g.chans.filter(c => fold(c.name).includes(fq) || fold(c.key).includes(fq)) : g.chans;
          if (!list.length) return null;
          const isClosed = !fq && !!closed[g.name];
          return (
            <div key={g.name} className="cn-group">
              <UnstyledButton className="cn-group-head" onClick={() => setClosed(s => ({ ...s, [g.name]: !isClosed }))} aria-expanded={!isClosed}>
                {isClosed ? <IconChevronRight size={15} /> : <IconChevronDown size={15} />}
                <span>{g.name}</span>
                <span className="cn-group-n">{list.length}</span>
              </UnstyledButton>
              {!isClosed && list.map(c => <Row key={c.key} c={c} info={info} ctl={ctl} color={colors.get(c.key)} onToggle={onToggle} />)}
            </div>
          );
        })}
        {fq && !groups.some(g => g.chans.some(c => fold(c.name).includes(fq) || fold(c.key).includes(fq))) && (
          <Text size="sm" c="dimmed" p="md">Nenhum canal com “{q}”.</Text>
        )}
      </ScrollArea>
    </div>
  );
}
