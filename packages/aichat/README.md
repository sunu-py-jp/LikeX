# @likex/aichat

会話一覧、メッセージ、入力欄を備えたReact AIチャットUIです。応答の生成、通信、添付ファイルのアップロード、保存は親アプリが担当します。文字列または `AsyncIterable<string>` を返すコールバックで応答を表示できます。

```tsx
"use client";
import LikeAIChat, { createAIChat, serializeAIChat } from "@likex/aichat";
import "@likex/aichat/styles.css";

const initialAIChat = createAIChat({ title: "AIとのチャット" });

export default function AIChatView() {
  return <LikeAIChat initialAIChat={initialAIChat}
    onSend={async ({ prompt }) => `受け取りました: ${prompt.content}`}
    onSave={async aichat => {
      const response = await fetch("/api/aichat", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: serializeAIChat(aichat),
      });
      if (!response.ok) throw new Error("保存できませんでした");
    }} style={{ height: 720 }} />;
}
```

`onSave` 未指定では読み取り専用です。React / React DOM 19.2.6以降の19系と表示枠の高さを用意してください。同梱CSSを使い、Tailwind CSSは不要です。本文はプレーンテキストで表示し、MarkdownやHTMLを解析しません。

リポジトリで `npm ci` の後に `npm run pack:library -- --module aichat` で配布用tarballを作り、利用先にCoreとAIChatを導入します。npmレジストリへの公開は未実施です。

```bash
npm install ./likex-core-0.1.0.tgz ./likex-aichat-0.1.0.tgz
```

- [導入・ソースコピー](src/docs/getting-started.md)
- [画面なしのモデルAPIと表示中の操作](src/docs/headless.md)
- [JSONファイルの保存構造](src/docs/native-files.md)
- [応答のストリーミング・添付](src/docs/streaming.md)
- [保存・編集許可・イベント](src/docs/lifecycle.md)
- [LLM向けスキル・スキーマ・CLI](skills/likex-aichat/SKILL.md)

認証、DB、Blob/S3、AIサービス、複数利用者間の競合解決は親アプリに接続します。ツール呼び出しと参照は表示用のメタデータで、ライブラリがツールを実行することはありません。[MITライセンス](LICENSE)と第三者ライセンス通知を配布時に保持してください。

旧AI向けLikeChatから分離したパッケージです。旧 `likex.chat` 保存ファイルの検証付き移行と公開API名の変更は、[移行手順](src/docs/native-files.md#旧likechatからの移行)を参照してください。人同士のスペース・DMには `@likex/chat` / `LikeChat` を使用します。
