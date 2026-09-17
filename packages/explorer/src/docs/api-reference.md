# 公開APIリファレンス

[ドキュメント一覧](./README.md)

ExplorerとExplorerPopupに共通するpropsと公開型の契約です。具体例は各機能のガイドを参照してください。

## 公開props一覧

<a id="explorer-props"></a>

以下は両コンポーネントに共通するpropsです。

| prop | 契約 |
| --- | --- |
| `initialEntries` | 初回マウント時の保存済み一覧。`readonly ExplorerEntry[]`。後からのprop変更で編集中の内容を上書きしません。別のワークスペースへ切り替える場合は `key` を変えて再マウントします。 |
| `ref` | 任意の `React.Ref<ExplorerHandle>`。`navigate()` / `selectFiles()` / `showFile()` で現在の表示を操作します。[移動・選択](#external-navigation)。`notify()` / `dismissNotification()` / `clearNotifications()` は親のメッセージを表示・更新・削除します。[通知の表示](./notifications.md) |
| `onSave` | 保存時に `ExplorerSavePayload` を受け取る任意のコールバック。省略すると読み取り専用になります。`void` または保存後の `readonly ExplorerEntry[]` を返します。どちらもPromiseにできます。 |
| `onRefresh` | 任意の `() => readonly ExplorerEntry[] \| Promise<readonly ExplorerEntry[]>`。アドレスバー直前の更新ボタンから最新一覧を取得します。未指定ならボタンを隠します。初回の自動読込は行わず、読み取り専用でも利用できます。 |
| `onEditRequest` | `ExplorerEditHandler`。最初の有効な変更を適用する直前に親へ許可を求めます。入力欄やダイアログを開くだけでは呼びません。許可後は保存・破棄等までセッションを共有し、未指定なら同期で許可します。 |
| `readOnly` | 任意の `boolean`。`true` なら `onSave` があっても読み取り専用です。`false` でも `onSave` がなければ編集できません。 |
| `readFile` | 既存のファイル本体を読み出す任意の `(sourceId: string) => Promise<Blob>`。内蔵プレビュー・内蔵ダウンロード・画像サムネイルに利用します。ローカル追加ファイルには不要です。 |
| `onPreviewRequest` | `ExplorerPreviewHandler`。指定時は内蔵プレビューの代わりにファイル情報を親へ渡します。未指定なら内蔵プレビューを使います。 |
| `onDownloadRequest` | `ExplorerDownloadHandler`。指定時はファイル・フォルダのダウンロードを親へ委譲します。要求情報と進捗通知・取消し用contextを受け取り、結果を明示して返します。未指定なら内蔵処理です。 |
| `onSearchRequest` | `ExplorerSearchHandler`。指定時は検索を親へ委譲し、現在の下書きにある項目のIDを順位順に受け取ります。未指定なら全項目の名前を内蔵検索します。 |
| `getContextMenuItems` | `ExplorerContextMenuProvider`。ファイル・フォルダ・空白の右クリック時の情報から、条件付きの追加メニューを返します。ハンドラーは変更プランを返し、反映はExplorerが担当します。[使い方](./context-menu.md) |
| `contextMenuExecutionMode` | Core共通の `"block"`（既定） / `"confirm"` / `"reject-if-changed"`。処理中の変更禁止・完了時の反映確認・データ変更時の中止を選べます。 |
| `search` | `ExplorerSearchOptions`。`trigger` は `"input"`（既定）または `"submit"`。`debounceMs` は外部の入力検索だけに適用する待機時間で、既定は `0`。 |
| `previewTrigger` | `ExplorerPreviewTrigger`。`"doubleClick"`（既定）または `"click"`。後者はファイル名の単クリックでプレビューします。 |
| `onEvent` | `ExplorerEventHandler`。ローカル操作・選択・移動・表示状態・保存等を親へ通知します。通知の戻り値や例外は操作の成否を変えません。 |
| `renderIcon` | `ExplorerIconRenderer`。項目情報・描画箇所・選択状態等から独自アイコンを返します。`null` / `undefined` は既定表示、`false` は枠だけを残します。 |
| `processingEntryIds` | 任意の `readonly string[]`。親の処理中項目と祖先フォルダにインジケーターを表示します。マウント後の変更に追従し、保存・未保存判定や操作の可否には影響しません。[使い方](./appearance.md#processing-entries) |
| `title` | 任意の `string`。`title="資料管理"` のようにタブバー右上の表示名を指定します。前後の空白を除去し、省略・空文字・空白のみなら非表示です。 |
| `rootLabel` | ルートの表示名。省略時・空白のみの場合は「ファイル」。タブ、パンくず、サイドバー、保存場所表示へ適用します。 |
| `defaultPath` | 「＋」の新規タブで開く仮想フォルダのパス。初期位置の指定がなければ最初のタブにも使います。省略・空白のみなら `/`。初回に解決したフォルダIDを保持します。 |
| `initialPath` | 任意の `string`。最初のタブだけで開く仮想フォルダのパス。明示した場合は `defaultPath` より優先し、空白のみなら `/`。新規タブには再適用しません。 |
| `selectedFile` | 任意の `string`。初回に選択するファイルの `ExplorerEntry.id`。`initialPath` 未指定なら対象の親フォルダを開き、指定時はその直下にあるファイルだけを選択します。ファイル名や `source.id` ではありません。 |
| `selectedFileMode` | `ExplorerSelectedFileMode`。`"select"`（既定）または `"preview"`。後者は初期選択に加え、内蔵プレビューまたは `onPreviewRequest` を一度起動します。 |
| `features` | `ExplorerFeatures`。機能ごとに `false` を指定すると、関連UIとその実行経路を無効にします。 |
| `upload` | `ExplorerUploadOptions`。許可する拡張子・1ファイルの最大サイズ・違反時の扱いを指定します。制限は省略可能で、違反時は既定でその回の追加をすべて中止します。 |
| `selection` | `ExplorerSelectionOptions`。選択方式（`none` / `single` / `multiple`）とチェックボックス表示。 |
| `ui` | `ExplorerUIOptions`。サイドバー、右クリックメニュー、項目メニュー、サムネイルの表示。 |
| `view` | `ExplorerViewOptions`。使える表示形式と初期表示。 |
| `onDirtyChange` | 未保存の変更の有無を通知する任意の `(dirty: boolean) => void`。親画面の保存状態表示や、SPA遷移・ワークスペース切替前の確認に利用できます。 |
| `warnOnUnsavedChanges` | 任意の `boolean`。既定は `true`。未保存の変更がある間、親画面とExplorerの別ウィンドウでブラウザ標準の離脱確認を有効にします。`false` で無効化でき、マウント後の変更にも反映します。 |
| `className` / `style` | 外枠のサイズや配置を調整します。 |
| `colorMode` | `ExplorerColorMode`。`"light"` / `"dark"` / `"system"`。未指定はライト（既存の `theme.colorScheme` 指定は維持）。 |
| `theme` | `ExplorerThemeOptions`。ベースカラー、共通・モード別の配色、フォントを上書きします。従来の `Partial<ExplorerTheme>` も渡せます。 |
| `aria-label` | Explorer領域のアクセシブルな名前。複数配置する場合は識別できる名前を指定します。 |

`title` はマウント後の変更にも追従し、子・孫ウィンドウにも同じ表示名を使います。現在地のタブ名、`rootLabel`、ブラウザの `document.title`、`aria-label` とは独立しています。タブバーを非表示にした場合や表示幅が狭い場合は表示しません。[指定例](./getting-started.md#右上のタイトルを指定する) を参照してください。

`initialPath`・`selectedFile`・`selectedFileMode` は初回マウント時のみ評価します。表示後の移動・選択には `ref` のAPIを使い、`key` による再マウントは不要です。初期指定で無効なパスはルート表示と通知、無効なファイルID・フォルダID・指定先にないファイルIDは無選択と通知になります。`features.preview: false` なら初期プレビューを行わず、`selection.mode: "none"` なら初期選択を行いません。選択を無効にしていてもプレビューは有効にできます。[優先順位と指定例](./getting-started.md#initial-file)

保存成功時は、返された一覧を次の編集の基準にします。戻り値を省略した場合は、送信した一覧を基準にします。新しく保存したファイルは `source` を既存ファイル参照に正規化した一覧を返すと、次の保存でローカルファイルとして再送する必要がなくなります。保存コールバックが例外を投げる・Promiseをrejectする場合、下書きと選択したローカルファイルを保持して再試行できます。

`onRefresh` は親が認証・取得した最新の一覧を返します。初期表示の取得関数をそのまま共用でき、更新専用のAPIエンドポイントは不要です。成功時に下書きと保存の比較元を最新一覧へ置き換え、未保存状態を解除して子・孫にも共有します。未保存の変更があれば、実行前に「未保存の変更を破棄して、再読み込みしますか？」と確認します。取り消した場合は呼び出さず、取得に失敗した場合も下書きとローカル `File` を保持します。更新中はスピナーを表示し、再更新・保存・変更を無効にします。ページ全体の再読み込みやルーターには依存しません。[型付きの取得関数共用例](./saving.md#refresh-entries)

未保存の変更がある間は、親画面・子・孫・`ExplorerPopup` の最初の表示で、ウィンドウを閉じる・再読み込み・別の文書への移動をブラウザ標準の確認で保護します。保存成功や変更の破棄で差分がなくなると解除し、保存失敗時は継続します。確認の表示にはユーザー操作が必要で、文言はブラウザが決めます。モバイルでの強制終了など、確認を保証できない操作もあります。[MDN: beforeunload](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event)

Next.js等のSPA遷移やReactの `key` 差し替えは、親が `onDirtyChange` を受けて**操作前に**確認します。アンマウント後に引き止めることはできません。Explorer内のフォルダ移動・タブ切替では下書きを保持するため警告しません。`ExplorerPopup` の `close()` は未保存時に確認し、取り消すと表示を維持します。閉じることを許可しても、親にマウントされた下書きは保持します。[確認の範囲とNext.jsの例](./saving.md#unsaved-changes)

### 読み込み・保存・更新の公開型名

ホストが渡す関数は `ExplorerFileReader`、`ExplorerSaveHandler`、`ExplorerRefreshHandler` で型付けできます。ブラウザ標準の `FileReader` クラスと紛らわしくならないよう、Explorerの型であることを名前に含めています。

旧公開名の `FileReader`、`SaveHandler`、`RefreshHandler` は同じ型の非推奨エイリアスとして残しています。既存の公開入口からのimportは動きますが、新規コードではExplorer接頭辞付きの名前を使ってください。`initialEntries`、`onSave`、`onRefresh`、`readFile` などのprops名や挙動は変更していません。

<a id="external-navigation"></a>

## 外部からの移動・選択

`ExplorerHandle` は通知APIに加え、次の `ExplorerNavigationHandle` を含みます。いずれも読み取り専用で利用でき、下書き・ファイルID・保存の比較元を変更しません。

```ts
type ExplorerFileTarget =
  | Readonly<{ id: string; path?: never }>
  | Readonly<{ path: string; id?: never }>;

type ExplorerShowFileOptions = Readonly<{
  mode?: "select" | "preview";
}>;

type ExplorerNavigationErrorCode =
  | "not-ready" | "invalid-target" | "invalid-path"
  | "not-found" | "not-file" | "not-folder" | "ambiguous-path"
  | "different-folders" | "invalid-hierarchy"
  | "selection-disabled" | "selection-limit"
  | "preview-disabled" | "invalid-mode";

type ExplorerNavigationResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: ExplorerNavigationErrorCode; message: string }>;

type ExplorerNavigationHandle = Readonly<{
  navigate(path: string): ExplorerNavigationResult;
  selectFiles(targets: readonly ExplorerFileTarget[]): ExplorerNavigationResult;
  showFile(target: ExplorerFileTarget, options?: ExplorerShowFileOptions): ExplorerNavigationResult;
}>;
```

上記の型は `@likex/explorer` からimportできます。

| メソッド | 動作 |
| --- | --- |
| `navigate("/記事/画像")` | 現在のタブで既存フォルダを開きます。`"/"` はルートです。 |
| `selectFiles([{ id: "file-a" }, { path: "/記事/画像/表紙.png" }])` | 対象の親フォルダを開き、指定ファイルを選択します。複数指定は同じ親フォルダにあるファイルに限ります。 |
| `selectFiles([])` | 選択だけを解除します。現在地は変えません。 |
| `showFile({ id: "file-a" })` | 対象の親フォルダを開き、1ファイルを選択します。`mode` の既定は `"select"` です。 |
| `showFile({ path: "/記事/画像/表紙.png" }, { mode: "preview" })` | 対象の親フォルダを開き、ファイルを選択してプレビューを要求します。`onPreviewRequest` があれば親へ渡し、なければ内蔵プレビューを開きます。 |

`id` は `ExplorerEntry.id` の完全一致です。ファイル名だけや本体参照の `source.id` は指定しません。`path` は**現在の下書き上の絶対パス**です。`/` から始まる表記を推奨し、アドレスバーと同様に `\` 区切りも受け付けます。Blobキー・URL・ローカルPCのパスではありません。`initialPath` と異なり、相対パスや `rootLabel` を先頭に置く表記は受け付けません。改名や移動を追いたい場合はIDを使います。同じファイルをIDとパス等で重複指定した場合は、先頭の順序を保って1件として選択します。

対象はメイン表示領域のアクティブなタブです。新しいタブは作らず、切り離した子・孫ウィンドウの表示も操作しません。`ExplorerPopup` では開いているメインポップアップを操作し、未起動なら `not-ready` を返します。

移動や対象ファイルの表示では検索を解除し、最初の選択ファイルが見える位置までスクロールします。移動履歴を追加するのは現在地が変わったときだけです。表示が変われば既存の `onEvent` の移動・選択等のイベントで通知します。保存や編集許可は発生しません。

### 結果とエラー

戻り値はPromiseではなく、同期の `ExplorerNavigationResult` です。`ok: true` は要求が受け付けられたことを表し、画面はReactの次の描画で反映されます。外部プレビューの完了は待ちません。その後のプレビュー失敗は通常の通知領域に表示します。

```ts
const result = explorerRef.current?.selectFiles([
  { id: "file-a" },
  { id: "file-b" },
]);
if (result && !result.ok) {
  setError(result.message);
}
```

対象と設定をすべて検証してから反映します。1件でも不正なら、フォルダ・検索・選択・プレビューを途中まで変更することはありません。

`selectFiles()` と `showFile()` は選択する操作のため、`selection.mode: "none"` なら `selection-disabled` です。選択解除の `selectFiles([])` は例外として利用できます。`showFile(..., { mode: "preview" })` も同様に失敗し、プレビューだけを開くことはありません。初期表示の `selectedFileMode` とはこの点が異なります。

| `code` | 原因 |
| --- | --- |
| `not-ready` | 操作対象の表示領域が準備されていない、またはポップアップが開いていない。 |
| `invalid-target` / `invalid-path` / `invalid-mode` | 対象・絶対パス・表示モードの指定が不正。 |
| `not-found` | 指定したIDまたはパスが現在の下書きにない。 |
| `not-file` / `not-folder` | ファイルを指定する操作にフォルダを渡した、またはフォルダ移動にファイルを指定した。 |
| `ambiguous-path` / `invalid-hierarchy` | パスから対象を一意に解決できない、または親子関係が不正。 |
| `different-folders` | 複数選択の対象が異なる親フォルダにある。 |
| `selection-disabled` | 選択する操作が `selection.mode: "none"` で無効。 |
| `selection-limit` | `selection.mode: "single"` で複数ファイルを選択しようとした。 |
| `preview-disabled` | `features.preview: false` でプレビューを要求した。選択だけに切り替えず、操作全体を行いません。 |

[`ref` を接続する利用例](./getting-started.md#dynamic-navigation)も参照してください。
