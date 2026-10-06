# 文書内を検索する

「ホーム → 検索」、文書エディター内の `Ctrl+F` / `Cmd+F` から検索パネルを開けます。リボンが完全非表示でもショートカットは使えます。読み取り専用や編集許可の待機中でも検索は利用でき、変更・保存・Undo履歴には影響しません。

文字列を入力すると検索し、大文字・小文字の区別も切り替えられます。空白を含む入力はひとつの文字列として扱い、正規表現にはしません。本文、表、見出し、箇条書き、図形内の文字を対象に、結果を選ぶと該当箇所へ移動して強調表示します。画像内の文字のOCRは行いません。

前後ボタン、Enter（次へ）、Shift+Enter（前へ）で循環移動します。Escapeまたは閉じるボタンでパネルを閉じ、本文へフォーカスを戻します。文書の編集・取り込み・Undo後は現在の内容で再検索します。一覧は100件ずつ、移動対象は最大1,000一致位置です。上限到達時は表示で知らせます。

## 外側から検索を開く

```tsx
const editor = useRef<DocumentHandle>(null);
<LikeDocument ref={editor} initialDocument={document} readOnly initialRibbonDisplayMode="hidden" />;

editor.current?.openSearch("受注番号");
editor.current?.closeSearch();
```

`openSearch(query?: string)` はパネルを開いて入力欄にフォーカスします。query省略時は前回の検索語を保ち、空文字ならクリアします。不正なquery（文字列以外・4,096文字超）、`features.search: false` またはアンマウント後は `false`、受け付けた場合は `true` を返します。検索UIを無効にしても、純粋な `searchDocument` APIは使用できます。

検索の状態はDCONやDOCXに保存しません。検索UIは公開 `searchDocument` と同じ判定を使います。外側から複数キーワードのAND/OR検索を組み立てる方法は[画面なしの検索](headless.md#キーワードで探す)を参照してください。
