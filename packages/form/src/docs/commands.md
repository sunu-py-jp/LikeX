# データ取得と操作

```ts
import { createForm, executeFormCommands, serializeForm } from "@likex/form/model";
let form = createForm({ title: "アンケート" });
form = executeFormCommands(form, [
  { type: "field.add", field: { id: "score", type: "number", label: "評価", min: 1, max: 5 } },
  { type: "field.add", field: { id: "note", type: "textarea", label: "ひとこと" } },
  { type: "field.move", fieldId: "note", index: 0 },
]);
const json = serializeForm(form);
```

各コマンドは入力を変更せず、新しい `FormModel` を返します。バッチ中にエラーがあれば全体を反映しません。新規項目にIDを省略した場合だけ生成します。

| コマンド | 引数 |
| --- | --- |
| `form.update` | `patch: { title?, description?, submitLabel? }` |
| `form.replace` | `form: FormModel` |
| `field.add` | `field: FormFieldInput`, `index?`（0始まり、省略で末尾） |
| `field.update` | `fieldId`, `patch: Partial<Omit<FormField, "id">>` |
| `field.move` | `fieldId`, `index`（移動後の0始まり位置） |
| `field.delete` | `fieldIds: string[]`。参照する表示条件も解除 |

`field.update`で条件や上限を解除するときはTypeScriptからundefinedを渡します。JSON経由では `form.replace` で該当キーを取り除いた定義へ差し替えます。項目の型変更時はdefaultValueとoptionsを新しい型に合わせて指定します。

## 画面から項目を並べ替える

項目左側のグリップをドラッグすると、小さな半透明のプレビューがカーソルに追従し、挿入位置に線を表示します。項目一覧の上端・下端付近や領域外へドラッグすると、その方向へスクロールが続きます。狭い画面では一覧を含む表示領域がスクロールします。

一覧内でドロップしたときだけ `field.move` を1回実行します。Escape、領域外でのドロップ、途中の定義変更・編集不可への切り替えで中止し、順番を変更しません。ドラッグ中に他の入力を選択することはなく、Undoで並べ替え前へ戻せます。キーボード操作には各項目の上・下ボタンも使えます。`features.fields` または `features.reorder` がfalseの場合は並べ替え操作を表示しません。

## 取得APIと戻り値

| API | 戻り値 |
| --- | --- |
| `createForm(input?)` / `normalizeForm(input)` | 検証済み・凍結した `FormModel` |
| `parseForm(json)` / `serializeForm(form)` | `FormModel` / 整形したJSON文字列 |
| `getFormField(form, fieldId)` | `FormField \| null` |
| `getDefaultFormAnswers(form)` | `FormAnswers` |
| `getVisibleFormFields(form, answers?)` | 定義順の `FormField[]` |
| `normalizeFormAnswers(form, input)` | 初期値を補完した `FormAnswers` |
| `validateFormAnswers(form, answers)` | `{ valid, errors, values }` |

## 表示中コンポーネントのref

`FormHandle`は `getForm()`、`execute(command | commands)`、`replace(form)`、`save()`、`undo()`、`redo()`、`getAnswers()`、`setAnswers(answers)`、`validate()`、`submit()`、`cancelPending()` を公開します。

execute/replaceの戻り値は `Promise<FormModel | null>`。機能OFF・拒否・変更なし等でnullです。save/undo/redo/submitは `Promise<boolean>`、setAnswersはboolean。getForm/getAnswers/validateは同期です。fillモードから定義を変更するコマンドは拒否されます。

## 右クリックメニューとの対応

設計画面の右クリックによる複製は、取得した項目から既存IDを外して `field.add` へ渡す操作に相当する。選択肢・検証・表示条件は保持し、`index` で挿入位置を指定する。移動は `field.move`、削除は `field.delete` を使う。回答入力・プレビューに設計用メニューはない。表示中はrefの `execute` を使うと編集許可・機能設定・履歴を共有できます。
