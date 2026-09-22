# LikeDataViewのJSON

形式識別子は `likex.dataview`、versionは `1`。標準拡張子は `.json`。

fieldsにID・名前・型・選択肢を置く。rowsのvaluesはフィールドIDをキーにする。値はstring/number/boolean/null。型変更で不正になる既存値を自動変換しない。

専用parse / normalize APIが件数、重複ID、参照、型を検証する。保存時に日時やIDを更新しない。

## CLIでの参照

`inspect --row-id ID` または `inspect --field-id ID` で対象を選択します。 一覧は `--offset` と `--limit`（1〜1000）でページ分割します。本文を含める `--include-data` は、IDで対象を指定した場合だけ使います。

## 完全な保存モデルの例

```json
{
  "format": "likex.dataview",
  "version": 1,
  "id": "data-1",
  "title": "連絡先",
  "fields": [
    {
      "id": "name",
      "name": "名前",
      "type": "text",
      "options": []
    }
  ],
  "rows": [
    {
      "id": "row-1",
      "values": {
        "name": "佐藤"
      }
    }
  ]
}
```
