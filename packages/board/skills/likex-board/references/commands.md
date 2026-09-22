# Boardのデータと操作API

`@likex/board/model` はReact・DOMなしで使えます。

```ts
import { createBoard, executeBoardCommands, getCard, serializeBoard } from '@likex/board/model';
const initial = createBoard({ columns: [{ id: 'todo', title: '未着手' }, { id: 'done', title: '完了' }] });
const result = executeBoardCommands(initial, [
  { type: 'card.add', columnId: 'todo', card: { id: 'task-1', title: '資料を確認する' } },
  { type: 'card.move', cardId: 'task-1', columnId: 'done', index: 0 },
]);
getCard(result.board, 'task-1'); // { card, columnId: 'done', index: 0 }
const json = serializeBoard(result.board);
```

戻り値は `{ board: BoardModel, changed: boolean, createdIds: string[] }`。入力を書き換えず、一括コマンドの途中にエラーがあると全体を適用しません。新規リソースのIDは指定可能で、未指定ならUUIDを発行します。

|コマンド|主な引数|
|---|---|
|`board.rename` / `board.replace`|`title` / `board`|
|`column.add`|`column: { id?, title, color?, cards? }`, `index?`|
|`column.update`|`columnId`, `patch: { title?, color? }`|
|`column.move` / `column.delete`|`columnId`, 移動時は`index`|
|`card.add`|`columnId`, `card: { id?, title, description?, labelIds?, assigneeIds?, dueDate? }`, `index?`|
|`card.update`|`cardId`, `patch`（ID以外）|
|`card.move`|`cardId`, `columnId`, `index?`|
|`card.delete`|`cardId`|
|`label.add` / `label.update` / `label.delete`|`label: { id?, name, color }` / `labelId, patch` / `labelId`|
|`member.add` / `member.update` / `member.delete`|`member: { id?, name }` / `memberId, name` / `memberId`|

位置は0始まり。移動の `index` は移動元を取り除いた後の配置位置です。省略時は移動先の末尾。列の削除は配下のカードも削除し、ラベル・メンバーの削除はカード側の参照も取り除きます。

## 取得

|API|戻り値|
|---|---|
|`getColumn(board, id)`|`BoardColumn \| undefined`|
|`getCard(board, id)`|`{ card: BoardCard, columnId: string, index: number } \| undefined`|
|`getCards(board, { query?, columnId?, labelId?, assigneeId? })`|同じ形式の配列。表示順を維持|

正規化したデータは凍結されます。取得結果を直接更新せず、コマンドを使用します。

## JSON構造

保存モデル全体の例は [schema-guide.md](schema-guide.md) を参照してください。

CLIに渡すコマンド配列の例:

```json
[
  {
    "type": "card.update",
    "cardId": "task-1",
    "patch": {
      "description": "内容を確認する"
    }
  },
  {
    "type": "card.move",
    "cardId": "task-1",
    "columnId": "done"
  }
]
```

日付は時刻を含まない `YYYY-MM-DD`。色は `#RRGGBB`。配列の順序が列とカードの表示順です。標準ファイルは `.json` で、`parseBoard` / `serializeBoard` を使います。同じモデルは同じJSONとなり、保存だけでIDや日時は変えません。

上限は100列、合計10,000カード、100ラベル、1,000メンバー、1バッチ1,000コマンド。文字列化されたJSONは16 Mi文字までです。UIのファイル読み込みは16 MiBまで。純粋なモデルAPIの権限管理は呼び出し側が担当します。表示中は `BoardHandle.execute()` が機能・読み取り専用・編集許可・Undo/Redoをまとめて適用します。

## GUIの右クリックと同じ操作

右クリックの複製も既存コマンドを使う。カードは取得した内容を新IDまたはID省略の `card.add` に渡す。列は列自身と配下カードすべてのIDを新規にした `column.add` を使い、ラベル・担当者の参照は保持する。移動・削除は既存の `card.*` / `column.*` コマンド。
