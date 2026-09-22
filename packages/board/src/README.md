# LikeBoard

カードと列で作業を整理する、Trelloに近いReactコンポーネントです。列・カードの追加、編集、移動、ラベル、担当者、期日、検索、JSON入出力に対応します。保存・認証・同時編集のロックは利用側が実装します。

```tsx
import LikeBoard, { createBoard } from '@likex/board';

const board = createBoard({ title: '制作タスク' });
<LikeBoard initialBoard={board} onSave={async board => {
  await fetch('/api/board', { method: 'PUT', body: JSON.stringify(board) });
}} primaryColor="#4169b2" colorMode="system" />
```

`onSave` を省略すると読み取り専用になります。`features={{ move: false }}` のように機能を切り替えられます。保存後もUndo/Redoを保持します。

- [導入・ホスト連携](docs/getting-started.md)
- [操作API・保存形式](docs/commands.md)

ソースをコピーする場合は、この `src` と `packages/core/src` を隣接する `board` / `core` にコピーし、`board/core.ts` を `export * from '../core';`、`board/json.ts` を `export * from '../core/json';`、`board/browser.ts` を `export * from '../core/browser';` に変更します。依存はReact 19・React DOM・lucide-react。Tailwindは不要です。
