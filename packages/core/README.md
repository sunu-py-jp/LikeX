# @likex/core

LikeXコンポーネントの保存・編集許可・通知・機能設定に使う共通の型と小さなヘルパーです。React、Provider、継承用の抽象クラスには依存しません。文字列検索はMITライセンスのRE2JSを利用し、通常の入口と専用の `/text-search` の両方から使えます。

`@likex/core/connectors` はReact・DOM・ホスト連携を含まない純粋な幾何専用の公開入口です。同じAPIを通常の `@likex/core` からも使えます。

`ConnectorEndpoint` / `ConnectorBinding` と `getConnectorPortPoint` / `findNearestConnectorPort` は、線の2端点と図形の8接続点を扱います。未ズームの文書座標、中心回転、左右・上下反転、最短吸着、2点の外接矩形と座標変換を共通化します。[線の端点と接続点](https://github.com/sunu-py-jp/LikeX/blob/main/packages/core/docs/connectors.md)を参照してください。

`@likex/core/office-shapes`（通常の入口からも利用可能）の `OFFICE_SHAPE_PRESETS` / `getOfficeShapeGeometry` / `getOfficeShapeOutline` は、カギ矢印・Uターン矢印など39種類のOffice標準図形のパス・文字領域・接続輪郭を提供します。[Office標準図形](https://github.com/sunu-py-jp/LikeX/blob/main/packages/core/docs/office-shapes.md)を参照してください。定義データのApache-2.0表記は[NOTICE](NOTICE)に保持しています。

`createPrimaryColorPalette(color, "light" | "dark")` は `#RGB` / `#RRGGBB` のUI色から `{ primary, onPrimary, primaryHover, accent, selection }` を返します。未指定・不正な色は `undefined` です。SpreadsheetとLikeSlideでは `primaryColor` Propsに指定すると内部で適用され、文書の配色は変更しません。

`RibbonDisplayMode` はSpreadsheet・LikeSlide・LikeDocument共通の表示契約（`expanded` / `tabs` / `autoHide` / `hidden`）です。`isRibbonDisplayMode(value)` は値を検証し、`normalizeRibbonDisplayMode(value)` は未指定・不正値を `expanded` に揃えます。文書データやOfficeファイルへ保存せず、表示中の状態は各UIのpropsとHandleで管理します。

`serializeStableJson(value, { maxLength?, compareKeys?, space? })` は、オブジェクトのキーを全階層でUTF-16昇順に揃え、配列順を保ってJSON文字列を返します。`@likex/core/json` からも読み込めます。`space` は0〜10の整数で、既定の0はコンパクト、2は2スペースのインデントです。書式上の改行はLF、BOM・末尾改行は追加せず、文字列の内容も変えません。`compareKeys(left, right, path)` でドメイン固有のキー順を指定でき、0または非有限の戻り値はUTF-16順になります。`path` は対象オブジェクトまでのキー・配列添字です。`maxLength` は正の整数のUTF-16文字数（インデントを含む）で、上限超過は全体文字列の生成前に `RangeError` になります。循環参照、非有限数、BigInt、関数、Symbolの値・キー、Date等の通常のJSONでない値は拒否します。`undefined` はオブジェクト内なら省略し、配列内なら `null`、ルートならエラーです。LikeXの保存用ルールであり、RFC 8785への完全準拠は表明していません。

```ts
import { notifyHost, resolveFeatureFlags } from "@likex/core";
import type { SaveHandler, EditRequestHandler, EventHandler } from "@likex/core";

type Document = { id: string; content: string };
const onSave: SaveHandler<Document> = async document => {
  // 利用側で認証・検証・永続化し、失敗時はthrowする。
  console.log(document.id);
};
const onEditRequest: EditRequestHandler<{ action: string }, Document> =
  async (_request, { signal }) => !signal.aborted;
const onEvent: EventHandler<{ type: "saved" }> = event => console.log(event.type);
notifyHost(onEvent, { type: "saved" });
const features = resolveFeatureFlags({ download: true, edit: true }, { edit: false });
```

`notifyHost` は観測用通知の例外・Promise rejectionを隔離します。保存や許可判定をこの関数で呼ばないでください。それらは呼び出し側が結果を待って処理します。

`OperationContext` は `requestId` と `signal`、`EditMode` は `view / requesting / edit` です。`EditPermission<Baseline>` は `boolean | { allowed: true; data?: Baseline }`。第2型引数でデータのキーを変更でき、Explorerは `entries`、Spreadsheetは `workbook` を使います。`SaveHandler<Payload, Result>` と `RefreshHandler<Result>` は同期・非同期の両方を許容します。

`createUnsavedChangesGuard()` は登録されたWindowの `beforeunload` をdirty時だけ有効にします。ネイティブ確認文言はブラウザが決めます。SPA内の遷移確認・サーバーロック・認証・永続化自体は扱いません。

`ContextMenuProvider<Context, Change, Icon>` と `ContextMenuItem` は、条件付きの右クリックメニューを定義します。項目の `onSelect(context, { signal, requestId })` は `{ change, description? }` を返し、実際の書き込みはコンポーネントに委譲します。`undefined` を返すとローカル変更なしで終了します。CoreはReactやファイル・セル固有の型に依存しません。

親の入力ダイアログをキャンセルした場合は `throw new DOMException("キャンセル", "AbortError")` で中止を通知できます。通常のエラー・成功と区別して `cancelled` イベントが発火します。

`createContextMenuExecutor()` は準備・確認・反映を管理します。`block` は準備中の変更を禁止、`confirm` は変更を許可して結果反映前に確認、`reject-if-changed` は開始後にデータが変わっていれば中止します。表示と変更ガード、計画の隔離、対象検証、反映処理は各UIが接続します。非同期の編集許可を待った場合も、コミット直前に `apply` の `guard.isCurrent()` を確認します。キャンセル後の応答は破棄します。

`createZipArchive(entries, { signal?, type? })` は汎用の無圧縮ZIPを `Promise<Blob>` で返します。`entries` は通常・非同期のIterableで、ファイルは `{ path, content: Blob | (() => MaybePromise<Blob>), updatedAt? }`、フォルダは `{ path, directory: true, updatedAt? }` です。MIMEの既定値は `application/zip` で、ZIPをコンテナーにする形式では `type` を変更できます。

```ts
import { createZipArchive } from "@likex/core";
const zip = await createZipArchive([
  { path: "reports", directory: true },
  { path: "reports/summary.txt", content: new Blob(["Summary"]) },
]);
```

全パスを検証してから本体を順番に読み、1件でも失敗した場合は全体を中止します。絶対パス・`..`・バックスラッシュ・NUL・不正Unicode・重複・ファイルと親フォルダの衝突を拒否します。ZIP64や圧縮には未対応で、全体は4 GiB未満、65,534項目まで、各パスはUTF-8で65,535バイトまでです。未指定・無効な日時は1980年1月1日、範囲外の将来日時は2107年末に丸めます。端末メモリ内で生成し、ダウンロード開始やストレージ通信は行いません。`signal` による中止は処理境界で確認するため、中止できない外部読込の完了は待ちます。

各UIは通常のnpm依存として `@likex/core` を利用します。tarballで導入する際はcoreとUIの両tarballをnpmに渡してください。コピー導入では `core/src/` とUIの `src/` の全体を隣接フォルダへ置き、UI側の `core.ts` を `export * from "../core";` へ変更し、Coreの実行時依存 `re2js@2.8.6` をインストールします。Spreadsheet・LikeSlide・LikeDocumentで変更するCoreの参照はこの1か所だけです。`ooxml.ts`・`json.ts`・`model/core-*.ts` と、LikeSlide・LikeDocumentの `browser.ts` は内部で `core.ts` を参照します。他のモジュールで変更する追加の入口は、各モジュールの導入ガイドに従ってください。自動生成や特殊な解決設定はありません。core単体も `src/` のコピーで利用できます。

[MITライセンス](LICENSE)です。コピーする場合は`src/LICENSE`と`src/THIRD_PARTY_NOTICES.md`も保持してください。npm公開は未実施で、`private: true`は誤公開防止のため維持しています。

## ブラウザー用のメニュー

`openContextMenu` と `ContextMenuAction` / `ContextMenuSurfaceOptions` 型は、通常の `@likex/core` と `@likex/core/browser` の両方から使えます。両入口は同じメニュー実装を共有します。Reactには依存せず、import時にDOMへアクセスしません。メニューを表示するときはDOMが必要で、純粋モデルからは呼び出しません。LikeSlide・LikeDocumentの `browser.ts` は `core.ts` を参照するため、コピー時の変更は不要です。他のUIの `browser.ts` は各導入ガイドに従ってください。

## 文字列検索

`@likex/core` と `@likex/core/text-search` の両方から、`createTextSearchMatcher` と `TextSearchMatcher` / `TextSearchQuery` 型を利用できます。`createTextSearchMatcher({ text, matchCase?, wholeText?, useRegex? })` は、部分一致・全体一致・大文字小文字の区別・正規表現を共通化します。返り値の `test(text)` と `replace(text, replacement)` は繰り返し呼べ、置換後の文字列は `$1` 等もリテラルとして扱います。空の検索語は一致せず、置換も行いません。

通常文字列は100,000文字、正規表現は4,096文字までです。コンパイル前に繰り返しの展開コストを20,000命令相当までに制限し、短い式でも巨大なグループの繰り返しはエラーにします。独立した繰り返しや選択肢のコストは足し合わせ、入れ子やグループに付く回数だけを掛け合わせます。コンパイル後も命令数を検証します。正規表現は [RE2JS](https://github.com/le0pard/re2js) のRE2形式で、グループ・選択・量指定・文字クラス・アンカー・Unicode文字クラスに対応し、先読み・後読み・後方参照には対応しません。不正な構文・未対応構文・過大なパターンは例外になり、UI側でエラーとして表示します。バックトラッキングにより指数時間を要するJavaScriptの正規表現を、未検証の検索語から直接実行しません。標準の検索条件は表示状態で、OfficeやLikeXの保存ファイルには書き込みません。

ソースコピー導入ではcoreの依存 `re2js@2.8.6` をインストールします。Explorerは `model/core-text-search.ts` を `export * from "../../core/text-search";` に変更します。Spreadsheetは `core.ts` を経由するため、このファイルの変更は不要です。
