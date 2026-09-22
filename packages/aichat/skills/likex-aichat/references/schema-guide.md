# AIChat JSONの構造

標準拡張子は `.json`、UTF-8のJSON。`AIChatModel` の `format: "likex.aichat"` と `version: 1` は必須。専用の `parseAIChat` / `serializeAIChat` で検証・保存する。

```json
{
  "format": "likex.aichat",
  "version": 1,
  "id": "aichat-1",
  "title": "チーム提案",
  "conversations": [
    {
      "id": "planning",
      "title": "計画",
      "messages": [
        {
          "id": "question-1",
          "role": "user",
          "content": "次の作業を整理してください。",
          "createdAt": "2026-09-22T00:00:00.000Z",
          "status": "complete"
        }
      ]
    }
  ]
}
```

会話とメッセージの順序は配列で保持する。会話は最低1件必要。会話IDは会話間で、メッセージIDはチャット全体で一意。IDは空白を含まない200文字以下の文字列。`replyTo` は同じ会話の先行メッセージIDを参照し、存在しない相手や後のメッセージを指せない。

メッセージの `role` は `user` / `assistant` / `system` / `tool`、`status` は `complete` / `streaming` / `error` / `cancelled`。`createdAt` はUTCのISO日時。本文はプレーンテキストで、HTMLやMarkdown構造は持たない。

任意の `attachments` は `{ id, name, mediaType, size, url? }`、`references` は `{ id, title, url?, description? }`、`toolCalls` は `{ id, name, status, detail? }`。ツールの状態は `pending` / `running` / `complete` / `error`。各メタデータ配列のIDも配列内で一意にする。添付はファイル本体を含まず、URLはユーザー名・パスワードを含まないHTTP(S)のみ。

保存済みの `streaming` を読み込んでも応答生成は自動再開しない。選択中の会話、入力欄の下書き、履歴、未保存状態、UI設定は保存しない。

全フィールドは [AIChat JSON Schema](aichat.schema.json) を参照。実際の参照関係・一意性・日時・URL・文字列とファイルサイズの上限はランタイムで検証する。最終ファイルをCLIの `validate` か `parseAIChat` で確認する。

旧AI LikeChatの `likex.chat` / version 1を読み込む場合は `parseAIChat` または `migrateLegacyAIChat` を使う。旧AI会話構造を全項目検証した後に `likex.aichat` へ移行し、以後は新形式で保存する。現在の人物・スペース向けLikeChatは別の構造で、移行対象ではない。形式識別子だけを直接変更しない。
