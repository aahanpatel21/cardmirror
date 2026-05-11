/**
 * Cite classifier plugin — promotes card_body/paragraph nodes to
 * cite_paragraph when their content is all cite-marked.
 */

import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { citeClassifierPlugin } from '../../src/editor/cite-classifier-plugin.js';

function cited(text: string) {
  return schema.text(text, [schema.marks['cite_mark']!.create()]);
}
function plain(text: string) {
  return schema.text(text);
}
function tagNode(text: string) {
  return schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(text));
}
function cardWith(...children: import('prosemirror-model').Node[]) {
  return schema.nodes['card']!.createChecked(null, children);
}
function bodyOf(...inlines: import('prosemirror-model').Node[]) {
  return schema.nodes['card_body']!.create(null, inlines);
}
function paragraphOf(...inlines: import('prosemirror-model').Node[]) {
  return schema.nodes['paragraph']!.create(null, inlines);
}
function citeParaOf(...inlines: import('prosemirror-model').Node[]) {
  return schema.nodes['cite_paragraph']!.create(null, inlines);
}

/**
 * Apply the classifier to a doc by dispatching a doc-changing transaction
 * that replaces the doc content with itself. state.apply runs the
 * plugin's appendTransaction iteratively, so the result reflects all
 * promotions.
 */
function withPlugin(doc: import('prosemirror-model').Node): import('prosemirror-model').Node {
  const state = EditorState.create({ doc, plugins: [citeClassifierPlugin] });
  const tr = state.tr.replaceWith(0, doc.content.size, doc.content);
  return state.apply(tr).doc;
}

function makeDoc(...children: import('prosemirror-model').Node[]) {
  return schema.nodes['doc']!.createChecked(null, children);
}

describe('cite classifier plugin', () => {
  it('promotes a card_body whose content is all cite-marked', () => {
    const doc = makeDoc(
      cardWith(
        tagNode('T'),
        bodyOf(cited('Author 2024, Source')),
      ),
    );
    const result = withPlugin(doc);
    const card = result.firstChild!;
    const types: string[] = [];
    card.forEach((c) => types.push(c.type.name));
    expect(types).toEqual(['tag', 'cite_paragraph']);
  });

  it('promotes a mixed card_body that contains ANY cite_mark', () => {
    const doc = makeDoc(
      cardWith(
        tagNode('T'),
        bodyOf(cited('Author 2024'), plain(' some body text')),
      ),
    );
    const result = withPlugin(doc);
    const card = result.firstChild!;
    expect(card.child(1).type.name).toBe('cite_paragraph');
  });

  it('does NOT promote an empty card_body', () => {
    const doc = makeDoc(
      cardWith(tagNode('T'), bodyOf()),
    );
    const result = withPlugin(doc);
    const card = result.firstChild!;
    expect(card.child(1).type.name).toBe('card_body');
  });

  it('does NOT promote a card_body with only plain text', () => {
    const doc = makeDoc(
      cardWith(tagNode('T'), bodyOf(plain('plain body text'))),
    );
    const result = withPlugin(doc);
    const card = result.firstChild!;
    expect(card.child(1).type.name).toBe('card_body');
  });

  it('promotes a doc-level paragraph that contains any cite_mark', () => {
    const doc = makeDoc(paragraphOf(cited('Standalone cite')));
    const result = withPlugin(doc);
    expect(result.firstChild!.type.name).toBe('cite_paragraph');
  });

  it('demotes a cite_paragraph in a card with no cite_mark → card_body', () => {
    const doc = makeDoc(
      cardWith(tagNode('T'), citeParaOf(plain('post-split, no cite'))),
    );
    const result = withPlugin(doc);
    const card = result.firstChild!;
    expect(card.child(1).type.name).toBe('card_body');
  });

  it('demotes an empty cite_paragraph in a card → card_body', () => {
    const doc = makeDoc(
      cardWith(tagNode('T'), schema.nodes['cite_paragraph']!.create(null, [])),
    );
    const result = withPlugin(doc);
    const card = result.firstChild!;
    expect(card.child(1).type.name).toBe('card_body');
  });

  it('demotes a doc-level cite_paragraph with no cite_mark → paragraph', () => {
    const doc = makeDoc(citeParaOf(plain('orphan plain text')));
    const result = withPlugin(doc);
    expect(result.firstChild!.type.name).toBe('paragraph');
  });

  it('leaves a cite_paragraph with cite_mark alone', () => {
    const doc = makeDoc(
      cardWith(tagNode('T'), citeParaOf(cited('Already cite'))),
    );
    const result = withPlugin(doc);
    const card = result.firstChild!;
    expect(card.child(1).type.name).toBe('cite_paragraph');
  });

  it('classifies multiple bodies in a card independently', () => {
    const doc = makeDoc(
      cardWith(
        tagNode('T'),
        bodyOf(cited('Cite 1')),
        bodyOf(plain('Plain body')),
        bodyOf(cited('Cite 2')),
      ),
    );
    const result = withPlugin(doc);
    const card = result.firstChild!;
    const types: string[] = [];
    card.forEach((c) => types.push(c.type.name));
    expect(types).toEqual(['tag', 'cite_paragraph', 'card_body', 'cite_paragraph']);
  });

  it('does not loop: re-running on the result yields the same doc', () => {
    const doc = makeDoc(
      cardWith(tagNode('T'), bodyOf(cited('Cite'))),
    );
    const once = withPlugin(doc);
    const twice = withPlugin(once);
    expect(once.eq(twice)).toBe(true);
  });
});
