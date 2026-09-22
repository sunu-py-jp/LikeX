# LikeXのモジュール構成

npm workspacesで開発環境を共有し、UIの配布単位は `@likex/explorer`、`@likex/spreadsheet`、`@likex/slide`、`@likex/document`、`@likex/board`、`@likex/diagram`、`@likex/calendar`、`@likex/whiteboard`、`@likex/aichat`、`@likex/chat`、`@likex/dataview`、`@likex/form` に分けます。リポジトリの名前はLikeX、npmの名前は小文字のscope付きにします。scopeの取得・公開先の設定は公開時に確認します。

## 責務

| 場所 | 責務 |
| --- | --- |
| `packages/<module>/src` | パッケージ配布・ソースコピーに使うモジュールの原本。公開入口、型、UI、状態管理、データ処理、利用ガイドを含みます。 |
| `packages/<module>/tests` | モジュールの振る舞いと公開型を検証します。利用先へは配布しません。 |
| `packages/<module>/package.json` | 配布する名前・公開入口・依存・バージョン・ライセンスを宣言します。 |
| `packages/core/src` | 保存・編集許可・通知・機能設定などの共通契約とヘルパーの唯一の編集元。 |
| `packages/<module>/src/core.ts` | `@likex/core` の公開入口を再export。コピー導入時は相対importに変更します。 |
| `packages/<module>/src/json.ts（利用するモジュール）` | `@likex/core/json` の固定JSON出力への入口。コピー時は `../core/json` へ変更します。 |
| `packages/{spreadsheet,slide,document}/src/ooxml.ts` | `@likex/core/ooxml` のZIP・XML・参照関係処理の入口。コピー時はこちらも相対importへ変更します。 |
| `apps/playground` | サンプルデータとデモの保存先を持つ利用者側の例です。ライブラリには含めません。 |
| `scripts` | ビルド・型生成・配布物検査・導入検証をまとめます。 |
| `docs` | リポジトリ全体の方針、公開手順、レビュー記録を置きます。 |

各モジュールの `model` はReactの表示状態に依存しないデータ・検証・操作を担当し、`state` はReactの状態と親へのコールバックをつなぎ、`ui` は表示を担当します。公開入口の `index.ts` から利用し、内部ファイルのパスを利用側の契約にしません。Spreadsheetの数式はモデル内の限定した構文解析器で評価し、JavaScriptとして実行しません。

## GUIと画面なしの操作

| 入口 | 実行対象と責務 |
| --- | --- |
| `@likex/<module>/model` | 呼び出し側が渡したデータを操作・検証する。React、画面、保存先には依存しない。認証・同時更新制御は呼び出し側の責務。 |
| コンポーネントの `ref` | 表示中の下書きを操作する。GUIと同じ機能設定・読み取り専用・編集許可・通知を通す。 |
| GUI | 共通のデータ操作を呼び、入力や競合確認、表示状態を扱う。 |

コピー導入では `components/<module>/model-entry` が画面なしの公開入口です。Explorerのファイル操作はNode.js 22.13以降の `File` / `Blob` でも動作します。ExplorerのTypeScript契約にはそれらのDOM型宣言を使いますが、DOMの生成やReactのマウントは必要ありません。

SpreadsheetとLikeSlideの `/model` はOffice入出力も公開します。出力の実体はBlobで、DOM型宣言なしでも使える構造型を返します。Spreadsheetのサイズ自動調整は画面なしでは推定計測、GUIではフォントの実測を共通計算に渡します。WebP・GIF・向き情報付きJPEGのXLSX出力は、Node.jsでは利用側の画像変換関数を指定します。[Excel出力](../packages/spreadsheet/src/docs/excel-export.md)に実行環境と注入契約を記載しています。

選択・表示位置は保存データと分けます。外部からの選択だけでは未保存状態や編集履歴を増やさず、Spreadsheetのrefは明示した場合だけ対象へスクロールします。保存・ダウンロードはモデル操作へ混ぜず、表示中コンポーネントのホスト連携を利用します。

## ネイティブ保存形式

Spreadsheet・LikeSlide・LikeDocumentの標準保存ファイルは、次の拡張子を使うUTF-8の純粋なJSONです。ZIPなどのコンテナーや独自の構文は使いません。

| モジュール | 拡張子 | 出力の形式識別子 | スキーマのバージョン |
| --- | --- | --- | --- |
| Spreadsheet | `.spon` | `format: "likex.spreadsheet"` | `schemaVersion: 1` |
| LikeSlide | `.slon` | `format: "likex.slide"` | `version: 1` |
| LikeDocument | `.dcon` | `format: "likex.document"` | `version: 1` |

現在の保存構造をバージョン1とし、旧構造への互換読み込みは提供しません。形式識別子とバージョンは必須です。ファイル選択では `.json` も選べますが、内容は同じ保存形式が必要です。`parseWorkbook` / `serializeWorkbook`、`parseSlideDeck` / `serializeSlideDeck`、`parseDocument` / `serializeDocument` はJSON文字列と編集用モデルを相互に変換します。`onSave` と操作APIは編集用モデルを扱い、保存先とファイル名は親が決めます。ファイルへ出力するBlobのMIMEタイプは `application/json` です。

保存時の並びは表示に合わせます。Spreadsheetはシートの表示順で、各シートの `rows` 配列に行を並べ、行の `cells` に `A, B, …, Z, AA, …` の列順でセルを置きます。LikeSlideはページの表示順で、ページ内の要素を上から下、同じ高さでは左から右に並べます。要素の重なり順は `stackOrder` に保持し、読み込み時に復元します。

両方のserialize APIは2スペース・LF・末尾改行なしの書式に固定し、同じデータから同じ文字列を生成します。親の `onSave` でもこのAPIを使えば、オブジェクトのキーの追加順で保存内容が変わりません。共通の出力処理は [`@likex/core/json`](../packages/core/docs/stable-json.md) が担当し、各モジュールが並び順と保存形式を定義します。詳細は [SPONの構造](../packages/spreadsheet/src/docs/native-files.md) と [SLONの構造](../packages/slide/src/docs/commands.md) を参照してください。

拡張子だけの変更ではファイル内容のハッシュは変わりません。既存Blobの名前や内容を自動で移行する処理はありません。データが同じときのBlob書き込み省略は親側で管理します。

Explorerでは `.spon` を緑の表計算アイコン、`.slon` をオレンジのスライドアイコンで表示し、内蔵プレビューはJSONテキストを表示します。SpreadsheetやLikeSlideで開く専用ビューは、親アプリが `onPreviewRequest` で選択します。接続方法は [プレビュー](../packages/explorer/src/docs/previews.md) を参照してください。

読み込み時は拡張子やMIMEタイプだけで内容を判断せず、各モジュールのparse APIで形式・バージョン・データを検証します。独自拡張子のOS関連付けやエディタのJSON認識は利用環境での設定が必要です。Excel・PowerPointとの受け渡しには、それぞれXLSX・PPTXの入出力を使います。

## パッケージとコピーで原本を共用する

配布用にもう一つ実装を持ちません。`src/` から `dist/` のESMと型宣言を生成し、`src/README.md` と `src/docs/` の利用ガイドを同じ配置で配布物へ同梱します。READMEは導入と詳細への入口、`docs/` は責務ごとの詳細です。

コピー導入ではUIの `src/` 全体と `packages/core/src/` を隣接フォルダへ配置し、UI側の `core.ts` のimport先を変更します。Spreadsheet・LikeSlide・LikeDocumentでは `ooxml.ts` を `export * from "../core/ooxml";`、`json.ts` を `export * from "../core/json";` に変更します。リポジトリ固有のパスエイリアスや共通Providerは不要です。Reactなどの外部依存は明示します。更新時は取得元バージョンと利用側での変更差分を管理します。

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
├── packages/document/     # 文書編集・DOCX入出力（React・core・ProseMirrorに依存）
├── packages/aichat/       # AI会話・ストリーミング応答
├── packages/chat/         # 人同士のDM・グループ・スペース
├── apps/playground/       # Vite + Reactのメモリ保存デモ
├── scripts/               # ビルド・配布・導入検証
├── docs/                  # 開発方針・公開手順・レビュー
├── package.json           # 非公開のnpm workspacesルート
└── LICENSE
```

デモは認証や永続ストレージを内蔵しません。旧API等を削除した経緯は [レビュー記録](release-review.md) にあります。Spreadsheetの保存・検索サービスは、利用側で必要に応じて接続します。Excel出力は `spreadsheet/export/` が担当し、ZIPの組み立てはExplorerとCoreで共有します。

LikeSlideの `model/` はJSONとコマンド、`session/` は履歴、`state/` は編集許可・保存とUI状態、`ui/` はリボン・キャンバス・スライド一覧・プロパティ表示、`import/` と `export/` はPPTX変換を担当します。Officeファイル共通の安全なZIP・XML読み取りは `core/ooxml/` を使います。

LikeDocumentはProseMirrorの文書スキーマとトランザクションをGUI・公開コマンドで共用します。保存するのは `.dcon` のJSONで、エディターのDOMやReactの状態は含めません。`/model` はNode.jsでも動作し、公開型でProseMirrorのDOM型宣言を参照しても、実行時のDOM生成は不要です。LikeDocumentのCSSは `lxd-` クラスに限定します。ソースコピーでは `core.ts`・`json.ts`・`ooxml.ts` の3つのアダプターを変更し、ProseMirrorの依存を利用先へ導入します。

## 追加のJSONエディター

Board・Diagram・Calendar・Whiteboard・AIChat・Chat・DataView・Formは、それぞれ独立した `@likex/<module>` と `/model` の入口を持ちます。保存形式は `.json`、`format: "likex.<module>"` と明示したバージョンを要求します。人同士のChatは `version: 2`、それ以外は `version: 1` です。配列の意味のある順序とIDを保ち、serialize時に日時を更新しません。

`core/editor` のReact非依存controllerが、未保存判定・Undo/Redo・保存・編集許可・機能設定・非同期処理のキャンセルを担当します。各モジュールのadapterは正規化・シリアライズ・コマンド実行・必要な機能の対応だけを定義します。UIはcontrollerを購読し、表示中refも同じ経路へ渡します。純粋なmodel APIはこのホスト制御を必要としません。

AIChatの応答生成・添付ファイルのアップロードは親のハンドラーへ委譲します。Chatの参加者・DM・グループ・スペース・返信・リアクション・既読は保存モデルで扱い、認証・配送・同期と競合解決は親アプリへ委譲します。Formの定義と回答は別データで、回答送信はonSubmitへ渡します。CalendarはIANAタイムゾーンを表示に用い、時刻付きイベントはオフセット付きISO、終日は排他的な終了日で保持します。外部カレンダー同期やリアルタイム共同編集は含めません。


## AIチャットと人同士のチャット

旧LikeChatのAI会話機能は `packages/aichat/` / `@likex/aichat` / `LikeAIChat` へ分離し、デモは `/aichat` です。人同士の会話を扱う `packages/chat/` / `@likex/chat` / `LikeChat` のデモは `/chat` です。両方ともReactなしのモデル・セッションAPIとスキルを持ちます。

| 用途 | 保存形式 | メッセージの識別 |
| --- | --- | --- |
| LikeAIChat | `likex.aichat` / `version: 1` | `role` とAIの応答状態 |
| LikeChat | `likex.chat` / `version: 2` | 参加者の `authorId` と所属する会話 |

旧AIファイルの `likex.chat` / `version: 1` は `parseAIChat` / `migrateLegacyAIChat` で全構造を検証してから新AI形式へ移行します。人同士のChatパーサーは旧AI形式を拒否します。旧AIの `role` を人のIDと見なす自動変換や、形式名・バージョンだけの置き換えは行いません。[API名と保存ファイルの移行](../packages/aichat/src/docs/native-files.md#旧likechatからの移行)を参照してください。CSSはAIChatを `.lxai-` / `data-likex-aichat`、Chatを `.lxh-` / `data-likex-chat` に分け、同じ画面へ配置できます。
