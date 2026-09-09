# 共通基盤

`@likex/core` はコンポーネントと親アプリの接続に使う型・ヘルパーの共通基盤です。保存先、認証、サーバーロック、データモデル、Reactの状態は持ちません。Providerの追加や抽象クラスの継承も不要です。

| 共通部分 | 役割 |
| --- | --- |
| `MaybePromise` / `SaveHandler` / `RefreshHandler` / `RequestHandler` | 同期・非同期のホスト処理と、必要に応じた `requestId` / `AbortSignal` |
| `EditMode` / `EditPermission` / `EditRequestHandler` | 閲覧・許可待ち・編集の意味と編集許可の形式 |
| `EventHandler` / `notifyHost` | 保存や変更の観測通知。通知の失敗は操作結果を取り消さない |
| `FeatureFlags` / `resolveFeatureFlags` | 指定されない設定はデフォルトを使い、`false` は機能を無効化 |
| `chainResult` / `isPromiseLike` | 同期処理の即時性を保ち、必要なときだけPromiseを待つ |
| `createUnsavedChangesGuard` | dirty時だけウィンドウのネイティブ離脱確認を登録 |

固有の型はコンポーネント側に残します。ExplorerはファイルID・一覧・差分、Spreadsheetはシート・セル・ワークブックを受け渡します。保存や操作イベントを巨大な共通unionにまとめません。例えば編集許可後の新しい初期データは `EditPermission<Entries, "entries">` と `EditPermission<Workbook, "workbook">` で同じ規則を使います。

観測用の `onEvent` と、結果を待つ `onSave` / `onEditRequest` は役割が異なります。前者の例外は操作を失敗させません。後者の結果やエラーはコンポーネントが検証・反映します。ライフサイクルの詳細と各イベントは各モジュールのガイドを参照してください。

## パッケージとコピー導入

```text
packages/core/src/                  共通処理の実装
  contracts.ts                      共通の型
  notifications.ts / features.ts     通知・機能設定
  async.ts / unsaved-changes.ts      非同期の接続・離脱確認
packages/explorer/src/core.ts        export * from "@likex/core"
packages/spreadsheet/src/core.ts     export * from "@likex/core"
```

各UIは通常のnpm依存として `@likex/core` を使います。利用先に共通Providerや継承階層を追加する必要はありません。tarball配布ではcoreとUIの両ファイルを `npm install` に渡します。レジストリ公開後は通常の依存解決に従います。

コピー導入は次の3手順です。

1. `packages/core/src/` を利用先の `components/core/` へコピーする。
2. UIの `src/` を `components/explorer/` または `components/spreadsheet/` へコピーする。
3. UIフォルダの `core.ts` の1行を `export * from "../core";` に変更する。

coreは両UIで1つを共有できます。コピー後も元の `@likex/core` に依存させる選択は可能ですが、上記手順ではLikeXパッケージのインストールは不要です。Reactなどの外部依存とUIのCSS読み込みは引き続き必要です。共通実装の自動複製・生成確認・特殊なパス解決は行いません。

`build:library` / `pack:library` は依存順にcoreを先に処理します。UIの `test` / `typecheck` もcoreのビルドから開始します。導入検証は、coreとUIの両tarballからの依存解決と、上記3手順によるソースコピーを実際に検証します。

`@likex/core` 単体も依存なしのESMパッケージとしてビルド・pack・Nodeインポート・strict型検証・ソースコピーを確認します。UIのない基盤なのでCSSやNext.jsページの検証は対象外です。ExplorerとSpreadsheetのNext.js・CSS・コピー導入検証は引き続き実行します。
