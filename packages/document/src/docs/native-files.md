# ネイティブ保存形式

LikeDocumentの標準拡張子は `.dcon` です。UTF-8のJSONに `format: "likex.document"`、`version: 1`、文書ID、タイトル、用紙設定、本文構造を保存します。本文は `type: "doc"` のルートを持つProseMirror互換JSONで、HTMLやエディターDOMは保存しません。

## 読み込みと保存

```ts
import { parseDocument, serializeDocument } from "@likex/document/model";

const document = parseDocument(await file.text());
const nativeJson = serializeDocument(document);
const nativeBlob = new Blob([nativeJson], { type: "application/json" });
```

拡張子やMIMEタイプだけで内容を受け入れず、`parseDocument` で形式・バージョン・ノード・画像・上限を検証します。`serializeDocument` は検証後にインデント・改行・キー順を揃え、ブロックの順序を保って出力します。正規化済みの同じ文書を保存する際に日時や新しいIDを加えません。

`createDocument` は初期値を補い、`normalizeDocument` は文書全体を検証します。新規ブロックにはIDが割り当てられます。既存IDを維持して部分編集するには、公開コマンドを使ってください。旧形式を形式識別子やバージョンだけ書き換えて読み込ませる契約はありません。

DCONの上限はUTF-8で40 MiBです。画像は1枚8 MiB、合計24 MiBまでで、文書のノード数・深さ・文字数にも上限があります。上限を超える文書は保存前にエラーとして扱います。

## 保存するデータ

| フィールド | 内容 |
| --- | --- |
| `format` / `version` | `"likex.document"` / `1` |
| `id` / `title` | 文書の識別子とタイトル |
| `page.width` / `page.height` | 用紙サイズ。ミリメートル |
| `page.margins` | `top` / `right` / `bottom` / `left`。ミリメートル |
| `content` | 段落・見出し・リスト・表・画像・改ページを含むノードツリー |

段落などのブロックIDは `attrs.id` にあります。文字の書式はテキストノードの `marks` に保存します。選択位置・Undo／Redo履歴・保存状態・編集許可・表示テーマは保存ファイルに含みません。

`onSave` は `DocumentModel` を受け取り、保存先とファイル名は親アプリが決めます。JSONとして保存する場合は上の専用シリアライザーを使います。Wordとの受け渡しには [DOCX](docx.md) を使ってください。
