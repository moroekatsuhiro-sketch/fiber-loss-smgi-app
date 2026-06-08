# オフラインOCRを有効化する手順

## 目的

このアプリで以下のOCRをオフライン運用できるようにします。

- 現場名
- 始端盤名
- 遠端盤名

## 手順

1. このフォルダを解凍する
2. `download-ocr-files.ps1` を右クリック
3. 「PowerShellで実行」を選ぶ
4. `vendor/tesseract/` にOCRファイルが入ったことを確認する
5. VS Codeでこのフォルダを開く
6. Live Serverで `index.html` を起動する
7. スマホで開く
8. ホーム画面に追加
9. 通信を切ってOCRをテストする

## 必要ファイル

`vendor/tesseract/` に以下が入ればOKです。

- `tesseract.min.js`
- `worker.min.js`
- `tesseract-core.wasm.js`
- `tesseract-core.wasm`
- `jpn.traineddata.gz`
- `eng.traineddata.gz`

## 注意

初回のファイル取得だけインターネット接続が必要です。  
取得後は、アプリ内のローカルファイルを使うため、OCRもオフラインで動かせる構成になります。

うまく動かない場合は、まずオンライン状態で一度読み込み、その後に通信を切って確認してください。
