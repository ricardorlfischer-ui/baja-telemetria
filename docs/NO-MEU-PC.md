# A telemetria no meu PC

Um jeito de usar o app **só no seu computador**, sempre pelo mesmo endereço
(`http://localhost:8090/`), com os logs guardados **numa pasta do PC** — não no navegador.
Sem conta, sem senha, sem internet e sem hospedar nada.

Por baixo é o mesmo app da equipe, com o servidor no **modo local**: ele roda escondido no
seu PC, só aceita pedidos do próprio computador (ninguém da rede consegue abrir) e usa o
usuário do Windows no lugar do login. Os números são os mesmos do app no navegador.

## O que precisa

- **Windows 10 ou 11.**
- **Node.js 22 LTS** (22.12 ou mais novo): <https://nodejs.org> → instalador do Windows,
  tudo no padrão.
- **O repositório** no PC (`git clone` ou o ZIP do GitHub descompactado). O caminho
  usado aqui de exemplo é `C:\Users\<você>\baja-telemetria`. **Fora** de pastas
  sincronizadas (OneDrive, Google Drive, Dropbox: no Windows 11 a pasta Documentos costuma
  ser do OneDrive): o banco `db.sqlite` fica aberto enquanto o servidor roda, e a
  sincronização no meio pode travar ou estragar o banco. Para guardar na nuvem, use o
  backup (abaixo).

## Primeira vez

1. Abra o PowerShell (ou o terminal) na pasta do repositório e crie o atalho:

   ```powershell
   npm run local:atalho
   ```

   Ou, sem terminal: no Explorador de Arquivos, clique com o botão direito em
   `scripts\windows\criar-atalho.ps1` → **Executar com o PowerShell**.

   Aparecem dois atalhos **Telemetria · Mauá Racing Baja** (com a foto do carro): um na
   área de trabalho e um no menu Iniciar. Pelo clique direito, a janela espera um **Enter**
   no fim para dar tempo de ler o que aconteceu.

   O atalho guarda o caminho da pasta do repositório: **se mudar a pasta de lugar** (ou
   renomear), crie o atalho de novo do mesmo jeito (ele substitui o antigo). Um atalho
   apontando para uma pasta que não existe mais não abre nada e não mostra erro.

2. Clique no atalho. Na primeira vez abre uma janela preta escrita **"Atualizando o app da
   telemetria… só na primeira vez ou depois de uma atualização"**: ela instala o que falta
   (`npm install`) e monta o app. Leva de alguns segundos a uns minutos (o `npm install`
   precisa de internet). A janela fecha sozinha e o app abre.

Não precisa rodar `npm install` antes: o atalho faz isso quando precisa.

## Como abrir

- **Clique no atalho** (área de trabalho ou menu Iniciar; dá para fixar na barra de tarefas).
  O app abre numa janela própria, sem barra de endereço (Edge no modo app).
- Ou no terminal, na pasta do repositório: `npm run local`.
- Ou, com o servidor já rodando, qualquer navegador em **http://localhost:8090/**.

Clicar no atalho com o app já aberto só abre outra janela: o servidor é um só. Dois cliques
seguidos também: o segundo espera o primeiro terminar (não monta nem sobe nada duas vezes).

## Onde ficam os logs

Na pasta **`data`** do repositório (ex.: `C:\Users\<você>\baja-telemetria\data`). O app
mostra o caminho em **Preferências → Onde ficam os logs** (botão **Copiar**).

| Dentro de `data` | O que é |
|---|---|
| `db.sqlite` (+ `db.sqlite-wal`, `db.sqlite-shm`) | o banco: sessões, resumos, carros, pistas, anotações |
| `sessions\<id>.gz` | cada log enviado, original, compactado |
| `secret` | chave interna do servidor (não mexa) |
| `servidor.log` (e `servidor.log.1`) | avisos e erros do servidor e uma linha a cada abertura: é o primeiro lugar para olhar se algo der errado. Passou de 5 MB, vira `servidor.log.1` na próxima abertura |
| `montagem.log` | a saída da última montagem do app (`npm install` / build) |

**Apagar a pasta `data` apaga todos os logs e perfis.** Ela não vai para o Git (está no
`.gitignore`): um `git pull` nunca mexe nela.

Para guardar os dados noutro lugar (ex.: `D:\Baja`), crie o atalho com a pasta:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\criar-atalho.ps1 -DataDir D:\Baja
```

## Backup

Dois jeitos (faça um de vez em quando, e sempre antes de formatar o PC):

1. **Copiar a pasta `data` inteira** (pen drive, outro disco, nuvem) **com o app fechado**:
   feche a janela e pare o servidor antes (abaixo), senão o banco pode sair pela metade.
   Para voltar, pare o servidor e ponha a pasta de volta no lugar.
2. **Preferências → Backup → Exportar backup**: um arquivo `baja-backup-….json` com as
   sessões (o log inteiro) e os perfis. Entra em outro PC (ou no app pelo navegador) por
   **Preferências → Importar backup…**. Esse dá para fazer com o app aberto.

## Atualizar

Na pasta do repositório:

```powershell
git pull
```

e clique no atalho. Ele percebe que o código é mais novo que a montagem e monta de novo
(a janela "Atualizando…" aparece de novo, uma vez). Se o servidor estava rodando, **pare
antes** (abaixo): com ele rodando, o atalho só abre a janela do app antigo.

Para forçar a montagem (se algo parecer estranho depois de atualizar):

```powershell
npm run local:parar
powershell -ExecutionPolicy Bypass -File scripts\windows\abrir-telemetria.ps1 -Rebuild
```

## Fechar e parar o servidor

Fechar a janela do app **não** para o servidor: ele continua rodando escondido (gasta
pouquíssimo) para o app abrir na hora da próxima vez. Desliga sozinho quando o PC desliga
ou reinicia.

Para parar (antes de copiar a pasta `data`, de atualizar ou de desinstalar):

```powershell
npm run local:parar
```

ou clique com o botão direito em `scripts\windows\parar-telemetria.ps1` → **Executar com o
PowerShell**. Ele só para o servidor da telemetria (confere que é ele antes); os dados ficam
na pasta. Sem nada na porta 8090, ele procura e para a telemetria deste repositório aberta
em outra porta (atalho criado com `-Port`).

## Desinstalar

1. Pare o servidor (`npm run local:parar`).
2. **Copie a pasta `data`** se quiser ficar com os logs.
3. Apague os atalhos: o da área de trabalho e o do menu Iniciar (clique direito no menu
   Iniciar → **Abrir local do arquivo** mostra onde ele está).
4. Apague a pasta do repositório.

O Node.js pode ser desinstalado em Configurações → Aplicativos, se nada mais usar.

## Problemas comuns

**"A porta 8090 deste computador está ocupada por outro programa"** — outro programa já usa
o endereço do app (a mensagem diz qual). Feche esse programa, ou use outra porta e recrie o
atalho com ela:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\criar-atalho.ps1 -Port 8091
```

O endereço vira `http://localhost:8091/`. Atenção: o que o app guarda no navegador
(preferências, última sessão aberta) é por endereço; os logs, que ficam na pasta `data`,
continuam todos lá.

**O antivírus bloqueou** — alguns antivírus barram scripts do PowerShell ou o `node.exe`
abrindo uma porta. Libere a pasta do repositório (ou o `node.exe`) no antivírus. O servidor
só escuta em `127.0.0.1`: o Firewall do Windows não precisa perguntar nada.

**Abriu no navegador comum, não numa janela própria** — o Edge não foi encontrado. O atalho
tenta o Edge, depois o Chrome (os dois no modo app) e, sem eles, o navegador padrão. Funciona
igual; só fica com a barra de endereço.

**"O Node.js não está instalado"** ou **"precisa do Node.js 22.12"** — instale ou atualize
em <https://nodejs.org> e clique no atalho de novo. Se acabou de instalar, saia e entre de
novo no Windows (para o atalho enxergar o Node).

**"Não deu para montar o app"** — a mensagem mostra o fim do `data\montagem.log`. O mais
comum é o `npm install` sem internet na primeira vez: conecte e tente de novo. Persistindo,
rode no terminal `npm run local` (mostra tudo ali mesmo) ou abra com `-Rebuild`.

**"O servidor não respondeu"** ou **"fechou logo depois de abrir"** — o fim do
`data\servidor.log` aparece na mensagem e diz o motivo.

**Aviso vermelho "O servidor da telemetria parou"** (selo **Servidor parado** no canto) — o
servidor que roda escondido foi parado (`npm run local:parar`), fechou ou o PC dormiu, com a
janela do app aberta. Clique no atalho de novo: o aviso some sozinho em alguns segundos e as
listas voltam, sem recarregar. Nada se perde (os dados estão na pasta `data`); enquanto o aviso
está lá, a sessão aberta continua na tela, mas nada novo é guardado. Uma página que ainda não
tinha sido aberta pede **Recarregar** depois que o servidor volta. Recarregar (F5) com o
servidor parado mostra a página de erro do próprio navegador: abra pelo atalho.

**"Não consegui carregar esta página"** depois de atualizar — a janela é de antes da montagem
nova: recarregue (F5). A sessão da biblioteca que estava aberta abre de novo sozinha.

**O app parou de responder** — clique no atalho de novo: se o servidor da telemetria está
na porta mas não responde (travou), o atalho fecha ele e abre outro (leva uns 15 s). Ou
pare (`npm run local:parar`, que também para um servidor travado) e abra de novo.

**Mudei a pasta do repositório e o atalho não abre nada** — crie o atalho de novo (Primeira
vez, passo 1). Os logs vão junto se a pasta `data` estava dentro do repositório; se o
atalho foi criado com `-DataDir`, use o mesmo `-DataDir` de novo.

**Fechei a janela "Atualizando…" no meio** — sem problema: na próxima vez o atalho percebe
que a montagem não terminou e monta de novo.

**Nada acontece ao clicar no atalho** — rode `npm run local` no terminal: os mesmos passos,
com as mensagens no próprio terminal.

## Para quem mexe no código

- `scripts/windows/abrir-telemetria.ps1` — o que o atalho roda. Parâmetros: `-Port` (8090),
  `-DataDir` (pasta `data`), `-Rebuild`, `-NoBrowser` (testes: não abre janela nem caixa de
  mensagem, escreve no console e sai com código ≠ 0 em erro: 2 porta ocupada, 3 montagem,
  4 servidor não subiu, 5 Node; 1 erro inesperado). Monta com `npm run build -w @baja/server` e
  `npm run build:local -w @baja/web` (saída em `apps/web/dist-local`, base `/`) quando o
  código (`packages/core/src`, `apps/server/src`, `apps/web/src`, `index.html`, as configs do
  vite/postcss/tsup, os `package.json`, o `package-lock.json`) é mais novo que a marca
  `.montagem-local` que o `montar-telemetria.ps1` grava na pasta de saída **só quando a
  montagem termina bem** (uma montagem que parou no meio é refeita). Sobe
  `node apps/server/dist/index.js` com `LOCAL_MODE=1`, `PORT`, `DATA_DIR`, `WEB_DIST`,
  `NODE_ENV=production` e `LOG_LEVEL=warn` (sem uma linha por pedido no `servidor.log`; para
  ver tudo, defina `LOG_LEVEL=info` antes), via `conhost.exe --headless` (sem janela).
  Uma trava (mutex) por repositório: duas aberturas ao mesmo tempo, mesmo em portas
  diferentes, não montam em paralelo. Servidor da telemetria que não responde `/api/info`
  (reconhecido pela linha de comando `node ...\apps\server\dist\index.js`) é fechado e
  aberto de novo. Saída em UTF-8 quando redirecionada (Git Bash, `| ...`). Funções comuns em
  `scripts/windows/comum.ps1`.
- Parâmetros: chame o script direto (`powershell -ExecutionPolicy Bypass -File
  scripts\windows\abrir-telemetria.ps1 -NoBrowser`). Pelo npm, no PowerShell o `--` some
  antes de chegar ao npm e ele engole os `-Opção` (`npm run local -- -NoBrowser` abre a
  janela do mesmo jeito); no PowerShell use `npm run local '--' -NoBrowser`, ou rode do
  Git Bash/cmd.
- `scripts/windows/parar-telemetria.ps1 [-Port]` — para o servidor da porta (só se for o
  `node` no modo local, ou o servidor da telemetria travado); sem `-Port` e sem nada na
  8090, os servidores deste repositório em outras portas.
- `scripts/windows/criar-atalho.ps1 [-Destino pasta;pasta] [-Port] [-DataDir] [-SemConhost]`
  — o atalho roda `conhost.exe --headless powershell.exe -WindowStyle Hidden -File
  abrir-telemetria.ps1` (nada de VBScript). `-SemConhost` para um Windows sem o
  `conhost --headless`.
- `scripts/windows/gerar-icone.py` — gera `telemetria.ico` (Pillow) a partir de
  `apps/web/src/assets/brand/logo.webp`.
- O modo local do servidor (defesas, `/api/info`) está em `apps/server/README.md` e em
  `docs/ARQUITETURA.md` 5.4.
