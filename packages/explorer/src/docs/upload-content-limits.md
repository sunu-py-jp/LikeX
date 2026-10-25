# 再生時間・ページ数・スライド数の制限

[作成・アップロード](./uploads.md) / [ドキュメント一覧](./README.md)

`upload.contentLimitsByExtension` で、ファイルの容量に加えて内容の上限を指定できます。動画は設定を省略しても **4時間以下（14,400秒）** が既定です。音声・PDF・PPTXの内容制限は、指定した場合だけ適用します。上限と同じ値は許可します。

## 対象と指定方法

| 対象 | 拡張子 | 項目 | 省略時 |
| --- | --- | --- | --- |
| 動画 | `.mp4` `.webm` `.m4v` `.mov` `.mkv` `.avi` `.wmv` `.mpg` `.mpeg` `.ogv` `.3gp` | `maxDurationSeconds` | 14,400秒 |
| 音声 | `.mp3` `.wav` `.m4a` `.aac` `.ogg` `.flac` | `maxDurationSeconds` | 内容制限なし |
| PDF | `.pdf` | `maxPages` | 内容制限なし |
| PowerPoint | `.pptx` | `maxSlides` | 内容制限なし |

動画・音声の拡張子はルールの適用対象を示します。内蔵の情報取得はブラウザのメディア機能を利用するため、実際に読めるコンテナ・コーデックはブラウザやOSに依存します。特にMOV・AVI・MKV等を一律に読める保証はありません。読めない場合は除外対象となり、必要なら後述の `inspectFile` を使います。

```tsx
import Explorer, { type ExplorerUploadOptions } from "@likex/explorer";

const upload = {
  allowedExtensions: [".mp4", ".webm", ".mp3", ".pdf", ".pptx"],
  maxFileSizeBytes: 100 * 1024 * 1024,
  maxFileSizeBytesByExtension: { ".mp4": 500 * 1024 * 1024 },
  contentLimitsByExtension: {
    ".mp4": { maxDurationSeconds: 2 * 60 * 60 },
    // .webmは既定の4時間。音声の時間上限は明示した場合だけ有効です。
    ".mp3": { maxDurationSeconds: 60 * 60 },
    ".pdf": { maxPages: 100 },
    ".pptx": { maxSlides: 50 },
  },
  invalidFileBehavior: "skip",
} satisfies ExplorerUploadOptions;

// entriesとsaveは利用側が用意します。
<Explorer initialEntries={entries} onSave={save} upload={upload} />;
```

型は `ExplorerUploadContentLimitsByExtension` です。PDFに `maxDurationSeconds` を指定するなど、形式と項目が合わない組み合わせは型エラーになり、JavaScriptからの不正な設定も実行時に拒否します。キーは先頭のドットを含み、大文字小文字・前後の空白は正規化して判定します。型付きのコードでは表の小文字のキーを使います。

秒数は0以上の有限な数値で、小数も使えます。ページ数・スライド数は0以上の安全な整数です。0は「無制限」ではありません。PPTXの枚数には非表示スライドを含みます。旧形式の `.ppt`、Wordのページ数、Excelのシート数等はこの設定の対象ではありません。

容量の指定は従来の `maxFileSizeBytes` / `maxFileSizeBytesByExtension` を使います。容量・時間・ページ数等はすべて満たす必要があります。内容制限のキーに追加しても、`allowedExtensions` で許可していない形式を取り込めるようにはなりません。

## 動画の既定値を変更・解除する

```ts
const upload = {
  contentLimitsByExtension: {
    ".mp4": { maxDurationSeconds: 6 * 60 * 60 }, // この形式は6時間まで
    ".webm": false, // この形式の内容検査だけを解除
  },
} satisfies ExplorerUploadOptions;
```

`false` はその拡張子の内容制限だけを解除します。容量・許可拡張子・件数の条件は残ります。項目を省略する、`undefined` を渡す、空の `{}` を渡す場合は既定値を引き継ぎ、動画の4時間制限が有効です。既定秒数は `EXPLORER_DEFAULT_MAX_VIDEO_DURATION_SECONDS` として公開しています。

## 検査中と検査失敗の扱い

ファイル選択・フォルダ選択・ドロップ・OS貼り付け・`ref.upload()` は、同じ非同期の検査を使います。1ファイルでも内容検査が必要なら、情報取得を待ってから取り込みを確定します。保存やストレージへの送信は行いません。

1. 許可拡張子と容量を確認します。ここで条件に合わないファイルの内容は読みません。
2. 必要なファイルの内容を確認します。「ファイルの内容を確認しています」と件数の進捗を表示します。
3. 同名競合・件数上限を確認し、編集許可を通して下書きへ反映します。

確認中はファイルとその親フォルダのアイコンに進捗表示が付き、フォルダ間の移動と中止ができます。一覧の仮表示は未確定で、保存対象には含みません。キャンセル時はその回の仮表示と候補を破棄します。

<a id="inspection-concurrency"></a>

### 複数ファイルの検査

1回の取り込み内で、動画・音声は合わせて最大4ファイルを並行して検査します。PDF・PPTXは合わせて1ファイルずつ検査し、解析中の負荷やメモリ使用量が重ならないようにします。動画・音声の検査とPDF・PPTXの検査は並行して進みます。この同時実行数は固定で、追加の設定は不要です。

進捗の `phase: "inspecting"` に含まれる `completed` は確認を終えたファイル数です。検査の開始順ではなく、完了に応じて増加し、正常に確認を終えると `total` に達します。内容検査が不要なファイルも確認済みとして数えます。必要なすべての検査結果が揃ってから上限を判定して取り込みを確定するため、検査の完了順によって取り込み順や同名競合の扱いは変わりません。途中で中止した場合は待機中の検査を始めず、進行中の検査にも中止を伝え、中止後の結果を反映しません。

時間超過、ページ数超過、壊れたファイル、パスワードが必要なPDF、非対応のメディア等は、既存の通知領域にファイル名と理由を表示します。

- `invalidFileBehavior: "reject-batch"`（既定）は、その回をすべて中止します。
- `invalidFileBehavior: "skip"` は、違反・解析失敗のファイルを除外して残りを取り込みます。除外ファイルの空フォルダを残しません。
- 全体中止の通知は `upload` / `rejected`、除外して続行した結果は `upload` / `skipped` で受け取れます。単なる検査完了をストレージへのアップロード完了として通知しません。

新しい拒否理由は `duration-exceeded`、`page-count-exceeded`、`slide-count-exceeded`、`content-inspection-failed` です。超過理由には実測値と適用した上限を含めます。検査できない値を0や上限内とみなして通すことはありません。

既存の保存済みファイルを開く・移動する操作では再検査しません。設定変更も既存の一覧を削除しません。これから取り込む新規・上書きのファイルに適用します。「新しいファイル」で0バイトの動画・PDF・PPTXを作る場合、内容制限が有効なら拒否します。実際の文書を生成する操作ではないためです。

## 解析処理を利用側で差し替える

`upload.inspectFile` はメタデータの取得だけを担当し、閾値比較・通知・キャンセル後の反映制御はExplorerが担当します。戻り値が `undefined` なら、そのファイルを内蔵の取得処理へ渡します。失敗時は例外を投げ、実測値が得られないファイルを成功扱いにしないでください。

```ts
import type { ExplorerUploadInspectFile } from "@likex/explorer";

// inspectVideoは利用側の解析処理です。通信を使う場合の認証や送信先も利用側が所有します。
function createInspector(
  inspectVideo: (file: File, signal: AbortSignal) => Promise<number>,
): ExplorerUploadInspectFile {
  return async ({ file, kind, signal }) => {
    if (kind !== "video") return undefined;
    const durationSeconds = await inspectVideo(file, signal);
    return { kind: "video", durationSeconds };
  };
}
```

| リクエスト | 型・意味 |
| --- | --- |
| `file` | `File`。検査対象の本体。フォルダ取込時の相対パスは `file.webkitRelativePath` |
| `extension` | `.mp4`等、先頭のドットを含む正規化済み拡張子 |
| `kind` | `"video"` / `"audio"` / `"pdf"` / `"presentation"` |
| `signal` | `AbortSignal`。利用側の処理にも伝えて中止に対応します |
| `pdfInspectionLimits` | PDFのみ、既定値を補完した解析上限。呼び出しごとの読み取り専用コピー |

| 戻り値 | 用途 |
| --- | --- |
| `{ kind: "video", durationSeconds: number }` | 動画の秒数 |
| `{ kind: "audio", durationSeconds: number }` | 音声の秒数 |
| `{ kind: "pdf", pages: number }` | PDFのページ数 |
| `{ kind: "presentation", slides: number }` | PPTXの全スライド数 |
| `undefined` | 内蔵処理へ委譲 |

公開型は `ExplorerUploadInspectFile`、`ExplorerUploadInspectFileRequest`、`ExplorerUploadContentMetadata` です。同期値またはPromiseを返せます。要求と異なる `kind`、NaN・Infinity・負数の値、不正なページ数等は検査失敗になります。

`inspectFile` も、同じ取り込み内で上記の同時実行数に従って並行して呼ばれます。以前の1ファイルずつの呼び出しを前提に、現在処理中のファイルや一時結果を共有変数に保持している実装は、呼び出しごとに状態を分けてください。各リクエストの `signal` を解析・通信処理へ渡し、中止時に確保したリソースを解放します。利用側の解析処理にさらに小さい同時実行数が必要な場合は、`inspectFile` の中で制御できます。

同じ取り込みセッションでは得られた情報を再利用し、上書き確認のたびに本体を読み直しません。ページ数・再生時間等の条件が変われば最新の上限で再判定し、`inspectFile` またはPDFの解析上限 `pdfInspectionLimits` の値が変更されれば再検査します。同値の設定オブジェクトへの置き換えや、既定値の明示指定では再検査しません。PDFの解析上限の変更は、動画・音声・PPTXの検査キャッシュに影響しません。中止後に返った結果は使いません。利用側の非協力的な処理を実際に停止する責任は利用側にあり、独自のタイムアウトもそこで指定できます。

## 標準の情報取得と上限

| 処理 | 実装と制限 |
| --- | --- |
| 動画・音声 | ブラウザのメディアメタデータ。再生はせず、一時URLを使って終了・失敗・中止時に破棄します。Node.jsでは `inspectFile` を指定してください |
| PDF | 必要な参照テーブル・オブジェクトストリーム・ページツリーだけを読み、実際のページ数を数えます。入力の既定上限100 MiB。画像・本文・フォントのストリームは展開しません。圧縮解除にはMIT/Zlibの `pako` を使います。暗号化・パスワード付きPDFは標準処理では拒否します |
| PPTX | CoreのZIP/XML処理で構造とスライド一覧を読みます。512 MiB以下・4,096 ZIP項目まで。必要な部分だけ読み、埋め込み画像や動画を展開しません。非表示スライドを含み、LikeSlideの編集用変換は実行しません |

標準処理の待機上限は既定で1ファイル30秒です。PDFのみ `pdfInspectionLimits.timeoutMs` で変更できます。そのファイルの標準検査を開始した時点から計測し、同時実行数の空きを待つ時間は含みません。`inspectFile` 自体の待機時間にも適用せず、利用側でタイムアウトを指定します。PDFの構文解析・圧縮解除は小さな処理単位でイベントループへ制御を返し、中止・時間超過時には実際の解析も止めます。実行中の `File.arrayBuffer()` 自体は停止できないため、読み込み完了後も中止を確認して解析を開始しません。

<a id="pdf-inspection-limits"></a>

## PDFの解析上限を設定する

`upload.pdfInspectionLimits` は `ExplorerPdfInspectionLimits` 型です。`Explorer`・`ExplorerPopup`・`useExplorerDraft`・非同期のモデル取り込みAPIで同じ設定を使えます。指定した項目だけ既定値を上書きします。既定値は `EXPLORER_DEFAULT_PDF_INSPECTION_LIMITS` としてUI入口・`@likex/explorer/model` の両方から参照できます。

```tsx
import Explorer, { type ExplorerUploadOptions } from "@likex/explorer";

const MiB = 1024 * 1024;
const upload = {
  contentLimitsByExtension: { ".pdf": { maxPages: 1000 } },
  pdfInspectionLimits: {
    inputBytes: 128 * MiB,
    streamBytes: 32 * MiB,
    decodedBytes: 128 * MiB,
    xrefEntries: 300_000,
    sections: 256,
    timeoutMs: 60_000,
  },
} satisfies ExplorerUploadOptions;

// initialEntries・onSaveなどは通常どおり指定します。
<Explorer upload={upload} onSave={({ entries }) => entries} />;
```

これは上限の変更例です。`pdfInspectionLimits` の指定だけではページ数検査を有効にしません。取り込み時に検査する場合は上例のように `.pdf.maxPages` も指定します。`maxFileSizeBytes` / `maxFileSizeBytesByExtension` の受付容量と、PDF解析用の `inputBytes` は独立した条件で、検査する場合は両方を満たす必要があります。

| 設定キー | 既定値 | 対象・計数方法 |
| --- | --- | --- |
| `inputBytes` | 100 MiB | 元PDFの容量。全体読み込み前にも確認 |
| `streamBytes` | 16 MiB | 管理情報1ストリームの入力・各展開段階・予測処理の行幅 |
| `decodedBytes` | 64 MiB | 中間フィルター・予測復元・無圧縮の管理情報も含む累積展開量 |
| `xrefEntries` | 100,000 | 参照テーブル項目の累計。過去の更新履歴・削除済み・重複項目も含む |
| `objectStreamObjects` | 100,000 | 読み込む圧縮オブジェクトの項目累計。ページ検査に直接使わない同居項目も含む |
| `objects` | 100,000 | 解決済みオブジェクト・オブジェクトストリームの各キャッシュ件数 |
| `values` | 600,000 | 解析する値・辞書キー・参照展開でコピーする値 |
| `depth` | 64 | 値・文字列の入れ子、間接参照や復号設定の展開深さ |
| `treeNodes` | 100,000 | ページツリーノード数・探索待ちの要素数。中間ノードも含む |
| `treeDepth` | 256 | ページツリーの深さ |
| `sections` | 128 | 更新履歴・混在参照テーブルのセクション数。保存回数とは一致しない場合あり |
| `filters` | 8 | 1ストリームのフィルター段数 |
| `work` | 268,435,456 | 読み取り・展開・走査等を足した内部処理単位。バイト数・秒数とは直接換算できない |
| `timeoutMs` | 30,000 | 標準PDF検査の開始からの待機上限（ミリ秒）。順番待ちは含まない |
| `tokenLength` | 1,024 | 一般トークンの長さ。表示テキストの長さではない |
| `nameLength` | 1,024 | エスケープを復号した内部名の長さ |
| `numberLength` | 64 | 数値トークンの文字数 |
| `integerDigits` | 16 | 位置・件数などの整数トークンの桁数。安全な整数の検証も維持 |
| `startXrefSearchBytes` | 1,024 | 最終 `%%EOF` の手前で `startxref` を探索する範囲 |

全項目に**正の安全な整数**を指定します。省略・`undefined` は既定値を継承します。0・負数・小数・NaN・Infinity・`null`・`false`・未知のキーは設定エラーです。`timeoutMs` はタイマーの範囲に合わせて2,147,483,647以下に制限します。無制限を表す値はありません。関連項目はそれぞれ独立して判定し、1項目を増やしても他の上限は自動で増えません。

設定は取り込み開始時に検証・コピーします。呼び出し側のオブジェクトを書き換えても実行中の検査条件は変わりません。GUIで設定を変更する場合は、新しい `upload` オブジェクトを渡してください。適用前には最新設定で再確認し、解析上限が変わっていれば再検査します。

`inspectFile` にもPDFの場合は既定値補完済みの読み取り専用 `request.pdfInspectionLimits` を渡します。独自の検査を実行する場合、これらの上限を守る処理と中止・タイムアウトはその実装側の責任です。`undefined` を返した場合や公開 `inspectExplorerUploadFile(request)` に委譲した場合は、内蔵検査が渡された上限を適用します。

```ts
import {
  inspectExplorerUploadFile, addFilesWithResultAsync, createDraftSnapshot,
  type ExplorerPdfInspectionLimits,
} from "@likex/explorer/model";

const pdfInspectionLimits = {
  decodedBytes: 128 * 1024 * 1024,
  timeoutMs: 60_000,
} satisfies ExplorerPdfInspectionLimits;
const controller = new AbortController();

// FileであるpdfFileをホストが用意します。解析だけで一覧は変更しません。
const metadata = await inspectExplorerUploadFile({
  file: pdfFile,
  extension: ".pdf",
  kind: "pdf",
  signal: controller.signal,
  pdfInspectionLimits,
});
if (metadata.kind === "pdf") console.log(metadata.pages);

// 取り込みAPIも同じ設定を受け付けます。
const result = await addFilesWithResultAsync(
  createDraftSnapshot([]), [pdfFile], "root",
  { contentLimitsByExtension: { ".pdf": { maxPages: 1000 } }, pdfInspectionLimits },
  [], undefined, { signal: controller.signal },
);
```

割り当て前にサイズと件数を確認します。これらは解析データの上限であり、ブラウザ全体の使用メモリを64 MiBに制限する意味ではありません。元ファイル、解析オブジェクト、作業バッファなどは別途メモリを使います。

通常の参照テーブル、圧縮された参照テーブル・オブジェクト、追記更新、混在参照テーブルに対応します。メタデータの圧縮方式はFlate・LZW（EarlyChange 0/1）・ASCIIHex・ASCII85・RunLengthとTIFF/PNG予測処理に対応します。未対応のフィルター、不正な参照や循環、ページ数とツリーの不一致、上限超過はエラーにします。最初に読む参照ストリームの長さが未解決の間接参照の場合も拒否します。一般のオブジェクトストリームの間接参照による長さ指定は扱えます。破損ファイルの修復読み込みや、上限のないパーサーへの自動切り替えは行いません。

これはページ数取得に必要な構造の検査です。PDF全体の表示互換性、埋め込みデータ、JavaScript、添付ファイルの安全性を保証するものではありません。対応範囲外のPDFや別の上限を扱う場合は `upload.inspectFile` を指定してください。PDFで `undefined` を返すと内蔵検査へ戻るため、独自の検査に失敗した場合は例外を返します。

PPTXの検査はスライド枚数に必要な構造の検査です。読み取らない埋め込みデータのCRCや表示互換性まで保証しません。独自の容量上限とは別に解析処理の上限があり、標準処理の上限を超えるファイルも `inspectFile` で扱えます。PDFの数値上限は上記の設定でも調整できます。

これらはクライアントに取り込む際の制限です。サーバー側で受付条件を強制する必要がある場合は、保存・受付側でも検証してください。検査結果を保存JSONやBlobへ自動で付与することはありません。

## 画面なしの追加と互換性

`@likex/explorer/model` に非同期の追加APIを用意しています。Reactや画面は不要です。PDF・PPTXの標準検査はNode.js 22.13以上でも使えます。

```ts
import { createDraftSnapshot, addFilesWithResultAsync } from "@likex/explorer/model";

const controller = new AbortController();
const result = await addFilesWithResultAsync(
  createDraftSnapshot([]),
  [pdfFile], // File。利用側で用意します。
  "root",
  { contentLimitsByExtension: { ".pdf": { maxPages: 100 } } },
  [],       // 同名競合への回答
  undefined, // 競合を再試行する場合は同じcreateExplorerUploadSession()を渡します
  { signal: controller.signal },
);
console.log(result.snapshot, result.result.rejections);
```

`addFilesAsync` はスナップショットだけを返します。`prepareFilesWithProgressAsync` は同じ引数で `AsyncGenerator<ExplorerImportProgress, { snapshot, result }>` を返し、`checking` → `inspecting` → `preparing` の進捗を取得できます。内容検査が不要なら `inspecting` は省略します。同名競合は従来と同じ `ExplorerUploadConflictError`、条件違反は `ExplorerUploadValidationError` です。

既存の同期 `addFiles` / `addFilesWithResult` / `prepareFilesWithProgress` は、内容検査が必要で未実施なら `ExplorerUploadInspectionRequiredError` を投げます。黙って時間・ページ数制限を省略しません。既定の動画4時間制限によって、従来の同期動画追加は非同期APIへの変更が必要です。その他の制限を指定しない非動画ファイルの同期追加は変わりません。

`useExplorerDraft` にも `addAsync(files, parent, decisions?, session?, { signal?, onProgress? }?)` を用意しています。編集許可については既存の低レベル `add` と同じ契約です。表示中のExplorerへ操作を依頼する場合は、許可取得や競合ダイアログまで担当する `ref.upload()` を使ってください。
