/**
 * AiActivity — one handle for the "AI is working" affordances: the
 * floating "Thinking…" pill AND the purple tint over the range being
 * worked on. Every AI op that mutates a doc range (repair, formatting
 * repair, card cut, highlight-down, cite creation, image alt-text…)
 * should wrap its in-flight window in one of these so the two cues stay
 * in sync and the user can always see what's being worked on.
 *
 *   const act = new AiActivity(view, { from, to });
 *   act.start();
 *   try { …await the model… act.setRange(newRange); … }
 *   finally { act.stop(); }
 */

import type { EditorView } from 'prosemirror-view';
import { ThinkingTooltip, type TooltipRange } from './thinking-tooltip.js';
import { setAiWorking } from './ai-working-plugin.js';

export class AiActivity {
  private readonly tip = new ThinkingTooltip();
  private range: TooltipRange;

  constructor(
    private readonly view: EditorView,
    range: TooltipRange,
  ) {
    this.range = range;
  }

  start(): void {
    setAiWorking(this.view, this.range);
    this.tip.show(this.view, this.range);
  }

  /** Re-anchor both cues after positions are re-mapped (e.g. a repair
   *  pass that already edited the doc). */
  setRange(range: TooltipRange): void {
    this.range = range;
    setAiWorking(this.view, range);
    this.tip.setRange(range);
  }

  /** Name the current pipeline stage in the pill (card cutter). */
  setStage(stage: string | null): void {
    this.tip.setStage(stage);
  }

  stop(): void {
    this.tip.hide();
    setAiWorking(this.view, null);
  }
}
