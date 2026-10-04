# 空の一覧をカスタマイズする

[ドキュメント一覧](./README.md)

`renderEmptyState` で、空のフォルダや検索結果0件の案内を利用側のUIへ差し替えられます。フォルダのID・パスや空になった理由で対象を絞り、それ以外は標準表示を使えます。`Explorer` と `ExplorerPopup` で共通です。

## 特定フォルダとその配下だけ差し替える

```tsx
import Explorer, { type ExplorerEmptyStateRenderer } from "@likex/explorer";

const renderEmptyState: ExplorerEmptyStateRenderer = context => {
  const { reason, location, actions, disabled, defaultContent } = context;
  const root = "/案件資料";
  if (reason !== "folder" || location.kind !== "folder" ||
      location.path !== root && !location.path.startsWith(`${root}/`)) {
    return defaultContent;
  }
  return <section className="project-empty">
    <h2>案件の資料をまとめましょう</h2>
    <p>用途ごとのフォルダを作成して、資料を整理できます。</p>
    {actions.addFiles && <button type="button" disabled={disabled}
      onClick={actions.addFiles}>資料を追加</button>}
    {actions.createFolder && <button type="button" disabled={disabled}
      onClick={actions.createFolder}>フォルダを作成</button>}
  </section>;
};

// entries・saveは利用側で用意します。
<Explorer initialEntries={entries} onSave={save}
  renderEmptyState={renderEmptyState} />
```

`/案件資料` と `/案件資料/…` を分けて判定することで、`/案件資料バックアップ` など別フォルダは対象にしません。改名・移動後も同じフォルダを対象にする場合は、`location.id` と利用側が持つ階層情報で判断します。独自UIの余白・色・ボタンの見た目は利用側の専用クラスで指定してください。

## contextと戻り値

`ExplorerEmptyStateReason`、`ExplorerEmptyStateRenderContext`、`ExplorerEmptyStateRenderer` はUIの公開入口からimportできます。

| context | 内容 |
| --- | --- |
| `reason` | `"folder"` / `"search"` / `"favorites"` / `"recent"`。通常の空フォルダ、検索結果0件、お気に入り0件、最近の項目0件を区別します。 |
| `location` | `ExplorerLocationInfo`。実フォルダは `kind: "folder"` と `id`・`name`・絶対 `path`、お気に入り・最近はそれぞれのkindと `path: null`。 |
| `query` | 現在の確定済み検索語。検索入力の未確定テキストではありません。 |
| `disabled` | 標準操作を一時的に実行できない状態。独自の操作ボタンにも `disabled` を設定します。 |
| `actions` | 任意の `addFiles`・`addFolders`・`createFolder`。検索していない通常フォルダで利用できます。機能設定や読み取り専用等により利用できない操作は省略されます。 |
| `defaultContent` | 標準の空状態を描画する `ReactElement`。そのまま返したり、独自UIと組み合わせたりできます。 |

`null` / `undefined` を返すと標準表示、`false` を返すと空状態の案内を非表示にします。レンダラーは同期でReact要素を返します。フックや非同期処理は、返すReactコンポーネントの内部で実装してください。

フォルダの読み込み中・検索中・取得エラー時には呼びません。それらのインジケーター・エラー・再試行ボタンは標準表示を使います。未取得の遅延読み込みフォルダを、空のフォルダとして案内することはありません。

`actions` は標準UIと同じファイル選択・フォルダ選択・フォルダ作成ダイアログを開きます。ユーザーのクリック等から直接呼び出してください。機能設定・読み取り専用・編集許可・入力検証・保存前の下書き処理を共用します。独自UIから一覧を直接変更せず、利用可能な操作だけを表示してください。標準の空フォルダはタイトルと利用可能な追加ボタンを表示し、「ファイルやフォルダを追加できます」等の補足文は表示しません。

Playgroundの `/explorer/lazy-loading` では、`/空のフォルダ` とその配下だけ案内とボタンを差し替えています。独自の作成ボタンで子フォルダを作り、その中を開くと配下の判定も確認できます。
