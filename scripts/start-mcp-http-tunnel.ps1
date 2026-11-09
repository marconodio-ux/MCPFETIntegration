#Requires -Version 5.1
<#
.SYNOPSIS
  Opt-in HTTPS tunnel (cloudflared or ngrok) for the local MCP Streamable HTTP bridge.

.DESCRIPTION
  ChatGPT rejects plain loopback HTTP (http://127.0.0.1:...). Prefer OpenAI Secure MCP Tunnel
  (Connection → Tunnel + tunnel_id). Use this script only when you need a temporary public HTTPS URL.

  Flow:
    1. Starts a quick tunnel to http://127.0.0.1:<port>
    2. Prints the public https://…/mcp URL to paste in ChatGPT
    3. Prints the exact env vars to restart npm run mcp:http with MCP_HTTP_TOKEN + MCP_HTTP_ALLOWED_HOSTS

  Requires explicit -IUnderstandPublicExposure. Does not start the bridge itself.

.PARAMETER Port
  Local bridge port (default 3847).

.PARAMETER Provider
  cloudflared (default) or ngrok.

.PARAMETER Token
  MCP_HTTP_TOKEN value. If omitted, a random token is generated and printed once.
#>
[CmdletBinding()]
param(
  [int]$Port = 3847,
  [ValidateSet("cloudflared", "ngrok")]
  [string]$Provider = "cloudflared",
  [string]$Token = "",
  [switch]$IUnderstandPublicExposure
)

$ErrorActionPreference = "Stop"

function Write-Banner([string]$Text) {
  Write-Host ""
  Write-Host "=== $Text ===" -ForegroundColor Yellow
}

if (-not $IUnderstandPublicExposure) {
  Write-Banner "OPT-IN REQUIRED"
  Write-Host @"
This publishes your local MCP FET bridge to the public Internet for a short test.
Anyone with the URL (and without a token ChatGPT can send) can invoke FET tools.

Prefer OpenAI Secure MCP Tunnel instead:
  ChatGPT → Aggiungi un server MCP personalizzato → Connessione → Tunnel → tunnel_id

To continue with cloudflared/ngrok anyway, re-run with:
  .\scripts\start-mcp-http-tunnel.ps1 -IUnderstandPublicExposure
"@
  exit 2
}

function Find-Tool([string]$Name) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

function New-Token {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return ([Convert]::ToHexString($bytes)).ToLowerInvariant()
}

if (-not $Token) {
  $Token = New-Token
}

$localTarget = "http://127.0.0.1:$Port"
$httpsUrl = $null
$hostName = $null
$proc = $null
$logOut = Join-Path $env:TEMP ("mcp-fet-tunnel-" + [guid]::NewGuid().ToString("n") + ".out.log")
$logErr = Join-Path $env:TEMP ("mcp-fet-tunnel-" + [guid]::NewGuid().ToString("n") + ".err.log")

function Read-TunnelLogs {
  $parts = @()
  if (Test-Path $logOut) { $parts += (Get-Content -Path $logOut -Raw -ErrorAction SilentlyContinue) }
  if (Test-Path $logErr) { $parts += (Get-Content -Path $logErr -Raw -ErrorAction SilentlyContinue) }
  return ($parts -join "`n")
}

try {
  if ($Provider -eq "cloudflared") {
    $bin = Find-Tool "cloudflared"
    if (-not $bin) {
      $guess = "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe"
      if (Test-Path $guess) { $bin = $guess }
    }
    if (-not $bin) {
      throw "cloudflared not found on PATH. Install: winget install --id Cloudflare.cloudflared -e"
    }
    Write-Banner "Starting cloudflared quick tunnel → $localTarget"
    $proc = Start-Process -FilePath $bin -ArgumentList @("tunnel", "--url", $localTarget) `
      -NoNewWindow -PassThru -RedirectStandardOutput $logOut -RedirectStandardError $logErr

    $deadline = (Get-Date).AddSeconds(45)
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 400
      $text = Read-TunnelLogs
      if ($text -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
        $httpsUrl = $Matches[0].TrimEnd("/")
        break
      }
      if ($proc.HasExited) {
        throw "cloudflared exited early. Log:`n$(Read-TunnelLogs)"
      }
    }
  }
  else {
    $bin = Find-Tool "ngrok"
    if (-not $bin) {
      throw "ngrok not found on PATH. Install from https://ngrok.com/download and authenticate (ngrok config add-authtoken …)."
    }
    Write-Banner "Starting ngrok http $Port"
    $proc = Start-Process -FilePath $bin -ArgumentList @("http", "$Port", "--log=stdout", "--log-format=logfmt") `
      -NoNewWindow -PassThru -RedirectStandardOutput $logOut -RedirectStandardError $logErr

    $deadline = (Get-Date).AddSeconds(45)
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 400
      try {
        $api = Invoke-RestMethod -Uri "http://127.0.0.1:4040/api/tunnels" -TimeoutSec 2
        $https = @($api.tunnels | Where-Object { $_.public_url -like "https://*" } | Select-Object -First 1)
        if ($https) {
          $httpsUrl = ([string]$https.public_url).TrimEnd("/")
          break
        }
      } catch {
        # ngrok API not ready yet
      }
      if ($proc.HasExited) {
        throw "ngrok exited early. Log:`n$(Read-TunnelLogs)"
      }
    }
  }

  if (-not $httpsUrl) {
    throw "Timed out waiting for public HTTPS URL. Log:`n$(Read-TunnelLogs)"
  }

  $uri = [Uri]$httpsUrl
  $hostName = $uri.Host
  $pasteUrl = "$httpsUrl/mcp"

  Write-Banner "PASTE INTO CHATGPT (Connessione → URL del server)"
  Write-Host $pasteUrl -ForegroundColor Green
  Write-Host ""
  Write-Host "Nome suggerito: Orario Fet"
  Write-Host "Autenticazione UI ChatGPT: nessuna (il Bearer locale non è inviato dalla UI plugin)."
  Write-Host "Quindi tieni il tunnel acceso SOLO per la prova, poi Ctrl+C / chiudi questo processo."
  Write-Host ""

  Write-Banner "RESTART BRIDGE (altro terminale) CON QUESTI ENV"
  Write-Host @"
cd "C:\path\to\MCPFETIntegration"
`$env:FET_CL_PATH = "C:\path\to\MCPFETIntegration\vendor\bin\fet-7.12.0\fet-cl.exe"
`$env:MCP_HTTP_TOKEN = "$Token"
`$env:MCP_HTTP_ALLOWED_HOSTS = "$hostName"
npm run mcp:http
"@

  Write-Banner "VERIFY LOCALLY"
  Write-Host "curl http://127.0.0.1:$Port/health"
  Write-Host "curl -H `"Authorization: Bearer $Token`" -H `"Host: $hostName`" http://127.0.0.1:$Port/health"
  Write-Host ""
  Write-Host "Tunnel PID=$($proc.Id)"
  Write-Host "logs: $logOut | $logErr"
  Write-Host "Press Ctrl+C to stop the tunnel when done."
  Write-Host ""

  # Keep process attached until user stops
  Wait-Process -Id $proc.Id
}
finally {
  if ($proc -and -not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  }
}
