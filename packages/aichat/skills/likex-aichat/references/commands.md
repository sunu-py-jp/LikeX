# 会話コマンド

`commands.json` はコマンド配列。公開APIは `executeAIChatCommands(aichat, commands)`、戻り値は `{ aichat, changed, results }`。保存は `serializeAIChat(result.aichat)` を使う。CLIは同じAPIで検証してから保存する。

下の例は [保存構造](schema-guide.md) の会話を初期値として使う。実ファイルのIDは `inspect` で取得する。

## メッセージの追加・更新

`message.add` は会話末尾へ追加する。`message` の `role` と `content` は必須。`id`、`createdAt`、`status` は省略でき、状態は `complete` が既定。返信先は同じ会話の先行メッセージを指定する。

```json
[
  {
    "type": "message.add",
    "conversationId": "planning",
    "message": {
      "id": "answer-1", "role": "assistant", "content": "担当と期限を決めましょう。",
      "createdAt": "2026-09-22T00:00:01.000Z", "replyTo": "question-1"
    }
  },
  {
    "type": "message.update", "conversationId": "planning", "messageId": "answer-1",
    "patch": { "content": "担当・期限・確認方法を決めましょう。" }
  }
]
```

`message.update.patch` は `content`、`status`、`error`、`attachments`、`references`、`toolCalls` を変更する。配列は差分追加ではなく全体置き換えで、`[]` で空にできる。ID・role・createdAt・replyToは変更対象外。

`message.respond` はassistantメッセージだけを対象にし、`conversationId`、`messageId`、`content`、`status` と任意の `error` を指定する。本文は全文置き換えで、文字列断片の追加や外部サービスへの問い合わせはしない。

## 添付・参照・ツール情報

```json
[
  {
    "type": "message.update", "conversationId": "planning", "messageId": "question-1",
    "patch": {
      "attachments": [{ "id": "attachment-1", "name": "proposal.txt", "mediaType": "text/plain", "size": 128 }],
      "references": [{ "id": "reference-1", "title": "チームガイド", "url": "https://example.com/guide" }],
      "toolCalls": [{ "id": "tool-1", "name": "資料の確認", "status": "complete", "detail": "資料を2件確認しました。" }]
    }
  }
]
```

添付に任意のHTTP(S) `url`、参照に任意の `description` を指定できる。ファイル本体や認証情報は保存しない。ツール情報を追加しても処理は実行されない。

## 会話の管理と削除

```json
[
  { "type": "aichat.update", "title": "チームの記録" },
  { "type": "conversation.add", "id": "review", "title": "振り返り" },
  { "type": "conversation.update", "conversationId": "planning", "title": "次の計画" }
]
```

`conversation.add` のID・タイトルは省略可能。`conversation.delete` は `conversationId` を指定し、会話の全メッセージも削除する。最後の1件は削除できない。

```json
[
  { "type": "message.delete", "conversationId": "planning", "messageId": "question-1", "cascadeReplies": true }
]
```

`cascadeReplies` を省略した削除で返信参照が壊れる場合は失敗する。`true` はそのメッセージへの返信と、それらへの返信を削除する。後続メッセージすべてを消す操作ではない。

`aichat.replace` は検証済みの `aichat` 全体を置き換える。通常の編集は対象コマンドを使い、既存ID・日時・会話順を維持する。全引数は [commands JSON Schema](commands.schema.json) にある。CLIのapply応答は文書全体やコマンドごとの結果を返さないため、適用後にinspectして対象を確認する。

GUIの右クリックによる編集・削除・会話名変更も同じセッションコマンドを使う。テキストコピーと会話を開く操作は保存モデルを変更しない。応答再生成はホスト`onSend`を使う`session.retry`で、純粋モデルAPIやCLIはネットワーク送信を行わない。無効な機能は表示せず、読み取り専用・処理中・編集許可・履歴制御を通常UIと共有する。
