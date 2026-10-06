# Baja Telemetria

Visualizador de logs do carro: mapa da pista pelo GPS, um gráfico por canal, painel com os
valores em cada instante e reprodução em tempo real (play).

## Como usar

1. Dê dois cliques em `index.html` (Chrome ou Edge). Não precisa instalar nem de servidor, e
   funciona sem internet. Só o fundo de satélite precisa de internet.
2. **Abrir log** (ou arraste o arquivo para a página):
   - **CSV do FT Manager**: a coluna de tempo (`TIME`) e todos os canais viram gráficos. Os
     valores `1797693…` que a FT grava quando não há dado são ignorados.
   - **Log do BUSMASTER** (`.txt` / `.log`): decodifica a posição real do módulo GPS (0x028),
     o fix (0x023), o debug do PIC (0x7E9) e os blocos FTCAN do expander e da FT.
3. **▶** (ou espaço) reproduz em tempo real; dá para mudar a velocidade (0,25× a 16×), arrastar
   a barra de tempo e ligar "repetir".
4. Clique ou arraste nos gráficos para mover o cursor. O mapa e a tabela "Agora" acompanham.
5. Para separar as voltas, use **Linha de largada → Desenhar** (2 cliques no mapa) ou
   **Automática**. Clique numa volta para ver só ela.

| Onde | Ação |
|---|---|
| Gráficos | clicar/arrastar = cursor · Shift+arrastar = zoom no trecho · Ctrl+roda = zoom · Shift+roda = andar no tempo · duplo clique = tudo |
| Mapa | roda/pinça = zoom · arrastar = mover · clique = ir ao ponto · duplo clique = enquadrar |
| Teclado | espaço = play/pausa · ← → = uma amostra (Shift = 1 s) · Home/End |

## GPS no log da FT

O PIC (`pic_gps_expander`) manda a posição como código 0–255 nas entradas 7 (X, Leste) e
8 (Y, Norte) do expander. No log de 05/10 elas aparecem como:

- **X (Leste) = `Back_pressure`** (DataID 0x0177)
- **Y (Norte) = `O2_General`** (DataID 0x0027)

Isso vem da ordem dos DataIDs no bloco 0x2FF do log do BUSMASTER. Para conferir, ande para o
Norte: o Y tem que subir. Se estiver trocado, use **Pista / GPS → Trocar X ↔ Y**. Também dá
para ligar o fundo de satélite e ver se o traçado cai em cima da pista.

Conversão (a mesma do `gps_pos.c`):

```
código = V × 51                       (log em volts)
resolução = (tamanho + 2 × margem) / 255      200 m + 2×10 m → 0,863 m por passo
metros = (código − 127,5) × resolução
```

Os números da pista (centro, tamanho, margem) ficam em **Pista / GPS** e têm que ser iguais aos
do `track_config.h` gravado no PIC.

### Calibração na FT (entradas 7 e 8, linear 0–5 V)

Use **0,00 V = 0** e **5,00 V = 5**. Assim o log fica em volts e o app converte.

Não use "1 V = 1": o PIC trava o valor no ponto mínimo da calibração (`input_value()` em
`ft_expander.c`), então tudo abaixo de 1 V (código < 51, ou seja, mais de ~66 m a Oeste/Sul do
centro) vira 1,000 e se perde. Metros direto na FT também não dá, porque esses canais guardam 3
casas decimais em 16 bits (máx. ±32,767).

## Dados do carro

O botão **Carro** guarda os números que entram nas contas:
- massa com piloto, entre-eixos e bitolas;
- relação roda/amortecedor, curso total dos amortecedores e massa suspensa por roda;
- canal da velocidade da roda e se o sensor está na roda de tração ou na roda livre;
- canal da CVT, temperatura ambiente, limite da CVT e duração do enduro;
- Crr, CdA e potência do motor.

O exemplo usa os dados do carro simulado; os do seu carro ficam guardados à parte.

## Análises

O painel **Análises** tem oito abas. Quase todas valem para o trecho escolhido no canto do
painel: a sessão inteira, a volta selecionada ou o que está visível nos gráficos de canais.

- **Projeto:** ficha com todos os números medidos (suspensão, pista, trem de força, CVT) e
  "pontos de atenção" para o carro novo. **Exportar ficha (CSV)** salva tudo.
- **Mapas por canal:** um mini-mapa da pista para cada canal, cada um com a própria escala.
  Clicar num deles colore o mapa principal. O seletor "cor por" tem todos os canais.
- **Suspensão:**
  - estático, curso usado, % do curso, velocidade p95, % do tempo em compressão/extensão
    lenta e rápida, histogramas;
  - **gradiente de rolagem** (°/g) = rolagem ÷ aceleração lateral;
  - **gradiente de arfagem** (°/g) em frenagem e em aceleração (compare para avaliar
    anti-mergulho e anti-agachamento);
  - **saltos:** tempo no ar t, altura h = g·t²/8, velocidade vertical no pouso v = g·t/2,
    pico de velocidade do amortecedor no pouso e batidas no fim de curso (≥ 95 % do curso);
  - canais novos: arfagem e rolagem (°), afundamento médio, torção e **rugosidade** (RMS da
    velocidade dos amortecedores). Pinte o mapa com a rugosidade para ver os trechos duros.
- **Ressonância:**
  - **teste de queda:** com o carro parado e o log gravando, empurre a dianteira ou a
    traseira e solte. O app acha o evento sozinho e mede a frequência natural e o ζ pelo
    decaimento. Com a massa suspensa, calcula k = m·(2π·f)² e c = 2ζ·√(k·m);
  - **espectro andando**, devagar × rápido: pico que muda com a velocidade é a pista; pico
    parado é o carro. O pico mais alto costuma ser a pista;
  - **pista × ressonância:** o curso reamostrado por distância mostra o comprimento de onda
    λ das ondulações. A velocidade que faz uma ondulação excitar a carroceria é v = fₙ·λ.
- **Trem de força** (velocidade da roda + GPS):
  - **calibração do pneu:** compara a distância da roda com a do GPS e diz por quanto
    multiplicar a circunferência configurada na FT;
  - aceleração pela roda (muito melhor que pelo GPS);
  - **potência na roda** P = (m·a + Crr·m·g + ½·ρ·CdA·v²)·v, por faixa de velocidade, com a
    linha do limite de tração;
  - **largadas:** 0–10/20/30 m, 0–20/40 km/h e escorregamento da roda de tração;
  - **coast-down:** acha trechos em que o carro desacelera sozinho e ajusta
    −m·a = Crr·m·g + ½·ρ·CdA·v². Um botão grava Crr e CdA nos dados do carro.
- **CVT:**
  - **modelo térmico** ajustado por mínimos quadrados:
    dT/dt = θ₁·P − (θ₂ + θ₃·v)·(T − T_amb);
  - mostra a constante de tempo, a temperatura de regime e a **projeção para o enduro**
    repetindo o ritmo do log;
  - mostra em quantos minutos chega no limite e **quanto a mais de troca de calor** seria
    preciso.
- **Dinâmica:** acelerações (longitudinal pela roda, lateral = v × guinada do GPS), diagrama
  g-g, raio de curva e tempo por faixa de velocidade.
- **Comparar voltas:** velocidade × distância, diferença de tempo acumulada e onde ganhou ou
  perdeu tempo. O canal "Delta p/ melhor volta" pinta o mapa.

### Testes para fazer com o carro

1. **Teste de queda** (parado): empurre e solte a dianteira e depois a traseira, umas 3
   vezes cada, com uns 5 s entre elas.
2. **Coast-down:** reta plana, embale a ~40 km/h e deixe desacelerar sem frear até
   ~10 km/h. Faça nos dois sentidos.
3. **Largadas:** 3 largadas do carro parado de pelo menos 30 m.
4. **CVT:** um log longo (≥ 15 min) andando e depois parado com o motor ligado, para o modelo
   ver o aquecimento e o resfriamento.
5. Meça e coloque em "Carro": massa com piloto, massa suspensa por roda (balança por roda
   menos a massa não suspensa), relação roda/amortecedor, curso total, bitolas e entre-eixos.

### Limites

- **Taxa de gravação:** a 25 Hz o log só enxerga até 12,5 Hz. A frequência da roda (~8–15 Hz)
  fica fora disso. Se a FT permitir, grave os amortecedores mais rápido.
- **GPS:** com passos de 0,86 m a 4 Hz, acelerações e raios saem como ordem de grandeza.
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

## Exportar

**Exportar CSV** gera o log com todos os canais calculados como colunas novas (GPS, roda,
potência, acelerações, suspensão e delta), mais `GPS_lat`, `GPS_lon` e `Lap`.

## Código

Só HTML, CSS e JavaScript, sem bibliotecas e sem etapa de build.

```
index.html        página
css/app.css       visual (tema claro/escuro)
js/util.js        utilidades
js/parsers.js     leitura do CSV da FT e do BUSMASTER
js/gps.js         código → metros → lat/lon, velocidade, distância, voltas
js/mapview.js     mapa (canvas, satélite Esri)
js/charts.js      gráficos empilhados
js/analysis.js    cálculos: suspensão, espectro, teste de queda, g-g, voltas
js/vehicle.js     cálculos: roda × GPS, potência, largadas, coast-down, CVT, rolagem, saltos
js/plots.js       gráficos XY das análises
js/analysisui.js  painel de análises (mapas, suspensão, ressonância, dinâmica, voltas)
js/vehicleui.js   abas Projeto, Trem de força e CVT + rolagem, saltos e pista × ressonância
js/demo.js        sessão de exemplo (modelo físico do carro: suspensão, tração, CVT)
js/app.js         estado, play e interface
```

As configurações (pista, canais visíveis, tema) ficam salvas no navegador.
