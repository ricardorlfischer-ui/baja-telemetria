# Arquitetura — Telemetria da Mauá Racing Baja (v2)

Este documento é o contrato do projeto: quem mexe no código (pessoa ou agente) segue o que
está aqui. Mudou alguma decisão? Atualize este arquivo no mesmo commit.

## 1. Objetivo

Transformar os logs do carro (CSV do FT Manager da FT450 e log CAN do BUSMASTER) em gráficos
e números que ajudem a **projetar o carro do ano que vem**, num app que a equipe inteira
acessa.

Princípios, em ordem de prioridade:

1. **Os números não mudam.** Toda conta do app antigo (`legacy/js`) foi validada com um
   modelo físico (tabela no `legacy/README.md`). A versão nova usa exatamente as mesmas
   contas, portadas para TypeScript em `packages/core`, e testes de equivalência comparam
   cada resultado com o do app antigo rodando no Node (`packages/core/test/legacy.ts`).
2. **Uma coisa por página, grande e legível.** Nada de painéis empilhados e minúsculos:
   cada parte do projeto tem a sua página, com gráficos de pelo menos 240 px de altura,
   fonte base de 15–16 px e espaço entre as seções.
3. **Funciona sem internet na pista.** O log abre e é analisado inteiro no navegador. O
   servidor é a biblioteca da equipe (guardar, compartilhar, comparar), não um requisito.
4. **Tudo em português do Brasil** na interface. Números com ponto decimal como no app
   antigo (`toFixed`), unidades SI (km/h para velocidade de carro).

## 2. Repositório

```
packages/core/     @baja/core   cálculos puros em TypeScript (sem DOM, sem Node): roda no navegador e no servidor
apps/web/          @baja/web    interface React + Mantine + uPlot (Vite)
apps/server/       @baja/server servidor Fastify + SQLite: contas, sessões, carros, pistas, anotações
legacy/            app antigo, intocado — referência dos testes de equivalência
samples/           logs reais grandes e firmware do PIC (fora do git)
docs/              esta arquitetura, guia de uso e de implantação
.github/workflows/ CI (tipos, testes, build), imagem Docker (GHCR) e GitHub Pages
```

npm workspaces, Node ≥ 22.12, TypeScript 5.9 estrito. Comandos na raiz: `npm run dev`
(servidor + web), `npm run build`, `npm run typecheck`, `npm test`.

Em desenvolvimento (`npm run dev:web`), `/__fixtures/` lista e `/__fixtures/<nome>` devolve
os logs de `packages/core/test/fixtures` e `samples/`, e `window.__baja.session` é o estado
da sessão: dá para abrir um log real no navegador com
`window.__baja.session.getState().openText(await (await fetch('/__fixtures/ft_log3_shocks_compact.csv')).text(), 'ft_log3_shocks_compact.csv')`.

**Dependências:** não instale pacotes novos sem necessidade real; se precisar, use
`npm install -w <pacote>` uma vez e registre aqui o porquê.

## 3. `@baja/core`

### 3.1 Regras

- **Puro:** nada de `window`, `document`, `localStorage`, `fs`, `process`. `lib: ES2023`,
  sem `types`. Saídas são dados (objetos, `Float64Array`, `Uint8Array`), nunca HTML.
- **Porte fiel:** cada `BT.nome` do app antigo vira `export function nome` (ou `const`)
  com o mesmo nome, mesmos parâmetros, mesma ordem de operações. Não "melhore" fórmulas,
  limiares, arredondamentos, `|| ` vs `??`, `v === v` (teste de NaN), `>> 1`, `| 0`,
  `toFixed`. Tipos podem ser adicionados à vontade; o comportamento não muda.
- **Comentários em português**, como no código antigo (mantenha os comentários de física).
- **Testes de equivalência obrigatórios** (`packages/core/test/*.test.ts`, Vitest): para
  cada função portada, rodar a antiga (`loadLegacy()`) e a nova nos mesmos dados e comparar
  com `same()` de `test/compare.ts` (tolerância relativa 1e-9). Dados: sessão de exemplo
  (`BT.demoCSV()` / `legacyDemo`), `ft_log3_gps.csv`, `ft_log3_shocks_compact.csv`,
  `busmaster_14.log` (em `test/fixtures`) e, se existir, o log completo de `samples/`.

### 3.2 Módulos

| Arquivo | Origem | Conteúdo |
|---|---|---|
| `src/types.ts` | — | tipos compartilhados (abaixo) |
| `src/util.ts` | `util.js` (só a parte pura) | `clamp`, `fmtTime`, `decimalsFor`, `fmtVal`, `idxAt`, `niceTicks`, `heat`, `HEAT_LIGHT/DARK`, `pctRange`, `range`, `esc` |
| `src/parsers.ts` | `parsers.js` | `parseLog`, `parseCSV`, `parseBusmaster`, `prettyName`, `finishChannel` |
| `src/logdate.ts` | novo | `guessDate(fileName, text?)`: data do teste pelo nome do arquivo da FT ou pelo cabeçalho do BUSMASTER (3.3) |
| `src/gps.ts` | `gps.js` | `DEFAULT_CFG`, `WGS84`, `mPerDeg`, `spanOf`, `FMT_LABEL`, `detectFmt`, `toCode`, `guessGpsChannels`, `smooth`, `computeTrack`, `posAt`, `computeLaps`, `autoLine` |
| `src/analysis.ts` | `analysis.js` | `DEFAULT_SUSP`, `CORNERS`, `findShocks`, `deriv`, `median`, `quant`, `interpAt`, `stoppedMask`, `suspPrep`, `velStats`, `hist`, `fft`, `welch`, `psd`, `findPeak`, `freeDecay`, `localPeaks`, `highpass`, `dropTests`, `psdMask`, `rideRates`, `gpsDynamics`, `lapProfile`, `bestLap`, `deltaToBest`, `compareLaps` |
| `src/vehicle.ts` | `vehicle.js` | `DEFAULT_CAR`, `findWheelCh`, `findCvtCh`, `lstsq`, `linFit`, `vehPrep`, `launches`, `powerCurve`, `coastFit`, `findCoasts`, `cvtFit`, `bodyAngles`, `gradients`, `jumps`, `bottomOuts`, `roughness`, `roadSpectrum` |
| `src/demo.ts` | `demo.js` | `demoCSV`, `DEMO_CAR` (de `app.js`) |
| `src/pipeline.ts` | `app.js` `recompute()` + `buildDerived()` + `setSession()` | `normalizeConfig`, `computeSession`, `rangeOf`, `getChannel`, `channelExtremes` (novo) |
| `src/reports/*.ts` | `analysisui.js` / `vehicleui.js` (`render*`) | relatórios puros de cada página (3.4) |
| `src/quality.ts` | novo | qualidade dos dados por canal (3.5), `SHOCK_STILL_MM` |
| `src/summary.ts` | novo | métricas da sessão para a biblioteca e a comparação (3.6) |
| `src/formulas.ts` | novo | canais calculados por fórmula (3.7) |
| `src/index.ts` | — | reexporta tudo |

### 3.3 Tipos e pipeline

```ts
interface Channel {
  key: string; name: string; unit: string; data: Float64Array;
  src: 'log' | 'gps' | 'calc' | 'formula'; group?: string;
  lo: number; hi: number; count: number; constant: boolean;
}
interface Session {                       // saída de parseLog
  name: string; kind: 'FT' | 'BUSMASTER'; t: Float64Array; channels: Channel[];
  gps?: { lat: Float64Array; lon: Float64Array }; clock0?: string; info: string; demo?: boolean;
}
type TrackConfig = typeof DEFAULT_CFG;    // centro, tamanho, margem, canais X/Y, formato, suavização, volta mínima, linha
type SuspConfig  = typeof DEFAULT_SUSP;   // compPos, knee, moving, fmin, fmax (stroke/massa/MR migram para o carro)
type CarConfig   = typeof DEFAULT_CAR;
type AnalysisConfig = TrackConfig & { susp: SuspConfig; car: CarConfig; formulas?: Formula[] };

interface SessionContext {                // equivalente ao objeto A do app antigo depois do recompute()
  S: Session; cfg: AnalysisConfig;        // cfg já normalizada (padrões + migração + canais X/Y adivinhados)
  track; laps; stopped; dyn; veh; acc; susp; ang;
  all: Channel[];                         // mesma ordem do app antigo: derivados do GPS, veículo, suspensão, log (+ fórmulas no fim)
}
normalizeConfig(S, partialCfg) -> AnalysisConfig
computeSession(S, partialCfg, { autoLine?: boolean }) -> SessionContext
rangeOf(ctx, mode: 'session'|'lap'|'view', selLap, view?: [t0, t1]) -> [i0, i1, label]   // = Analysis.range()
getChannel(ctx, key) -> Channel | undefined
channelExtremes(ctx, key, i0, i1) -> { min: { v, t, i }, max: { v, t, i } } | null   // mín/máx no trecho com o instante ("ir ao ponto"); null sem dado
guessDate(fileName, text?) -> 'AAAA-MM-DD' | 'AAAA-MM-DDTHH:MM' | null
  // "Log 3_20261005-1644.csv" → 2026-10-05T16:44; "***START DATE AND TIME 5:10:2026 16:34:30:698***" (BUSMASTER,
  // dia:mês:ano, só os 2000 primeiros caracteres de text) → 2026-10-05T16:34; data solta no nome → AAAA-MM-DD.
  // O servidor acrescenta só a hora do 1º quadro (clock0) com o dia do envio no BUSMASTER sem cabeçalho.
```

`computeSession` reproduz `legacyCompute()` de `test/legacy.ts` (que é a réplica de
referência do app antigo) e tem teste de equivalência canal a canal.

### 3.4 Relatórios (um por página de engenharia)

Cada `render*` do app antigo mistura conta e HTML. A conta vai para uma função pura em
`src/reports/`, que devolve **tudo** o que a aba antiga mostrava (blocos, tabelas, séries dos
gráficos, avisos), e a página só desenha. Assinaturas:

```ts
designReport(ctx, i0, i1)        -> { rows: { grp, item, val, how, read, explain, sensors }[];
                                      recs: { text, explain, sensors }[]; groups; facts }  // renderDesign
designRecTexts(report) -> string[] ; designCsv(report, nome) -> CSV com a coluna "sensores"
processedCsv(ctx) -> { name, text }   // exportCSV() do app antigo (todos os canais calculados)
trackConfigInfo(ctx)                  // cfgInfo(): vão, resolução, origem da posição, nota de calibração 7/8
suspensionReport(ctx, i0, i1)    -> ...   // renderSusp + renderSuspExtra; + still (amortecedor quase parado, abaixo)
resonanceReport(ctx, i0, i1, o)  -> ...   // renderFreq + showDrop + showPsd + analyzeManual + renderRoadRes; + axles, olley (abaixo)
powertrainReport(ctx, i0, i1)    -> ...   // renderPower + renderCoast + showCoast
cvtReport(ctx, i0, i1)           -> ...   // renderCvt
dynamicsReport(ctx, i0, i1)      -> ...   // renderDyn
lapReport(ctx, cmp, ref)         -> ...   // renderLaps
channelMaps(ctx, i0, i1, o)      -> ...   // renderMaps (faixa 2–98 % por canal)
```

Os gráficos do app antigo usam o spec do `BT.Plot` (`legacy/js/plots.js`: `series`, `bars`,
`points`, `markers`, `circles`, `xLabel`, `yLabel`, `logY`, `equal`, ...). Os relatórios
devolvem esses specs **sem cor nem callbacks** (cada série com um `role`/`id` para a página
escolher a cor) — assim a página desenha igual e o teste compara as séries com as que o app
antigo mandou para o `BT.Plot` (o carregador grava em `el(id).plot`). `designReport` tem que
devolver exatamente `designRows`/`designRec` do app antigo.

Acréscimos (sem mudar os números portados):

- `suspensionReport`: cada linha da tabela por canto tem `still` (com sinal mas curso usado no
  trecho < `SHOCK_STILL_MM` = 1 mm) e o relatório tem `still: { ids, limit, text, explain:
  'quality.shockStill', sensors } | null` com o aviso pronto ("Amortecedor com sinal mas quase
  parado (< 1 mm de curso no trecho): RL 0.2 mm. Potenciômetro solto, travado ou mal calibrado...").
- `resonanceReport`: `axles: { F, R }` com `{ fn, zeta, n, ids, t, explain, sensors }` do 1º
  teste de queda do trecho (o mesmo de `road.fnF/fnR`, mas sem depender do espectro da pista) e
  `olley: { ratio, ref: [1.1, 1.2], status: 'low' | 'near' | 'ok' | 'high', read, text, explain,
  sensors } | null` (null sem fₙ nos dois eixos). `read` = "tras./diant. = 1.18" (coluna da
  ficha); `text` = a recomendação da ficha em `low` (< 1) e `high` (> 1,3) e uma frase de
  "dentro/perto da referência" em `ok` (1,1–1,2) e `near`. `olleyStatus(ratio)` está exportada.

### 3.5 Qualidade dos dados (`dataQuality(S, ctx)`)

Por canal do log: amostras válidas (%), taxa efetiva (Hz), mín/máx, constante, trechos
travados (mesmo valor ≥ 2 s com o carro andando), saltos impossíveis, papel detectado
(GPS X/Y, amortecedor FL/FR/RL/RR posição/velocidade, roda, CVT, status GPS). Lista de
avisos com nível (`info` | `warn` | `error`), texto em português e o que fazer
(ex.: "GPS na borda da área em 12 % do tempo: aumente a margem no track_config.h").

Papéis do GPS: na FT `gps_x`, `gps_y`, `gps_status`; no BUSMASTER (`S.gps`) os canais do módulo e do
PIC têm papel e sensor `gps`: `gps_lat` ('GPS · latitude'), `gps_lon`, `gps_sats`, `gps_fix`,
`gps_pic_x`/`gps_pic_y` ('PIC · X/Y (código)') e `gps_status` ('PIC · status GPS'). `gpsUpdateHz` sai
de X/Y na FT e de latitude/longitude no BUSMASTER. BUSMASTER sem nenhuma posição com fix 3D →
aviso `gps.nofix` (`error`, card `quality.gpsFix`): "O módulo GPS mandou 128 posições, nenhuma
com fix 3D: tipo de fix sempre 0 ..., no máximo 0 satélite(s), status do PIC 85 (sem fix) em 94 %
do tempo..." (no lugar de `gps.track` e sem os avisos de canal vazio/constante desses canais);
`sensorAvailability` continua `absent` para o GPS nesse caso (o card `sensor.gps` explica em
"Limitações"). Amortecedor com sinal mas máx − mín da posição < `SHOCK_STILL_MM` (1 mm) no log
inteiro → aviso `susp.still` (`warn`, card `quality.shockStill`, sensores dos cantos).

### 3.6 Resumo da sessão (`sessionSummary(ctx, design?, range?)`)

`{ version: SUMMARY_VERSION, metrics: { key, group, label, value: number | null, unit, text?, explain, sensors, scope, better?, digits }[], range? }`
com os números de projeto (duração, distância, voltas, melhor volta, v máx, curso usado por
canto, batidas no fim de curso, saltos, frequência natural e ζ, gradientes, potência máx,
melhor largada, Crr/CdA, T máx da CVT, regime previsto...). Chaves estáveis (ex.:
`susp.travel.FL`, `cvt.tmax`) porque a página "Comparar sessões" e o servidor guardam isso.
Mudou a conta? Aumente `SUMMARY_VERSION` (o servidor recalcula). Hoje: **3**.

Cada métrica tem também `scope: 'session' | 'range'`, `digits` (casas do `text`) e, quando a
direção é óbvia para o projeto, `better: 'up' | 'down'` (ex.: melhor volta `down`, v máx `up`;
lista em `SUMMARY_BETTER`). Sem `range` o resumo é o da sessão inteira (o que o servidor e a
biblioteca guardam). Com `range = [i0, i1]` as métricas `scope: 'range'` seguem o trecho (a ficha
do trecho: v máx, curso, velocidades do amortecedor, saltos, fim de curso, gradientes, rugosidade,
ondulações, potência, força trativa, largadas, coast-down, CVT, distância do trecho, % de GPS
válido) e as `scope: 'session'` ficam da sessão inteira (`SUMMARY_SESSION_SCOPE`: duração, voltas,
melhor volta, fator do pneu, fₙ/ζ/k/c — a ficha usa o 1º teste de queda da sessão — e sensores
presentes); o resumo traz `range: { i0, i1, t0, t1 }`. Passe em `design` a ficha do MESMO trecho.

### 3.8 Explicações e sensores (`sensors.ts`, `explain.ts`) — **requisito central**

Todo número, gráfico e correlação usado para o projeto do carro novo diz **de quais sensores
ele saiu**, para a equipe e para mostrar aos juízes que a aquisição serve ao projeto.

- `SENSORS`: catálogo dos sensores e entradas do carro, cada um com `id`, nome, onde fica,
  como chega no log (canal da FT / CAN), taxa, resolução e para que serve. Ids:
  `gps` (módulo GPS → PIC → expander, entradas 7/8 da FT; ou lat/lon no BUSMASTER),
  `shock_fl`, `shock_fr`, `shock_rl`, `shock_rr` (potenciômetros lineares; a FT também
  grava a velocidade), `wheel` (velocidade da roda), `cvt_temp` (temperatura da CVT),
  `logger` (FT450: relógio e taxa de gravação), `car_data` (medidas do carro digitadas:
  massa, geometria, relação roda/amortecedor), e os **sugeridos** (ainda não instalados,
  `planned: true`): `engine_rpm`, `imu`, `brake_pressure`, `steering`, `throttle` — com o
  que cada um destravaria (ex.: rotação + roda = relação da CVT).
- `sensorAvailability(ctx)`: quais sensores este log tem (pelos papéis de `dataQuality`).
- `EXPLAIN`: catálogo de explicações por id (`susp.naturalFreq`, `power.wheelPower`,
  `cvt.thermalModel`, `dyn.gg`, ...). Ids sempre `<área>.<item>`; canais usam
  `channelExplainId(key)` (ex.: `gps:speed` → `channel.gps_speed`) e `sensorsOfChannel(ctx, key)`
  dá os sensores de um canal. Cada entrada: `title`, `what` (o que mostra),
  `sensors: { id, need: 'required' | 'alternative' | 'improves', why }[]`, `how`
  (como é calculado, com a fórmula), `design` (como usar no projeto do carro do ano que
  vem — concreto: que peça/decisão isso dimensiona), `limits`, `test` (ensaio para medir
  melhor), `related` (outros ids). Texto em português, claro para um juiz de projeto.
- Os relatórios (3.4) e o resumo (3.6) marcam cada linha, bloco, métrica e gráfico com
  `explain: '<id>'` e `sensors: SensorId[]` (os que **de fato** entraram na conta nesta
  sessão — ex.: aceleração pela roda ou pelo GPS). Teste: todo `explain` usado existe no
  catálogo e todo sensor citado existe em `SENSORS`.
- `sensorMatrix()`: sensor → análises que ele permite → decisões de projeto (para a página
  de aquisição e a apresentação).

```ts
type SensorId = 'gps' | 'shock_fl' | 'shock_fr' | 'shock_rl' | 'shock_rr' | 'wheel' | 'cvt_temp' | 'logger' | 'car_data'
              | 'engine_rpm' | 'imu' | 'brake_pressure' | 'steering' | 'throttle';
interface Sensor { id: SensorId; name: string; short: string; where: string; signal: string; rate: string;
  resolution?: string; purpose: string; planned?: boolean }
const SENSORS: Record<SensorId, Sensor>;
interface ExplainSensor { id: SensorId; need: 'required' | 'alternative' | 'improves'; why: string }
interface ExplainEntry { id: string; title: string; what: string; sensors: ExplainSensor[]; how: string;
  design: string; limits?: string; test?: string; related?: string[] }
const EXPLAIN: Record<string, ExplainEntry>;
getExplain(id: string): ExplainEntry | undefined;
sensorAvailability(ctx: SessionContext): Record<SensorId, 'present' | 'absent' | 'planned'>;
sensorMatrix(): { sensor: SensorId; items: { explain: string; decision: string }[] }[];
// em linhas/blocos/métricas/gráficos dos relatórios:  { ..., explain?: string; sensors?: SensorId[] }
```

### 3.7 Fórmulas (`formulas.ts`)

Canais calculados pelo usuário, sem `eval`: parser próprio com `+ - * / ^`, parênteses,
números, constantes `pi`, `g`, funções `abs sqrt min max sin cos tan atan2 exp ln log10
deriv(x) smooth(x, s) clamp(x, a, b) if(c, a, b)` e comparações `< > <= >= == !=`.
Canais por chave entre colchetes: `[Shock_-_Front_Left] - [Shock_-_Front_Right]`, também
os calculados (`[gps:speed]`). `Formula = { id, name, unit, expr }`; erro de sintaxe vira
mensagem em português com a posição. `computeSession` acrescenta os canais (grupo "Fórmulas").

## 4. `@baja/web`

### 4.1 Pilha

React 19, TypeScript, Vite, **Mantine 9** (`@mantine/core`, `hooks`, `notifications`,
`dropzone`), ícones `@tabler/icons-react`, **uPlot** (gráficos de tempo/distância da página
Canais), um componente `XYPlot` em canvas portado de `legacy/js/plots.js` (gráficos das
análises), `TrackMap` em canvas portado de `legacy/js/mapview.js`, **zustand** (estado),
**idb** (biblioteca local no IndexedDB), **react-router 7** com `HashRouter` (funciona no
GitHub Pages sem configuração).

### 4.2 Layout

`AppShell` do Mantine:

- **Barra lateral** (260 px, recolhível; no celular vira menu): grupos e páginas abaixo,
  com ícone e nome. Páginas que precisam de uma sessão aberta ficam desabilitadas (com dica)
  quando não há sessão.
- **Cabeçalho** (60 px): nome do app; seletor da sessão aberta (nome, tipo, duração; trocar
  sessão abre a biblioteca); **Trecho** (`Sessão` / `Volta` / `Janela`) + seletor de volta,
  que valem para todas as páginas de análise; à direita, o modo da biblioteca ("Local" ou
  "Servidor · nome do usuário") e o tema.
- **Barra de reprodução** (rodapé, 64 px) nas páginas Visão geral, Canais, Mapa e Voltas:
  ⏮ −1 s ▶/❚❚ +1 s, velocidade 0,25×–16×, barra de tempo com as voltas marcadas, tempo
  atual / total, repetir. Atalhos globais: espaço, ← → (Shift = 1 s), Home, End.

| Grupo | Página | Rota | Conteúdo |
|---|---|---|---|
| Dados | **Sessões** | `#/` | biblioteca: enviar logs (arrastar vários), lista com filtros (data, pista, carro, piloto, etiquetas), métricas principais por sessão, abrir, editar dados, apagar, exemplo |
| Dados | **Aquisição** | `#/aquisicao` | canais do log e papel de cada um, qualidade dos dados, fórmulas, calibração da FT (entradas 7/8), testes para fazer com o carro |
| Sessão | **Visão geral** | `#/sessao` | blocos (duração, distância, v máx, melhor volta, T máx CVT, curso máx, saltos), mini-mapa, voltas, pontos de atenção, dados da sessão (data, piloto, carro, pista, notas, etiquetas), anotações |
| Sessão | **Canais** | `#/canais` | estilo RaceStudio: lista de canais com valor no cursor e mín/máx (clique = ir ao ponto), painéis empilhados (um ou vários canais por painel, arrastar canal para painel), eixo tempo ou distância, faixa de voltas no topo, sobrepor volta de referência, visão geral da sessão embaixo para navegar, mini-mapa, layouts salvos |
| Sessão | **Mapa** | `#/mapa` | mapa grande colorido por qualquer canal, legenda, satélite, seguir o carro, linha de largada, valores no cursor; aba "Mapas por canal" (um mini-mapa por canal) |
| Sessão | **Voltas** | `#/voltas` | tabela de voltas, velocidade × distância, diferença de tempo acumulada, trechos onde ganhou/perdeu |
| Sessão | **Dispersão** | `#/dispersao` | X × Y de quaisquer canais (pontos ou mapa de calor) e histograma 2D com média de um canal Z, clique numa célula = estatísticas e ir ao ponto |
| Engenharia | **Suspensão** | `#/suspensao` | por canto, histogramas, curso, rolagem/arfagem, saltos, fim de curso |
| Engenharia | **Ressonância** | `#/ressonancia` | teste de queda, espectro andando, pista × ressonância |
| Engenharia | **Trem de força** | `#/trem-de-forca` | calibração do pneu, potência na roda, largadas, coast-down |
| Engenharia | **CVT** | `#/cvt` | modelo térmico, projeção do enduro |
| Engenharia | **Dinâmica** | `#/dinamica` | g-g, raio, tempo por faixa de velocidade |
| Projeto | **Ficha do carro** | `#/projeto` | `designReport` agrupado + pontos de atenção, exportar CSV, imprimir/PDF |
| Projeto | **Comparar sessões** | `#/comparar` | escolher sessões da biblioteca → tabela de métricas lado a lado (diferença para a primeira), gráficos por métrica ao longo das datas, histogramas de velocidade do amortecedor sobrepostos |
| Configuração | **Carro** | `#/carro` | perfis do carro (ex.: "BJ26 — setup A"): massa, geometria, suspensão, roda/CVT, resistências |
| Configuração | **Pista e GPS** | `#/pista` | perfis de pista (track_config.h, canais X/Y, formato, linha de largada) |
| Configuração | **Equipe** | `#/equipe` | só com servidor: usuários, convites, papéis |
| Configuração | **Preferências** | `#/config` | tema, endereço do servidor da equipe, sair |

Toda página de análise tem: título, uma frase dizendo o que ela responde para o projeto,
o seletor de trecho visível, estado vazio útil ("abra uma sessão", "este log não tem
amortecedores: ..."), e os textos explicativos do app antigo (física, como medir).

### 4.3 Estado (`src/state/`)

- `session.ts` (zustand): `status`, `error`, `source`, `S`, `ctx`, `cfg`, `cursor`,
  `playing`, `speed`, `loop`, `selLap`, `rangeMode`, `view`, `colorKey`, `xAxis`
  ('time' | 'dist') e as ações (`openText`, `openDemo`, `openFromLibrary`, `close`,
  `updateConfig` → recalcula, `seek`, `play`, `pause`, ...). Um único laço
  `requestAnimationFrame` do play vive aqui.
- O **cursor muda 60×/s** no play: gráficos e mapa assinam com `useSessionStore.subscribe`
  e se redesenham sem re-render do React; componentes de texto usam um seletor com
  limitação (~20×/s).
- `useRange()` → `[i0, i1, rótulo]` via `rangeOf` (o mesmo trecho devolve o mesmo array).
  Relatórios são calculados com `useComputed` (`state/heavy.ts`): `useMemo` em logs
  pequenos; em logs com mais de 50 mil amostras, primeiro o aviso "Calculando…" e a conta
  depois de pintar. `useQuality()` calcula `dataQuality` uma vez por sessão.
- Atalhos de teclado só nas páginas com reprodução; uma página com erro mostra a mensagem
  nela (`PageErrorBoundary`) sem derrubar o menu. `#/pagina?exemplo=1` abre o exemplo.
- `profiles.ts`: perfis de carro e pista (biblioteca ativa), perfil ativo, fórmulas.
- `prefs.ts`: tema, servidor, layouts da página Canais, a última sessão aberta da
  biblioteca e "reabrir a última sessão ao abrir o app" (localStorage, sempre com
  try/catch).
- `reopen.ts`: abrir da biblioteca (ou guardar a sessão aberta) lembra o id e a biblioteca;
  fechar essa sessão esquece (fechar o exemplo não); ao carregar o app, com nada aberto e
  sem `?exemplo`, reabre em silêncio (no servidor, depois do login); sessão apagada → esquece o id.
- Sessão aberta sem salvar (arquivo, texto) guarda o texto (`unsavedText`) e oferece
  **Guardar na biblioteca** (`saveToLibrary`): a sessão aberta passa a ser da biblioteca sem
  reabrir o log. Um guardar por vez (clicar em dois botões não grava o log duas vezes); no
  `local.ts` o `addSession` também é um por vez, para a procura do sha256 valer.

### 4.4 Biblioteca (`src/library/`)

```ts
interface SessionMeta { id; name; fileName; kind; size; createdAt; uploadedBy?; date?; trackId?; carId?;
  driver?; tags: string[]; notes?; summary?: SessionSummary }
interface Library {
  mode: 'local' | 'remote';
  listSessions(); getSessionText(id); addSession(file, meta?); updateSession(id, patch); deleteSession(id);
  listCars(); saveCar(p); deleteCar(id); listTracks(); saveTrack(p); deleteTrack(id);
  listComments?(sessionId); addComment?(sessionId, { t?, text }); deleteComment?(id);
}
```

`local.ts` (IndexedDB, texto do log comprimido com `CompressionStream('gzip')` quando
existir; sem espaço → `LocalQuotaError` com mensagem clara; ao guardar pede
`navigator.storage.persist()` — `storage.ts` mostra espaço usado/disponível e a proteção
contra limpeza automática nas páginas Sessões e Preferências) e `remote.ts` (API do
servidor, token Bearer). Ordem da escolha: endereço salvo em
Preferências > servidor padrão do build (`VITE_API_URL`, que o `pages.yml` passa; ignorado
se a pessoa escolheu "só este navegador") > servidor na mesma origem (`/api/info` responde;
não é perguntado no build estático `VITE_STATIC=1`, o do GitHub Pages) > local. Ao adicionar
uma sessão local, o resumo é calculado no navegador; no remoto, pelo servidor.

As duas bibliotecas se comportam igual onde a interface precisa: log repetido (mesmo
sha256) dá erro com o id da sessão que já existe (409 `{ error, id }` no servidor,
`LocalDuplicateError` no local) e a tela oferece abrir a existente; resumo de uma versão
antiga das contas vem com `summaryOutdated` (o local marca na leitura) e a tela oferece
recalcular; `date` da sessão é `AAAA-MM-DD` ou `AAAA-MM-DDTHH:MM` e aparece em pt-BR
(`library/format.ts`). `changePassword` guarda o token novo; perfis de carro/pista de outra
pessoa ficam só leitura para quem não é admin (o PUT daria 403).

### 4.6 Cards de explicação (requisito central)

- Componente `ExplainCard` (Drawer do Mantine à direita, ~480 px; tela cheia no celular)
  aberto por `useExplain().open(id, { sensors })`. Mostra: título; "O que mostra";
  **"Sensores usados"** (chips com ícone de cada sensor: verde = presente neste log,
  cinza = ausente, tracejado = sugerido, e o porquê de cada um); "Como é calculado"
  (fórmula); **"Para o carro do ano que vem"**; "Limitações"; "Teste para medir melhor";
  "Veja também" (links para outros cards).
- **Todo** gráfico (`ChartCard`), bloco de número (`StatTile`), linha da ficha do projeto,
  métrica da comparação e item de qualidade tem o botão ⓘ e o próprio título clicável que
  abre o card. Os chips dos sensores também aparecem pequenos ao lado do título dos
  gráficos e nas linhas da ficha.
- Página Aquisição tem a aba **"Sensores e projeto"**: matriz sensor × análise × decisão
  de projeto (`sensorMatrix`), com cada célula abrindo o card — pronta para mostrar aos juízes.
- A Ficha do carro exportada (CSV e impressão) inclui a coluna "Sensores".

### 4.5 Visual

- Tema **escuro por padrão** (como MoTeC/RaceStudio), claro disponível. Fonte do sistema
  (`system-ui, "Segoe UI", sans-serif`), base 15 px; títulos de página 24 px; títulos de
  seção 18 px; números de bloco 28 px.
- Superfície dos gráficos: escuro `#141517`/claro `#ffffff`; grade em linha fina sólida;
  texto dos eixos 12 px.
- **Cores das séries** (paleta validada, ordem fixa, nunca cíclica):

  | slot | claro | escuro | uso fixo |
  |---|---|---|---|
  | 1 azul | `#2a78d6` | `#3987e5` | FL · volta comparada · série única |
  | 2 laranja | `#eb6834` | `#d95926` | FR · volta de referência |
  | 3 água | `#1baf7a` | `#199e70` | RL |
  | 4 amarelo | `#eda100` | `#c98500` | RR |
  | 5 magenta | `#e87ba4` | `#d55181` | |
  | 6 verde | `#008300` | `#008300` | |
  | 7 violeta | `#4a3aa7` | `#9085e9` | |
  | 8 vermelho | `#e34948` | `#e66767` | |

  Status (bom/atenção/sério/crítico): `#0ca30c`, `#fab219`, `#ec835a`, `#d03b3b`, sempre
  com ícone + texto. Pista colorida por canal: rampa "calor" do app antigo (`heat`). Cursor
  do tempo: branco no escuro, preto no claro. Um eixo Y por gráfico (nunca dois).
- Painel com ≥ 2 séries tem legenda; texto nunca na cor da série.

## 5. `@baja/server`

### 5.1 Pilha e configuração

Fastify 5, `better-sqlite3`, `@fastify/jwt`, `@fastify/multipart`, `@fastify/static`,
`@fastify/cors`, `@fastify/rate-limit`. Variáveis de ambiente:

| Variável | Padrão | |
|---|---|---|
| `PORT` | `8080` | |
| `HOST` | `0.0.0.0` | |
| `DATA_DIR` | `./data` | banco `db.sqlite`, logs em `sessions/<id>.gz`, segredo do JWT em `secret` (gerado se não existir) |
| `JWT_SECRET` | (arquivo) | sobrepõe o segredo gerado; mínimo 32 caracteres, o texto de exemplo do compose é recusado |
| `CORS_ORIGINS` | vazio | origens permitidas, separadas por vírgula (ex.: o GitHub Pages); vazio = só a mesma origem |
| `TRUST_PROXY` | desligado | `true` = confia em 1 proxy vindo de rede local (Cloudflare Tunnel, Caddy, nginx); número = saltos; lista de IPs/CIDR |
| `MAX_UPLOAD_MB` | `100` | |
| `ANALYSIS_MEMORY_MB` | `1536` | memória máxima do processo filho que lê e analisa os logs |
| `ANALYSIS_TIMEOUT_S` | `300` | tempo máximo da análise de um log |
| `WEB_DIST` | `apps/web/dist` | build do app servido em `/` (relativo à pasta `apps/server`) |
| `LOG_LEVEL` | `info` | |
| `LOCAL_MODE` | desligado | `1`/`true` = modo local, só neste computador, sem contas (5.4) |
| `LOCAL_USER_NAME` | usuário do Windows | nome do usuário local criado na primeira subida do modo local |

A leitura e a análise dos logs rodam num **processo filho** (`src/analyzer.ts` +
`src/analysis-worker.ts`), um log por vez, com limite de memória e de tempo: um log
malformado (ex.: um ponto absurdo de velocidade) mata só o filho, nunca o servidor. O
build gera `dist/index.js`, `dist/analysis-worker.js` e um chunk, que ficam juntos.

### 5.2 Dados

`users(id, name, email UNIQUE, pass_hash, role 'admin'|'member'|'viewer', disabled, token_version, created_at)`,
`invites(code, role, created_by, created_at, expires_at, used_by, used_at)`,
`sessions(id, name, file_name, kind, size, sha256, uploaded_by, created_at, date, track_id,
car_id, driver, tags JSON, notes, summary JSON, summary_version, summary_error)`,
`cars(id, name, params JSON, created_by, updated_at)`, `tracks(id, name, params JSON, created_by, updated_at)`,
`comments(id, session_id, user_id, t, text, created_at)`. Migrações numeradas em código.
Senhas com `scrypt` do `node:crypto` + sal; comparação em tempo constante.

### 5.3 API (`/api`)

```
GET  /info                      { name, version, needsSetup }  (modo local: + localMode, dataDir, user — 5.4)
POST /auth/setup                primeiro admin (só sem usuários)        -> { token, user }
POST /auth/login                { email, password }  (rate limit)       -> { token, user }
POST /auth/register             { code, name, email, password }         -> { token, user }
GET  /auth/me ; POST /auth/password
GET/POST /users ; PATCH/DELETE /users/:id          (admin)
GET/POST /invites ; DELETE /invites/:code          (admin)
GET  /sessions?q&trackId&carId&tag  ; POST /sessions (multipart: file + meta JSON)
GET/PATCH/DELETE /sessions/:id ; GET /sessions/:id/file (texto do log, gzip)
POST /sessions/:id/summary      recalcula com o carro/pista da sessão
GET/POST /cars ; GET/PUT/DELETE /cars/:id ; GET/POST /tracks ; GET/PUT/DELETE /tracks/:id
GET/POST /sessions/:id/comments ; DELETE /comments/:id
GET  /health
```

Papéis: `viewer` só lê; `member` envia sessões, cria perfis e edita/apaga **o que é seu**
(sessões, anotações, carros e pistas que criou — PUT de perfil de outro dá 403);
`admin` tudo. O último admin não pode ser rebaixado, desativado nem apagado.

Detalhes que a interface precisa saber:

- `GET /auth/me` → `{ user }`; `POST /auth/password` → `{ token, user }` novo (o token
  antigo deixa de valer: guarde o novo). Senha, login, setup e register têm limite de 10
  tentativas/min por IP. JWT de 30 dias com versão (`tv`) que muda ao trocar a senha ou
  desativar o usuário.
- `POST /users` aceita `password` opcional; sem ela gera e devolve `tempPassword` uma vez.
- `POST /sessions` com o mesmo sha256 de uma sessão existente → 409 `{ error, id }`
  (a menos que `meta.allowDuplicate`). `date` pode vir como `AAAA-MM-DD` ou
  `AAAA-MM-DDTHH:MM` (tirada do nome do arquivo da FT ou do cabeçalho do BUSMASTER).
- Sessões trazem também `sha256`, `uploadedById`, `summaryVersion`, `summaryError`
  (ex.: análise passou do limite de memória/tempo), `summaryOutdated`; carros/pistas
  trazem `createdBy`, `createdByName`, `sessions` (quantidade); convites trazem `status`,
  `createdByName`, `usedByName`, `usedAt`.
- `GET /sessions/:id/file` → `text/plain` com `Content-Encoding: gzip` quando aceito.
- `POST /sessions/:id/summary` vale para qualquer membro. Mudar params de um perfil
  recalcula em segundo plano as sessões que o usam; o resumo só é gravado se o perfil não
  mudou durante a conta.

Ao receber um log, o servidor lê com `parseLog`, calcula `computeSession` +
`sessionSummary` com o carro e a pista escolhidos e guarda o resumo. Na subida, recalcula
resumos com versão antiga. Validação de entrada por JSON Schema em todas as rotas; erros em
português (`{ error }`).

### 5.4 Modo local ("este computador")

Para quem usa o app só no próprio PC, sempre no mesmo endereço, com os logs guardados numa
pasta do computador, sem login e sem hospedagem. Liga com `LOCAL_MODE=1` (ou `true`);
código em `src/local.ts`. O modo equipe não muda em nada.

- **Só 127.0.0.1.** `HOST` vazio, `127.0.0.1` ou `localhost` → escuta em `127.0.0.1`;
  qualquer outro valor (ex.: `0.0.0.0`) e o servidor **não sobe** ("modo local não pode
  ficar exposto na rede"). `CORS_ORIGINS` e `TRUST_PROXY` são ignorados. `PORT` como
  sempre (o atalho usa 8090).
- **Usuário deste computador.** Na subida: sem usuários no banco, cria um admin com nome
  `LOCAL_USER_NAME` (ou o usuário do Windows), e-mail `local@este.computador` e uma senha
  aleatória que ninguém usa; com usuários (pasta já usada no modo equipe), usa o primeiro
  admin ativo. Toda rota `/api` usa esse usuário, sem token (um `Authorization` que venha é
  ignorado). Sessões, carros, pistas, anotações, resumos e o processo de análise: iguais.
- **Defesas** (sem login, a proteção é saber de onde vem o pedido). Todo pedido — API,
  `/api/info`, `/api/health` e as páginas do app em `/` — precisa ao mesmo tempo:
  1. vir de loopback (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`);
  2. ter `Host` `localhost`, `127.0.0.1` ou `[::1]` **com a porta do servidor** (contra DNS
     rebinding: um site que aponte o nome dele para 127.0.0.1 manda o próprio Host);
  3. se tiver `Origin`, ser `http://localhost:<porta>`, `http://127.0.0.1:<porta>` ou
     `http://[::1]:<porta>` (outro site aberto no mesmo navegador não consegue mandar
     POST/DELETE para o localhost; `Origin: null` também é recusado);
  4. se tiver `Sec-Fetch-Site`, ser `same-origin` ou `none` (endereço digitado, atalho). De
     outro site (`cross-site`, ou `same-site` = outra porta do localhost) só vale abrir a
     página do app por um link (navegação GET fora de `/api`); a API e os arquivos do app
     não respondem (um `<img>`/`<script>`/`fetch` no-cors, que vai sem `Origin`, não
     descobre se o app roda aqui nem quais sessões existem).

  Senão → 403 `{ error: 'Modo local: só o app aberto neste computador pode usar este servidor.' }`,
  antes de ler o corpo do pedido. Continua `X-Frame-Options: DENY` (nada de embutir o app
  noutro site). Ataques testados em `apps/server/test/local-attacks.test.ts`.
- **Sem contas.** `POST /auth/setup`, `/auth/login`, `/auth/register`, `/auth/password`,
  `/users*` e `/invites*` → 404 `{ error: 'No modo local não há contas: o app usa o usuário
  deste computador.' }`. `GET /auth/me` → `{ user }` do usuário local. A regra vale pelo
  padrão da rota (tudo em `/api/auth/*` menos `/auth/me`, tudo em `/api/users*` e
  `/api/invites*`): uma rota de contas nova já nasce fechada no modo local. Nenhuma rota do
  modo local devolve token nem senha.
- **Pasta reaproveitada no modo equipe.** O usuário local tem senha aleatória que ninguém
  conhece; se `local@este.computador` já existia (rebaixado/desativado) e volta a ser admin,
  ganha senha aleatória nova e os tokens dele caem. Consequência: abrir no modo equipe uma
  pasta criada no modo local não dá para entrar (não há setup, o único admin não tem senha
  conhecida); os dados ficam lá, para o modo local.
- `GET /api/info` → `{ name, version, needsSetup: false, localMode: true, dataDir, user: { id,
  name, email, role } }` (`dataDir` = caminho absoluto da pasta de dados). No modo equipe
  `/api/info` continua `{ name, version, needsSetup }`.
- Na subida, o log diz o endereço (`http://localhost:<porta>`) e a pasta dos dados.

## 6. Implantação

- `Dockerfile` (multi-stage, `node:22-bookworm-slim`), volume `/data`, porta 8080;
  `docker-compose.yml` para rodar num PC da equipe.
- GitHub Actions: `ci.yml` (typecheck, testes, build), `docker.yml` (imagem no GHCR),
  `pages.yml` (app no GitHub Pages a cada push em `main`, build com `VITE_STATIC=1`).
- Guia em `docs/IMPLANTACAO.md`: PC da equipe + Cloudflare Tunnel, Fly.io/Railway, VM.
