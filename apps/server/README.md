# @baja/server — servidor da equipe

Biblioteca de sessões da equipe (Fastify 5 + SQLite): contas, logs enviados, carros, pistas,
anotações e o resumo de cada sessão calculado pelo `@baja/core` (as mesmas contas do app).
Contrato completo em [`docs/ARQUITETURA.md`](../../docs/ARQUITETURA.md), seção 5.

## Como rodar

Na raiz do repositório:

```bash
npm run dev:server                 # desenvolvimento (tsx watch, porta 8080)
npm run build                      # app web + servidor (apps/server/dist/index.js com o core embutido)
npm start                          # node apps/server/dist/index.js
```

Na primeira vez, abra o app (ou chame `POST /api/auth/setup`) para criar o administrador.
Depois disso, novas pessoas entram por convite (Equipe → Convites) ou são criadas pelo admin
com uma senha temporária.

Testes: `npm test -w @baja/server` (banco em pasta temporária, fixtures reais de
`packages/core/test/fixtures`). Tipos: `npm run typecheck -w @baja/server`.

## Variáveis de ambiente

| Variável | Padrão | |
|---|---|---|
| `PORT` | `8080` | porta HTTP |
| `HOST` | `0.0.0.0` | interface |
| `DATA_DIR` | `./data` | `db.sqlite`, logs em `sessions/<id>.gz`, segredo do JWT em `secret` (gerado se não existir) |
| `JWT_SECRET` | (arquivo) | sobrepõe o segredo de `DATA_DIR/secret`. Mínimo 32 caracteres; curto ou o texto de exemplo do `docker-compose.yml` → o servidor não sobe (com ele qualquer um forjaria um token de admin) |
| `CORS_ORIGINS` | vazio | origens permitidas, separadas por vírgula (ex.: `https://equipe.github.io`); vazio = só a mesma origem |
| `MAX_UPLOAD_MB` | `100` | tamanho máximo do log enviado |
| `WEB_DIST` | `../web/dist` | build do app servido em `/` (padrão relativo a `apps/server`); sem a pasta, `/` mostra como gerar |
| `TRUST_PROXY` | vazio | atrás de proxy (Cloudflare Tunnel, nginx, Caddy), para o limite de tentativas usar o IP real. `true` = um proxy na frente: vale o último endereço do `X-Forwarded-For` (o que o proxy acrescentou), e só se a conexão vier de rede local (127.x, 10.x, 172.16–31.x, 192.168.x, 100.64/10, fc00::/7). Um número = quantos proxies em fila; ou a lista de IPs/faixas dos proxies (`127.0.0.1, 10.0.0.0/8`) |
| `ANALYSIS_MEMORY_MB` | `1536` | memória máxima do processo que lê e analisa cada log (um log denso de 28 MB usa ~550 MB) |
| `ANALYSIS_TIMEOUT_S` | `300` | tempo máximo da análise de um log |
| `LOG_LEVEL` | `info` | nível do log (senhas e tokens nunca aparecem) |

Backup: copie a pasta `DATA_DIR` inteira (com o servidor parado, ou use `sqlite3 db.sqlite .backup`).

## Papéis

- `viewer`: só lê (sessões, arquivos, carros, pistas, anotações).
- `member`: envia sessões; cria carros/pistas; edita/apaga as sessões, anotações, carros e
  pistas que criou (mudar os params de um perfil muda o resumo de todas as sessões que o usam,
  por isso só o dono ou um admin). Qualquer membro pode pedir o recálculo de um resumo.
- `admin`: tudo, mais usuários e convites. O último administrador ativo não pode ser
  rebaixado, desativado nem apagado.

Token JWT (`Authorization: Bearer <token>`) válido por 30 dias (o token precisa ter `exp` e
`iat`, e vale no máximo 30 dias desde o `iat`); troca de senha ou desativação invalida os tokens
antigos na hora. A troca de senha devolve um token novo: guarde-o.

## Rotas (`/api`)

Erros sempre em JSON `{ "error": "mensagem em português" }`.

| Rota | Quem | |
|---|---|---|
| `GET /info` | todos | `{ name, version, needsSetup }` |
| `GET /health` | todos | `{ ok, uptime, pendingSummaries }` |
| `POST /auth/setup` | só sem usuários | `{ name, email, password }` → `{ token, user }` (primeiro admin) |
| `POST /auth/login` | todos (10/min por IP) | `{ email, password }` → `{ token, user }` |
| `POST /auth/register` | com convite | `{ code, name, email, password }` → `{ token, user }` (papel do convite) |
| `GET /auth/me` | logado | `{ user }` |
| `POST /auth/password` | logado (10/min por IP) | `{ oldPassword, newPassword }` → `{ token, user }` (o token antigo para de valer) |
| `GET /users` · `POST /users` | admin | criar: `{ name, email, role?, password? }`; sem senha volta `tempPassword` (uma vez) |
| `PATCH /users/:id` · `DELETE /users/:id` | admin | `{ name?, role?, disabled?, password? }` |
| `GET /invites` · `POST /invites` | admin | criar: `{ role?, days? }` (padrão member, 7 dias) |
| `DELETE /invites/:code` | admin | revoga |
| `GET /sessions?q&trackId&carId&tag` | viewer+ | lista por data (mais nova primeiro), com resumo e quem enviou |
| `POST /sessions` | member+ | multipart: `file` + `meta` (JSON: `name, date, trackId, carId, driver, tags, notes, allowDuplicate`); log repetido (mesmo SHA-256) → 409 `{ error, id }` |
| `GET /sessions/:id` | viewer+ | |
| `PATCH /sessions/:id` | dono/admin | dados da sessão; trocar `trackId`/`carId` recalcula o resumo |
| `DELETE /sessions/:id` | dono/admin | apaga sessão, arquivo e anotações |
| `GET /sessions/:id/file` | viewer+ | log original (gzip quando o cliente aceita) |
| `POST /sessions/:id/summary` | member+ | recalcula o resumo com o carro/pista da sessão |
| `GET /cars` · `GET /cars/:id` · `POST /cars` · `PUT /cars/:id` · `DELETE /cars/:id` | viewer lê, member+ cria, dono/admin muda e apaga | `{ name, params }` (CarConfig + `susp`) |
| `GET /tracks` · `GET /tracks/:id` · `POST /tracks` · `PUT /tracks/:id` · `DELETE /tracks/:id` | idem | `{ name, params }` (TrackConfig, com `line`; `sizeX`, `sizeY` e `margin` até 100000 m) |
| `GET /sessions/:id/comments` · `POST /sessions/:id/comments` | viewer lê, member+ escreve | `{ t?, text }` (t em s no log) |
| `DELETE /comments/:id` | autor/admin | |

### Resumo da sessão

Calculado no envio com `parseLog` → `computeSession` → `sessionSummary` do core:

- pista: `params` do perfil de pista (TrackConfig); sem linha de largada salva, usa a linha
  automática;
- carro: `params` do perfil do carro (CarConfig + `susp` opcional);
- sem perfil: padrões do core.

O resumo é guardado com `summary_version`. Na subida o servidor recalcula em segundo plano os
resumos de versão antiga (`SUMMARY_VERSION` do core); ao mudar os params de um carro/pista
(ou apagar o perfil), recalcula as sessões que usam aquele perfil. Se o carro/pista mudar
enquanto uma conta está rodando, o resultado é descartado e vale o recálculo pedido pela
mudança: o resumo guardado é sempre o do carro/pista atuais.

A leitura e a conta rodam num **processo à parte** (`src/analysis-worker.ts`, iniciado por
`src/analyzer.ts`), um log por vez: um log grande (segundos de conta, centenas de MB) não para
o servidor, e um log que faça a conta estourar `ANALYSIS_MEMORY_MB` ou `ANALYSIS_TIMEOUT_S`
derruba só esse processo. Se o log foi lido mas o resumo não deu, a sessão fica guardada com
`summaryError`; se nem a leitura deu, o envio responde 400 e nada fica guardado. No build, o
tsup gera `dist/index.js` e `dist/analysis-worker.js` (os dois precisam estar juntos).

Data do teste quando `meta.date` não vem: nome do arquivo da FT (`Log 3_20261005-1644.csv` →
`2026-10-05T16:44`), cabeçalho `START DATE AND TIME` do BUSMASTER ou, sem ele, a hora do
primeiro quadro (`clock0`) com o dia do envio.
