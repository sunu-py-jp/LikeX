# 固定ルールでJSONを書き出す

`serializeStableJson` は同じ値を一定の順序と書式でJSON文字列にします。日時やIDを生成せず、入力データを変更しません。ReactやDOMを使わない処理からも利用できます。

```ts
import { serializeStableJson, type StableJsonOptions } from "@likex/core/json";

const options: StableJsonOptions = { space: 2, maxLength: 1024 * 1024 };
const json = serializeStableJson({ name: "売上", revision: 1 }, options);
```

| 引数 | 意味 |
| --- | --- |
| `value: unknown` | JSONとして表現する値。通常のオブジェクト、配列、文字列、有限の数値、真偽値、`null` |
| `space?: number` | 0〜10の整数。既定は0（改行なし）。2なら2スペースでインデント |
| `maxLength?: number` | 出力のUTF-16文字数上限。正の安全な整数。インデント・エスケープも含む |
| `compareKeys?: (left, right, path) => number` | オブジェクトのキー順。`path` は対象オブジェクトまでのキーと配列添字。配列そのものの順序は変えない |

戻り値は `string` です。改行はLFで、BOMと末尾の改行を付けません。文字列の中の改行・空白・Unicodeはそのまま保持します。数値・文字列の表記は `JSON.stringify` に従います。

既定のキー順はUTF-16コード単位の昇順で、端末の言語設定には依存しません。比較関数が同順位、`NaN`、無限大を返した場合もこの順に揃えます。独自の比較関数を使う場合は、日時などの外部状態によって順序を変えないでください。

```ts
const fields = ["id", "name", "value"];
serializeStableJson({ value: "100", id: "row-1", name: "売上" }, {
  space: 2,
  compareKeys: (a, b) => {
    const rank = (key: string) => fields.includes(key) ? fields.indexOf(key) : fields.length;
    return rank(a) - rank(b);
  },
});
```

オブジェクトの `undefined` は省略し、配列の `undefined` や空き要素は `null` にします。循環参照、関数、Symbol、BigInt、非有限数、Dateなどの特殊なオブジェクトは `TypeError` にします。長さの上限を超える場合、不正な `maxLength` / `space` は `RangeError` です。

## LikeXの保存で使う場合

Spreadsheetは `serializeWorkbook`、Slideは `serializeSlideDeck` を使ってください。これらはデータ構造を検証し、画面に沿った順序に変換してから、このヘルパーで書き出します。保存形式への変換を伴うため、単に `JSON.stringify` を呼ぶ場合とは出力が異なります。

`onSave` の引数は編集用モデルのままです。親がファイルやBlobへ保存する際にも同じserialize APIを使うことで、ダウンロードと保存の書式を統一できます。保存先で同じハッシュなら書き込みを省略する、といった判断は親側で行います。このヘルパーはストレージへアクセスしません。
