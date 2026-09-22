# ネイティブ保存形式

標準ファイルはUTF-8の `.json` です。`AIChatModel` は `format: "likex.aichat"` と `version: 1` を持ちます。専用の `parseAIChat` / `serializeAIChat` を使用してください。

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

## メッセージとメタデータ

`role` は `user` / `assistant` / `system` / `tool`、`status` は `complete` / `streaming` / `error` / `cancelled` です。`replyTo` は同じ会話内の先行メッセージを参照します。作成APIではID・作成時刻・状態を省略できますが、保存ファイルにはすべて含めます。省略したIDと日時は新規作成時に生成され、既存のIDと配列順序は保存時に保持されます。UTCのISO日時はミリ秒を含む形へ正規化されます。

| 任意フィールド | 保存する内容 |
| --- | --- |
| `attachments` | `id`、`name`、`mediaType`、バイト数の `size`、任意の `url` |
| `references` | `id`、`title`、任意の `url` と `description` |
| `toolCalls` | `id`、`name`、`status`、任意の `detail` |
| `error` | 応答に関連するエラーメッセージ |

ツールの状態は `pending` / `running` / `complete` / `error` です。添付のファイル本体や認証情報は含めません。添付と参照のURLは、ユーザー名・パスワードを含まないHTTP(S)のみ受け付けます。期限付きURLの更新やリンク先へのアクセス制御は親アプリの責務です。

## 検証と保存

`parseAIChat` は未知の形式・バージョン、未知の属性、重複ID、不正な返信参照、日時、URL、サイズ上限を検証します。JSONはUTF-8で32 MiBまで、会話は1〜500件、メッセージはチャット全体で20,000件まで、本文は1件1,000,000文字までです。本文・エラー・参照説明・ツール情報の合計にも上限があります。正確な値は公開定数 `AICHAT_LIMITS` を参照してください。

```ts
import { parseAIChat, serializeAIChat } from "@likex/aichat/model";

const aichat = parseAIChat(await file.text());
const json = serializeAIChat(aichat);
const blob = new Blob([json], { type: "application/json;charset=utf-8" });
```

`serializeAIChat` は検証後に安定したJSONを出力し、保存だけでID・作成日時・メッセージ順を生成し直しません。選択中の会話、入力途中の本文、履歴、未保存状態、配色は保存対象外です。`streaming` として保存された応答を読み込んでも、自動的に通信を再開しません。

UIのJSON読み込みは既存の下書きを置き換え、Undoできます。ref / sessionの `importNative(text)` は `Promise<AIChatModel | null>`、`exportNative()` はJSON文字列を返し、export無効時は `null` です。`importNative` へ不正なJSONを渡した場合はPromiseがrejectするため、呼び出し側で例外を扱ってください。

## 旧LikeChatからの移行

AIとの会話を扱っていた旧 `@likex/chat` は `@likex/aichat` / `LikeAIChat` に分離しました。旧 `likex.chat` のバージョン1は、`role` が `user` / `assistant` / `system` / `tool` のAI会話構造に限って読み込めます。`parseAIChat` とUIのJSON読み込みは旧形式を検出し、未知の属性、メッセージ、ID・返信参照、日時、URL、サイズ上限を通常と同じ規則で検証してから `likex.aichat` へ変換します。人物やスペースを持つ現在のLikeChat形式は対象外です。識別子だけを手で書き換えないでください。

JSON文字列には `parseAIChat`、読み取り済みの旧オブジェクトには `migrateLegacyAIChat` を使います。`normalizeAIChat` は現在の `likex.aichat` のみを受け付けます。移行後は専用シリアライザーで保存し、ID、メッセージの順序、本文、添付・参照・ツール情報を保持します。日時は通常の読み込みと同じUTC表記へ正規化します。

```ts
import { migrateLegacyAIChat, serializeAIChat } from "@likex/aichat/model";

const migrated = migrateLegacyAIChat(legacyObject);
const json = serializeAIChat(migrated); // format: "likex.aichat", version: 1
```

利用コードは `LikeChat` → `LikeAIChat`、`Chat*` 型 → `AIChat*` 型、`createChat` / `parseChat` / `serializeChat` → `createAIChat` / `parseAIChat` / `serializeAIChat` に変更します。初期値propは `initialAIChat`、取得は `getAIChat()`、会話・メッセージ取得は `getAIChatConversation(s)` / `getAIChatMessage(s)` です。全体コマンドは `aichat.update` / `aichat.replace`、置き換えpayload・実行結果・送信と編集許可のリクエスト内のモデルキーは `aichat` になりました。`conversation.*` / `message.*` のコマンドとストリーミングの契約は維持します。旧パッケージ名のAI向けエクスポートは新しいLikeChatには含めません。
