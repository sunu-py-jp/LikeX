# 表示中のLikeTextEditorの制御

この参照はReactコンポーネントへ組み込む場合に使う。UIなしのCLIは表示状態や編集許可を管理しない。型とAPIは `@likex/texteditor` の公開入口からimportし、内部ファイルへ依存しない。

## モードと操作の選択

`mode` propは `auto` / `text` / `markdown` / `json` / `xml` / `yaml`。省略時はauto。明示したmode、対応する具体的な `mimeType`、`fileName`（未指定時はtitle prop）の拡張子、モデルmode、textの順で表示形式を選ぶ。`text/plain`・`application/octet-stream`などは拡張子の判定を妨げない。JSON/XML/YAMLは閲覧専用でも色分けする。本文の内容から形式を推測しない。`formatting` は省略／falseで無効、trueまたは `{ indent?: number }` で整形表示を有効にする。indentは1〜8の整数、既定2。既存モデルだけを渡す場合は、そのmodeを尊重し、モデルtitleから表示形式を再判別しない。文章表示・整形表示の切り替えは `initialViewMode` とrefの `setViewMode("rich" | "source" | "formatted")`、ソースの折り返しは `initialWordWrap` と `setWordWrap(boolean)` で指定する。これらは表示設定で、本文を変換しない。モデルのmodeを保存する操作は `document.update`。

refの `execute(commands)` はモデルへ反映した結果を待ち、モデルまたはnullを返す。`runCommand(action)` は現在のカーソルを使った操作の受付可否を返すため、非同期の編集許可や保存の完了を示す値と混同しない。自動的なデータ編集には `execute` を使う。

`features` は `editing`・`history`・`import`・`export`・`search`・`replace`・`formatting`・`validation`・`save`・`refresh` の10キーで、未指定は有効。GUI・ショートカット・ref API・履歴の再適用に共通で適用する。`replace: false` は検索による置換、`formatting: false` はMarkdownの書式操作、JSON/XML/YAMLの整形表示と `text.format` を制限する。Markdownの文章表示への切り替えは残す。`validation: false` はJSON/XML/YAMLの構文診断を無効にする。通常の本文入力を禁止するにはeditingまたはreadOnlyを使う。純粋モデルAPI・CLIの権限制御は利用側で行う。

## 整形表示と構文診断

`formatting` が有効で原文と整形結果に差分がある場合は、既定でformatted表示を開き、目／`</>` のトグルで切り替える。表示開始時に差分がない場合はトグルを表示しない。原文を最初に見せる場合は `initialViewMode: "source"`、外から切り替える場合は `setViewMode("formatted")` を使う。auto判定されたJSON/XML/YAMLにも適用する。

切り替えだけではモデル、dirty、履歴を変更しない。整形側も編集でき、最初に編集した時点で整形済みの表示文字列への編集結果を通常の権限・履歴経路でモデルへ反映する。最初の編集をUndoすれば整形前へ戻る。編集中は毎キー再整形しない。readOnlyや編集不可の制御は原文表示と同じ。本文を明示的に整形する `ref.execute({ type: "text.format" })` は保存モデルのmodeを使う。表示modeが異なる場合は `mode: ref.getState().mode` を明示する。auto判別によるJSON表示でも、保存modeがtextならmode省略のコマンドは整形しない。

`getSelection()` の `coordinateSpace: "formatted"` は整形表示中の位置。元本文の `source` 座標と混同しない。外部検索・ホスト検索が返す原文の結果へ移動する場合はsourceへ切り替える。標準の検索・置換・goToLineは整形表示中の文字列を対象にし、formattedを維持する。

JSON/XML/YAMLの構文診断は整形表示が無効でも有効で、下部へ赤字でエラーの説明と行・列を表示する。`getDiagnostics()` で `{ from, to, line, column, message }[]` を取得する。from/toは表示中の文字列の0始まりUTF-16位置、line/columnは1始まり。`getState().viewMode` がformattedなら整形後の文字列の位置。原文の診断が必要な場合は `validateTextEditorSource(ref.getText(), { mode: ref.getState().mode })` を使う。構文診断は保存の禁止条件ではない。必要なら利用側のonBeforeSaveで検証する。画面なしの診断は `validateTextEditorSource` を使う。

## 保存・編集許可・未保存保護

`onSave` を省略すると閲覧専用。`onSave(model, context)` / `onBeforeSave(model, context)`、`onEditRequest({ model }, context)`、`onRefresh(context)` のcontextには `requestId` / `signal` がある。通信へsignalを伝え、古い結果を再利用しない。

- `requestEdit()` は編集許可を確認する。通常入力でも自動的に確認するため事前呼び出しは任意。
- `getEditState()` は `view` / `requesting` / `edit`。`cancelEditRequest()` は許可待ちだけを中止する。
- `endEdit()` は未保存変更・未確定入力・処理中の状態があるとfalse。変更を消さない。
- `discard()` は最後の保存または再読み込みに戻し、未確定入力とUndo／Redo履歴を消す。
- `refresh()` はonRefreshから取得して検証した文書を保存済みの基準にし、履歴を消す。失敗時は元の文書・基準・履歴を保つ。閲覧専用でも実行可能。
- `cancelPending()` は許可・保存・再読み込み・検索などを中止し、遅れた結果を反映しない。通信先で完了した保存を取り消す操作ではない。

`getState().dirty` と `onDirtyChange` は保存済みモデルとの差分。`hasUnsavedChanges` と `onUnsavedChangesChange` は許可待ちなどの未確定入力も含む。`pendingInput` はその入力がある状態。独自ウィンドウの閉じる処理やSPA移動の確認にはhasUnsavedChangesを使う。ブラウザー離脱警告は `warnOnUnsavedChanges` で指定し、既定はtrue。

未保存変更がある場合、`replace` / `importFile` / `document.replace` を含む `execute` / `refresh` は既定で拒否する。利用側で保存・破棄を決めた後に必要な場合だけ指定する。

```ts
await editor.current?.replace(nextDocument, { discardChanges: true });
await editor.current?.importFile(file, { mode: "markdown", discardChanges: true });
await editor.current?.execute(
  { type: "document.replace", document: nextDocument },
  { discardChanges: true },
);
await editor.current?.refresh({ discardChanges: true });
```

この指定は編集許可・機能設定・処理中の制限を迂回しない。通常のtext編集コマンドには差し替え確認を要求しない。replace/importはUndo対象であり、refreshとは保存済みの基準の扱いが異なる。

## 検索の制御

`initialSearchOpen` / `initialSearchQuery` / `initialSearchMode`（local/external）は初回のみ。`openSearch(query?)` は検索を開き、query省略で以前の値を維持、空文字で消去する。キーワード上限4,096 UTF-16単位。`setSearch` は各オプションや置換欄も設定する。標準ソース検索の条件はMarkdownのrich/source切り替えを越えて保持する。

`externalSearch` は `{ title?, results, initialResultId?, onResultSelect? }`。各結果は `{ id, target: { from, to }, title?, snippet?, locationLabel? }`。targetは元本文のUTF-16位置であり、Markdownの文章表示や整形表示の位置ではない。結果を選ぶとソース表示へ切り替える。結果は順位を保ち、`openExternalSearch(resultId?)` または初期設定で開く。結果のタイトルをキーワード欄へ入れない。文書編集後の位置・結果の更新は利用側が担当する。

`onSearchRequest({ document, query, params }, { signal, requestId })` で通常検索をホストへ委譲できる。queryは `TextEditorSearchOptions`、返却は `TextEditorSearchResult[]`。追加条件は `searchParams` に渡し、条件変更時は新しいオブジェクトにする。空の検索語は検索せず、変更・閉じる・中止後に返った古い結果は適用しない。

外部結果・ホスト検索の結果は移動専用。置換は標準のソース検索へ切り替えて実行し、意味検索の範囲を無条件に置き換えない。`renderSearch(context)` で見た目を差し替えられる。contextのresults/busy/errorを表示し、`setQuery` / `selectResult` / `next` / `previous` / `close` を使う。renderSearchだけを指定した通常検索はモデル側のRE2、標準ソースパネルはJavaScript形式なので正規表現の互換性を仮定しない。

`getSearchPanelState()` は呼び出した時点の `TextEditorSearchRenderContext` を取得する。resultsは外部・ホスト・カスタム表示の検索結果で、標準ソースパネルの一致一覧は複製せず空配列にする。標準パネルの条件取得は `getSearch()`、本文の一致範囲の取得は `find()` を使い分ける。

## パネル

`getOpenPanels()` は `search` / `goToLine` / `commandPalette` / `link` / `blocks` の開いている種類を返す。`closePanel(name)` と `closePanels()` で閉じ、`onPanelsChange` で画面操作も含む開閉を受け取る。

検索は `openSearch` / `openExternalSearch`、コマンド一覧と行移動は `runCommand("commandPalette" | "goToLine")`、リンク入力はrich表示で文字を選択して `runCommand("markdown.link")`、ブロックメニューは段落で `/`。引数付きの `goToLine(line, column?)` は直接移動する操作で、入力パネルを開く操作ではない。ビュー全体をダイアログとして表示する責務は親アプリにある。

`getState().mode` は判別後の具体的なモード。表示propsの変更はモデルmodeを自動更新しない。保存するmodeを変更する場合は `document.update` を使う。`importFile` は `File.name`・`Blob.type`、またはoptionsの `fileName`・`mimeType` を使って判別し、判別不可ならtextを使う（前の文書のmodeを引き継がない）。出力本文は現在の形式の拡張子とMIMEを持ち、元文字列の空白・改行を維持する。
