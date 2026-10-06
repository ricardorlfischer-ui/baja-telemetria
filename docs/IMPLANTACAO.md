# Implantação — como colocar a Telemetria da Mauá Racing Baja no ar para a equipe

Guia passo a passo para quem vai cuidar do servidor da equipe. Não precisa ser da
computação: siga na ordem e copie os comandos. O contrato técnico está em
[`ARQUITETURA.md`](ARQUITETURA.md) (seções 5 e 6); o guia de uso do app está em
[`USO.md`](USO.md).

## Sumário

1. [Visão geral: o app e o servidor](#1-visão-geral-o-app-e-o-servidor)
2. [Rodar no seu computador](#2-rodar-no-seu-computador)
3. [Primeiro acesso: admin, convites e papéis](#3-primeiro-acesso-admin-convites-e-papéis)
4. [Onde hospedar o servidor da equipe](#4-onde-hospedar-o-servidor-da-equipe)
   - [A. PC/notebook da equipe + Cloudflare Tunnel](#a-pcnotebook-da-equipe--cloudflare-tunnel)
   - [B. Fly.io](#b-flyio)
   - [C. Railway](#c-railway)
   - [D. Oracle Cloud Always Free](#d-oracle-cloud-always-free)
5. [App no GitHub Pages (opcional)](#5-app-no-github-pages-opcional)
6. [Backup e restauração](#6-backup-e-restauração)
7. [Atualizar para uma versão nova](#7-atualizar-para-uma-versão-nova)
8. [Acesso ao código (GitHub) × contas do app](#8-acesso-ao-código-github--contas-do-app)
9. [Segurança](#9-segurança)
10. [Referência: variáveis, imagem e workflows](#10-referência-variáveis-imagem-e-workflows)
11. [Problemas comuns](#11-problemas-comuns)

---

## 1. Visão geral: o app e o servidor

A Telemetria da Mauá Racing Baja tem duas partes:

| Parte | O que faz | Precisa de internet? |
|---|---|---|
| **App no navegador** (`apps/web`) | abre o log (CSV da FT450 ou BUSMASTER) e faz **todas** as contas e gráficos no próprio navegador | não: depois de carregado, funciona offline na pista |
| **Servidor da equipe** (`apps/server`, opcional) | a **biblioteca da equipe**: contas, logs guardados num lugar só, dados dos carros e pistas, anotações, métricas por sessão para comparar testes | só para acessar de fora da rede local |

Sem servidor, cada pessoa tem a sua biblioteca **local** (guardada no navegador). Com o
servidor, todo mundo vê as mesmas sessões. O servidor também **serve o próprio app**: quem
abre o endereço do servidor já recebe o app pronto, com a biblioteca da equipe ligada.

```
  navegador (app)  ── HTTPS ──>  servidor da equipe (Node + SQLite)
                                   └── pasta de dados (DATA_DIR)
                                        ├── db.sqlite        usuários, sessões, carros, pistas, anotações
                                        ├── sessions/<id>.gz os logs enviados (comprimidos)
                                        └── secret           segredo dos logins (gerado na 1ª vez)
```

**Tudo o que importa fica na pasta de dados.** Fazer backup = copiar essa pasta
(seção 6).

### Qual opção escolher?

| Situação | Sugestão |
|---|---|
| Só quero testar / usar sozinho | [Seção 2](#2-rodar-no-seu-computador): roda no seu PC |
| A equipe tem um PC ou notebook que pode ficar ligado | [A](#a-pcnotebook-da-equipe--cloudflare-tunnel): grátis |
| Não tem PC ligado e a equipe pode pagar ~US$ 3–5/mês | [B — Fly.io](#b-flyio) ou [C — Railway](#c-railway) |
| Não tem PC e não pode pagar | [D — Oracle Cloud Always Free](#d-oracle-cloud-always-free) (dá mais trabalho) |
| Quero o app num endereço fixo mesmo sem servidor | [GitHub Pages](#5-app-no-github-pages-opcional) |

---

## 2. Rodar no seu computador

### 2.1 Instalar o Node.js

1. Baixe o **Node.js 22 LTS** (ou mais novo) em <https://nodejs.org> e instale com as
   opções padrão. Precisa ser **22.12 ou mais novo**.
2. Abra um terminal (no Windows: **Git Bash** ou **PowerShell**) e confira:
   ```sh
   node -v     # v22.12.0 ou maior
   npm -v
   ```
3. Instale o **Git** (<https://git-scm.com>) se ainda não tiver.

### 2.2 Baixar o código

O repositório é privado: você precisa ter sido adicionado como colaborador
([seção 8](#8-acesso-ao-código-github--contas-do-app)).

```sh
git clone https://github.com/ricardorlfischer-ui/baja-telemetria.git
cd baja-telemetria
npm install
```

### 2.3 Modo desenvolvimento (para quem mexe no código)

```sh
npm run dev
```

Sobe o servidor na porta **8080** e o app (Vite) na porta **5173**. Abra
<http://localhost:5173>. O app recarrega sozinho quando você salva um arquivo; as chamadas
`/api` vão para o servidor local. Os dados ficam em `apps/server/data/`.

- Só o app, sem servidor (biblioteca local): `npm run dev:web`
- Só o servidor: `npm run dev:server`

### 2.4 Modo produção (como fica no servidor)

```sh
npm run build
npm start
```

Abra <http://localhost:8080>. É o mesmo que roda na imagem Docker: um processo Node que
serve o app e a API. Para outros computadores da **mesma rede** (Wi-Fi do box, da oficina)
acessarem, use `http://IP-DO-SEU-PC:8080` (descubra o IP com `ipconfig` no Windows ou
`ip addr` no Linux; o Firewall do Windows vai perguntar se libera a porta: libere só em
"redes privadas").

As configurações vêm de variáveis de ambiente ([seção 10](#10-referência-variáveis-imagem-e-workflows)).
Exemplo no Git Bash:

```sh
DATA_DIR=/c/baja-dados PORT=8080 npm start
```

### 2.5 Com Docker (opcional)

Com o [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado:

```sh
docker compose up -d --build
```

Abra <http://localhost:8080>. Os dados ficam na pasta `data/` ao lado do
`docker-compose.yml`. Mais detalhes na [opção A](#a-pcnotebook-da-equipe--cloudflare-tunnel).

---

## 3. Primeiro acesso: admin, convites e papéis

1. **Criar o administrador.** Abra o app servido pelo servidor (ou, no app de outro
   endereço, vá em **Preferências → Servidor da equipe**, cole o endereço, clique em
   **Testar conexão** e depois **Conectar**). Enquanto o servidor não tem nenhum usuário
   (`/api/info` responde `needsSetup: true`), a tela **Entrar** — aberta pelo selo
   **Servidor · entrar** no canto direito do cabeçalho ou pelo botão **Entrar** da página
   **Sessões** — mostra **Primeiro acesso**: preencha nome, e-mail, senha (mínimo 8
   caracteres) e **Repita a senha**, e clique em **Criar administrador e entrar**. Só
   funciona enquanto não existe nenhum usuário, então **faça isso logo depois de subir o
   servidor**, antes de divulgar o endereço.
2. **Convidar a equipe.** Na página **Equipe** (`#/equipe`, no grupo Configuração do menu;
   só funciona com servidor), seção **Convites** → **Novo convite**: escolha o **Papel de
   quem usar o convite** e a **Validade** (em dias; padrão 7) e clique em **Criar
   convite**. O app mostra o **código** e um **link** (**Copiar código** / **Copiar link**,
   também nos ícones da tabela de convites). Mande o link (WhatsApp, e-mail): ele abre o
   app já na tela de cadastro com o código preenchido — e, se o app estiver em outro
   endereço (ex.: GitHub Pages), leva o endereço do servidor junto e pergunta **Usar este
   servidor**. Convite não usado pode ser **revogado** na tabela.
   Alternativa: em **Usuários → Novo usuário** o admin cria a conta direto; sem digitar
   senha, o servidor gera uma **senha temporária**, mostrada uma única vez.
3. **A pessoa cria a conta.** Na tela **Entrar**, aba **Criar conta com convite**: código
   do convite, nome, e-mail, senha e **Repita a senha** → **Criar conta e entrar**. Cada
   código vale para **uma** pessoa e expira na validade escolhida. Depois, cada um troca a
   própria senha em **Equipe → Minha conta → Trocar a senha** (ou **Preferências → Conta →
   Equipe e trocar a senha**); **Sair** fica em **Preferências → Conta**.
4. **Papéis** (no app aparecem como Leitor, Membro e Administrador):

   | Papel | Pode |
   |---|---|
   | `viewer` (Leitor) | ver e analisar as sessões, carros e pistas da equipe; não envia nem altera nada. Bom para professores, patrocinadores, juízes |
   | `member` (Membro) | tudo do leitor + enviar logs, criar perfis de carro e pista, editar/apagar o que é seu; anotações |
   | `admin` (Administrador) | tudo: usuários, convites, papéis, apagar qualquer coisa |

   O papel de cada usuário muda na tabela **Usuários** da página Equipe; lá também dá para
   desativar uma conta, apagá-la ou **definir uma senha nova** para quem esqueceu.

   Tenha **pelo menos dois admins** (se alguém sair da equipe ou esquecer a senha, o outro
   resolve). Quem saiu da equipe: desative a conta na página Equipe (desativar encerra as
   sessões abertas da pessoa sem apagar o que ela enviou).

---

## 4. Onde hospedar o servidor da equipe

Em todas as opções o servidor é o mesmo (a imagem Docker deste repositório ou
`npm run build && npm start`). O que muda é **onde ele roda** e **como chega na internet
com HTTPS**.

| | A. PC da equipe + Cloudflare | B. Fly.io | C. Railway | D. Oracle Always Free |
|---|---|---|---|---|
| Custo | grátis (+ domínio opcional, ~R$ 40/ano) | ~US$ 3–5/mês | ~US$ 5/mês (plano Hobby) | grátis |
| Cartão de crédito | não (só se comprar domínio) | sim | sim | sim (para verificação) |
| Dificuldade | fácil | média (linha de comando) | fácil (pelo site) | difícil (Linux, firewall) |
| Fica no ar se... | o PC estiver ligado e com internet | sempre | sempre | sempre |
| HTTPS | automático (Cloudflare) | automático | automático | você configura (Caddy) |
| Backup | copiar a pasta `data/` | snapshots diários do volume + cópia manual | cópia manual | copiar a pasta `data/` |

### A. PC/notebook da equipe + Cloudflare Tunnel

Ideal se a equipe tem um computador que pode ficar ligado (na oficina, no laboratório). O
**Cloudflare Tunnel** publica o servidor na internet **com HTTPS** sem abrir portas no
roteador e sem IP fixo (funciona até na rede da universidade).

#### A.1 Subir o servidor

**Com Docker (recomendado):**

1. Instale o Docker:
   - Windows/Mac: [Docker Desktop](https://www.docker.com/products/docker-desktop/) (no
     Windows ele pede o WSL 2; aceite). Em **Settings → General**, marque *Start Docker
     Desktop when you sign in*.
   - Linux (Ubuntu/Debian): `sudo apt install docker.io docker-compose-v2` e
     `sudo usermod -aG docker $USER` (saia e entre de novo).
2. Baixe o código (seção 2.2) e, na pasta do projeto:
   ```sh
   docker compose up -d --build
   ```
3. Abra <http://localhost:8080> e crie o admin ([seção 3](#3-primeiro-acesso-admin-convites-e-papéis)).

O `docker-compose.yml` já tem `restart: unless-stopped`: o servidor volta sozinho quando o
PC reinicia (desde que o Docker inicie com o sistema). Os dados ficam em `./data`.

Comandos do dia a dia:

```sh
docker compose ps          # está rodando? (coluna STATUS: healthy)
docker compose logs -f     # ver o que está acontecendo (Ctrl+C para sair)
docker compose restart     # reiniciar
docker compose down        # parar (os dados continuam em ./data)
```

**Sem Docker (só Node):** `npm install`, `npm run build` e `npm start` (seção 2.4). Para
iniciar sozinho com o Windows, crie uma tarefa no **Agendador de Tarefas** ("Ao fazer
logon", programa `cmd.exe`, argumentos `/c cd /d C:\caminho\baja-telemetria && npm start`).

Deixe o PC sem suspender: no Windows, **Configurações → Sistema → Energia → Suspender:
Nunca** (na tomada).

#### A.2 Teste rápido: endereço temporário (trycloudflare)

Instale o `cloudflared`
([página de downloads](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/);
no Windows: `winget install --id Cloudflare.cloudflared`) e rode:

```sh
cloudflared tunnel --url http://localhost:8080
```

Ele mostra um endereço do tipo `https://palavras-aleatorias.trycloudflare.com`. Qualquer
pessoa com esse link acessa o servidor, com HTTPS. **Só para teste**: o endereço muda toda
vez que você roda o comando, não tem garantia de funcionamento e cai quando você fecha o
terminal. Não precisa de conta.

#### A.3 Endereço fixo: tunnel nomeado

Precisa de uma conta grátis na Cloudflare e de um **domínio** cadastrado nela (um `.com.br`
custa ~R$ 40/ano no registro.br; depois troque os servidores DNS para os da Cloudflare,
como o painel da Cloudflare ensina).

**Jeito 1 — pelo painel (mais fácil, junto com o Docker Compose):**

1. Painel da Cloudflare → **Zero Trust → Networks → Tunnels → Create a tunnel** →
   *Cloudflared* → nome `baja`.
2. Copie o **token** que aparece no comando de instalação (o texto longo depois de
   `--token`).
3. Em **Public Hostname**, crie `telemetria.seudominio.com.br` → Service `HTTP` →
   URL `baja-telemetria:8080`.
4. Crie um arquivo `.env` na pasta do projeto (ele não vai para o git):
   ```sh
   TUNNEL_TOKEN=cole-o-token-aqui
   ```
5. Crie `docker-compose.override.yml` ao lado do `docker-compose.yml`:
   ```yaml
   services:
     baja-telemetria:
       ports: !override
         - "127.0.0.1:8080:8080"   # na internet, só pelo túnel
       environment:
         TRUST_PROXY: "true"
     cloudflared:
       image: cloudflare/cloudflared:latest
       restart: unless-stopped
       command: tunnel --no-autoupdate run
       environment:
         TUNNEL_TOKEN: ${TUNNEL_TOKEN}
       depends_on:
         - baja-telemetria
   ```
6. `docker compose up -d`. Abra `https://telemetria.seudominio.com.br`.

**Jeito 2 — pela linha de comando (sem Docker):**

```sh
cloudflared tunnel login                         # abre o navegador para autorizar o domínio
cloudflared tunnel create baja                   # cria o túnel e um arquivo de credenciais
cloudflared tunnel route dns baja telemetria.seudominio.com.br
```

Crie `~/.cloudflared/config.yml` (no Windows: `C:\Users\<você>\.cloudflared\config.yml`):

```yaml
tunnel: baja
credentials-file: /home/<você>/.cloudflared/<ID-DO-TUNEL>.json
ingress:
  - hostname: telemetria.seudominio.com.br
    service: http://localhost:8080
  - service: http_status:404
```

Teste com `cloudflared tunnel run baja` e, funcionando, instale como serviço para iniciar
com o sistema: `cloudflared service install` (Linux: com `sudo`; Windows: terminal como
administrador).

**Prós:** grátis, os dados ficam com a equipe, dá para usar na rede local mesmo sem
internet. **Contras:** depende do PC ligado e da internet do lugar; quem cuida do PC
precisa cuidar do backup.

### B. Fly.io

Roda o contêiner num servidor da Fly.io, com HTTPS e região em São Paulo (`gru`). Precisa
de cartão de crédito. Custo aproximado: máquina `shared-cpu-1x` com 512 MB (~US$ 3/mês se
ficar ligada direto; menos com desligamento automático) + volume de 1 GB (~US$ 0,15/mês).
Conte com **~US$ 5/mês** com folga. Confira os preços atuais em <https://fly.io/docs/about/pricing/>.

1. Instale o `flyctl` (<https://fly.io/docs/flyctl/install/>; no Windows:
   `pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"`) e entre:
   ```sh
   fly auth signup     # ou: fly auth login
   ```
2. Na pasta do projeto, crie `fly.toml` (troque o nome do app, que precisa ser único na
   Fly):
   ```toml
   app = "baja-telemetria-suaequipe"
   primary_region = "gru"            # São Paulo

   [build]
     dockerfile = "Dockerfile"

   [env]
     NODE_ENV = "production"
     PORT = "8080"
     DATA_DIR = "/data"
     TRUST_PROXY = "true"
     # CORS_ORIGINS = "https://ricardorlfischer-ui.github.io"

   [[mounts]]
     source = "baja_data"
     destination = "/data"

   [http_service]
     internal_port = 8080
     force_https = true
     auto_stop_machines = "stop"     # desliga sem acesso (economiza); liga no 1º acesso
     auto_start_machines = true
     min_machines_running = 0

     [[http_service.checks]]
       grace_period = "20s"
       interval = "30s"
       method = "GET"
       path = "/api/health"
       timeout = "5s"

   [[vm]]
     size = "shared-cpu-1x"
     memory = "512mb"
   ```
3. Crie o app, o volume e o segredo, e publique:
   ```sh
   fly launch --no-deploy --copy-config          # usa o fly.toml acima
   fly volumes create baja_data --region gru --size 1
   fly secrets set JWT_SECRET=$(openssl rand -hex 32)
   fly deploy --ha=false                          # UMA máquina só (o SQLite fica num volume só)
   ```
   O endereço fica `https://baja-telemetria-suaequipe.fly.dev`. Crie o admin logo em
   seguida.
4. Úteis: `fly logs` (ver o servidor), `fly status`, `fly ssh console` (terminal dentro da
   máquina), `fly volumes snapshots list baja_data` (a Fly guarda snapshots diários do
   volume por alguns dias).

> **Importante:** mantenha **uma** máquina (`fly scale count 1`). Cada volume pertence a
> uma máquina; com duas, cada uma teria um banco diferente.

**Prós:** sempre no ar, HTTPS e domínio prontos, servidor perto (São Paulo).
**Contras:** pago, cartão de crédito, linha de comando.

### C. Railway

Tudo pelo site, sem linha de comando. Plano **Hobby: US$ 5/mês** (inclui US$ 5 de uso, o
que costuma cobrir este servidor). Preços em <https://railway.com/pricing>.

1. Entre em <https://railway.com> com a conta do GitHub.
2. **New Project → Deploy from GitHub repo** → escolha `baja-telemetria` (autorize o
   Railway a ver o repositório privado). Ele encontra o `Dockerfile` e constrói sozinho.
3. Crie um **volume** ligado ao serviço (clique com o botão direito no quadro do projeto →
   *Volume*, ou `Ctrl+K` → "volume"), com *Mount path* `/data`.
4. No serviço, **Variables**:
   - `PORT` = `8080` (deixa a porta fixa, igual à do domínio do passo 5);
   - `TRUST_PROXY` = `true`;
   - `JWT_SECRET` = um texto longo e aleatório (o botão de gerar valor do Railway serve);
   - `CORS_ORIGINS` = `https://ricardorlfischer-ui.github.io` se for usar o GitHub Pages;
   - `MAX_UPLOAD_MB` se precisar enviar logs maiores que 100 MB.

   (`DATA_DIR=/data` já vem na imagem.)
5. **Settings → Networking → Generate Domain**, porta **8080**. O endereço fica
   `https://<algo>.up.railway.app`. Abra e crie o admin.
6. Cada push em `main` publica de novo sozinho (dá para desligar em Settings).

O volume do Railway chega com dono `root`; a imagem já trata disso (acerta a pasta e roda o
servidor como usuário comum), não precisa de `RAILWAY_RUN_UID`.

**Prós:** o mais fácil das opções pagas, deploy automático. **Contras:** pago, backup é
manual (`railway ssh` / download), sem servidores no Brasil (EUA, Europa ou Ásia: um
pouco mais lento para enviar logs grandes).

### D. Oracle Cloud Always Free

Uma máquina virtual grátis para sempre (dentro dos limites *Always Free*). Dá mais
trabalho: você cuida do Linux, do firewall, do HTTPS e das atualizações.

1. Crie a conta em <https://www.oracle.com/cloud/free/> (pede cartão só para verificar;
   escolha a região **Brazil East (São Paulo)** ou **Vinhedo** — a região não muda depois).
2. **Compute → Instances → Create instance**:
   - Imagem **Ubuntu 24.04**;
   - Shape **VM.Standard.A1.Flex** (ARM Ampere: 1 OCPU e 6 GB já sobram; a imagem do
     GHCR tem versão arm64) ou **VM.Standard.E2.1.Micro** (AMD, 1 GB). Se aparecer
     *Out of capacity* no A1, tente de novo em outro horário ou use o E2.1.Micro;
   - baixe a chave SSH que ele gera.
3. Abra as portas 80 e 443:
   - na Oracle: **Networking → Virtual Cloud Networks → (sua VCN) → Security Lists →
     Default → Add Ingress Rules**: origem `0.0.0.0/0`, TCP, portas `80` e `443`;
   - **na própria VM** (as imagens Ubuntu da Oracle bloqueiam por padrão):
     ```sh
     sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
     sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
     sudo netfilter-persistent save
     ```
4. Entre na VM (`ssh -i chave.key ubuntu@IP-PUBLICO`) e instale Docker e Git:
   ```sh
   sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
   sudo usermod -aG docker ubuntu && exit      # entre de novo depois
   ```
5. Baixe o código (no servidor, use um *token* do GitHub como senha, ou a imagem do GHCR —
   [seção 7](#7-atualizar-para-uma-versão-nova)) e configure o **HTTPS com Caddy**. Você
   precisa de um nome apontando para o IP da VM: um domínio seu, um subdomínio grátis do
   [DuckDNS](https://www.duckdns.org) (`suaequipe.duckdns.org`) ou o
   `IP-COM-TRACOS.sslip.io` (ex.: `152-67-10-20.sslip.io`, sem cadastro).

   Crie `Caddyfile` na pasta do projeto:
   ```
   suaequipe.duckdns.org {
       reverse_proxy baja-telemetria:8080
   }
   ```
   e `docker-compose.override.yml`:
   ```yaml
   services:
     baja-telemetria:
       ports: !override
         - "127.0.0.1:8080:8080"   # na internet, só pelo Caddy (HTTPS)
       environment:
         TRUST_PROXY: "true"
     caddy:
       image: caddy:2
       restart: unless-stopped
       ports:
         - "80:80"
         - "443:443"
       volumes:
         - ./Caddyfile:/etc/caddy/Caddyfile:ro
         - ./caddy_data:/data
         - ./caddy_config:/config
       depends_on:
         - baja-telemetria
   ```
6. `docker compose up -d --build`. O Caddy pega o certificado HTTPS (Let's Encrypt)
   sozinho em alguns segundos. Abra `https://suaequipe.duckdns.org` e crie o admin.
7. Atualizações de segurança do Ubuntu: `sudo apt install unattended-upgrades`.

**Prós:** grátis e sempre no ar, máquina folgada. **Contras:** a Oracle pode recuperar
instâncias *Always Free* paradas sem uso por muito tempo, o cadastro às vezes recusa
cartões, e você administra o Linux (firewall, atualizações, backup).

---

## 5. App no GitHub Pages (opcional)

O GitHub Pages publica **só o app** (sem servidor) em
`https://ricardorlfischer-ui.github.io/baja-telemetria/`, de novo a cada push em `main`.
Serve para:

- ter o app num **endereço fixo sem servidor nenhum**: cada pessoa usa a biblioteca local
  do próprio navegador (os logs que ela guarda continuam lá quando ela volta ao endereço;
  funciona offline depois de aberto). Não há compartilhamento entre os integrantes: para
  passar logs de um para outro, use o backup (**Preferências → Backup deste navegador**) ou
  o arquivo original. Como usar: [`USO.md`, "Usar pelo endereço fixo"](USO.md#usar-pelo-endereço-fixo-github-pages);
- usar o app pelo Pages e a biblioteca num servidor em outro lugar.

Se o servidor já serve o app (opções A–D), o Pages é dispensável.

**Requisitos:** o repositório precisa ser **público**, ou, se for **privado**, a conta
precisa de **GitHub Pro** (grátis para estudantes no
[GitHub Student Developer Pack](https://education.github.com/pack)), Team ou Enterprise.
**Atenção:** o site publicado é **público** (qualquer um com o link abre o app), mesmo com
o repositório privado — mas o site é só o programa: os **logs nunca saem do navegador de
quem usa** (ficam no IndexedDB daquele navegador; nada é enviado para o GitHub). Com um
servidor, os dados dele continuam protegidos pelo login. O workflow não publica os
*source maps*. O navegador guarda os dados por **origem** (`https://ricardorlfischer-ui.github.io`),
que é a mesma para todos os sites do Pages dessa conta: o "espaço usado" mostrado no app
inclui os outros sites, e "limpar os dados do site" apaga os logs junto com os deles.

Passo a passo:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.** É só isso: o
   workflow `pages.yml` roda a cada push em `main` (não existe mais a variável
   `PAGES_ENABLED`). Para publicar agora sem push: **Actions → GitHub Pages → Run
   workflow**. O endereço aparece no resumo da execução.
2. *(Só se houver servidor da equipe.)* **Settings → Secrets and variables → Actions → aba
   Variables → New repository variable:** `API_URL` = endereço do servidor com **HTTPS**,
   sem barra no fim (ex.: `https://telemetria.seudominio.com.br`). Opcional: sem ele, cada
   pessoa pode informar o servidor em **Preferências → Servidor da equipe** (**Testar
   conexão** → **Conectar**), ou abrir um link de convite, que já leva o endereço.
3. *(Só se houver servidor.)* No **servidor**, libere a origem do Pages (só a origem, sem
   o caminho): `CORS_ORIGINS=https://ricardorlfischer-ui.github.io` (no
   `docker-compose.yml`, no `fly.toml`/`fly secrets` ou nas Variables do Railway) e
   reinicie o servidor.

O build do Pages usa `VITE_BASE=/baja-telemetria/` (o caminho do site) e `VITE_STATIC=1`
(hospedagem estática: o app não procura `/api` no próprio endereço, vai direto para a
biblioteca local se não houver servidor configurado). Para testar o mesmo build no PC:
`VITE_BASE=/baja-telemetria/ VITE_STATIC=1 npm run build -w @baja/web` e sirva
`apps/web/dist` no caminho `/baja-telemetria/`. No Git Bash do Windows, ponha `MSYS_NO_PATHCONV=1` antes do comando (senão o Git Bash troca
`/baja-telemetria/` por `C:/Program Files/Git/baja-telemetria/` e os arquivos do app dão 404).

O servidor precisa estar em **HTTPS**: o navegador bloqueia chamadas de uma página HTTPS
(o Pages) para um servidor HTTP.

---

## 6. Backup e restauração

Tudo fica na pasta de dados (`DATA_DIR`): `db.sqlite` (+ `db.sqlite-wal`/`-shm` se
existirem), `sessions/` e `secret`. **Guarde a cópia em lugar privado**: ela tem todos os
logs, os e-mails e as senhas (em *hash*) e o segredo dos logins.

**Fazer backup** (pare o servidor para o banco não ser copiado no meio de uma escrita):

```sh
# Docker Compose (Linux / Git Bash)
docker compose stop
tar czf backup-baja-$(date +%Y-%m-%d).tar.gz data
docker compose start
```

```powershell
# Docker Compose (PowerShell no Windows)
docker compose stop
Compress-Archive -Path data -DestinationPath "backup-baja-$(Get-Date -Format yyyy-MM-dd).zip"
docker compose start
```

- **Fly.io:** a Fly faz snapshots diários do volume (`fly volumes snapshots list baja_data`).
  Para uma cópia sua: `fly ssh console -C "tar czf /tmp/backup.tar.gz -C /data ."` e
  `fly ssh sftp get /tmp/backup.tar.gz`.
- **Railway:** use `railway ssh` (CLI) para gerar o `tar` e baixá-lo, ou o recurso de
  backups de volume do painel, se o seu plano tiver.
- Combine uma rotina: por exemplo, **todo fim de semana de teste** alguém faz a cópia e
  guarda no Drive da equipe (pasta com acesso restrito).

**Restaurar:**

```sh
docker compose down
mv data data-antigo              # guarda o que estava lá, por segurança
tar xzf backup-baja-AAAA-MM-DD.tar.gz      # recria a pasta data/
docker compose up -d
```

No Windows, extraia o `.zip` para a pasta `data`. Se o servidor estiver em Linux, a imagem
acerta o dono dos arquivos sozinha ao iniciar.

---

## 7. Atualizar para uma versão nova

**Construindo a partir do código (opções A e D):**

```sh
git pull
docker compose up -d --build
```

Sem Docker: `git pull`, `npm install`, `npm run build` e reinicie o `npm start`.

**Usando a imagem pronta do GitHub (GHCR):** a cada push em `main` o workflow
`docker.yml` publica `ghcr.io/ricardorlfischer-ui/baja-telemetria:latest` (e `:1.2.3` para
tags `v1.2.3`). Como o repositório é privado, a imagem também é: entre uma vez com um
token do GitHub (**Settings → Developer settings → Personal access tokens → Tokens
(classic)**, permissão só `read:packages`):

```sh
docker login ghcr.io -u SEU-USUARIO-GITHUB      # cole o token como senha
docker compose pull
docker compose up -d
```

Assim o PC/VM não precisa construir nada (útil na VM pequena da Oracle).

- **Fly.io:** `git pull` e `fly deploy --ha=false`.
- **Railway:** publica sozinho a cada push em `main`.

Ao subir, o servidor aplica as migrações do banco e recalcula os resumos das sessões de
versão antiga sozinho. **Faça um backup antes** de atualizar.

---

## 8. Acesso ao código (GitHub) × contas do app

São duas coisas **separadas**:

| | Acesso ao **código** (GitHub) | Conta no **app** (servidor) |
|---|---|---|
| Para quê | ver/alterar o código, rodar localmente, publicar | ver e enviar logs, analisar |
| Quem precisa | quem programa ou mantém o servidor | a equipe toda (e convidados) |
| Como dar | **Settings → Collaborators → Add people** no repositório | convite com código na página **Equipe** |
| Como tirar | **Settings → Collaborators → Remove** | desativar o usuário na página **Equipe** |

- Colaboradores de repositório pessoal recebem permissão de escrita. Para dar só leitura
  ou organizar por times, crie uma **organização** grátis no GitHub para a equipe e
  transfira o repositório para ela.
- Quem vai **usar** o app não precisa de conta no GitHub.
- Quando alguém sai da equipe: remova dos colaboradores **e** desative a conta no app.

---

## 9. Segurança

- **HTTPS é obrigatório fora da rede local.** Sem HTTPS, senhas e tokens passam abertos
  pela rede. Todas as opções acima dão HTTPS (Cloudflare, Fly, Railway, Caddy). **Não**
  abra a porta 8080 direto para a internet no roteador.
- **`JWT_SECRET`:** é o segredo que assina os logins. Se não definir, o servidor gera um
  aleatório e guarda em `DATA_DIR/secret` (seguro e suficiente). Se definir, use um texto
  longo e aleatório (`openssl rand -hex 32`), nunca coloque no git e troque se vazar
  (todo mundo terá que entrar de novo).
- **Crie o admin logo após subir** o servidor; enquanto não existe usuário, qualquer um que
  abrir o endereço pode criar o primeiro admin.
- Senhas fortes para os admins; **pelo menos dois admins**; desative quem saiu.
- Dê o papel mínimo: `viewer` para quem só olha.
- Atrás de túnel ou proxy (Cloudflare Tunnel, Caddy, nginx), use `TRUST_PROXY=true`, senão o
  limite de tentativas de login enxerga todo mundo com o IP do proxy. `true` confia em **um**
  proxy e só quando a conexão vem da rede local (é o caso do túnel e do Caddy na mesma
  máquina). Na Fly.io/Railway, onde o proxy vem de fora, use o número de saltos (ex.: `2`)
  ou a lista de IPs/CIDR do proxy. Diretamente exposto (sem proxy), deixe vazio: um
  atacante poderia falsificar o IP.
- O servidor **não sobe** com `JWT_SECRET` de menos de 32 caracteres ou igual ao texto de
  exemplo do `docker-compose.yml` (dava para forjar login de admin com ele).
- Cada log enviado é lido e analisado num **processo separado** com limite de memória
  (`ANALYSIS_MEMORY_MB`) e de tempo (`ANALYSIS_TIMEOUT_S`): um arquivo malformado não
  derruba o servidor, só aparece um aviso no resumo da sessão.
- O backup tem todos os dados: guarde em lugar com acesso restrito.
- O contêiner roda o servidor como usuário comum (`node`), não como `root`.
- Mantenha atualizado (seção 7) e, na VM, as atualizações do sistema ligadas.
- Arquivos `.env`, `data/` e `fly.toml` com segredos não vão para o git (o `.gitignore` já
  ignora `.env` e `data/`; use `fly secrets` para segredos na Fly).

---

## 10. Referência: variáveis, imagem e workflows

### Variáveis de ambiente do servidor

| Variável | Padrão | Na imagem Docker | O que é |
|---|---|---|---|
| `PORT` | `8080` | `8080` | porta HTTP |
| `DATA_DIR` | `./data` | `/data` | banco `db.sqlite`, logs em `sessions/<id>.gz`, segredo em `secret` |
| `JWT_SECRET` | (arquivo `secret`) | — | sobrepõe o segredo gerado (mínimo 32 caracteres; o texto de exemplo é recusado) |
| `CORS_ORIGINS` | vazio | — | origens que podem chamar a API, separadas por vírgula (ex.: `https://ricardorlfischer-ui.github.io`) |
| `MAX_UPLOAD_MB` | `100` | — | tamanho máximo de um log enviado |
| `WEB_DIST` | `../web/dist` (relativo a `apps/server`) | `/app/apps/web/dist` | build do app servido em `/` |
| `TRUST_PROXY` | vazio | — | atrás de túnel/proxy: `true` = 1 proxy vindo da rede local (Cloudflare Tunnel, Caddy, nginx); número = saltos (Fly.io/Railway); ou lista de IPs/CIDR. O limite de tentativas de login passa a usar o IP real |
| `ANALYSIS_MEMORY_MB` | `1536` | — | memória máxima do processo que analisa cada log (use 512 numa VM de 1 GB) |
| `ANALYSIS_TIMEOUT_S` | `300` | — | tempo máximo da análise de um log |
| `HOST` | `0.0.0.0` | — | interface onde o servidor escuta |
| `LOG_LEVEL` | `info` | — | detalhe do log do servidor (`debug`, `info`, `warn`, `error`) |
| `NODE_ENV` | — | `production` | |

### A imagem Docker

- `Dockerfile` em três estágios: `build` (npm ci + `npm run build`), `deps` (só as
  dependências de produção do servidor, instaladas no mesmo Debian da imagem final, porque
  o `better-sqlite3` é nativo) e `runtime` (`node:22-bookworm-slim` com
  `apps/server/dist`, `apps/web/dist` e os `node_modules` de produção).
- Volume `/data`, porta `8080`, `HEALTHCHECK` em `/api/health`.
- O servidor roda como o usuário `node` (uid 1000). O contêiner começa como `root` só para
  acertar o dono da pasta de dados (volumes da Fly/Railway e pastas criadas pelo Docker no
  Linux chegam como `root`) e troca para `node` antes de iniciar. Quem preferir pode
  rodar já como `node` (`docker run --user node ...`), desde que a pasta montada em `/data`
  seja gravável pelo uid 1000.
- Plataformas publicadas: `linux/amd64` e `linux/arm64`.

### Workflows do GitHub Actions (`.github/workflows/`)

| Arquivo | Quando roda | O que faz |
|---|---|---|
| `ci.yml` | todo push e pull request | `npm ci`, `npm run typecheck`, `npm test`, `npm run build` |
| `docker.yml` | push em `main` e tags `v*` | constrói a imagem, testa (sobe, responde `/api/health`, roda como não-root, grava em `/data`) e publica em `ghcr.io/ricardorlfischer-ui/baja-telemetria` |
| `pages.yml` | push em `main` e manual (precisa de **Settings → Pages → Source: GitHub Actions**) | build do app com `VITE_BASE=/baja-telemetria/`, `VITE_STATIC=1` e `VITE_API_URL=$API_URL` e publica no GitHub Pages |

Versão nova "oficial": crie uma tag (`git tag v1.0.0 && git push origin v1.0.0`) e a imagem
sai também como `:1.0.0` e `:1.0`.

---

## 11. Problemas comuns

| Sintoma | Causa provável / o que fazer |
|---|---|
| `docker compose up` diz que não acha a imagem `ghcr.io/...` | normal sem `docker login ghcr.io`: use `docker compose up -d --build` (constrói local) ou faça o login (seção 7) |
| O contêiner reinicia sem parar | `docker compose logs` — geralmente pasta de dados sem permissão ou porta 8080 ocupada (troque para `"8081:8080"` em `ports`) |
| `docker compose ps` mostra `unhealthy` | o servidor não responde `/api/health`; veja os logs |
| Do celular/outro PC não abre `http://IP:8080` | firewall do PC bloqueando a porta 8080 (libere para redes privadas) ou dispositivos em redes diferentes |
| App no Pages não conecta no servidor | `CORS_ORIGINS` sem `https://ricardorlfischer-ui.github.io`, servidor sem HTTPS, ou `API_URL` com barra/caminho errado |
| Os logs sumiram do app no Pages | Os logs ficam no navegador de quem guardou: outro navegador, outro computador, aba anônima ou "limpar dados do site" não têm (ou apagam) os logs. Volte ao mesmo navegador ou importe um backup (**Preferências → Backup deste navegador**). **Preferências → Logs neste navegador** mostra se estão protegidos contra limpeza automática |
| Todo mundo foi desconectado | o `JWT_SECRET` (ou o arquivo `secret`) mudou: é só entrar de novo |
| Esqueci a senha do admin | outro admin redefine; se não houver outro, restaure um backup ou peça ajuda a quem mantém o código |
| Fly: "volume not found" / dados sumiram depois do deploy | o volume é de uma região/máquina: confira `fly volumes list` e mantenha **uma** máquina (`fly scale count 1`) |
| Log grande não sobe | aumente `MAX_UPLOAD_MB` no servidor (e, no Cloudflare plano grátis, o limite por requisição é 100 MB) |
