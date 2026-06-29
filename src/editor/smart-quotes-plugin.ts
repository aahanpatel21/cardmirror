/**
 * Word-style smart quotes, gated on the `smartQuotes` setting (default off).
 *
 * As you type a straight `'` or `"`, it's replaced with the correctly-curled
 * character based on the PRECEDING character: an opening curl after a block
 * start / whitespace / an opening bracket / a dash / another opening quote, and
 * a closing curl otherwise. The closing single quote doubles as the apostrophe,
 * so `don't` / `John's` fall out for free. (Leading elisions like `'tis` / `'90s`
 * curl as opening quotes — same as Word; use the Flip Quote Direction command to
 * fix those.)
 *
 * Word-parity revert: pressing Backspace immediately after a curl turns it back
 * into the straight character (rather than deleting it). The pending revert is
 * tracked in plugin state and invalidated by the very next transaction, so it
 * only applies to the keystroke right after the substitution.
 *
 * Produces curly characters, which `normalizeForMatch` / `foldQuotes` already
 * fold for Find + Paragraph Integrity — so search still matches either form.
 */

import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { settings } from './settings.js';

/** A typed quote opens (vs. closes) when the character before it is one of
 *  these — PM's built-in set (whitespace, `{[(<`, straight quotes, opening curly
 *  quotes) PLUS the em-dash and en-dash (the Word behavior PM lacks). */
const OPENING_BEFORE = /[\s{\[(<'"‘“—–]/;

/** A pending Backspace-revert: the curled char sits at [from, to); Backspace
 *  there restores `straight`. */
interface SmartQuotesState {
  undo: { from: number; to: number; straight: string } | null;
}

type Meta = { type: 'curled'; from: number; straight: string };

export const smartQuotesKey = new PluginKey<SmartQuotesState>('pmd-smart-quotes');

/** Pick the curled character for `typed` ('\'' or '"') given the preceding
 *  character `prev` ('' for block start / a leading atom). Exported for tests. */
export function curlFor(typed: string, prev: string): string {
  const opening = prev === '' || OPENING_BEFORE.test(prev);
  if (typed === '"') return opening ? '“' : '”';
  return opening ? '‘' : '’';
}

export function smartQuotesPlugin(): Plugin<SmartQuotesState> {
  return new Plugin<SmartQuotesState>({
    key: smartQuotesKey,
    state: {
      init: () => ({ undo: null }),
      apply(tr, prev): SmartQuotesState {
        const meta = tr.getMeta(smartQuotesKey) as Meta | undefined;
        if (meta?.type === 'curled') {
          return { undo: { from: meta.from, to: meta.from + 1, straight: meta.straight } };
        }
        // Any other transaction (more typing, a cursor move, anything) ends the
        // window in which Backspace reverts the curl.
        return prev.undo === null ? prev : { undo: null };
      },
    },
    props: {
      handleTextInput(view, from, to, text) {
        if (text !== "'" && text !== '"') return false;
        if (!settings.get('smartQuotes')) return false;
        const { state } = view;
        const $from = state.doc.resolve(from);
        // '' at a block start (or after a leading inline atom) → opening context.
        const prev = $from.parentOffset === 0 ? '' : state.doc.textBetween(from - 1, from);
        const curly = curlFor(text, prev);
        const tr = state.tr.insertText(curly, from, to);
        tr.setSelection(TextSelection.create(tr.doc, from + 1));
        tr.setMeta(smartQuotesKey, { type: 'curled', from, straight: text } satisfies Meta);
        view.dispatch(tr.scrollIntoView());
        return true;
      },
      handleKeyDown(view, event) {
        if (event.key !== 'Backspace') return false;
        if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
        const st = smartQuotesKey.getState(view.state);
        if (!st?.undo) return false;
        const { from, to, straight } = st.undo;
        const sel = view.state.selection;
        // Only when the cursor sits exactly after the just-curled character…
        if (!sel.empty || sel.from !== to) return false;
        // …and that character is still a curly quote (defensive).
        if (!/^[‘’“”]$/.test(view.state.doc.textBetween(from, to))) return false;
        const tr = view.state.tr.insertText(straight, from, to);
        tr.setSelection(TextSelection.create(tr.doc, from + 1));
        view.dispatch(tr.scrollIntoView());
        return true;
      },
    },
  });
}
