# 画像の収集と重複判定

`collectDocumentImages(document, options?)` は、文書内の埋め込み画像を元のバイト列でまとめ、各画像ブロックとの対応を返す非同期APIです。`@likex/document/model` と `@likex/document` から利用でき、React・DOM・通信は不要です。WordのDOCXファイルは先に `importDocumentDocx`、ネイティブファイルは `parseDocument` でモデルへ変換します。

```ts
import { importDocumentDocx, collectDocumentImages } from "@likex/document/model";

const controller = new AbortController();
const { document, warnings } = await importDocumentDocx(file, { signal: controller.signal });
const { images, placements } = await collectDocumentImages(document, {
  signal: controller.signal,
});
console.log(warnings);
for (const image of images) {
  const uses = placements.filter(placement => placement.imageId === image.imageId);
  console.log(image.imageId, image.mimeType, image.byteLength, uses);
}
```

同じ画像が本文や表に異なるサイズで貼られている場合、`images` は1件、`placements` は画像ブロックの数だけ返します。画像がない文書では両配列が空になります。入力全体を検証し、非同期処理の前に文書のスナップショットを取るので、処理中の呼び出し側の変更に影響されません。中断や検証失敗ではPromiseをrejectし、部分的な結果は返しません。

## 画像本体と配置

| 型 | 内容 |
| --- | --- |
| `DocumentImageAsset` | `{ imageId, src, mimeType, byteLength }`。重複を除いた画像本体。共通の `EmbeddedImageAsset` 型の別名 |
| `DocumentImagePlacement` | `{ imageId, documentId, blockId, from, to, width, height, alt }`。各画像ブロックの情報 |
| `DocumentImageCollection` | `{ images, placements }` |
| `DocumentImageCollectionOptions` | `{ signal? }`。DOCX入出力と共通のキャンセル信号 |

`imageId` は `sha256:` と64桁の小文字16進数で、埋め込み画像の復号後のバイト列から計算します。`src` は画像本体のデータURL、`mimeType` は形式、`byteLength` は元ファイルのバイト数です。表示サイズ、代替テキスト、ブロックIDは画像IDへ含めません。同じ画像をLikeSlide・Spreadsheetでも保持している場合、元のバイト列が同じなら画像IDも同じです。

`placements` は本文の走査順で、表のセル、箇条書き・番号付きリストに入った画像も含みます。`images` は最初に現れた順です。`blockId` は画像ブロックの `attrs.id`、`from` / `to` は取得時点のProseMirror位置です。文字数だけで位置を推測せず、編集後は取り直してください。`width` / `height` は表示枠のpxで、画像本体の画素寸法とは別です。

ページ番号や画面上の座標は返しません。Wordの改ページ位置はフォントや表示環境に依存するため、ページ番号が必要なホストは描画後のレイアウト情報と対応付けます。保存されたID・文書内容・DCON v1の構造は変更せず、画像IDもファイルへ自動保存しません。

## ホスト側で解析を再利用する

ホストは `images` の各画像を一度ずつ解析し、返された説明・OCR等を `imageId` で各配置へ結び付けられます。Azure等のサービスへの接続、認証、保存やキャッシュはホストの責務です。以下の `analyzeImage` はホストが実装する関数で、ライブラリは外部解析サービスを呼びません。

```ts
import { collectDocumentImages, type DocumentModel, type DocumentImageAsset } from "@likex/document/model";

type Analysis = { description: string };
type Settings = { model: string; version: string; promptVersion: string; detail: "low" | "high" };

async function analyzeDocumentImages(
  document: DocumentModel,
  settings: Settings,
  cacheScope: string,
  cache: Map<string, Analysis>,
  analyzeImage: (image: DocumentImageAsset, settings: Settings, signal: AbortSignal) => Promise<Analysis>,
  signal: AbortSignal,
) {
  const { images, placements } = await collectDocumentImages(document, { signal });
  const byId = new Map<string, Analysis>();
  for (const image of images) {
    signal.throwIfAborted();
    const key = JSON.stringify([
      cacheScope, image.imageId, settings.model, settings.version,
      settings.promptVersion, settings.detail,
    ]);
    let analysis = cache.get(key);
    if (!analysis) {
      analysis = await analyzeImage(image, settings, signal);
      signal.throwIfAborted();
      cache.set(key, analysis);
    }
    byId.set(image.imageId, analysis);
  }
  signal.throwIfAborted();
  return placements.map(placement => ({ ...placement, analysis: byId.get(placement.imageId)! }));
}
```

キャッシュには画像IDとモデル名・版・プロンプト・解析オプションを含め、利用者・テナントごとのアクセス範囲も保ちます。周囲の文章を一緒に渡す解析では文脈もキーに含めてください。文書を切り替えたら古い処理を中断し、解析後の表示や編集前にも対象が同じか確認します。画像の `alt` や解析された文章は文書データとして扱います。

## 入力形式と限界

LikeDocumentが保持できる画像は埋め込みPNG・JPEGです。リモートURL・Blob URL・SVG・GIF・WebPは受け付けず、既存の画像ヘッダー・寸法・サイズ・文書構造の検証に従います。1画像8 MiB、合計24 MiB、各辺16,384px、64,000,000画素までです。同一画像の配置をまとめても、保存モデルの画像サイズ上限は従来どおりです。

同じ絵でも、元ファイルをリサイズ・再圧縮・別形式へ変換した場合やメタデータが違う場合は別IDです。知覚ハッシュによる類似画像判定や、ページ全体のレンダリングは行いません。Web CryptoのSHA-256を使うため、ブラウザーではHTTPS等のセキュアコンテキスト、Node.jsでは22.13以降を使います。

DOCXの取込で保持された本文画像が対象です。既存のDOCX変換はヘッダー・フッター、外部参照画像、PNG・JPEG以外の画像を省略して警告します。浮動画像は本文ブロックになり、切り抜き・回転・反転は省略されます。収集APIは取込で失われた画像を復元しません。[DOCX入出力の対応範囲](docx.md)と変換時の `warnings` を確認してください。DOCXの往復では元のブロックIDを保持する契約はないため、取り込み後の `blockId` と位置を使います。

## CLIで画像一覧を読む

```bash
node "$skill_dir/scripts/document.mjs" inspect --project "$project_dir" \
  --input document.dcon --images
```

`selection.images` は `imageId`・`mimeType`・`byteLength` のみ、`selection.placements` は各画像の位置と寸法です。画像の `src` やバイト列はCLIへ出力しません。Documentの `--images` は他の取得セレクター・`--include-data`・ページングと併用できず、`--compact-summary`・`--include-animations` も受け付けません。1 MiBを超える応答は `RESPONSE_TOO_LARGE` となり、一部だけを返しません。必要な情報への絞り込みや画像本体の取得はホスト側で公開APIを使います。
