# ファイルプレビューの連携

[ドキュメント一覧](./README.md)

内蔵ダイアログの表示を拡張する、表示用のデータだけを差し替える、親のビューや別タブへ任せる方法です。元ファイル・表示用データ・処理中の表示を別々に管理できます。

| 目的 | 設定 |
| --- | --- |
| 内蔵ダイアログの本文を拡張 | `renderPreview` |
| PPTX等の変換済みPDF、画像、配信URLを表示 | `resolvePreviewSource` |
| 親のカード・別タブ・独自ダイアログで表示 | `onPreviewRequest` |
| 既存の内蔵表示に拡張子を追加 | `preview.formatsByExtension` |
| 変換・保存の進捗を表示 | `processingEntryIds` + `getProcessingLabel` |

表示用の差し替えは元ファイルの `name`・`mime`・`size`・`source` を変更しません。Explorerのダウンロードは引き続き元ファイルを取得します。変換、認証、保存先、ポーリングは親アプリが担当します。

## プレビューを親画面へ渡す

`onPreviewRequest` で、ファイルを開いたときの表示を親画面へ任せられます。`void` / `"handled"` を返すと親が表示を担当し、`"default"` を返すと内蔵ダイアログへ進みます。未指定の場合も内蔵ダイアログを使います。内蔵へ進む場合は、設定した `renderPreview`・`resolvePreviewSource` も有効です。

[`getEntryPermissions`](./entry-permissions.md) の `preview` が拒否された場合は、内蔵表示・外部コールバックとも実行せず、指定された理由を表示します。すでに親が開いたビューの閉じる処理や編集ロックは親が管理します。

| prop | 動作 |
| --- | --- |
| `onPreviewRequest?: ExplorerPreviewHandler` | 開くファイルの情報を受け取ります。戻り値は `void` / `"handled"` / `"default"` またはそれを返すPromise。同期例外・PromiseのrejectはExplorerがエラー通知します。 |
| `previewTrigger?: ExplorerPreviewTrigger` | `"doubleClick"`（既定）または `"click"`。`"click"` はファイル名の単クリックでプレビューします。 |

`"click"` ではファイル名クリックのプレビューを名前の再クリックによる改名より優先します。名前変更はF2、右クリックの「名前を変更」、ツールバーから開始できます。Ctrl/Cmd・Shift付きクリックによる選択や、名前以外の部分のダブルクリックは維持します。フォルダを開くときは通常どおりフォルダへ移動します。`features.preview: false` は内蔵プレビューと外部コールバックの両方を無効にします。

次の型を `@/components/explorer` からimportできます。リクエストは `ExplorerEntry` の全フィールドを持ち、ファイルに限定した `kind`、正規化済みの `extension` と現在の `path` を含みます。`ExplorerItemInfo` は、[操作・状態イベント](./events.md)でも使うファイル・フォルダ共通の情報です。

```ts
type ExplorerPreviewTrigger = "doubleClick" | "click";

type ExplorerItemInfo = Readonly<
  Omit<ExplorerEntry, "source"> & {
    source: Readonly<NonNullable<ExplorerEntry["source"]>> | null;
    path: string;
    extension: string;
  }
>;

type ExplorerPreviewRequest = ExplorerItemInfo & Readonly<{ kind: "file" }>;

type ExplorerPreviewHandler = (
  request: ExplorerPreviewRequest,
) => void | "handled" | "default" | Promise<void | "handled" | "default">;
```

| フィールド | 内容 |
| --- | --- |
| `id` | Explorer内の項目ID。ファイル本体のIDとは別です。 |
| `parent` | 親フォルダのエントリーID。最上位にあるファイルは `"root"`。 |
| `name` | 要求時点の表示名。未保存の名前変更も反映します。 |
| `kind` | プレビュー要求では常に `"file"`。フォルダはプレビュー要求の対象になりません。 |
| `size` | ファイルサイズ。単位はbytes（バイト）です。 |
| `mime` | エントリーに設定されたMIMEタイプ。例: `"application/pdf"`。 |
| `createdAt` / `updatedAt` | エントリーの作成日時・更新日時を表す、時差を含むISO 8601文字列。Blob保存先の日時を改めて取得するものではありません。 |
| `favorite` | お気に入りの状態を表す数値。`0` は未登録、通常 `1` は登録済みです。 |
| `path` | `/記事/test.pdf` のような、最新の下書き上のファイルパス。`rootLabel` は含まず、Blobの保存キーやURLを表すものではありません。 |
| `extension` | 最後の拡張子を小文字・先頭の点なしで表します。`report.PDF` は `"pdf"`、`archive.tar.gz` は `"gz"`、`README` や `.env` は `""` です。 |
| `source` | 既存ファイルは `{ kind: "existing", id }`、未保存の追加ファイルは `{ kind: "local", file }`。`local.file` は選択したブラウザーの `File` です。本体参照がない場合は `null` です。 |

Explorerはコールバックを呼ぶ前に `readFile` で本体を読み込みません。親の表示で本体が必要なら、`existing` の `source.id` を親の読込処理へ渡すか、`local.file` をそのまま使います。要求と `source` は読み取り専用の型で渡すコピーで、ローカルの `File` は元のオブジェクトを参照します。親stateに保持した要求は呼出時点の情報で、その後の移動や保存によって自動更新されません。

コールバックはユーザー操作の中で同期的に呼ばれるため、既知のURLならその場で `window.open()` を呼べます。Promiseで `"default"` を返した場合は完了を待ち、対象変更やアンマウント後の古い要求を表示しません。初期起動や `ref.previewFile()` の呼出は必ずしもユーザー操作に由来せず、別タブを開ける保証はありません。

`onEvent` の `preview.external` は `onPreviewRequest` を呼んだかを示します。コールバックが `"default"` を返しても `external: true` のままで、最終的な表示先を示す値ではありません。

<a id="initial-preview"></a>

### 指定ファイルのプレビューを最初から開く

`selectedFile` にファイルの `ExplorerEntry.id`、`selectedFileMode="preview"` を指定すると、初期選択と同時にプレビューを要求します。`selectedFileMode` の公開型は `ExplorerSelectedFileMode = "select" | "preview"` で、既定は `"select"` です。

```tsx
<Explorer
  initialEntries={savedEntries}
  selectedFile="file-report"
  selectedFileMode="preview"
  onPreviewRequest={showPreview}
/>
```

この `showPreview` は親が実装した `ExplorerPreviewHandler` です。通常のファイル操作と同じリクエストを受け取り、初期起動でもID・パス・名前・拡張子・本体参照を使えます。未指定なら内蔵プレビューを使い、既存ファイルの本体取得には `readFile` を渡します。

起動はクライアントで表示されたときに一度だけ行い、SSR中には呼びません。`ExplorerPopup` では最初の `open()` で表示されたときが対象です。`previewTrigger` の設定にかかわらず起動し、`features.preview: false` なら要求しません。読み取り専用でも利用できます。`initialPath` との組み合わせ、無効なIDの扱い、初期設定を変える方法は[導入ガイド](./getting-started.md#initial-file)を参照してください。

### 親stateで受け取り、横にカードを表示する

次の例は、要求を受け取るたびにファイル情報のカードを更新します。保存・読込関数は親から渡すため、既存ファイルと未保存のローカルファイルのどちらにも使えます。

```tsx
"use client";

import { useState } from "react";
import Explorer, {
  type ExplorerProps,
  type ExplorerPreviewHandler,
  type ExplorerPreviewRequest,
} from "@/components/explorer";

type Props = Pick<ExplorerProps, "initialEntries" | "onSave" | "readFile">;

export default function ExplorerWithPreviewCard({
  initialEntries,
  onSave,
  readFile,
}: Props) {
  const [preview, setPreview] = useState<ExplorerPreviewRequest | null>(null);
  const showPreview: ExplorerPreviewHandler = (request) => {
    setPreview(request);
  };
  const source = preview?.source;
  const sourceLabel = source?.kind === "existing"
    ? `保存済みの本体参照: ${source.id}`
    : source?.kind === "local"
      ? `未保存のFile: ${source.file.name} (${source.file.size} bytes)`
      : "本体参照なし";

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
      <div style={{ height: 640, minWidth: 0 }}>
        <Explorer
          initialEntries={initialEntries}
          onSave={onSave}
          readFile={readFile}
          previewTrigger="click"
          onPreviewRequest={showPreview}
        />
      </div>
      <aside
        aria-label="ファイルのプレビュー"
        style={{ minWidth: 0, flex: "1 1 320px", border: "1px solid #ccc", borderRadius: 8, padding: 16 }}
      >
        {preview ? (
          <>
            <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 8 }}>
              <h2 style={{ minWidth: 0, fontWeight: 600, overflowWrap: "anywhere" }}>
                {preview.name}
              </h2>
              <button type="button" onClick={() => setPreview(null)}>
                閉じる
              </button>
            </div>
            <dl style={{ marginTop: 16, fontSize: 14, overflowWrap: "anywhere" }}>
              <dt>ID</dt>
              <dd>{preview.id}</dd>
              <dt>表示パス</dt>
              <dd>{preview.path}</dd>
              <dt>拡張子</dt>
              <dd>{preview.extension || "なし"}</dd>
              <dt>本体</dt>
              <dd>{sourceLabel}</dd>
            </dl>
          </>
        ) : (
          <p>ファイル名をクリックすると、ここに情報を表示します。</p>
        )}
      </aside>
    </div>
  );
}
```

このカードはメタデータだけを表示します。同じ `preview` stateを使って、親のダイアログや独自のPDFビューアー等を表示することもできます。外部プレビューへ切り替えても、既存ファイルの内蔵ダウンロードや画像サムネイルを使う場合は、Explorerへ引き続き `readFile` を渡します。親側の表示・読込・閉じる操作は親が管理し、`features.preview` を後から無効にしたときに既存のカードを閉じる処理も親側で行います。

## 内蔵ダイアログの本文を拡張する

`renderPreview` は同期的にReact要素を返す関数です。公開型は `ExplorerPreviewRenderer`、引数の型は `ExplorerPreviewContext` です。ダイアログのタイトル・閉じる操作・元ファイルのダウンロードはExplorerが担当します。`null` / `undefined` を返すと内蔵表示へフォールバックし、`false` は本文を表示しません。

```tsx
<Explorer
  initialEntries={entries}
  readFile={readFile}
  renderPreview={({ entry, processing, processingLabel, defaultPreview }) => {
    if (entry.extension !== "pptx") return null;
    return (
      <section aria-label="プレゼンテーションのプレビュー">
        <p>{entry.path} / 元ファイル: {entry.size} bytes</p>
        {processing && <p role="status">{processingLabel ?? "処理中…"}</p>}
        {defaultPreview}
      </section>
    );
  }}
/>
```

| context | 内容 |
| --- | --- |
| `entry` | `ExplorerPreviewRequest`。表示用PDFに差し替えても、元ファイルのID・名前・パス・MIME・サイズ・本体参照を保持 |
| `processing` | 対象が処理中か。現在の `processingEntryIds` を反映 |
| `processingLabel` | `getProcessingLabel(entry)` で指定したラベル |
| `allowDownload` | ダウンロード機能のON/OFF。項目ごとの許可はダウンロード実行時に別途確認 |
| `defaultPreview` | `resolvePreviewSource` と `preview` の設定を使う内蔵本文。任意の位置に配置可能 |

非同期表示には `renderPreview={context => <CustomPreview {...context} />}` のように通常のコンポーネントを返し、そのコンポーネントのeffect等で読み込みます。`renderPreview={async (...) => ...}` やコールバック内部でのHook呼出は使いません。独自コンポーネントでは対象変更・アンマウント時のキャンセル、エラー表示、`allowDownload` の反映を親が実装します。

## 表示用データを差し替える

`resolvePreviewSource(entry, { signal, processing })` は元の `ExplorerPreviewRequest` を受け取り、同期値またはPromiseで次の記述子を返します。`null` / `undefined` は通常の `source` / `readFile` に戻します。表示用データは保存モデルや元ファイルの読込キャッシュとは別に扱われます。

公開型は `ExplorerPreviewSourceResolver`、`ExplorerPreviewSource`、`ExplorerPreviewSourceContext`、`ExplorerPreviewReadContext` です。`@likex/explorer`（ソースコピー時は `@/components/explorer`）からimportできます。

| 戻り値 | 用途 |
| --- | --- |
| `{ kind: "blob", cacheKey, mime, mode?, read }` | 変換済みデータ等。`read({ signal })` で `Promise<Blob>` を返す |
| `{ kind: "url", url, mode, cacheKey?, crossOrigin? }` | URLを直接描画。`mode` は `"image"` / `"pdf"` / `"video"` |
| `{ kind: "pending", message? }` | 変換等が未完了。原本の読込へフォールバックせず待機表示 |
| `null` / `undefined` | 元ファイルの内蔵表示 |

Blobの `mode` は `"image"` / `"pdf"` / `"video"` / `"text"` です。元ファイルと異なる形式を表示する場合は、表示用データの `mime` と `mode` を明示すると意図が明確になります。`crossOrigin` は `"anonymous"` / `"use-credentials"` で、対応する画像・動画要素へ渡します。

### 変換済みPDFを遅延取得する

次の `converted` は親が取得した変換結果の索引です。変換ジョブの起動や完了確認は親が行います。`previewUrl` は認証・認可を確認済みの表示用エンドポイントを渡します。

```tsx
<Explorer
  initialEntries={entries}
  readFile={readOriginalFile}
  processingEntryIds={convertingEntryIds}
  getProcessingLabel={() => "表示用PDFを作成しています"}
  resolvePreviewSource={(entry) => {
    if (entry.extension !== "pptx") return undefined;
    const result = converted.get(entry.id);
    if (!result) return { kind: "pending", message: "PDFへの変換を待っています" };
    return {
      kind: "blob",
      cacheKey: `${entry.id}:${result.contentVersion}:pdf-v1`,
      mime: "application/pdf",
      mode: "pdf",
      read: async ({ signal }) => {
        const response = await fetch(result.previewUrl, { signal });
        if (!response.ok) throw new Error("表示用PDFを取得できませんでした");
        return response.blob();
      },
    };
  }}
/>
```

`resolvePreviewSource` では記述子を返し、重いダウンロードは `read` へ遅延させます。同じ `cacheKey` のデータはキャッシュが保持される間再利用され、再レンダーで `read` 関数を作り直しても毎回取り直しません。キーにはファイルID、内容の版、変換形式・変換設定の版を含め、同じキーを異なる内容へ再利用しないでください。ログイン利用者やアクセス範囲によって内容が異なる場合もキーやワークスペースを分けます。URLの有効期限・内容が変わる場合は新しいURLまたはキーを渡します。

Explorerは閉じる・対象変更・不要になった取得に対して `AbortSignal` を通知し、古い結果を画面へ反映しません。親の `fetch` 等にもsignalを渡してください。表示用BlobのObject URLはExplorerが管理します。URL記述子へ親が渡したObject URLの作成・破棄は親が担当します。

### 変換中の表示を切り替える

`processingEntryIds` は表示だけの状態で、ファイルや祖先フォルダのインジケーターとプレビューへ反映します。`getProcessingLabel(entry: ExplorerItemInfo)` は省略可能で、`string | undefined` を返します。変換中でも編集を禁止せず、保存・未保存判定を変更しません。編集を制限する場合は既存の編集許可を使用します。

処理中に `pending` を返した場合、完了後に索引を更新して対象IDを `processingEntryIds` から外すと解決を再試行します。処理中に取得が失敗した場合も待機表示とし、処理完了後に再試行します。その時点でも失敗した場合はエラーを表示します。処理中フラグが変化しても、表示済みで同じデータの動画やPDFをそれだけで読み直しません。`pending` 自体はサーバーへのポーリングを開始しないため、状態の取得・更新・失敗時の再試行UIは親が管理します。変換済みファイルがすでにある場合は、処理中でもその記述子を返して表示を続けられます。

### 長い動画をURLで配信する

```tsx
<Explorer
  initialEntries={entries}
  readFile={readOriginalFile}
  resolvePreviewSource={(entry) => {
    const media = videoSources.get(entry.id);
    return media ? {
      kind: "url",
      mode: "video",
      url: media.signedUrl,
      cacheKey: `${entry.id}:${media.contentVersion}:video`,
    } : undefined;
  }}
/>
```

URLは `<video src>` へ渡すため、Explorerが事前に動画全体をBlobとして読み込む必要はありません。再生・シークには配信側のRange対応、適切なMIME、認証、URLの有効期限、必要なCORS設定を利用側が用意します。ネイティブの `src` では任意のAuthorizationヘッダーを指定できないため、Cookie、署名付きURL、認可済みの同一オリジン配信等を使います。再生可能なコンテナとコーデックはブラウザ・OSに依存します。

URL記述子は表示用の機能で、ファイルのアップロード可否とは別です。動画の新規取り込みには既定で4時間の上限があり、[内容制限](./upload-content-limits.md)から変更・解除できます。時間・PDFページ数・PPTXスライド数の検査も同ページを参照してください。

## 対応拡張子とPDFの埋め込み設定

`preview.formatsByExtension` は既定の拡張子対応に上書きを加えます。キーは `".markdown"` のようにドット付きで指定し、大小文字・前後の空白は正規化されます。`false` でその形式の内蔵表示を無効化します。追加形式のデコードやOffice変換を自動で導入する機能ではありません。設定の公開型は `ExplorerPreviewOptions`、各形式の型は `ExplorerPreviewFormat` / `ExplorerPreviewMode` です。

```tsx
<Explorer
  initialEntries={entries}
  readFile={readOriginalFile}
  preview={{
    formatsByExtension: {
      ".markdown": { mode: "text", mime: "text/plain" },
      ".mov": { mode: "video", mime: "video/quicktime" },
      ".log": false,
    },
    pdfSandbox: "", // 既定: 空のsandbox属性を維持
  }}
/>
```

標準ではテキスト（1 MiBまで）、CSV/TSV、PNG・JPEG・GIF・WebP・AVIF・BMP、PDFを表示します。動画はアップロードの検査対象と同じMP4・WebM・M4V・MOV・MKV・AVI・WMV・MPG・MPEG・OGV・3GPを動画要素へ渡し、再生可否はブラウザとコーデックに依存します。CSV/TSVは200行・50列・合計10,000セルまで、1セル2,000文字までです。SVGは安全側の扱いとしてソースをテキスト表示します。拡張子やMIMEの指定だけで入力が安全になったり、壊れた内容が表示可能になったりするものではありません。

PDFはiframeで表示し、既定の `pdfSandbox: ""` は空のsandbox属性を付けます。`pdfSandbox: "allow-same-origin"` 等の文字列を指定するとその値になり、`false` は属性を外します。ブラウザ内蔵PDFビューアーとsandboxの組み合わせによっては表示できない場合があるため、利用環境で確認してください。緩和する場合は、信頼できる配信元・PDF生成経路や隔離したオリジンを親が確保し、HTML等をPDFとして返すエンドポイントを許可しないでください。MIMEの書き換えは内容の検証の代わりにはなりません。

外部URLについても、プロトコルや配信元、リダイレクト先、認可範囲を親が確認します。コンテンツのアクセス制御はサーバーで行います。ダウンロードの非表示はブラウザへ配信済みの内容の保存を防ぐ機能ではありません。

## 別タブで開く

表示URLがすでにある場合、ユーザーのクリックから同期的に開きます。対象外だけ `"default"` を返せば内蔵表示と併用できます。

```tsx
import type { ExplorerPreviewHandler } from "@likex/explorer";

const showPreview: ExplorerPreviewHandler = (entry) => {
  const url = approvedPreviewUrls.get(entry.id);
  if (!url) return "default";
  window.open(url, "_blank", "noopener,noreferrer");
  return "handled";
};
```

`noopener` で親ウィンドウへの参照を切ります。この指定では正常に開けても戻り値が `null` の場合があり、戻り値だけでポップアップ拒否を判定しないでください。親の画面に「新しいタブで開く」リンクを残すと、ブラウザ設定で自動起動を拒否された場合も再操作できます。

先に `await fetch(...)` してから `window.open()` すると、ユーザー操作との関連が失われポップアップ制限に掛かることがあります。URLを事前に用意するか、同期的に親アプリのプレビューページを開き、そのページでIDを元に認可と読み込みを行います。Object URLを使う場合は親が寿命を管理し、開いた直後に破棄せず、不要になった時点で `URL.revokeObjectURL()` を呼びます。URLやトークンを保存モデルへ混ぜないでください。

## 実行できるサンプル

Playgroundの `/explorer-preview` に、ローカル生成データだけで動く例があります。PNG・テキスト・CSVの内蔵表示、PPTXを元ファイルとして保持したPDFの模擬変換、処理中からの切り替え、`renderPreview` の追加情報、テキストの別タブ表示を確認できます。変換の再実行・中止も用意しています。実際のOffice変換やサーバー通信は行いません。
