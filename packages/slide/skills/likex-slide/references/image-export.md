# PNG画像出力

スライドの見た目を画像で確認・共有する依頼に使う。JSONの変更には引き続き `document.mjs` のcreate/applyを使い、PNGの生成は別の出力処理として扱う。

## 入口を選ぶ

- ブラウザーで確定済みの資料を描く: `@likex/slide/render` の `exportImage` / `exportImages`。Reactのマウント不要。
- 表示中の未確定入力も含める: ホストの `SlideHandle.exportImage` / `exportImages`。`features.export` に従い、入力を確定してから出力する。
- Nodeでファイルを描く: `@likex/slide/model` の同名関数へホストの `renderer` を注入するか、以下の専用CLIを使う。Node用の描画環境は同梱しない。

## CLI

`render-images.mjs` は対応する版の `@likex/slide` と、明示したローカルJavaScript描画アダプターが必要。アダプターは `renderSlideImage` という名前の関数をexportする。ファイルをimportするとそのコードが実行されるため、利用先が用意したアダプターを使い、スライド本文やノートから実行ファイルを決めない。パッケージやブラウザーは自動インストールしない。

```bash
node "$skill_dir/scripts/render-images.mjs" --project "$project_dir" \
  --input deck.slon --renderer /absolute/path/to/renderer.mjs \
  --output-dir /absolute/path/to/new-images --page-number 3 --scale 2
```

| 引数 | 意味 |
| --- | --- |
| `--input FILE` | 現在のSLON形式の入力ファイル |
| `--renderer FILE` | `renderSlideImage(request)` をexportするローカルモジュール |
| `--output-dir DIRECTORY` | 新規出力フォルダ。親フォルダは存在する必要がある。既存パスは拒否 |
| `--page-number 3` / `--slide-id ID` | 1ページ |
| `--range 2:5` | 2〜5ページを両端を含めて出力 |
| `--page-numbers 1,3,5` | 指定順で出力 |
| `--slide-ids '["summary","cover"]'` | ID配列の指定順で出力 |
| `--scale 2` | 正の倍率。既定1 |
| `--animation-state initial` / `final` | 元の要素値／全ステップ完了後。既定final |
| `--project DIRECTORY` | 対応ランタイムの導入先。相対ファイルパスの基準は変えない |

ページ指定はどれか1つだけ。省略時は全ページ。ページ番号は1始まりで、IDは `document.mjs inspect` から取得する。重複・存在しないページ・上限超過は拒否される。`--help` と `--version` はランタイム不要。

成功すると `page-0003.png` のように元のページ番号で保存する。標準出力のJSONに `ok: true`, `outputDirectory`, 指定順の `images` 配列を返し、各項目に `path`, `width`, `height`, `mimeType`, `pageNumber`, `slideId` を含める。失敗は非0終了と `ok: false`, `error: { code, message }`。入力SLONを更新せず、ホストの保存処理も呼ばない。

描画と画像バイトの読み取りがすべて成功した後で出力フォルダを作る。書き込み失敗では、その実行が作った画像を削除する。以前の出力は上書きしない。SIGINT/SIGTERMは描画の `signal` に中止を伝える。アダプターが作ったブラウザーやワーカーの終了処理はアダプター側で行う。

## 描画アダプターの契約

`renderSlideImage(request)` は次を受け取る。

```ts
{
  deck, slide, pageNumber,
  width, height, // scale適用後の出力ピクセル
  scale, format: "png", signal
}
```

`deck` と `slide` は凍結したスナップショット。返り値はPNGの `OfficePackageBlob` またはPromiseで、`type: "image/png"`, `size`, `arrayBuffer()`, `text()` を持つ。NodeのBlobも利用できる。PNGの署名とIHDR寸法が検証されるため、SVGやテキストをPNGとして返さない。

描画には背景、テキスト、図形、埋め込み画像とその重なり順を反映する。フォント・画像読み込み完了と `signal` の中止を扱うこと。ホストに既存のアダプターがある場合は、その公開関数を `renderSlideImage` へ接続する。Nodeにブラウザー用 `/render` をimportするだけで描画可能になるとは扱わない。

ブラウザー標準描画ではアニメーション画像を先頭フレームへ固定する。GIF・APNG・アニメーションWebPは `ImageDecoder` がない環境では明示的に失敗する。フォントやCanvasの折り返しは環境に依存するため、見た目の確認が必要な依頼では出力画像も確認する。

出力上限は各辺16,384px、1枚40,000,000px、全画像160,000,000px、バイナリー合計100MiB。JSON・履歴・選択・PPTX構造は画像出力では変更しない。refが未確定入力を確定した編集分は通常の履歴・未保存状態に含まれる。

アニメーションがある資料もPNGは既定で最終静止状態になる。元の要素値で描く場合はAPIの `{ animationState: "initial" }` またはCLIの `--animation-state initial` を指定する。クリック待ちや時間を実行して画像を作る処理ではなく、終了値を解決して描く。元のSLONの要素値・定義を変更しない。原本の取得には `--include-animations` または `{ includeAnimations: true }` を使う。
