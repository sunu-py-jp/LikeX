# ホワイトボードの操作例

```json
[
  {"type":"element.add","element":{"id":"idea","kind":"sticky","text":"次の改善案","x":80,"y":100,"fill":"#fff2a8"}},
  {"type":"element.add","element":{"id":"heading","kind":"text","text":"検討中","x":80,"y":20,"fontSize":24}},
  {"type":"elements.move","ids":["idea","heading"],"dx":120,"dy":0},
  {"type":"element.update","id":"idea","patch":{"text":"確定した改善案","width":260}},
  {"type":"elements.order","ids":["idea"],"position":"front"}
]
```

画像は`element.add { element: { kind: "image", src: "data:image/png;base64,...", alt: "説明", width: 320 } }`の形式です。実際のPNG/JPEGデータが必要で、上の省略文字列は読み込めません。

削除は`element.remove { ids }`、整列は`elements.align { ids, alignment }`（`left / center / right / top / middle / bottom`）です。`whiteboard.update`でtitleを変更できます。

JavaScriptでは`executeWhiteboardCommands(model, commands)`が更新済み`WhiteboardModel`を直接返します。`getWhiteboardElement(model,id)`は見つからなければ`undefined`です。`exportWhiteboardSvg(model)`は画像を埋め込んだSVG文字列を返します。画像を外部サービスへ送らず、通信・DB・保存処理は呼び出し側で実装します。

GUIの右クリック「複製」と同じ結果は、対象の全属性を持つ`element.add`のバッチで作れます。新しいIDを指定し、`x`・`y`をそれぞれ24増やします。対象配列の順序を保ち、画像は`src`・`alt`も引き継ぎます。複製・重なり順・削除を保存するためにGUIの表示選択は必要ありません。
