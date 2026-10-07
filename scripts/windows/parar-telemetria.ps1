<#
.SYNOPSIS
  Para o servidor da telemetria que roda neste computador (aberto pelo atalho ou npm run local).

.DESCRIPTION
  Acha o processo que escuta na porta, confere que é o servidor da telemetria (o node que
  responde /api/info no modo local, ou o node ...\apps\server\dist\index.js que travou e não
  responde mais) e encerra o servidor junto com o processo da análise. Não para outro
  programa por engano. Os dados ficam na pasta de dados: nada se perde.
  Sem -Port: a porta 8090 e, se não houver nada lá, os servidores da telemetria no modo local
  deste repositório abertos em outra porta (atalho criado com -Port).
  Códigos de saída: 0 parado (ou já não estava rodando) · 2 a porta é de outro programa ·
  1 não deu para parar.

.PARAMETER Port
  Porta do servidor (padrão 8090).
#>
[CmdletBinding()]
param([int]$Port = 8090)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'comum.ps1')
Usa-Utf8
# erro inesperado: mostra e, se a janela é só deste script, espera um Enter antes de fechar
trap { [Console]::Error.WriteLine("ERRO: $($_.Exception.Message)"); Pausa-Se-Janela-Propria; exit 1 }

<# Para o servidor da porta. Devolve 0 parado / nada rodando, 2 outro programa, 1 não fechou. #>
function Para-Porta([int]$porta) {
  $donos = @(Quem-Escuta $porta)
  if ($donos.Count -eq 0) {
    Write-Host "A telemetria não está rodando na porta $porta."
    return 0
  }
  $info = Le-Info $porta
  $local = E-Local $info
  foreach ($id in $donos) {
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    $nome = if ($p) { $p.ProcessName } else { '?' }
    # travado: não responde /api/info, mas a linha de comando diz que é o servidor da telemetria
    $travado = ($null -eq $info) -and (E-Servidor-Telemetria $id)
    if ($nome -ne 'node' -or -not ($local -or $travado)) {
      [Console]::Error.WriteLine("ERRO: a porta $porta é de outro programa ($nome, PID $id), não da telemetria no modo local. Nada foi parado.")
      return 2
    }
  }

  foreach ($id in $donos) { Para-Arvore $id }   # /T: junto com o processo da análise

  $limite = (Get-Date).AddSeconds(10)
  while ((Get-Date) -lt $limite -and @(Quem-Escuta $porta).Count -gt 0) { Start-Sleep -Milliseconds 200 }
  if (@(Quem-Escuta $porta).Count -gt 0) {
    [Console]::Error.WriteLine("ERRO: o servidor da porta $porta não fechou.")
    return 1
  }
  if ($local) {
    Write-Host "Telemetria parada (porta $porta). Os dados continuam em $($info.dataDir)."
  } else {
    Write-Host "Telemetria parada (porta $porta; ela não respondia). Os dados continuam na pasta de dados."
  }
  return 0
}

$codigo = 0
if ($PSBoundParameters.ContainsKey('Port') -or @(Quem-Escuta $Port).Count -gt 0) {
  $codigo = Para-Porta $Port
} else {
  # nada na 8090: procura a telemetria no modo local noutra porta (atalho com -Port)
  $repo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
  $outras = @(Servidores-Telemetria $repo | ForEach-Object { $_.Portas } | Select-Object -Unique |
      Where-Object { $p = $_; (E-Local (Le-Info $p)) })
  if ($outras.Count -eq 0) {
    Write-Host "A telemetria não está rodando (porta $Port)."
  }
  foreach ($p in $outras) {
    $c = Para-Porta $p
    if ($c -gt $codigo) { $codigo = $c }
  }
}
Pausa-Se-Janela-Propria
exit $codigo
