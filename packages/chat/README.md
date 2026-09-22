# LikeChat

Google Chatに近い、人同士のチームメッセージング用React UIと、Reactなしで使えるJSONモデル/APIです。ダイレクトメッセージ、グループ、スペース、スレッド、添付メタデータ、リアクション、既読位置を扱います。保存・認証・配送・アップロード・リアルタイム購読は親アプリが担当します。

```tsx
import LikeChat, { createChat } from "@likex/chat";
import "@likex/chat/styles.css";

const chat = createChat({ participants: [
  { id: "me", name: "自分" }, { id: "colleague", name: "同僚" },
] });
<LikeChat
  initialChat={chat}
  currentUserId="me"
  onSend={async ({ message, conversation }, { signal }) => {
    // 親アプリで認証・配送。失敗時はthrowして入力を保持する。
    await deliverMessage(conversation.id, message, { signal });
  }}
  onSave={async model => { await saveChat(model); }}
/>;
```

`onSave`がない場合は読み取り専用です。`onSend`は人のメッセージの配送を確認する任意のコールバックで、AI応答やストリーミングを生成しません。成功後に1件のメッセージをローカルに追加し、失敗・中止時は追加しません。サーバーで受理済みの配送をUndoで取り消すことはできません。履歴はローカルモデル用です。ホストはメッセージIDを使った重複防止と、必要な差分の保存・配信を行ってください。

画面なしでは`@likex/chat/model`の`createChat`、`executeChatCommands`、`parseChat`、`serializeChat`、`createChatSession`を利用します。受信データは`session.syncChat(model)`またはコンポーネントの同名ref APIで反映します。未保存変更・処理中があれば同期を拒否し、ホストで競合を解決します。`{ discardLocalChanges: true }`を明示した同期だけがローカル変更を破棄し、履歴と保存基準をリセットします。自動マージ・サーバー購読は行いません。

**破壊的変更:** `@likex/chat` 0.2.0の保存形式は`likex.chat` **version 2**で、人の参加者と会話を表現します。旧LikeChatのAI会話（version 1）は`@likex/aichat` / LikeAIChatへ移動しました。旧データは`@likex/aichat/model`の`parseAIChat`で読み込みます。versionだけを2に変更しても変換にはなりません。

API・組み込みガイドは[src/docs](src/docs/README.md)、ヘッドレス操作は[同梱スキル](skills/likex-chat/SKILL.md)を参照してください。
