# LikeChatを組み込む

DMとスペースの一覧、時系列のメッセージ、右側のスレッドを持つReactコンポーネントです。Google Chatの[会話・ホーム・スペースの構成](https://support.google.com/chat/answer/14170781?hl=ja)を参考にしています。Googleのサービスとの接続機能は含みません。

## 最小構成

```tsx
"use client";
import LikeChat, { createChat } from "@likex/chat";
import "@likex/chat/styles.css";

const initialChat = createChat({
  title: "チームチャット",
  participants: [
    { id: "me", name: "高橋", status: "online" },
    { id: "yui", name: "佐藤", status: "online" },
  ],
  conversations: [{
    id: "design", title: "デザイン", kind: "space",
    memberIds: ["me", "yui"], messages: [],
  }],
});

export function TeamChat() {
  return <LikeChat initialChat={initialChat} currentUserId="me"
    initialConversationId="design"
    onSave={async (chat, { signal }) => {
      const response = await fetch("/api/chat", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chat), signal,
      });
      if (!response.ok) throw new Error("保存できませんでした");
    }}
    style={{ height: 700 }} />;
}
```

`initialChat` は初回だけ読み込みます。新しいデータを後から渡す場合は `ref.syncChat()` を使います。`currentUserId` は参加者に存在するIDが必須です。未指定の機能はすべてONです。`onSave` がなく、`readOnly` も未指定の場合は読み取り専用になります。

## Props

| 名前 | 型・用途 |
| --- | --- |
| `initialChat` | `ChatModel`。初期データ |
| `currentUserId` | `string`。操作する参加者のID |
| `initialConversationId` | `string`。最初に開く会話 |
| `title` | `string`。左上のタイトル |
| `colorMode` | `"light" \| "dark" \| "system"` |
| `primaryColor` | プライマリカラー。例: `"#0b57d0"` |
| `features` | `ChatFeatures`。下表の機能を個別にOFF |
| `readOnly` | `boolean`。編集を禁止 |
| `onConversationChange` | `(conversation: ChatConversation) => void`。表示先変更 |
| `onSend` | 送信前に親の処理を待つ。詳細は[保存・送信・同期](lifecycle.md) |
| `onAttachmentUpload` | 選択した `File[]` を受け取り `ChatAttachment[]` を返す |
| `onAttachmentClick` | 添付メタデータを受け取り、親で表示・ダウンロード |
| `onSave` / `onBeforeSave` | 保存・保存前チェック |
| `onEditRequest` | 非同期の編集許可 |
| `onChange` / `onDirtyChange` / `onEvent` | データ・未保存状態・ライフサイクルの通知 |
| `className` / `style` | コンテナの設定 |
| `exportFileName` | JSON書き出し時の名前。既定は `chat.json` |

## 機能のON/OFF

```tsx
<LikeChat currentUserId="me" initialChat={initialChat}
  features={{ reactions: false, attachments: false, history: false }} />
```

| キー | 対象 |
| --- | --- |
| `send` | メッセージ送信と入力欄 |
| `attachments` | 添付の追加。保存済みの添付は引き続き閲覧可能 |
| `threads` | スレッド表示・返信 |
| `reactions` | リアクションの表示・操作 |
| `edit` / `delete` | 自分のメッセージの編集・削除 |
| `conversations` | 会話の作成・管理コマンド |
| `search` | 会話名・メッセージ本文のローカル検索 |
| `read` | 未読表示・既読操作 |
| `history` | Undo/Redo |
| `import` / `export` | JSON読み込み・書き出し |

OFFにした操作は画面から消え、コンポーネントrefでも拒否されます。純粋なモデルAPIには画面設定を適用しません。

## 右クリックメニュー

メッセージを右クリックすると、本文のコピー、スレッドの表示・返信、👍の切り替え、自分のメッセージの編集・削除を選べます。会話一覧・ホームの会話には、開く、既読、グループ／スペース名の変更、会話の削除を用意しています。削除は確認画面を経由します。DMの表示名は相手の名前を使うため、会話名変更はグループ／スペースに表示します。

各操作は通常のボタンと同じセッション・公開コマンドを通り、機能OFF、読み取り専用、処理中、編集許可、Undo/Redoの制御を共有します。他の参加者のメッセージには編集・削除を表示しません。モデルや表示先が変わると開いていたメニューを閉じ、古い対象への操作を無視します。入力欄・編集可能領域・リンクではブラウザー標準メニューを保持し、Shiftを押しながら右クリックしても標準メニューを利用できます。

## ソースコピー

`packages/chat/src` を利用側の `components/chat` へ、`packages/core/src` を `components/core` へコピーします。Chatの `core.ts`、`json.ts`、`browser.ts` の参照先をコピーしたcoreの対応する入口へ変更し、React・React DOM・lucide-reactを用意してください。`browser.ts`はUI専用で、モデル入口はDOMに依存しません。`components/chat/styles.css` もimportします。Tailwindは不要です。

AI用の `packages/aichat` は、新しいLikeChatの依存ではありません。
