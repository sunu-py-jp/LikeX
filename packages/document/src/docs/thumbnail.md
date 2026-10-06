# 文書の軽量サムネイル

一覧カードには専用の `LikeDocumentThumbnail` を使います。タイトルヘッダーと、指定したページの用紙1枚分を表示します。編集セッション・EditorView・EditorState、リボン、見出し一覧、ズーム操作は作成しません。

```tsx
import { LikeDocumentThumbnail } from "@likex/document/thumbnail";
import "@likex/document/styles.css";

<LikeDocumentThumbnail document={document} pageNumber={2} title="企画書" style={{ height: 280 }}
  onError={error => console.error(error.message)} />
```

`document` と `pageNumber` は制御された値で、変更すると表示が更新されます。`pageNumber` は1始まりで、省略時は1です。編集用refはありません。`title`・`colorMode`・`primaryColor`・`className`・`style`・`aria-label` も指定できます。高さの既定値は280pxで、用紙はヘッダーを除く枠に合わせ、原寸以下に縮小します。本文のリンクや画像は操作できません。

LikeDocumentの画面は連続した本文です。`pageNumber` は本文中の明示的な `page_break` で区切るページを指し、表・リスト内の改ページも文書順に数えます。サムネイルは指定ページの先頭から用紙1枚分を切り取り、次の明示的な改ページで停止します。連続した改ページや末尾の改ページによる空白ページも指定できます。Wordのフォント・自動改ページと一致する厳密なページ番号ではありません。表の途中で区切る場合は列の位置を残しますが、結合セルや自動的な表の分割の再現は保証しません。用紙・余白、文字書式、表、画像、図形、描画キャンバスは通常表示と同じスキーマとCSSを使います。

入力は通常の `normalizeDocument` と同じ検証を受けます。正規化済みモデルは再検証のキャッシュを利用できるため、一覧の描画前に `parseDocument` / `importDocumentDocx` で読み込んだモデルを保持してください。サムネイル化しても未検証ファイル全体の読み込み・検証処理は省略しません。

描画上限は指定ページにだけ適用され、前のページは予算を消費しません。描画範囲は最大512ノード、8,000文字、32行の表、キャンバスごとに図形32個・接続線32本です。上限より後の内容はサムネイルだけで省略し、文書は変更しません。用紙の下端より後のDOMを追加し続けず、後続の画像ソースは設定しません。長い表や複雑な図の全体確認には通常の `LikeDocument` を使います。

不正な番号（0・小数など）、存在しないページ、無効な入力や描画エラーはプレースホルダーを表示し、任意の `onError` に `Error` を通知します。ページ番号が不正でも検証済み文書のタイトルは保持し、有効な番号を渡すと通常表示へ戻ります。コールバックの失敗は表示に影響しません。SSRではタイトルと用紙枠を出力し、本文はブラウザーで枠の寸法を測定して描画します。パッケージ導入では `/thumbnail` の専用入口を使うと編集エンジンを読み込まずに利用できます。ソースコピーでは `components/document/thumbnail` が対応する入口です。
