/**
 * Find / Replace plugin — matching + navigate + replace behavior.
 * UI / floating bar is tested via real-use; the plugin's match
 * scanning and replacement semantics are covered here.
 */

import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { schema } from '../../src/schema/index.js';
import {
  findReplaceKey,
  findReplacePlugin,
  runReplace,
  runReplaceAll,
} from '../../src/editor/find-replace-plugin.js';

function paragraph(text: string) {
  return text
    ? schema.nodes['paragraph']!.create(null, schema.text(text))
    : schema.nodes['paragraph']!.create(null, []);
}

function makeDoc(children: import('prosemirror-model').Node[]) {
  return schema.nodes['doc']!.createChecked(null, children);
}

function freshState(text: string): EditorState {
  return EditorState.create({
    doc: makeDoc([paragraph(text)]),
    schema,
    plugins: [findReplacePlugin()],
  });
}

function setQuery(
  state: EditorState,
  query: string,
  opts: {
    caseSensitive?: boolean;
    wholeWord?: boolean;
    sortMode?: 'categorized' | 'proximity';
    anchor?: number;
    categoryOrder?: ('heading' | 'tag' | 'cite' | 'other')[];
  } = {},
): EditorState {
  return state.apply(
    state.tr.setMeta(findReplaceKey, {
      type: 'setQuery',
      query,
      caseSensitive: !!opts.caseSensitive,
      wholeWord: !!opts.wholeWord,
      // Tests default to proximity sort anchored at position 0 so
      // matches stay in document order (matches the pre-sort scan
      // order) — that's what most legacy expectations assume.
      sortMode: opts.sortMode ?? 'proximity',
      anchor: opts.anchor ?? 0,
      categoryOrder: opts.categoryOrder ?? ['heading', 'tag', 'cite', 'other'],
    }),
  );
}

describe('find-replace plugin', () => {
  it('finds every occurrence of a substring', () => {
    const state = setQuery(freshState('hello world hello again hello'), 'hello');
    const s = findReplaceKey.getState(state)!;
    expect(s.matches.length).toBe(3);
    expect(s.currentIndex).toBe(0);
  });

  it('case-insensitive by default', () => {
    const state = setQuery(freshState('Hello WORLD hElLo'), 'hello');
    const s = findReplaceKey.getState(state)!;
    expect(s.matches.length).toBe(2);
  });

  it('case-sensitive when toggled', () => {
    const state = setQuery(freshState('Hello WORLD hElLo'), 'hello', {
      caseSensitive: true,
    });
    const s = findReplaceKey.getState(state)!;
    expect(s.matches.length).toBe(0);
  });

  it('whole-word excludes substring hits', () => {
    const state = setQuery(freshState('the cat catalog scatter'), 'cat', {
      wholeWord: true,
    });
    const s = findReplaceKey.getState(state)!;
    expect(s.matches.length).toBe(1);
  });

  it('navigate wraps around the ends', () => {
    let state = setQuery(freshState('a a a'), 'a');
    expect(findReplaceKey.getState(state)!.currentIndex).toBe(0);
    state = state.apply(
      state.tr.setMeta(findReplaceKey, { type: 'navigate', dir: 1 }),
    );
    expect(findReplaceKey.getState(state)!.currentIndex).toBe(1);
    state = state.apply(
      state.tr.setMeta(findReplaceKey, { type: 'navigate', dir: 1 }),
    );
    state = state.apply(
      state.tr.setMeta(findReplaceKey, { type: 'navigate', dir: 1 }),
    );
    // Three forward hops from index 0 in a list of 3 → wraps back to 0.
    expect(findReplaceKey.getState(state)!.currentIndex).toBe(0);
    state = state.apply(
      state.tr.setMeta(findReplaceKey, { type: 'navigate', dir: -1 }),
    );
    expect(findReplaceKey.getState(state)!.currentIndex).toBe(2);
  });

  it('replace swaps the current match and rescans', () => {
    let state = setQuery(freshState('foo bar foo bar'), 'foo');
    expect(findReplaceKey.getState(state)!.matches.length).toBe(2);
    const cmd = runReplace('XYZ');
    let next: EditorState | null = null;
    cmd(state, (tr) => { next = state.apply(tr); });
    expect(next).not.toBeNull();
    state = next!;
    expect(state.doc.textContent).toBe('XYZ bar foo bar');
    const s = findReplaceKey.getState(state)!;
    // One match left (the second 'foo'); active index advanced to it.
    expect(s.matches.length).toBe(1);
    expect(s.currentIndex).toBe(0);
  });

  it('replace all swaps every match in a single transaction', () => {
    let state = setQuery(freshState('foo bar foo bar foo'), 'foo');
    const cmd = runReplaceAll('Q');
    let next: EditorState | null = null;
    cmd(state, (tr) => { next = state.apply(tr); });
    expect(next).not.toBeNull();
    state = next!;
    expect(state.doc.textContent).toBe('Q bar Q bar Q');
    const s = findReplaceKey.getState(state)!;
    expect(s.matches.length).toBe(0);
    expect(s.currentIndex).toBe(-1);
  });

  it('clear resets the state', () => {
    let state = setQuery(freshState('a a a'), 'a');
    expect(findReplaceKey.getState(state)!.matches.length).toBe(3);
    state = state.apply(
      state.tr.setMeta(findReplaceKey, { type: 'clear' }),
    );
    const s = findReplaceKey.getState(state)!;
    expect(s.query).toBe('');
    expect(s.matches.length).toBe(0);
    expect(s.currentIndex).toBe(-1);
  });

  it('rescans automatically when the doc changes', () => {
    let state = setQuery(freshState('foo bar foo'), 'foo');
    expect(findReplaceKey.getState(state)!.matches.length).toBe(2);
    // Append " foo" at the end of the paragraph by inserting text.
    const insertAt = state.doc.content.size - 1;
    state = state.apply(state.tr.insertText(' foo', insertAt));
    expect(findReplaceKey.getState(state)!.matches.length).toBe(3);
  });

  it('matches across separate textblocks (one per paragraph)', () => {
    const doc = makeDoc([
      paragraph('hello world'),
      paragraph('again hello'),
      paragraph('no match here'),
    ]);
    const state = EditorState.create({
      doc,
      schema,
      plugins: [findReplacePlugin()],
    });
    const next = setQuery(state, 'hello');
    expect(findReplaceKey.getState(next)!.matches.length).toBe(2);
  });
});

describe('find ordering', () => {
  function hat(text: string) {
    return schema.nodes['hat']!.create({ id: null }, schema.text(text));
  }
  function tag(text: string) {
    return schema.nodes['tag']!.create({ id: null }, schema.text(text));
  }
  function citePara(text: string) {
    return schema.nodes['cite_paragraph']!.create(null, schema.text(text));
  }
  function cardBody(text: string) {
    return schema.nodes['card_body']!.create(null, schema.text(text));
  }
  function cardWith(...children: import('prosemirror-model').Node[]) {
    return schema.nodes['card']!.createChecked(null, children);
  }

  it('categorized: heading hits come before tag, cite, and body hits', () => {
    const doc = makeDoc([
      paragraph('foo before card'),
      hat('foo in hat'),
      cardWith(
        tag('foo in tag'),
        citePara('foo in cite'),
        cardBody('foo in body'),
      ),
    ]);
    const state = EditorState.create({
      doc,
      schema,
      plugins: [findReplacePlugin()],
    });
    const next = setQuery(state, 'foo', {
      sortMode: 'categorized',
      anchor: 0,
      categoryOrder: ['heading', 'tag', 'cite', 'other'],
    });
    const cats = findReplaceKey.getState(next)!.matches.map((m) => m.category);
    expect(cats).toEqual(['heading', 'tag', 'cite', 'other', 'other']);
  });

  it('proximity: matches after the anchor come before matches before it', () => {
    // 5 matches in order: 'foo' at positions p1 < p2 < p3 < p4 < p5.
    // With anchor between p2 and p3, the result order should be
    // p3, p4, p5 (after-anchor, closest-first), then p2, p1
    // (before-anchor, closest-first).
    const doc = makeDoc([
      paragraph('foo one'),
      paragraph('foo two'),
      paragraph('foo three'),
      paragraph('foo four'),
      paragraph('foo five'),
    ]);
    const state = EditorState.create({
      doc,
      schema,
      plugins: [findReplacePlugin()],
    });
    // First scan with proximity-from-zero so we can grab the raw
    // match positions in doc order without sort interference.
    const scout = setQuery(state, 'foo', { sortMode: 'proximity', anchor: 0 });
    const docOrderFroms = findReplaceKey.getState(scout)!.matches.map((m) => m.from);
    // Anchor between match 2 and match 3.
    const anchor = (docOrderFroms[1]! + docOrderFroms[2]!) / 2;
    const next = setQuery(state, 'foo', { sortMode: 'proximity', anchor });
    const orderedFroms = findReplaceKey.getState(next)!.matches.map((m) => m.from);
    // After-anchor first: m3, m4, m5; then before-anchor closest-first: m2, m1.
    expect(orderedFroms).toEqual([
      docOrderFroms[2],
      docOrderFroms[3],
      docOrderFroms[4],
      docOrderFroms[1],
      docOrderFroms[0],
    ]);
  });

  it('categorized: within a category, ranking falls back to proximity', () => {
    // Two paragraphs both 'other'. Anchor closer to the SECOND one
    // → second should come first within the 'other' bucket.
    const doc = makeDoc([
      paragraph('foo one'),
      paragraph('foo two'),
    ]);
    const state = EditorState.create({
      doc,
      schema,
      plugins: [findReplacePlugin()],
    });
    const scout = setQuery(state, 'foo', { sortMode: 'proximity', anchor: 0 });
    const fromsDocOrder = findReplaceKey.getState(scout)!.matches.map((m) => m.from);
    const anchor = fromsDocOrder[1]!;
    const next = setQuery(state, 'foo', {
      sortMode: 'categorized',
      anchor,
      categoryOrder: ['heading', 'tag', 'cite', 'other'],
    });
    const orderedFroms = findReplaceKey.getState(next)!.matches.map((m) => m.from);
    // The match AT or AFTER the anchor (the second one) ranks first.
    expect(orderedFroms[0]).toBe(fromsDocOrder[1]);
    expect(orderedFroms[1]).toBe(fromsDocOrder[0]);
  });

  it('categorized: user-defined order reshuffles categories', () => {
    const doc = makeDoc([
      hat('foo in hat'),
      cardWith(tag('foo in tag')),
    ]);
    const state = EditorState.create({
      doc,
      schema,
      plugins: [findReplacePlugin()],
    });
    const next = setQuery(state, 'foo', {
      sortMode: 'categorized',
      anchor: 0,
      categoryOrder: ['tag', 'heading', 'cite', 'other'],
    });
    const cats = findReplaceKey.getState(next)!.matches.map((m) => m.category);
    expect(cats).toEqual(['tag', 'heading']);
  });
});
