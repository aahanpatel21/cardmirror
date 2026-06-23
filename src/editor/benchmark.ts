/**
 * In-app performance benchmark — a game-style suite that runs a battery of real
 * in-editor operations on the currently open document and reports frame rate,
 * frame-time percentiles, and operation latencies. Surfaced in Settings →
 * Benchmark (see `benchmark-ui.ts`).
 *
 * Self-instrumented via `requestAnimationFrame` + `PerformanceObserver`, so it
 * measures CardMirror's OWN rendering. It is deliberately NOT the cross-app
 * comparison — that's the black-box screen-capture rig in `perf/`, which is the
 * only fair way to put Word and CardMirror on the same axis.
 *
 * The editor must be VISIBLE while this runs (occluded content gets its paints
 * culled by the compositor, which would falsify the frame times), so the UI
 * closes any modal and shows only a small corner chip during the run.
 */

import { TextSelection } from 'prosemirror-state';
import type { Node as ProseNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { newHeadingId } from '../schema/index.js';
import { preciseScrollIntoView } from './precise-scroll.js';
import { applyCite } from './ribbon-commands.js';
import { applyPlainPasteFromText } from './paste-plugin.js';
import { dragController } from './drag-controller.js';
import { collectHeadings, computeHeadingRange, headingInsertPos } from './headings.js';

const HEADING_NODES = new Set(['pocket', 'hat', 'block', 'tag']);

/** A slight pause between discrete benchmark steps so the user can see what's
 *  happening (the suite doubles as a visual demo). Not counted in any timing. */
const STEP_PAUSE_MS = 650;

/** True while the benchmark is mutating the document. The editor's
 *  dispatchTransaction checks this to SKIP autosave/dirty/nav-rebuild side
 *  effects, so the temporary benchmark edits never touch disk or pollute the
 *  nav — and a single `view.updateState(snapshot)` fully reverts them. */
let benchmarkActive = false;
export function isBenchmarkActive(): boolean {
  return benchmarkActive;
}
export function setBenchmarkActive(active: boolean): void {
  benchmarkActive = active;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface FrameStats {
  frames: number;
  fps: number; // mean
  p50FrameMs: number;
  p95FrameMs: number;
  p99FrameMs: number;
  lowFps1pct: number; // 1%-low fps, derived from the p99 frame time
  jankFrames: number; // frames longer than 1.5x the median
}

export interface EditStep {
  label: string;
  ms: number | null;
}

export interface BenchmarkResults {
  docInfo: { headings: number; cards: number; chars: number };
  scroll: (FrameStats & { durationMs: number; frameMs: number[] }) | null;
  nav: { medianMs: number; p90Ms: number; samples: number[] } | null;
  drag: { ms: number } | null;
  edit: { steps: EditStep[]; totalMs: number } | null;
  relayout: { ms: number } | null;
  longTasks: { count: number; totalMs: number; maxMs: number };
  score: number;
}

export type ProgressFn = (label: string) => void;

const raf = (): Promise<number> => new Promise((r) => requestAnimationFrame(r));
async function nextPaint(): Promise<void> {
  await raf();
  await raf();
}
const round1 = (x: number): number => Math.round(x * 10) / 10;

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i]!;
}

function frameStats(intervals: number[]): FrameStats {
  const valid = intervals.filter((x) => x > 0 && x < 1000);
  const sorted = [...valid].sort((a, b) => a - b);
  const mean = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
  const median = pct(sorted, 50);
  const p99 = pct(sorted, 99);
  return {
    frames: valid.length,
    fps: mean ? Math.round(1000 / mean) : 0,
    p50FrameMs: round1(median),
    p95FrameMs: round1(pct(sorted, 95)),
    p99FrameMs: round1(p99),
    lowFps1pct: p99 ? Math.round(1000 / p99) : 0,
    jankFrames: median ? valid.filter((x) => x > 1.5 * median).length : 0,
  };
}

/** The element that actually scrolls behind the editor (walk up to the first
 *  overflow:auto/scroll ancestor; mirrors `precise-scroll`'s own gate logic). */
function scrollGate(view: EditorView): HTMLElement {
  let cur: HTMLElement | null = view.dom as HTMLElement;
  while (cur && cur !== document.body) {
    const oy = getComputedStyle(cur).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && cur.scrollHeight > cur.clientHeight) return cur;
    cur = cur.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

function headingPositions(view: EditorView): number[] {
  const out: number[] = [];
  view.state.doc.descendants((node, pos) => {
    if (HEADING_NODES.has(node.type.name)) out.push(pos);
    return true;
  });
  return out;
}

/** Continuously scroll top→bottom over `durationMs`, sampling each frame's
 *  interval. The scroll position is driven by elapsed time (not frame count),
 *  so a slow renderer scrolls the same distance but yields longer frames. */
async function benchScroll(
  view: EditorView,
  durationMs: number,
): Promise<FrameStats & { durationMs: number; frameMs: number[] }> {
  const gate = scrollGate(view);
  const startTop = gate.scrollTop;
  gate.scrollTop = 0;
  await nextPaint();
  const max = Math.max(1, gate.scrollHeight - gate.clientHeight);
  const intervals: number[] = [];
  const t0 = performance.now();
  let last = t0;
  for (;;) {
    const now = await raf();
    intervals.push(now - last);
    last = now;
    const frac = (now - t0) / durationMs;
    gate.scrollTop = Math.min(max, frac * max);
    if (now - t0 >= durationMs || gate.scrollTop >= max) break;
  }
  const durationActual = performance.now() - t0;
  gate.scrollTop = startTop;
  await nextPaint();
  // Drop the first interval (warm-up / measurement start jitter).
  const frameMs = intervals.slice(1).map((x) => round1(x));
  return { ...frameStats(intervals.slice(1)), durationMs: Math.round(durationActual), frameMs };
}

async function settleScroll(gate: HTMLElement): Promise<void> {
  let stable = 0;
  let lastTop = gate.scrollTop;
  for (let i = 0; i < 300; i++) {
    await raf();
    if (Math.abs(gate.scrollTop - lastTop) < 0.5) {
      if (++stable >= 5) return;
    } else {
      stable = 0;
    }
    lastTop = gate.scrollTop;
  }
}

/** Jump to several headings spread across the doc (the same `preciseScrollIntoView`
 *  the nav pane uses), timing click→settled for each. */
async function benchNav(
  view: EditorView,
  onProgress?: ProgressFn,
): Promise<{ medianMs: number; p90Ms: number; samples: number[] } | null> {
  const positions = headingPositions(view);
  if (positions.length < 4) return null;
  const gate = scrollGate(view);
  const fracs = [0.12, 0.3, 0.5, 0.68, 0.85, 0.95];
  const samples: number[] = [];
  let i = 0;
  for (const f of fracs) {
    i++;
    const pos = positions[Math.floor(f * (positions.length - 1))]!;
    gate.scrollTop = 0;
    await nextPaint();
    await sleep(STEP_PAUSE_MS / 2); // let the eye reset to the top before the jump
    const dom = view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) continue;
    onProgress?.(`Navigating ${i}/${fracs.length}…`);
    const t0 = performance.now();
    preciseScrollIntoView(view, dom, 'center');
    await settleScroll(gate);
    samples.push(performance.now() - t0);
    await sleep(STEP_PAUSE_MS); // hold on the target so the jump is legible
  }
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    medianMs: round1(pct(sorted, 50)),
    p90Ms: round1(pct(sorted, 90)),
    samples: samples.map(round1),
  };
}

/** Force a full relayout + repaint of the whole editor subtree (a proxy for the
 *  layout half of "open this document"). Non-destructive — no state is rebuilt. */
async function benchRelayout(view: EditorView): Promise<{ ms: number }> {
  const el = view.dom as HTMLElement;
  const prev = el.style.display;
  await nextPaint();
  const t0 = performance.now();
  el.style.display = 'none';
  void el.offsetHeight; // flush the teardown
  el.style.display = prev;
  void el.offsetHeight; // force the full relayout synchronously
  await nextPaint(); // include the paint
  const ms = performance.now() - t0;
  return { ms: round1(ms) };
}

// ── Mutating tests (the doc is reverted afterward by the caller) ──────

function nodePos(
  doc: ProseNode,
  pred: (n: ProseNode) => boolean,
): { node: ProseNode; pos: number } | null {
  let found: { node: ProseNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (pred(node)) {
      found = { node, pos };
      return false;
    }
    return true;
  });
  return found;
}

const findById = (doc: ProseNode, id: string): { node: ProseNode; pos: number } | null =>
  nodePos(doc, (n) => n.attrs?.['id'] === id);

function cardOfTag(doc: ProseNode, tagId: string): { card: ProseNode; cardPos: number } | null {
  const tg = findById(doc, tagId);
  if (!tg) return null;
  const $pos = doc.resolve(tg.pos);
  for (let d = $pos.depth; d >= 0; d--) {
    if ($pos.node(d).type.name === 'card') return { card: $pos.node(d), cardPos: $pos.before(d) };
  }
  return null;
}

/** Run one labelled, paused, timed step. Failures are recorded as `null` and
 *  never abort the run (docs vary; resilience matters more than completeness). */
async function measureStep(
  label: string,
  fn: () => void,
  onProgress: ProgressFn | undefined,
  steps: EditStep[],
): Promise<void> {
  onProgress?.(label);
  await nextPaint();
  const t0 = performance.now();
  let ok = true;
  try {
    fn();
  } catch (err) {
    ok = false;
    console.warn('[benchmark] edit step failed:', label, err);
  }
  await nextPaint();
  steps.push({ label, ms: ok ? round1(performance.now() - t0) : null });
  await sleep(STEP_PAUSE_MS);
}

/** A narrated editing sequence: new heading → type → new tag → type → cite →
 *  cite-mark → paste body → cut it. Each discrete step is paused so the user
 *  can watch. All on the live doc; the caller reverts via the snapshot. */
async function benchEdit(
  view: EditorView,
  onProgress?: ProgressFn,
): Promise<{ steps: EditStep[]; totalMs: number } | null> {
  const sch = view.state.schema;
  const need = ['pocket', 'card', 'tag', 'cite_paragraph'];
  if (need.some((n) => !sch.nodes[n]) || !sch.marks['cite_mark']) return null;
  const steps: EditStep[] = [];
  const pocketId = newHeadingId();
  const tagId = newHeadingId();
  const HEAD = 'Benchmark';
  const TAGTXT = 'Benchmark Tag';
  const CITETXT = 'Smith, John. 2024. Journal of Testing.';

  await measureStep(
    'New heading at top',
    () => {
      const pocket = sch.nodes['pocket']!.create({ id: pocketId }, sch.text(HEAD));
      const tr = view.state.tr.insert(0, pocket);
      tr.setSelection(TextSelection.create(tr.doc, 1 + HEAD.length));
      view.dispatch(tr.scrollIntoView());
    },
    onProgress,
    steps,
  );

  await measureStep(
    'Type in heading',
    () => view.dispatch(view.state.tr.insertText(' — Pocket')),
    onProgress,
    steps,
  );

  await measureStep(
    'New tag',
    () => {
      const pk = findById(view.state.doc, pocketId);
      const at = pk ? pk.pos + pk.node.nodeSize : 0;
      const tag = sch.nodes['tag']!.create({ id: tagId }, sch.text(TAGTXT));
      const card = sch.nodes['card']!.createChecked(null, [tag]);
      const tr = view.state.tr.insert(at, card);
      tr.setSelection(TextSelection.create(tr.doc, at + 2 + TAGTXT.length));
      view.dispatch(tr.scrollIntoView());
    },
    onProgress,
    steps,
  );

  await measureStep(
    'Type in tag',
    () => view.dispatch(view.state.tr.insertText(' — Smith 2024')),
    onProgress,
    steps,
  );

  await measureStep(
    'Add cite',
    () => {
      const tg = findById(view.state.doc, tagId);
      if (!tg) throw new Error('tag missing');
      const at = tg.pos + tg.node.nodeSize; // just after the tag, inside the card
      const cite = sch.nodes['cite_paragraph']!.create(null, sch.text(CITETXT));
      const tr = view.state.tr.insert(at, cite);
      tr.setSelection(TextSelection.create(tr.doc, at + 1));
      view.dispatch(tr.scrollIntoView());
    },
    onProgress,
    steps,
  );

  await measureStep(
    'Cite mark on author/date',
    () => {
      const tg = findById(view.state.doc, tagId);
      if (!tg) throw new Error('tag missing');
      const at = tg.pos + tg.node.nodeSize;
      const cite = view.state.doc.nodeAt(at);
      if (!cite || cite.type.name !== 'cite_paragraph') throw new Error('cite missing');
      const from = at + 1;
      const to = at + 1 + cite.content.size;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
      applyCite()(view.state, view.dispatch.bind(view), view);
    },
    onProgress,
    steps,
  );

  await measureStep(
    'Paste body below cite',
    () => {
      const tg = findById(view.state.doc, tagId);
      if (!tg) throw new Error('tag missing');
      const at = tg.pos + tg.node.nodeSize;
      const cite = view.state.doc.nodeAt(at);
      if (!cite) throw new Error('cite missing');
      const end = at + cite.nodeSize - 1; // caret at end of the cite paragraph
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)));
      applyPlainPasteFromText(view, 'Pasted body text for the benchmark, just below the cite.', {
        condenseOnPaste: () => false,
        paragraphIntegrity: () => false,
        usePilcrows: () => false,
        headingMode: () => 'respect',
      });
    },
    onProgress,
    steps,
  );

  await measureStep(
    'Cut the pasted body',
    () => {
      const found = cardOfTag(view.state.doc, tagId);
      if (!found) throw new Error('card missing');
      const last = found.card.lastChild;
      if (!last || last.type.name === 'tag') throw new Error('nothing to cut');
      const cardEnd = found.cardPos + found.card.nodeSize - 1;
      const lastStart = cardEnd - last.nodeSize;
      view.dispatch(view.state.tr.delete(lastStart, cardEnd));
    },
    onProgress,
    steps,
  );

  const totalMs = round1(steps.reduce((a, s) => a + (s.ms ?? 0), 0));
  return { steps, totalMs };
}

/** Drag-move the first top-level section below the next one (the real drag
 *  controller commit path), timed begin→commit→settled. */
async function benchDrag(view: EditorView, onProgress?: ProgressFn): Promise<{ ms: number } | null> {
  let hs;
  try {
    hs = collectHeadings(view.state.doc, { skipCite: true });
  } catch {
    return null;
  }
  if (!hs || hs.length < 3) return null;
  const src = hs[0]!;
  const range = computeHeadingRange(view.state.doc, src);
  const dropPos = headingInsertPos(view.state.doc, hs[2]!);
  if (!range || dropPos == null) return null;

  onProgress?.('Drag-move…');
  await nextPaint();
  const item = {
    from: range.from,
    to: range.to,
    id: src.id,
    type: src.type,
    level: src.level,
    label: src.text,
  };
  const t0 = performance.now();
  try {
    dragController.begin({ view, items: [item] });
    await sleep(STEP_PAUSE_MS); // let the drop indicators show
    dragController.setHoverTarget({ view, insertPos: dropPos });
    dragController.commit();
  } catch (err) {
    try {
      dragController.cancel();
    } catch {
      /* ignore */
    }
    console.warn('[benchmark] drag failed', err);
    return null;
  }
  await settleScroll(scrollGate(view));
  await nextPaint();
  const ms = round1(performance.now() - t0);
  await sleep(STEP_PAUSE_MS);
  return { ms };
}

function computeScore(r: BenchmarkResults): number {
  let s = 0;
  if (r.scroll) s += r.scroll.fps * 3 + r.scroll.lowFps1pct * 2 - r.scroll.jankFrames * 2;
  if (r.nav) s += Math.max(0, 2000 - r.nav.medianMs) / 4;
  if (r.drag) s += Math.max(0, 1000 - r.drag.ms) / 4;
  if (r.edit) s += Math.max(0, 2000 - r.edit.totalMs) / 8;
  if (r.relayout) s += Math.max(0, 1000 - r.relayout.ms) / 4;
  s -= r.longTasks.totalMs / 10;
  return Math.max(0, Math.round(s));
}

/** Run the full battery on the active view's current document. Reports progress
 *  by label. The editor must be visible (caller closes any modal first). */
export async function runBenchmark(view: EditorView, onProgress?: ProgressFn): Promise<BenchmarkResults> {
  let headings = 0;
  let cards = 0;
  let chars = 0;
  view.state.doc.descendants((node) => {
    if (HEADING_NODES.has(node.type.name)) headings++;
    if (node.type.name === 'card') cards++;
    if (node.isText) chars += node.text?.length ?? 0;
    return true;
  });

  const longTaskDurations: number[] = [];
  let obs: PerformanceObserver | null = null;
  try {
    obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) longTaskDurations.push(e.duration);
    });
    obs.observe({ type: 'longtask', buffered: false });
  } catch {
    /* longtask timing unsupported (e.g. Safari) — skip */
  }

  onProgress?.('Warming up…');
  await nextPaint();
  onProgress?.('Scrolling…');
  const scroll = await benchScroll(view, 4000);
  onProgress?.('Navigating…');
  const nav = await benchNav(view, onProgress);
  onProgress?.('Drag-move…');
  const drag = await benchDrag(view, onProgress);
  onProgress?.('Editing…');
  const edit = await benchEdit(view, onProgress);
  onProgress?.('Relayout…');
  const relayout = await benchRelayout(view);
  obs?.disconnect();

  const total = Math.round(longTaskDurations.reduce((a, b) => a + b, 0));
  const results: BenchmarkResults = {
    docInfo: { headings, cards, chars },
    scroll,
    nav,
    drag,
    edit,
    relayout,
    longTasks: {
      count: longTaskDurations.length,
      totalMs: total,
      maxMs: Math.round(longTaskDurations.length ? Math.max(...longTaskDurations) : 0),
    },
    score: 0,
  };
  results.score = computeScore(results);
  return results;
}
