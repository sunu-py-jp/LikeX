# 共通基盤

`@likex/core` はコンポーネントと親アプリの接続に使う型・ヘルパーの共通基盤です。保存先、認証、サーバーロック、データモデル、Reactの状態は持ちません。Providerの追加や抽象クラスの継承も不要です。

機能別のAPIと利用例は、[Coreの導入](../packages/core/docs/getting-started.md)、[保存・編集許可](../packages/core/docs/host-contracts.md)、[通知・機能設定](../packages/core/docs/events-and-features.md)、[右クリックの非同期処理](../packages/core/docs/context-menu.md)、[離脱確認](../packages/core/docs/unsaved-changes.md)、[ZIPの生成](../packages/core/docs/zip.md)、[JSONの固定書式](../packages/core/docs/stable-json.md)を参照してください。

| 共通部分 | 役割 |
| --- | --- |
| `MaybePromise` / `SaveHandler` / `RefreshHandler` / `RequestHandler` | 同期・非同期のホスト処理と、必要に応じた `requestId` / `AbortSignal` |
| `EditMode` / `EditPermission` / `EditRequestHandler` | 閲覧・許可待ち・編集の意味と編集許可の形式 |
| `EventHandler` / `notifyHost` | 保存や変更の観測通知。通知の失敗は操作結果を取り消さない |
| `FeatureFlags` / `resolveFeatureFlags` | 指定されない設定はデフォルトを使い、`false` は機能を無効化 |
| `chainResult` / `isPromiseLike` | 同期処理の即時性を保ち、必要なときだけPromiseを待つ |
| `createUnsavedChangesGuard` | dirty時だけウィンドウのネイティブ離脱確認を登録 |
| `serializeStableJson` | 順序・インデントを固定してJSONを出力。ネイティブ文書では各モジュールのserialize APIから利用 |
| `createZipArchive` | パス検証・CRC32・UTF-8・無圧縮ZIPの組み立て。ファイル取得・ツリー列挙・ファイル形式の生成は各利用側が担当 |
| `ContextMenuProvider` / `ContextMenuItem` / `ContextMenuResult` | 条件付きのメニュー項目と、親が準備する変更計画 |
| `createContextMenuExecutor` | 変更計画の準備・確認・反映・キャンセルを管理する。データ変更と描画は各UIへ委譲 |
| `openContextMenu` | ブラウザーで共通メニューを表示。通常の入口と `/browser` で同じ実装を共有し、import時にDOMへアクセスしない |

固有の型はコンポーネント側に残します。ExplorerはファイルID・一覧・差分、Spreadsheetはシート・セル・ワークブックを受け渡します。保存や操作イベントを巨大な共通unionにまとめません。例えば編集許可後の新しい初期データは `EditPermission<Entries, "entries">` と `EditPermission<Workbook, "workbook">` で同じ規則を使います。

観測用の `onEvent` と、結果を待つ `onSave` / `onEditRequest` は役割が異なります。前者の例外は操作を失敗させません。後者の結果やエラーはコンポーネントが検証・反映します。ライフサイクルの詳細と各イベントは各モジュールのガイドを参照してください。

## 条件付きメニューの実行

メニュー定義は `ContextMenuProvider<TContext, TChange, TIcon>` です。Coreはファイル・セル・Reactの型を知らず、各UIが型引数を具体化します。条件判定はメニューを開く際の同期処理、時間がかかる処理は利用者が項目を選んだ後に行います。

ホストの `onSelect(context, operation)` は変更済みデータではなく `{ change, description? }` を返します。Executorはその計画を `prepareChange` で隔離し、対象の妥当性を検証してからUIの反映処理に渡します。`undefined` は外部処理だけでローカル変更がないことを表します。親の入力ダイアログを中止した場合は `DOMException` の `AbortError` をthrowすると `cancelled` として終了します。メニューを閉じたこと自体では、開始した処理をキャンセルしません。

| `contextMenuExecutionMode` | 準備中のローカル変更 | 結果の反映 |
| --- | --- | --- |
| `block`（既定） | 禁止。閲覧は可能 | 開始時のデータと対象が維持されていれば反映 |
| `confirm` | 許可 | 反映内容を確認してから反映。消失・構造変更で対象を特定できない場合は中止 |
| `reject-if-changed` | 許可 | データが開始時から変わっていたら中止 |

反映中はどのモードでも他の変更を禁止します。Coreの `blocksChanges` を、各UIが共有ドラフト・操作APIのガードへ接続します。反映を開始した処理にだけ内部の所有者トークンを渡すため、結果の反映まで自分でブロックすることはありません。

`apply` に渡す `isCurrent()` は、非同期の編集許可や上書き確認の後、実際にコミットする直前にも確認します。`confirm` では確認時の基準、他のモードでは開始時の基準と比較します。座標などの固有の妥当性は `validateTarget` で検証します。`getRevision` は不変スナップショットの同一参照または単調増加する番号を返し、毎回作り直すコピーを渡してはいけません。

Executorはコンポーネントのデータもサーバーのロックも管理しません。別ユーザーの競合は親の保存処理・バージョン条件・編集許可で扱います。実行終了・キャンセル時には `AbortSignal` をabortし、キャンセルされた処理の遅い応答は適用しません。`onEvent` には `type: "context-menu"` と `start / confirmation-required / success / cancelled / error` を通知します。

組み込み側はアンマウント時に `cancel()` を呼び、アンマウント後の `canRun` をfalseにします。`dispose()` は再使用できない終了処理なので、React StrictModeなどで再接続されるインスタンスには使いません。メニューの表示・フォーカス・確認ダイアログは各UIの責務です。

## パッケージとコピー導入

```text
packages/core/src/                  共通処理の実装
  contracts.ts                      共通の型
  notifications.ts / features.ts     通知・機能設定
  async.ts / unsaved-changes.ts      非同期の接続・離脱確認
packages/explorer/src/core.ts        export * from "@likex/core"
packages/spreadsheet/src/core.ts     export * from "@likex/core"
packages/slide/src/core.ts           export * from "@likex/core"
packages/document/src/core.ts        export * from "@likex/core"
```

各UIは通常のnpm依存として `@likex/core` を使います。利用先に共通Providerや継承階層を追加する必要はありません。tarball配布ではcoreとUIの両ファイルを `npm install` に渡します。レジストリ公開後は通常の依存解決に従います。

コピー導入は次の3手順です。

1. `packages/core/src/` を利用先の `components/core/` へコピーする。
2. UIの `src/` を隣接する `components/<module>/` へコピーする。
3. UIフォルダの `core.ts` を `export * from "../core";` に変更する。

Spreadsheet・LikeSlide・LikeDocumentで変更するCoreの参照は `core.ts` の1か所だけです。`ooxml.ts`・`json.ts`・`model/core-*.ts` と、LikeSlide・LikeDocumentの `browser.ts` は内部でこの入口を参照します。既存のコピーは利用するUIとCoreを同じバージョンから一緒に更新し、以前に書き換えたこれらのファイルもコピーし直してください。他のモジュールで変更する追加の入口は、[Explorerの導入ガイド](../packages/explorer/src/docs/README.md)など各モジュールの手順に従ってください。

coreは複数のUIで1つを共有できます。コピー後も元の `@likex/core` に依存させる選択は可能ですが、上記手順ではLikeXパッケージのインストールは不要です。Coreの実行時依存 `re2js@2.8.6`、React、LikeDocumentのProseMirrorなどの外部依存とUIのCSS読み込みは引き続き必要です。共通実装の自動複製・生成確認・特殊なパス解決は行いません。

`build:library` / `pack:library` は依存順にcoreを先に処理します。UIの `test` / `typecheck` もcoreのビルドから開始します。導入検証は、coreとUIの両tarballからの依存解決と、上記3手順によるソースコピーを実際に検証します。

`@likex/core` 単体もReactに依存せず、import時にDOMを使わないESMパッケージとしてビルド・pack・Nodeインポート・strict型検証・ソースコピーを確認します。`openContextMenu` の実行にはDOMが必要です。CoreのCSSやNext.jsページの検証は対象外です。各UIのNext.js・CSS・コピー導入検証は引き続き実行します。

## 文字列検索

`@likex/core` と `@likex/core/text-search` の両方から、`createTextSearchMatcher` と `TextSearchMatcher` / `TextSearchQuery` 型を利用できます。`createTextSearchMatcher({ text, matchCase?, wholeText?, useRegex? })` は、部分一致・全体一致・大文字小文字の区別・正規表現を共通化します。返り値の `test(text)` と `replace(text, replacement)` は繰り返し呼べ、置換後の文字列は `$1` 等もリテラルとして扱います。空の検索語は一致せず、置換も行いません。

通常文字列は100,000文字、正規表現は4,096文字までです。コンパイル前に繰り返しの展開コストを20,000命令相当までに制限し、短い式でも巨大なグループの繰り返しはエラーにします。独立した繰り返しや選択肢のコストは足し合わせ、入れ子やグループに付く回数だけを掛け合わせます。コンパイル後も命令数を検証します。正規表現は [RE2JS](https://github.com/le0pard/re2js) のRE2形式で、グループ・選択・量指定・文字クラス・アンカー・Unicode文字クラスに対応し、先読み・後読み・後方参照には対応しません。不正な構文・未対応構文・過大なパターンは例外になり、UI側でエラーとして表示します。バックトラッキングにより指数時間を要するJavaScriptの正規表現を、未検証の検索語から直接実行しません。標準の検索条件は表示状態で、OfficeやLikeXの保存ファイルには書き込みません。

ソースコピー導入ではcoreの依存 `re2js@2.8.6` をインストールします。Explorerは `model/core-text-search.ts` を `export * from "../../core/text-search";` に変更します。Spreadsheetは `core.ts` を経由するため、このファイルの変更は不要です。
