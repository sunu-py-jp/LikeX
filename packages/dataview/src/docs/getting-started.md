# LikeDataViewの導入

Airtableのように、名前と型を持つフィールド、IDを持つレコードを扱います。Spreadsheetのセル番地や数式とは異なり、列の順番を変えても値はフィールドIDに結び付きます。

```tsx
import LikeDataView, { createDataView, type DataViewHandle } from '@likex/dataview';
const data = createDataView({ title: '取引先', fields: [
  { id: 'name', name: '会社名', type: 'text' },
  { id: 'amount', name: '金額', type: 'number' },
  { id: 'status', name: '状態', type: 'select', options: ['新規', '契約中'] },
] });
<LikeDataView initialData={data} onSave={async model => persist(model)}
  onBeforeSave={model => validateBeforeSave(model)}
  onEditRequest={async ({ model }, { signal }) => acquireLock(model.id, signal)}
  onDirtyChange={setUnsaved} onEvent={console.log}
  primaryColor="#267366" colorMode="system" style={{ height: 600 }} />;
```

`onSave` 未指定または `readOnly` の場合は編集できません。初回の実変更で `onEditRequest` を確認し、falseなら適用しません。保存完了までは待機し、失敗時は未保存のまま保持します。保存後もUndo/Redoが使えます。サーバーで補正したモデルを `onSave` から返すと再反映し、`change` イベントの `source: 'save'` で通知します。

`initialData` は初期値です。以後の差し替えは `ref.current.importNative()` または `execute({ type: 'data.replace', data })` で行います。非同期読み込み中に読み取り専用や機能設定が変わると古い結果は適用しません。認証・ロック・API側の権限検査は親の責務です。

## 表示条件

`initialQuery` で初期条件を渡し、`DataViewHandle.setQuery(query)` で動的に変更できます。`getQuery()` と `onQueryChange` で現在の条件を取得します。

```ts
ref.current?.setQuery({
  search: '商事',
  sort: [{ fieldId: 'amount', direction: 'desc' }],
  filters: [{ fieldId: 'amount', operator: 'greaterThan', value: 100000 }],
  groupBy: 'status', hiddenFieldIds: ['internalNote'],
});
```

表示条件はモデルの値や順序を変更せず、未保存変更には数えません。1ページ50件の表示で、データが増えても全行の入力要素を同時に描画しません。詳細を親側で表示する場合は `onRowOpen={({ row, data }) => ...}` を指定します。

## 機能ON/OFF

`features` の各キーは初期値trueです。

|キー|対象|
|---|---|
|`rename`|タイトル変更API|
|`fields`|フィールド追加・変更・削除・移動|
|`rows`|レコード追加・削除・移動|
|`editCells`|既存の値の編集。型変更やフィールド削除にも必要|
|`sort` / `filter` / `group` / `columnVisibility`|表示条件|
|`import` / `export`|JSON・CSV入出力|
|`history`|Undo / Redo|

CSV・JSONの全体読み込みは `import` によって制御します。読み込み内容の型や値は常に検証します。純粋なモデルAPIはUI権限に依存しないため、権限チェックが必要な表示中の操作には `DataViewHandle.execute` を利用します。

未保存時はブラウザー終了確認が働きます。SPA遷移は `onDirtyChange` を親ルーターに接続してください。Ctrl/Cmd+Z、Shift+Ctrl/Cmd+Z、Ctrl/Cmd+Sに対応します。入力欄の中では通常のテキスト編集キーを優先します。

## 右クリックメニュー

行番号やレコードの余白から詳細、複製、削除を開けます。セルの余白ではそのセルをクリアできます。フィールド見出しでは設定、左右移動、昇順・降順、グループ化、非表示、削除を選べます。表の余白ではレコード・フィールド追加とUndo/Redoを開けます。入力欄の右クリックと選択中テキストにはブラウザー標準のメニューを使います。

ソートや絞り込み後も、右クリックした行のIDを対象にします。複製は新しいIDで元レコードの次の保存位置へ追加し、値を保ちます。表示条件がある場合の表示位置はその条件で決まります。列の非表示・ソート・グループ化は表示条件だけの変更で、読み取り専用でも有効な機能を使えます。保存データを変更する項目は通常の編集許可・機能設定・Undo/Redoを通り、無効機能の項目は隠します。モデル・権限・表示条件が変わるとメニューを閉じます。
