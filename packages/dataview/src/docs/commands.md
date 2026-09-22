# DataViewのモデルAPI

```ts
import { createDataView, executeDataViewCommands, getDataViewCell } from '@likex/dataview/model';
const data = createDataView({ fields: [
  { id: 'name', name: '名前', type: 'text' },
  { id: 'price', name: '価格', type: 'number' },
] });
const result = executeDataViewCommands(data, [
  { type: 'row.add', row: { id: 'row-1', values: { name: '商品A', price: 1200 } } },
  { type: 'cell.set', rowId: 'row-1', fieldId: 'price', value: 1500 },
]);
getDataViewCell(result.data, 'row-1', 'price'); // 1500
```

戻り値は `{ data: DataViewModel, changed: boolean, createdIds: string[] }`。一括実行は検証エラー時に部分変更を残しません。入力モデルは変更せず、正規化したデータを凍結します。

|コマンド|引数|
|---|---|
|`data.rename` / `data.replace`|`title` / `data`|
|`field.add`|`field: { id?, name, type, options? }`, `index?`|
|`field.update`|`fieldId`, `patch: { name?, type?, options? }`|
|`field.delete` / `field.move`|`fieldId`, 移動時は`index`|
|`row.add`|`row?: { id?, values? }`, `index?`|
|`rows.append`|`rows: { id?, values? }[]`|
|`row.update`|`rowId`, `values`（指定されたフィールドのみ変更）|
|`row.delete` / `row.move`|`rowId`, 移動時は`index`|
|`cell.set`|`rowId`, `fieldId`, `value`|

挿入位置は0始まり、省略は末尾。移動位置は元を取り除いた後の位置です。新しいフィールドの値は既存行で `null` になります。フィールドの削除は対応する値も削除します。型や選択肢の変更で既存値が不正になる場合は、全体を拒否し、値を自動変換しません。

## 型と保存形式

- `text`: 文字列
- `number`: 有限の数値
- `date`: 有効な `YYYY-MM-DD`（タイムゾーンなし）
- `boolean`: `true` / `false`
- `select`: `options` にある文字列
- すべての型で `null` は未設定

```json
{"format":"likex.dataview","version":1,"id":"data-1","title":"連絡先","fields":[{"id":"name","name":"名前","type":"text","options":[]}],"rows":[{"id":"row-1","values":{"name":"佐藤"}}]}
```

保存・読み込みは `serializeDataView` / `parseDataView`。表示順は配列の順序を保ちます。標準形式は `.json` です。

## 取得・検索

|API|戻り値|
|---|---|
|`getDataViewField(data, fieldId)`|`DataViewField \| undefined`|
|`getDataViewRow(data, rowId)`|`DataViewRow \| undefined`|
|`getDataViewCell(data, rowId, fieldId)`|`string \| number \| boolean \| null \| undefined`|
|`queryDataViewRows(data, query)`|`DataViewRow[]`（モデルを変更せず絞り込み・並べ替え）|
|`groupDataViewRows(data, query)`|`{ key: string, label: string, rows: DataViewRow[] }[]`|

`query.filters` は `contains`, `equals`, `notEquals`, `isEmpty`, `greaterThan`, `lessThan` を扱います。複数条件はAND。`sort` は指定順の複数キーで比較します。`hiddenFieldIds` は表示情報で、取得される行から値を取り除きません。

100フィールド、20,000行、セルの文字列50,000文字、1バッチ1,000コマンドが上限です。JSONは32 Mi文字、UIのファイル読み込みは32 MiBまでです。

## 右クリックメニューとの対応

GUIのレコード複製は、取得した `values` を新IDまたはID省略の `row.add` に渡す。対象は表示行番号でなく行IDで指定する。セルのクリアは `cell.set` の `value: null`。ソート・グループ化・列非表示は保存データの変更ではなく、表示中refの `setQuery` を使う。表示中はrefの `execute` を使うと編集許可・機能設定・履歴を共有できます。
