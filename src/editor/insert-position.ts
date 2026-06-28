/**
 * Where a slice should be inserted near a caret so it lands at a valid drop
 * target *for that kind of content* — mirroring drag-and-drop, where what counts
 * as a drop target depends on what you're dropping.
 *
 * Inserting a block-level slice (a shelf card, a quick card, a sent slice) at a
 * raw caret inside a `card` forces ProseMirror to split the card to fit it,
 * spawning a phantom blank-tag (`id: null`) card for the orphaned tail. But
 * snapping *everything* to the doc root is wrong too: inline text should stay at
 * the caret, and card content (a cite / body / undertag) belongs INSIDE the
 * card, not ejected out of it. So the snap is content-aware.
 */

import { type Fragment, type Node as PMNode } from 'prosemirror-model';

/**
 * The position near `pos` where `content` legally drops, found by walking
 * outward from `pos` to the innermost ancestor that accepts it:
 *   - inline content → the caret itself (a textblock accepts it directly);
 *   - card content (`card_body` / `cite_paragraph` / `undertag` / `table`) →
 *     the nearer gap between the children of the enclosing `card` /
 *     `analytic_unit`;
 *   - a whole `card` / `analytic_unit` / heading → the nearer doc-level gap.
 * Within the accepting level it picks the nearer of the two surrounding gaps
 * (ties favor the gap before). Returns `pos` unchanged when it's already a valid
 * drop point, or when nothing in the ancestry accepts `content`.
 */
export function nearestValidInsertPos(
  doc: PMNode,
  pos: number,
  content: Fragment,
): number {
  const $pos = doc.resolve(pos);
  for (let d = $pos.depth; d >= 0; d--) {
    const container = $pos.node(d);
    const index = $pos.index(d);
    if (d === $pos.depth) {
      // `pos` sits directly inside this node. If the content fits right here —
      // inline in a textblock, or a block at an already-valid gap — keep the
      // caret; no snapping needed.
      if (container.canReplace(index, index, content)) return pos;
      continue;
    }
    // node(d) is an ancestor; the child on the path to `pos` is at depth d+1,
    // sitting at child-index `index`. Its surrounding gaps:
    const before = $pos.before(d + 1);
    const after = $pos.after(d + 1);
    const canBefore = container.canReplace(index, index, content);
    const canAfter = container.canReplace(index + 1, index + 1, content);
    if (canBefore && canAfter) return pos - before <= after - pos ? before : after;
    if (canBefore) return before;
    if (canAfter) return after;
  }
  return pos;
}
