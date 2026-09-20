# 保存・編集許可・イベント

コンポーネント内の操作はJSONの下書きに反映します。保存ボタンを押すと `onBeforeSave`、`onSave` の順で呼び、返されたPromiseが完了するまで待機します。保存に失敗した場合は下書きと未保存状態を残します。

```tsx
import { serializeSlideDeck } from "@likex/slide/model";

<LikeSlide initialDeck={deck}
  onBeforeSave={current => current.title.trim().length > 0}
  onEditRequest={async (_request, { signal }) => {
    const response = await fetch("/api/deck/lock", { method: "POST", signal });
    return response.ok;
  }}
  onSave={async current => {
    const response = await fetch("/api/deck", { method: "PUT", body: serializeSlideDeck(current),
      headers: { "Content-Type": "application/json" } });
    if (!response.ok) throw new Error("保存できませんでした");
  }}
  onDirtyChange={setHasUnsavedChanges}
  onEvent={event => {
    if (event.type === "save" && event.phase === "success") refreshDocumentList();
  }} style={{ height: 720 }} />
```

`onEditRequest` は最初の変更前に呼びます。省略すると許可します。`false` が返った場合は変更しません。サーバー上のロック解除・有効期限・保存時のバージョン検証は親アプリで管理してください。

## コールバック

| プロパティ | 受け取る値 | 用途 |
| --- | --- | --- |
| `onChange` | `SlideDeck` | 下書きの変更通知 |
| `onDirtyChange` | `boolean` | 親側のページ遷移ガード |
| `onSelectionChange` | `{ slideId, elementIds }` | スライド・要素の選択通知 |
| `onBeforeSave` | `SlideDeck` | `false` で保存中止。非同期可 |
| `onSave` | `SlideDeck` | JSONやPPTXを保存。非同期可 |
| `onEditRequest` | `{ deck }` と `{ signal }` | 最初の変更前の編集許可 |
| `onEvent` | `SlideEvent` | 保存・読込・履歴・編集モードの通知 |

`SlideEvent` は以下の判別可能なunionです。

```ts
type SlideEvent =
  | { type: "change"; source: "command" | "import" | "undo" | "redo"; deck: SlideDeck }
  | { type: "save"; phase: "start" | "success" | "error" | "cancelled"; error?: string }
  | { type: "import"; warnings: readonly string[] }
  | { type: "edit-mode"; mode: "view" | "requesting" | "edit" };
```

保存時に `onSave` から正規化した `SlideDeck` を返すこともできます。保存成功後はそのデータを基準に未保存を判定し、Undo / Redoを保持します。

`warnOnUnsavedChanges` はブラウザーの再読み込み・タブを閉じる操作への標準確認を有効にします。テキストやノートの入力途中も未保存として扱います。ブラウザーの制約により文言は指定できません。アプリ内のページ遷移は `onDirtyChange` を使って親側で確認します。
