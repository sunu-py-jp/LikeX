# LikeBoardのJSON

形式識別子は `likex.board`、versionは `1`。標準拡張子は `.json`。

列の中にカードを持つ。ラベル・メンバーはboard直下に置き、カードからIDで参照する。列・カードの配列が表示順。日付はYYYY-MM-DD、色は#RRGGBB。

専用parse / normalize APIが件数、重複ID、参照、型を検証する。保存時に日時やIDを更新しない。

## CLIでの参照

`inspect --column-id ID` または `inspect --card-id ID` で対象を選択します。 一覧は `--offset` と `--limit`（1〜1000）でページ分割します。本文を含める `--include-data` は、IDで対象を指定した場合だけ使います。

## 完全な保存モデルの例

```json
{
  "format": "likex.board",
  "version": 1,
  "id": "board-1",
  "title": "制作タスク",
  "columns": [
    {
      "id": "todo",
      "title": "未着手",
      "color": "#64748b",
      "cards": [
        {
          "id": "task-1",
          "title": "資料確認",
          "description": "",
          "labelIds": [],
          "assigneeIds": [],
          "dueDate": null
        }
      ]
    },
    {
      "id": "done",
      "title": "完了",
      "color": "#22c55e",
      "cards": []
    }
  ],
  "labels": [],
  "members": []
}
```
