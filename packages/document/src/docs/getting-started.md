# 導入と初期表示

LikeDocumentはReact / React DOM 19.2.6以降の19系を使用します。ProseMirrorの文書スキーマ・状態・トランザクションで入力と公開APIの操作を共用し、UIの見た目は同梱CSSで定義しています。

## パッケージを導入する

リポジトリで `npm ci`、`npm run pack:library -- --module document` を実行し、`artifacts/core/` と `artifacts/document/` のtarballを利用先へ渡します。npmレジストリへの公開は未実施です。

```bash
npm install ./likex-core-0.1.0.tgz ./likex-document-0.1.0.tgz
```

```tsx
import LikeDocument, { createDocument } from "@likex/document";
import "@likex/document/styles.css";

const document = createDocument({ title: "企画書" });
<LikeDocument initialDocument={document} style={{ height: 720 }} />
```

`onSave` 未指定では読み取り専用です。編集する場合は [保存のコールバック](lifecycle.md) を渡します。`initialDocument` は初期値で、後から別文書へ切り替える場合はReactの `key` を変えて新しく表示するか、refの `execute({ type: "document.replace", document })` を使います。後者は表示中の編集許可・履歴の処理を通ります。

一覧カードなどの小さな表示には `@likex/document/thumbnail` の `LikeDocumentThumbnail` を使います。タイトルを残し、編集エンジンを起動せず指定したページの用紙1枚分を表示します。[軽量サムネイル](thumbnail.md)にpropsと表示範囲をまとめています。

## ソースをコピーする

`packages/document/src/` 全体を `components/document/`、`packages/core/src/` 全体を `components/core/` に配置します。`model/`・`state/`・`ui/`・CSSを含め、`LICENSE`、`THIRD_PARTY_NOTICES.md`、`docs/` も残します。コピー後に変更するCoreの参照は、`components/document/core.ts` の次の1行だけです。

```ts
// components/document/core.ts
export * from "../core";
```

`json.ts`・`ooxml.ts`・`browser.ts`・`model/core-connectors.ts`・`model/core-office-shapes.ts` は内部で `core.ts` へ接続するため変更しません。以前のコピーから更新する場合は、DocumentとCoreを同じバージョンから一緒に更新してください。以前に参照先を書き換えたアダプターも新しいファイルをコピーし直し、利用先への参照変更は `core.ts` に集約します。

利用先にはReact / React DOM `^19.2.6` に加え、コピー元の `package.json` と同じProseMirror・lucide-react依存と、Coreの実行時依存 `re2js@2.8.6` を導入します。

```bash
npm install lucide-react@^1.31.0 prosemirror-model@^1.25.12 \
  prosemirror-state@^1.4.4 prosemirror-view@^1.42.5 prosemirror-commands@^1.7.2 \
  prosemirror-keymap@^1.2.3 prosemirror-schema-list@^1.5.1 \
  prosemirror-transform@^1.12.1 re2js@2.8.6
```

コピー後は `components/document` からコンポーネント、`components/document/model-entry` から画面なしのAPIをimportし、`components/document/styles.css` を1回読み込みます。共通Provider・独自パスエイリアス・Tailwind CSSは不要です。

TypeScriptではReact / React DOMの型定義を導入し、`lib: ["ES2022", "DOM", "DOM.Iterable"]` を指定してください。コピーしたソースは画面なしの `model-entry.ts` だけを使う場合もDOM型定義を必要としますが、モデルの実行時にはReactやDOMを使いません。

## 表示設定

| props | 使い方 |
| --- | --- |
| `initialDocument` | 初期の `DocumentModel`。省略時は空の文書 |
| `initialPageNumber` | 初期表示する明示改ページ区切りのページ（1始まり）。省略時は先頭 |
| `title` | UIのタイトル表示 |
| `colorMode` | `light` / `dark` / `system` |
| `primaryColor` | リボンなどの強調色 |
| `className` / `style` | 表示枠のクラス・サイズ |
| `aria-label` | コンポーネントのアクセシブル名 |
| `readOnly` | 編集を無効にする |
| `features` | [編集機能](editing.md)を個別に無効にする |

用紙の寸法・余白は文書の `page` に保存されます。UIの配色と文書内の文字色は別の設定です。Next.js App RouterではCSSを `app/layout.tsx` で読み込み、コールバックを渡す親コンポーネントに `"use client"` を付けてください。

`initialPageNumber={2}` は初回マウント時に2ページ目へ移動します。後から移動するときは `ref.current?.goToPage(2)` を使います。いずれも読み取り専用で使え、編集許可・未保存判定・履歴を変更しません。不正な番号や存在しないページは通知し、文書を維持します。ページは `page_break` で明示的に区切った範囲で、Wordの自動改ページではありません。[ページ取得とref操作](headless.md)も参照してください。
