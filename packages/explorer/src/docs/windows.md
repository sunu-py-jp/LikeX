# タブ・別ウィンドウ

[ドキュメント一覧](./README.md)

複数タブの操作、タブの切り離し、ExplorerPopupによる別ウィンドウからの起動を設定します。

## タブを追加・切り替え・閉じる

`features.tabs` は既定で `true` です。タブバーの「＋」でタブを追加し、タブをクリックして表示を切り替えます。新規タブの開始位置は `defaultPath` で指定し、省略時はルートです。タブが2つ以上あれば個別に閉じられます。最後の1つは閉じられません。

タブごとに表示場所・選択・検索語・並べ替え・表示形式・移動履歴を保持します。ファイルの下書きはすべてのタブで共通です。タブを閉じても下書きは破棄しません。`onEvent` の `type: "tabs"` でタブ一覧と選択中のタブIDを受け取れます。

```tsx
// 複数タブは使い、別ウィンドウへの切り離しを無効にする。
<Explorer initialEntries={entries} features={{ detachTabs: false }} />

// タブバーを隠し、1つの表示領域で使う。
<Explorer initialEntries={entries} features={{ tabs: false }} />
```

`entries` は親が用意する初期一覧です。どちらの設定も読み取り専用で使えます。切り離しは `tabs` と `detachTabs` がともに有効で、操作元にタブが2つ以上ある場合だけ可能です。最初から別ウィンドウで表示したい場合は、次の `ExplorerPopup` を使います。

## 最初から別ウィンドウで開く

ページ内に配置する既定の `Explorer` に加え、起動用の `ExplorerPopup` を公開しています。`mode` propによる切り替えではなく、利用先が使うコンポーネントを選びます。`ExplorerPopup` の親画面には `renderTrigger` が返すUIだけを表示し、ユーザー操作で開いたポップアップにExplorerを描画します。専用ページやルート、追加の依存は不要です。

`ExplorerPopupProps` は `ExplorerProps` を引き継ぐため、`initialEntries`・`onSave`・`readFile`・機能設定・テーマ・外部プレビュー・外部ダウンロード等は同じ契約です。追加のpropsと公開型は次のとおりです。

| prop | 契約 |
| --- | --- |
| `renderTrigger` | 必須。`ExplorerPopupControls` を受け取り、起動ボタン等の表示内容を同期的に返します（Promiseを除く `ReactNode`）。エラー表示も利用先がここで組み立てます。 |
| `onOpenChange` | 任意の `(open: boolean) => void`。起動確認後に `true`、開いていた表示を閉じたときに `false` を通知します。初期状態や起動確認前の失敗では通知しません。通知の例外は開閉を妨げません。 |
| `windowOptions` | 任意の `ExplorerPopupOptions`。`width`・`height`・`left`・`top` はすべて省略可能な数値です。既定サイズは1100×760px、既定位置は操作元から右下へ40pxです。次に開くウィンドウへの指定で、開いているウィンドウのサイズや位置はprop変更で更新しません。 |

`ExplorerPopupControls` は次の操作と状態を渡します。

| 項目 | 契約 |
| --- | --- |
| `open(event?: { currentTarget: EventTarget \| null }): boolean` | ユーザー操作から同期的に呼びます。`onClick={open}` ならボタンが属する文書から起動します。既存のウィンドウがあれば前面に出します。`true` は起動要求を受け付けたか既存の表示を使えたことを表し、起動確認の完了ではありません。即時の起動失敗は `false` です。 |
| `close(): void` | 起動中または起動済みのポップアップと、その子ウィンドウを閉じます。起動済みで未保存の変更があり、`warnOnUnsavedChanges` が有効なら、閉じる前に同期的な確認を表示します。取り消すと表示を維持します。閉じている場合は何もしません。 |
| `isOpen: boolean` | ExplorerのDOM・文書の表示状態・表示領域を確認してから `true` になります。 |
| `isOpening: boolean` | ウィンドウの起動要求から確認完了まで `true` になります。 |
| `error: string \| null` | ポップアップのブロックや起動失敗の説明です。次の起動要求で解除し、失敗した場合は更新します。 |

次は、型付きの独自ボタン、エラー表示、開閉状態の表示、親の保存処理を組み合わせた例です。`onSave` と `readFile` は利用先のClient Componentで実装して渡します。

```tsx
"use client";

import { useState } from "react";
import {
  ExplorerPopup,
  type ExplorerPopupProps,
  type ExplorerPopupControls,
  type ExplorerPopupOptions,
} from "@/components/explorer";

type Props = Pick<ExplorerPopupProps, "initialEntries" | "onSave" | "readFile"> & {
  workspaceId: string;
};

const windowOptions = {
  width: 1000,
  height: 720,
  left: 120,
  top: 80,
} satisfies ExplorerPopupOptions;

function Launcher({ open, close, isOpen, isOpening, error }: ExplorerPopupControls) {
  return (
    <div>
      <button type="button" onClick={open} disabled={isOpening}>
        {isOpening ? "起動中…" : isOpen ? "ファイル画面を前面へ" : "ファイルを開く"}
      </button>
      {isOpen && <button type="button" onClick={close}>閉じる</button>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

export default function FileManagerPopup({
  workspaceId, initialEntries, onSave, readFile,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <ExplorerPopup
        key={workspaceId}
        initialEntries={initialEntries}
        onSave={onSave}
        readFile={readFile}
        windowOptions={windowOptions}
        onOpenChange={setIsOpen}
        renderTrigger={(controls) => <Launcher {...controls} />}
      />
      <p aria-live="polite">{isOpen ? "ファイル画面を表示中" : "ファイル画面は閉じています"}</p>
    </>
  );
}
```

`open` をマウント時のEffectや非同期処理の後から呼ばず、ボタンのクリック等から直接呼んでください。マウントしただけではウィンドウを開きません。起動中または起動済みの間に再度 `open` を呼んでも、ウィンドウは増えません。起動確認には最大5秒待ち、失敗すると表示を閉じて `error` に理由を渡します。ブラウザやWebViewによるウィンドウ形式・位置・前後関係の制約は、[タブを別ウィンドウで開く](#タブを別ウィンドウで開く)場合と共通です。

最初の起動は `features.detachTabs` と独立しています。タブが1つでも、`features={{ tabs: false, detachTabs: false }}` でも開けます。起動後のタブ切り離しは従来どおり、`tabs` と `detachTabs` が有効で操作元にタブが2つ以上ある場合に使えます。この構成で「最初のメインExplorer」は最初に開いたポップアップを指し、切り離した子の「元のウィンドウに戻す」もそこへ戻します。

| 操作 | 表示と保持する状態 |
| --- | --- |
| 最初のポップアップを閉じる、または `close()` | 子ウィンドウも閉じ、子のタブを終了します。親画面に `ExplorerPopup` が残る間は、メインのタブ・下書き・追加した `File`・クリップボード・進行中の保存を保持します。 |
| 同じインスタンスで再び `open()` | 保持したメインのタブと下書きで再開します。閉じた子のタブは復元しません。 |
| 最初のポップアップを再読み込み、別ページへ移動 | 表示を閉じて子ウィンドウも終了します。親画面に保持した下書きは、再度開いて利用できます。 |
| `ExplorerPopup` をアンマウント、または親画面を終了・再読み込み | すべての表示を閉じます。マウント中のメモリ保持は終了するため、次回は利用先の保存先から読み込みます。 |

閉じる・開き直す操作では自動保存や下書きの破棄を行いません。`initialEntries`・`defaultPath`・`initialPath`・`selectedFile`・`selectedFileMode` は `ExplorerPopup` の初回マウント時にだけ読み、毎回の `open()` では読み直しません。`selectedFileMode="preview"` による初期プレビューは最初の表示で起動し、開き直しやタブの切り離しでは再要求しません。別のワークスペースや別の初期ファイルへ切り替える場合は、上の例の `key` を変更して再マウントします。[初期パス・選択の指定](./getting-started.md#initial-file)

`warnOnUnsavedChanges` は共通の `ExplorerProps` に含まれ、既定は `true` です。起動済みの `close()` では、未保存の変更がある場合に `window.confirm` で「未保存の変更があります。このウィンドウを閉じますか？」と「変更は親画面に保持されます。」を改行して表示します。取り消した場合はウィンドウ・タブ・下書きと `isOpen` を維持し、`onOpenChange(false)` は通知しません。許可された場合に閉じて開閉状態を更新します。`close()` の戻り値は従来どおり `void` です。

OSの閉じるボタンや再読み込みはブラウザ標準の離脱確認を使うため、上記とは文言が異なります。ルート文書の `pagehide`、アンマウント、タブ機能の無効化、子を元のウィンドウへ戻す操作に伴う後片付けでは、確認を重ねません。親のルート遷移や `key` の変更は、親が先に確認してください。[未保存の変更がある状態で画面を離れる](./saving.md#unsaved-changes)に対応範囲をまとめています。

最初のポップアップの開閉通知は `onOpenChange` です。起動のブロック・失敗は `onEvent` にも `{ type: "window", action: "blocked", windowId, sourceWindowId: "main", tabIds: [], message }` として通知します。この起動ではタブを切り離さないため、成功・終了時に `detach` / `close` イベントは発行しません。後から切り離した子の通知は、既存の `window` イベントの契約に従います。

## タブを別ウィンドウで開く

`features.detachTabs` は既定で `true` です。操作するウィンドウにタブが2つ以上ある場合、タブを右クリックして「別ウィンドウで開く」を選ぶか、マウスでタブバーから離れた場所へドラッグして離すと、そのタブを新しいウィンドウに移します。子ウィンドウからもさらに切り離せます。タブが1つしかない場合はどのウィンドウでも新規に開かず、メニューの「別ウィンドウで開く」も表示しません。

ドラッグ中はタブの半透明の影がポインターに追従します。タブバー内で離す、操作をキャンセルする、切り離しに失敗する、操作元にタブが1つしかない、といった場合は影が元の位置へ戻ります。復帰アニメーションは非同期で進み、他のクリックや操作を完了まで待たせません。OS・ブラウザの「動きを減らす」設定（`prefers-reduced-motion: reduce`）が有効なら、復帰アニメーションを省略して元の表示へ戻します。

ウィンドウは、操作元の文書の `ownerDocument.defaultView.open()` を操作イベント内で同期的に呼んで作成します。子ウィンドウからの切り離しでは、その子の `open()` を使います。ユーザー操作の有効状態はウィンドウごとに管理されるため、子での操作をメインの `open()` へ迂回させない構成です。`open()` には `popup=yes,resizable=yes,scrollbars=yes` と寸法・位置を指定し、ポップアップ形式で開くよう要求します。取得したウィンドウと文書の参照をメインで保持してReact描画を続けながら、`popup.opener = null` でブラウザのopener参照を切り離します。`focus()` は起動時に1回だけ呼びます。

ドラッグで切り離す場合は、タブを掴んだ位置が画面上のドロップ点に合うよう、OSのタイトルバーやブラウザUIの寸法を見込んで `moveTo` による位置補正を行います。メニューから開く場合は、操作元のウィンドウ位置から右下へ40pxずらした位置を要求します。

これらはブラウザへの要求です。ポップアップ形式で開くか、要求位置・寸法を採用するか、ネイティブウィンドウの前後関係や連動終了をどう管理するかは、ブラウザ・OS・WebViewホストが最終決定します。特にアプリ内WebViewではホストがウィンドウ生成を担当するため、`opener = null` だけで前面固定や連動終了が解除される保証はなく、Explorerからその関係を強制変更することもできません。[HTMLのウィンドウ仕様](https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-open)、[WebKitのウィンドウ作成delegate](https://developer.apple.com/documentation/webkit/wkuidelegate/webview(_:createwebviewwith:for:windowfeatures:))を参照してください。

ポップアップをブロックされた場合は元のタブを残して通知し、右クリックメニューから再試行できます。メイン経由での自動再試行は行いません。長時間のマウスドラッグでは、押し始めに得たユーザー操作の有効状態がドロップまでに期限切れになることがあるため、右クリックメニューから改めて操作してください。同期的に呼んでも、ブラウザのポップアップ設定やWebViewホストの制限で開けない場合があります。[HTMLのユーザー操作の仕様](https://html.spec.whatwg.org/multipage/interaction.html#tracking-user-activation)、[MDNの `window.open()` の説明](https://developer.mozilla.org/en-US/docs/Web/API/Window/open#description)を参照してください。

`window.open()` が参照を返しても、その時点では起動成功を通知しません。移動先に描画したExplorerのDOMが文書に接続され、文書が読込中ではなく表示状態で、表示領域の幅・高さが正になることを確認してから `window.action: "detach"` を通知します。これは文書の状態を確認するもので、WebViewホストがネイティブウィンドウを表示することまで保証するものではありません。

起動中にウィンドウが閉じる・文書を利用できなくなる・5秒以内に起動を確認できない場合は、移したタブを表示状態ごと切り離し元へ復元します。切り離し元の子が終了済みなら、最初のメインExplorerへ戻します。失敗したウィンドウを閉じて `window.action: "blocked"` を通知し、操作元が残っていればエラーを表示します。この復元では `reattach` / `close` を通知しません。通常ウィンドウへの切り替えやブラウザ別の回避処理は行わず、`popup=yes` と操作元の `open()` を維持します。

`ui.contextMenu: false` の場合はタブのメニューも隠します。タッチではタブバーの横スクロールを維持し、ドラッグでの切り離しは行いません。

タブの右クリックメニューは、次のように表示します（`ui.contextMenu` と関連機能が有効な場合）。

| 操作元 | タブ数 | ウィンドウ操作のメニュー |
| --- | --- | --- |
| 最初のメインExplorer | 1つ | 表示しません。 |
| 最初のメインExplorer | 2つ以上 | 「別ウィンドウで開く」 |
| 子ウィンドウ | 1つ | 「元のウィンドウに戻す」 |
| 子ウィンドウ | 2つ以上 | 「別ウィンドウで開く」と「元のウィンドウに戻す」 |

すべてのウィンドウは最初のメインExplorerが管理し、同じReactツリーで描画します。子から開いたウィンドウも同じ共有状態へ接続し、文書へコピーするスタイルは最初のメインから取得します。例えば子Aから子Bを開いた後にAを閉じても、Explorer自身はBを閉じません。ただしWebViewホストがネイティブウィンドウを連動して閉じる場合は、その制御に従います。ウィンドウごとに保存データを再取得・同期する別アプリを作る仕組みではありません。

| 状態 | ウィンドウ間の扱い |
| --- | --- |
| 下書きの全項目・追加した `File` | 共有します。どこで編集しても他のウィンドウに反映します。 |
| 保存処理・保存中の状態・クリップボード | 共有します。保存はワークスペース全体に対して行います。 |
| 選択・表示場所・戻る/進む・検索・表示設定 | ウィンドウやタブごとに独立して扱います。切り離すタブの表示状態を引き継ぎます。 |
| サイドバー幅 | ウィンドウごとに独立し、新しいウィンドウは既定幅から始めます。 |

**起動を確認した子ウィンドウを閉じると、その中の全タブも終了し、親には戻しません。** 終了するのはタブの表示状態です。共有する下書き・ファイル・クリップボード・保存処理は維持し、子で行った未保存の変更も親に残ります。保存中に子を閉じても、親が動いていれば保存は継続します。

戻す場合は、子のタブを右クリックして「元のウィンドウに戻す」を選びます。この操作は、その子にある全タブを表示状態ごと**最初のメインExplorer**へ戻します。行き先は直前の切り離し元とは限らず、子Aから子Bを開いた場合もBのタブはメインへ戻ります。復帰メニューは子のタブが1つの場合も有効です。

| 起動確認後の操作・終了理由 | 子のタブの扱い |
| --- | --- |
| 子ウィンドウを閉じる | その子の全タブを終了します。メインへは戻さず、Explorer自身はその子から開いた別ウィンドウを閉じません。ホストによる連動終了の制約は上記のとおりです。 |
| 子の「元のウィンドウに戻す」 | その子の全タブを最初のメインExplorerへ戻します。 |
| `features.tabs: false` / `features.detachTabs: false` に変更 | 子ウィンドウを閉じ、その全タブを終了します。 |
| 子のページ移動・再読み込みなどで表示を継続できなくなる | その子の全タブを終了します。 |
| 最初のメインを閉じる・再読み込みする（`pagehide`）、Explorerをアンマウントする | すべての子を閉じ、その全タブを終了します。メインへの復帰は行いません。 |

タブの終了・復帰のために下書きを保存したり破棄したりすることはありません。ただし親ページ自体の終了・再読み込み後にデータを復元できるかは、従来どおり親の保存先と読込処理によります。
