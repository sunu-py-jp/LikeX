# 保存・送信・同期

## 送信を親で扱う

`onSend` はAI生成ではなく、人のメッセージの送信確認を待つコールバックです。Promiseが解決したら同じIDのメッセージを追加します。例外なら通知を出し、入力を残します。ハンドラー未指定ならローカルだけに追加します。

```tsx
<LikeChat initialChat={initialChat} currentUserId="me" readOnly={false}
  onSend={async ({ message, conversation, chat }, { signal, requestId }) => {
    const response = await fetch(`/api/chats/${chat.id}/messages`, {
      method: "POST", signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: conversation.id, message, requestId }),
    });
    if (!response.ok) throw new Error("送信できませんでした。もう一度お試しください。");
  }} />
```

`message` は `ChatMessage`、`conversation` は `ChatConversation`、`chat` は `ChatModel` です。戻り値は `void | Promise<void>`。ID・時刻の書き換えやAI応答の返却はしません。`requestId` と `message.id` を親の重複送信対策にも利用できます。

キャンセル・会話切替・編集許可の変更・アンマウント後は、古い応答を画面へ反映しません。ただし、すでにサーバーで成立した送信をブラウザ側から取り消せるとは限りません。親側の再取得で整合を取ってください。

## 保存と編集許可

`onSave(chat, context)` は全体の保存、`onBeforeSave(chat)` は保存前チェックです。編集開始前の `onEditRequest({ chat }, context)` で `false` を返すと変更を拒否します。

`onChange(chat)` はローカル変更、`onDirtyChange(boolean)` は未保存の有無、`onEvent(event)` は `change`・`save`・`edit-mode` を通知します。`onSave` がない場合に送信を許可したいときは、明示的に `readOnly={false}` を指定します。

メッセージ編集・リアクションなどは `onSend` を通りません。`onSave` でまとめて保存するか、`onChange` の差分を親で処理します。Undoはローカル履歴です。外部サービスに送信済みのメッセージを取り消すAPIではありません。

## 親から最新データを同期する

```ts
const accepted = ref.current?.syncChat(latestChat);
if (!accepted) {
  // 未保存または処理中。親で保留して、保存後に再試行する。
}
```

`syncChat(chat, { discardLocalChanges?: boolean }) => boolean` は、正しい最新モデルを保存済みの基準として取り込みます。通常は未保存・処理中なら拒否します。成功するとUndo履歴と画面の入力途中状態をリセットします。破棄が確定している場合だけ `discardLocalChanges: true` を使います。

認証、会話のアクセス制御、WebSocket／SSE、既読通知の配信、サーバー側競合解決は親の責務です。コンポーネント内の自分のメッセージのみ編集可能という制御は、サーバー認可を置き換えません。初期データには閲覧を許可した情報だけを渡してください。
