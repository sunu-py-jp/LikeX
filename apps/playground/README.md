# LikeX Playground

ExplorerとSpreadsheetの操作・見た目を確認するVite + Reactのデモです。各ページに対象のコンポーネントだけを配置します。

| パス | デモ |
| --- | --- |
| `/` | Explorer |
| `/spreadsheet` | Spreadsheet。売上計画・経費・挿入サンプル・関数サンプルの4シートで編集・数式・書式・挿入を確認できます。 |

リポジトリのルートで依存関係をインストールした後、次のコマンドで起動します。

```sh
npm run dev --workspace @likex/playground
```

`@likex/explorer` は `packages/explorer/src/index.ts` に直接解決します。ライブラリを先にビルドする必要はありません。`src/explorer-demo.tsx` からExplorerの生成済みCSSを読み込みます。このデモ自体にTailwind/PostCSSの設定はありません。開発用Viteプラグインが起動時とExplorerのソース変更時にCSSを再生成します。

`@likex/spreadsheet` も `packages/spreadsheet/src/index.ts` へ直接解決します。`src/spreadsheet-demo.tsx` が独立したCSSと表示用データを読み込み、親のメモリへ保存します。`src/demo/spreadsheet-workbook.ts` は架空のサンプルで、TSV貼り付け、セル参照、別シート参照の動作確認に使えます。ページの再読み込みで初期状態へ戻ります。

`src/main.tsx` はパスに応じて対象デモだけを遅延読み込みします。デモごとにJSとCSSを分け、SpreadsheetページでExplorerを先読みしません。

```sh
npm run build --workspace @likex/playground
npm run preview --workspace @likex/playground
```

ビルド先はこのディレクトリの `dist/` です。同梱した依存パッケージの一覧と通知を `third-party-inventory.json`、`third-party-notices.txt` として生成します。

`src/explorer-demo.tsx` が親側の保存・再取得・ファイル読み込みを担当します。保存先は同じブラウザータブのメモリのみで、ページ全体を再読み込みすると初期状態に戻ります。Explorerの更新ボタンはメモリに保存済みの一覧を再取得します。認証、API、DB、ストレージは実装していません。

`src/demo/seed.ts` は階層付きの初期データ、`src/demo/icon-samples.ts` はすべての既定アイコンを表示するためのファイル生成です。アイコン用ファイルは表示確認用テキストであり、有効なOffice・フォント・圧縮ファイルではありません。

デモは `icons` フォルダの中アイコン表示から開始します。お気に入り・コピー・新しいファイルの作成・チェックボックスは非表示で、追加できる拡張子は `csv, md, txt, json, xlsx, xls, docx, doc, pptx, ppt` です。`txt` は以下の右クリックデモの生成結果も、通常のアップロード検証を通すために許可しています。

初期表示はURLの `initialPath`・`selectedFile`・`selectedFileMode` をコンポーネントの同名propsへ渡して確認できます。例えば `/?selectedFile=erp-spec` は「ERPリニューアル」を開いて「要件定義メモ.md」を選択し、`/?selectedFile=erp-spec&selectedFileMode=preview` はそのプレビューも開きます。`selectedFile` はファイル名ではなくデータのIDです。明示的にフォルダも指定する場合は `/?initialPath=/プロジェクト/ERPリニューアル&selectedFile=erp-spec` とします。「＋」の新規タブは引き続き `defaultPath` の `icons` から開きます。

## 利用側が追加する右クリックメニュー

Explorerではファイルの右クリックに「AIに指示」を追加しています。ダイアログへ指示を入力して実行すると、約1.5秒のモック処理の後、元のファイルと同じフォルダへ `元の名前-AI指示結果.txt` を追加します。同名があれば連番を付けます。処理中の表示、キャンセル、Escape、背景のクリックに対応し、別ウィンドウから実行した場合もそのExplorer内にダイアログを表示します。AIサービスへの送信や元ファイルの本文解析は行いません。生成したファイルは保存するまで下書きです。

Spreadsheetでは集計する範囲を選択してから、結果を入れるセルを右クリックし「選択範囲のSUMを挿入」を選びます。例えば `A1:A3` を選択して `A4` を右クリックすると、`A4` へ `=SUM(A1:A3)` を設定します。離れた範囲にも対応し、重複選択を二重加算しません。結果を入れるセルが選択内なら、そのセル（結合セルの場合は結合範囲全体）を除外します。集計対象が残らない場合はエラーを表示します。このデモの集計は10,000セル以内です。

どちらも `getContextMenuItems` が処理結果を返し、コンポーネントが編集許可・確認・変更処理を担当します。デモ内で操作APIを直接呼んで確認を迂回することはありません。

既定の実行モードは `block` です。URLに次のクエリを付けると、コンポーネントへ渡すモードだけを切り替えられます。

| URL例 | 完了時の扱い |
| --- | --- |
| `/?menuMode=block` | 処理中は変更を禁止し、完了したら反映 |
| `/?menuMode=confirm` | 完了時に反映内容を確認 |
| `/?menuMode=reject-if-changed` | 処理中にデータが変わった場合は反映しない |

Spreadsheetも `/spreadsheet?menuMode=confirm` のように指定できます。AI指示ダイアログ自体はモーダルですが、`confirm` と `reject-if-changed` では別タブ・別ウィンドウなどからの変更を許容します。

```sh
npm run test --workspace @likex/playground
```

デモのSUM式について、対象セルの除外・結合セル・離れた範囲・重複範囲・計算上限を実際の数式エンジンで検証します。
