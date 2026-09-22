# ファイル・フォルダごとの操作可否

[ドキュメント一覧](./README.md) / [編集許可・同時編集](./concurrency.md)

`getEntryPermissions` で、親が管理するロック状態や権限に応じて操作を禁止できます。結果は編集セッション中も使い回さず、操作の準備時と反映直前に確認します。GUI、ショートカット、ドラッグ＆ドロップ、表示中のExplorerの `ref` API、カスタムメニューが返した変更に共通の制御です。

## ロック中のファイルを変更できなくする

```tsx
import Explorer, {
  type ExplorerEntry,
  type ExplorerEntryPermissionsResolver,
  type ExplorerSaveHandler,
} from "@likex/explorer";

type Lock = { ownerId: string; ownerName: string };

function Files({ entries, locks, userId, save }: {
  entries: readonly ExplorerEntry[];
  locks: Readonly<Record<string, Lock | undefined>>;
  userId: string;
  save: ExplorerSaveHandler;
}) {
  const getEntryPermissions: ExplorerEntryPermissionsResolver = entry => {
    if (entry.kind === "root") return;
    const lock = locks[entry.id];
    if (!lock || lock.ownerId === userId) return;

    const denied = {
      allowed: false,
      message: `${lock.ownerName}さんが編集中のため、変更できません。`,
    } as const;

    return {
      rename: denied,
      move: denied,
      delete: denied,
      overwrite: denied,
      favorite: denied,
      save: denied,
      // フォルダがロック対象の場合は、中への追加も禁止する。
      ...(entry.kind === "folder" ? {
        createFile: denied,
        createFolder: denied,
        upload: denied,
      } : {}),
    };
  };

  return <Explorer initialEntries={entries} onSave={save}
    getEntryPermissions={getEntryPermissions} />;
}
```

この例ではプレビュー・ダウンロード・コピーは許可したままです。親が `locks` を更新すると、次の操作は新しい設定で判定します。DBのロックキーとExplorerの `id` が異なる場合は、親で対応づけてください。`source.id` は本体の参照IDで、必ずしも項目IDと同じではありません。

## 型と判定結果

```ts
type ExplorerEntryOperation =
  | "preview" | "download" | "copy" | "move" | "rename" | "delete"
  | "favorite" | "overwrite" | "createFile" | "createFolder" | "upload"
  | "save";

type ExplorerEntryPermission = boolean | Readonly<{
  allowed: boolean;
  message?: string;
}>;

type ExplorerEntryPermissions = Readonly<
  Partial<Record<ExplorerEntryOperation, ExplorerEntryPermission>>
>;

type ExplorerEntryPermissionTarget = ExplorerItemInfo | Readonly<{
  id: "root";
  kind: "root";
  path: "/";
}>;

type ExplorerEntryPermissionsResolver = (
  entry: ExplorerEntryPermissionTarget,
) => ExplorerEntryPermissions | undefined;
```

| 結果 | 扱い |
| --- | --- |
| コールバックを省略 / `undefined` / 対象操作のキーを省略 | 個別制限なし。既存の機能設定・読み取り専用・編集許可は引き続き適用します |
| `true` / `{ allowed: true }` | その項目の操作を許可 |
| `false` / `{ allowed: false }` | 操作を中止し、既定のエラーメッセージを表示 |
| `{ allowed: false, message: "承認待ちのため削除できません" }` | 操作を中止し、指定のメッセージを表示 |
| 不正な戻り値 / throw / Promise | 許可として扱わず、エラーで中止 |

判定は**同期関数**です。サーバーから取得した状態を親が保持し、この関数から返します。非同期通信・ロック取得・ロック延長はここでは行いません。複数回呼ばれる場合があるため、副作用のない関数にしてください。渡す項目情報は呼出時点のコピーです。

`true` を返しても、`features` の無効化やExplorer全体の `readOnly` を解除することはできません。個別制限は実行時にメッセージで伝える方式で、メニューを非表示にする機能設定とは別です。

## 操作と確認対象

| 操作 | 主な確認対象 |
| --- | --- |
| `preview` | 開くファイル。内蔵・外部プレビュー共通 |
| `download` | ダウンロードするファイル、またはフォルダとその配下 |
| `copy` | コピー元と配下、コピー先。追加先には `createFile` / `createFolder` も適用 |
| `move` | 移動元と配下、移動先。切り取り時と貼り付け時にも確認 |
| `rename` | 名前変更する項目。フォルダならパスが変わる配下も確認 |
| `delete` | 削除する項目と配下 |
| `favorite` | 登録・解除する項目 |
| `createFile` / `createFolder` | 作成先フォルダ。ルートなら `{ id: "root", kind: "root", path: "/" }` |
| `upload` | 取込先と、既存フォルダへマージする場合の追加先 |
| `overwrite` | 同名アップロードで置き換える既存ファイル |
| `save` | 保存する差分の対象項目。保存直前に最新の許可で確認 |

各対象の祖先フォルダとルートにも同じ操作の制限を適用します。たとえばフォルダの `delete: false` は、そこへ移動して中のファイルだけを削除する操作にも適用します。複数選択やフォルダ操作で1件でも拒否された場合、その操作をまとめて中止し、許可された項目だけを部分適用しません。

アップロードの新規追加には、作成する種類に応じた `createFile` / `createFolder` の条件も適用します。上書き確認で許可していても、反映までに対象がロックされた場合は中止します。容量・拡張子などの `invalidFileBehavior: "skip"` は操作権限の拒否を無視する設定ではありません。

保存時は `save` に加え、保存差分から分かる作成・変更・削除の許可も再確認します。以前コピーした元ファイルの操作履歴を保存時に再実行する仕組みではありません。拒否時は `onSave` を呼ばず、下書きを保持します。変更の破棄・再読み込みは、拒否状態から回復できるよう個別制限の対象にしません。

## 表示と外部プレビュー

エラーは通常の通知領域、または現在の操作ダイアログ・名前変更欄のエラーとして表示します。拒否された操作の成功通知や変更通知は出しません。

`preview` が拒否された場合は `onPreviewRequest` を呼びません。`ref.previewFile()` / `showFile(..., { mode: "preview" })` では `code: "permission-denied"` の失敗結果を返します。選択だけの操作、フォルダ移動、検索、サムネイル表示はこの `preview` の制限には含みません。

すでに開いた親のカード・ダイアログ・別タブを閉じる処理や、親のエディターでの編集禁止は親側の責務です。カスタムメニューが返した変更プランは同じ制限に従いますが、利用側のハンドラーが独自に送信する通信や外部処理をExplorerが取り消すことはできません。

## 編集セッション・サーバーとの分担

| 入口 | 役割 |
| --- | --- |
| `onEditRequest` | Explorer全体の編集セッションを開始する許可。最初の変更時に呼ぶ非同期処理にも対応 |
| `getEntryPermissions` | 毎回の操作で、親が保持する最新の項目別ルールを確認 |
| `onSave` | 保存時のサーバー認可、ロック所有者・期限、バージョンの検証と永続化 |
| `processingEntryIds` | くるくるの表示だけ。操作禁止は `getEntryPermissions` で別に指定 |

個別制限はクライアント上の操作制御です。別ユーザーとの厳密な排他は、サーバーでロック取得・更新を一体として行い、保存時にも検証します。ロック状態の取得待ちを許可とみなしたくない場合は、親が取得完了まで対象操作を拒否してください。

## 画面なしのAPI

`useExplorerDraft` は同じ `getEntryPermissions` を受け取り、`apply`・`add`・`addAsync`・保存でも確認します。

`@likex/explorer/model` の純粋な `applyAction` 等にはホストの認証状態を持たせません。画面なしで同じ条件を使う場合は、公開ヘルパーで明示的に検証できます。

```ts
import {
  assertExplorerEntryPermissions,
  checksForExplorerAction,
  applyAction,
  type ExplorerAction,
} from "@likex/explorer/model";

const action: ExplorerAction = { action: "delete", ids: ["file-a"] };
assertExplorerEntryPermissions(
  snapshot.entries,
  checksForExplorerAction(snapshot.entries, action),
  getEntryPermissions,
);
const next = applyAction(snapshot, action);
```

拒否は `ExplorerOperationDeniedError` で識別でき、`entryId`・`operation`・`message` を取得できます。`checksForExplorerChanges(before, after)` は項目配列の差分から作成・変更・削除の確認対象を求めます。ヘルパー自身は保存・通信・通知・モデル変更を行いません。
