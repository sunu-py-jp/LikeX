# 保存・編集許可・イベント

コンポーネントはローカルの下書きを保持します。保存は `onBeforeSave`、`onSave` の順に呼び、失敗した場合は未保存の文書を残します。保存先・認証・排他制御は親アプリが担当します。

```tsx
import { serializeDocument } from "@likex/document/model";

<LikeDocument initialDocument={document}
  onBeforeSave={current => current.title.trim().length > 0}
  onEditRequest={async (_request, { signal }) => {
    const response = await fetch("/api/document/lock", { method: "POST", signal });
    return response.ok;
  }}
  onSave={async current => {
    const response = await fetch("/api/document", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: serializeDocument(current),
    });
    if (!response.ok) throw new Error("保存できませんでした");
  }}
  onDirtyChange={setHasUnsavedChanges}
  style={{ height: 720 }} />
```

`onSave` 未指定または `readOnly` の場合は編集できません。`initialPageNumber` / `goToPage` によるページ移動は読み取り専用でも使え、選択とスクロールだけを変更します。移動による `onChange`・編集許可・Undo履歴は発生しません。`onEditRequest` は編集許可の取得に使い、`false` で変更を止めます。ロックの有効期限・解放・保存時のバージョン比較は親側で実装してください。

## コールバック

| props | 値・役割 |
| --- | --- |
| `onChange` | 変更後の `DocumentModel` |
| `onDirtyChange` | 保存基準から変更されているかを表すboolean |
| `onSelectionChange` | 現在のProseMirror位置 `{ from, to }` |
| `onBeforeSave` | 文書を受け取り `false` で保存中止。非同期可 |
| `onSave` | 保存対象の文書。正規化した文書を返して保存結果へ反映可能 |
| `onEditRequest` | `{ document }` とキャンセル用 `signal` を持つcontext |
| `onRibbonDisplayModeChange` | リボン表示の変更要求。文書編集とは独立 |
| `onEvent` | 変更・保存・入出力・編集モードのイベント |

`DocumentEvent` の `change` は `source: "command" | "import" | "undo" | "redo" | "save"` と文書、`save` は `phase: "start" | "success" | "error" | "cancelled"`、`import` / `export` は `format: "dcon" | "docx"` と `warnings`、`edit-mode` は `mode: "view" | "requesting" | "edit"` を持ちます。保存時にホストが返した文書へ変更された場合は `source: "save"` で通知します。

非同期の保存・読込・編集許可は、処理中や対象変更後の扱いをコンポーネントが管理します。編集許可のコールバックでは `signal` を通信へ渡せます。保存の失敗は `onSave` からの例外で通知します。`warnOnUnsavedChanges` は再読み込みやタブを閉じる操作の標準確認、アプリ内の画面遷移は `onDirtyChange` を使って親側で対応します。

リボンの初期状態・controlled props・refによる表示の切り替えは[リボンの表示](ribbon-display.md)を参照してください。
