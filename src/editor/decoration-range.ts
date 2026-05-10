/**
 * Helpers for incremental decoration updates.
 *
 * For very large documents, recomputing decorations across the whole
 * doc on every keystroke is the dominant typing-latency cost. These
 * helpers let a plugin map its existing DecorationSet through a
 * transaction's mapping (cheap) and recompute decorations only for
 * the changed region (small).
 */

import type { Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';

/**
 * Compute the union of doc-position ranges affected by a transaction.
 * Returns null if no range is affected (shouldn't happen when
 * `tr.docChanged` is true, but defensive). Range is in the *new* doc's
 * coordinates.
 */
export function changedRange(tr: Transaction): { from: number; to: number } | null {
  let from = Infinity;
  let to = -Infinity;
  tr.mapping.maps.forEach((map) => {
    map.forEach((_oldFrom, _oldTo, nFrom, nTo) => {
      if (nFrom < from) from = nFrom;
      if (nTo > to) to = nTo;
    });
  });
  if (from > to) return null;
  return { from, to };
}

/**
 * Expand a doc-position range to the boundaries of the enclosing
 * top-level (depth-1) doc child. This means a typing change inside a
 * card forces recomputation only across that card, not the whole doc.
 *
 * For a range that spans multiple top-level children (e.g. a delete
 * across cards), the result encompasses all of them.
 */
export function expandToTopLevel(
  doc: PMNode,
  from: number,
  to: number,
): { from: number; to: number } {
  const safeFrom = Math.max(0, Math.min(from, doc.content.size));
  const safeTo = Math.max(safeFrom, Math.min(to, doc.content.size));
  const $from = doc.resolve(safeFrom);
  const $to = doc.resolve(safeTo);
  return {
    from: $from.depth >= 1 ? $from.before(1) : 0,
    to: $to.depth >= 1 ? $to.after(1) : doc.content.size,
  };
}
