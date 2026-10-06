# Telemetria · Mauá Racing Baja

Telemetria do carro de Baja SAE da **Mauá Racing Baja**: transforma os logs da **FuelTech FT450** (CSV do
FT Manager) e do **BUSMASTER** (CAN) em mapa da pista pelo GPS, gráficos sincronizados e
análises de **suspensão, ressonância, trem de força, CVT e dinâmica**, com o objetivo de
**projetar o carro do ano que vem a partir de medidas**. Todo número e gráfico diz de
quais sensores saiu e abre um card de explicação (o que é, como é calculado, como usar no
projeto, limites) — para a equipe e para os juízes. O log é analisado no navegador
(funciona sem internet na pista); um servidor opcional guarda a biblioteca de sessões da
equipe.

![Visão geral do teste com a sessão de exemplo](docs/img/visao-geral.png)

## Principais recursos

- **Logs:** CSV do FT Manager (FT450 + expander) e log do BUSMASTER (GPS `0x028`/`0x023`,
  debug do PIC, blocos FTCAN); vários arquivos de uma vez, com data tirada do arquivo.
- **Sessão:** visão geral com pontos de atenção, canais empilhados no tempo ou na
  distância (estilo RaceStudio, layouts salvos, volta de referência sobreposta), mapa
  colorido por qualquer canal (com satélite), voltas e onde ganhou/perdeu tempo, dispersão
  X × Y com mapa de calor, reprodução em tempo real (0,25×–16×), anotações, **Trecho**
  (sessão, volta ou janela) valendo para todas as análises.
- **Engenharia:** curso e velocidade dos amortecedores, rolagem/arfagem, saltos e fim de
  curso; teste de queda (frequência natural e ζ), regra de Olley, espectro, pista ×
  ressonância; calibração do pneu, potência na roda, largadas, coast-down (Crr, CdA);
  modelo térmico da CVT e projeção do enduro; g-g, raio de curva.
- **Projeto:** ficha do carro com todos os números de projeto e a coluna “Sensores”
  (CSV e impressão/PDF), comparação de sessões ao longo da temporada, matriz sensor ×
  análise × decisão de projeto para os juízes.
- **Aquisição:** papel de cada canal, qualidade dos dados com “o que fazer” (sensor sem
  sinal, amortecedor parado, GPS sem fix…), fórmulas da equipe, calibração das entradas
  7/8 da FT e a lista de testes com o carro.
- **Cards de explicação:** clicando em qualquer número ou gráfico — o que mostra, sensores
  usados, como é calculado, uso no carro do ano que vem, limites, teste.
- **Equipe:** servidor com contas, convites e papéis, biblioteca de sessões, perfis de
  carro e pista, anotações. Imagem Docker pronta. Sem servidor, tudo funciona no navegador
  (inclusive sem internet), com backup em arquivo.
- **Números fiéis:** os cálculos são o porte exato do app antigo (`legacy/`), validado com
  um modelo físico, com testes de equivalência para cada função.

| Card de explicação | Matriz sensor × projeto (para os juízes) |
|---|---|
| ![Card de explicação da frequência natural](docs/img/card-explicacao.png) | ![Matriz sensor × projeto](docs/img/aquisicao-matriz.png) |

Para ver o app com dados prontos, abra-o com `?exemplo=1` no endereço (ex.:
`http://localhost:8080/?exemplo=1#/ressonancia`): a sessão de exemplo, gerada por um modelo
físico do carro, abre sozinha na página pedida. O guia [`docs/USO.md`](docs/USO.md) tem as
capturas de todas as páginas, o roteiro para apresentar aos juízes e os achados dos logs
reais de 05/10.

## Como rodar

Precisa do **Node.js 22.12+** e do Git.

```sh
git clone https://github.com/ricardorlfischer-ui/baja-telemetria.git
cd baja-telemetria
npm install
```

**Desenvolvimento** (servidor na porta 8080 + app com recarga automática na 5173):

```sh
npm run dev          # abra http://localhost:5173
npm run dev:web      # só o app (biblioteca local, sem servidor)
```

**Produção** (o servidor serve o app e a API):

```sh
npm run build
npm start            # abra http://localhost:8080 — dados em apps/server/data
```

**Docker:**

```sh
docker compose up -d --build     # abra http://localhost:8080 — dados em ./data
```

Hospedagem para a equipe (PC + Cloudflare Tunnel, Fly.io, Railway, Oracle Cloud, GitHub
Pages), backup e atualização: [`docs/IMPLANTACAO.md`](docs/IMPLANTACAO.md).

## Estrutura do repositório

```
packages/core/       @baja/core    cálculos puros em TypeScript (leitura dos logs, GPS, suspensão,
                                   trem de força, CVT, dinâmica, relatórios, sensores e explicações);
                                   roda no navegador e no servidor; testes de equivalência
apps/web/            @baja/web     interface React + Mantine + uPlot (Vite)
apps/server/         @baja/server  servidor Fastify + SQLite: contas, sessões, carros, pistas, anotações
legacy/                            app antigo (HTML/JS), intocado — referência dos testes
samples/                           logs reais grandes e firmware do PIC (fora do git)
docs/                              arquitetura, guia de uso e de implantação; docs/img/ = capturas de tela
.github/workflows/                 CI, imagem Docker (GHCR) e GitHub Pages
Dockerfile, docker-compose.yml     imagem e servidor num PC da equipe
```

## Documentação

| Documento | Para quem |
|---|---|
| [`docs/USO.md`](docs/USO.md) | a equipe: páginas (com capturas), enviar e abrir logs, Trecho e reprodução, cards e sensores, como apresentar aos juízes, exemplo real de 05/10, GPS, dados do carro, testes, atalhos |
| [`docs/IMPLANTACAO.md`](docs/IMPLANTACAO.md) | quem cuida do servidor: opções de hospedagem, primeiro acesso (admin, convites, papéis), backup, segurança |
| [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) | quem mexe no código: o contrato do projeto |
| [`CLAUDE.md`](CLAUDE.md) | regras curtas para quem programa (pessoa ou agente) |
| [`legacy/README.md`](legacy/README.md) | o app antigo e a validação das contas |

## Como contribuir

1. Leia a seção de [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) da parte em que vai mexer.
2. Regras de ouro: **os números não mudam** (`packages/core` é porte fiel de `legacy/js`;
   nada de "melhorar" fórmulas, limiares ou arredondamentos), `legacy/` é só leitura,
   **todo número e gráfico mostra de quais sensores saiu**, interface e comentários em
   português do Brasil, nada de dependência nova sem necessidade (e, se precisar,
   registre em `ARQUITETURA.md`).
3. Trabalhe num branch e abra um pull request para `main`.
4. Antes de enviar, na raiz:
   ```sh
   npm run typecheck
   npm test
   npm run build
   ```
   O CI (`.github/workflows/ci.yml`) roda os mesmos três comandos em todo push e PR.

## Licença

Uso privado da equipe. Todos os direitos reservados; não redistribua o código, a imagem
Docker nem os logs sem autorização da equipe.
