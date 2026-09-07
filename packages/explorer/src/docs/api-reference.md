# 公開APIリファレンス

[ドキュメント一覧](./README.md)

ExplorerとExplorerPopupに共通するpropsと公開型の契約です。具体例は各機能のガイドを参照してください。

## 公開props一覧

<a id="explorer-props"></a>

以下は両コンポーネントに共通するpropsです。

| prop | 契約 |
| --- | --- |
| `initialEntries` | 初回マウント時の保存済み一覧。`readonly ExplorerEntry[]`。後からのprop変更で編集中の内容を上書きしません。別のワークスペースへ切り替える場合は `key` を変えて再マウントします。 |
| `onSave` | 保存時に `ExplorerSavePayload` を受け取る任意のコールバック。省略すると読み取り専用になります。`void` または保存後の `readonly ExplorerEntry[]` を返します。どちらもPromiseにできます。 |
| `onRefresh` | 任意の `() => readonly ExplorerEntry[] \| Promise<readonly ExplorerEntry[]>`。アドレスバー直前の更新ボタンから最新一覧を取得します。未指定ならボタンを隠します。初回の自動読込は行わず、読み取り専用でも利用できます。 |
| `onEditRequest` | `ExplorerEditHandler`。最初の有効な変更を適用する直前に親へ許可を求めます。入力欄やダイアログを開くだけでは呼びません。許可後は保存・破棄等までセッションを共有し、未指定なら同期で許可します。 |
| `readOnly` | 任意の `boolean`。`true` なら `onSave` があっても読み取り専用です。`false` でも `onSave` がなければ編集できません。 |
| `readFile` | 既存のファイル本体を読み出す任意の `(sourceId: string) => Promise<Blob>`。内蔵プレビュー・内蔵ダウンロード・画像サムネイルに利用します。ローカル追加ファイルには不要です。 |
| `onPreviewRequest` | `ExplorerPreviewHandler`。指定時は内蔵プレビューの代わりにファイル情報を親へ渡します。未指定なら内蔵プレビューを使います。 |
| `onDownloadRequest` | `ExplorerDownloadHandler`。指定時はファイル・フォルダのダウンロードを親へ委譲します。要求情報と進捗通知・取消し用contextを受け取り、結果を明示して返します。未指定なら内蔵処理です。 |
| `onSearchRequest` | `ExplorerSearchHandler`。指定時は検索を親へ委譲し、現在の下書きにある項目のIDを順位順に受け取ります。未指定なら全項目の名前を内蔵検索します。 |
| `search` | `ExplorerSearchOptions`。`trigger` は `"input"`（既定）または `"submit"`。`debounceMs` は外部の入力検索だけに適用する待機時間で、既定は `0`。 |
| `previewTrigger` | `ExplorerPreviewTrigger`。`"doubleClick"`（既定）または `"click"`。後者はファイル名の単クリックでプレビューします。 |
| `onEvent` | `ExplorerEventHandler`。ローカル操作・選択・移動・表示状態・保存等を親へ通知します。通知の戻り値や例外は操作の成否を変えません。 |
| `renderIcon` | `ExplorerIconRenderer`。項目情報・描画箇所・選択状態等から独自アイコンを返します。`null` / `undefined` は既定表示、`false` は枠だけを残します。 |
| `title` | 任意の `string`。`title="資料管理"` のようにタブバー右上の表示名を指定します。前後の空白を除去し、省略・空文字・空白のみなら非表示です。 |
| `rootLabel` | ルートの表示名。省略時・空白のみの場合は「ファイル」。タブ、パンくず、サイドバー、保存場所表示へ適用します。 |
| `defaultPath` | 最初のタブと「＋」の新規タブで開く仮想フォルダのパス。省略・空白のみなら `/`。初回に解決したフォルダIDを保持します。 |
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

保存成功時は、返された一覧を次の編集の基準にします。戻り値を省略した場合は、送信した一覧を基準にします。新しく保存したファイルは `source` を既存ファイル参照に正規化した一覧を返すと、次の保存でローカルファイルとして再送する必要がなくなります。保存コールバックが例外を投げる・Promiseをrejectする場合、下書きと選択したローカルファイルを保持して再試行できます。

`onRefresh` は親が認証・取得した最新の一覧を返します。初期表示の取得関数をそのまま共用でき、更新専用のAPIエンドポイントは不要です。成功時に下書きと保存の比較元を最新一覧へ置き換え、未保存状態を解除して子・孫にも共有します。未保存の変更があれば、実行前に「未保存の変更を破棄して、再読み込みしますか？」と確認します。取り消した場合は呼び出さず、取得に失敗した場合も下書きとローカル `File` を保持します。更新中はスピナーを表示し、再更新・保存・変更を無効にします。ページ全体の再読み込みやルーターには依存しません。[型付きの取得関数共用例](./saving.md#refresh-entries)

未保存の変更がある間は、親画面・子・孫・`ExplorerPopup` の最初の表示で、ウィンドウを閉じる・再読み込み・別の文書への移動をブラウザ標準の確認で保護します。保存成功や変更の破棄で差分がなくなると解除し、保存失敗時は継続します。確認の表示にはユーザー操作が必要で、文言はブラウザが決めます。モバイルでの強制終了など、確認を保証できない操作もあります。[MDN: beforeunload](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event)

Next.js等のSPA遷移やReactの `key` 差し替えは、親が `onDirtyChange` を受けて**操作前に**確認します。アンマウント後に引き止めることはできません。Explorer内のフォルダ移動・タブ切替では下書きを保持するため警告しません。`ExplorerPopup` の `close()` は未保存時に確認し、取り消すと表示を維持します。閉じることを許可しても、親にマウントされた下書きは保持します。[確認の範囲とNext.jsの例](./saving.md#unsaved-changes)

### 読み込み・保存・更新の公開型名

ホストが渡す関数は `ExplorerFileReader`、`ExplorerSaveHandler`、`ExplorerRefreshHandler` で型付けできます。ブラウザ標準の `FileReader` クラスと紛らわしくならないよう、Explorerの型であることを名前に含めています。

旧公開名の `FileReader`、`SaveHandler`、`RefreshHandler` は同じ型の非推奨エイリアスとして残しています。既存の公開入口からのimportは動きますが、新規コードではExplorer接頭辞付きの名前を使ってください。`initialEntries`、`onSave`、`onRefresh`、`readFile` などのprops名や挙動は変更していません。
