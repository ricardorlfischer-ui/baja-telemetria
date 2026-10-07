<#
.SYNOPSIS
  Funções comuns dos scripts da telemetria no modo local (abrir, parar, criar o atalho).
  Carregado com ". (Join-Path $PSScriptRoot 'comum.ps1')"; não roda sozinho.
  Feito para o Windows PowerShell 5.1.
#>

<# Saída em UTF-8 quando vai para um arquivo ou outro programa (Git Bash, npm run local | ...):
 * sem isso o PowerShell 5.1 escreve na página de código do console (850/1252) e os acentos
 * chegam trocados. No console de verdade não mexe (lá o texto já sai certo). #>
function Usa-Utf8 {
  try {
    if ([Console]::IsOutputRedirected -or [Console]::IsErrorRedirected) {
      [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    }
  } catch { }
}

<# GET /api/info no próprio computador (sem Origin: o modo local deixa). Devolve o objeto,
 * ou $null se ninguém responde / não é JSON. Sem proxy (um proxy do sistema não entra aqui). #>
function Le-Info([int]$porta) {
  try {
    $req = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$porta/api/info")
    $req.Proxy = $null
    $req.Timeout = 2000
    $req.ReadWriteTimeout = 2000
    $req.Accept = 'application/json'
    $resp = $req.GetResponse()
    try {
      $leitor = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::UTF8)
      $json = $leitor.ReadToEnd()
    } finally { $resp.Close() }
    return ($json | ConvertFrom-Json)
  } catch {
    return $null
  }
}

function E-Local($info) {
  return ($null -ne $info) -and ($info.PSObject.Properties.Name -contains 'localMode') -and ($info.localMode -eq $true)
}

<# Linhas do netstat de quem escuta (TCP e TCPv6): objetos { Porta, Pid }. netstat e não
 * Get-NetTCPConnection: esse leva uns 2 s para carregar. A linha de quem escuta tem o
 * endereço remoto 0.0.0.0:0 ou [::]:0 (o nome do estado muda com o idioma do Windows). #>
function Escutas {
  $r = @()
  foreach ($l in @(netstat.exe -ano -p TCP) + @(netstat.exe -ano -p TCPv6)) {
    if ($l -match '^\s*TCP\s+\S+:(\d+)\s+(0\.0\.0\.0:0|\[::\]:0)\s+\S+\s+(\d+)\s*$') {
      $r += New-Object PSObject -Property @{ Porta = [int]$Matches[1]; Pid = [int]$Matches[3] }
    }
  }
  return $r
}

<# PIDs que escutam na porta TCP (qualquer endereço). #>
function Quem-Escuta([int]$porta) {
  return @(Escutas | Where-Object { $_.Porta -eq $porta } | ForEach-Object { $_.Pid } | Select-Object -Unique)
}

function Descreve-Processo([int]$id) {
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($p) { return "$($p.ProcessName) (PID $id)" }
  return "PID $id"
}

<# É o servidor da telemetria (node ...\apps\server\dist\index.js), pela linha de comando?
 * Serve para reconhecer um servidor travado, que não responde /api/info. #>
function E-Servidor-Telemetria([int]$id) {
  try {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction Stop
    if (-not $p -or $p.Name -ne 'node.exe' -or -not $p.CommandLine) { return $false }
    return ($p.CommandLine -match 'apps[\\/]server[\\/]dist[\\/]index\.js')
  } catch { return $false }
}

<# Servidores da telemetria deste repositório rodando (qualquer porta), achados pela linha
 * de comando que o abrir-telemetria.ps1 usa (node "<repo>\apps\server\dist\index.js"):
 * objetos { Pid, Portas }. #>
function Servidores-Telemetria([string]$repo) {
  $js = (Join-Path $repo 'apps\server\dist\index.js').ToLowerInvariant()
  $r = @()
  $escutas = @(Escutas)
  try {
    foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop)) {
      if ($p.CommandLine -and $p.CommandLine.ToLowerInvariant().Contains($js)) {
        $id = [int]$p.ProcessId
        $portas = @($escutas | Where-Object { $_.Pid -eq $id } | ForEach-Object { $_.Porta } | Select-Object -Unique)
        $r += New-Object PSObject -Property @{ Pid = $id; Portas = $portas }
      }
    }
  } catch { }
  return $r
}

<# Para o processo e os filhos (o processo da análise). #>
function Para-Arvore([int]$id) {
  & taskkill.exe /PID $id /T /F 2>&1 | Out-Null
}

<# Rodou com "Executar com o PowerShell" (clique direito no Explorador)? A janela é só deste
 * script e fecha assim que ele termina, antes de dar para ler: espera um Enter. Num terminal,
 * pelo npm ou com a saída redirecionada não espera nada. #>
function Pausa-Se-Janela-Propria {
  try {
    if ([Console]::IsInputRedirected -or [Console]::IsOutputRedirected) { return }
    if (-not ('BajaConsole.Lista' -as [type])) {
      Add-Type -Namespace BajaConsole -Name Lista -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint GetConsoleProcessList(uint[] ids, uint n);'
    }
    $ids = New-Object 'uint32[]' 8
    if ([BajaConsole.Lista]::GetConsoleProcessList($ids, 8) -eq 1) {
      Write-Host ''
      [void](Read-Host 'Pressione Enter para fechar esta janela')
    }
  } catch { }
}
