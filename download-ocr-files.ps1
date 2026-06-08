# SM/GI 光ケーブル規格値計算 - オフラインOCR用ファイル取得スクリプト
# 使い方:
# 1. この .ps1 を右クリック → PowerShellで実行
# 2. 取得完了後、VS Code + Live Serverで index.html を起動
# 3. スマホで開いてホーム画面に追加
#
# 注意:
# 初回のファイル取得時だけインターネット接続が必要です。
# 取得後は vendor/tesseract/ 内のファイルを使うため、OCRもオフライン動作を試せます。

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$VendorDir = Join-Path $ScriptDir "vendor\tesseract"

New-Item -ItemType Directory -Force -Path $VendorDir | Out-Null

$Files = @(
  @{
    Url = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"
    Out = "tesseract.min.js"
  },
  @{
    Url = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js"
    Out = "worker.min.js"
  },
  @{
    Url = "https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js"
    Out = "tesseract-core.wasm.js"
  },
  @{
    Url = "https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm"
    Out = "tesseract-core.wasm"
  },
  @{
    Url = "https://tessdata.projectnaptha.com/4.0.0/jpn.traineddata.gz"
    Out = "jpn.traineddata.gz"
  },
  @{
    Url = "https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz"
    Out = "eng.traineddata.gz"
  }
)

Write-Host "OCRファイルを取得します..." -ForegroundColor Cyan
Write-Host "保存先: $VendorDir" -ForegroundColor Cyan

foreach ($File in $Files) {
  $OutPath = Join-Path $VendorDir $File.Out
  Write-Host "Downloading $($File.Out) ..." -ForegroundColor Yellow
  Invoke-WebRequest -Uri $File.Url -OutFile $OutPath
}

Write-Host ""
Write-Host "完了しました。" -ForegroundColor Green
Write-Host "vendor/tesseract/ にOCRファイルが入りました。" -ForegroundColor Green
Write-Host "次に VS Code + Live Server で index.html を開いてください。" -ForegroundColor Green

Pause
