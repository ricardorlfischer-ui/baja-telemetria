<#
.SYNOPSIS
  Monta o app da telemetria para rodar neste computador (chamado pelo abrir-telemetria.ps1).

.DESCRIPTION
  Instala as dependências (npm install) e/ou monta o servidor (apps/server/dist) e o app
  (apps/web/dist-local, caminho base '/'). A saída do npm vai para -Log; aqui só aparecem
  os passos, em português. Sai com 0 se deu tudo certo, 3 se algum passo falhou.
  Cada montagem que termina bem grava a marca .montagem-local na pasta de saída
  (apps/server/dist, apps/web/dist-local): o abrir-telemetria.ps1 compara o código com ela,
  então uma montagem que parou no meio (erro, janela fechada) é refeita na próxima abertura.

.PARAMETER Log
  Arquivo com a saída completa do npm (recriado a cada montagem).

.PARAMETER NaJanela
  Roda numa janela de console própria (a do atalho), que fecha sozinha no fim.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Log,
  [switch]$Instalar,
  [switch]$Servidor,
  [switch]$Web,
  [switch]$NaJanela
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'comum.ps1')
Usa-Utf8
$Repo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
try { $Host.UI.RawUI.WindowTitle = 'Telemetria · Mauá Racing Baja: atualizando' } catch { }

# variáveis que mudariam a montagem: build do GitHub Pages (VITE_*), NODE_ENV=production
# (o npm install pularia as ferramentas de montagem)
foreach ($v in @('VITE_STATIC', 'VITE_BASE', 'VITE_API_URL', 'NODE_ENV')) {
  Remove-Item -LiteralPath "Env:$v" -ErrorAction SilentlyContinue
}
$env:NO_COLOR = '1'   # log sem códigos de cor

$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) {
  Write-Host 'O npm não foi encontrado (vem com o Node.js). Instale o Node.js 22 LTS: https://nodejs.org'
  exit 3
}
$npm = $npm.Source

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Log) | Out-Null
$Utf8 = New-Object System.Text.UTF8Encoding($false)   # sem BOM, como o que o npm escreve
[System.IO.File]::WriteAllText($Log, ("---- {0:yyyy-MM-dd HH:mm:ss} montagem em {1} ----`r`n" -f (Get-Date), $Repo), $Utf8)

Write-Host ''
Write-Host '  Atualizando o app da telemetria…'
if ($NaJanela) {
  Write-Host '  Só na primeira vez ou depois de uma atualização. Esta janela fecha sozinha.'
} else {
  Write-Host '  Só na primeira vez ou depois de uma atualização.'
}
Write-Host ''

<# Roda "npm <args>" na pasta do repositório, com a saída no log; mostra um ponto a cada
 * 2 s para quem está olhando saber que não travou. Devolve $true se deu certo. #>
function Passo([string]$texto, [string]$argsNpm) {
  Write-Host -NoNewline "  $texto "
  [System.IO.File]::AppendAllText($Log, "`r`n---- npm $argsNpm ----`r`n", $Utf8)
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = Join-Path $env:SystemRoot 'System32\cmd.exe'
  $psi.Arguments = '/d /s /c ""' + $npm + '" ' + $argsNpm + ' >> "' + $Log + '" 2>&1"'
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.WorkingDirectory = $Repo
  $inicio = Get-Date
  $p = [System.Diagnostics.Process]::Start($psi)
  while (-not $p.WaitForExit(2000)) { Write-Host -NoNewline '.' }
  $p.WaitForExit()
  $s = ((Get-Date) - $inicio).TotalSeconds
  if ($p.ExitCode -eq 0) {
    Write-Host (" ok ({0:N0} s)" -f $s)
    return $true
  }
  Write-Host (" falhou (código {0})" -f $p.ExitCode)
  return $false
}

# passo: texto, argumentos do npm, pasta de saída (recebe a marca .montagem-local no fim)
# --prefer-offline: o que já está no cache do npm não é baixado de novo (sem internet, uma
# atualização que só reaproveita pacotes conhecidos ainda instala)
$passos = @()
if ($Instalar) { $passos += , @('Instalando as dependências (pode levar alguns minutos)', 'install --no-audit --no-fund --prefer-offline', '') }
if ($Servidor) { $passos += , @('Montando o servidor', 'run build -w @baja/server', (Join-Path $Repo 'apps\server\dist')) }
if ($Web) { $passos += , @('Montando o app', 'run build:local -w @baja/web', (Join-Path $Repo 'apps\web\dist-local')) }

# a marca de uma montagem anterior sai antes de montar de novo: se este passo parar no meio,
# a próxima abertura monta outra vez
foreach ($p in $passos) {
  if ($p[2]) { Remove-Item -LiteralPath (Join-Path $p[2] '.montagem-local') -Force -ErrorAction SilentlyContinue }
}

$i = 0
foreach ($p in $passos) {
  $i++
  if (-not (Passo ("{0}/{1} {2}" -f $i, $passos.Count, $p[0]) $p[1])) {
    Write-Host ''
    Write-Host "  Não deu certo. Últimas linhas de $($Log):"
    Write-Host ''
    Get-Content -LiteralPath $Log -Tail 20 -Encoding UTF8 | ForEach-Object { Write-Host "    $_" }
    if ($p[1] -like 'install*') {
      # vai também para o fim do log, que é o que a caixa de erro do abrir-telemetria mostra
      $dica = 'DICA: a instalação baixa os pacotes da internet. Confira a conexão (ou o proxy/antivírus) e abra de novo.'
      [System.IO.File]::AppendAllText($Log, "`r`n$dica`r`n", $Utf8)
      Write-Host ''
      Write-Host "  $dica"
    }
    exit 3
  }
  if ($p[2]) {
    [System.IO.File]::WriteAllText((Join-Path $p[2] '.montagem-local'), ("{0:yyyy-MM-dd HH:mm:ss}`r`n" -f (Get-Date)), $Utf8)
  }
  if ($p[1] -like 'install*') {
    # o npm nem sempre reescreve o .package-lock.json quando não muda nada: marca a hora
    # para o abrir-telemetria.ps1 não instalar de novo a cada abertura
    $marca = Join-Path $Repo 'node_modules\.package-lock.json'
    if (Test-Path -LiteralPath $marca) { (Get-Item -LiteralPath $marca).LastWriteTime = Get-Date }
  }
}

Write-Host ''
Write-Host '  Pronto. Abrindo o app…'
exit 0
