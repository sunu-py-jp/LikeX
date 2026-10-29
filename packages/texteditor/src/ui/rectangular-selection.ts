import { EditorSelection, countColumn, findColumn, type EditorState } from "@codemirror/state";
import { EditorView, ViewPlugin, type MouseSelectionStyle, type ViewUpdate } from "@codemirror/view";

type ColumnPoint = { offset: number; column: number };

function pointAtOffset(state: EditorState, offset: number): ColumnPoint {
  const line = state.doc.lineAt(offset);
  return { offset, column: countColumn(line.text, state.tabSize, offset - line.from) };
}

function pointAtMouse(view: EditorView, event: MouseEvent): ColumnPoint | null {
  const offset = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
  if (offset === null) return null;
  const point = pointAtOffset(view.state, offset), line = view.state.doc.lineAt(offset);
  // Preserve a column beyond a short line while dragging across longer lines.
  if (offset === line.to) {
    const rect = view.coordsAtPos(offset);
    if (rect && view.defaultCharacterWidth > 0) point.column += Math.max(0, Math.round((event.clientX - rect.left) / view.defaultCharacterWidth));
  }
  return point;
}

/** Logical columns respect tabs and grapheme boundaries; short lines stop at EOL. */
export function rectangleBetween(state: EditorState, anchor: ColumnPoint, head: ColumnPoint): EditorSelection {
  const anchorLine = state.doc.lineAt(anchor.offset).number, headLine = state.doc.lineAt(head.offset).number;
  const first = Math.min(anchorLine, headLine), last = Math.max(anchorLine, headLine);
  const ranges = [];
  for (let number = first; number <= last; number++) {
    const line = state.doc.line(number);
    ranges.push(EditorSelection.range(
      line.from + findColumn(line.text, anchor.column, state.tabSize),
      line.from + findColumn(line.text, head.column, state.tabSize),
    ));
  }
  return EditorSelection.create(ranges, headLine - first);
}

/** Keep the original corner when the user extends the rectangle with another click. */
export class RectangleSelectionSession {
  anchor: ColumnPoint | null = null;
  selection: EditorSelection | null = null;

  update(update: ViewUpdate) {
    if (update.docChanged || (update.selectionSet && !this.selection?.eq(update.state.selection))) {
      this.anchor = null;
      this.selection = null;
    }
  }
}

export function rectangleMouseStyle(view: EditorView, event: MouseEvent, session: RectangleSelectionSession): MouseSelectionStyle | null {
  if (!event.altKey || !event.shiftKey || event.button !== 0) return null;
  let down = pointAtMouse(view, event);
  if (!down) return null;
  let origin = session.anchor ?? pointAtOffset(view.state, view.state.selection.main.anchor);
  let dragging = false;
  return {
    get(current) {
      // A click extends from the existing caret. A drag keeps the established
      // Alt+Shift drag gesture, starting from the current mousedown position.
      dragging ||= Math.max(Math.abs(current.clientX - event.clientX), Math.abs(current.clientY - event.clientY)) >= 4;
      const head = pointAtMouse(view, current);
      if (!head) return view.state.selection;
      const anchor = dragging ? down! : origin;
      const selection = rectangleBetween(view.state, anchor, head);
      session.anchor = anchor;
      session.selection = selection;
      return selection;
    },
    update(update) {
      if (update.docChanged) {
        origin = pointAtOffset(update.state, update.changes.mapPos(origin.offset));
        down = pointAtOffset(update.state, update.changes.mapPos(down!.offset));
      }
    },
  };
}

const rectangleSession = ViewPlugin.fromClass(RectangleSelectionSession);

export const anchoredRectangularSelection = [
  rectangleSession,
  EditorView.mouseSelectionStyle.of((view, event) => {
    const session = view.plugin(rectangleSession);
    return session ? rectangleMouseStyle(view, event, session) : null;
  }),
];
