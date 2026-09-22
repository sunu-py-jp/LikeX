# モデルAPI・コマンド・履歴

`@likex/aichat/model` はReact・DOM・ネットワーククライアントを使わない入口です。純粋なモデルAPIは保存や認証を行いません。呼び出し側で入力を読み、変更後のモデルを保存します。

## 会話を取得・編集する

```ts
import {
  createAIChat, executeAIChatCommands, getAIChatConversations, getAIChatMessages,
  getAIChatMessage, parseAIChat, serializeAIChat,
} from "@likex/aichat/model";

const initial = createAIChat({
  id: "aichat-1", title: "チーム提案",
  conversations: [{ id: "planning", title: "計画", messages: [] }],
});
const result = executeAIChatCommands(initial, [
  { type: "message.add", conversationId: "planning", message: {
    id: "question-1", role: "user", content: "次の作業を整理してください。",
    createdAt: "2026-09-22T00:00:00.000Z",
  } },
  { type: "message.add", conversationId: "planning", message: {
    id: "answer-1", role: "assistant", content: "担当と期限を決めましょう。",
    replyTo: "question-1", createdAt: "2026-09-22T00:00:01.000Z",
  } },
]);
const conversations = getAIChatConversations(result.aichat);
const messages = getAIChatMessages(result.aichat, "planning");
const answer = getAIChatMessage(result.aichat, "planning", "answer-1");
const json = serializeAIChat(result.aichat);
const restored = parseAIChat(json);
```

戻り値は `{ aichat, changed, results }` です。`results` はコマンドの種類と作成・編集対象のIDを持ちます。入力は変更せず、不正なコマンドがある一括操作は例外になり、途中のモデルは返しません。正常な無変更操作では `changed: false` です。

`getAIChatConversation` / `getAIChatMessage` は対象がなければ `undefined` を返します。`getAIChatMessages` と、存在しない会話IDを渡した `getAIChatMessage` は例外になります。取得モデルは凍結されているので、配列やメッセージを直接変更せずコマンドを使います。

| コマンド | 用途 |
| --- | --- |
| `aichat.update` / `aichat.replace` | タイトル変更 / チャット全体の置き換え |
| `conversation.add` / `conversation.update` / `conversation.delete` | 会話の追加 / 名前変更 / 削除 |
| `message.add` | メッセージを末尾へ追加 |
| `message.update` | 本文、状態、エラー、添付、参照、ツール情報を変更 |
| `message.respond` | assistantメッセージの本文・状態を置き換える |
| `message.delete` | メッセージを削除。`cascadeReplies: true` でその返信も再帰的に削除 |

会話は最低1件必要です。最後の会話の削除は拒否します。返信のあるメッセージを単独で削除すると参照が壊れるため拒否します。`replyTo` は同じ会話内の先行メッセージIDで、メッセージIDはチャット全体で一意です。

## Reactなしで編集セッションを使う

`createAIChatSession` は保存、編集許可、履歴、通知、応答生成の調整を加えます。モデルAPIと異なり、`onSave` を省略すると読み取り専用です。

```ts
import { createAIChat, createAIChatSession, serializeAIChat } from "@likex/aichat/model";

const session = createAIChatSession(createAIChat(), {
  onSave: async aichat => { await storeJson(serializeAIChat(aichat)); },
  onSend: async ({ prompt }) => `受け取りました: ${prompt.content}`,
});
const unsubscribe = session.subscribe(() => {
  const { model, dirty, busy, notice } = session.getSnapshot();
  updateHostView({ model, dirty, busy, notice });
});
await session.send(session.getAIChat().conversations[0].id, "こんにちは");
await session.undo();
await session.redo();
await session.save();
unsubscribe();
session.dispose();
```

`storeJson` と `updateHostView` は親アプリの処理です。`execute` は `Promise<AIChatModel | null>`、`send` / `retry` / `save` / `undo` / `redo` は `Promise<boolean>` を返します。`execute` の `null` は変更なし、無効な機能、権限拒否、処理中、検証失敗などを表し、通知は `getSnapshot().notice` で取得します。`send` / `retry` の `true` は操作が受理された意味で、応答が正常終了した保証ではありません。応答の `status` を確認してください。

`send(conversationId, content, attachments?)` と `retry(conversationId, messageId)` は会話IDを受け取ります。1回の送信と応答の更新は1つの履歴にまとまります。`configure(options)` は設定全体を置き換えます。使用終了時に `dispose()` を呼び、未完了処理をキャンセルします。

## 表示中のコンポーネントを操作する

`AIChatHandle` の `send` / `retry` は選択中の会話に作用します。`execute` 内のIDはコマンドに指定します。

```tsx
import { useRef } from "react";
import LikeAIChat, { type AIChatHandle } from "@likex/aichat";

const ref = useRef<AIChatHandle>(null);
<LikeAIChat ref={ref} initialAIChat={aichat} onSave={saveAIChat} />;
await ref.current?.send("次の案を考えてください。");
const current = ref.current?.getAIChat();
const selected = ref.current?.getAIChatConversation();
```

`selectConversation(id)` は成功時に `true`、対象がなければ `false` を返します。選択切り替えは生成をキャンセルし、入力中の本文と未送信の添付をクリアします。`cancel`、`discard`、`importNative`、`exportNative` も公開します。UIとrefは同じ機能・権限・処理中の制御を通ります。
