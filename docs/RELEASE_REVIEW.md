# LikeXの公開前レビュー

2026年9月7日、LikeXのworkspace構成への移行と、生成済みCSSの配布対応後に実施した検証です。デモ・テスト・配布の担当を分け、代表が依存境界・生成物・README・ブラウザ表示の整合性を確認しました。

## 今回の対応範囲

| ティア | 対象 | 対応 |
| --- | --- | --- |
| 今回対応 | 独立した配布単位 | Explorerを packages/explorer に配置し、実装・テスト・配布設定をまとめました。npm名は @likex/explorer です。 |
| 今回対応 | 不要な実行基盤 | 旧API・D1 / R2・DBマイグレーション・Cloudflare Worker・Vinext・ホスティング設定を削除しました。デモは apps/playground のVite + Reactに統一しました。 |
| 今回対応 | コピー導入の維持 | パッケージとコピーの原本をsrcに統一。type-onlyを含むimport境界を検査し、他のLikeXモジュールやアプリのaliasに依存させません。 |
| 今回対応 | ビルド・検証の共通化 | 依存の解決、型・CSS・SSR・Next本番ビルドの検証を共通化しました。READMEも同じ原本をコピーとtarballに同梱します。 |
| 維持 | 開発用Tailwindと公開API | 開発ではTailwind v4を使い続け、UI、データ型、下書き・保存・親コールバックの契約を維持しました。 |
| 今回対応 | CSSの生成済み配布 | 生成済みCSSをパッケージとコピー用フォルダへ同梱。利用側のTailwindと専用PostCSS設定を不要にし、スタイルをExplorerの範囲へ限定しました。 |
| 将来必要時 | 別モジュール・大規模処理 | Spreadsheetの実装、共有ランタイム、サーバーページング等は実際の要件が出た時点で追加します。 |

## 命名と責務の整理

ファイル名・型名・関数名が実際の役割を説明できるよう、次を変更しました。コンポーネントのprops名、保存データの形、操作の挙動は維持しています。

| 変更前 | 変更後 | 理由 |
| --- | --- | --- |
| `types.ts` / `state/types.ts` | `props.ts` / `state/view-state.ts` | 利用側が渡す引数と、内部の場所・ダイアログ・クリップボード状態を区別。内部型も `ExplorerLocation` / `ExplorerDialogState` / `ExplorerClipboardState` とし、DOM標準型との混同を避けます。 |
| `ui/explorer-ui.tsx` / `Tool` | `ui/explorer-controls.tsx` / `ExplorerIconButton` | 共通コントロールとツールチップ付きアイコンボタンであることを明示。 |
| `ui/explorer-tree.tsx` / `ExplorerTree` | `ui/explorer-sidebar.tsx` / `ExplorerSidebar` | ツリーだけでなく、場所のナビゲーションと容量表示を含む左側全体を扱うため。 |
| `ui/explorer-environment.tsx` | `ui/explorer-dom-context.tsx` | アプリの実行環境全般ではなく、DocumentとPortal先を共有するため。型・context・hookもDOMを表す名前へ統一。 |
| `ui/explorer-toolbar.tsx` | `ui/explorer-header.tsx` / `ui/explorer-status-bar.tsx` | タブ・アドレス・検索を含むヘッダーと、項目数・状態を表示するフッターを別部品に分離。 |
| `model/preview.ts` の共通情報 | `model/item-info.ts` | 保存・編集・ダウンロード・アイコンも使う `ExplorerItemInfo` と情報生成を共通ファイルへ移し、プレビュー専用の定義だけを残します。 |
| `validName` / `pathOf` / `stamp` / `descendants` | `normalizeEntryName` / `getEntryPath` / `formatEntryDate` / `subtreeEntries` | 名前の正規化と検証、Entry配列の取得、日付表示、本人を含む部分ツリー取得という実際の戻り値・処理に合わせます。 |
| 公開型 `FileReader` / `SaveHandler` / `RefreshHandler` | `ExplorerFileReader` / `ExplorerSaveHandler` / `ExplorerRefreshHandler` | ブラウザのFileReaderや利用アプリ固有のハンドラーと紛らわしくならないよう、Explorer用の型であることを明示。 |

旧公開型3つと、旧モデル互換エクスポートで使われる関数4つは、同じ型・関数を指す `@deprecated` エイリアスを残しています。新しいコード・READMEは新名称を使います。内部ファイルの旧パスを維持するためだけの空ファイルは追加せず、公開入口 `index.ts` からのimportを維持しています。既存モデルテストは旧名の動作も検証し、配布型の利用先テストは新旧両方の公開型をimportします。

## 未保存確認とショートカット

直近のUI確認では、未保存変更の破棄・更新確認をExplorer領域の中央へ揃え、背景の暗転、Esc・背景クリックによるキャンセル、フォーカス復帰を実装しました。ショートカットは `model/keyboard.ts` に判定・表示・ARIA・IME保護を集約し、F5更新（`onRefresh` 指定時）とMacの⌘+Backspace削除を追加しています。保存中の確認、他ウィンドウの保存で失効した確認、更新失敗時の下書き保持もテストしています。


## 生成済みCSSの分離とブラウザ確認

原本はTSXとstyles/input.cssです。src/styles.cssはコピー用にGit管理しますが手編集せず、CSS生成・配布ビルド・playgroundの変更検知で作り直します。check:stylesが生成忘れを検出します。

クラスをlxe:で統一し、基礎スタイルとテーマの適用先をdata-likex-explorerに限定しました。内部のCSS変数・@property・keyframesも固有名にし、Tailwind標準のレイヤー順を保って生成します。TailwindのMITライセンスをCSSと配布物に保持しています。

新旧CSSのクラス比較で、一覧の状態クラスを返す関数の変換漏れを発見し、選択・hover・ドラッグ枠・切り取りの表示を修正しました。全表示モードの実際のクラスを検証する回帰テストを追加しました。

Tailwind未導入のNext本番アプリに、28pxの文字・24pxの余白・赤い枠のbutton/inputルールや、異なる意味の.flex/.h-8を追加して確認しました。外側のスタイルを維持し、Explorer内は14px・独自の配色と寸法を保持しています。ライト／ダークの同時配置、Portalメニュー、新規フォルダのダイアログも確認しました。デモでは切り取りのopacity 0.45と選択背景、メニューのテーマを実際の算出スタイルで確認しました。任意の高詳細度や!importantを持つCSSから完全に隔離する保証ではありません。

## 最終検証結果

macOS / Node.js 24.2.0 / npm 11.3.0で、一括検証 npm run check:release が成功しました。

| 検証 | 結果 |
| --- | --- |
| 自動テスト | Explorerの715件とCSS生成の8件、計723件成功。失敗・スキップ0件。クラスの上書き、全8表示形式の選択・切り取り・ドラッグ表示、CSSの適用範囲・名前空間・生成結果の一致を含みます。 |
| Lint・型チェック | ESLintエラー・警告0件。Explorerとplaygroundの型チェック成功。 |
| パッケージ | @likex/explorer 0.1.0のtarballを生成。ESMのuse client、59個の型宣言、依存・含有ファイル・SHA-512整合性を検証。JS 431,865 B、gzip 91,566 B（外部依存・CSSを除く）。CSSは76,928 B、gzip 9,615 B。 |
| パッケージの独立導入 | npmキャッシュから別プロジェクトへインストールし、作業用依存へのsymlink 0件。strict / NodeNext / skipLibCheck:falseで型検証、SSR、CSSの明示import、Next.js本番ビルドが成功。利用先にTailwind・プラグインを導入せず、本番HTMLが参照するCSSにExplorerのルールが残ることを確認。 |
| ソースコピーの独立導入 | 59個のTS/TSXと生成済みCSSをリポジトリ外へコピーし、LikeXパッケージを解決できないことを確認。依存へのsymlink 0件。strict / Bundler / skipLibCheck:false、aliasなしで型検証、SSR、CSSの明示import、Next.js本番ビルドが成功。利用先でCSSを生成せず、原本・dist・配布物のCSSのバイト一致も検証。 |
| Next.jsの検証構成 | Next.js 16.3.4、React / React DOM 19.2.8、TypeScript 5.9.3。利用先はTailwind未導入（ライブラリの生成用は4.3.3）。Server Componentからの利用と、Client Componentからコールバックを渡す例を確認。Next本番段階は標準のskipLibCheck:true、公開型は事前に厳密検証。 |
| デモ | Vite本番ビルド成功。5173で起動し、暗色テーマ・アイコン一覧・タブ追加・ルート移動・名前変更・保存・再取得を実ブラウザで確認。未保存ダイアログの中心と表示領域の中心の一致、Esc・背景クリックによる取消しも確認。検証用の名前変更を戻し、1タブのicons一覧へ復帰。 |
| 依存監査 | npm auditの全依存・本番依存とも検出0件。旧Vinext / Drizzle由来の監査項目は、その依存経路ごとの削除で解消しました。監査結果は検証時点の情報です。 |
| CI | Node.js 22 / 24のnpm ci、一括検証、本番依存監査、tarballと両導入レポート保存を定義。GitHub上のCI自体は未実行。 |
| 公開 | GitHub / npmへの公開は未実施。scope・公開先・ライセンスを確定するまでprivate / UNLICENSEDを維持。 |

デモの単一JSは約574 kB（gzip約175 kB）で、Vite標準の500 kB超の注意表示が残ります。ビルドは成功しています。これはReact等を含むデモ全体の値です。警告を隠す設定変更や、この構成整理だけを理由にしたコード分割は行っていません。

検証結果は artifacts/release-check.json、library-build.json、library-pack.json、package-consumer-report.json、copy-consumer-report.json、dependency-audit.json、dependency-audit-production.json に保存します。配布物は artifacts/likex-explorer-0.1.0.tgz です。これらはGit管理せず再生成する成果物です。

導入は [ExplorerのREADME](../packages/explorer/README.md)、構成の方針は [ARCHITECTURE.md](./ARCHITECTURE.md)、公開手順は [RELEASING.md](./RELEASING.md) を参照してください。
