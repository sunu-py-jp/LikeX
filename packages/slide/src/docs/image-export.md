# スライドをPNG画像に書き出す

スライド1枚、連続した範囲、指定した複数ページをPNGへ変換できます。ブラウザー用の `@likex/slide/render` はReactのマウントとエディターのCSSを必要としません。画像は返り値で受け取り、保存・ダウンロード・アップロードは利用側で行います。

## ブラウザーから使う

```ts
import { exportImage, exportImages } from "@likex/slide/render";

const image = await exportImage(deck, { pageNumber: 3, scale: 2 });
// image.blob, image.width, image.height, image.mimeType,
// image.pageNumber, image.slideId
const images = await exportImages(deck, { range: { from: 2, to: 5 } });
```

同じ関数は `@likex/slide` からもimportできます。ブラウザー用のオプション型は `SlideImageExportOptions` / `SlideImagesExportOptions`、返り値は `SlideImageResult<Blob>` です。`renderer` を省略すると組み込みのCanvas描画を使い、ホストの描画関数へ差し替えることもできます。表示中のエディターがなくても、検証済みの `SlideDeck` を渡せます。`.slon` のJSONを使う場合は、先に `parseSlideDeck` で読み込みます。

## 対象と解像度

ページ番号は **1始まり** です。`slideId` は資料内の既存IDを使います。

| 関数 | 対象の指定 |
| --- | --- |
| `exportImage` | `{ pageNumber: 3 }` または `{ slideId: "summary" }` |
| `exportImages` | `{ range: { from: 2, to: 5 } }`（両端を含む） |
| `exportImages` | `{ pageNumbers: [1, 3, 5] }` または `{ slideIds: ["summary", "cover"] }` |
| `exportImages` | 指定なしで全スライド |

同時に複数の指定方法を使うこと、重複したページやID、存在しない対象は拒否します。配列の指定順を保ち、範囲指定と全ページ指定は資料のページ順で返します。

`scale` は既定で `1`。資料の幅・高さに倍率を掛け、`Math.round` で画像サイズを決めます。`format` は省略可能で、現在は `"png"` のみです。`animationState` は `"final"`（既定）または `"initial"`。前者は全ステップ完了後、後者は元の要素値で描きます。`signal` に `AbortSignal` を渡して中止できます。単一ページは結果1つ、複数ページは結果の配列を返します。

| 結果のフィールド | 内容 |
| --- | --- |
| `blob` | PNGのバイナリー。ブラウザーではBlobとして保存・表示に利用 |
| `width` / `height` | 出力画像の幅・高さ（px） |
| `mimeType` | `"image/png"` |
| `pageNumber` / `slideId` | 元資料での1始まりのページ番号とスライドID |

出力は幅・高さそれぞれ16,384px以下、1枚40,000,000px以下、1回の全画像160,000,000px以下、画像バイナリー合計100MiB以下に制限します。対象・寸法を先に検証し、複数ページの処理が途中で失敗した場合は完成した結果配列を返しません。

## 表示中の下書きを出力する

```ts
const image = await slideRef.current?.exportImage({ pageNumber: 3 });
const images = await slideRef.current?.exportImages({ pageNumbers: [1, 3, 5], scale: 2 });
```

`SlideHandle.exportImage` / `exportImages` は入力途中の文字などを先に確定し、その内容を含めて出力します。出力処理自体は選択・履歴・未保存状態を変更せず、`onSave` や自動ダウンロードも実行しません。入力確定で発生した編集は通常どおり履歴と未保存状態へ反映します。

読み取り専用でも出力できますが、`features.export: false`、処理競合、アンマウント後などは拒否します。確定済みのモデルだけが必要な場合は `getDeck({ includeAnimations: true })` と関数APIを使えます。元の値と定義を渡すことで、関数APIでも `animationState` を選べます。

## Nodeなど画面なしの環境

`@likex/slide/model` にも同名の関数があります。この入口はReact・DOMに依存せず、描画関数 `renderer` の明示が必要です。

```ts
import { exportImages, parseSlideDeck } from "@likex/slide/model";
import { renderSlideImage } from "./my-renderer.js";

const deck = parseSlideDeck(nativeJson);
const images = await exportImages(deck, {
  pageNumbers: [1, 3],
  renderer: renderSlideImage,
});
```

描画関数の型は `SlideImageRenderer`、引数は `SlideImageRenderRequest`、結果は `SlideImageResult` です。`renderer(request)` は `{ deck, slide, pageNumber, width, height, scale, format: "png", signal }` を受け取り、PNGの `OfficePackageBlob` またはそのPromiseを返します。これは `size`、`type`、`arrayBuffer()`、`text()` を持つDOM非依存の型で、NodeのBlobも使えます。描画関数にはフォント・画像の読み込み完了、対応要素の描画、中止への対応を実装してください。

ブラウザーやCanvasの準備、Node向けの描画ライブラリーはホストの責務です。ライブラリーやCLIはブラウザーを自動インストールしません。組み込みのブラウザー描画を使う場合は `/render` を選び、Node環境では対応するアダプターを注入します。ブラウザー、フォント、描画アダプターによって字形・折り返しなどの見た目は異なり得ます。

組み込み描画はPNG・JPEG・静止WebPを通常の画像デコードで扱います。GIF・APNG・アニメーションWebPは `ImageDecoder` で先頭フレームへ固定し、非対応環境では明示的に失敗します。フォント設定・余白・行の高さは画面と共通ですが、Canvasでの文字幅測定とCJKの折り返しを使うため、ブラウザーの禁則処理まで完全に一致するものではありません。

画像出力の追加でSLONの保存構造・モデルコマンド・PPTXの入出力は変わりません。ノートや編集用の選択枠は画像の対象ではありません。

[導入](README.md) · [コマンドと表示中のAPI](commands.md) · [PowerPoint入出力](powerpoint.md)

アニメーション付き資料は、既定で全ステップ完了後の最終静止状態を出力します。`{ animationState: "initial" }` で元の要素値の静止画を取得できます。クリック待ちや遅延は画像出力時には再生せず、元のSLONの値や定義を変更しません。[アニメーションとget API](animations.md)
