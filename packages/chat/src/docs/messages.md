# メッセージとスレッド

## 会話を選ぶ

左側にDM・グループとスペースを分けて表示します。ホームで会話を横断して確認でき、検索欄で会話名とメッセージ本文を検索できます。表示対象は `currentUserId` が `memberIds` に含まれる会話です。

`kind: "direct"` は2人、`"group"` は2人以上、`"space"` は1人以上の会話です。DMの表示名には相手の参加者名を使います。

## 送信・返信

Enterで送信、Shift + Enterで改行します。日本語入力の変換確定だけでは送信しません。送信が失敗・中止した場合は下書きを残します。会話ごと・スレッドごとに下書きを分けて保持します。

メッセージの返信アイコン、または返信件数から右側のスレッドを開きます。返信には同じ会話のルートメッセージのIDを `replyTo` に入れます。多段の入れ子スレッドは扱いません。狭い幅ではスレッドを会話の上に重ねて表示します。

```ts
await ref.current?.send("確認しました");
await ref.current?.send("モバイル版もお願いします", [], "message-1");
```

## 編集・削除・リアクション

自分が送ったメッセージだけ編集・削除できます。削除は確認ダイアログを表示します。ルートメッセージに返信がある場合は一括削除の確認になり、他の人の返信が含まれている場合はコンポーネント側では削除を拒否します。管理者による削除は親で認可したうえでモデルAPIから行えます。

リアクションはメッセージのアイコンから追加します。同じ絵文字を再度押すと自分のリアクションを外します。既読ボタンは現在の会話の末尾までを既読にします。表示しただけでは既読状態を保存データへ書き込みません。

## 添付

`onAttachmentUpload` がある場合だけ添付ボタンを表示します。ライブラリはファイル本体を保存せず、親から返された名前・MIME・サイズ・URLなどのメタデータを扱います。

```tsx
<LikeChat currentUserId="me" initialChat={initialChat} readOnly={false}
  onAttachmentUpload={async (files, { signal }) => {
    return await uploadAttachments(files, signal); // 親で実装
  }}
  onAttachmentClick={attachment => openAttachment(attachment.id)} />
```

URLを指定する場合はHTTPSを推奨します。許可するURLはHTTP/HTTPSの絶対URLです。署名付きURLの更新、ダウンロード認証、アップロード制限は親で扱います。
