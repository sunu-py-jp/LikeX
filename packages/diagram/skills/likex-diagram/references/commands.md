# ダイアグラムの操作例

```json
[
  {"type":"node.add","node":{"id":"start","shape":"ellipse","text":"開始","x":60,"y":100}},
  {"type":"node.add","node":{"id":"review","shape":"diamond","text":"確認","x":340,"y":100}},
  {"type":"edge.add","edge":{"id":"start-review","sourceId":"start","targetId":"review","label":"申請"}},
  {"type":"nodes.move","ids":["start","review"],"dx":0,"dy":80},
  {"type":"node.update","id":"review","patch":{"fill":"#dbeafe","width":200,"height":120}}
]
```

ノードの削除は`node.remove { ids }`、接続線だけの削除は`edge.remove { ids }`です。`nodes.align`のalignmentは`left / center / right / top / middle / bottom`です。`edge.update`で接続先・ラベル・色、`diagram.update`でtitleを変更できます。

JavaScriptでは`executeDiagramCommands(model, commands)`が更新済み`DiagramModel`を直接返します。`getDiagramNode(model,id)`・`getDiagramEdge(model,id)`は見つからなければ`undefined`です。`exportDiagramSvg(model)`はエスケープ済みSVG文字列を返します。純粋APIに認証・保存・実行エンジンは含みません。

`nodes.order { ids, position: "front" | "back" }`と`edges.order { ids, position: "front" | "back" }`は各配列内の重なり順を変更します。配列の後ろが前面で、選択対象内の元の順序を保ちます。接続線はノードより背面に描画されます。

GUIの右クリック「複製」と同じ結果は、新しいIDと元の属性を持つ`node.add`・`edge.add`のバッチで作れます。ノードの`x`・`y`をそれぞれ24増やし、選択ノード間の接続線は複製先IDへ結び直します。明示的に選択した接続線のうち、複製されない端点は元のIDを保持します。接続を参照するため、先にノード、次に接続線の順で追加します。
