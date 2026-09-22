# 保存と編集許可

`onSave(form)` がresolveすると保存済みになります。返却値はvoid、またはサーバーで調整したFormModelです。reject時は未保存の状態を維持します。保存後もUndo/Redoを保持します。

```tsx
<LikeForm initialForm={form}
  onEditRequest={async ({ model }, { signal }) => {
    return await acquireLock(model.id, signal);
  }}
  onBeforeSave={async model => model.fields.length > 0}
  onSave={async model => { await persist(model); }}
  onDirtyChange={setDirty}
  onEvent={event => console.log(event)}
/>
```

編集許可は最初に実際の変更を行う直前に求めます。未指定なら許可、falseなら操作せずメッセージを表示します。保存または破棄の後の最初の変更で再度確認します。永続的なロックの取得・解除は親アプリの責務です。

イベントは `change { source, model }`、`save { phase: start | success | cancelled | error, error? }`、`edit-mode { mode: view | requesting | edit }`。sourceはcommand/import/undo/redo/save/discardです。通知コールバックの例外は確定済みデータを巻き戻しません。

ページ遷移の制御は `onDirtyChange` を使って利用側ルーターに組み込みます。回答は定義のdirtyに含まれません。回答の入力状態は `onAnswersChange` で管理してください。

## 保存構造

```json
{
  "format": "likex.form",
  "version": 1,
  "id": "contact",
  "title": "お問い合わせ",
  "description": "",
  "submitLabel": "送信",
  "fields": [
    { "id": "name", "type": "text", "label": "お名前", "description": "", "placeholder": "", "required": true, "options": [], "defaultValue": "" }
  ]
}
```

保存は定義順を保持し、同じ内容のserializeでIDや日時が変わりません。回答は別途保存します。定義は最大500項目、各項目の選択肢500件、バッチ1000コマンド、JSONは8 MiBまでです。
