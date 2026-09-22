# 画面なしのモデルAPI

[ドキュメント一覧](./README.md)

`@likex/explorer/model` はReactを読み込まず、画面・DOM・ストレージ接続なしでファイル一覧の検証、編集、取込準備、差分取得を実行する公開入口です。Node.js 22.13以上で使えます。ソースコピーの場合は `@/components/explorer/model-entry` からimportします。既存の `File` / `Blob` 契約を共有するため、TypeScriptの `lib` には `DOM` を含めます。実行時にブラウザの `window` や `document` は必要ありません。

## 初期化・編集・取得

```ts
import {
  createDraftSnapshot, applyAction, addFilesWithResult,
  getSavePayload, describeEntries,
} from "@likex/explorer/model";

const baseline = createDraftSnapshot([]);
const withFolder = applyAction(baseline, { action: "create", name: "資料" });
const folderId = withFolder.entries[0].id;
const imported = addFilesWithResult(withFolder,
  [new File(["本文"], "メモ.txt", { type: "text/plain" })], folderId);
const file = describeEntries(imported.snapshot.entries).find(entry => entry.kind === "file")!;
const changed = applyAction(imported.snapshot,
  { action: "rename", ids: [file.id], name: "会議メモ.txt" });
const payload = getSavePayload(baseline, changed);
// payloadをどのストレージへ保存するかは呼び出し側で決めます。
```

| API | 動作 |
| --- | --- |
| `createSnapshot(entries)` | ホストの一覧をコピーし、名前・ID・親参照・階層を検証します。返却配列は呼出し側が所有します。 |
| `createDraftSnapshot(entries)` | 同じ検証に加え、項目・配列・スナップショットをfreezeします。以後は操作が返す新しいスナップショットを使います。 |
| `applyAction(snapshot, action, uploadOptions?)` | GUIと同じ `ExplorerAction` の7操作を適用します。入力を変更せず、失敗時に途中の変更を残しません。 |
| `addFiles(snapshot, files, parent, uploadOptions?, decisions?, session?)` | 取込後のスナップショットを返します。ファイルのbytesをアップロードしません。 |
| `addFilesWithResult(...)` | `{ snapshot, result: ExplorerUploadResult }` を返します。新規・上書き・スキップ・除外件数を確認できます。 |
| `addFilesAsync(...)` / `addFilesWithResultAsync(...)` | 内容検査を含む非同期追加。動画の既定4時間やPDF/PPTX制限はこちらを使います。最後の引数に `{ signal? }` を指定できます。[引数と例](./upload-content-limits.md#画面なしの追加と互換性) |
| `prepareFilesWithProgress(...)` | 同じ取込処理を `Generator<ExplorerImportProgress, { snapshot, result }>` として進めます。途中の候補を公開せず、完了時にまとめて返します。 |
| `prepareFilesWithProgressAsync(...)` | 内容の非同期検査を含む `AsyncGenerator`。`inspecting` フェーズの進捗も取得できます。 |
| `getSavePayload(baseline, draft)` / `hasChanges(baseline, draft)` | 保存対象の最終一覧・差分、変更の有無を取得します。差分の項目も内部からコピーします。 |
| `describeEntries(entries)` / `describeEntry(entries, entry)` | パスを含む `ExplorerItemInfo` を取得します。 |
| `formatExplorerPath(entries, folderId)` / `resolveExplorerPath(...)` | 仮想フォルダのパスを生成・解決します。厳密な絶対パス解決には次のAPIを使います。 |
| `resolveExplorerNavigation(entries, path)` | 絶対パスを既存フォルダへ解決します。 |
| `resolveExplorerFileTargets(entries, targets)` | 同じ親にあるファイルをIDまたは絶対パスから解決します。 |
| `resolveExplorerEntryTargets(entries, targets)` | ファイル・フォルダをIDまたは絶対パスから一括解決し、`value.entryIds` を返します。親が異なる項目も解決できます。 |
| `readEntryFile(entry, reader?)` | ローカル `File` を返すか、明示的に渡した `ExplorerFileReader` を呼びます。認証や通信の実装はホストが所有します。 |

`ExplorerEntry` / `ExplorerSnapshot` / `ExplorerAction` / `ExplorerSavePayload` / `ExplorerItemInfo`、取込・パス解決の型もこの入口からimportできます。ファイル本体の `File` は不変のオブジェクトとして共有します。JSON保存形式を新設するAPIではなく、永続化や本体参照の変換はホストが担当します。

## 画面なしの同名競合解決

取込は一括適用です。未解決の同名競合は `ExplorerUploadConflictError`、制限違反の一括拒否は `ExplorerUploadValidationError` をthrowし、入力スナップショットは保持します。確認ダイアログは表示しません。

```ts
import {
  addFilesWithResult, createExplorerUploadSession, ExplorerUploadConflictError,
  type ExplorerSnapshot, type ExplorerUploadDecision,
} from "@likex/explorer/model";

function replaceConfirmed(snapshot: ExplorerSnapshot, files: readonly File[], parentId: string) {
  const session = createExplorerUploadSession();
  try {
    return addFilesWithResult(snapshot, files, parentId, undefined, [], session);
  } catch (error) {
    if (!(error instanceof ExplorerUploadConflictError)) throw error;
    // ここでは全競合の上書きをホストが承認済みであることを前提にします。
    const decisions: ExplorerUploadDecision[] = error.conflicts.map(conflict => ({
      fileIndex: conflict.fileIndex, existing: conflict.existing, action: "overwrite",
    }));
    return addFilesWithResult(snapshot, files, parentId, undefined, decisions, session);
  }
}
```

`action: "skip"` も指定できます。同じバッチの再試行には同じ `session` と同じ入力ファイル・取込先を使います。確認した `existing` が変われば改めて競合になります。確認後の適用直前に最新のスナップショットを渡す責任は呼出し側にあります。`prepareFilesWithProgress` でも同じ引数・例外・再試行契約を使います。

## UIとの責務と互換性

純粋モデルAPIは `features`、`readOnly`、編集許可、UI通知、保存処理を管理しません。これらが必要な表示中のExplorerには[refの操作API](./api-reference.md#mounted-commands)を使います。Reactで独自UIを構築する場合は、既存の `useExplorerDraft` も引き続き利用できます。

動画は既定で4時間以下です。内容検査が必要なファイルを既存の同期追加APIへ渡すと、検査済みの同じセッションでない限り `ExplorerUploadInspectionRequiredError` になります。非同期APIへ変更してください。Node.jsの動画・音声解析は `upload.inspectFile` を注入します。PDF・PPTXは標準処理で検査できます。[内容制限の対応範囲](./upload-content-limits.md)

改名時の拡張子固定をGUI・カスタムメニュー・ref・`useExplorerDraft`・モデルAPIで統一しました。以前の低レベル `apply({ action: "rename" })` が許していた、拡張子の変更・追加・除去はエラーになります。ファイル名全体を渡す形式は変わりません。例えば `a.TXT` から `b.txt` は可能ですが `b.csv` や `b` は不可、`README` から `LICENSE` は可能ですが `README.txt` は不可です。フォルダは名前全体を変更できます。別形式のファイルを作成する場合は、新しい名前で作成・取込し、不要な元ファイルを削除します。保存形式の識別子やバージョンを変更する対応ではありません。
