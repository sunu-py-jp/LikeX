# 導入と初期表示

LikeAIChatはReact / React DOM 19.2.6以降の19系を使用します。会話一覧、メッセージ本文、入力欄を同梱CSSで表示します。通信やAIサービスのSDKは含めません。

## 右クリックメニュー

メッセージを右クリックすると本文のコピー、編集・削除、アシスタント応答の再生成を選べます。再生成は`retry`・`send`がONで`onSend`があり、返信先があるアシスタントメッセージに表示します。会話一覧では開く、名前変更、削除を選べます。削除は既存の確認ダイアログを通り、最後の会話は削除できません。

右クリック操作も通常のボタンと同じセッション・編集許可・機能フラグ・履歴を共有します。OFFの機能はメニューに表示せず、読み取り専用・処理中の編集は無効になります。会話切替やモデル変更で古いメニューを閉じます。入力欄・編集可能領域・リンク上の右クリック、およびShift+右クリックはブラウザー標準メニューを保持します。

メニュー表示はUI専用の`browser.ts`から`@likex/core/browser`を使います。ソースコピー導入では`browser.ts`もコピー先coreの`browser`入口へ変更してください。モデル入口はDOMに依存しません。

## パッケージを導入する

リポジトリで `npm ci`、`npm run pack:library -- --module aichat` を実行し、`artifacts/core/` と `artifacts/aichat/` のtarballを利用先へ渡します。npmレジストリへの公開は未実施です。

```bash
npm install ./likex-core-0.1.0.tgz ./likex-aichat-0.1.0.tgz
```

```tsx
import LikeAIChat, { createAIChat } from "@likex/aichat";
import "@likex/aichat/styles.css";

const aichat = createAIChat({ title: "チームのチャット" });
<LikeAIChat initialAIChat={aichat} style={{ height: 720 }} />
```

`onSave` 未指定では読み取り専用です。編集する場合は [保存のコールバック](lifecycle.md) を渡します。`onSend` を省略するとユーザーメッセージだけを記録し、応答を生成しません。

`initialAIChat` と `initialConversationId` は初期値です。別のチャットへ切り替える場合はReactの `key` を変えて新しく表示するか、refの `importNative` / `execute({ type: "aichat.replace", aichat })` を使います。ref経由の置き換えは編集許可・機能設定・履歴の処理を通ります。会話の選択には `selectConversation(id)` を使います。

## ソースをコピーする

`packages/aichat/src/` を `components/aichat/`、`packages/core/src/` を `components/core/` に配置します。`LICENSE`、`THIRD_PARTY_NOTICES.md`、`docs/` を残し、AIChat側の2つのアダプターを変更します。

```ts
// components/aichat/core.ts
export * from "../core";
// components/aichat/json.ts
export * from "../core/json";
```

利用先にはReact / React DOMに加え、コピー元 `package.json` と同じ版のlucide-reactを導入します。コンポーネントは `components/aichat`、画面なしのAPIは `components/aichat/model-entry` からimportし、`components/aichat/styles.css` を1回読み込みます。共通Provider・独自パスエイリアス・Tailwind CSSは不要です。

## 表示設定

| props | 使い方 |
| --- | --- |
| `initialAIChat` | 初期の `AIChatModel`。省略時は空の会話が1件あるチャット |
| `initialConversationId` | 最初に選択する会話ID。見つからない場合は先頭の会話 |
| `title` | サイドバーの表示名。保存モデルのタイトルは変更しない |
| `colorMode` | `light` / `dark` / `system` |
| `primaryColor` | #RGB / #RRGGBB。ボタンの文字色とリンク・選択色のコントラストを自動調整 |
| `className` / `style` | 表示枠のクラス・サイズ |
| `exportFileName` | JSONダウンロード名。既定は `aichat.json` |
| `readOnly` | 編集を無効にする |
| `features` | [機能を個別に無効にする](lifecycle.md) |

本文はプレーンテキストです。Markdown構文やHTML文字列も文字として表示します。参照リンク・添付・ツール進捗は専用のメタデータから表示します。

Next.js App RouterではCSSを `app/layout.tsx` で読み込み、コールバックを渡す親コンポーネントに `"use client"` を付けます。Server Componentからモデルを作る場合は `@likex/aichat/model` を使ってください。
