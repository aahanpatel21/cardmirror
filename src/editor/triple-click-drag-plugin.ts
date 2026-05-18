/**
 * Triple-click + drag → paragraph-snapping range extension.
 *
 * Standard editor convention (Word, VS Code, browsers' contenteditable
 * default): a triple-click selects the paragraph; if the user holds
 * the mouse button after the third click and drags up/down, the
 * selection extends one whole paragraph at a time instead of
 * character-by-character. ProseMirror's default click handling
 * resets to character-level on the first mousemove, so we install
 * an explicit listener.
 *
 * Mechanism: on a triple-click mousedown (event.detail === 3), the
 * plugin records the anchor textblock's range from `posAtCoords` and
 * installs window-level mousemove + mouseup listeners. Each
 * mousemove resolves the current pointer position to a textblock
 * and dispatches a `TextSelection` spanning anchor↔current. Mouseup
 * tears the listeners down. The plugin never preventDefaults the
 * mousedown — PM's own triple-click selection still happens
 * normally, the drag-extender just takes over from there.
 */

import { Plugin, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

export const tripleClickDragPlugin: Plugin = new Plugin({
  props: {
    handleDOMEvents: {
      mousedown(view, event) {
        if (event.button !== 0 || event.detail !== 3) return false;
        const anchor = textblockRangeAtCoords(view, event.clientX, event.clientY);
        if (!anchor) return false;

        const onMove = (e: MouseEvent) => {
          const current = textblockRangeAtCoords(view, e.clientX, e.clientY);
          if (!current) return;
          // Build the union of [anchor, current] — order-independent
          // so the same code path handles dragging both up and down.
          const from = Math.min(anchor.from, current.from);
          const to = Math.max(anchor.to, current.to);
          const sel = view.state.selection;
          if (sel.from === from && sel.to === to) return;
          try {
            const tr = view.state.tr.setSelection(
              TextSelection.create(view.state.doc, from, to),
            );
            view.dispatch(tr);
          } catch {
            // Invalid range (e.g., dragged across a node boundary
            // PM doesn't allow as a TextSelection — across a table
            // cell border, say). Ignore and wait for the next move.
          }
        };
        const onUp = () => {
          window.removeEventListener('mousemove', onMove, true);
          window.removeEventListener('mouseup', onUp, true);
        };
        // Capture phase so we beat any node-level handlers that
        // might call stopPropagation on mouseup.
        window.addEventListener('mousemove', onMove, true);
        window.addEventListener('mouseup', onUp, true);
        return false;
      },
    },
  },
});

/** Resolve viewport coords to the [from, to] range of the textblock
 *  the click falls inside. Returns `null` when coords don't resolve
 *  inside any textblock (clicked the editor whitespace below the
 *  doc, etc.). */
function textblockRangeAtCoords(
  view: EditorView,
  clientX: number,
  clientY: number,
): { from: number; to: number } | null {
  const coords = view.posAtCoords({ left: clientX, top: clientY });
  if (!coords) return null;
  const $pos = view.state.doc.resolve(
    Math.max(0, Math.min(coords.pos, view.state.doc.content.size)),
  );
  let depth = $pos.depth;
  while (depth > 0 && !$pos.node(depth).isTextblock) depth--;
  if (depth === 0) return null;
  return {
    from: $pos.before(depth) + 1,
    to: $pos.after(depth) - 1,
  };
}
