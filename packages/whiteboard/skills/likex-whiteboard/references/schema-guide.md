# LikeWhiteboardの保存形式

構造の定義は[whiteboard.schema.json](whiteboard.schema.json)、コマンド配列は[commands.schema.json](commands.schema.json)です。生成ファイルを直接編集せず、公開TypeScript型から再生成します。

識別子は`likex.whiteboard`、現行バージョンは`1`です。JSON Schemaはフィールド型の確認用で、参照先・重複ID・サイズ・画像内容などの意味検証は`normalizeWhiteboard` / `parseWhiteboard`が最終判断します。

付箋・テキスト・長方形・楕円・画像を扱います。elementsの後ろほど前面に描画されます。画像は埋め込みPNG/JPEGのdata URLのみです。外部URL・SVG画像は拒否します。画像追加時は幅か高さの片方を指定すれば元の比率を保ちます。既存画像のサイズ変更では、コマンドに幅と高さをセットで渡してください。SVGは共有用で、再編集にはJSONを使います。

上限: 要素5,000、コマンド10,000件、JSON 40 Mi文字。画像は1点8 MiB、合計24 MiB。 座標は有限値の±100,000、色は`#RRGGBB`です。大きいデータはinspectで対象IDを指定して必要な部分のみ確認してください。

保存には`serializeWhiteboard`を使います。同じモデルの保存は決定的で、既存IDや並び順を不要に更新しません。純粋なコマンドAPIは入力を変更せず、バッチ途中の失敗も入力へ部分反映しません。

## 最小の保存ファイル

```json
{
  "format": "likex.whiteboard",
  "version": 1,
  "id": "whiteboard-sample",
  "title": "サンプル",
  "elements": []
}
```

コマンド例はこの初期ファイルへ適用できます。
