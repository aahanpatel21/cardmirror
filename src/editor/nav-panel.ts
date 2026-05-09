/**
 * Navigation panel — outline view of headings.
 *
 * Renders a tree of pocket / hat / block / tag / analytic entries
 * indented by outline level. Click an entry to jump to and select
 * the heading in the editor.
 *
 * v0 affordances (this file): tree rendering, click-to-jump, hover
 * highlight. Out of scope for this iteration: collapse/expand, drag-
 * reorder, promote/demote, delete-subtree, grab — per
 * ARCHITECTURE.md §8 these are real features that need design input.
 */

import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { settings } from './settings.js';

interface HeadingEntry {
  /** Schema node type name. */
  type: string;
  /** Heading text content (can be empty). */
  text: string;
  /** Document position to jump to when clicked. */
  pos: number;
  /** Outline level (1 = Pocket, 2 = Hat, 3 = Block, 4 = Tag/Analytic). */
  level: number;
  /** Stable schema id (for keying / future drag/etc). */
  id: string | null;
  /** Cite-formatted text from the same card (only for tag entries). */
  cite: string | null;
}

const TYPE_TO_LEVEL: Record<string, number> = {
  pocket: 1,
  hat: 2,
  block: 3,
  tag: 4,
  analytic: 4,
};

const TYPE_LABEL: Record<string, string> = {
  pocket: 'Pocket',
  hat: 'Hat',
  block: 'Block',
  tag: 'Tag',
  analytic: 'Analytic',
};

const NAV_WIDTH_MIN = 150;
const NAV_WIDTH_MAX = 800;

function applyNavWidthCss(px: number): void {
  const clamped = Math.max(NAV_WIDTH_MIN, Math.min(NAV_WIDTH_MAX, px));
  document.documentElement.style.setProperty('--nav-width', `${clamped}px`);
}

export class NavigationPanel {
  private root: HTMLElement;
  private view: EditorView | null = null;
  private listEl: HTMLOListElement;
  private emptyEl: HTMLElement;
  private currentDoc: PMNode | null = null;
  /** Set of heading IDs whose subtrees are collapsed. Derived from
   *  maxLevel on attach; ad-hoc chevron clicks update during a session.
   *  Not persisted (heading IDs are doc-specific). */
  private collapsed: Set<string> = new Set();
  private levelButtons: HTMLButtonElement[] = [];
  private unsubscribeSettings: (() => void) | null = null;

  private get maxLevel(): number {
    return settings.get('navMaxLevel');
  }

  constructor(parent: HTMLElement) {
    this.root = document.createElement('aside');
    this.root.className = 'pmd-nav-panel';

    const header = document.createElement('header');

    const title = document.createElement('span');
    title.className = 'pmd-nav-title';
    title.textContent = 'Outline';
    header.appendChild(title);

    const levelGroup = document.createElement('div');
    levelGroup.className = 'pmd-nav-level-group';
    levelGroup.title = 'Show heading levels — click N to show levels 1 through N';
    for (let lvl = 1; lvl <= 4; lvl++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pmd-nav-level-btn';
      btn.dataset['level'] = String(lvl);
      btn.textContent = String(lvl);
      btn.title = `Show heading 1${lvl > 1 ? `–${lvl}` : ''}`;
      btn.addEventListener('click', () => this.setMaxLevel(lvl));
      this.levelButtons.push(btn);
      levelGroup.appendChild(btn);
    }
    header.appendChild(levelGroup);

    this.root.appendChild(header);
    this.updateLevelButtonsActive();

    this.listEl = document.createElement('ol');
    this.listEl.className = 'pmd-nav-list';
    this.root.appendChild(this.listEl);

    this.emptyEl = document.createElement('p');
    this.emptyEl.className = 'pmd-nav-empty';
    this.emptyEl.textContent = 'No headings.';
    this.root.appendChild(this.emptyEl);

    applyNavWidthCss(settings.get('navWidth'));
    this.installResizeHandle();

    // Re-render when relevant settings change.
    this.unsubscribeSettings = settings.subscribe((s) => {
      applyNavWidthCss(s.navWidth);
      this.updateLevelButtonsActive();
      if (this.currentDoc) this.render(this.currentDoc);
    });

    parent.appendChild(this.root);
  }

  /**
   * Add a draggable resize handle on the right edge. Width is stored in
   * the `--nav-width` CSS custom property so both the panel and #app's
   * left margin update in lockstep. Persisted in localStorage.
   */
  private installResizeHandle(): void {
    const handle = document.createElement('div');
    handle.className = 'pmd-nav-resize-handle';
    handle.setAttribute('aria-label', 'Resize outline panel');
    handle.setAttribute('role', 'separator');
    this.root.appendChild(handle);

    let dragging = false;
    let startX = 0;
    let startWidth = 0;

    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      const delta = e.clientX - startX;
      applyNavWidthCss(startWidth + delta);
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('pmd-nav-resize-active');
      this.root.classList.remove('pmd-nav-resizing');
      const w = getComputedStyle(this.root).width;
      const pixels = parseInt(w, 10);
      if (Number.isFinite(pixels)) {
        settings.set('navWidth', pixels);
      }
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      startX = e.clientX;
      startWidth = this.root.getBoundingClientRect().width;
      document.body.classList.add('pmd-nav-resize-active');
      this.root.classList.add('pmd-nav-resizing');
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
  }

  attach(view: EditorView): void {
    this.view = view;
    this.currentDoc = view.state.doc;
    // On every attach (fresh mount or new doc loaded), establish the
    // initial collapse state from maxLevel. This guarantees the default
    // view is the one promised by maxLevel — heading IDs are doc-specific
    // so any persisted collapsed state from another doc wouldn't apply
    // anyway.
    this.applyMaxLevelToCollapseState();
    this.render(this.currentDoc);
  }

  /** Re-render given a new doc. Cheap to call on every transaction. */
  update(doc: PMNode): void {
    this.currentDoc = doc;
    this.render(doc);
  }

  /** Sync the collapsed set to the current maxLevel: every parent at
   *  level ≥ maxLevel is collapsed, every shallower parent is expanded. */
  private applyMaxLevelToCollapseState(): void {
    if (!this.currentDoc) return;
    const entries = collectHeadings(this.currentDoc);
    this.collapsed = new Set();
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      if (entry.id == null) continue;
      const next = entries[i + 1];
      const hasChildren = next != null && next.level > entry.level;
      if (!hasChildren) continue;
      if (entry.level >= this.maxLevel) {
        this.collapsed.add(entry.id);
      }
    }
  }

  private render(doc: PMNode): void {
    const entries = collectHeadings(doc);

    // Clear and re-build. For doc sizes we care about (max ~600 headings
    // in the example corpus) this is fine; if profiling shows it's hot,
    // diff against the previous render.
    this.listEl.innerHTML = '';

    if (entries.length === 0) {
      this.listEl.style.display = 'none';
      this.emptyEl.style.display = '';
      return;
    }

    this.emptyEl.style.display = 'none';
    this.listEl.style.display = '';

    // Skip-tracking: when we encounter a collapsed heading, we hide
    // every following entry whose level is deeper than it, until we
    // hit one at the same or shallower level.
    let skipBelowLevel: number | null = null;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;

      if (skipBelowLevel != null) {
        if (entry.level > skipBelowLevel) continue;
        skipBelowLevel = null;
      }

      const next = entries[i + 1];
      const hasChildren = next != null && next.level > entry.level;
      const collapsed = entry.id != null && this.collapsed.has(entry.id);

      const li = document.createElement('li');
      li.className = `pmd-nav-item pmd-nav-level-${entry.level} pmd-nav-type-${entry.type}`;
      li.title = TYPE_LABEL[entry.type] ?? entry.type;
      if (entry.id) li.dataset['id'] = entry.id;
      li.dataset['pos'] = String(entry.pos);

      const chevron = document.createElement('span');
      chevron.className = 'pmd-nav-chevron';
      if (hasChildren) {
        chevron.textContent = collapsed ? '▶' : '▼';
        chevron.classList.add('pmd-nav-chevron-active');
        chevron.addEventListener('click', (e) => {
          e.stopPropagation();
          this.toggleCollapsed(entry);
        });
      } else {
        // Leaf — keep a placeholder for indent alignment.
        chevron.classList.add('pmd-nav-chevron-leaf');
      }
      li.appendChild(chevron);

      const label = document.createElement('span');
      label.className = 'pmd-nav-label';
      label.textContent = entry.text;
      li.appendChild(label);

      if (entry.cite && settings.get('showCitePreview')) {
        const citePreview = document.createElement('span');
        citePreview.className = 'pmd-nav-cite-preview';
        citePreview.textContent = entry.cite;
        citePreview.title = entry.cite;
        li.appendChild(citePreview);
      }

      li.addEventListener('click', () => this.jumpTo(entry));

      this.listEl.appendChild(li);

      if (hasChildren && collapsed) {
        skipBelowLevel = entry.level;
      }
    }
  }

  private toggleCollapsed(entry: HeadingEntry): void {
    if (entry.id == null) return;
    if (this.collapsed.has(entry.id)) {
      this.collapsed.delete(entry.id);
    } else {
      this.collapsed.add(entry.id);
    }
    if (this.currentDoc) this.render(this.currentDoc);
  }

  /**
   * Click handler for the level buttons. Behaves like Word's "Show
   * Heading N" — collapses every heading at level ≥ N (and expands
   * every heading at level < N). Acts as a bulk reset; the user can
   * still selectively expand/collapse individual entries via the
   * chevrons afterwards.
   */
  private setMaxLevel(level: number): void {
    if (level < 1 || level > 4) return;
    settings.set('navMaxLevel', level);
    this.applyMaxLevelToCollapseState();
    // updateLevelButtonsActive + render fire from the settings subscriber.
  }

  private updateLevelButtonsActive(): void {
    for (const btn of this.levelButtons) {
      const lvl = parseInt(btn.dataset['level'] ?? '0', 10);
      btn.classList.toggle('pmd-nav-level-btn-active', lvl === this.maxLevel);
    }
  }

  /**
   * Scroll the corresponding heading element into view *without* moving
   * the cursor or focusing the editor. Headings carry a `data-id` attr
   * (per their toDOM); we look that up in the rendered DOM and scroll
   * to it.
   */
  private jumpTo(entry: HeadingEntry): void {
    if (!this.view) return;

    if (entry.id) {
      const target = this.view.dom.querySelector<HTMLElement>(`[data-id="${cssEscape(entry.id)}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'auto', block: 'start' });
        return;
      }
    }

    // Fallback: resolve the doc position and scroll the editor's
    // closest containing element into view (no selection change).
    const domAtPos = this.view.domAtPos(entry.pos);
    let el: Node | null = domAtPos.node;
    while (el && el.nodeType !== Node.ELEMENT_NODE) el = el.parentNode;
    if (el && (el as Element).scrollIntoView) {
      (el as Element).scrollIntoView({ behavior: 'auto', block: 'start' });
    }
  }
}

/** Minimal CSS.escape polyfill for jsdom-style environments. */
function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(s);
  }
  return s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

function collectHeadings(doc: PMNode): HeadingEntry[] {
  const out: HeadingEntry[] = [];
  doc.descendants((node, pos) => {
    const type = node.type.name;
    if (type in TYPE_TO_LEVEL) {
      const level = TYPE_TO_LEVEL[type]!;
      let cite: string | null = null;
      if (type === 'tag') {
        // The tag's parent is a card. Walk the card's descendants for
        // text that carries the cite_mark mark (Style13ptBold) — that's
        // the bolded author/date in the citation.
        const $pos = doc.resolve(pos);
        const card = $pos.parent;
        if (card.type.name === 'card') {
          cite = collectCiteText(card);
        }
      }
      out.push({
        type,
        text: node.textContent,
        pos,
        level,
        id: typeof node.attrs['id'] === 'string' ? node.attrs['id'] : null,
        cite: cite && cite.trim() !== '' ? cite.trim() : null,
      });
    }
    return true;
  });
  return out;
}

/** Concatenate the text of all runs in a node that carry the cite_mark. */
function collectCiteText(node: PMNode): string {
  const parts: string[] = [];
  node.descendants((descendant) => {
    if (!descendant.isText) return;
    if (descendant.marks.some((m) => m.type.name === 'cite_mark')) {
      parts.push(descendant.text ?? '');
    }
  });
  return parts.join('');
}
