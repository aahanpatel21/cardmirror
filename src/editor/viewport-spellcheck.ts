/**
 * Editor spellcheck (viewport-scoped).
 *
 * The mechanism behind the `editorSpellcheck` setting: a custom checker
 * that flags misspellings in the *visible* part of the document — so,
 * unlike the browser's built-in checker, it catches words in opened /
 * imported text, not just words you're actively typing. It stays cheap
 * on huge debate docs by only ever scanning the screenful that's on
 * screen, re-checked after scroll/edit settles. The cost tracks
 * words-on-screen, not document size.
 *
 * Dictionary: nspell (Hunspell-in-JS) over the en `.aff`/`.dic`,
 * dynamically imported so the ~550KB dictionary is a separate async
 * chunk loaded only the first time spellcheck is switched on.
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { settings } from './settings.js';

const key = new PluginKey<DecorationSet>('viewportSpellcheck');

/** Memoized lookups — debate text repeats words heavily, so a cache
 *  makes the second+ occurrence of every word free. */
const verdictCache = new Map<string, boolean>();
function isCorrect(w: string): boolean {
  let v = verdictCache.get(w);
  if (v === undefined) {
    v = spell!.correct(w);
    verdictCache.set(w, v);
  }
  return v;
}

/** Lazily-built nspell instance, shared across views. */
let spell: { correct(w: string): boolean } | null = null;
let building = false;
async function ensureSpell(onReady: () => void): Promise<void> {
  if (spell || building) return;
  building = true;
  try {
    const [{ default: nspell }, aff, dic] = await Promise.all([
      import('nspell'),
      import('./dict/en.aff?raw'),
      import('./dict/en.dic?raw'),
    ]);
    spell = nspell(aff.default, dic.default);
  } finally {
    building = false;
  }
  onReady();
}

// Latin words incl. internal apostrophes (don't / O'Brien).
const WORD_RE = /[A-Za-z][A-Za-z']*/g;

/** Doc range currently on screen, found via hit-testing the viewport
 *  top/bottom — O(log n), independent of doc size. */
function visibleRange(view: EditorView): { from: number; to: number } {
  const rect = (view.dom as HTMLElement).getBoundingClientRect();
  const left = rect.left + Math.min(40, Math.max(2, rect.width / 2));
  const size = view.state.doc.content.size;
  const topHit = view.posAtCoords({ left, top: 2 });
  const botHit = view.posAtCoords({ left, top: window.innerHeight - 2 });
  let from = topHit ? topHit.pos : 0;
  let to = botHit ? botHit.pos : size;
  if (from > to) [from, to] = [to, from];
  return { from: Math.max(0, from - 40), to: Math.min(size, to + 40) };
}

function computeDecos(view: EditorView): DecorationSet {
  if (!spell) return DecorationSet.empty;
  const { from, to } = visibleRange(view);
  const decos: Decoration[] = [];
  view.state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text;
    WORD_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WORD_RE.exec(text)) !== null) {
      const w = m[0];
      if (w.length < 3) continue; // skip a/an/etc.
      if (w === w.toUpperCase()) continue; // skip ACRONYMS / ALLCAPS
      if (isCorrect(w)) continue;
      const start = pos + m.index;
      decos.push(
        Decoration.inline(start, start + w.length, { class: 'pmd-misspelled' }),
      );
    }
  });
  return DecorationSet.create(view.state.doc, decos);
}

export function viewportSpellcheckPlugin(): Plugin {
  return new Plugin<DecorationSet>({
    key,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, old) {
        const meta = tr.getMeta(key);
        if (meta !== undefined) return meta as DecorationSet;
        return old.map(tr.mapping, tr.doc);
      },
    },
    props: {
      decorations(state) {
        return key.getState(state);
      },
    },
    view(view) {
      let timer = 0;
      let lastEnabled = settings.get('editorSpellcheck');
      const setDecos = (set: DecorationSet): void => {
        view.dispatch(view.state.tr.setMeta(key, set).setMeta('addToHistory', false));
      };
      const recompute = (): void => {
        // Gated on the same `editorSpellcheck` setting as the built-in
        // checker. When off, clear any squiggles and do no work (and
        // don't build the dictionary).
        if (!settings.get('editorSpellcheck')) {
          const cur = key.getState(view.state);
          if (cur && cur.find().length > 0) setDecos(DecorationSet.empty);
          return;
        }
        void ensureSpell(schedule); // builds lazily on first enabled check
        setDecos(computeDecos(view));
      };
      // Trailing debounce: re-check only after scrolling/typing settles,
      // so a fast scroll does ONE check at the end instead of one per
      // frame. ~120ms feels instant once you stop.
      const schedule = (): void => {
        if (timer) clearTimeout(timer);
        timer = window.setTimeout(() => {
          timer = 0;
          recompute();
        }, 120);
      };
      // Scroll container: the pane body in multi-pane, else `#app` in
      // single-doc, else the window. Recompute when it scrolls.
      const scroller: HTMLElement | Window =
        (view.dom.closest('.pmd-pane-body') as HTMLElement | null) ??
        document.getElementById('app') ??
        window;
      scroller.addEventListener('scroll', schedule, { passive: true });
      window.addEventListener('resize', schedule, { passive: true });
      // React to the spellcheck toggle flipping (clear when off, check
      // when on) without reacting to every unrelated settings change.
      const unsub = settings.subscribe((s) => {
        if (s.editorSpellcheck !== lastEnabled) {
          lastEnabled = s.editorSpellcheck;
          schedule();
        }
      });
      schedule();
      return {
        update(_v, prev) {
          if (!prev.doc.eq(view.state.doc)) schedule();
        },
        destroy() {
          scroller.removeEventListener('scroll', schedule);
          window.removeEventListener('resize', schedule);
          unsub();
          if (timer) clearTimeout(timer);
        },
      };
    },
  });
}
