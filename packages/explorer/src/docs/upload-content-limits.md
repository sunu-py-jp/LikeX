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

| 戻り値 | 用途 |
| --- | --- |
| `{ kind: "video", durationSeconds: number }` | 動画の秒数 |
| `{ kind: "audio", durationSeconds: number }` | 音声の秒数 |
| `{ kind: "pdf", pages: number }` | PDFのページ数 |
| `{ kind: "presentation", slides: number }` | PPTXの全スライド数 |
| `undefined` | 内蔵処理へ委譲 |

公開型は `ExplorerUploadInspectFile`、`ExplorerUploadInspectFileRequest`、`ExplorerUploadContentMetadata` です。同期値またはPromiseを返せます。要求と異なる `kind`、NaN・Infinity・負数の値、不正なページ数等は検査失敗になります。

同じ取り込みセッションでは得られた情報を再利用し、上書き確認のたびに本体を読み直しません。設定が変われば最新の上限で再判定し、`inspectFile` が変更されれば再検査します。中止後に返った結果は使いません。利用側の非協力的な処理を実際に停止する責任は利用側にあり、独自のタイムアウトもそこで指定できます。

## 標準の情報取得と上限

| 処理 | 実装と制限 |
| --- | --- |
| 動画・音声 | ブラウザのメディアメタデータ。再生はせず、一時URLを使って終了・失敗・中止時に破棄します。Node.jsでは `inspectFile` を指定してください |
| PDF | MITの `pdf-lib` を必要時に読み込み、実際のページツリーを数えます。入力100 MiB以下、ツリー100,000ノード・深さ256まで。暗号化・パスワード付きPDFは標準処理では拒否します |
| PPTX | CoreのZIP/XML処理で構造とスライド一覧を読みます。512 MiB以下・4,096 ZIP項目まで。必要な部分だけ読み、埋め込み画像や動画を展開しません。非表示スライドを含み、LikeSlideの編集用変換は実行しません |

標準処理の待機上限は1ファイル30秒です。PDFパーサー内の同期的な解凍処理は、その途中で強制停止できません。入力サイズとページツリーの上限は、PDF内部で展開されるすべてのデータのメモリ使用量を保証するものではありません。処理を隔離したサーバー等で検査する場合は `inspectFile` を差し替えます。

PPTXの検査はスライド枚数に必要な構造の検査です。読み取らない埋め込みデータのCRCや表示互換性まで保証しません。独自の容量上限とは別に解析処理の上限があり、標準処理の上限を超えるファイルも `inspectFile` で扱えます。

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
