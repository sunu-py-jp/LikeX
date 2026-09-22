# JSONエディターの共通制御

`createModelEditorController` はBoard・Diagram・Calendar・Whiteboard・Chat・DataView・Formで使う、Reactに依存しない編集コントローラーです。モデルごとの操作はadapterへ渡し、保存先や認証処理は親が注入します。

```ts
const controller = createModelEditorController(adapter, initialModel, {
  onSave: async model => { await persist(model); },
  onEditRequest: async ({ model }, { signal }) => {
    return await acquireLock(model.id, signal);
  },
  onDirtyChange: dirty => console.log(dirty),
});
await controller.execute(commands);
await controller.save();
await controller.undo(); // 保存後も履歴を保持
controller.dispose();
```

## Adapter

| メンバー | 役割 |
| --- | --- |
| `normalize(unknown): Model` | 構造と意味を検証してモデルへ変換 |
| `serialize(Model): string` | 同じデータを同じ文字列へ変換 |
| `execute(Model, commands): Model` | 不変・一括適用。失敗ならthrow |
| `features: readonly string[]` | 有効・無効を指定できる機能一覧 |
| `getCommandFeatures(command): readonly string[]` | その操作に必要な機能全て |

`onSave`未指定またはreadOnly=trueで書き込みを禁止します。未指定の機能はONです。UIとrefは同じcontrollerを使うため、表示を隠すだけではなく実行経路にも制約が適用されます。

## 状態と通知

`getSnapshot()`は `model`、`dirty`、`canUndo`、`canRedo`、`readOnly`、`editable`、`features`、`busy`、`editMode`、`notice` を返します。subscribeで更新通知を受けられます。モデルと履歴はホストからの変更を避けるため複製・凍結されます。

onChangeとchangeイベントは実際のデータ変更時だけ発生します。onDirtyChangeは初期通知と保存前後の差分を通知します。saveイベントはstart/success/cancelled/error、edit-modeはview/requesting/editです。通知コールバックの例外は確定した編集を取り消しません。

## 非同期処理

- `prepare(worker, {feature})` はファイル読み込みなどを準備し、workerが返すコマンドを後から適用します。
- `runTask(feature, worker)` はストリーミングなどの処理を開始し、worker内の `context.apply(commands)` で途中経過を反映します。
- 両workerには `signal` と `requestId` を渡します。`cancelPending()`、dispose、編集可否の変更後の結果を反映しません。
- 保存・準備・タスク中は通常の編集を抑止します。外部I/O自体を中止するためにはホストもsignalを使います。

モデル単体の認証・他ユーザーとの競合はこのcontrollerの対象外です。JSONサイズ・参照等はモジュールのnormalizeで検証します。画面なしでデータを変えるだけなら、各 `/model` のexecute APIを直接使えます。

履歴は保存後も残りますが、その操作に必要な機能を後からOFFにするとUndo/Redoも拒否します。ONに戻せば再び利用できます。ストリーミングを中止しても適用済みの部分は残り、一括Undoで取り消せます。
