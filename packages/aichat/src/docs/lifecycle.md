# 保存・編集許可・イベント

LikeAIChatはローカルの下書きを保持します。保存先、認証、排他制御、通信の再試行は親アプリが担当します。`onSave` 未指定または `readOnly: true` の場合、UIと編集セッションは読み取り専用です。

## 保存と編集許可

```tsx
import { serializeAIChat } from "@likex/aichat/model";

<LikeAIChat initialAIChat={aichat}
  onEditRequest={async ({ aichat }, { signal }) => {
    const response = await fetch(`/api/chats/${encodeURIComponent(aichat.id)}/lock`, {
      method: "POST", signal,
    });
    return response.ok;
  }}
  onBeforeSave={current => current.title.trim().length > 0}
  onSave={async current => {
    const response = await fetch(`/api/chats/${encodeURIComponent(current.id)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: serializeAIChat(current),
    });
    if (!response.ok) throw new Error("保存できませんでした");
  }}
  onDirtyChange={setHasUnsavedChanges}
  style={{ height: 720 }} />
```

編集開始時に `onEditRequest` を呼び、`false` や例外の場合は変更しません。編集モード中の操作ごとに再認証する仕組みではないため、ロックの期限・解放・保存時のバージョン比較は親アプリで管理します。保存後と破棄後は閲覧モードへ戻ります。

保存は `onBeforeSave`、`onSave` の順です。`onBeforeSave` の `false` は保存を中止します。`onSave` は完了時に何も返さないか、保存済みの `AIChatModel` を返せます。返されたモデルは検証して下書きに反映し、保存基準にします。例外時は下書きと未保存状態を残します。`onSave` はcontext引数を受け取らないため、通信の中止自体が必要な場合はホスト側で管理してください。

## 機能を制御する

`features` は指定しない機能を有効として扱います。機能設定はUI・ref・sessionの操作で共通です。純粋な `executeAIChatCommands` にはUIの機能や認証状態を持ち込みません。

| キー | 対象 |
| --- | --- |
| `send` | メッセージ追加と応答更新 |
| `retry` | 応答の再生成。`send` と `onSend` も必要 |
| `attachments` | 添付の準備、添付を含む追加・更新 |
| `edit` | チャット名、メッセージ本文・メタデータの編集 |
| `delete` | メッセージ削除、会話削除 |
| `conversations` | 会話の追加・改名・削除 |
| `history` | Undo / Redo |
| `import` | JSON読み込み、チャット全体の置き換え |
| `export` | JSON書き出し |

会話削除には `conversations` と `delete`、添付付きメッセージ追加には `send` と `attachments` が必要です。`edit: false` でも、`send` が有効ならホストの応答生成と `message.respond` による更新は使えます。履歴やインポートはモデル全体を変更できるため、フィールド単位のアクセス制御が必要なホストはそれらの機能も考慮してください。

## 通知と未保存状態

| コールバック | 値・役割 |
| --- | --- |
| `onChange` | 変更後の `AIChatModel` |
| `onDirtyChange` | 保存基準から変更されているかを表すboolean |
| `onConversationChange` | UI / refで選択した `AIChatConversation` |
| `onEvent` | 変更・保存・編集モードのイベント |

`onEvent` の `change` は `source: "command" | "import" | "undo" | "redo" | "save" | "discard"` と `model`、`save` は `phase: "start" | "success" | "cancelled" | "error"`、`edit-mode` は `mode: "view" | "requesting" | "edit"` を持ちます。通常のコマンドによる全体置き換えは `command`、sessionの `importNative` は `import` として通知します。

sessionの `getSnapshot()` は `dirty`、`canUndo`、`canRedo`、`readOnly`、`editable`、`features`、`busy`、`editMode`、`notice` を返します。`busy` は `permission` / `save` / `prepare` / `task` / `null` です。処理中は他の編集を止め、キャンセルや権限・機能設定変更後の古い結果を適用しません。

`discard()` は保存基準へ戻して履歴を消します。応答生成中などは受け付けないため、必要なら先に `cancel()` を呼びます。アプリ内遷移やブラウザーを閉じる前の未保存確認は `onDirtyChange` を使って親アプリで実装します。
