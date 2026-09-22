# DOCXの読み込み・出力

Wordとの受け渡しには `.docx` を使います。標準の保存形式は `.dcon` で、DOCXは文書モデルとの変換です。対応範囲外の内容は警告で確認し、必要な文書では変換後に本文・書式・ページを見直してください。

## 画面なしで変換する

```ts
import { importDocumentDocx, exportDocumentDocx } from "@likex/document/model";

const imported = await importDocumentDocx(file);
const document = imported.document;
const importWarnings = imported.warnings;

const exported = await exportDocumentDocx(document);
const bytes = new Uint8Array(await exported.blob.arrayBuffer());
const exportWarnings = exported.warnings;
```

入力はBlob・ArrayBuffer・Uint8Arrayなど共通Office入力型で受け取ります。返されたBlobの保存・ダウンロードは呼び出し側が行います。`{ signal }` でキャンセルを伝えられます。変換はネットワークへ接続せず、React・DOMなしで動作します。

## 対応範囲

| 内容 | 変換時の扱い |
| --- | --- |
| 段落・見出し・改行・文字 | 文書モデルへ変換 |
| 太字・斜体・下線・取り消し線・フォント・文字色・背景色・リンク | 対応する文字書式へ変換 |
| 揃え・箇条書き・番号付きリスト | 対応する段落・リストへ変換 |
| 表・見出しセル・セル結合・列幅・背景色 | 文書モデルに保持できる構造へ変換 |
| PNG／JPEG | 埋め込み画像として変換。浮動配置は本文中の画像へ変更 |
| 用紙サイズ・余白・明示的改ページ | 文書全体のページ設定と改ページへ変換 |
| 複数セクション・段組み | 最後のセクションの用紙設定と1段の本文へ変換 |
| 変更履歴 | 承認後の本文に相当する内容を読み込み |
| フィールド | 再計算せず保存済みの表示文字列を読み込み |
| ヘッダー・フッター・脚注・文末脚注・コメント | 対応外として警告 |
| 図形・グラフ・SmartArt・旧形式の描画・埋め込みオブジェクト | 対応外として警告 |

独自の表罫線、画像の回転・反転・切り抜きなど、モデルにない表現は維持しません。マクロ・暗号化文書・外部テンプレートは受け付けず、外部画像やデータの取得は行いません。ブラウザーとWordのフォント計測やレイアウトは異なるため、完全な往復互換や同一の改ページ位置は保証しません。

## 表示中コンポーネントとの連携

refの `importDocx(input)` は表示中の編集許可を通して下書きを置き換え、`exportDocx()` はBlobを返します。警告は `onEvent` の `{ type: "import" | "export", format: "docx", warnings }` で受け取れます。純粋な `exportDocumentDocx` は `{ blob, warnings }` を返し、refはBlobを返す点に注意してください。
