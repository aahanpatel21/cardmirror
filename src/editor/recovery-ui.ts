/**
 * Recovery modal.
 *
 * Shown at startup when the host returns one or more unsaved
 * journal entries — meaning the previous session ended without a
 * successful save / explicit close for those docs. Each entry gets
 * its own row: filename, last-edited timestamp, and per-row
 * "Recover" / "Discard" buttons.
 *
 * Promise-based — resolves with the user's per-entry decisions
 * once they finish triaging. "Keep all for later" closes the modal
 * without taking action on any entry (the journals stay on disk
 * for the next launch).
 */

import type { JournalEntry } from './host/index.js';

/** What the user chose for each journal entry. The modal returns
 *  one of these per entry; the caller acts on it. */
export type RecoveryDecision = 'recover' | 'discard' | 'keep';

export interface RecoveryResult {
  /** Decisions keyed by `JournalEntry.uid`, in the same order as
   *  the input list (preserves user-visible row order for the
   *  caller's iteration). */
  decisions: Map<string, RecoveryDecision>;
}

export function openRecoveryModal(entries: JournalEntry[]): Promise<RecoveryResult> {
  return new Promise((resolve) => {
    new RecoveryModal(entries, resolve);
  });
}

class RecoveryModal {
  private readonly overlay: HTMLDivElement;
  private readonly dialog: HTMLDivElement;
  private readonly decisions = new Map<string, RecoveryDecision>();
  private readonly rowElems = new Map<string, HTMLElement>();
  private settled = false;

  constructor(
    private readonly entries: JournalEntry[],
    private readonly settle: (r: RecoveryResult) => void,
  ) {
    // Default every entry to "keep" — that's the safest action if
    // the user closes the modal without explicit choices.
    for (const e of entries) this.decisions.set(e.uid, 'keep');

    this.overlay = document.createElement('div');
    this.overlay.className = 'pmd-recovery-overlay';

    this.dialog = document.createElement('div');
    this.dialog.className = 'pmd-recovery-dialog';
    this.overlay.appendChild(this.dialog);

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.finishKeepAll();
    });
    document.addEventListener('keydown', this.handleKey);

    this.render();
    document.body.appendChild(this.overlay);
  }

  private readonly handleKey = (e: KeyboardEvent): void => {
    if (this.settled) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.finishKeepAll();
    }
  };

  private render(): void {
    const header = document.createElement('header');
    header.className = 'pmd-recovery-header';
    const title = document.createElement('h2');
    title.textContent =
      this.entries.length === 1
        ? 'Recover unsaved work'
        : `Recover ${this.entries.length} unsaved drafts`;
    header.appendChild(title);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'pmd-recovery-close';
    closeBtn.textContent = '×';
    closeBtn.title = 'Keep for later';
    closeBtn.addEventListener('click', () => this.finishKeepAll());
    header.appendChild(closeBtn);
    this.dialog.appendChild(header);

    const intro = document.createElement('p');
    intro.className = 'pmd-recovery-intro';
    intro.textContent =
      'CardMirror exited before these docs were saved. Choose which ones to bring back.';
    this.dialog.appendChild(intro);

    const list = document.createElement('div');
    list.className = 'pmd-recovery-list';
    for (const entry of this.entries) {
      list.appendChild(this.renderRow(entry));
    }
    this.dialog.appendChild(list);

    const footer = document.createElement('footer');
    footer.className = 'pmd-recovery-footer';
    const keepBtn = document.createElement('button');
    keepBtn.type = 'button';
    keepBtn.className = 'pmd-recovery-btn pmd-recovery-btn-secondary';
    keepBtn.textContent = 'Keep all for later';
    keepBtn.addEventListener('click', () => this.finishKeepAll());
    footer.appendChild(keepBtn);
    const commitBtn = document.createElement('button');
    commitBtn.type = 'button';
    commitBtn.className = 'pmd-recovery-btn pmd-recovery-btn-primary';
    commitBtn.textContent = 'Apply choices';
    commitBtn.addEventListener('click', () => this.finishCommit());
    footer.appendChild(commitBtn);
    this.dialog.appendChild(footer);
  }

  private renderRow(entry: JournalEntry): HTMLElement {
    const row = document.createElement('div');
    row.className = 'pmd-recovery-row';
    this.rowElems.set(entry.uid, row);

    const info = document.createElement('div');
    info.className = 'pmd-recovery-row-info';
    const name = document.createElement('div');
    name.className = 'pmd-recovery-row-name';
    name.textContent = entry.filename || 'Untitled';
    info.appendChild(name);
    const sub = document.createElement('div');
    sub.className = 'pmd-recovery-row-sub';
    sub.textContent = `Edited ${formatRelativeTime(entry.savedAt)}${
      entry.format ? ` · ${entry.format}` : ''
    }`;
    info.appendChild(sub);
    row.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'pmd-recovery-row-actions';
    const recoverBtn = makeChoiceBtn('Recover', 'recover');
    const discardBtn = makeChoiceBtn('Discard', 'discard');
    actions.appendChild(recoverBtn);
    actions.appendChild(discardBtn);
    row.appendChild(actions);

    const self = this;
    function makeChoiceBtn(label: string, decision: RecoveryDecision): HTMLButtonElement {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pmd-recovery-row-btn';
      b.textContent = label;
      b.addEventListener('click', () => {
        self.decisions.set(entry.uid, decision);
        self.refreshRowChoiceState(entry.uid);
      });
      return b;
    }
    return row;
  }

  /** Update the visual state of a row's two buttons to reflect the
   *  current decision. */
  private refreshRowChoiceState(uid: string): void {
    const row = this.rowElems.get(uid);
    if (!row) return;
    const decision = this.decisions.get(uid);
    for (const btn of row.querySelectorAll<HTMLButtonElement>('.pmd-recovery-row-btn')) {
      const choice = btn.textContent === 'Recover' ? 'recover' : 'discard';
      btn.classList.toggle('pmd-recovery-row-btn-selected', choice === decision);
    }
  }

  private finishCommit(): void {
    this.finish({ decisions: new Map(this.decisions) });
  }

  private finishKeepAll(): void {
    // Reset every entry to "keep" — preserves the safe default.
    for (const e of this.entries) this.decisions.set(e.uid, 'keep');
    this.finish({ decisions: new Map(this.decisions) });
  }

  private finish(result: RecoveryResult): void {
    if (this.settled) return;
    this.settled = true;
    document.removeEventListener('keydown', this.handleKey);
    this.overlay.remove();
    this.settle(result);
  }
}

/** Format an ISO 8601 timestamp as a relative human-readable
 *  string. Used in the recovery modal so users can tell at a glance
 *  how recent each draft is. */
function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const ms = Date.now() - date.getTime();
  if (Number.isNaN(ms)) return iso;
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec} second${sec === 1 ? '' : 's'} ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`;
  return date.toLocaleString();
}
