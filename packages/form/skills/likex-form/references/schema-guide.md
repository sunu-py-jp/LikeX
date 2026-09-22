# Formの保存構造

回答を含まないフォーム定義の例。項目は配列の表示順、IDは変更しない。回答は `Record<fieldId, string | number | boolean | null>` として別途管理する。

```json
{
  "format": "likex.form",
  "version": 1,
  "id": "sample",
  "title": "アンケート",
  "description": "",
  "submitLabel": "送信",
  "fields": []
}
```

構造は [form.schema.json](form.schema.json)、意味・参照・サイズはparseFormに従う。項目は最大500、選択肢は1項目500、JSONはUTF-8で8 MiBまで。条件の循環参照は許可しない。同じ内容の保存でIDや日時を付け直さない。
