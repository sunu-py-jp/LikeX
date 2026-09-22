# CSVの読み込み・書き出し

```ts
import { importDataViewCsv, exportDataViewCsv } from '@likex/dataview/model';
const data = importDataViewCsv('商品,価格\r\n商品A,1200\r\n', { fields: [
  { id: 'name', name: '商品', type: 'text' },
  { id: 'price', name: '価格', type: 'number' },
] });
const csv = exportDataViewCsv(data);
```

先頭行は空欄・重複のない列名が必要です。`fields` を省略すると全列をテキストとして読み込みます。指定する場合はヘッダーの名前と順番を一致させます。CSVには型・選択肢・IDを埋め込まないため、それらも保持する場合はJSONを使ってください。

`delimiter: '\t'` でTSVにも対応します。引用符内の改行・カンマ・二重引用符、UTF-8 BOMを扱います。列数や引用符に誤りがある行、不正な型の値が1つでもあれば全体を拒否します。

数値は有限値、真偽値は `true` / `false`、日付は `YYYY-MM-DD`。数値・日付・真偽値・選択肢の空欄は `null`、テキストの空欄は空文字です。JSON読み込みと同じ検証を行います。

書き出しは全フィールド・全レコードが対象で、UIの表示フィルターを適用しません。標準で `=`, `+`, `-`, `@` から始まるテキストにアポストロフィーを付け、表計算アプリでの意図しない数式実行を避けます。数値型の負数はそのままです。信頼できるデータで元のテキストを保つ必要がある場合だけ、`preventFormulaInjection: false` を指定してください。

`DataViewHandle.importCsv(string | Blob)` と `exportCsv(): Blob` を使えば、表示中の編集許可・機能指定も含めて処理できます。UIのCSV書き出しにはExcel向けにUTF-8 BOMを付けます。
