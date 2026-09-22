# Form commands

```json
[
  { "type": "field.add", "field": { "id": "rating", "type": "number", "label": "評価", "min": 1, "max": 5, "required": true } },
  { "type": "field.update", "fieldId": "rating", "patch": { "label": "満足度" } },
  { "type": "field.move", "fieldId": "rating", "index": 0 }
]
```

`form.update {patch}`、`form.replace {form}`、`field.add {field,index?}`、`field.update {fieldId,patch}`、`field.move {fieldId,index}`、`field.delete {fieldIds}`。

型はtext/textarea/number/date/select/radio/checkbox。select/radioは `options:[{value,label}]`。表示条件は `visibleWhen:{fieldId,operator,value?}`。operatorはequals/notEquals/contains/notEmpty。循環は禁止。

TypeScriptのexecuteFormCommandsはFormModelを直接返す。不変で、失敗すると全体を拒否する。入力の正規化はnormalizeForm、保存文字列はserializeForm。回答の検証はvalidateFormAnswersで、`{valid,errors:[{fieldId,message}],values}` を返す。回答は定義に追加しない。

## GUIの右クリックと同じ操作

設計画面の右クリックによる複製は、取得した項目から既存IDを外して `field.add` へ渡す操作に相当する。選択肢・検証・表示条件は保持し、`index` で挿入位置を指定する。移動は `field.move`、削除は `field.delete` を使う。回答入力・プレビューに設計用メニューはない。
