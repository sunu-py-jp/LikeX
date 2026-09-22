# JSONと互換性

LikeChatは `format: "likex.chat", version: 2` のJSONを使います。AI用の旧LikeChatとは異なるスキーマです。

```json
{
  "format": "likex.chat",
  "version": 2,
  "id": "team",
  "title": "チームチャット",
  "participants": [
    { "id": "me", "name": "高橋" },
    { "id": "yui", "name": "佐藤" }
  ],
  "conversations": [{
    "id": "design",
    "kind": "space",
    "title": "デザイン",
    "memberIds": ["me", "yui"],
    "messages": [{
      "id": "m1", "authorId": "me", "text": "レビューお願いします",
      "createdAt": "2026-09-22T00:00:00.000Z",
      "reactions": [{ "emoji": "👍", "participantIds": ["yui"] }]
    }],
    "readMarkers": [{ "participantId": "yui", "messageId": "m1" }]
  }]
}
```

`parseChat(text)` で検証して読み込み、`serializeChat(chat)` で保存します。同じ内容の保存でID・時刻を変更しません。会話・メッセージの配列順を維持します。添付はメタデータだけで、ファイル本体をJSONへ埋め込みません。

## AIチャットの移行

これまでの `@likex/chat` のAI機能は `@likex/aichat` / `LikeAIChat` に移動しました。既存利用側はimport先と公開名を変更してください。詳細は `@likex/aichat` に同梱される `src/docs/getting-started.md` を参照してください。

旧 `likex.chat` version 1 は `parseAIChat()` が構造を検証して移行します。人同士の会話に自動変換はしません。新LikeChatの `parseChat()` に旧AI形式を渡すと、移行先を示すエラーを返します。`version` だけを2へ書き換えても互換にはなりません。

新しいJSON Schemaは `packages/chat/skills/likex-chat/references/chat.schema.json`、コマンドSchemaは同じ場所の `commands.schema.json` です。生成元はTypeScript型であり、参照整合性などの最終判定はモデルのパーサーが行います。
