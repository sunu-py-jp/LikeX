# 文書内を検索する

「ホーム → 検索」、文書エディター内の `Ctrl+F` / `Cmd+F` から検索パネルを開けます。リボンが完全非表示でもショートカットは使えます。読み取り専用や編集許可の待機中でも検索は利用でき、変更・保存・Undo履歴には影響しません。

文字列を入力すると検索し、大文字・小文字の区別も切り替えられます。空白を含む入力はひとつの文字列として扱い、正規表現にはしません。本文、表、見出し、箇条書き、図形内の文字を対象に、結果を選ぶと該当箇所へ移動して強調表示します。画像内の文字のOCRは行いません。

前後ボタン、Enter（次へ）、Shift+Enter（前へ）で循環移動します。Escapeまたは閉じるボタンでパネルを閉じ、本文へフォーカスを戻します。文書の編集・取り込み・Undo後は現在の内容で再検索します。一覧は100件ずつ、移動対象は最大1,000一致位置です。上限到達時は表示で知らせます。

## 外側から検索を開く

```tsx
const editor = useRef<DocumentHandle>(null);
<LikeDocument
  ref={editor}
  initialDocument={document}
  initialSearchOpen
  initialSearchQuery="受注番号"
  readOnly
  initialRibbonDisplayMode="hidden"
/>;

editor.current?.openSearch("受注番号");
editor.current?.closeSearch();
```

`initialSearchOpen`（既定`false`）で最初の描画から検索欄を表示し、`initialSearchQuery`（既定`""`）で検索語を指定します。両方ともマウント時に一度だけ読みます。検索語だけでは欄を開きませんが、後から`openSearch()`したときに使います。不正な初期検索語（文字列以外・4,096文字超）は空文字として扱います。初期検索が一致すると、通常の検索と同じように最初の一致箇所へ移動します。

表示後の変更にはrefを使います。`features.search: false`は初期表示指定より優先し、表示中の欄も閉じます。その後`true`に戻しても自動では開きません。Spreadsheet・Slide・Document・PDFで共通のprops／ref名と引数を使い、型はCoreの`SearchPanelInitialState`／`SearchPanelHandle`を共有します。サムネイルには検索UIを表示しません。

`openSearch(query?: string)` はパネルを開いて入力欄にフォーカスします。query省略時は前回の検索語を保ち、空文字ならクリアします。不正なquery（文字列以外・4,096文字超）、`features.search: false` またはアンマウント後は `false`、受け付けた場合は `true` を返します。検索UIを無効にしても、純粋な `searchDocument` APIは使用できます。

検索の状態はDCONやDOCXに保存しません。検索UIは公開 `searchDocument` と同じ判定を使います。外側から複数キーワードのAND/OR検索を組み立てる方法は[画面なしの検索](headless.md#キーワードで探す)を参照してください。

## 外部検索の結果を表示する

意味検索・RAGなどの検索処理は利用側で行い、見つかった位置と説明を`externalSearch`へ渡せます。ビュー自身は外部へ通信せず、受け取った順序で結果を表示します。検索語の一致や置換対象としては扱いません。

```tsx
import LikeDocument, { type DocumentHandle, type ExternalSearchResult,
  type DocumentExternalSearchTarget } from "@likex/document";

const results: ExternalSearchResult<DocumentExternalSearchTarget>[] = [{
  id: "result-1",
  title: "運用設計について説明した節",
  snippet: "検索サービスが返した説明や抜粋をそのまま表示できます。",
  locationLabel: "運用と評価",
  target: { blockId: "operations", textFrom: 0, textTo: 5,
    expectedText: "運用と評価" },
}];

<LikeDocument ref={editor} initialDocument={document} initialSearchOpen
  externalSearch={{ title: "関連する箇所", results, initialResultId: "result-1",
    onResultSelect: result => console.log(result.id) }} />;

editor.current?.openExternalSearch("result-1");
editor.current?.openSearch("運用"); // 文書内の文字列検索へ切り替える
editor.current?.openSearch(); // 現在の検索モードと検索語を保持して開く
editor.current?.closeSearch();
```

結果には現在読み込んでいるモデルの`blockId`を使います。本文・見出しでは任意の`textFrom`／`textTo`でブロック内のUTF-16範囲を指定でき、改行は1文字です。省略すると本文全体を対象にします。Wordの印刷ページ番号や文書全体の絶対文字位置は使いません。描画キャンバス内の図形は`canvasShapeId`も指定し、キャンバス全体の選択・強調と図形の文字の検証を行います。通常図形は`blockId`だけで指定できます。

`expectedText`は検索時のブロック／図形の全文です。サーバー検索から表示までに内容が変わった結果を拒否するために指定します。ビューが受領した後に対象本文が変わった場合も、同じ結果オブジェクトを再利用しての移動を拒否します。位置の前に別の段落が挿入されても対象ブロックの内容が変わらなければ、IDから現在の位置を解決します。利用側で検索し直したときは新しい結果オブジェクトを渡してください（同じ結果IDで構いません）。古いオブジェクトを新しい配列に並べ直すだけでは更新とは扱いません。

`initialSearchMode`は`"local"`または`"external"`です。明示指定を優先し、省略時は`externalSearch`があれば外部検索、ただし空でない`initialSearchQuery`も渡した場合は文字列検索で始めます。`initialSearchOpen`はどちらのモードにも共通です。最初に開いたときは`initialResultId`または先頭の結果へ移動します。その後、結果の追加・並べ替えや文書の編集だけで現在位置を移動させません。

外部検索中の左ペインは「検索結果／見出し」で切り替えます。件数が多い場合は結果一覧だけをスクロールし、件数・前後移動・選択した結果に戻る操作は上部に残ります。結果と見出しの一覧を保持するため、通常の文書閲覧と往復できます。「選択した結果に戻る」は選択位置と本文のスクロールを再実行します。「文書内を検索／外部検索結果」で文字列検索と切り替えても、外部結果は保持します。引数なしの再表示やモード切替では、閲覧中の位置を変更しません。初回表示、明示した結果ID、結果の選択操作だけが本文へ移動します。

`openExternalSearch(resultId?)`は検索無効・アンマウント後・外部結果未設定・存在しないIDの場合に`false`を返します。受け付けた`true`は表示要求の受付であり、移動先の有効性を保証しません。削除済みブロック・不正な文字範囲・古い本文は画面に理由を表示し、別の内容へ移動しません。重複IDや不正な結果の共通フィールドは除外します。`onResultSelect`は移動を受け付けたときだけ通知し、コールバックの例外やPromise失敗は表示操作に影響しません。

検索モード・検索結果・選択説明はDCON／DOCXへ保存せず、変更履歴や編集許可も発生しません。保存・認証・検索インデックスとの紐づけは利用側が管理します。
