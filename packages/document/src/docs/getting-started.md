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

## ソースをコピーする

`packages/document/src/` を `components/document/`、`packages/core/src/` を `components/core/` に配置します。`LICENSE`、`THIRD_PARTY_NOTICES.md`、`docs/` も残します。Document側の4つのアダプターを変更してください。

```ts
// components/document/core.ts
export * from "../core";
// components/document/json.ts
export * from "../core/json";
// components/document/ooxml.ts
export * from "../core/ooxml";
// components/document/browser.ts
export { openContextMenu } from "../core/browser";
export type { ContextMenuAction } from "../core/browser";
```

利用先にはReact / React DOMに加え、コピー元の `package.json` と同じProseMirror・lucide-react依存を導入します。

```bash
npm install lucide-react prosemirror-model prosemirror-state prosemirror-view \
  prosemirror-commands prosemirror-keymap prosemirror-schema-list prosemirror-transform
```

コピー後は `components/document` からコンポーネント、`components/document/model-entry` から画面なしのAPIをimportし、`components/document/styles.css` を1回読み込みます。共通Provider・独自パスエイリアス・Tailwind CSSは不要です。

## 表示設定

| props | 使い方 |
| --- | --- |
| `initialDocument` | 初期の `DocumentModel`。省略時は空の文書 |
| `title` | UIのタイトル表示 |
| `colorMode` | `light` / `dark` / `system` |
| `primaryColor` | リボンなどの強調色 |
| `className` / `style` | 表示枠のクラス・サイズ |
| `aria-label` | コンポーネントのアクセシブル名 |
| `readOnly` | 編集を無効にする |
| `features` | [編集機能](editing.md)を個別に無効にする |

用紙の寸法・余白は文書の `page` に保存されます。UIの配色と文書内の文字色は別の設定です。Next.js App RouterではCSSを `app/layout.tsx` で読み込み、コールバックを渡す親コンポーネントに `"use client"` を付けてください。
