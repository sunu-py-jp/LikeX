# 埋め込み画像と配置の収集

[利用ガイドへ戻る](./README.md)

`collectSpreadsheetImages(workbook, options?)` は、ブック内で使われている画像を重複なく取得し、各画像の配置先を返す非同期APIです。`@likex/spreadsheet/model` とUIの公開入口から利用できます。React・DOM・画像デコード・外部通信は使いません。

同じ画像を複数のシートやセル位置に配置した場合、`images` に元画像が1件入り、`placements` にすべての配置が残ります。別の `resourceId` やファイル名でも、埋め込みファイルのバイト列が同じなら共通の `imageId` になります。ハッシュは元バイト列のSHA-256で、形式は `sha256:` と64桁の小文字16進数です。配置サイズ・回転・反転・説明文は画像の同一性に影響しません。見た目が同じでも、再圧縮やメタデータの違いでバイト列が異なれば別画像です。

LikeSlide・LikeDocumentも同じCoreの処理を使うため、元バイト列が同じなら資料形式をまたいでも同じ画像IDになります。キャッシュは画像IDに加え、解析モデル・バージョン・オプション・アクセス範囲で分けます。ページやシートの文脈も解析に渡す場合、その文脈もキャッシュ条件へ含めます。

## Excelから一度ずつ画像を解析する

```ts
import {
  importSpreadsheetXlsx, collectSpreadsheetImages,
  type SpreadsheetImageAsset,
} from "@likex/spreadsheet/model";

export async function describeExcelImages(
  file: Uint8Array,
  analyze: (image: SpreadsheetImageAsset) => Promise<string>,
) {
  const { workbook, warnings } = await importSpreadsheetXlsx(file);
  const { images, placements } = await collectSpreadsheetImages(workbook);
  const descriptions = new Map<string, string>();
  for (const image of images) {
    descriptions.set(image.imageId, await analyze(image));
  }
  return {
    warnings,
    placements: placements.map(placement => ({
      ...placement,
      description: descriptions.get(placement.imageId),
    })),
  };
}
```

30配置が3種類の元画像を共有するブックでは、`analyze` は3回で済みます。解析結果は `imageId` で配置へ戻します。`analyze` の実装、画像を送るサービス、結果の保存、認証や権限確認は利用側の責務です。API自体は画像を送信しません。

ネイティブSPONは `parseWorkbook(json)` の結果を渡します。`imageId` は収集結果の識別子で、SPONに保存する `resourceId` や描画IDを書き換えません。入力ブック・未使用リソース・保存形式は変わりません。

## 戻り値

`Promise<SpreadsheetImageCollection>` の内容は次のとおりです。

| 配列 | フィールド |
| --- | --- |
| `images: SpreadsheetImageAsset[]` | `imageId`, `src`（元のdata URL）, `mimeType`, `byteLength`（画像ファイルのバイト数） |
| `placements: SpreadsheetImagePlacement[]` | `imageId`, `sheetId`, `sheetName`, `sheetIndex`, `drawingId`, `resourceId`, `anchor`, `width`, `height`, `rotation`, `flipX`, `flipY`, `alt` |

`sheetIndex` と `anchor.row` / `anchor.column` は0始まりです。`anchor.offsetX` / `offsetY` と幅・高さはCSSピクセル、回転は時計回りの度数です。省略された回転・反転は `rotation: 0`, `flipX: false`, `flipY: false` として返します。配置サイズはモデルに保存された枠のサイズで、画面上で縦横比を保って収めた画像の実寸を再計算しません。

`placements` はシート順、その中では描画の配列順です。`images` は配置から初めて参照された順です。描画が参照していない画像リソース、図形、テキスト、セル内のURLは対象外です。対象画像がなければ両配列は空になります。

## 検証とキャンセル

`SpreadsheetImageCollectionOptions` の `signal` には標準の `AbortSignal`、またはDOM型を必要としない `OfficePackageSignal` 互換の値を渡せます。

```ts
const controller = new AbortController();
const pending = collectSpreadsheetImages(workbook, { signal: controller.signal });
controller.abort();
await pending; // キャンセル理由でreject
```

ブック全体を検証し、配置と画像データを最初の非同期処理前に取得します。待機中に呼び出し側が入力を書き換えても、取得中の結果は変わりません。不正なブック・画像参照・オプションやキャンセルではPromiseがrejectし、部分的な結果は返しません。既存の画像上限（1件5 MiB、全リソース合計20 MiB、各辺10,000 px、1画像あたり1,600万画素）を維持します。

画像がある場合はWeb Cryptoが必要です。Node.js 22.13以降、またはHTTPS / localhostの対応ブラウザー・Workerで実行します。空の収集結果ではWeb Cryptoを使いません。

## 画像形式とXLSXの対応範囲

収集対象は、モデルで検証されたPNG・JPEG・GIF・WebPの元画像です。GIFのフレーム分解、JPEGのEXIF回転の焼き込み、PNG変換はしません。SVG・外部画像URLはSpreadsheetの画像リソースとして受け付けません。

XLSXは先に `importSpreadsheetXlsx` で読み込みます。通常の埋め込み画像描画が対象で、外部リンク、グループ内の画像、SVGなどの未対応形式、グラフ・OLEオブジェクト・シート背景・ヘッダーやフッターの画像を網羅する抽出器ではありません。取り込み時の警告を確認してください。トリミング・タイル・効果やOffice固有の表示は取り込み時の対応範囲に従い、収集APIでは復元しません。

XLSX出力ではPNGと通常のJPEGをそのまま格納し、GIF・WebP・EXIF補正が必要なJPEGはPNGへ変換します。その変換前後では元バイト列が変わるため、`imageId` も変わります。画像の枠と元画像の縦横比が異なる場合、Excel出力は枠内に収まる寸法・位置へ調整します。詳しくは[Excel取り込み](./excel-import.md)と[Excel出力](./excel-export.md)を参照してください。

## CLIで配置を確認する

```bash
node "$skill_dir/scripts/document.mjs" inspect --project "$project_dir" \
  --input workbook.spon --images --compact-summary
```

`selection.images` は `imageId`・`mimeType`・`byteLength` のみで、画像本体は含めません。`selection.placements` に各配置を返します。`--images` は `--compact-summary` 以外の取得フラグ・セレクターと併用できません。画像本体が必要な場合は公開APIを呼びます。1MiBの応答上限を超える場合は `RESPONSE_TOO_LARGE` となり、部分的な成功結果は返しません。
