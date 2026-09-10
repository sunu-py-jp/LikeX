# 保存・再取得・未保存変更の確認

[ドキュメント一覧](./README.md)

保存ペイロード、保存前後の処理、一覧の再取得、ページ離脱時の確認を扱います。

## データと保存の契約

- `initialEntries` は必須で、初回マウント時だけ読みます。別のワークスペースを開く場合はReactの `key` を変更します。`onSave` は任意で、省略すると読み取り専用になります。`readOnly: true` でも編集を禁止できます。
- `defaultPath` は新規タブの開始フォルダを決め、初期位置の指定がなければ最初のタブにも使います。`initialPath`・`selectedFile`・`selectedFileMode` は最初のタブの表示先・選択・プレビューを指定します。いずれも初回マウント時のみ読み、再取得では再適用しません。表示状態の指定であり、保存対象や操作範囲を絞るものではなく、未保存の変更にもなりません。[初期表示の優先順位](./getting-started.md#initial-file)
- 追加・移動・コピー・名前変更・削除はクライアント内の下書きを変更します。「保存」で `onSave` に最終一覧 `entries` と比較元からの差分 `changes: { created, updated, deleted }` を渡します。
- `onSave` は `void` または保存後の `readonly ExplorerEntry[]` を返せます。Promiseも使えます。返した一覧を次の編集基準にし、戻り値が `undefined` の場合は保存に渡した一覧を基準にします。例外やPromiseのrejectでは下書きを保持します。
- `onRefresh?: () => readonly ExplorerEntry[] | Promise<readonly ExplorerEntry[]>` は最新一覧の取得処理です。成功時に下書きと比較元へ反映します。`initialEntries` のprop変更を反映する機能ではなく、初回マウント時に自動実行もしません。
- `onDirtyChange?: (dirty: boolean) => void` は未保存の差分の有無を親へ通知します。`warnOnUnsavedChanges?: boolean` は標準の離脱警告を切り替え、既定は `true` です。どちらも `Explorer`・`ExplorerPopup` で使えます。
- `readFile` は任意の `(sourceId: string) => Promise<Blob>` です。既存ファイルの内蔵プレビュー・内蔵ダウンロード・画像サムネイルに使います。ローカル追加ファイルだけなら省略できます。外部 `onDownloadRequest` はこのreaderを自動では呼びません。

`ExplorerEntry` の `source` は、既存本体への参照 `{ kind: "existing", id: string }`、追加したファイル `{ kind: "local", file: File }`、フォルダの `null` のいずれかです。`parent: "root"` が最上位、それ以外は親フォルダのエントリーIDです。詳細な型は公開入口からimportできます。

`ExplorerEntry` の `readonly extension?: string` は後方互換のため省略できます。初期一覧・親が返す保存結果・名前変更等の操作では `name` と `kind` から再計算し、呼び出し元の古い値は採用しません。コンポーネントと `useExplorerDraft` は正規化した文字列を下書きに保持し、`onSave` の最終一覧・差分にも含めます。公開型では省略可能なままですが、実際の保存ペイロードには値を設定します。最後の拡張子を小文字・先頭の点なしで表し、`Report.PDF` は `"pdf"`、`archive.tar.gz` は `"gz"`、フォルダ・`README`・`.env` は `""` です。表示名そのものやローカル `File.name` の大文字・小文字は、この正規化では変更しません。

`createdAt` / `updatedAt` は、`2026-09-06T00:00:00.000Z` のように `Z` または `+09:00` などの時差を含むISO 8601文字列で渡してください。日付はサーバー・ブラウザーとも日本時間（`Asia/Tokyo`）で表示します。

ファイル・フォルダの移動は `parent` だけを変更し、`id`・`source`・`createdAt`・`updatedAt` を維持します。更新日時が変わらなくても、保存時に `parent` の差分が残る項目は `changes.updated` に含まれます。この配列はメタデータを含む項目の変更を表し、ファイル本体の変更だけを表すものではありません。

ストレージへの書き込み・アップロード・削除・競合処理はホスト側の責任です。`File` はJSON文字列化では送れないため、ホストのアップロード手段で本体を送ります。保存がすべて成功してから `onSave` をresolveしてください。新規ファイルを保存後の既存参照に変換した一覧を返すと、次の保存でもローカルファイル扱いになることを防げます。

<a id="save-lifecycle"></a>

### 保存前の検証と保存後の通知

保存前に完了を待つ必要のある検証は、親の `onSave` の先頭で行います。例えば親が用意した検証・保存関数を `onSave={async payload => { await validateBeforeSave(payload); return persist(payload); }}` と組み合わせます。検証または保存でthrow/rejectすると保存失敗となり、未保存の下書きとローカル `File` を保持します。サーバー側でも権限や保存条件を検証してください。

完了後の親画面更新などは `onEvent={event => { if (event.type === "save" && event.status === "success") afterSave(event.entries); }}` で受け取れます。`validateBeforeSave`・`persist`・`afterSave` は利用先が実装する関数の例です。`save` の `status: "start"` は観測通知であり、非同期処理を待たせたり、戻り値・throwで保存を拒否したりできません。成功通知側の例外も完了済みの保存を取り消しません。

親が転送したファイルの完了一覧や処理の進捗をExplorer内に表示する場合は、`ref` の `notify()` を使えます。複数ファイルは1つの通知にまとめます。[通知の表示と保存処理の例](./notifications.md#保存結果をファイル一覧にまとめる)

<a id="refresh-entries"></a>

### 最新一覧を親から再取得する

`Explorer` と `ExplorerPopup` に `onRefresh` を渡すと、アドレスバー直前に更新ボタンを表示します。省略時はボタンを隠し、指定時も初回に自動実行はしません。読み取り専用でも利用でき、ページ全体の再読み込みやルーターには依存しません。認証・取得・外部データから `ExplorerEntry` への変換は親の責務です。

未保存の変更がある場合は、更新前に「未保存の変更を破棄して再読み込みしますか？」と画面内のダイアログで確認します。「キャンセル」、Esc、暗い背景のクリックで取り消した場合は `onRefresh` を呼ばず、下書きを保持します。確認後も取得に成功するまでは既存の下書き・ローカル `File`・編集セッションを保持し、失敗時はエラーを表示して再試行できます。更新中はボタンにスピナーを表示し、再更新・保存・ファイル変更を無効にします。

取得に成功すると、最新一覧を下書きと保存の比較元に設定し、未保存状態を解除します。取得済みの編集セッションは `reason: "refreshed"` で終了します。同じワークスペースの子・孫にも反映し、各タブが表示しているフォルダのIDが残っていれば現在地を維持し、消えていればルートへ戻します。

初期ロードと再取得には同じ取得関数を使えます。次の `loadEntries` は、親が用意する安定した関数参照です。既存の取得処理をそのまま渡せるため、更新専用のAPIエンドポイントは不要です。

```tsx
"use client";

import { useEffect, useState } from "react";
import Explorer, { type ExplorerEntry, type ExplorerProps } from "@/components/explorer";

type Props = Pick<ExplorerProps, "onSave"> & {
  loadEntries: NonNullable<ExplorerProps["onRefresh"]>;
};

export default function FileWorkspace({ loadEntries, onSave }: Props) {
  const [entries, setEntries] = useState<readonly ExplorerEntry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    Promise.resolve().then(loadEntries).then(
      result => { if (active) setEntries(result); },
      () => { if (active) setError("一覧を取得できませんでした。"); },
    );
    return () => { active = false; };
  }, [loadEntries]);

  if (error) return <p role="alert">{error}</p>;
  if (!entries) return <p>読み込み中…</p>;
  return <Explorer initialEntries={entries} onRefresh={loadEntries} onSave={onSave}
    style={{ height: "70vh" }} />;
}
```

この例で初回取得を行うのは親のEffectです。その後はExplorerの更新ボタンから同じ `loadEntries` を呼び、返された一覧をExplorerが反映します。`initialEntries` の値を後から差し替えるだけでは内部の一覧は更新されません。

`onEvent` には `type: "refresh"` と `status: "start" | "success" | "error"` を通知します。成功時は反映後の `entries`、失敗時は `message` を含み、親・子・孫で重複しないワークスペース単位の通知です。

`useExplorerDraft` を直接使う場合は `onRefresh` をオプションに渡し、`refresh(): Promise<boolean>`・`refreshing: boolean`・`refreshError: string | null`・`canRefresh: boolean` を利用できます。`refresh()` は成功時に `true` を返します。低レベルのフック自体は確認UIを表示しないため、未保存変更を置き換えてよいかは呼び出し元で確認してから実行してください。

<a id="unsaved-changes"></a>

### 未保存の変更がある状態で画面を離れる

`warnOnUnsavedChanges` は既定で有効です。共有する下書きに未保存の差分がある間だけ、親画面、切り離した子・孫、`ExplorerPopup` の最初の表示へ `beforeunload` を登録します。保存・再取得の成功、変更の破棄、変更を元に戻す操作で差分がなくなると解除します。保存中も差分がある間は有効で、保存に失敗した場合は警告を維持します。編集許可を得ただけで差分がない場合は警告しません。`warnOnUnsavedChanges={false}` で無効化でき、動的な変更にも追従します。

| 操作 | 確認の扱い |
| --- | --- |
| Explorerの「変更を破棄」・未保存状態での「更新」 | Explorerの表示領域の中央に確認を出し、領域内の背景を薄く黒くします。「キャンセル」、Esc、背景クリックで中止できます。初期フォーカスはキャンセルに置き、閉じた後は元の操作位置に戻します。 |
| OS・ブラウザの閉じるボタン、再読み込み、別文書への移動 | ブラウザ標準の確認を要求します。子を閉じても共有の下書きは親に残ります。親文書の終了ではメモリ上の下書きも失われます。 |
| 起動済みの `ExplorerPopupControls.close()` | 未保存の差分があり、警告が有効な場合に同期的な `window.confirm` を表示します。取り消すと表示と状態を維持し、許可して閉じても親が保持する下書きは破棄しません。 |
| Explorer内のフォルダ移動・タブ切替 | 下書きが失われないため、警告しません。 |
| SPAのルート遷移、Reactの `key` 差し替え・条件付き描画によるアンマウント | 親が `onDirtyChange` を受け取り、操作を実行する前に確認します。アンマウント処理から遷移や破棄を取り消すことはできません。 |

画面内のダイアログは埋め込みサイズ・ウィンドウのリサイズに追従し、内容が収まらない場合はダイアログ内をスクロールできます。表示中は他の操作へフォーカスが移らないようにします。保存・再取得・編集許可の待機中は、未保存確認からの破棄・キャンセルを受け付けません。日本語入力の変換中にEscを押してもダイアログは閉じません。`warnOnUnsavedChanges` は離脱警告の設定なので、明示的に下書きを捨てる画面内の確認はこの設定にかかわらず表示します。

ブラウザ標準の確認はユーザー操作があった文書でのみ表示され、文言はブラウザが決めます。任意の文言や非同期のダイアログ・保存待機へ置き換えることはできません。モバイルでアプリを強制終了する場合など、`beforeunload` が届かない操作もあるため、離脱警告は永続保存の代わりにはなりません。[MDN: beforeunload](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event)

親の `pagehide` やアンマウント後のウィンドウ終了、`tabs` / `detachTabs` の無効化、子を元のウィンドウへ戻す処理では、後片付けの途中に追加の確認を挟みません。SPAで親画面を切り替える場合は、次のように入口で確認します。

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import Explorer, { type ExplorerProps } from "@/components/explorer";

type Props = Pick<ExplorerProps, "initialEntries" | "onSave" | "readFile">;

export default function FileWorkspace({ initialEntries, onSave, readFile }: Props) {
  const [dirty, setDirty] = useState(false);

  return (
    <>
      <Link
        href="/dashboard"
        onNavigate={(event) => {
          if (dirty && !window.confirm("未保存の変更があります。この画面を離れますか？")) {
            event.preventDefault();
          }
        }}
      >
        ダッシュボードへ
      </Link>
      <Explorer
        initialEntries={initialEntries}
        onSave={onSave}
        readFile={readFile}
        onDirtyChange={setDirty}
        warnOnUnsavedChanges={true}
        style={{ height: "70vh" }}
      />
    </>
  );
}
```

この例は親が描画する `Link` のSPA遷移を確認し、取り消した場合に `event.preventDefault()` で止めます。複数のリンクがある場合は、利用先の共通リンク等にまとめてください。[Next.js: Blocking navigation](https://nextjs.org/docs/app/api-reference/components/link#blocking-navigation)

`router.push()` / `router.replace()`、ワークスペースIDや `key` の変更、Explorerを閉じる親UIも、呼び出し・変更前に同じ `dirty` を確認します。ブラウザの戻る・進むによるSPA遷移は、`Link.onNavigate` と `beforeunload` だけでは網羅できないため、利用先のルーティング方式で別途扱います。警告を無効にしても `onDirtyChange` の通知と下書きは維持されます。
