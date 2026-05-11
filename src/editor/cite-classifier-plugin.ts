/**
 * Cite classifier plugin.
 *
 * Keeps the type of every paragraph-like node in sync with its inline
 * content: if any text run carries `cite_mark`, the node should be a
 * `cite_paragraph`; otherwise it should be `card_body` (inside a card)
 * or `paragraph` (at doc level). Same rule the importer uses, applied
 * to every dispatched transaction so paste / split / type edits stay
 * classified.
 *
 * Motivating cases:
 *   - Pasting a cite paragraph via the OS clipboard often arrives as
 *     inline content inside the destination paragraph. Without the
 *     promotion the destination stays `card_body` even though it
 *     visually reads as a cite.
 *   - Pressing Enter in the middle of a cite_paragraph: ProseMirror's
 *     splitBlock keeps both halves the same type, so the post-split
 *     paragraph stays `cite_paragraph` even if its content has no
 *     cite_mark. The demote half of the rule fixes that.
 *
 */

import { Plugin } from 'prosemirror-state';
import type { Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../schema/index.js';

const CANDIDATE_TYPES = new Set<string>(['card_body', 'paragraph', 'cite_paragraph']);

export const citeClassifierPlugin: Plugin = new Plugin({
  appendTransaction(transactions, _oldState, newState) {
    if (!transactions.some((t) => t.docChanged)) return null;

    let tr: Transaction | null = null;
    newState.doc.descendants((node, pos) => {
      const name = node.type.name;
      if (!CANDIDATE_TYPES.has(name)) return;
      const $pos = newState.doc.resolve(pos);
      const parent = $pos.parent;
      const target = targetTypeFor(node, parent);
      if (target === null || target === name) return;
      if (!tr) tr = newState.tr;
      tr.setNodeMarkup(pos, schema.nodes[target]!);
    });

    return tr;
  },
});

/**
 * What type SHOULD this paragraph be, given its parent context and its
 * inline content? Returns `null` if it's already in a context we don't
 * touch (e.g., card_body inside analytic_unit when content has cite —
 * cite_paragraph isn't allowed there).
 */
function targetTypeFor(node: PMNode, parent: PMNode): string | null {
  const cite = hasCiteMark(node);
  const parentName = parent.type.name;
  if (parentName === 'card' || parentName === 'analytic_unit') {
    return cite ? 'cite_paragraph' : 'card_body';
  }
  if (parentName === 'doc') {
    return cite ? 'cite_paragraph' : 'paragraph';
  }
  // Other parents (shouldn't occur for our schema) — don't touch.
  return null;
}

function hasCiteMark(node: PMNode): boolean {
  let has = false;
  node.descendants((child) => {
    if (has) return false;
    if (child.isText && child.marks.some((m) => m.type.name === 'cite_mark')) {
      has = true;
    }
    return undefined;
  });
  return has;
}
