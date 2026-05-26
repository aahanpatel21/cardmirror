/**
 * Quick Cards — search palette.
 *
 * A floating command-palette-style bar (see
 * `reference-docs/SPEC-quick-cards.md` §6): opens near the bottom of
 * the screen centered over the target editor pane, with results
 * rendered ABOVE the bar. Spawns instantly (input focused
 * synchronously) with a one-shot blue pulse that fades. Typing runs
 * the Block-Search matcher live; the top result is auto-selected.
 *
 *   ↑/↓  navigate · ↵ insert at cursor · ⌥↵ insert at end ·
 *   ⇥    jump to the inline tag filter · esc close
 *
 * Insertion reuses `insertSpeechSlice` (heading-id rewrite, history
 * isolation, etc.); the mid-text confirm is gated on the
 * `quickCardSkipMidTextInsertConfirm` setting.
 *
 * Also exports `openQuickCardTagPicker` — the ribbon Tag Picker
 * dropdown — which edits the same global active-tags filter.
 */

import type { EditorView } from 'prosemirror-view';
import { Slice } from 'prosemirror-model';
import { schema } from '../schema/index.js';
import { settings } from './settings.js';
import { showToast } from './toast.js';
import { insertSpeechSlice } from './speech-doc-send.js';
import { quickCardsStore, distinctTags, normalizeTag, type QuickCard } from './quick-cards-store.js';
import { searchQuickCards, type QuickCardSearchResult } from './quick-cards-match.js';

export interface QuickCardSearchOptions {
  /** Target view to insert into. Null = no insertable target (the
   *  palette still opens for browsing; insert no-ops with a hint). */
  view: EditorView | null;
  /** Element to center the bar over (the focused pane / editor).
   *  Null centers on the window. */
  paneEl: HTMLElement | null;
}

function activeTagSet(): Set<string> {
  return new Set(settings.get('quickCardActiveTags').map(normalizeTag));
}

class QuickCardSearchUI {
  private root: HTMLDivElement | null = null;
  private input!: HTMLInputElement;
  private resultsEl!: HTMLDivElement;
  private tagFilterEl!: HTMLDivElement;
  private unsubscribe: (() => void) | null = null;
  private view: EditorView | null = null;

  private results: QuickCardSearchResult[] = [];
  private selected = 0;

  open(opts: QuickCardSearchOptions): void {
    if (this.root) this.close();
    this.view = opts.view;

    const root = document.createElement('div');
    root.className = 'pmd-qcs';
    root.innerHTML = `
      <div class="pmd-qcs-results" role="listbox"></div>
      <div class="pmd-qcs-tagfilter" hidden></div>
      <input class="pmd-qcs-input" type="text" spellcheck="false"
             autocomplete="off" placeholder="Search quick cards…" aria-label="Search quick cards" />
      <div class="pmd-qcs-hints">
        <span>↑↓ navigate</span><span>↵ insert</span><span>⌥↵ at end</span><span>⇥ tags</span><span>esc</span>
      </div>`;
    this.root = root;
    this.resultsEl = root.querySelector('.pmd-qcs-results')!;
    this.tagFilterEl = root.querySelector('.pmd-qcs-tagfilter')!;
    this.input = root.querySelector('.pmd-qcs-input')!;

    // Center over the target pane, pinned near the bottom. Fall back to
    // window-center when there's no pane / it has no width (no-doc).
    const rect = opts.paneEl?.getBoundingClientRect();
    const centerX = rect && rect.width > 0 ? rect.left + rect.width / 2 : window.innerWidth / 2;
    root.style.left = `${Math.round(centerX)}px`;

    document.body.appendChild(root);
    // Instant: focus synchronously so the user can type immediately.
    this.input.focus();

    // One-shot blue pulse that fades (reduce-motion shows none — the
    // class's animation is suppressed by the global motion CSS).
    root.classList.add('pmd-qcs-pulse');
    root.addEventListener(
      'animationend',
      () => root.classList.remove('pmd-qcs-pulse'),
      { once: true },
    );

    this.input.addEventListener('input', () => this.runSearch());
    this.input.addEventListener('keydown', this.onInputKey);
    document.addEventListener('pointerdown', this.onDocPointerDown, true);

    // Re-run if the library changes underneath us (another window).
    this.unsubscribe = quickCardsStore.subscribe(() => this.runSearch());

    this.runSearch();
  }

  close(): void {
    if (!this.root) return;
    document.removeEventListener('pointerdown', this.onDocPointerDown, true);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.root.remove();
    this.root = null;
    this.view?.focus();
  }

  isOpen(): boolean {
    return !!this.root;
  }

  private onDocPointerDown = (e: PointerEvent): void => {
    if (this.root && !this.root.contains(e.target as Node)) this.close();
  };

  private onInputKey = (e: KeyboardEvent): void => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        this.close();
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.move(-1);
        break;
      case 'Enter':
        e.preventDefault();
        this.insertSelected(e.altKey);
        break;
      case 'Tab':
        e.preventDefault();
        this.openTagFilter();
        break;
    }
  };

  // ── Search + results ──────────────────────────────────────────────

  private runSearch(): void {
    this.results = searchQuickCards(
      quickCardsStore.list(),
      this.input.value,
      activeTagSet(),
    ).slice(0, 50);
    this.selected = 0;
    this.renderResults();
  }

  private move(delta: number): void {
    if (this.results.length === 0) return;
    this.selected = (this.selected + delta + this.results.length) % this.results.length;
    this.renderResults();
  }

  private renderResults(): void {
    this.resultsEl.innerHTML = '';
    if (this.results.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'pmd-qcs-empty';
      empty.textContent = quickCardsStore.list().length
        ? 'No matching quick cards.'
        : 'No quick cards yet.';
      this.resultsEl.appendChild(empty);
      return;
    }
    this.results.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'pmd-qcs-row';
      row.setAttribute('role', 'option');
      if (i === this.selected) {
        row.classList.add('pmd-qcs-row-active');
        row.setAttribute('aria-selected', 'true');
      }
      const top = document.createElement('div');
      top.className = 'pmd-qcs-row-top';
      const name = document.createElement('span');
      name.className = 'pmd-qcs-row-name';
      name.textContent = r.card.name;
      top.appendChild(name);
      if (r.card.tags.length) {
        const tags = document.createElement('span');
        tags.className = 'pmd-qcs-row-tags';
        tags.textContent = r.card.tags.join(', ');
        top.appendChild(tags);
      }
      row.appendChild(top);
      // Content-only matches show a small snippet of the matched region.
      if (!r.matchedName && r.snippet) {
        const snip = document.createElement('div');
        snip.className = 'pmd-qcs-row-snippet';
        snip.textContent = r.snippet;
        row.appendChild(snip);
      }
      row.addEventListener('mousemove', () => {
        if (this.selected !== i) {
          this.selected = i;
          this.renderResults();
        }
      });
      row.addEventListener('click', () => {
        this.selected = i;
        this.insertSelected(false);
      });
      this.resultsEl.appendChild(row);
    });
    // Keep the active row in view.
    this.resultsEl
      .querySelector('.pmd-qcs-row-active')
      ?.scrollIntoView({ block: 'nearest' });
  }

  // ── Insert ────────────────────────────────────────────────────────

  private insertSelected(atEnd: boolean): void {
    const result = this.results[this.selected];
    if (!result) return;
    const view = this.view;
    if (!view || !view.editable) {
      showToast('No editable document to insert into.');
      return;
    }
    let slice: Slice;
    try {
      slice = Slice.fromJSON(schema, result.card.contentJson as Parameters<typeof Slice.fromJSON>[1]);
    } catch {
      showToast('That quick card is corrupted and can’t be inserted.');
      return;
    }
    this.close(); // refocuses the view
    insertSpeechSlice(view, slice, atEnd, undefined, {
      enabled: !settings.get('quickCardSkipMidTextInsertConfirm'),
      message: 'Insert this quick card into the middle of text. Are you sure?',
    });
  }

  // ── Inline tag filter (Tab) ───────────────────────────────────────

  private openTagFilter(): void {
    renderTagPicker(this.tagFilterEl, () => this.runSearch(), () => {
      this.tagFilterEl.hidden = true;
      this.input.focus();
    });
    this.tagFilterEl.hidden = false;
    this.tagFilterEl.querySelector<HTMLInputElement>('.pmd-qctags-filter')?.focus();
  }
}

export const quickCardSearchUI = new QuickCardSearchUI();

// ── Shared tag-picker (inline + ribbon dropdown) ─────────────────────

/** Render a type-to-filter checkbox list of the tag universe into
 *  `host`, editing the global `quickCardActiveTags` setting. `onChange`
 *  fires after a toggle; `onDismiss` fires on Escape. */
function renderTagPicker(host: HTMLElement, onChange: () => void, onDismiss: () => void): void {
  host.innerHTML = '';
  const all = distinctTags(quickCardsStore.list());

  const filter = document.createElement('input');
  filter.type = 'text';
  filter.className = 'pmd-qctags-filter';
  filter.placeholder = 'Filter tags…';
  filter.spellcheck = false;
  filter.autocomplete = 'off';
  host.appendChild(filter);

  const list = document.createElement('div');
  list.className = 'pmd-qctags-list';
  host.appendChild(list);

  const renderList = (): void => {
    const q = normalizeTag(filter.value);
    const active = activeTagSet();
    list.innerHTML = '';
    const shown = all.filter((t) => (q ? normalizeTag(t).includes(q) : true));
    if (all.length === 0) {
      const none = document.createElement('div');
      none.className = 'pmd-qctags-empty';
      none.textContent = 'No tags yet.';
      list.appendChild(none);
      return;
    }
    for (const tag of shown) {
      const row = document.createElement('label');
      row.className = 'pmd-qctags-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = active.has(normalizeTag(tag));
      cb.addEventListener('change', () => {
        const next = new Set(settings.get('quickCardActiveTags').map(normalizeTag));
        if (cb.checked) next.add(normalizeTag(tag));
        else next.delete(normalizeTag(tag));
        settings.set('quickCardActiveTags', [...next]);
        onChange();
      });
      const span = document.createElement('span');
      span.textContent = tag;
      row.append(cb, span);
      list.appendChild(row);
    }
  };
  filter.addEventListener('input', renderList);
  filter.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      onDismiss();
    }
  });

  // "Clear" resets the filter to empty (all cards in scope).
  const footer = document.createElement('div');
  footer.className = 'pmd-qctags-footer';
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'pmd-qctags-clear';
  clear.textContent = 'Clear filter';
  clear.addEventListener('click', () => {
    settings.set('quickCardActiveTags', []);
    onChange();
    renderList();
  });
  footer.appendChild(clear);
  host.appendChild(footer);

  renderList();
}

/** Ribbon Tag Picker dropdown — a standalone popover anchored under
 *  the 🏷️ button, editing the same global active-tags filter. */
export function openQuickCardTagPicker(anchorEl: HTMLElement): void {
  const existing = document.querySelector('.pmd-qctags-popover');
  if (existing) {
    existing.remove();
    return; // toggle off if already open
  }
  const pop = document.createElement('div');
  pop.className = 'pmd-qctags-popover';
  document.body.appendChild(pop);
  const rect = anchorEl.getBoundingClientRect();
  pop.style.left = `${Math.round(rect.left)}px`;
  pop.style.top = `${Math.round(rect.bottom + 4)}px`;

  const close = (): void => {
    pop.remove();
    document.removeEventListener('pointerdown', onDown, true);
  };
  const onDown = (e: PointerEvent): void => {
    if (!pop.contains(e.target as Node) && e.target !== anchorEl) close();
  };
  document.addEventListener('pointerdown', onDown, true);
  renderTagPicker(pop, () => {}, close);
}
