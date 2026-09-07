# ダウンロードと外部ジョブの連携

[ドキュメント一覧](./README.md)

内蔵ZIPの制約、親へのダウンロード委譲、認証API・Azure Functionとの連携例をまとめます。

## フォルダをZIPでダウンロードする

`features.download` は既定で `true` です。`onDownloadRequest` を指定しない場合、ファイルを選ぶとその本体、フォルダを選ぶとそのフォルダ全体のZIPをダウンロードします。ZIPには選んだフォルダ自身を最上位に含め、子フォルダ・ファイル・空フォルダの階層を保ちます。例えば `資料` を取得したZIPの中には `資料/議事録.txt` や空の `資料/下書き/` が入ります。

ZIPは圧縮を行わない形式で、現在の下書きからクライアント内で生成します。未保存の追加・改名・移動も反映します。既存本体は `readFile(sourceId)`、ローカル追加分は保持している `File` から読みます。`onSave` は呼び出さず、元のファイルや保存先も変更しません。途中で1つでも読込に失敗した場合はエラーを通知し、不完全なZIPのダウンロードを開始しません。

ZIP64には未対応です。ヘッダーを含む生成ZIP全体は4,294,967,295バイト未満（4 GiB未満）、格納エントリーは最大65,534件です。エントリー数にはフォルダも含み、ZIP内の各パスはUTF-8で65,535バイトまでです。上限を超える場合はエラーにします。生成に必要な本体をブラウザ内で扱うため、これらの形式上の上限より小さい場合でも、利用端末のメモリに収まる規模を前提にしてください。

`features.download: false` はファイル・フォルダ両方の取得経路と案内を隠します。`onEvent` の `download` は開始・成功・失敗を通知します。内蔵処理の成功は `result.status: "handed-off"` で、ブラウザへ取得を引き渡した時点です。公開型 `ExplorerDownloadRequest` は `ExplorerItemInfo` と同じ項目情報で、`kind: "file" | "folder"` を持ちます。フォルダ要求の `name`・`path` は対象フォルダを表し、全項目一覧は次の外部ハンドラーの `context.items` で渡します。

## ダウンロードを親へ委譲して進捗を受け取る

`onDownloadRequest?: ExplorerDownloadHandler` を指定すると、ファイル・フォルダのダウンロード本体を親へ任せます。`Explorer` と `ExplorerPopup` で共通です。指定時はExplorerによる本体の先読み、ZIP作成、リンクのクリックを行わず、外部処理が失敗しても内蔵処理へ切り替えません。未指定なら上記の内蔵処理を使います。

```ts
type ExplorerDownloadRequest = ExplorerItemInfo;
type ExplorerDownloadItem = ExplorerItemInfo & Readonly<{ archivePath: string }>;
type ExplorerDownloadProgress = Readonly<{
  phase: "accepted" | "preparing" | "ready" | "transferring";
  message?: string;
}>;
type ExplorerDownloadResult = Readonly<{
  status: "handed-off" | "completed" | "cancelled";
  message?: string;
}>;
type ExplorerDownloadContext = Readonly<{
  requestId: string;
  windowId: string;
  ownerDocument: Document | null;
  signal: AbortSignal;
  items: readonly ExplorerDownloadItem[];
  reportProgress: (progress: ExplorerDownloadProgress) => void;
}>;
type ExplorerDownloadHandler = (
  request: ExplorerDownloadRequest,
  context: ExplorerDownloadContext,
) => ExplorerDownloadResult | Promise<ExplorerDownloadResult>;
```

以上の型は `@/components/explorer` からimportできます。`request` はクリックした項目のID・名前・パス・拡張子・本体参照等です。`context` はその1回の実行に使います。

| `context` の項目 | 契約 |
| --- | --- |
| `requestId` | Explorerが実行ごとに発行する識別子。外部APIのjob IDとは別です。 |
| `windowId` / `ownerDocument` | 操作元の識別子と文書。メインは `"main"`、子・孫はそのウィンドウIDです。ダウンロード用DOMを作る場合はこの文書を使い、利用できなければエラーまたは取消しにします。 |
| `signal` | 操作元ビューの終了、ダウンロード機能の無効化、アンマウントで中止を伝えます。親のfetch・待機処理へ渡し、リンクを開く直前にも確認します。 |
| `items` | 対象自身と、フォルダの場合はその全配下。呼出時点の下書きのコピーで、以後の改名・移動・保存によって差し替わりません。メタデータは読み取り専用、ローカル `File` 本体は元の参照を維持します。 |
| `reportProgress` | 処理途中の段階と任意の表示文言をExplorerへ伝えます。呼んだだけでは成功・失敗・取消しを確定しません。 |

`items[].path` はExplorer上の絶対パス、`archivePath` はZIP等の中で使う相対パスです。例えば `/部署/資料` の取得では、対象自身が `資料/`、配下が `資料/議事録.txt` や `資料/下書き/` になります。単体ファイルならそのファイル名です。空フォルダも含むため、サーバー側でZIPを作る場合も、現在の階層を再現できます。

| 親から伝える内容 | 意味 |
| --- | --- |
| `reportProgress({ phase: "accepted" })` | リクエストが受理された段階。APIの202応答等で使います。 |
| `phase: "preparing"` / `"ready"` / `"transferring"` | 準備中 / 準備完了 / 転送中。実際に確認できた段階だけ通知します。`message` で「リクエストを送信しました」等の文言を指定できます。 |
| `return { status: "handed-off" }` | ブラウザーへダウンロードを引き渡した段階。端末への保存完了は未確認です。 |
| `return { status: "completed" }` | 親が端末への保存完了を確認できる方式の場合だけ使います。サーバー上のZIP生成完了や `fetch(...).blob()` の完了だけでは、この結果にしません。 |
| `return { status: "cancelled" }` | 親側の操作等で取り消した場合。失敗としては扱いません。 |
| `throw new Error(message)` / Promiseのreject | ダウンロード処理の失敗。Explorerと `onEvent` に通知します。 |

進捗の順序は `accepted → preparing → ready → transferring` です。段階の省略はできますが、一度進んだ段階から前へ戻る通知や、同じ段階・同じ文言の重複通知は無視します。同じ段階でも文言の更新はできます。`AbortError` は失敗ではなく取消しとして扱います。

戻り値は必須です。`void` を返したり、202応答の直後に処理を切り離して終了したりせず、待機と引渡しまでをPromiseに含めます。一般的なダウンロードリンクのクリックから端末保存の完了は確認できないため、その方式では `handed-off` を返します。ブラウザー側が取得を中止する場合もあります。[HTMLのダウンロード仕様](https://html.spec.whatwg.org/multipage/links.html#downloading-resources)

### Next.jsの認証APIで取得先URLを用意する

以下の `requestDownloadUrl` は**利用先で実装するホストヘルパー**です。例えば認証付きのNext.js APIを呼び、アクセス権を確認して、ダウンロード用のURLとファイル名を返します。Explorerやこのリポジトリが提供するAPIではありません。URLは操作元文書で解決できる絶対URLとし、必要な認証は親のAPIで扱います。

```tsx
"use client";

import Explorer, {
  type ExplorerDownloadContext,
  type ExplorerDownloadHandler,
  type ExplorerDownloadItem,
  type ExplorerDownloadResult,
  type ExplorerProps,
} from "@/components/explorer";

type DownloadLink = { url: string; filename: string };

// ホスト側で実装: Next.jsの認証APIへ要求し、応答を検証して返す。
declare function requestDownloadUrl(
  items: readonly ExplorerDownloadItem[],
  options: { signal: AbortSignal },
): Promise<DownloadLink>;

function handOffDownload(
  link: DownloadLink,
  context: ExplorerDownloadContext,
): ExplorerDownloadResult {
  context.signal.throwIfAborted();
  const doc = context.ownerDocument;
  if (!doc?.body || doc.defaultView?.closed) {
    throw new Error("ダウンロードを開始する画面がありません");
  }
  const anchor = doc.createElement("a");
  anchor.href = link.url;
  anchor.download = link.filename;
  doc.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
  }
  return { status: "handed-off", message: "ブラウザーへダウンロードを引き渡しました" };
}

const download: ExplorerDownloadHandler = async (_request, context) => {
  context.reportProgress({ phase: "preparing", message: "ダウンロードを準備しています" });
  const link = await requestDownloadUrl(context.items, { signal: context.signal });
  context.reportProgress({ phase: "ready", message: "取得先の準備ができました" });
  return handOffDownload(link, context);
};

export default function HostExplorer(props: Omit<ExplorerProps, "onDownloadRequest">) {
  return <Explorer {...props} onDownloadRequest={download} />;
}
```

同一オリジンの認証APIからファイルを返す方法や、期限付きのストレージURLを返す方法を親で選べます。別オリジンのURLでは `download` 属性だけに頼らず、応答に `Content-Disposition: attachment` 等を設定します。URL遷移先での認証失敗や保存取消しは、このクリック処理では検出できません。[HTMLのダウンロード仕様](https://html.spec.whatwg.org/multipage/links.html#downloading-resources)

### Azure Functionの準備ジョブを待つ

Next.js APIが認証し、別のAzure FunctionへZIP生成等を依頼する場合も、同じハンドラーで扱えます。例えば開始APIが202とjob IDを返し、その後に状態を問い合わせます。Durable Functionsにも202応答と状態確認用URLを使う非同期処理の方式があります。すべてのAzure Functionが自動でこの方式になるわけではなく、採用するAPIの契約に合わせます。[Durable FunctionsのHTTP非同期処理](https://learn.microsoft.com/en-us/azure/durable-task/durable-functions/durable-functions-http-features)

次の2つもホストヘルパーの型です。上の `DownloadLink` と `handOffDownload` を使います。`waitForDownloadJob` は準備完了までpollingやSSE等で待ち、失敗時はthrowし、`signal` で待機を終了する実装にします。

```ts
declare function startDownloadJob(
  items: readonly ExplorerDownloadItem[],
  options: { signal: AbortSignal; requestId: string },
): Promise<{ jobId: string }>;

declare function waitForDownloadJob(
  jobId: string,
  options: { signal: AbortSignal },
): Promise<DownloadLink>;

const downloadViaJob: ExplorerDownloadHandler = async (_request, context) => {
  const { signal, reportProgress, requestId, items } = context;
  const job = await startDownloadJob(items, { signal, requestId });
  reportProgress({ phase: "accepted", message: "リクエストを送信しました" });
  reportProgress({ phase: "preparing", message: "サーバーでファイルを準備しています" });
  const link = await waitForDownloadJob(job.jobId, { signal });
  reportProgress({ phase: "ready", message: "準備が完了しました。ダウンロードを開始します" });
  return handOffDownload(link, context);
};
```

認証・Functionsへの接続・jobの状態判定・待機間隔・タイムアウト・再認証は親が実装します。Next.js側でFunctionsの管理URLやキーを管理し、ブラウザーにはアプリ用のjob IDと認証APIを公開する構成にできます。`requestId` は画面からの要求を関連付けるIDで、job IDやサーバーの重複実行防止を自動で提供するものではありません。

`context.items` には未保存のローカル `File` が入る場合があります。`JSON.stringify(items)` でファイル本体を送れるわけではありません。親がFormDataや一時アップロード等で本体を届け、`archivePath` と本体参照の対応を保つか、親側でローカル処理を選びます。既存の `source.id` だけをサーバーへ渡すと、未保存の追加や階層変更を取り落とすため、現在の `items` を処理の基準にします。ダウンロードのためにExplorerが `onSave` を呼ぶことはありません。

### 多重実行・ウィンドウ・取消し

同じワークスペースでは、同一項目の実行中の再要求を抑止し、親・子・孫から同じ処理を重複開始しません。別項目は並行して実行できます。画面内のダウンロード通知はその画面で直近に開始した要求を表示し、古い要求の完了で新しい進捗を上書きしません。親が複数の進捗を一覧表示したい場合は `onEvent` を `requestId` ごとに管理できます。

操作元ビューを閉じる、`features.download: false` にする、Explorerをアンマウントする場合は `signal` を中止し、終了後の進捗や遅れて届いた結果を無視します。別ウィンドウで進行中の独立した要求は、その操作元が残る限り継続します。`readOnly` は閲覧機能を禁止しないため、ダウンロードも継続します。

AbortSignalは親へ中止を伝えるもので、既に作成済みのFunctionsジョブやブラウザーへ引き渡した取得を停止する保証ではありません。バックエンドのジョブ取消し・一時ファイルの後片付けが必要なら、親の契約で実装します。キャンセル後のサーバー処理をExplorerが監視したり、再読み込み後にジョブを復元したりはしません。
