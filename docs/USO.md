# Guia da equipe — como usar o Baja Telemetria

Este guia é para quem vai **usar** o app: pilotos, pessoal de suspensão, trem de força,
CVT, dinâmica e quem apresenta o projeto. Para instalar o servidor, veja
[`IMPLANTACAO.md`](IMPLANTACAO.md). O detalhe técnico de cada página está em
[`ARQUITETURA.md`](ARQUITETURA.md) (seção 4).

## Sumário

1. [O que o app faz](#1-o-que-o-app-faz)
2. [Primeiros passos](#2-primeiros-passos)
3. [As páginas e para que servem](#3-as-páginas-e-para-que-servem)
4. [Abrir e enviar logs](#4-abrir-e-enviar-logs)
5. [Pista e GPS](#5-pista-e-gps)
6. [Dados do carro](#6-dados-do-carro)
7. [Cards de explicação e sensores](#7-cards-de-explicação-e-sensores)
8. [Apresentar aos juízes](#8-apresentar-aos-juízes)
9. [Testes para fazer com o carro](#9-testes-para-fazer-com-o-carro)
10. [Limites das medidas](#10-limites-das-medidas)
11. [Atalhos de teclado e mouse](#11-atalhos-de-teclado-e-mouse)

---

## 1. O que o app faz

Transforma os logs do carro — o **CSV do FT Manager** (FuelTech FT450) e o **log CAN do
BUSMASTER** — em gráficos e números que ajudam a **projetar o carro do ano que vem**:

- mapa da pista pelo GPS, colorido por qualquer canal, e voltas separadas;
- reprodução do log em tempo real (play), com todos os gráficos e o mapa acompanhando;
- **suspensão:** curso usado por canto, velocidade do amortecedor, rolagem e arfagem,
  saltos e batidas no fim de curso;
- **ressonância:** frequência natural e amortecimento (teste de queda), espectro andando,
  pista × ressonância;
- **trem de força:** calibração do pneu, potência na roda, largadas, coast-down (Crr e CdA);
- **CVT:** modelo térmico e projeção para o enduro;
- **dinâmica:** diagrama g-g, raio de curva, tempo por faixa de velocidade;
- **ficha do carro** com todos os números de projeto, cada um dizendo de **quais sensores**
  saiu;
- **biblioteca da equipe** para guardar, comparar e anotar os testes.

As contas são as mesmas do app antigo (`legacy/`), conferidas com um modelo físico
([seção 10](#10-limites-das-medidas)). O log é aberto e analisado **no navegador**:
funciona sem internet na pista. O servidor da equipe serve para guardar e compartilhar.

---

## 2. Primeiros passos

1. Abra o endereço do app que a equipe usa (o do servidor, ex.:
   `https://telemetria.suaequipe.com.br`, ou `http://localhost:8080` no PC).
2. **Com servidor:** entre com seu e-mail e senha. Primeira vez? Peça um **código de
   convite** a um admin e use "criar conta com convite" na tela **Entrar**.
   **Sem servidor:** o app usa a biblioteca **local** (fica só no seu navegador). O modo
   aparece no canto direito do cabeçalho: "Local" ou "Servidor · seu nome".
3. Na página **Sessões**, abra a **sessão de exemplo** para conhecer o app: é um log gerado
   por um modelo físico do carro, com valores conhecidos.
4. Abra um log de verdade: arraste o arquivo para a página **Sessões**
   ([seção 4](#4-abrir-e-enviar-logs)).
5. Confira **Pista e GPS** e **Carro** (seções 5 e 6): sem isso, mapa e contas saem errados.
6. Escolha o **Trecho** no cabeçalho — **Sessão** (tudo), **Volta** (a volta escolhida) ou
   **Janela** (o que está visível nos gráficos de canais). Ele vale para todas as páginas
   de análise.

Tema escuro por padrão; troque no botão do cabeçalho ou em **Preferências**.

---

## 3. As páginas e para que servem

| Grupo | Página | O que tem | Para que serve no projeto do carro |
|---|---|---|---|
| Dados | **Sessões** | biblioteca: enviar logs (vários de uma vez), filtros por data, pista, carro, piloto e etiquetas, métricas principais, abrir, editar, apagar, exemplo | achar o teste certo e manter o histórico da temporada organizado |
| Dados | **Aquisição** | canais do log e o papel de cada um, qualidade dos dados, fórmulas, calibração da FT (entradas 7/8), testes para fazer, aba **Sensores e projeto** | saber se o log presta antes de tirar conclusões; decidir que sensor instalar; mostrar aos juízes |
| Sessão | **Visão geral** | duração, distância, v máx, melhor volta, T máx da CVT, curso máx, saltos, mini-mapa, voltas, pontos de atenção, dados e anotações da sessão | o resumo do teste em uma tela, para a reunião depois do treino |
| Sessão | **Canais** | canais empilhados ao longo do tempo ou da distância (estilo RaceStudio), valor no cursor, volta de referência sobreposta, layouts salvos | achar **o que** aconteceu e **onde**: uma batida no fim de curso, um pico de temperatura, uma derrapagem |
| Sessão | **Mapa** | mapa grande colorido por qualquer canal, satélite, seguir o carro, linha de largada; aba "Mapas por canal" | ver em que parte da pista cada coisa acontece (trechos duros, onde a CVT esquenta) |
| Sessão | **Voltas** | tabela de voltas, velocidade × distância, diferença de tempo acumulada, onde ganhou/perdeu | comparar pilotos e setups no mesmo traçado; achar as curvas que limitam o tempo |
| Sessão | **Dispersão** | X × Y de quaisquer canais, mapa de calor, histograma 2D com média de um terceiro canal | correlações entre sensores (ex.: curso × velocidade, temperatura × velocidade) |
| Engenharia | **Suspensão** | por canto: histogramas, curso usado, rolagem/arfagem, saltos, fim de curso | curso do amortecedor novo, faixa de trabalho das válvulas, barra estabilizadora |
| Engenharia | **Ressonância** | teste de queda, espectro andando, pista × ressonância | mola e amortecimento pela frequência natural e ζ; velocidade em que a pista excita a carroceria |
| Engenharia | **Trem de força** | calibração do pneu, potência na roda, largadas, coast-down | redução final, calibração da CVT, Crr e CdA reais para simular o carro novo |
| Engenharia | **CVT** | modelo térmico, projeção do enduro | dimensionar dutos e entrada de ar da CVT para aguentar o enduro |
| Engenharia | **Dinâmica** | g-g, raio de curva, tempo por faixa de velocidade | bitola, entre-eixos e altura do CG contra capotamento; em que velocidade o carro passa o tempo |
| Projeto | **Ficha do carro** | todos os números de projeto agrupados + pontos de atenção, exportar CSV, imprimir/PDF | o documento de entrada do projeto do carro novo — e o que se mostra aos juízes |
| Projeto | **Comparar sessões** | métricas de várias sessões lado a lado (diferença para a primeira), gráficos ao longo das datas, histogramas sobrepostos | provar que uma mudança (mola, pneu, CVT) melhorou; acompanhar a evolução |
| Configuração | **Carro** | perfis do carro (ex.: "BJ26 — setup A"): massa, geometria, suspensão, roda/CVT, resistências | as medidas que transformam sinal em grandeza de projeto ([seção 6](#6-dados-do-carro)) |
| Configuração | **Pista e GPS** | perfis de pista: `track_config.h`, canais X/Y, formato, linha de largada | mapa e voltas certos ([seção 5](#5-pista-e-gps)) |
| Configuração | **Equipe** | só com servidor: usuários, convites, papéis | admins: dar e tirar acesso |
| Configuração | **Preferências** | tema, endereço do servidor da equipe, sair | |

Toda página de análise começa com uma frase dizendo **o que ela responde para o projeto**.
Páginas que precisam de uma sessão aberta ficam apagadas no menu até você abrir uma.

---

## 4. Abrir e enviar logs

**Arraste** um ou vários arquivos para a página **Sessões** (ou use o botão de enviar).
Com servidor, o log vai para a biblioteca da equipe e o servidor calcula as métricas; sem
servidor, fica na biblioteca local do navegador.

### CSV do FT Manager (FT450)

1. No FT Manager, abra o log baixado da FT450 e **exporte como CSV**.
2. A coluna de tempo (`TIME`) e todos os canais viram gráficos. Os valores `1797693…` que
   a FT grava quando não há dado naquela amostra são ignorados.
3. O GPS chega pelas entradas 7 e 8 do expander ([seção 5](#5-pista-e-gps)).

### Log do BUSMASTER (`.txt` / `.log`)

O app decodifica a posição real do módulo GPS (quadro `0x028`), o fix (`0x023`), o debug do
PIC (`0x7E9`) e os blocos FTCAN do expander e da FT. Útil na bancada e para conferir o GPS
(lat/lon direto, sem a conversão em código 0–255).

### Depois de enviar

Preencha os **dados da sessão** (na lista ou na Visão geral): **data, piloto, carro,
pista, etiquetas** (ex.: `coast-down`, `setup-B`, `chuva`) e **notas**. São esses campos
que permitem filtrar e comparar depois. Use o perfil de **carro** e de **pista** certos:
as métricas da biblioteca são calculadas com eles.

---

## 5. Pista e GPS

### Como o GPS chega no log da FT

O PIC (`pic_gps_expander`) lê o módulo GPS no CAN e manda a posição como um **código
0–255** nas entradas **7 (X, Leste)** e **8 (Y, Norte)** do expander. No log de 05/10 elas
aparecem como:

- **X (Leste) = `Back_pressure`** (DataID `0x0177`)
- **Y (Norte) = `O2_General`** (DataID `0x0027`)

Isso vem da ordem dos DataIDs no bloco `0x2FF` do log do BUSMASTER. **Para conferir, ande
para o Norte: o Y tem que subir.** Se estiver trocado, use **Pista e GPS → Trocar X ↔ Y**.
Também dá para ligar o fundo de satélite no Mapa e ver se o traçado cai em cima da pista.

Conversão (a mesma do `gps_pos.c`):

```
código = V × 51                                   (log em volts)
resolução = (tamanho + 2 × margem) / 255          200 m + 2 × 10 m → 0,863 m por passo
metros = (código − 127,5) × resolução
```

Os números da pista (**centro, tamanho, margem**) ficam em **Pista e GPS** e **têm que ser
iguais aos do `track_config.h` gravado no PIC**. Salve um perfil para cada pista.

### Calibração na FT (entradas 7 e 8, linear 0–5 V)

Use **0,00 V = 0** e **5,00 V = 5**. Assim o log fica em volts e o app converte.

**Não use "1 V = 1":** o PIC trava o valor no ponto mínimo da calibração (`input_value()`
em `ft_expander.c`), então tudo abaixo de 1 V (código < 51, ou seja, mais de ~66 m a
Oeste/Sul do centro) vira 1,000 e se perde. Metros direto na FT também não dá, porque esses
canais guardam 3 casas decimais em 16 bits (máx. ±32,767).

### Linha de largada e voltas

Em **Pista e GPS** (ou no Mapa): **Desenhar** (2 cliques no mapa) ou **Automática**.
Com a linha, o app separa as voltas; escolha uma volta no cabeçalho para ver só ela.

A página **Aquisição** avisa quando o GPS fica na **borda** da área (código travado em 0
ou 255): aumente a margem no `track_config.h`.

---

## 6. Dados do carro

A página **Carro** guarda os números que entram nas contas, em **perfis** (ex.: "BJ26 —
setup A", "BJ26 — mola dura"):

- massa com piloto, entre-eixos e bitolas;
- relação roda/amortecedor, curso total dos amortecedores e massa suspensa por roda;
- canal da velocidade da roda e se o sensor está na **roda de tração** ou na **roda livre**;
- canal da CVT, temperatura ambiente, limite da CVT e duração do enduro;
- Crr, CdA e potência do motor.

Sem esses números, curso vira só "mm do potenciômetro", frequência não vira rigidez e
aceleração não vira potência. **Refaça as medidas quando mudar molas, massa ou geometria**
e escolha o perfil certo em cada sessão. O coast-down (Trem de força) tem um botão que grava
Crr e CdA medidos no perfil do carro.

---

## 7. Cards de explicação e sensores

**Todo número, gráfico e correlação mostra de quais sensores saiu.** Isso vale para a
equipe entender o que está vendo e para provar aos juízes que a aquisição de dados serve
ao projeto.

- Clique no **título** ou no botão **ⓘ** de qualquer gráfico, bloco de número, linha da
  ficha, métrica da comparação ou item de qualidade: abre o **card de explicação** (à
  direita; tela cheia no celular).
- O card tem:
  - **O que mostra**;
  - **Sensores usados** — chips de cada sensor: **verde** = presente neste log,
    **cinza** = ausente, **tracejado** = sugerido (ainda não instalado), com o porquê de
    cada um (obrigatório, alternativa ou melhora a medida);
  - **Como é calculado** (com a fórmula);
  - **Para o carro do ano que vem** — que peça ou decisão isso dimensiona;
  - **Limitações** e **Teste para medir melhor**;
  - **Veja também** (outros cards).
- Os chips pequenos ao lado do título dos gráficos e nas linhas da ficha mostram os
  sensores que **de fato** entraram na conta nesta sessão (ex.: aceleração pela roda ou,
  sem roda, pelo GPS).

### Sensores do carro

| Sensor | Situação | Para que serve |
|---|---|---|
| GPS (posição na pista) | instalado (via PIC → expander, entradas 7/8; ou lat/lon no BUSMASTER) | trajetória, voltas, velocidade/distância sem roda, aceleração lateral, raio, calibração do pneu |
| Amortecedores FL, FR, RL, RR | instalados (potenciômetros lineares; a FT grava também a velocidade) | curso, velocidade, rolagem/arfagem, saltos, frequência natural |
| Velocidade da roda | instalado | velocidade e aceleração precisas, potência na roda, largadas, coast-down |
| Temperatura da CVT | instalado | modelo térmico e projeção do enduro |
| Datalogger (FT450) | instalado | base de tempo; a taxa limita o que dá para medir |
| Medidas do carro | digitadas na página Carro | transformam sinal em grandeza de projeto |
| Rotação do motor | **sugerido** | relação da CVT em tempo real, patinação da correia |
| IMU (acelerômetro + giroscópio) | **sugerido** | g-g e cargas de pouso medidas direto |
| Pressão de freio | **sugerido** | balanço de freio, cilindros mestres, coast-down mais limpo |
| Ângulo do volante | **sugerido** | subesterço/sobresterço, relação de direção |
| Posição do acelerador (TPS) | **sugerido** | curva de potência só com pé no fundo, onde o piloto tira o pé |

A lista completa (onde fica, como chega no log, taxa, resolução) está no app, na aba
**Sensores e projeto**.

---

## 8. Apresentar aos juízes

Na prova de projeto, os juízes querem ver que **as decisões do carro novo saíram de
medidas**. O app foi feito para isso:

1. **Aquisição → aba "Sensores e projeto":** a matriz **sensor → análises que ele permite →
   decisão de projeto**. Cada célula abre o card de explicação. Use para explicar *por que*
   cada sensor está no carro e o que ele destravou — e quais sensores a equipe quer
   instalar (os sugeridos) e o que eles vão permitir.
2. **Ficha do carro:** todos os números de projeto (suspensão, pista, trem de força, CVT),
   cada linha com a coluna **Sensores** e os **pontos de atenção** para o carro novo.
   **Exportar CSV** ou **Imprimir/PDF** — a coluna "Sensores" vai junto. Leve impresso.
3. **Comparar sessões:** mostre a evolução (ex.: curso usado antes/depois da mola nova,
   temperatura da CVT antes/depois do duto).
4. Abra os **cards** na frente do juiz: "O que mostra" → "Sensores usados" → "Como é
   calculado" → "Para o carro do ano que vem" contam a história completa de cada número.

Dica: escolha uma ou duas decisões fortes (ex.: "o curso do amortecedor novo é X porque
usamos Y mm com Z batidas no fim de curso, medidos pelos potenciômetros") e conte do
sensor até a peça.

---

## 9. Testes para fazer com o carro

Os mesmos do app antigo; a lista também está na página **Aquisição**.

1. **Teste de queda** (parado, log gravando): empurre e solte a dianteira e depois a
   traseira, umas **3 vezes cada**, com uns **5 s** entre elas. O app acha os eventos
   sozinho e mede a frequência natural e o ζ (página Ressonância). Com a massa suspensa,
   calcula k = m·(2π·f)² e c = 2ζ·√(k·m).
2. **Coast-down:** reta plana, embale a **~40 km/h** e deixe desacelerar **sem frear** até
   **~10 km/h**. Faça **nos dois sentidos**. Dá Crr e CdA (página Trem de força).
3. **Largadas:** **3 largadas** do carro parado de pelo menos **30 m** (0–10/20/30 m,
   0–20/40 km/h, escorregamento).
4. **CVT:** um log **longo (≥ 15 min)** andando e depois **parado com o motor ligado**, para
   o modelo ver o aquecimento e o resfriamento.
5. **Meça e coloque em Carro:** massa com piloto, massa suspensa por roda (balança por roda
   menos a massa não suspensa), relação roda/amortecedor, curso total, bitolas e
   entre-eixos.

Etiquete cada sessão com o teste (`queda`, `coast-down`, `largada`, `cvt`) para achar e
comparar depois.

---

## 10. Limites das medidas

- **Taxa de gravação:** a 25 Hz o log só enxerga até 12,5 Hz. A frequência da roda
  (~8–15 Hz) fica fora disso. Se a FT permitir, grave os amortecedores mais rápido.
- **GPS:** com passos de 0,86 m a 4 Hz, acelerações e raios saem como **ordem de
  grandeza**.
- **CVT:** o modelo é de 1ª ordem. Não vê a correia patinando em baixa nem o sol direto.
- **Exemplo:** as análises foram conferidas com a sessão de exemplo, gerada por um modelo
  físico com valores conhecidos:

  | Grandeza | Real (modelo) | App |
  |---|---|---|
  | Frequência natural diant. | ~1,6 Hz | 1,61 Hz |
  | ζ diant. | 0,33 | 0,34 |
  | Erro do sensor de roda | +3 % | +2,8 % |
  | Potência na roda | 5,5 kW | 5,4–5,9 kW |
  | Força de tração | 1222 N | 1230 N |
  | Crr | 0,06 | 0,062 |
  | Coeficientes térmicos da CVT | — | erro < 15 % |
  | Ondulação | 3,2 m | 3,2 m |

Cada card de explicação traz as limitações específicas daquele número.

---

## 11. Atalhos de teclado e mouse

**Teclado** (nas páginas com sessão aberta; não valem dentro de campos de texto e
diálogos):

| Tecla | Ação |
|---|---|
| `Espaço` | play / pausa |
| `←` `→` | uma amostra para trás / para frente |
| `Shift` + `←` `→` | 1 s para trás / para frente |
| `Home` / `End` | começo / fim (da volta escolhida ou da sessão) |

**Barra de reprodução** (rodapé de Visão geral, Canais, Mapa e Voltas): ⏮, −1 s, ▶/❚❚,
+1 s, velocidade de **0,25× a 16×**, barra de tempo com as voltas marcadas (arraste para
navegar) e **repetir**.

**Gráficos de canais:** arrastar = zoom no trecho; duplo clique = volta ao todo; o cursor
fica sincronizado entre os gráficos, o mapa e os valores.

**Mapa:** roda do mouse / pinça = zoom; arrastar = mover; clique = ir ao ponto; duplo
clique = enquadrar a pista.
