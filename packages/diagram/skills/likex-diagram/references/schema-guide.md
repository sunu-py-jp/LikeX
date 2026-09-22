# LikeDiagramの保存形式

構造の定義は[diagram.schema.json](diagram.schema.json)、コマンド配列は[commands.schema.json](commands.schema.json)です。生成ファイルを直接編集せず、公開TypeScript型から再生成します。

識別子は`likex.diagram`、現行バージョンは`1`です。JSON Schemaはフィールド型の確認用で、参照先・重複ID・サイズ・画像内容などの意味検証は`normalizeDiagram` / `parseDiagram`が最終判断します。

ノードは長方形・楕円・ひし形です。接続線は存在する異なるノードIDを参照します。ノードを削除すると接続線も削除されます。位置と寸法はキャンバス座標で、並び順は描画の重なり順です。IDを別のノードに使い回さないでください。SVGは表示・共有用で、再編集にはJSONを使います。

上限: ノード5,000、接続10,000、コマンド10,000件、JSON 8 Mi文字。 座標は有限値の±100,000、色は`#RRGGBB`です。大きいデータはinspectで対象IDを指定して必要な部分のみ確認してください。

保存には`serializeDiagram`を使います。同じモデルの保存は決定的で、既存IDや並び順を不要に更新しません。純粋なコマンドAPIは入力を変更せず、バッチ途中の失敗も入力へ部分反映しません。

## 最小の保存ファイル

```json
{
  "format": "likex.diagram",
  "version": 1,
  "id": "diagram-sample",
  "title": "サンプル",
  "nodes": [],
  "edges": []
}
```

コマンド例はこの初期ファイルへ適用できます。
