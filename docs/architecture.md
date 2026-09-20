# LikeXのモジュール構成

npm workspacesで開発環境を共有し、UIの配布単位は `@likex/explorer`、`@likex/spreadsheet`、`@likex/slide` に分けます。リポジトリの名前はLikeX、npmの名前は小文字のscope付きにします。scopeの取得・公開先の設定は公開時に確認します。

## 責務

| 場所 | 責務 |
| --- | --- |
| `packages/<module>/src` | パッケージ配布・ソースコピーに使うモジュールの原本。公開入口、型、UI、状態管理、データ処理、利用ガイドを含みます。 |
| `packages/<module>/tests` | モジュールの振る舞いと公開型を検証します。利用先へは配布しません。 |
| `packages/<module>/package.json` | 配布する名前・公開入口・依存・バージョン・ライセンスを宣言します。 |
| `packages/core/src` | 保存・編集許可・通知・機能設定などの共通契約とヘルパーの唯一の編集元。 |
| `packages/{explorer,spreadsheet,slide}/src/core.ts` | `@likex/core` の公開入口を再export。コピー導入時は相対importに変更します。 |
| `packages/{spreadsheet,slide}/src/json.ts` | `@likex/core/json` の固定JSON出力への入口。コピー時は `../core/json` へ変更します。 |
| `packages/{spreadsheet,slide}/src/ooxml.ts` | `@likex/core/ooxml` のZIP・XML・参照関係処理の入口。コピー時はこちらも相対importへ変更します。 |
| `apps/playground` | サンプルデータとデモの保存先を持つ利用者側の例です。ライブラリには含めません。 |
| `scripts` | ビルド・型生成・配布物検査・導入検証をまとめます。 |
| `docs` | リポジトリ全体の方針、公開手順、レビュー記録を置きます。 |

各モジュールの `model` はReactの表示状態に依存しないデータ・検証・操作を担当し、`state` はReactの状態と親へのコールバックをつなぎ、`ui` は表示を担当します。公開入口の `index.ts` から利用し、内部ファイルのパスを利用側の契約にしません。Spreadsheetの数式はモデル内の限定した構文解析器で評価し、JavaScriptとして実行しません。

## ネイティブ保存形式

SpreadsheetとLikeSlideの標準保存ファイルは、次の拡張子を使うUTF-8の純粋なJSONです。ZIPなどのコンテナーや独自の構文は使いません。

| モジュール | 拡張子 | 出力の形式識別子 | スキーマのバージョン |
| --- | --- | --- | --- |
| Spreadsheet | `.spon` | `format: "likex.spreadsheet"` | `schemaVersion: 1` |
| LikeSlide | `.slon` | `format: "likex.slide"` | `version: 1` |

現在の保存構造をバージョン1とし、旧構造への互換読み込みは提供しません。形式識別子とバージョンは必須です。ファイル選択では `.json` も選べますが、内容は同じ保存形式が必要です。`parseWorkbook` / `serializeWorkbook`、`parseSlideDeck` / `serializeSlideDeck` はJSON文字列と編集用モデルを相互に変換します。`onSave` と操作APIは編集用モデルを扱い、保存先とファイル名は親が決めます。ファイルへ出力するBlobのMIMEタイプは `application/json` です。

保存時の並びは表示に合わせます。Spreadsheetはシートの表示順で、各シートの `rows` 配列に行を並べ、行の `cells` に `A, B, …, Z, AA, …` の列順でセルを置きます。LikeSlideはページの表示順で、ページ内の要素を上から下、同じ高さでは左から右に並べます。要素の重なり順は `stackOrder` に保持し、読み込み時に復元します。

両方のserialize APIは2スペース・LF・末尾改行なしの書式に固定し、同じデータから同じ文字列を生成します。親の `onSave` でもこのAPIを使えば、オブジェクトのキーの追加順で保存内容が変わりません。共通の出力処理は [`@likex/core/json`](../packages/core/docs/stable-json.md) が担当し、各モジュールが並び順と保存形式を定義します。詳細は [SPONの構造](../packages/spreadsheet/src/docs/native-files.md) と [SLONの構造](../packages/slide/src/docs/commands.md) を参照してください。

拡張子だけの変更ではファイル内容のハッシュは変わりません。既存Blobの名前や内容を自動で移行する処理はありません。データが同じときのBlob書き込み省略は親側で管理します。

Explorerでは `.spon` を緑の表計算アイコン、`.slon` をオレンジのスライドアイコンで表示し、内蔵プレビューはJSONテキストを表示します。SpreadsheetやLikeSlideで開く専用ビューは、親アプリが `onPreviewRequest` で選択します。接続方法は [プレビュー](../packages/explorer/src/docs/previews.md) を参照してください。

読み込み時は拡張子やMIMEタイプだけで内容を判断せず、各モジュールのparse APIで形式・バージョン・データを検証します。独自拡張子のOS関連付けやエディタのJSON認識は利用環境での設定が必要です。Excel・PowerPointとの受け渡しには、それぞれXLSX・PPTXの入出力を使います。

## パッケージとコピーで原本を共用する

配布用にもう一つ実装を持ちません。`src/` から `dist/` のESMと型宣言を生成し、`src/README.md` と `src/docs/` の利用ガイドを同じ配置で配布物へ同梱します。READMEは導入と詳細への入口、`docs/` は責務ごとの詳細です。

コピー導入ではUIの `src/` 全体と `packages/core/src/` を隣接フォルダへ配置し、UI側の `core.ts` のimport先を変更します。Spreadsheet・LikeSlideでは `ooxml.ts` を `export * from "../core/ooxml";`、`json.ts` を `export * from "../core/json";` に変更します。リポジトリ固有のパスエイリアスや共通Providerは不要です。Reactなどの外部依存は明示します。更新時は取得元バージョンと利用側での変更差分を管理します。

共通のホスト契約と小さなヘルパーは `@likex/core` で管理します。各UIは通常のnpm依存として利用し、生成コピーは作りません。coreの詳細とコピー導入手順は [共通基盤](core.md) を参照してください。React状態や個別の保存データは各コンポーネントが管理します。

## Tailwindとデザイン

Explorerの開発ではTailwind CSS v4を使い、TSXの専用クラスとテーマ設定から生成したCSSを同梱します。Spreadsheetは `lxs-`、LikeSlideは `lxp-` クラスに限定したCSSを同梱します。利用側は各パッケージの `styles.css`、コピー導入ではコピーした `styles.css` を読み込みます。どちらも利用側へのTailwind導入や専用PostCSS設定は不要です。

`packages/explorer/styles/input.css` とTSXが原本で、`src/styles.css` は自動生成します。コピー導入のため生成済みCSSをGit管理しますが、手編集しません。配布時は同じ内容を `dist/styles.css` へ配置します。`check:styles` が原本との不一致を検出し、配布ビルドとplaygroundのソース編集時にも再生成します。

専用の `lxe:` クラスと内部CSS変数を使い、基礎CSS・テーマ・ユーティリティをExplorer本体とPortalの範囲へ限定します。全体へのPreflightやテーマ変数の上書きを避けます。通常のDOMなので、利用先の高い詳細度や!importantを持つCSSまで完全に遮断するものではありません。

`theme`、`colorMode`、`style` による動的カスタマイズには再生成は不要です。コピー後に内部クラスを変更した場合のみ、CSSの再生成が必要です。

Next.jsへの対応は、独立した利用先の本番ビルドで検証します。Next.jsはこのリポジトリの検証用依存であり、各モジュールの実行時依存ではありません。

## フォルダ構成

```text
LikeX/
├── packages/core/         # 共通契約・ヘルパー（React依存なし）
├── packages/explorer/
│   ├── src/
│   │   ├── index.ts       # 公開入口
│   │   ├── core.ts        # 共通パッケージへの入口（コピー時は1行変更）
│   │   ├── props.ts       # コンポーネントの引数
│   │   ├── model/         # 型、検証、データ操作
│   │   ├── state/         # Reactの状態・操作管理
│   │   ├── ui/            # 表示、テーマ、共通コントロール
│   │   ├── styles.css     # 自動生成CSS（コピー導入にも同梱）
│   │   ├── docs/          # API・組み込み・運用例
│   │   └── README.md      # コピー導入と利用ガイドの入口
│   ├── styles/input.css   # 維持するCSS生成入力
│   ├── tests/             # モジュールのテストと導入検証fixture
│   ├── dist/              # 生成されるESM・型宣言・CSS
│   ├── package.json
│   └── README.md          # パッケージ導入と利用ガイドの入口
├── packages/spreadsheet/  # セル編集（Reactとcoreに依存）
├── packages/slide/        # スライド編集・PPTX入出力（Reactとcoreに依存）
├── apps/playground/       # Vite + Reactのメモリ保存デモ
├── scripts/               # ビルド・配布・導入検証
├── docs/                  # 開発方針・公開手順・レビュー
├── package.json           # 非公開のnpm workspacesルート
└── LICENSE
```

デモは認証や永続ストレージを内蔵しません。旧API等を削除した経緯は [レビュー記録](release-review.md) にあります。Spreadsheetの保存・検索サービスは、利用側で必要に応じて接続します。Excel出力は `spreadsheet/export/` が担当し、ZIPの組み立てはExplorerとCoreで共有します。

LikeSlideの `model/` はJSONとコマンド、`session/` は履歴、`state/` は編集許可・保存とUI状態、`ui/` はリボン・キャンバス・スライド一覧・プロパティ表示、`import/` と `export/` はPPTX変換を担当します。Officeファイル共通の安全なZIP・XML読み取りは `core/ooxml/` を使います。
