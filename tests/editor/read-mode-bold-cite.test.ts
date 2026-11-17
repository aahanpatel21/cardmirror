// @vitest-environment jsdom
/**
 * "Read mode: treat bold as a cite" (readModeBoldCites, default on).
 *
 * A paragraph right after a tag / undertag with no underline or emphasis
 * anywhere and some bold text shows its bold runs in read mode, as if
 * they were cite-marked — a cite paragraph on bold alone, a card body only
 * when the bold includes a digit. The display plugin, Convert Cards to
 * Read Mode and the read-mode export all agree.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { readModePlugin, PMD_READ_MODE_TOGGLE, isReadModeKeptText } from '../../src/editor/read-mode-plugin.js';
import { convertCard } from '../../src/editor/convert-cards-to-read-mode.js';
import { transformForExport } from '../../src/export/transform-for-export.js';
import { settings } from '../../src/editor/settings.js';

const B = () => schema.marks['bold']!.create();
const U = () => schema.marks['underline_mark']!.create();
const E = () => schema.marks['emphasis_mark']!.create();
const C = () => schema.marks['cite_mark']!.create();
const HL = () => schema.marks['highlight']!.create({ color: 'yellow' });

const FS = (pt: number) => schema.marks['font_size']!.create({ halfPoints: pt * 2 });

const tag = (t = 'Tag') => schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text(t));
const undertag = (...c: PMNode[]) => schema.nodes['undertag']!.create(null, c);
const cite = (...c: PMNode[]) => schema.nodes['cite_paragraph']!.create(null, c);
const body = (...c: PMNode[]) => schema.nodes['card_body']!.create(null, c);
const card = (...c: PMNode[]) => schema.nodes['card']!.createChecked(null, c);
const docOf = (...c: PMNode[]) => schema.nodes['doc']!.createChecked(null, c);
const t = (s: string, ...m: ReturnType<typeof B>[]) => schema.text(s, m);

const open: EditorView[] = [];
function readModeView(doc: PMNode): EditorView {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const view = new EditorView(el, { state: EditorState.create({ doc, plugins: [readModePlugin] }) });
  view.dispatch(view.state.tr.setMeta(PMD_READ_MODE_TOGGLE, true));
  open.push(view);
  return view;
}
function classOf(view: EditorView, needle: string): string | null {
  for (const el of view.dom.querySelectorAll('.pmd-rm-keep, .pmd-rm-hide')) {
    if (el.textContent?.includes(needle)) return el.classList.contains('pmd-rm-keep') ? 'keep' : 'hide';
  }
  return null;
}

afterEach(() => {
  for (const v of open.splice(0)) v.destroy();
  settings.set('readModeAuthorFix', true);
  settings.set('readModeKeepEntireCite', false);
});

describe('readModeAuthorFix: Fix Hidden Authors (bolded and 12pt and above)', () => {
  it('a bold run in cite_paragraph (natural 13pt) is kept', () => {
    const p = cite(t('Smith', B()), t(', professor of things'));
    expect(isReadModeKeptText(p.child(0), p)).toBe(true);
    expect(isReadModeKeptText(p.child(1), p)).toBe(false);
  });

  it('a bold run in card_body with 12pt font size is kept', () => {
    const p = body(t('Smith 2024', B(), FS(12)), t(' writes'));
    expect(isReadModeKeptText(p.child(0), p)).toBe(true);
    expect(isReadModeKeptText(p.child(1), p)).toBe(false);
  });

  it('a bold run in card_body below 12pt (e.g. default 11pt) is hidden', () => {
    const p = body(t('Smith 2024', B()), t(' writes'));
    expect(isReadModeKeptText(p.child(0), p)).toBe(false);
  });

  it('non-bold text is hidden even if 12pt', () => {
    const p = body(t('Smith 2024', FS(12)), t(' writes'));
    expect(isReadModeKeptText(p.child(0), p)).toBe(false);
  });

  it('when setting is off, bold 12pt text is hidden', () => {
    settings.set('readModeAuthorFix', false);
    const p = body(t('Smith 2024', B(), FS(12)), t(' writes'));
    expect(isReadModeKeptText(p.child(0), p)).toBe(false);
  });
});

describe('display plugin', () => {
  it('shows the bold runs of a hand-bolded cite and still hides its plain filler', () => {
    const view = readModeView(docOf(card(tag(), cite(t('Smith 2024', B()), t(', an expert, writes')), body(t('body')))));
    expect(classOf(view, 'Smith 2024')).toBe('keep');
    expect(classOf(view, 'an expert')).toBe('hide');
    expect(classOf(view, 'body')).toBe('hide');
  });

  it('shows a bold cite in a body paragraph when bold and 12pt', () => {
    const view = readModeView(docOf(card(tag(), body(t('Smith 2024', B(), FS(12)), t(' explains')), body(t('rest')))));
    expect(classOf(view, 'Smith 2024')).toBe('keep');
    expect(classOf(view, 'explains')).toBe('hide');
  });

  it('a bolded statistic in a body below 12pt stays hidden', () => {
    const view = readModeView(docOf(card(tag(), body(t('40%', B()), t(' of states ', U()), t('agree')))));
    expect(classOf(view, '40%')).toBe('hide');
  });

  it('the setting off restores the old behavior (hides bold 12pt)', () => {
    settings.set('readModeAuthorFix', false);
    const view = readModeView(docOf(card(tag(), cite(t('Smith 2024', B()), t(' filler')))));
    expect(classOf(view, 'Smith 2024')).toBe('hide');
  });

  it('"keep entire cite" treats the bold run as the run that unlocks the whole cite', () => {
    settings.set('readModeKeepEntireCite', true);
    const view = readModeView(docOf(card(tag(), cite(t('Smith 2024', B()), t(', an expert')))));
    expect(classOf(view, 'an expert')).toBe('keep');
  });

  it('highlights inside a bold cite still show; a real cite is unaffected', () => {
    const view = readModeView(
      docOf(card(tag(), cite(t('Smith 2024', B()), t(' key phrase', HL()), t(' tail')), body(t('b')))),
    );
    expect(classOf(view, 'key phrase')).toBe('keep');
    expect(classOf(view, 'tail')).toBe('hide');
  });
});

describe('Convert Cards to Read Mode and export agree with the display', () => {
  it('convertCard keeps the bold cite runs', () => {
    const c = card(tag(), cite(t('Smith 2024', B()), t(', an expert')), body(t('plain '), t('read', HL())));
    const out = convertCard(c);
    expect(out.child(1).type.name).toBe('cite_paragraph');
    expect(out.child(1).textContent).toBe('Smith 2024');
    expect(out.child(2).textContent).toBe('read');
  });

  it('convertCard drops a bold body cite below 12pt, like the display', () => {
    const c = card(tag(), body(t('Smith', B()), t(' writes')), body(t('read', HL())));
    const out = convertCard(c);
    expect(out.textContent).toBe('Tagread');
  });

  it('read-mode export keeps the bold cite', () => {
    const doc = docOf(card(tag(), cite(t('Smith 2024', B()), t(', an expert')), body(t('plain '), t('read', HL()))));
    const out = transformForExport(doc, { includeComments: false, includeAnalytics: false, includeUndertags: false, readMode: true });
    const c = out.firstChild!;
    expect(c.child(1).type.name).toBe('cite_paragraph');
    expect(c.child(1).textContent).toBe('Smith 2024');
    settings.set('readModeAuthorFix', false);
    const off = transformForExport(doc, { includeComments: false, includeAnalytics: false, includeUndertags: false, readMode: true });
    expect(off.firstChild!.childCount).toBe(2); // tag + body; the cite has nothing kept
  });
});
