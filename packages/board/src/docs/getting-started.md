# LikeBoardの導入

列の中にカードを置き、ドラッグで順序・配置を変えるボードです。作業管理サーバーや通知サービスは含みません。

## コンポーネント

```tsx
import LikeBoard, { createBoard, type BoardHandle } from '@likex/board';
import { useRef, useState } from 'react';

function ProjectBoard() {
  const ref = useRef<BoardHandle>(null);
  const [board] = useState(() => createBoard({ title: '制作タスク' }));
  return <LikeBoard ref={ref} initialBoard={board}
    onSave={async model => { await persist(model); }}
    onBeforeSave={model => model.columns.length > 0}
    onEditRequest={async ({ model }, { signal }) => acquireLock(model.id, signal)}
    onDirtyChange={dirty => setPageHasUnsavedChanges(dirty)}
    onEvent={event => console.log(event)}
    primaryColor="#4169b2" colorMode="system"
    style={{ height: 600 }} />;
}
```

`initialBoard` は初期値です。表示中の文書を差し替える場合は `ref.current.importNative(json)` または `execute({ type: 'board.replace', board })` を使います。親の永続化処理は `onSave` のPromiseが解決するまで待機されます。

`onSave` 未指定、または `readOnly: true` では編集できません。閲覧とJSON書き出しは利用できます。`onBeforeSave` がfalseを返した場合や保存が失敗した場合、未保存データは保持します。`onSave` がモデルを返すとサーバー補正結果を反映し、`change` イベントの `source` は `save` になります。

`onEditRequest` は実際の変更がある最初の編集時に呼ばれます。falseなら変更せず、標準の拒否メッセージを表示します。保存・破棄後は再び閲覧状態です。ロックの取得・解放と権限の最終検証は親で行います。

## 機能指定

すべて初期値trueです。

|キー|対象|
|---|---|
|`rename`|ボード名の変更API|
|`columns`|列の作成・編集・削除|
|`cards`|カードの作成・編集・削除|
|`move`|カード・列のドラッグ、移動|
|`labels` / `members`|ラベル・担当者の管理と割当|
|`import` / `export`|JSONの読み込み・書き出し|
|`history`|Undo/Redo|

複合操作では関連する機能すべてを確認します。たとえばカードを含む列の削除には `columns` と `cards` が必要です。明示的なJSON読み込みは `import` で制御し、含まれるカードや書式ごとのフラグでは拒否しません。

カードを開くUIを親に任せる場合は `onCardOpen={({ card, columnId, index, board }) => ...}` を渡します。未指定時は標準の詳細ダイアログを表示します。

## キーボードと表示

- カード上でEnter / Space: 詳細を開く
- Alt＋左右矢印: 前後の列へ移動
- Alt＋上下矢印: 列内で順序を変更
- Ctrl/Cmd＋Z、Shift＋Ctrl/Cmd＋Z: Undo / Redo
- Ctrl/Cmd＋S: 保存

ラベル・担当者・文字検索は表示条件で、保存対象を削除しません。初期表示は列ごとに100カードまでで、追加表示ボタンから続きを表示します。未保存時には通常のブラウザー終了確認を有効にします。SPAのルート遷移確認は `onDirtyChange` を利用側のルーターに接続してください。

## ドラッグで並べ替える

カードと列はドラッグ中に小さな半透明プレビューを表示し、移動先を線で示します。カードの上半分・下半分で前後を選べます。空の列にも移動できます。ボードの左右端では横に、カード一覧の上下端では縦に自動スクロールします。表示領域の外側へ少し動かしても、その方向へのスクロールを続けます。

ドロップするまではデータを変更しません。Escape、領域外でのドロップ、読み取り専用への切り替え、対象データの変更で中止します。`move` と対象の `cards` / `columns` が有効な場合だけ利用できます。キーボードの移動操作も引き続き使えます。

## 右クリックメニュー

カードを右クリックすると詳細、複製、列内の上下移動、隣の列への移動、削除を選べます。列ではカード追加、列編集・複製・左右移動・削除、ボードの余白では列追加とUndo/Redoを選べます。列を複製すると配下カードも新しいIDになり、本文・期日・ラベル・担当者は保持します。列削除は確認ダイアログを表示します。

無効な機能の項目は表示しません。閲覧専用・処理中の変更操作は無効になり、編集許可とUndo/Redoは既存のコマンド経路を使います。ラベル・担当者付きの複製には対応する機能も必要です。右クリックしたカードや列のIDを対象とし、モデル・権限状態が変わったメニューは閉じます。入力欄や選択中テキストではブラウザー標準のメニューを使えます。
