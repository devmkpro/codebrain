# install-whisper.ps1 — Codebrain BrainVoice local Whisper installer (Windows)
# Baixa o build oficial do whisper.cpp + um modelo ggml + ffmpeg para
# ~/.codebrain-app/whisper/ , onde o Codebrain detecta automaticamente.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File scripts\install-whisper.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-whisper.ps1 -Model small
#
# Modelos: tiny | base | small (padrão) | medium | large-v3

param(
  [ValidateSet("tiny", "base", "small", "medium", "large-v3")]
  [string]$Model = "small",
  [string]$TargetDir = ""
)

$ErrorActionPreference = "Stop"
$home2   = [Environment]::GetFolderPath("UserProfile")
if ($TargetDir -and $TargetDir.Trim()) {
  $root = $TargetDir.Trim()
} else {
  $root = Join-Path $home2 ".codebrain-app\whisper"
}
$binDir  = Join-Path $root "bin"
$modelDir= Join-Path $root "models"
New-Item -ItemType Directory -Force -Path $binDir, $modelDir | Out-Null

Write-Host "==> Codebrain Whisper installer" -ForegroundColor Cyan
Write-Host "    Destino: $root`n"

# ---------------------------------------------------------------------------
# 1) whisper.cpp — build oficial pré-compilado (Windows x64, CPU)
# ---------------------------------------------------------------------------
$whisperExe = Join-Path $binDir "whisper-cli.exe"
if (Test-Path $whisperExe) {
  Write-Host "[whisper.cpp] já instalado em $whisperExe" -ForegroundColor Green
} else {
  Write-Host "[whisper.cpp] baixando build oficial..." -ForegroundColor Yellow
  $rel = Invoke-RestMethod "https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest" `
         -Headers @{ "User-Agent" = "codebrain" }
  $asset = $rel.assets | Where-Object { $_.name -match "win.*x64\.zip$" -or $_.name -match "bin-x64\.zip$" } | Select-Object -First 1
  if (-not $asset) { $asset = $rel.assets | Where-Object { $_.name -match "\.zip$" -and $_.name -match "win" } | Select-Object -First 1 }
  if (-not $asset) { throw "Nao encontrei asset Windows no release do whisper.cpp. Baixe manualmente de https://github.com/ggml-org/whisper.cpp/releases e extraia em $binDir" }

  $zip = Join-Path $env:TEMP "whisper-cpp.zip"
  Invoke-WebRequest $asset.browser_download_url -OutFile $zip -Headers @{ "User-Agent" = "codebrain" }
  $tmp = Join-Path $env:TEMP "whisper-cpp-extract"
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive $zip -DestinationPath $tmp -Force

  # Copia todos os .exe e .dll para o binDir (whisper-cli.exe + dependencias)
  Get-ChildItem $tmp -Recurse -Include *.exe, *.dll | ForEach-Object {
    Copy-Item $_.FullName -Destination $binDir -Force
  }
  # Alguns releases nomeiam como main.exe; garante whisper-cli.exe
  if (-not (Test-Path $whisperExe)) {
    $mainExe = Get-ChildItem $binDir -Filter "main.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($mainExe) { Copy-Item $mainExe.FullName $whisperExe -Force }
  }
  Remove-Item $zip, $tmp -Recurse -Force -ErrorAction SilentlyContinue
  if (Test-Path $whisperExe) { Write-Host "[whisper.cpp] OK -> $whisperExe" -ForegroundColor Green }
  else { throw "Falha ao instalar whisper-cli.exe" }
}

# ---------------------------------------------------------------------------
# 2) Modelo ggml
# ---------------------------------------------------------------------------
$modelFile = Join-Path $modelDir "ggml-$Model.bin"
if (Test-Path $modelFile) {
  Write-Host "[modelo] ggml-$Model.bin ja existe" -ForegroundColor Green
} else {
  Write-Host "[modelo] baixando ggml-$Model.bin (pode demorar)..." -ForegroundColor Yellow
  $url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$Model.bin"
  Invoke-WebRequest $url -OutFile $modelFile -Headers @{ "User-Agent" = "codebrain" }
  Write-Host "[modelo] OK -> $modelFile" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# 3) ffmpeg (necessario p/ converter chunks de audio)
# ---------------------------------------------------------------------------
$ffmpegInPath = $null
try { $ffmpegInPath = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source } catch {}
if ($ffmpegInPath) {
  Write-Host "[ffmpeg] ja no PATH: $ffmpegInPath" -ForegroundColor Green
} else {
  Write-Host "[ffmpeg] instalando via winget..." -ForegroundColor Yellow
  try {
    winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
    Write-Host "[ffmpeg] OK (reinicie o terminal para o PATH atualizar)" -ForegroundColor Green
  } catch {
    Write-Host "[ffmpeg] winget falhou. Instale manualmente: https://www.gyan.dev/ffmpeg/builds/" -ForegroundColor Red
  }
}

Write-Host "`n==> Concluido!" -ForegroundColor Cyan
Write-Host "    Binario: $whisperExe"
Write-Host "    Modelo : $modelFile"
Write-Host "    No Codebrain: Configuracoes -> Voz/BrainVoice -> Local. Detecta sozinho." -ForegroundColor Green
