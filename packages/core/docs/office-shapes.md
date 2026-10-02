# Office標準図形

`@likex/core` の `OFFICE_SHAPE_PRESETS` は基本図形・ブロック矢印・フローチャートの39種類をまとめた共通カタログです。`preset` は DrawingML の標準名、`label` は表示名、`category` は `basic` / `arrows` / `flowchart` です。線・接続線はこのカタログと分けて扱います。

```ts
import { getOfficeShapeGeometry, getOfficeShapeOutline, isOfficeShapePreset } from "@likex/core";

if (isOfficeShapePreset("bentArrow")) {
  const geometry = getOfficeShapeGeometry("bentArrow", 240, 120);
  // geometry.paths: SVG path の d と fill/stroke の有効・無効。
  // geometry.textRect: 左上を原点とする実寸の文字領域。
  const outline = getOfficeShapeOutline("bentArrow", 240, 120);
  // getConnectorPortPoints / createOfficeConnectorGeometry に渡せる輪郭。
}
```

図形はOfficeの標準調整値で描画します。縦横比に応じて矢印の幅・曲がり・文字領域を計算し、曲線と複数のパスを保持します。図形ごとの編集コマンド、保存モデル、インポート時の警告は各UIライブラリが担当します。共通APIはDOM・React・通信に依存しません。

寸法は0〜1e9の有限数です。0幅・0高さは退化形として扱います。SVGのパスには6桁の小数までを出力します。曲線は四分円ごとの三次ベジェ近似で、自由なOffice調整ハンドルは未対応です。読み込んだOfficeファイルの数式・パスをこの計算器に渡す機能はありません。

カギ矢印やUターン矢印は矩形の中心が図形の内側にない場合があります。`paths`型の`ConnectorOutline`は数値の移動・直線・三次ベジェ・閉じる命令、8個の明示接続点、文字領域を持ち、中心からの放射線に依存しません。曲線の接続点は各ベジェを32分割した境界上から選びます。Officeへ接続点付きで出力すると、標準DrawingMLカスタム図形として曲線・内側の線・文字領域・8接続点を保持します。このときOfficeのプリセット調整ハンドルは保持しません。

定義データは[Apache POI 5.4.1の図形定義](https://github.com/apache/poi/blob/REL_5_4_1/poi/src/main/resources/org/apache/poi/sl/draw/geom/presetShapeDefinitions.xml)から対象図形の標準パスとガイドを抽出しています。Apache POIの実行ライブラリへの依存はありません。[NOTICE](../NOTICE)に出典・変更点・Apache-2.0ライセンスを保持し、ビルド時にソースコピーとパッケージの`THIRD_PARTY_NOTICES.md`にも含めます。
