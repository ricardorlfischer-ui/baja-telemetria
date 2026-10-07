<#
.SYNOPSIS
  Abre a Telemetria · Mauá Racing Baja neste computador (modo local, sem login).

.DESCRIPTION
  É o que o atalho da área de trabalho roda (docs/NO-MEU-PC.md):
    1. se o app já está rodando na porta, só abre a janela (se é o servidor da telemetria
       mas ele não responde, fecha e sobe outro);
    2. se a porta está ocupada por outro programa, avisa e para;
       (daqui em diante com uma trava por repositório: dois cliques seguidos não montam nem
       sobem nada duas vezes)
    3. instala as dependências e monta o app quando precisa (primeira vez, ou o código é
       mais novo que a montagem: depois de um git pull), numa janela de console que some
       no fim;
    4. sobe o servidor em segundo plano, sem janela (LOCAL_MODE=1, só 127.0.0.1, dados em
       -DataDir, avisos e erros em <DataDir>\servidor.log), que continua rodando depois daqui;
    5. espera ele responder e abre o app numa janela própria (Edge --app, senão Chrome
       --app, senão o navegador padrão) em http://localhost:<porta>/.
  Feito para o Windows PowerShell 5.1 (o que vem no Windows).

.PARAMETER Port
  Porta do servidor (padrão 8090). O endereço do app fica http://localhost:<porta>/.

.PARAMETER DataDir
  Pasta dos dados: banco, logs enviados, servidor.log (padrão: pasta data do repositório).

.PARAMETER NoBrowser
  Para testes e terminal: não abre janela nenhuma (nem do app, nem de montagem, nem caixas
  de mensagem), escreve tudo no console e sai com código diferente de 0 em erro.

.PARAMETER Rebuild
  Monta o app de novo mesmo que pareça em dia.

.NOTES
  Códigos de saída: 0 ok (ou já estava rodando) · 1 erro inesperado · 2 porta ocupada por
  outro programa · 3 a montagem falhou · 4 o servidor não subiu · 5 Node.js ausente/antigo.
#>
[CmdletBinding()]
param(
  [int]$Port = 8090,
  [string]$DataDir = '',
  [switch]$NoBrowser,
  [switch]$Rebuild
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
. (Join-Path $PSScriptRoot 'comum.ps1')
Usa-Utf8

$Titulo = 'Telemetria · Mauá Racing Baja'
$Repo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if (-not $DataDir) { $DataDir = Join-Path $Repo 'data' }
$DataDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($DataDir)
$AppUrl = "http://localhost:$Port/"
$ServerDist = Join-Path $Repo 'apps\server\dist'
$ServerJs = Join-Path $ServerDist 'index.js'
$ServerWorker = Join-Path $ServerDist 'analysis-worker.js'
$WebDist = Join-Path $Repo 'apps\web\dist-local'
$WebIndex = Join-Path $WebDist 'index.html'
# marcas que o montar-telemetria.ps1 grava só quando a montagem termina bem: uma montagem que
# parou no meio (falhou, janela fechada) não tem marca e é refeita na próxima abertura
$MarcaServidor = Join-Path $ServerDist '.montagem-local'
$MarcaWeb = Join-Path $WebDist '.montagem-local'
$LogServidor = Join-Path $DataDir 'servidor.log'
$LogMontagem = Join-Path $DataDir 'montagem.log'

function Escreve([string]$texto) { Write-Host $texto }

<# Erro: no modo normal, uma caixa de mensagem do Windows (o atalho roda sem console);
 * com -NoBrowser, só o texto. Sai com o código dado. #>
function Falha([string]$texto, [int]$codigo) {
  if ($NoBrowser) {
    [Console]::Error.WriteLine("ERRO: $texto")
  } else {
    Write-Host "ERRO: $texto"
    try {
      Add-Type -AssemblyName System.Windows.Forms
      # dona invisível "sempre na frente": senão a caixa pode nascer atrás das janelas
      $dona = New-Object System.Windows.Forms.Form
      $dona.TopMost = $true
      $dona.ShowInTaskbar = $false
      $dona.StartPosition = 'Manual'
      $dona.Location = New-Object System.Drawing.Point(-2000, -2000)
      $dona.Size = New-Object System.Drawing.Size(1, 1)
      $dona.Show()
      [void][System.Windows.Forms.MessageBox]::Show($dona, $texto, $Titulo, 'OK', 'Error')
      $dona.Close()
    } catch { }
  }
  exit $codigo
}

<# Data do arquivo mais recente entre pastas/arquivos (UTC); [datetime]::MinValue se nenhum. #>
function Mais-Recente([string[]]$caminhos) {
  $max = [datetime]::MinValue
  foreach ($c in $caminhos) {
    if (-not (Test-Path -LiteralPath $c)) { continue }
    $item = Get-Item -LiteralPath $c
    if ($item.PSIsContainer) {
      foreach ($f in (Get-ChildItem -LiteralPath $c -Recurse -File -ErrorAction SilentlyContinue)) {
        if ($f.LastWriteTimeUtc -gt $max) { $max = $f.LastWriteTimeUtc }
      }
    } elseif ($item.LastWriteTimeUtc -gt $max) { $max = $item.LastWriteTimeUtc }
  }
  return $max
}

function Data-De([string]$arquivo) {
  if (Test-Path -LiteralPath $arquivo) { return (Get-Item -LiteralPath $arquivo).LastWriteTimeUtc }
  return [datetime]::MinValue
}

function Ultimas-Linhas([string]$arquivo, [int]$n) {
  if (-not (Test-Path -LiteralPath $arquivo)) { return '(sem log)' }
  return ((Get-Content -LiteralPath $arquivo -Tail $n -Encoding UTF8 -ErrorAction SilentlyContinue) -join "`r`n")
}

<# msedge.exe / chrome.exe: registro App Paths (máquina e usuário), depois os caminhos padrão. #>
function Acha-Navegador([string]$exe, [string[]]$padroes) {
  foreach ($raiz in @('HKCU:', 'HKLM:', 'HKLM:\SOFTWARE\WOW6432Node')) {
    $chave = if ($raiz -eq 'HKLM:\SOFTWARE\WOW6432Node') { "$raiz\Microsoft\Windows\CurrentVersion\App Paths\$exe" } else { "$raiz\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$exe" }
    try {
      $v = (Get-ItemProperty -LiteralPath $chave -ErrorAction Stop).'(default)'
      if ($v) {
        $v = $v.Trim('"')
        if (Test-Path -LiteralPath $v) { return $v }
      }
    } catch { }
  }
  foreach ($p in $padroes) { if ($p -and (Test-Path -LiteralPath $p)) { return $p } }
  return $null
}

function Abre-Janela {
  if ($NoBrowser) {
    Escreve "App em $AppUrl (-NoBrowser: nenhuma janela aberta)."
    return
  }
  $pf86 = ${env:ProgramFiles(x86)}
  $edge = Acha-Navegador 'msedge.exe' @(
    $(if ($pf86) { Join-Path $pf86 'Microsoft\Edge\Application\msedge.exe' }),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe'))
  if ($edge) { Start-Process -FilePath $edge -ArgumentList "--app=$AppUrl"; return }
  $chrome = Acha-Navegador 'chrome.exe' @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    $(if ($pf86) { Join-Path $pf86 'Google\Chrome\Application\chrome.exe' }),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'))
  if ($chrome) { Start-Process -FilePath $chrome -ArgumentList "--app=$AppUrl"; return }
  Start-Process $AppUrl   # navegador padrão
}

try {
  # ---- a) já está rodando? Só abre a janela ----
  # Primeiro o netstat: no Windows, conectar numa porta fechada do próprio PC demora ~2 s
  # (ele tenta de novo depois da recusa); só pergunta /api/info se alguém escuta.
  $donos = @(Quem-Escuta $Port)
  $info = if ($donos.Count -gt 0) { Le-Info $Port } else { $null }

  # ---- a') o servidor da telemetria está lá mas não responde (travou): fecha e sobe outro ----
  if ($donos.Count -gt 0 -and $null -eq $info -and @($donos | Where-Object { E-Servidor-Telemetria $_ }).Count -eq $donos.Count) {
    for ($i = 0; $i -lt 3 -and $null -eq $info; $i++) { Start-Sleep -Seconds 1; $info = Le-Info $Port }
    if ($null -eq $info) {
      Escreve "O servidor da telemetria na porta $Port não responde (travou?): fechando para abrir de novo."
      foreach ($id in $donos) { Para-Arvore $id }
      $limite = (Get-Date).AddSeconds(10)
      while ((Get-Date) -lt $limite -and @(Quem-Escuta $Port).Count -gt 0) { Start-Sleep -Milliseconds 200 }
      $donos = @(Quem-Escuta $Port)
    }
  }

  if (E-Local $info) {
    Escreve "A telemetria já está rodando em $AppUrl (dados em $($info.dataDir))."
    if ($PSBoundParameters.ContainsKey('DataDir') -and $info.dataDir -and ($info.dataDir.TrimEnd('\') -ne $DataDir.TrimEnd('\'))) {
      Escreve "Aviso: o servidor que está rodando usa outra pasta de dados ($($info.dataDir)), não $DataDir. Para trocar: pare (parar-telemetria.ps1) e abra de novo."
    }
    if ($Rebuild) {
      Escreve "Aviso: -Rebuild não vale com o servidor rodando (ele usa a montagem atual). Pare (parar-telemetria.ps1) e abra de novo com -Rebuild."
    }
    Abre-Janela
    exit 0
  }

  # ---- b) porta ocupada por outra coisa ----
  if ($donos.Count -gt 0) {
    $quem = ($donos | ForEach-Object { Descreve-Processo $_ }) -join ', '
    Falha ("A porta $Port deste computador está ocupada por outro programa: $quem.`r`n`r`n" +
      "Feche esse programa e abra a telemetria de novo, ou use outra porta " +
      "(abrir-telemetria.ps1 -Port 8091; veja docs\NO-MEU-PC.md).") 2
  }

  # ---- Node.js ----
  # no PATH; senão nos lugares de sempre (o atalho herda o PATH do Explorador, que pode ser
  # de antes de instalar o Node): aí entra no PATH daqui, para o npm da montagem achar o node
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($node) {
    $node = $node.Source
  } else {
    $candidatos = @((Join-Path $env:ProgramFiles 'nodejs\node.exe'), (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'))
    if ($env:NVM_SYMLINK) { $candidatos += (Join-Path $env:NVM_SYMLINK 'node.exe') }
    $node = $candidatos | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $node) {
      Falha "O Node.js não está instalado (ou não está no PATH). Instale o Node.js 22 LTS (https://nodejs.org) e abra de novo." 5
    }
    $env:PATH = (Split-Path -Parent $node) + ';' + $env:PATH
  }
  $versao = (& $node --version) 2>$null
  if ($versao -match '^v(\d+)\.(\d+)') {
    $maior = [int]$Matches[1]; $menor = [int]$Matches[2]
    if ($maior -lt 22 -or ($maior -eq 22 -and $menor -lt 12)) {
      Falha "Este app precisa do Node.js 22.12 ou mais novo (instalado: $versao). Atualize em https://nodejs.org." 5
    }
  }

  # Duas aberturas ao mesmo tempo (dois cliques no atalho, ou outra porta no mesmo
  # repositório): a segunda espera a primeira. Uma trava por repositório, não por porta: as
  # duas montariam na mesma pasta ao mesmo tempo (o tsup de uma apaga o que a outra escreve).
  $hash = [System.Security.Cryptography.SHA256]::Create()   # SHA256: o MD5 falha num Windows com FIPS ligado
  $chave = -join ($hash.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Repo.ToLowerInvariant().TrimEnd('\'))) | ForEach-Object { $_.ToString('x2') })
  $trava = New-Object System.Threading.Mutex($false, "Local\BajaTelemetria-$chave")
  $temTrava = $false
  try { $temTrava = $trava.WaitOne([TimeSpan]::FromMinutes(15)) } catch [System.Threading.AbandonedMutexException] { $temTrava = $true }
  if (-not $temTrava) {
    Falha "Outra abertura da telemetria está demorando demais (mais de 15 min). Feche as janelas da telemetria e tente de novo." 1
  }
  if (@(Quem-Escuta $Port).Count -gt 0) {
    $info = Le-Info $Port
    if (E-Local $info) {
      Escreve "A telemetria já está rodando em $AppUrl (dados em $($info.dataDir))."
      Abre-Janela
      exit 0
    }
    # outro programa pegou a porta enquanto esta abertura esperava a trava
    $quem = (@(Quem-Escuta $Port) | ForEach-Object { Descreve-Processo $_ }) -join ', '
    Falha "A porta $Port deste computador está ocupada por outro programa: $quem." 2
  }

  New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

  # ---- c) montar se precisar ----
  $nm = Join-Path $Repo 'node_modules'
  $lock = Join-Path $Repo 'package-lock.json'
  $precisaInstalar = (-not (Test-Path -LiteralPath $nm)) -or ((Data-De $lock) -gt (Data-De (Join-Path $nm '.package-lock.json')))
  $core = Join-Path $Repo 'packages\core\src'
  $fonteServidor = Mais-Recente @($core, (Join-Path $Repo 'packages\core\package.json'),
    (Join-Path $Repo 'apps\server\src'), (Join-Path $Repo 'apps\server\tsup.config.ts'), (Join-Path $Repo 'apps\server\package.json'), $lock)
  $fonteWeb = Mais-Recente @($core, (Join-Path $Repo 'packages\core\package.json'),
    (Join-Path $Repo 'apps\web\src'), (Join-Path $Repo 'apps\web\index.html'), (Join-Path $Repo 'apps\web\vite.config.ts'),
    (Join-Path $Repo 'apps\web\postcss.config.cjs'), (Join-Path $Repo 'apps\web\package.json'), $lock)
  # pela marca de montagem completa (e os arquivos que o servidor precisa), não pela data do
  # index.js/index.html: esses existem também numa montagem que parou no meio
  $servidorInteiro = (Test-Path -LiteralPath $ServerJs) -and (Test-Path -LiteralPath $ServerWorker)
  $webInteiro = Test-Path -LiteralPath $WebIndex
  $montaServidor = $Rebuild -or $precisaInstalar -or (-not $servidorInteiro) -or ($fonteServidor -gt (Data-De $MarcaServidor))
  $montaWeb = $Rebuild -or $precisaInstalar -or (-not $webInteiro) -or ($fonteWeb -gt (Data-De $MarcaWeb))

  if ($precisaInstalar -or $montaServidor -or $montaWeb) {
    $montar = Join-Path $PSScriptRoot 'montar-telemetria.ps1'
    $args2 = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$montar`"", '-Log', "`"$LogMontagem`"")
    if ($precisaInstalar) { $args2 += '-Instalar' }
    if ($montaServidor) { $args2 += '-Servidor' }
    if ($montaWeb) { $args2 += '-Web' }
    $inicio = Get-Date
    if ($NoBrowser) {
      # no mesmo console
      & powershell.exe @($args2 | ForEach-Object { $_.Trim('"') })
      $codigo = $LASTEXITCODE
    } else {
      # janela de console visível só enquanto monta; fecha sozinha no fim
      $args2 += '-NaJanela'
      $p = Start-Process -FilePath 'powershell.exe' -ArgumentList ($args2 -join ' ') -WindowStyle Normal -Wait -PassThru
      $codigo = $p.ExitCode
    }
    if ($codigo -ne 0) {
      if ($NoBrowser) {
        # o fim do log já apareceu logo acima
        Falha "Não deu para montar o app (código $codigo). Saída completa em $LogMontagem." 3
      }
      Falha ("Não deu para montar o app (código $codigo). Últimas linhas de $($LogMontagem):`r`n`r`n" +
        (Ultimas-Linhas $LogMontagem 15)) 3
    }
    Escreve ("Montagem: {0:N0} s." -f ((Get-Date) - $inicio).TotalSeconds)
  }
  foreach ($f in @($ServerJs, $ServerWorker, $MarcaServidor, $WebIndex, $MarcaWeb)) {
    if (-not (Test-Path -LiteralPath $f)) {
      Falha "A montagem não terminou ($f não existe). Abra de novo; persistindo, rode com -Rebuild (detalhes em $LogMontagem)." 3
    }
  }

  # ---- d) sobe o servidor em segundo plano, sem janela ----
  # servidor.log: passou de 5 MB, vira servidor.log.1 (o anterior se perde). Com o servidor
  # só nos avisos e erros (LOG_LEVEL=warn, abaixo) ele cresce pouco mesmo rodando por semanas.
  try {
    if ((Test-Path -LiteralPath $LogServidor) -and ((Get-Item -LiteralPath $LogServidor).Length -gt 5MB)) {
      Move-Item -LiteralPath $LogServidor -Destination "$LogServidor.1" -Force
    }
  } catch { }   # preso por outro servidor na mesma pasta: fica para a próxima
  # UTF-8 sem BOM, como o que o node escreve depois
  [System.IO.File]::AppendAllText($LogServidor, ("---- {0:yyyy-MM-dd HH:mm:ss} abrindo na porta {1} (dados em {2}) ----`r`n" -f (Get-Date), $Port, $DataDir), (New-Object System.Text.UTF8Encoding($false)))

  # servidor.cmd roda o node com a saída e os erros no servidor.log. Quem hospeda o cmd é o
  # conhost.exe --headless (o console do Windows sem janela: nem do cmd, nem do node, e sem
  # passar para o Windows Terminal). Start-Process (ShellExecute) não deixa o processo
  # herdar as alças deste PowerShell nem preso a ele: o servidor continua vivo quando o
  # PowerShell termina, e quem lê a saída daqui (npm run local | ...) não fica esperando.
  $env:LOCAL_MODE = '1'
  $env:PORT = [string]$Port
  $env:HOST = '127.0.0.1'
  $env:DATA_DIR = $DataDir
  $env:WEB_DIST = $WebDist
  $env:NODE_ENV = 'production'
  # no nível info o servidor escreve 2 linhas por pedido (o app faz dezenas por tela): o
  # servidor.log cresceria sem parar enquanto ele fica aberto. Quem quiser tudo: LOG_LEVEL=info.
  if (-not $env:LOG_LEVEL) { $env:LOG_LEVEL = 'warn' }
  $env:BAJA_NODE = $node
  $env:BAJA_SERVIDOR_JS = $ServerJs
  $env:BAJA_LOG = $LogServidor
  $env:BAJA_PASTA_SERVIDOR = Join-Path $Repo 'apps\server'
  $cmd = Join-Path $env:SystemRoot 'System32\cmd.exe'
  # o caminho do servidor.cmd não vai na linha de comando: ele roda pelo nome, na pasta dele.
  # Com ( ) & ^ no caminho (ex.: "Nova pasta (2)") o "cmd /c" tira as aspas, e o conhost
  # --headless estraga o /s com aspas duplas: nos dois casos o servidor nem começava.
  $linha = '/d /c .\servidor.cmd'   # .\ acha mesmo com NoDefaultCurrentDirectoryInExePath
  $conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
  # o -WorkingDirectory do Start-Process aceita curingas: [ ] no caminho precisam de escape
  $pastaScripts = [System.Management.Automation.WildcardPattern]::Escape($PSScriptRoot)
  if (Test-Path -LiteralPath $conhost) {
    $servidor = Start-Process -FilePath $conhost -ArgumentList ("--headless `"$cmd`" " + $linha) -WorkingDirectory $pastaScripts -WindowStyle Hidden -PassThru
  } else {
    $servidor = Start-Process -FilePath $cmd -ArgumentList $linha -WorkingDirectory $pastaScripts -WindowStyle Hidden -PassThru
  }
  Escreve "Servidor iniciado (dados em $DataDir; log em $LogServidor)."

  # ---- e) espera responder (até 40 s) ----
  $limite = (Get-Date).AddSeconds(40)
  $ok = $false
  while ((Get-Date) -lt $limite) {
    if (@(Quem-Escuta $Port).Count -gt 0) {
      $info = Le-Info $Port
      if (E-Local $info) { $ok = $true; break }
    }
    if ($servidor.HasExited) { break }
    Start-Sleep -Milliseconds 300
  }
  if (-not $ok) {
    $motivo = if ($servidor.HasExited) { 'O servidor fechou logo depois de abrir.' } else { 'O servidor não respondeu em 40 s.' }
    if (-not $servidor.HasExited) {
      # não deixa um servidor pela metade ocupando a porta
      Para-Arvore $servidor.Id
    }
    Falha ("$motivo Últimas linhas de $($LogServidor):`r`n`r`n" + (Ultimas-Linhas $LogServidor 15)) 4
  }
  Escreve "Pronto: $AppUrl (dados em $($info.dataDir))."

  # ---- f) janela do app ----
  Abre-Janela
  exit 0
} catch {
  Falha ("Erro inesperado ao abrir a telemetria: $($_.Exception.Message)") 1
}
