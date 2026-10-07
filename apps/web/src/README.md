# apps/web/src — guia para quem escreve as páginas

Contrato completo: `docs/ARQUITETURA.md` seção 4. Resumo do que já existe:

## Estrutura

| Pasta/arquivo | O que é |
|---|---|
| `main.tsx`, `App.tsx` | entrada; MantineProvider (tema escuro padrão), Notifications, LibraryProvider, ExplainProvider, HashRouter |
| `routes.tsx` | **registro único** das páginas: `path`, `label`, ícone, `group`, `needsSession`, `serverOnly`, `player`, `question` (frase do subtítulo) e componente lazy. Página nova = uma linha aqui + `pages/<Nome>Page.tsx` com `export default` |
| `pages/` | uma página por rota (placeholders "em construção" até alguém preencher). `#/dev/componentes` é a vitrine |
| `layout/` | `AppLayout` (AppShell: barra lateral 260 px, cabeçalho 60 px, rodapé 64 px nas rotas com `player`; liga os atalhos do play), `NavMenu`, `SessionChip` (sessão aberta + menu trocar/fechar; no celular também o trecho), `RangeControl` (Sessão/Volta/Janela + volta), `PlayerBar` (play, velocidade, barra de tempo com voltas, repetir), `HeaderParts` (modo da biblioteca, tema) |
| `components/` | componentes compartilhados (abaixo); importe de `../components` |
| `theme.ts` | tema Mantine + tokens dos gráficos (`useChartTheme`, `resolveColor`, cores dos cantos e status) |
| `state/` | `session.ts` (store da sessão, play, trecho, hooks), `heavy.ts` (contas pesadas com log grande, qualidade dos dados), `profiles.ts` (perfis de carro/pista, configuração em uso, fórmulas), `hotkeys.ts`, `SessionSync.tsx` (biblioteca → perfis; disponibilidade dos sensores → chips; `?exemplo` na URL), `librarySave.ts` (guardar log com resumo), `reopen.ts` (lembrar/reabrir a última sessão da biblioteca), `useSaveOpenSession.ts` ("Guardar na biblioteca" a sessão aberta sem salvar) |
| `explain/` | `ExplainHost` (monta o contexto de explicação) e `ExplainDrawer` (o card) |
| `state/prefs.ts` | preferências (tema, servidor, layouts da página Canais, menu recolhido, última sessão e "reabrir ao abrir o app"); `lsGet/lsSet` com try/catch |
| `library/` | biblioteca local (IndexedDB) e remota (API 5.3); `useLibrary()`; `storage.ts` (espaço usado/disponível, `persist()`, erro de falta de espaço com mensagem clara); `detect.ts` (no build estático `VITE_STATIC=1` não procura `/api` na mesma origem; `/api/info` com `localMode` na mesma origem = modo "este computador", ganha até de um servidor salvo) |
| `styles/global.css` | CSS global (tokens `--bt-*`, cartões, chips, tooltips) |

## Regras das páginas

- Comece com `<PageHeader title=… subtitle={route.question} />` (use `routeByPath('/x')`).
- Sem sessão: `<NoSessionState icon description="o que a página mostra" />` (carregando, e os mesmos três caminhos em
  todas as páginas: dados de exemplo, abrir arquivo, sessões da biblioteca). Sem sensor: `<EmptyState title="…"
  description="o que falta e o que medir" />` (description pode ter chips/listas: vira `<div>`). Nunca tela em branco.
- Seções com `<Section title="…" description="…" explain sensors>` (título 18 px, 40 px entre seções; com `explain` o
  título abre o card e os chips dos sensores aparecem ao lado; `className` extra, ex.: `bt-print-hide`).
- **Todo gráfico** dentro de `<ChartCard title explain sensors>`; **todo número** em `<StatTile label value unit explain sensors status>`.
  `explain` é o id do catálogo `EXPLAIN` do core; `sensors` são os `SensorId` que **de fato** entraram na conta nesta sessão
  (vêm dos relatórios do core). O título e o ⓘ abrem o card (`useExplain().open(id, { sensors })`).
- Gráficos com no mínimo 240 px de altura (XYPlot padrão 280). Um eixo Y por gráfico.
- Textos em português do Brasil; números com `toFixed` como no app antigo (ponto decimal).

## Componentes

- **`XYPlot`** (`spec`, `height`, `ref`): porte do `BT.Plot` com o mesmo spec (`series`, `bars`, `points`, `markers`, `hlines`,
  `circles`, `xLabel`, `yLabel`, `logY`, `equal`, `xRange`, `yRange`, `zeroY`, `hi`, `onClick`, `tipX`, `tipBar`, `fmtY`, `empty`, `legend`).
  Cor opcional: série sem `color` usa `id`/`role` (`FL FR RL RR`, `cmp`, `ref`, `pos`, `neg`, `muted`, `fg`, `c1..c8`, `good/warn/serious/crit`)
  e depois o slot pela ordem. `tipX`/`tipBar` devolvem HTML: passe textos do usuário por `esc()`.
  Ponto atual sem re-render: `ref.current.setHi({x, y})`; marcadores: `ref.current.update({ markers })`.
- **`TrackMap`** (`source: MapSource`, `satellite`, `follow`, `lineMode`, `onLegend`, `ref`): porte do `BT.MapView`.
  `MapSource` = `{ t, track, hasLatLon?, span?, range? | laps+selLap, colorValues?, colorRange?, line?, cursor?, tipHtml?, onSeek?, onLineDrawn? }`.
  Cursor 60×/s: `ref.current.setCursor(t)` (só a camada do carro). `fit()`, `invalidate()`, `zoom(f)`.
  Legenda: `<MapLegend lo hi dark unit decimals={decimalsFor(c.lo, c.hi)} />` com o que vier de `onLegend`.
  `onLineDrawn` recebe os pontos crus: arredonde como o antigo (`+p.x.toFixed(2)`).
- **`UPlotChart`** (`data`, `series`, `syncKey`, `xLabel`, `yLabel`, `onCursor`, `onZoom`, `onClick`, `plugins`, `ref`): uPlot com tema
  (série com `stroke` usa essa cor; callbacks lidos a cada evento; `plugins` somados aos ganchos internos);
  `ref.current.setCursorTime(t)` move a linha do play sem redesenhar; `setXRange`, `resetX`, `getPlot`.
- **`reportSpec(plot, { onClick?, extra? })`**: o único conversor de gráfico de relatório do core (`RepPlot` do trem de força, CVT,
  dinâmica, voltas, mapas e `SuspPlot` da suspensão/ressonância) para o spec do `XYPlot`: papel → cor do tema (`comp`→`pos`,
  `fit`→`c2`...), RepFmt → tooltip, `onClick` = ir ao ponto. Não escreva outro: use este (a página Voltas, `RepChart` de
  `pages/veiculo` e `PlotCard` de `pages/suspensao` já usam).
- **`downloadText(nome, texto, tipo?)`** (CSV da ficha, backup, log original), **`RangeBadge`** (rótulo do trecho no cabeçalho
  das páginas de análise), **`ComputingState`** (aviso "Calculando…" de log grande, ver `useComputed`),
  **`PageErrorBoundary`** (no `AppLayout`, em volta da página: erro ao desenhar mostra a mensagem na página e o menu continua;
  trocar de página/sessão tenta de novo).
- **`ChartCard`**, **`StatTile`**, **`SensorChips`** (estado `present/absent/planned` por `availability` ou pelo
  `SensorAvailabilityProvider`; rótulos provisórios em `SENSOR_LABELS` até o catálogo `SENSORS` do core),
  **`PageHeader`**, **`Section`**, **`EmptyState`**, **`DataTable`** (`columns`, `rows`, `onRowClick`, `selected`, `maxHeight`; `numeric` alinha à direita).
- **`InfoButton`**, **`ExplainProvider`** (`onExplain`), **`useExplain`**.

## Tema e cores

- `useChartTheme()` devolve as cores do esquema atual para canvas (`surface`, `grid`, `axis`, `text`, `fg`, `cursor`,
  `series[0..7]`, `corner.FL..RR`, `status`, `pos`, `neg`). Nunca leia CSS no canvas.
- Paleta das séries com ordem fixa (slot 1 azul = FL / volta comparada / série única, 2 laranja = FR / referência, 3 água = RL,
  4 amarelo = RR...). Status sempre com ícone + texto. Pista colorida com `heat()` do core.
- No HTML use as variáveis do Mantine (`--mantine-color-dimmed`...) e as `--bt-*` de `styles/global.css`.

## Estado da sessão (`state/session.ts`)

`useSessionStore` (zustand) é o objeto `A` do app antigo. Campos: `status` ('empty' | 'loading' | 'ready' | 'error'),
`error`, `loadingText`, `busy` (recalculando), `source` ({ type: 'file'|'text'|'demo'|'library', name, libraryId?, meta? }),
`S`, `ctx` (SessionContext do core), `cfg` (= ctx.cfg), `availability` (sensorAvailability(ctx)), `cursor` (s),
`playing`, `speed`, `loop`, `selLap` (-1 = nenhuma), `rangeMode` ('session'|'lap'|'view'), `view` ([t0, t1] da janela dos
gráficos; null = sessão inteira), `follow` (janela acompanha o cursor no play), `colorKey` (canal do mapa), `xAxis` ('time'|'dist').

Ações (todas em `useSessionStore.getState()` ou por seletor):

| ação | o que faz |
|---|---|
| `openFile(file, { saveTo?: lib })` | lê, calcula e (opcional) guarda na biblioteca com o resumo. Devolve `true` se abriu |
| `openText(text, name, source?)` / `openDemo()` / `openFromLibrary(meta, lib?, { silent? })` | idem (exemplo = carro DEMO_CAR + linha automática; da biblioteca ativa os perfis carro/pista da sessão e lembra o id para reabrir ao carregar o app; `silent` = sem aviso de erro) |
| `saveToLibrary(lib?)` | guarda na biblioteca a sessão aberta sem salvar com o texto já carregado (`unsavedText`); a sessão passa a ser da biblioteca sem reabrir. Devolve `{ meta, duplicate }` ou null; sem espaço lança `LocalQuotaError` (use `storageErrorMessage(e)`). Chamado de novo enquanto guarda: a mesma promessa (`savingToLibrary` = guardando; use `useSaveOpenSession`) |
| `close()` | fecha a sessão; se for a última sessão lembrada da biblioteca, esquece (não reabre ao carregar o app). Fechar o exemplo ou um log sem salvar não mexe na memória |
| `updateConfig(patch)` | muda pista/carro/susp/fórmulas (`AnalysisConfigInput`) e recalcula; mantém cursor e volta. Com o exemplo aberto o carro e a linha vão para a memória (não estragam o carro real) |
| `setLine(pts \| null)` | linha de largada (arredonda a 2 casas, zera a volta, recalcula) — use no `onLineDrawn` do TrackMap |
| `seek(t)`, `play()`, `pause()`, `togglePlay()`, `setSpeed(x)`, `setLoop(b)` | player (um único laço rAF; o play fica na volta selecionada) |
| `setLap(k)` | selectLap do antigo: janela na volta ±2 % e cursor no começo; `-1` = sessão. Depois de um recálculo a volta selecionada continua só se a mesma volta (mesmas amostras) existir — o índice pode mudar; se sumir, a janela que estava nela volta para a sessão (`keepLap`). Abrir outra sessão volta o trecho "Volta" para "Sessão" |
| `setRangeMode(m)`, `setView([t0, t1] \| null)`, `resetView()`, `zoomView(f, tc?)`, `setFollow(b)` | trecho e janela dos gráficos (mín. 0,2 s, dentro da sessão) |
| `setColorKey(k)`, `setXAxis(x)` | canal do mapa, eixo da página Canais |

Hooks:

- `useSessionReady()`, `useHasSession()`, `useCtx()`.
- `useRange()` → `[i0, i1, rótulo] | null` (rangeOf do core). Mesmo trecho = o mesmo array (a janela dos gráficos só entra no
  trecho "Janela"). Relatórios: `useComputed(() => xReport(ctx, i0, i1), [ctx, i0, i1])` (state/heavy.ts): igual ao `useMemo`
  com log pequeno; com log grande (> `BIG_LOG` = 50 mil amostras) devolve `null` primeiro e a página mostra
  `<ComputingState what="…" />`, e só depois de pintar o aviso roda a conta (sem isso a aba congelava segundos sem aviso).
- `useQuality()` / `useDataQuality()` (state/heavy.ts): `dataQuality` do core calculado uma vez por sessão e compartilhado pelas
  páginas (null enquanto um log grande calcula).
- `useCursorEffect((t, state) => ref.current?.setCursor(t))` — gráficos e mapa, 60×/s **sem re-render**.
- `useCursorTime()` / `useCursorIndex()` — textos e tabelas (limitado a ~20×/s no play).
- `window.__baja.session` / `.profiles` no `npm run dev`, para depurar no console.

Atalhos globais (state/hotkeys.ts, ligados no AppLayout): espaço, ← → (Shift = 1 s), Home, End — só nas páginas com a barra
de reprodução (`player` em routes.tsx; nas outras o espaço/Home/End rolam a página); ignorados em campos, menus, no card de
explicação aberto e quando um elemento da página já usou a tecla (`preventDefault`, ex.: espaço numa linha da lista de canais).

## Sessão de exemplo pela URL

`?exemplo` (ou `?exemplo=1`) antes do `#` ou na rota abre a sessão de exemplo ao carregar o app, na página pedida — para
apresentar aos juízes e para as capturas de tela: `https://…/#/canais?exemplo=1`, `https://…/?exemplo#/ressonancia`.
`exemplo=0` não abre. Só vale ao carregar a página e com nada aberto (`wantsDemoFromUrl` em state/SessionSync.tsx).

## Reabrir a última sessão

Abrir da biblioteca (ou guardar a sessão aberta) lembra o id nas preferências, com a biblioteca (`'local'` ou
`'remote:<endereço>'`). Ao carregar o app, depois dos perfis, com nada aberto e sem `?exemplo`, `LibrarySync` reabre em
silêncio (`planReopen` + `reopenLastSession` em state/reopen.ts; no servidor só depois do login; sessão apagada → esquece).
`close()` da sessão lembrada esquece (fechar o exemplo não). Opção em Preferências → Logs neste navegador.

## Perfis e configuração (`state/profiles.ts`)

`useProfiles`: `cars`, `tracks` (da biblioteca ativa), `activeCarId`, `activeTrackId` (lembrados neste navegador), `draft`
(a configuração em uso = o `cfg` que o antigo guardava: `{ track, car, susp }`), `carDirty`/`trackDirty`, `formulas`.
Ações: `setActiveCar(id|null)` / `setActiveTrack(id|null)` (copia o perfil para o draft e recalcula),
`saveCarProfile(lib, nome?)` / `saveTrackProfile(lib, nome?)` (grava o draft; sem nome = no perfil ativo),
`deleteCarProfile`, `deleteTrackProfile`, `setFormulas(list)`, `resetCar(demo)`. Para editar números use
`useSessionStore.getState().updateConfig(patch)` (vale com ou sem sessão aberta). Os valores efetivos (padrões aplicados)
estão em `ctx.cfg`; `useActiveProfiles()` dá os objetos dos perfis ativos.

## Cards de explicação

`useExplain().open(id, { sensors, title })` abre o card (explain/ExplainDrawer.tsx) com o catálogo `EXPLAIN` do core:
o que mostra, sensores (com estado neste log), como é calculado, **para o carro do ano que vem**, limitações, teste e
"veja também". `ChartCard`, `StatTile`, `PageHeader`, `Section` e `InfoButton` já chamam isso; os chips de sensor abrem
o card `sensor.<id>`. Id fora do catálogo mostra um aviso com o id: é o sinal para escrever o card em
`packages/core/src/explain.ts`. `#/dev/componentes` tem um botão por card do catálogo.

## Biblioteca

- `usePrefs()` para tema/servidor/layouts. `useLibrary()` → `{ lib, mode, user, remote, info, offline, pc, dataDir, redetect, recheck, logout, bump, version }`.
  `lib` implementa `Library` (ARQUITETURA 4.4); `remote` tem login, conta e equipe (só no modo servidor).
- Modo **este computador** (`pc` em `useLibrary()`, o atalho da área de trabalho: servidor com `LOCAL_MODE` na mesma
  origem, ARQUITETURA 5.4, docs/NO-MEU-PC.md): `mode` é `'remote'`, mas sem contas — `RemoteLibrary.localMode` não manda
  token e um 401 não chama `onUnauthorized`; `user` é o `info.user` de `/api/info`, já conectado (`logout`/`setUser(null)`
  não fazem nada); `dataDir` é a pasta dos logs no disco. A interface esconde login/cadastro/senha/sair (`#/login` volta
  para `#/`), a Equipe vira uma explicação, o selo vira "Este computador", Preferências mostra "Onde ficam os logs" (sem a
  proteção do armazenamento do navegador) e Sessões o aviso "Biblioteca deste computador — os logs ficam em …". Reabrir a
  última sessão vale igual (chave `remote:`). **Servidor do PC parou** com o app aberto: um pedido que não chega
  (`RemoteLibrary.onConnection(false)`; a mensagem de erro manda clicar no atalho) liga `offline`, o selo vira "Servidor
  parado" e `layout/PcServerLost.tsx` mostra o aviso fixo no topo de todas as páginas; enquanto isso pergunta `/api/info` a
  cada 3 s e, quando volta, desliga `offline`, faz `bump()` e avisa (com a janela visível confere também a cada 15 s;
  `recheck()` pergunta na hora). O `PageErrorBoundary` reconhece o código de página que não baixou (chunk ou o CSS dele) e
  pede para recarregar em vez de culpar o log. Testes em `test/pc-mode.test.tsx`.
- Guardar um log: `addLogToLibrary(lib, fileOuTexto, meta?, ctx?)` (state/librarySave.ts) — no modo local calcula `kind` e o
  resumo (`sessionSummary` do core, quando existir) e marca os perfis ativos como carro/pista; depois chame `bump()`.
