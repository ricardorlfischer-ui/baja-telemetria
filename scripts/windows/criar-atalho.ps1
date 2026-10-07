<#
.SYNOPSIS
  Cria o atalho "Telemetria · Mauá Racing Baja" (área de trabalho e menu Iniciar).

.DESCRIPTION
  O atalho roda o abrir-telemetria.ps1 sem janela de console piscando: o alvo é o
  conhost.exe --headless (o host de console do próprio Windows, sem janela), que roda o
  powershell.exe escondido. Nada de VBScript (está saindo do Windows). Com o ícone do
  carro (telemetria.ico) e a pasta do repositório como diretório de trabalho.

.PARAMETER Destino
  Pastas onde criar o atalho, separadas por ; (ou uma lista, chamando do PowerShell).
  Padrão: a área de trabalho e o menu Iniciar (Programas) do usuário.

.PARAMETER Port
  Porta passada ao abrir-telemetria.ps1 (só entra no atalho se for diferente de 8090).

.PARAMETER DataDir
  Pasta dos dados passada ao abrir-telemetria.ps1 (padrão: a pasta data do repositório).

.PARAMETER SemConhost
  Alvo powershell.exe -WindowStyle Hidden direto, para um Windows sem o conhost --headless
  (Windows 10 antigo). A janela do console aparece por um instante (minimizada).
#>
[CmdletBinding()]
param(
  [string[]]$Destino = @(),
  [int]$Port = 8090,
  [string]$DataDir = '',
  [switch]$SemConhost
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'comum.ps1')
Usa-Utf8
# erro inesperado: mostra e, se a janela é só deste script, espera um Enter antes de fechar
trap { [Console]::Error.WriteLine("ERRO: $($_.Exception.Message)"); Pausa-Se-Janela-Propria; exit 1 }
$Nome = 'Telemetria · Mauá Racing Baja'
$Repo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$Abrir = Join-Path $PSScriptRoot 'abrir-telemetria.ps1'
$Icone = Join-Path $PSScriptRoot 'telemetria.ico'

# com -File o PowerShell entrega "a;b" como um texto só
$Destino = @($Destino | ForEach-Object { $_ -split ';' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($Destino.Count -eq 0) {
  $Destino = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
}

$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
$argsPs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Abrir`""
if ($Port -ne 8090) { $argsPs += " -Port $Port" }
if ($DataDir) {
  $DataDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($DataDir)
  $argsPs += " -DataDir `"$DataDir`""
}

if ($SemConhost -or -not (Test-Path -LiteralPath $conhost)) {
  $alvo = $ps
  $argumentos = $argsPs
  $estilo = 7     # minimizada: o console pisca só na barra de tarefas
} else {
  $alvo = $conhost
  $argumentos = "--headless `"$ps`" $argsPs"
  $estilo = 1     # normal (o conhost --headless não tem janela)
}

$shell = New-Object -ComObject WScript.Shell
foreach ($pasta in $Destino) {
  New-Item -ItemType Directory -Force -Path $pasta | Out-Null
  $arquivo = Join-Path $pasta "$Nome.lnk"
  $lnk = $shell.CreateShortcut($arquivo)
  $lnk.TargetPath = $alvo
  $lnk.Arguments = $argumentos
  $lnk.WorkingDirectory = $Repo
  $lnk.IconLocation = "$Icone,0"
  $lnk.Description = 'Abre a telemetria do Baja neste computador (modo local, sem login; logs na pasta data). docs\NO-MEU-PC.md'
  $lnk.WindowStyle = $estilo
  $lnk.Save()
  # confere o que ficou gravado (argumentos compridos demais seriam cortados)
  $lido = $shell.CreateShortcut($arquivo)
  if ($lido.TargetPath -ne $alvo -or $lido.Arguments -ne $argumentos) {
    Remove-Item -LiteralPath $arquivo -Force
    [Console]::Error.WriteLine("ERRO: o atalho não ficou como devia (argumentos com $($argumentos.Length) caracteres?). Use um caminho mais curto para o repositório ou para -DataDir.")
    Pausa-Se-Janela-Propria
    exit 1
  }
  Write-Host "Atalho criado: $arquivo"
}
[void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
Write-Host "O atalho aponta para $Repo. Se mudar a pasta do repositório de lugar, rode este script de novo."
Pausa-Se-Janela-Propria
exit 0
