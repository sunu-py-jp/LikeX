# ストリーミング・パーツ・添付

応答生成は親アプリの `onSend` で接続します。戻り値は完成した文字列、`{ content, parts? }`、または文字列と構造化イベントの `AsyncIterable<AIChatResponseChunk>` です。いずれもPromiseで返せます。従来の `AsyncIterable<string>` も使えます。SSE・JSON・特定プロバイダーのイベントは親アプリでこの形式へ変換します。

システムプロンプト、モデル・プロバイダーの選択、APIキー、実際のツール実行は `onSend` の接続先となるホストサーバーが管理します。LikeAIChat本体に固定のプロンプトや特定プロバイダーへの通信を組み込まず、利用側で指示と送信する文書情報を決めてください。ホストの信頼された指示は、ユーザーの会話や取得した文書データと分けて扱います。

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

文字列と `{ type: "text", text }` は前の本文に追加されます。毎回それまでの全文を返すと重複します。実際のサービスへ接続する場合は、親アプリでレスポンスを断片へ変換し、`signal` をfetchやSDKへ渡してください。

`AIChatSendRequest` は `aichat`、`conversation`、`messages`、`prompt`、`retry` を持ちます。`prompt` は送信元のユーザーメッセージ、`messages` は生成対象のassistantメッセージより前の履歴です。再試行ではその応答より後のメッセージを含めません。`conversation.messages` は会話全体なので、生成用の履歴には `messages` を使います。contextはキャンセル用の `signal` と操作識別用の `requestId` を持ちます。

## パーツを外部で定義する

`AIChatContentPart` は `{ id: string, type: string, data: AIChatJSONValue }` です。`data` は文字列・有限数値・真偽値・null・配列・オブジェクトを組み合わせたJSON値です。利用側が `type` とそのデータ形式を定義し、`partRenderers` で表示関数を登録します。

```tsx
import LikeAIChat, { type AIChatPartRenderers } from "@likex/aichat";

const partRenderers: AIChatPartRenderers = {
  "app.tool": (part, { message }) => {
    const data = part.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    return <details>
      <summary>{String(data.name ?? "ツール")} · {String(data.status ?? "")}</summary>
      <pre>{JSON.stringify({ input: data.input, result: data.result }, null, 2)}</pre>
      <small>応答ID: {message.id}</small>
    </details>;
  },
  "app.image": part => {
    const data = part.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    // 利用側の画像URL方針を適用する。この例ではローカルの専用パスだけを許可。
    if (typeof data.url !== "string" || !data.url.startsWith("/chat-images/")) return null;
    return <img src={data.url} alt={typeof data.alt === "string" ? data.alt : ""} />;
  },
};

<LikeAIChat initialAIChat={aichat} onSave={saveAIChat}
  onSend={onSend} partRenderers={partRenderers} />;
```

表示関数は `(part, { message }) => ReactNode` で、型は `AIChatPartRenderer` / `AIChatPartRenderers` / `AIChatPartRendererContext` として公開しています。Hooksを使う表示は別のReactコンポーネントを作り、関数から `<MyPart part={part} />` を返します。型固有のデータ検証、画像URLの制限、ボタン操作や実際のツール実行は利用側で実装します。`data` をHTMLとして直接挿入しないでください。

本文を先に、`parts` を配列順に表示します。`content: ""` のパーツだけのメッセージも使えます。文章→画像→文章のように混在させる場合は、文章も `app.text` などのパーツとして定義し、レジストリから `<p>{text}</p>` を返します。未知の型と表示に失敗したパーツは展開可能なJSONとして表示します。`message.add` / `message.update` でも `parts` を設定でき、保存・読み込みでは未知の型もそのまま保持します。表示レジストリ・画像本体・ツール関数はシリアライズしません。画像はURLなどのメタデータを保存し、実体の保管は利用側が担当します。

## ツール進捗と結果をストリームで更新する

```ts
const onSend: AIChatSendHandler = async function* (_, { signal }) {
  const input = { range: "売上速報!B2:F6" };
  yield { type: "part", part: {
    id: "call-1", type: "app.tool",
    data: { name: "売上を集計", status: "running", input },
  } };
  const result = await runTool(input, { signal }); // 親アプリの処理
  if (signal.aborted) return;
  yield { type: "part", part: {
    id: "call-1", type: "app.tool",
    data: { name: "売上を集計", status: "complete", input, result },
  } };
  yield { type: "part", part: {
    id: "chart-1", type: "app.image",
    data: { url: "/chat-images/sales.png", alt: "商品別の売上グラフ" },
  } };
  yield { type: "text", text: "売上を集計しました。" };
};
```

`{ type: "part", part }` は、同じメッセージ内で新しいIDなら末尾へ追加し、既存IDならその位置のパーツを丸ごと置き換えます。更新時も完全な `data` を渡してください。実行中→完了・エラーを同じIDで更新でき、順序は変わりません。パーツのIDはメッセージ単位で一意にします。

一度に返す場合は `{ content: "集計しました。", parts: [...] }` にします。ツールの引数や結果は通常の会話JSONに残り、エクスポート・インポートできます。永続保存には既存の `onSave` を使います。ライブラリ自体はサーバーやブラウザーのストレージへ自動保存しません。

## 履歴のスクロール

履歴の末尾を表示している間は、本文やパーツの更新に合わせて末尾へ追従します。上へスクロールして過去の内容を読んでいる間は、その位置を保ちます。スクロールバーやPageUpなどのキーボード操作も同じ扱いで、末尾へ戻ると追従を再開します。会話の切り替えと新しいユーザーメッセージの追加では末尾を表示します。

画像の読み込みやツール詳細の展開、表示領域の高さ変更も、末尾へ追従している間だけ反映します。追従にはスムーズスクロールを使わず、ストリーミング中の更新と手動操作が競合しないようにしています。

## 停止・エラー・再試行

送信するとユーザーメッセージと空のassistantメッセージを追加し、応答中は `streaming`、正常終了時は `complete` になります。`onSend` 未指定ならユーザーメッセージだけを記録します。

停止ボタンまたは `cancel()` は生成を中止します。すでに受信した本文とパーツは残り、応答は `cancelled` になります。会話切り替えも生成をキャンセルします。読み取り専用・機能設定への変更、アンマウント後の古い結果は反映しません。保存済みの `streaming` は進行中の通信を意味しません。

`onSend` が例外を投げた場合は途中の本文とパーツを残して `error` とエラー文を設定し、通知します。ホストからのエラー文はUIに表示されるので、認証情報を含めず利用者向けの文言へ変換してください。

`retry` は `replyTo` でユーザーメッセージを参照するassistant応答が対象です。同じ応答IDの本文とパーツを空にして生成し直します。後続メッセージを削除する処理ではありません。送信・再試行中は保存や他の編集を受け付けず、1回の生成はまとめてUndoできます。

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

既存の参照・ツール情報は `message.add` / `message.update` の `references` / `toolCalls` でも設定できます。新しい構造化ストリームでは `parts` に任意のデータを載せられます。LikeAIChatはツールの実行や画像生成を行わず、ホストから届いた履歴データを表示します。
