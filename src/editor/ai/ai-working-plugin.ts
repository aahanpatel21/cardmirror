/**
 * AI-working highlight plugin.
 *
 * While an AI operation runs on a range (a card being cut, a selection
 * being repaired), the enclosing CONTAINER — the card/unit box — is
 * outlined in purple, mirroring the blue pickup box shown while
 * dragging a card out of the editor (`.pmd-editor-pickup-highlight`)
 * but in the "Thinking…" pill's accent. This makes it obvious WHAT the
 * AI is working on even after the text selection is cleared. View-only
 * decoration: never a mark, never serialized. At most one container is
 * active at a time; `setAiWorking(view, range)` sets it from a doc
 * range, `setAiWorking(view, null)` clears it.
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';

interface Range {
  from: number;
  to: number;
}

// undefined meta → map through the edit; null → clear; range → set.
type Meta = Range | null;

const aiWorkingKey = new PluginKey<DecorationSet>('ai-working');

// Same containers the drag-pickup recognizes: the card/unit is the
// preferred target; the structural wrappers are a fallback when the
// range isn't inside a card.
const UNIT_TYPES = new Set(['card', 'analytic_unit']);
const WRAPPER_TYPES = new Set(['pocket', 'hat', 'block']);

/** The enclosing container node's [before, after] range for `from`,
 *  preferring the innermost card/unit, else a structural wrapper. */
function containerRange(doc: PMNode, range: Range): Range | null {
  const inside = Math.min(Math.max(range.from + 1, 0), doc.content.size);
  const $p = doc.resolve(inside);
  for (const types of [UNIT_TYPES, WRAPPER_TYPES]) {
    for (let d = $p.depth; d >= 1; d--) {
      if (types.has($p.node(d).type.name)) {
        return { from: $p.before(d), to: $p.after(d) };
      }
    }
  }
  return null;
}

function decorate(doc: PMNode, range: Range): DecorationSet {
  const box = containerRange(doc, range);
  if (box) {
    return DecorationSet.create(doc, [
      Decoration.node(box.from, box.to, { class: 'pmd-ai-working' }),
    ]);
  }
  // No enclosing container (e.g. a top-level range) — fall back to an
  // inline tint so something still marks the spot.
  if (range.to > range.from) {
    return DecorationSet.create(doc, [
      Decoration.inline(range.from, range.to, { class: 'pmd-ai-working-inline' }),
    ]);
  }
  return DecorationSet.empty;
}

export const aiWorkingPlugin = new Plugin<DecorationSet>({
  key: aiWorkingKey,
  state: {
    init: () => DecorationSet.empty,
    apply(tr, set) {
      const meta = tr.getMeta(aiWorkingKey) as Meta | undefined;
      if (meta === undefined) return set.map(tr.mapping, tr.doc);
      if (meta === null) return DecorationSet.empty;
      return decorate(tr.doc, meta);
    },
  },
  props: {
    decorations(state) {
      return aiWorkingKey.getState(state);
    },
  },
});

/** Outline the container of `range` as "the AI is working here", or
 *  clear it with null. */
export function setAiWorking(view: EditorView, range: Range | null): void {
  try {
    view.dispatch(view.state.tr.setMeta(aiWorkingKey, range));
  } catch {
    // View torn down — nothing to set.
  }
}
