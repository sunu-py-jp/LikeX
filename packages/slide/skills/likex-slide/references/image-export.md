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

## SVG素材の入力

図解・イラストの素材として、静的なSVGを通常の `image` 要素へ配置できる。公開 `createSlideSvgSource(svg)` は検証済みの `data:image/svg+xml;base64,…` を返す。戻り値を `element.add.element.src`、`element.update.patch.src` または `slide.replaceContent.elements` の画像へ渡す。手作業でBase64を生成する必要はない。モデルAPIは `@likex/slide/model` からimportする。

AIホストの `add_svg_image` がある場合は、生のSVG文字列と配置先・寸法を渡せる。実際のツール定義を優先する。playgroundでは `slideId`, `elementId`, `svg`, `x`, `y`, `width`, `height` と、公開された `name` / `alt` / `dryRun` / `resolvesFailureIds` を指定する。既存のSVG素材を直す場合は `update_svg_image { slideId, elementId, svg, dryRun, resolvesFailureIds }` を使い、画像のID・配置・寸法・書式を維持して元のSVGだけを更新する。文字や図形を対象にしない。LLM接続やSVG生成はホスト側、本体は検証・描画・保存を担当する。

- ルートは `<svg xmlns="http://www.w3.org/2000/svg">`。正のpx値による `width/height`、または `viewBox="x y width height"` を指定する。
- ルートの `width/height` は単位・空白を含めて各128文字まで。座標・パス等の数値表記は1つにつき128文字までで、パス属性全体を128文字に制限するものではない。SVG作成・SLON読み込み・PPTX読み込みで同じ検証を使い、PPTXでは不正なSVGを診断して利用可能な代替画像を使う。
- 対応要素: `svg`（ルートのみ）、`g`, `defs`, `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `linearGradient`, `radialGradient`, `stop`, `clipPath`, `text`, `tspan`, `title`, `desc`。
- 配置・形状の属性に加えて `transform`, `fill`, `stroke`, `opacity`、線幅・破線、グラデーション、クリッピング、基本の文字書式などのpresentation属性を使う。CSSの `style` / `class`、スタイルシート、スクリプト、イベント属性、`href` / `xlink:href`、外部参照、`image` / `use` / `filter` / `foreignObject` / アニメーションは使わない。
- 内部参照は `fill` / `stroke` の `url(#gradientId)` と `clip-path` の `url(#clipId)`。IDは文書内で一意にし、参照先は対応するグラデーションまたは `clipPath` にする。グラデーションの継承参照は使わない。
- 1 MiB、10,000ノード、深さ32が上限。SVG自体の各辺16,384px、40,000,000画素以内にする。資料全体の画像量も検証する。ホストはさらに小さい入力上限を設定する場合がある。

SVGは単一の画像として移動・拡大縮小・回転できる。内部の文字や曲線を通常の編集可能要素へ分解するAPIではない。改訂する見出し・数値・ラベルは通常の `text`、追従する接続線は `line.add` で別に置く。SVG文字の折り返しは通常の文字診断の対象にならないため、実際の画像で確認する。SVGを一枚追加しただけで資料全体のデザインが完成したとは扱わない。

PPTX出力はSVG原本とPNG代替画像を保持する。ブラウザー用の入口はPNGを自動生成し、ヘッドレス出力はホストの `rasterizeSvg` が必要。PNG出力APIの返り値自体は引き続きPNGで、SVGをPNGに見せかけて返さない。詳しくは [PowerPoint入出力](../../../src/docs/powerpoint.md) を参照する。
