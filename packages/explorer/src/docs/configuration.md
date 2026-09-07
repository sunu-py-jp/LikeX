# 機能・表示設定とショートカット

[ドキュメント一覧](./README.md)

読み取り専用、機能のON/OFF、選択方式、表示形式、サイドバーとキーボード操作を設定します。

<a id="read-only"></a>

## 読み取り専用で使う

`onSave` を省略すると自動で読み取り専用になります。保存関数があっても、`readOnly: true` で編集を止められます。`Explorer`・`ExplorerPopup`・`useExplorerDraft` に共通の契約です。

| 指定 | 動作 |
| --- | --- |
| `onSave` なし | 読み取り専用。`readOnly: false` を指定しても編集できません。 |
| `onSave` あり、`readOnly` 省略または `false` | 編集できます。初期状態は閲覧モードで、最初の有効な変更の適用直前に許可を取得します。個別機能は `features` に従います。 |
| `onSave` あり、`readOnly: true` | 読み取り専用。編集機能の `features: true` より優先します。 |

```tsx
import Explorer, { ExplorerPopup, type ExplorerProps } from "@/components/explorer";

// entries、readFile、save、canEditは親が用意します。
const viewer = { initialEntries: entries, readFile } satisfies ExplorerProps;
<Explorer {...viewer} />;

// 親の状態に応じて編集可否を切り替えます。
<Explorer {...viewer} onSave={save} readOnly={!canEdit} />;

// 別ウィンドウで開く閲覧専用ビューも、onSaveなしで使えます。
<ExplorerPopup
  {...viewer}
  renderTrigger={({ open }) => (
    <button type="button" onClick={event => open(event)}>ファイルを見る</button>
  )}
/>;
```

`readOnly?: boolean` は `ExplorerOptions`、`onSave?: ExplorerSaveHandler` はデータ操作の設定で定義しています。有効な状態は `readOnly === true || onSave === undefined` です。

| 操作 | 読み取り専用時 |
| --- | --- |
| 名前変更・コピー・複製・切り取り・貼り付け・移動・削除 | メニューとボタンを非表示にし、操作も禁止します。 |
| 空ファイル作成・フォルダ作成・ファイル／フォルダのアップロード | 非表示・操作禁止。ファイルのドロップやOSからの貼り付けも取り込みません。 |
| お気に入り | 登録済みの印と一覧は表示し、登録・解除だけを禁止します。`features.favorites: false` なら表示もなくなります。 |
| 保存・変更の破棄 | 非表示・操作禁止。 |
| フォルダ閲覧・選択・検索・並べ替え・表示切替・タブ・サイドバー幅変更 | 個別の機能・表示設定に従って利用できます。 |
| プレビュー・詳細・ファイル／フォルダのダウンロード | 個別の `features` に従って利用できます。 |

判定は親・子・孫ウィンドウの共有する下書きで統一しています。マウント後の変更にも対応し、読み取り専用へ切り替えると、編集中の名前を確定せず取り消し、変更用ダイアログを閉じ、読み込み途中のフォルダ貼り付けを中止します。内部のコピー・切り取りとドラッグの情報も消去しますが、OSのクリップボードは変更しません。閲覧位置・選択・既に反映した未保存データ・保存エラーは保持します。編集許可のセッションは終了するため、編集可能に戻した後の変更では改めて許可を取得します。

読み取り専用にする前に開始した `onSave` は取り消しません。その保存が成功すれば返された一覧を次の基準とし、失敗すれば下書きとエラーを保持します。以後の新しい保存は開始しません。読み取り専用への切替自体は `change`・`discard`・`save` イベントを発行しません。閲覧操作やプレビュー等のイベントは引き続き届きます。

`useExplorerDraft` を直接使う場合は、返却される `readOnly: boolean` で有効状態を確認できます。読み取り専用で `apply()`・`add()`・`discard()` を呼ぶと「読み取り専用のため変更できません」という `Error` をthrowし、下書きを変えません。`save()` は `false` を返し、`onSave` を呼びません。保持していた操作関数も最新のモードと保存関数を使います。アンマウント後は従来どおり何もせず、`save()` は `false`、`apply()`・`add()`・`discard()` は `undefined` を返します。

## 機能・選択・表示の設定

`features`、`selection`、`ui`、`view` は任意のpropsです。編集可能な状態ですべて省略すると、全機能・複数選択・チェックボックス・全8表示形式を使います。指定していない項目も既定値を維持します。読み取り専用では、上の表にある変更操作をまとめて止めます。

```tsx
import type { ExplorerOptions } from "@/components/explorer";

const explorerOptions = {
  features: { favorites: false, copy: false, move: true, download: false },
  selection: { mode: "multiple", checkboxes: false },
  ui: { thumbnails: false },
  view: { allowedModes: ["details", "large"], defaultMode: "details" },
} satisfies ExplorerOptions;

// 導入ガイドのFileManager内で、既存のpropsと合わせて指定します。
<Explorer
  {...explorerOptions}
  initialEntries={savedEntries}
  onSave={({ entries }) => { setSavedEntries(entries); return entries; }}
/>
```

[導入ガイドのFileManager](./getting-started.md#app-routerで使う最小例)に設定を追加する例です。

| prop / 公開型 | 設定内容 |
| --- | --- |
| `features: ExplorerFeatures` | 下表の機能をbooleanで指定。`false` は関連UIをすべて非表示にし、ショートカットやドラッグなどの実行経路も止めます。 |
| `selection: ExplorerSelectionOptions` | `mode` は `"none"` / `"single"` / `"multiple"`（既定）。`checkboxes` は選択チェックボックスの表示（既定 `true`）。 |
| `ui: ExplorerUIOptions` | `sidebar`、`contextMenu`、`rowActions`、`thumbnails` の表示を指定。既定はすべて `true`。機能自体の可否とは別です。 |
| `view: ExplorerViewOptions` | `allowedModes` で使える表示形式、`defaultMode` で新しいタブの初期表示を指定します。 |

| `features` の項目 | 対象 |
| --- | --- |
| `favorites` / `recent` | お気に入りの操作・表示 / 最近更新した項目 |
| `createFile` | 手動での0バイトの空ファイル作成。既定 `true`。アップロード機能とは独立します。 |
| `createFolder` | 手動での空フォルダ作成 |
| `uploadFiles` / `uploadFolders` | ローカルファイルの追加 / フォルダの階層付き追加。OSからの貼り付けも、それぞれ対象の機能に従います。保存先への送信は引き続き親の `onSave` が担当します。 |
| `copy` / `move` | コピー / 移動。メニュー、クリップボード、ドラッグの各経路に適用します。 |
| `rename` / `delete` | 名前変更 / 削除 |
| `preview` / `download` / `details` | ファイルプレビュー / ファイル・フォルダZIPのダウンロード / 詳細情報 |
| `search` / `sort` | 内蔵・外部検索 / 並べ替え。外部検索中は返却順を保つため並べ替えUIを隠します。 |
| `tabs` / `pathInput` | 複数タブ / パスの文字入力。パス入力を隠してもパンくずによる移動は使えます。 |
| `detachTabs` | タブを別ウィンドウへ切り離す操作。`tabs` も有効で、操作元のウィンドウにタブが2つ以上あるときに使えます。子ウィンドウからも切り離せます。 |
| `resizeSidebar` | ツリーと一覧の間のグリップによるサイドバー幅変更。`ui.sidebar` も有効なときに使えます。 |

`copy: false, move: true` では、コピーとコピー先選択を消し、切り取り・移動先選択・移動を残します。貼り付け専用のflagはありません。内部の貼り付けはクリップボードがコピーか移動かに応じて、対応する機能の可否を判定します。OSからの貼り付けは独立した追加操作で、内容に応じて `uploadFiles` / `uploadFolders` に従います。コピーが無効なときのCtrlドラッグを移動に置き換えることもありません。

`selection.checkboxes: false` はチェックボックスだけを隠し、複数選択は維持します。`mode: "single"` はCtrl・Shift・全選択を含めて選択を最大1件に制限し、`mode: "none"` は選択自体を行いません。選択方式の型 `ExplorerSelectionMode` も公開しています。

名前変更は一覧内で行います。既定では1項目を選択してからもう一度クリックするか、右クリックの「名前を変更」、ツールバー、F2で編集を開始します。`previewTrigger="click"` のファイル名クリックではプレビューを優先するため、名前変更にはF2やメニューを使えます。ファイルは拡張子を除いた本体だけを編集し、元の拡張子は変更できない文字として表示します。1行表示では入力欄の隣、複数行表示では入力欄の下に添えます。例えば `Report.PDF` は `Report` を編集し、確定時に元の `.PDF` をそのまま結合します。拡張子は最後のピリオドから末尾までを扱い、`.env` のように先頭のピリオドしかない名前は拡張子なしです。拡張子のないファイルに `README.pdf` のような拡張子を追加しようとするとエラーになります。フォルダは名前全体を編集できます。

中・大・特大アイコンでは、編集欄も長い名前を折り返し、内容に合わせて高さを調整します。編集欄は元の名前の位置に重ねるため、後続の段は移動しません。折り返しは表示上のもので、名前に改行は追加しません。Enterまたは入力欄の外へフォーカスを移すと確定し、Escで取消します。不正な名前や同名の項目がある場合は編集欄にエラーを表示します。確定後も保存するまではクライアント内の下書きです。`features.rename: false` ですべての開始経路を無効にできます。拡張子の固定は名前変更UIの仕様で、親が `useExplorerDraft().apply({ action: "rename", name: ... })` を使う場合は従来どおりファイル名全体を渡します。

`ui` は表示設定です。右クリックメニューを隠しても、ツールバー等に別の入口がある操作は使えます。空ファイル作成のメニューを利用するには `ui.contextMenu` を有効にします。`thumbnails: false` は画像のサムネイルをアイコンに替える設定で、プレビューダイアログの可否は `features.preview` で指定します。

表示形式の型 `ExplorerViewMode` は `"extra-large"`、`"large"`、`"medium"`、`"small"`、`"list"`、`"details"`、`"tiles"`、`"content"` のいずれかです。`view.allowedModes` は1種類以上の非空tupleで、`defaultMode` はその中から選びます。不正な組み合わせはエラーになります。`defaultMode` を省略すると、許可されていれば `"details"`、なければ配列の先頭を使います。1種類だけなら表示形式の切替UIを隠します。

詳細表示は「名前」「更新日時」「拡張子」「サイズ」の順で並べます。拡張子は小文字・先頭の点なしで、フォルダや拡張子のないファイルは空欄です。列見出しとツールバーから拡張子順でも並べ替えられます。「最近更新した項目」は更新日時の降順を保ち、並べ替え操作を無効にして、名前の下の親フォルダ名を隠します。その一覧内の内蔵検索にも適用し、通常の検索やお気に入りでは場所の補足表示を維持します。外部検索中の順番は `onSearchRequest` の返却順を優先します。

これらのpropsはマウント後の変更も反映します。機能を無効にしても、編集中のファイルや既存のメタデータを削除しません。保存・変更の破棄は引き続き利用できます。`ExplorerOptions` は4つの設定propsをまとめた公開型です。各型はすべて公開入口からimportできます。

`preview` と `download` は独立しています。ダウンロードを無効にするとExplorerのダウンロードボタンと案内を隠し、プレビューだけを残せます。これはExplorer内の操作設定で、ストレージのアクセス権限を設定するものではありません。

内蔵プレビューはテキスト（1 MiBまで）、CSV/TSV（200行・50列・合計10,000セルまで、各セル2,000文字まで）、PNG・JPEG・GIF・WebP・AVIF・BMP、PDF、MP4/WebMに対応します。SVGは画像として描画せず、ソースをテキスト表示します。画像のプレビューは `features.preview`、一覧の画像サムネイルは `ui.thumbnails` で独立して制御できます。PDFはブラウザーのiframeで表示します。Excel・Word・PowerPoint（`xlsx` / `xls` / `docx` / `doc` / `pptx` / `ppt`）の内蔵プレビューは未対応です。ダウンロードが有効な場合は、取得して対応アプリで開けます。

## サイドバーの幅を変える

`features.resizeSidebar` は既定で `true` です。ツリーと一覧の間にある縦グリップをマウス・タッチでドラッグします。既定幅は208px、通常の範囲は160〜400pxです。コンポーネントの幅が狭くなる場合は、一覧用に320pxを確保するよう上限を下げます。コンポーネント幅720px未満のモバイル用重ね表示ではグリップを隠し、ナビゲーションは従来の既定幅を使います。

グリップはフォーカス可能な縦の `separator` です。左右キーで10px、Shift＋左右キーで50px、Home/Endで最小/最大の幅に変えられます。ダブルクリックで208pxへ戻します。幅はそのウィンドウ内で保持し、ストレージへの保存対象にはしません。

`features.resizeSidebar: false` にするとグリップと操作を無効にし、幅も既定へ戻します。`ui.sidebar: false` の場合はサイドバーとグリップの両方を表示しません。例えば、切り離しと幅変更だけを無効にする設定は次のとおりです。ほかの機能の既定値は変わりません。

```tsx
<Explorer
  initialEntries={savedEntries}
  onSave={save}
  features={{ detachTabs: false, resizeSidebar: false }}
/>
```

<a id="keyboard-shortcuts"></a>

## キーボードショートカット

Explorer内にフォーカスがあるときに使えます。ツールバーのヒント、右クリックメニュー、ヘルプの表示は同じ定義を使います。Windows/LinuxではCtrl、Macでは⌘を使う操作は「Ctrl / ⌘」と併記します。

| 操作 | キー | 条件 |
| --- | --- | --- |
| 保存 | Ctrl / ⌘ + S | 編集可能なとき。保存ボタンと同じ条件で実行します。 |
| 最新の一覧に更新 | F5 | `onRefresh` があるとき。未保存なら確認してから読み込みます。 |
| 検索欄へ移動 | Ctrl / ⌘ + F または K | `features.search` |
| すべて選択 | Ctrl / ⌘ + A | `selection.mode: "multiple"` |
| コピー / 切り取り | Ctrl / ⌘ + C / X | 項目を選択し、`features.copy` / `features.move` が有効 |
| 貼り付け | Ctrl / ⌘ + V | 内部操作は `copy` / `move`、OSからの追加は `uploadFiles` / `uploadFolders` に従います。 |
| 名前を変更 | F2 | 1項目を選択し、`features.rename` が有効 |
| 削除の確認を開く | Delete / ⌘ + Backspace | 項目を選択し、`features.delete` が有効 |
| ファイル・フォルダを開く | Enter / Space | 項目にフォーカス、または一覧の1項目を選択。ファイルは `features.preview` が必要 |
| 選択と内部クリップボードを解除 | Esc | 一覧の操作中 |
| 上のフォルダ / 履歴を戻る / 進む | Alt + ↑ / ← / → | Explorer内の移動 |

項目にフォーカスした状態の↑↓で前後の項目へ移動します。タブにフォーカスした状態では←→・Home・Endでタブを切り替えます。幅変更グリップでは←→で10px、Shift + ←→で50pxずつ調整し、Home / Endで最小 / 最大幅にします。

入力欄・名前変更中・IME変換中・メニューやダイアログが開いている間は、一覧のショートカットを実行しません。入力中のCtrl / ⌘ + A・C・X・Vは通常の文字編集に使えます。変換中のEnter / Escで名前やパスを意図せず確定・取消しないようにしています。定義にない追加の修飾キーを押した組み合わせも実行しません。`features`・読み取り専用・保存中・更新中などの操作制限は、マウス操作と同様に適用します。

Ctrl / ⌘ + R・L・T・Wなどブラウザーのショートカットは奪いません。F5も `onRefresh` がない場合や、Explorer外・入力欄・ダイアログにフォーカスがある場合はブラウザー側の動作を維持します。コピー・切り取り・貼り付けはブラウザー標準のクリップボードイベントを使い、OSファイルの貼り付けと二重実行しません。
