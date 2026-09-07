# 同時編集と編集許可

[ドキュメント一覧](./README.md)

親とサーバーで楽観ロック・悲観ロックを実装する例と、編集セッション・低レベルフックの契約です。

<a id="concurrency-control"></a>

## 楽観ロック・悲観ロックを選ぶ

現在のインターフェースで、どちらの方式も親・サーバー側の実装に接続できます。Explorerにロック方式を指定する専用propはありません。`onEditRequest` は編集開始の許可、`onSave` は保存を委譲する入口です。内部の `"view"` / `"edit"` は画面の編集セッションを表し、サーバーロックの有無を表すものではありません。

| 観点 | 楽観ロック | 悲観ロック |
| --- | --- | --- |
| 編集開始 | ロックを取らず、各ユーザーが下書きを編集します。 | 最初の有効な変更の適用前に `onEditRequest` で親がロックを取得し、許可後に反映します。 |
| 主に使うコールバック | `onSave`。`onEditRequest` は省略できます。 | `onEditRequest` と `onSave`。 |
| 保存時の確認 | 読み込んだ一覧の `version` と現在の値を、サーバーが比較して更新します。 | サーバーがロックの所有者・有効期限と、必要なバージョンを検証して更新します。 |
| 競合した場合 | 保存を拒否し、Explorerの下書きを残して通知します。 | 開始時に `false` を返し、変更を始めません。ロック失効などは保存時にも検出します。 |
| 運用上の特徴 | 他の人の編集を待たずに進められます。編集後に競合が分かるため、競合時の案内が必要です。 | 編集開始時に排他できます。取得・更新・解放・期限切れを管理する必要があります。 |

同時編集の衝突が少なく、最後にまとめて保存する運用なら、まず楽観ロックを使う構成が扱いやすいです。競合後のやり直しが特に高コストな業務では、悲観ロックを選べます。悲観ロックと保存時のバージョン検証の併用も可能です。

**`onEditRequest` の省略だけでは競合検出は有効になりません。** 省略時は編集を無条件で許可するため、楽観ロックにする場合も親の `onSave` とサーバーで条件付き保存を実装します。`onSave` 自体を省略した場合は、従来どおり読み取り専用です。

### 楽観ロック：onSaveでバージョンを検証する例

親は一覧とその `version` を同じ読み込み結果として保持し、保存時にそのバージョンを渡します。次の `saveConditionally` は利用先で実装するホストヘルパーで、このコンポーネントが提供するAPIではありません。サーバーがバージョンの比較と更新を一体で行い、競合時には保存を確定させない契約です。

```tsx
"use client";

import { useRef, useState } from "react";
import Explorer, {
  type ExplorerEntry,
  type ExplorerSavePayload,
  type ExplorerSaveHandler,
} from "@/components/explorer";

type VersionedWorkspace = Readonly<{
  version: string;
  entries: readonly ExplorerEntry[];
}>;
type SaveResult =
  | Readonly<{ status: "saved"; snapshot: VersionedWorkspace }>
  | Readonly<{ status: "conflict" }>;

declare function saveConditionally(request: {
  workspaceId: string;
  expectedVersion: string;
  payload: ExplorerSavePayload;
}): Promise<SaveResult>;

type Props = {
  workspaceId: string;
  initialSnapshot: VersionedWorkspace;
};

export default function OptimisticExplorer({ workspaceId, initialSnapshot }: Props) {
  const [initial] = useState(() => initialSnapshot);
  const version = useRef(initial.version);

  const onSave: ExplorerSaveHandler = async payload => {
    const result = await saveConditionally({
      workspaceId,
      expectedVersion: version.current,
      payload,
    });
    if (result.status === "conflict") {
      throw new Error("他のユーザーが更新しています。変更内容を確認してから読み直してください。");
    }
    // 保存成功時だけ、次の保存に使うバージョンとExplorerの比較元を進める。
    version.current = result.snapshot.version;
    return result.snapshot.entries;
  };

  return <Explorer initialEntries={initial.entries} onSave={onSave} />;
}
```

例えばA・Bがともに `version: "17"` を読み、Aの保存で `"18"` になった場合、Bの `expectedVersion: "17"` による保存は競合です。`onSave` がthrow / rejectするとExplorerは下書き・編集状態を維持し、エラーを表示します。親のバージョンも `"17"` のままにします。**競合時にバージョンだけを最新値へ進めて、古い下書きをそのまま再送してはいけません。** 別ユーザーの変更を上書きするためです。

競合解決のための自動マージや差分比較UIは内蔵していません。まずは親が競合を通知し、必要なら下書きを退避してから再読込する運用にできます。`initialEntries` は初回だけ読むため、親が新しい一覧とバージョンを読み直したら、この例の `OptimisticExplorer` のReact `key` を変更して両方を再初期化します。別の `workspaceId` を表示する場合も同様です。再マウントで未保存の下書きは失われるため、利用者が内容の扱いを決めた後に行います。通常の保存成功では再マウントは不要です。

楽観ロックでも `onEditRequest` を権限確認や編集開始時の最新一覧取得に利用できます。`{ allowed: true, entries }` で比較元を更新する場合、親の保存用バージョンもその一覧と対応する値に合わせます。編集開始時に最新データを読んでも、その後の競合に備えた保存時の検証は必要です。

### Blobと複数ファイルを保存する場合

Azure Blob単体では、読み込み時の `ETag` を保存時の `If-Match` 条件に使えます。不一致の場合はHTTP 412となり、対象Blobへの条件付き更新は行われません。これはファイル内容のハッシュ比較とは別の仕組みです。[Microsoftの同時実行制御の説明](https://learn.microsoft.com/en-us/azure/storage/blobs/concurrency-manage)

Explorerの保存には複数ファイルの追加・変更・削除や階層変更が含まれます。各Blobへの `If-Match` だけでは、一覧全体の保存が一括で成功・失敗することを保証できません。全体の整合性が必要なら、親・サーバー側で一覧の `revision` を条件付きで確定する保存手順を組み立てます。DBで管理する一覧にはトランザクションを使えますが、その保護範囲にBlob本体の書込み・削除は含まれません。

例えば、新しい本体を準備した後に一覧マニフェストを条件付き更新して公開する方式があります。確定前に現在の一覧が参照している本体を上書き・削除せず、失敗した準備データの回収も外側で扱います。保存失敗時にExplorerが下書きを保持しても、すでに行われた外部ストレージへの変更を巻き戻すわけではありません。コンポーネントは保存方式やロックの粒度を固定しません。

同じExplorerから開いた親・子・孫は下書きを共有しますが、別ページ・別のExplorerインスタンス・別ユーザーとの競合はサーバー側で検出します。`onEvent` は観測専用なので、その戻り値で保存を拒否することはできません。

## 編集開始の許可とセッションを親で管理する

`onEditRequest?: ExplorerEditHandler` で、最初の有効な変更を適用する直前に親へ許可を問い合わせられます。Explorerは初期状態を閲覧モード `"view"` とし、その変更を1件保留して許可を待ちます。許可後は `"edit"` となり、同じセッション内の操作では再取得しません。未指定の場合は同期で許可するため、外部ロックを使わない既存の編集も継続できます。

| 操作の段階 | `onEditRequest` のタイミング |
| --- | --- |
| 名前変更欄を開く・入力する・キャンセルする | 要求しません。 |
| 作成・移動・複製・削除のダイアログを開く・キャンセルする | 要求しません。 |
| 内部コピー・切り取りをクリップボードに準備する | 要求しません。実際に項目を増やす・移動する貼り付け時に判定します。 |
| 名前変更を確定する、ダイアログで作成・移動・複製・削除を実行する | 入力と変更内容を検証し、最初の有効な変更を反映する直前に要求します。 |
| 貼り付け・ファイル追加・ドロップ・お気に入りの登録や解除 | 有効な変更を反映する直前に要求します。ファイル選択画面を開く段階では要求しません。 |
| 同じ名前での確定・同じフォルダへの移動等の無変更、不正入力、取り込みの全件拒否・全件除外 | 要求しません。必要な入力エラーや取り込み結果の通知は従来どおり表示します。 |

`readOnly: true` または `onSave` の省略は、編集を禁止する別の設定です。その状態では許可を要求せず、`onEditRequest` があっても編集できません。閲覧モード `"view"` では許可を要求する編集の入口を残し、検索・選択・フォルダ移動・プレビュー・ダウンロード等をそのまま利用できます。

```ts
type ExplorerEditMode = "view" | "requesting" | "edit";
type ExplorerEditRequest = Readonly<{
  action: ExplorerAction["action"] | "upload" | "save";
  ids: readonly string[];
  items: readonly ExplorerItemInfo[];
  windowId: string;
  destinationId?: string;
  destinationPath?: string;
  destination?: ExplorerItemInfo;
}>;
type ExplorerEditContext = Readonly<{
  requestId: string;
  signal: AbortSignal;
}>;
type ExplorerEditResult = boolean | Readonly<{
  allowed: true;
  entries?: readonly ExplorerEntry[];
}>;
type ExplorerEditHandler = (
  request: ExplorerEditRequest,
  context: ExplorerEditContext,
) => ExplorerEditResult | Promise<ExplorerEditResult>;
```

これらの型は公開入口からimportできます。`request` は許可を待っている操作と対象の情報です。移動先がルートの場合は `destinationId: "root"`、`destinationPath: "/"` とし、実項目ではないため `destination` を省略します。編集許可のない状態で残っている未保存データを保存する場合は `action: "save"` で改めて許可を取得します。`requestId` はExplorerの要求識別子で、サーバーが発行するロックトークンとは別です。

| 親の結果 | Explorerの扱い |
| --- | --- |
| `true` / `{ allowed: true }` | 編集モードに入り、保留していた操作を再検証して進めます。 |
| `{ allowed: true, entries }` | 取得時点の最新一覧を検証して下書き・比較元を更新し、その一覧に対して保留操作を再検証します。未保存変更がある場合の一覧差し替えは拒否します。 |
| `false` | 閲覧モードに戻り、他のユーザーが編集中のため変更できない旨を表示します。操作は適用しません。 |
| throw / Promiseのreject | 閲覧モードに戻り、許可の取得失敗を表示します。保留操作は適用しません。 |

許可の要求中は後続の編集をキューへ追加しません。対象や移動先が最新一覧からなくなっていた場合は、その操作を中止します。同じ名前の別IDへ勝手に適用することもありません。許可取得用の最新一覧は `initialEntries` のprop変更で渡すのではなく、上の戻り値で渡します。

### 保存・終了・複数ウィンドウの扱い

| 状況 | 編集セッション |
| --- | --- |
| 許可の要求中 | `"requesting"`。「許可待ちを取り消す」で中止できます。操作元のビューを閉じた場合も保留要求を取り消します。 |
| 許可取得後 | `"edit"`。親・子・孫で1つのセッションを共有します。取得に使った子を閉じただけでは終了しません。 |
| 保存成功・変更の破棄 | `"view"` へ戻り、`signal` をabortします。次の有効な変更で再取得します。 |
| 最新一覧の再取得に成功 | 下書きと比較元を置き換え、`reason: "refreshed"` でセッションを終了します。取得に失敗した場合はセッションを保持します。 |
| 取得済みセッションで差分がないときの保存ボタン | `onSave` を呼ばずセッションを終了します。「編集を終了」ボタンの代わりに、この場合も保存ボタンを使えます。 |
| 公開フックの `endEdit()` | 変更がない場合に、親の独自UIからセッションを終了できます。Explorer内に「編集を終了」ボタンは表示しません。 |
| 保存失敗 | 下書きと編集セッションを保持します。修正・再保存ができます。 |
| 変更を元に戻して差分がなくなっただけ | セッションは維持します。保存・破棄または公開フックの `endEdit()` で終了します。 |
| `readOnly` への変更・`onSave` の省略・アンマウント | 取得中の要求または取得済みセッションを終了し、`signal` をabortします。 |

`context.signal` は許可の取得が終わっても有効で、**編集セッションの終了まで**使います。`onEvent` の `type: "edit-mode"` で遷移を観測できますが、通知の戻り値で許可・不許可を決めることはできません。`ExplorerEditModeEvent` / `ExplorerEditEndReason` も公開型です。

`ExplorerPopup` はlauncherがマウントされている間、最初の表示を閉じても下書きと取得済みセッションを保持します。表示の終了と、共有ワークスペースの終了は別です。表示を閉じたら編集も終了する運用なら、親が `onOpenChange(false)` 等で `readOnly` を切り替えるか、launcherをアンマウントします。アンマウントでは未保存の下書きも失われます。

読み取り専用への切替で残った未保存データを再編集する場合は、親がバージョンを確認して `entries` を省略して許可するか、未保存データをどう扱うか決めてから読み直します。未保存データがある状態で新しい `entries` を返して上書きする方式にはしません。読み取り専用中は破棄操作も使えないため、親で確認してReactの `key` を変更し、新しいワークスペースとして開く方法もあります。

### 悲観ロック：サーバーロックとonSaveをつなぐ例

次の例は、通常の「最初の有効な変更を確定 → ロック取得と最新一覧の読込 → 変更の反映 → 保存」の流れです。名前変更欄やダイアログを開くだけではロックを取得しません。`acquireEditLock`、`saveWithEditLock`、`releaseOwnEditLock` は**利用先で実装するホストヘルパー**で、このコンポーネントが提供するサーバーAPIではありません。ロックの保持先・認証方式には依存しません。

```tsx
"use client";

import { useRef } from "react";
import Explorer, {
  type ExplorerEditHandler,
  type ExplorerEntry,
  type ExplorerProps,
  type ExplorerSavePayload,
  type ExplorerSaveHandler,
} from "@/components/explorer";

type EditLock = Readonly<{
  token: string;
  version: string;
  entries: readonly ExplorerEntry[];
}>;

// サーバー側で対象ワークスペースのロックを取得し、最新一覧を返す。
// 他ユーザーが編集中ならnull。トークンは取得のたびに別の値にする。
declare function acquireEditLock(options: { signal: AbortSignal }): Promise<EditLock | null>;
// 保存時にtokenの所有権・有効期限とversionを原子的に検証して書き込む。
declare function saveWithEditLock(
  payload: ExplorerSavePayload,
  lock: { token: string; version: string },
): Promise<readonly ExplorerEntry[]>;
// 一致するtokenのロックだけを解放する。別の取得済みロックは解放しない。
declare function releaseOwnEditLock(token: string): Promise<void>;

type Props = Omit<ExplorerProps, "onEditRequest" | "onSave">;

export default function LockedExplorer(props: Props) {
  const activeLock = useRef<EditLock | null>(null);

  const onEditRequest: ExplorerEditHandler = async (_request, { signal }) => {
    const acquired = await acquireEditLock({ signal });
    if (!acquired) return false;

    const release = () => {
      if (activeLock.current === acquired) activeLock.current = null;
      void releaseOwnEditLock(acquired.token).catch(() => {
        // 利用先でログ・再試行を扱う。画面終了時の通信はTTLでも補完する。
        console.error("編集ロックの解放を確認できませんでした");
      });
    };
    // 取消しの後で取得応答が届いても、自分が取得したロックを残さない。
    if (signal.aborted) {
      release();
      return false;
    }
    activeLock.current = acquired;
    signal.addEventListener("abort", release, { once: true });
    return { allowed: true, entries: acquired.entries };
  };

  const onSave: ExplorerSaveHandler = async payload => {
    const owned = activeLock.current;
    if (!owned) throw new Error("編集ロックを取得し直してください");
    return saveWithEditLock(payload, { token: owned.token, version: owned.version });
  };

  return <Explorer {...props} onEditRequest={onEditRequest} onSave={onSave} />;
}
```

保存成功でExplorerがセッションを終了し、上のabortリスナーがロックを解放します。保存失敗では解放せず、同じセッションを保持します。解放処理は取得したトークンを閉じ込めておき、古い要求の応答や解放が後から届いても、新しいセッションの参照や別ユーザーのロックを消さないようにします。

ロックの取得・更新・解放、TTLによる期限切れ、保存時のトークンとバージョン検証は親とサーバーの責務です。長い編集に必要な更新処理はセッション中だけ行い、signalのabortで止めます。ロック更新に失敗した場合は、親が `readOnly` 等で編集を止め、保存APIも失効済みトークンを拒否します。

画面の終了や通信中断だけではサーバーロックが必ず解放されるとは限らず、取得応答そのものを失う場合もあります。そのためTTLと、所有トークンを照合した解放を組み合わせます。保存中に読み取り専用へ切り替えて解放が先に届く場合も、保存APIが同じロック・バージョンの検証と書込みを一体で行い、競合を処理します。Explorerの閲覧・編集モードだけをサーバーの排他制御として扱うことはできません。

### useExplorerDraftから直接操作する

コンポーネント内では入力の検証・許可の取得・操作の再検証を自動で行います。`useExplorerDraft` を直接使う場合は、`prepareAction()` / `prepareAdd()` で先に変更を検証し、実変更があるときだけ `requestEdit(intent)` を待って準備した変更を確定できます。名前変更欄を開く段階で `requestEdit()` を呼ぶ必要はありません。これは明示的な許可取得APIなので、独自UIからの呼び出しタイミングは親が決めます。

`onEditRequest` を指定した状態で、有効な変更を許可前に直接 `apply()` / `add()` すると「編集を開始してから変更してください」というエラーになります。変更なし・不正入力・取り込みの全件拒否・全件除外は、先に検証して許可を要求しません。`onEditRequest` 未指定なら、従来どおり同期の `apply()` / `add()` で有効な変更を適用できます。

```ts
type ExplorerEditIntent = Readonly<{
  action: ExplorerAction["action"] | "upload" | "save";
  ids?: readonly string[];
  parent?: string;
  windowId?: string;
}>;
```

| hookの返却値・操作 | 契約 |
| --- | --- |
| `editMode` / `editError` | 現在のモードと取得エラー。`readOnly` はこれとは別の編集禁止設定です。 |
| `prepareAction(action)` | 入力を検証し、変更がなければ `null`、変更があれば確定用の `() => boolean` を返します。不正入力はthrowします。許可の取得や下書きの変更は行いません。 |
| `prepareAdd(files, parent, decisions?, session?)` | 取り込みを検証・分類し、`{ changed, result: ExplorerUploadResult, commit() }` を返します。未回答の同名競合は `ExplorerUploadConflictError`、全件拒否は `upload.rejected` 通知とthrowです。下書きはまだ変えず、アンマウント後は `undefined` を返します。確認の引数は[同名ファイルの上書き確認](./uploads.md#upload-conflicts)を参照してください。 |
| `requestEdit(intent)` | `boolean \| Promise<boolean>`。明示的に許可を要求します。既に許可済みなら `true`、要求中の重複や編集禁止時は `false`。 |
| `cancelEditRequest(windowId?)` | 取得中の要求を取り消します。ウィンドウIDを渡すとその操作元の要求だけが対象です。取得済みセッションの終了には使いません。 |
| `endEdit()` | 変更がなければセッションを終了します。保存中・未保存変更がある場合はthrowします。 |
| `getEditState()` / `getEntries()` | 非同期の許可取得後に、現在のセッションと一覧を取得します。状態は `mode` / `requestId` / `error` / `errorRequestId` を持ち、取得失敗の表示は `errorRequestId` で要求を照合できます。古いrender時の値で操作を再開しないために使います。 |
| `save(windowId?)` / `discard()` | 保存成功・破棄でセッションを終了します。許可を取り直す保存では、任意の `windowId` を操作元として渡せます。変更がない状態の `save()` は `onSave` を呼ばずセッションを終了します。保存失敗は保持します。 |

例えば独自の名前変更UIからは、入力確定時に準備し、同じ要求の許可がまだ有効かと対象IDを確認してから適用します。準備した確定処理も、許可取得後に一覧やアップロード設定が変わっていれば最新状態で再検証します。

```ts
import { useExplorerDraft, type ExplorerAction } from "@/components/explorer";

async function renameFromHost(
  draft: ReturnType<typeof useExplorerDraft>,
  id: string,
  name: string,
) {
  const action: ExplorerAction = { action: "rename", ids: [id], name };
  const commit = draft.prepareAction(action);
  if (!commit) return; // 同じ名前など、実変更のない入力では取得しない。
  const permission = draft.requestEdit(action);
  const requestId = draft.getEditState().requestId;
  if (!(await permission)) return;
  const current = draft.getEditState();
  if (current.mode !== "edit" || current.requestId !== requestId) return;
  if (!draft.getEntries().some(entry => entry.id === id)) {
    throw new Error("名前を変更する項目が見つかりません");
  }
  commit();
}
```

`prepareAdd()` では `changed === true` のときだけ許可を求めます。件数には新規追加と上書きが別々に入るため、`addedCount` だけで変更の有無を判断しません。全件スキップ・除外の場合も `commit()` は呼び、`skipped` 通知と結果を受け取ります。`commit()` の戻り値が最終的な `ExplorerUploadResult` で、準備後に設定や対象項目が変われば再検証し、競合の再確認が必要になることもあります。準備した確定処理の成功後にもう一度呼んでも、同じ変更を重ねて適用しません。

`ExplorerEditIntent` と `ExplorerEditState` も公開入口からimportできます。`getEntries()` で得た現在の下書きへ直接代入せず、変更は `apply()` / `add()` で行います。
