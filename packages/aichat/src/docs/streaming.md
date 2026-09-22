# ストリーミング・再試行・添付

応答生成は親アプリの `onSend` で接続します。戻り値は完成した文字列、または追加する文字列断片の `AsyncIterable<string>` です。いずれもPromiseで返せます。SSE・JSON・特定プロバイダーのイベントをライブラリが解析することはありません。

## 応答を返す

```ts
import type { AIChatSendHandler } from "@likex/aichat/model";

const onSend: AIChatSendHandler = async function* ({ prompt }, { signal }) {
  const chunks = [`「${prompt.content}」について、`, "担当と期限を整理しましょう。"];
  for (const chunk of chunks) {
    if (signal.aborted) return;
    yield chunk;
  }
};
```

各断片は前の内容に追加されます。毎回それまでの全文を返すと重複します。実際のサービスへ接続する場合は、親アプリでレスポンスを文字列断片に変換し、`signal` をfetchやSDKへ渡してください。

`AIChatSendRequest` は `aichat`、`conversation`、`messages`、`prompt`、`retry` を持ちます。`prompt` は送信元のユーザーメッセージ、`messages` は生成対象のassistantメッセージより前の履歴です。再試行ではその応答より後のメッセージを含めません。`conversation.messages` は会話全体なので、生成用の履歴には `messages` を使います。contextはキャンセル用の `signal` と操作識別用の `requestId` を持ちます。

## 停止・エラー・再試行

送信するとユーザーメッセージと空のassistantメッセージを追加し、応答中は `streaming`、正常終了時は `complete` になります。`onSend` 未指定ならユーザーメッセージだけを記録します。

停止ボタンまたは `cancel()` は生成を中止します。すでに受信した内容は残り、応答は `cancelled` になります。会話切り替えも生成をキャンセルします。読み取り専用・機能設定への変更、アンマウント後の古い結果は反映しません。保存済みの `streaming` は進行中の通信を意味しません。

`onSend` が例外を投げた場合は途中の本文を残して `error` とエラー文を設定し、通知します。ホストからのエラー文はUIに表示されるので、認証情報を含めず利用者向けの文言へ変換してください。

`retry` は `replyTo` でユーザーメッセージを参照するassistant応答が対象です。同じ応答IDの本文を空にして生成し直します。後続メッセージを削除する処理ではありません。送信・再試行中は保存や他の編集を受け付けず、1回の生成はまとめてUndoできます。

## 添付ファイルを受け取る

`onAttachmentUpload(files, context)` は選択された `readonly File[]` を受け取り、`AIChatAttachment[]` またはそのPromiseを返します。親アプリでアップロード後のメタデータを作ります。

```tsx
<LikeAIChat initialAIChat={aichat} onSave={saveAIChat} onSend={onSend}
  onAttachmentUpload={async (files, { signal }) => {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    const response = await fetch("/api/aichat/attachments", {
      method: "POST", body: form, signal,
    });
    if (!response.ok) throw new Error("添付ファイルを保存できませんでした");
    return response.json();
  }} />
```

サーバーの戻り値は `[{ id, name, mediaType, size, url? }]` にします。メタデータは受け取り時に検証されます。ファイルの許可形式、バイト数、保存先、ウイルス検査などのアップロード方針はホストで適用してください。ライブラリはファイル本体を保存しません。

添付は入力欄の下書きに入り、送信後にメッセージへ保存されます。会話切り替えやキャンセル後に古いアップロード結果を追加しません。送信済み添付のクリックを親側で処理する場合は `onAttachmentClick(attachment)` を渡します。省略時は `url` がある添付をリンクとして表示します。

参照とツール情報は `message.add` / `message.update` の `references` / `toolCalls` で設定します。`onSend` のストリームは文字列専用で、これらのメタデータや実際のツール実行はホストが管理します。
