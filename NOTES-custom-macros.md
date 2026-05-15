# Advanced Verbatim custom macros — effect-level inventory

Source: the custom-macro `.txt` exports that ship with **Advanced
Verbatim**, the project owner's forked Verbatim build. Per the project owner, the implementations are
exploratory and **not load-bearing** — what matters for our reimplementation
is achieving comparable *effects*, not preserving the macros line-for-line.

This file documents *what each macro is trying to accomplish*, the
encoding conventions they introduce, and the design implications for our
ProseMirror editor's feature set. Editor architecture decisions that
follow from these effects live in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## 1. Encoding conventions established by these macros

These are conventions our editor must understand even before we replicate
the macros themselves, because documents in this ecosystem already encode
them:

### Dark gray (`#555555` / `RGB(85, 85, 85)`) = "for reference, do not read"

Used as a font color sentinel: any text whose font color is exactly
`#555555` is meta/notes/reference material that should be visually muted
during editing and *deleted* during read-mode generation
(`Updated Invisibility Mode.txt:19`, `Create Read Doc (Fast).txt:57`).

### `wdGray25` highlight on reference text

Within a `#555555` run, anything that *was* highlighted gets recolored to
light gray (`wdGray25`) so the original highlight intent is preserved
visually-but-muted (`For Reference.txt:25-28`).

### "Read-aloud material" — the actual predicate

The semantic distinction the read-mode pipeline is approximating:
**material intended to be read aloud** = paragraphs/runs in `Tag`, `Cite`
(when the style is applied correctly), or `Analytic` style, **plus** any
character that is highlighted. Everything else (Normal, Underline,
Undertag, Emphasis bodies that aren't highlighted) is context the debater
skips when reading.

The macros approximate this in two different ways:

- `InvisibilityOn` keeps it structurally — it never targets Tag / Cite /
  Pocket / Hat / Block / Analytic styles for deletion, so they survive
  by omission, while non-highlighted runs in Normal / Underline /
  Undertag / Emphasis get stripped.
- `WordCountSelection` uses a leaky proxy ("highlighted OR bold") that
  is *known* to be imprecise: some users configure Underline/Emphasis
  styles to render as bold, so non-highlighted bold runs get falsely
  counted. We should reimplement using the proper style-aware predicate.

### Shading-as-immutable-highlight (`HighlightToBackgroundColor`)

The pairing of `ForReference` with `HighlightToBackgroundColor` is
deliberate. Word's character `Shading.BackgroundPatternColor` *visually*
looks like a highlight but is a different property, so mass-highlight
operations (like Verbatim's `UniHighlight` / `UniHighlightWithException`)
don't touch it. By converting a "for reference" span's highlights to
shading, the user makes them **immune to subsequent global highlight
edits** — effectively a form of locked / protected highlighting.

This is a workaround for stock Verbatim's mass-highlight ops being
indiscriminate. In our editor we may not need the trick at all if our
mass-highlight ops respect "do not touch" semantics natively; if we do
keep it, it'd be cleaner as a `protected` flag on the highlight mark
than as a separate shading channel.

### Bold + highlighted paragraph marks as boundary markers

The InvisibilityOn pipeline pre-processes by replacing every `^p` with a
bold-highlighted-Underline-styled `^p` (`Updated Invisibility Mode.txt:32-39`).
This prevents the subsequent "delete non-highlighted" passes from
collapsing paragraph structure. Side-effect: any read-mode output will
have these "armored" paragraph marks; we shouldn't be surprised to see
them in `READ_*` documents.

---

## 2. Macro catalog (effect-level)

### a) `ForReference` (+ chained `HighlightToBackgroundColor`) — mark span as reference material
`For Reference.txt`, typically followed by `Highlight to Background Color.txt`

Take the current selection and treat it as "context, do not read":
- Set font color to `#555555`.
- Reduce font size three steps (Word's `Font.Shrink` cycle).
- Any highlighted character within the selection: recolor highlight to
  `wdGray25` (light gray).
- **Standard follow-up**: run `HighlightToBackgroundColor` on the same
  selection, converting any (now-light-gray) highlights to character
  shading so they survive subsequent mass-highlight edits.

**Effect to replicate**: a "mark as reference" command that visually mutes
a span and tags it for deletion in read-mode generation. In our schema,
this could be a single `reference` mark that bundles the muted color,
shrunk size, and "preserve original highlight as protected/visual-only"
treatment — much cleaner than mirroring three independent direct-format
changes plus a shading workaround.

### b) `HighlightToBackgroundColor` — convert highlight → shading
`Highlight to Background Color.txt`

For each highlighted character in the selection, copy the highlight color
to `Shading.BackgroundPatternColor` (paragraph shading) and clear the
highlight. The function maps Word's 16 named highlight enums to RGB.

**Effect to replicate**: a "convert highlight to true background color"
operation. Use case is presumably exporting to formats where Word
highlights aren't honored, or producing visuals that look like highlights
but render in non-Word contexts. In ProseMirror, our `highlight` mark
already stores a color — this conversion may be a no-op for us depending
on how we model highlights, or a render-mode toggle.

### c) `WordCountSelection` — reading-time estimate
`Word Count Selection.txt`

Count words in the selection that the team considers "reading material",
then for a configured list of readers (name + WPM), display a popup with
estimated reading time per reader. The macro hardcodes seven `(Name, 111)`
placeholder readers — clearly meant to be edited per-team.

**Predicate correction**: the macro currently uses "highlighted OR bold",
but bold is a leaky proxy — Underline / Emphasis styles can be configured
bold without being highlighted, leading to false counts. The intended
predicate is **"in Tag / Cite / Analytic style, OR highlighted"**.

**Effect to replicate**: a per-team reader-time analysis tool with a
configurable list of `{name, wpm}` pairs (no placeholders shipped) and
the corrected style-aware predicate above.

### d) `InvisibilityOn` (custom, destructive) — collapse to read-only material
`Updated Invisibility Mode.txt:3-176`

This *replaces* stock Verbatim's `InvisibilityOn`. The stock version
hides non-highlighted body text via `Font.Hidden = True`; this custom
version **permanently deletes** it. The pipeline:

1. Confirmation prompt ("this will permanently delete...").
2. Delete all `#555555` (reference) text.
3. "Armor" all paragraph marks (highlight + bold + Underline style).
4. Delete non-highlighted runs in Normal, Underline, Undertag, Emphasis
   styles — replace each with a single space.
5. Tidy: collapse `^p ^p` → empty, `( ){2,}` → single space, `^p ` →
   `^p`, runs of paragraph marks → single `^p`.
6. Optional pass (asks user): condense card text by joining adjacent
   paragraphs that both contain any highlighted character.
7. Suppress spell/grammar check decorations.

`InvisibilityOff` in the custom build (`:178-189`) just unhides everything
and re-toggles spell/grammar — it does **not** undo the destructive
deletions. So this version is a one-way zap; the safe variants are §e/§f.

**Why destructive (per project owner)**: not by design — purely a
performance workaround. On large documents the hide-then-show approach
in stock Verbatim was prohibitively slow, so deleting non-readable
content was faster. In our editor we can almost certainly avoid this
trade-off: hide/show is cheap with a virtualized renderer or a CSS-class
toggle on a derived ProseMirror state. Reimplement as **reversible**.

**Known bug (per project owner)**: the macro fails when the user's Word
"highlighter" tool is currently set to "No color." The "armor paragraph
marks" pass uses `.Replacement.Highlight = True`, which in Word means
"apply the currently selected highlighter color" — if that's "no color,"
nothing is actually highlighted, the armoring is silently a no-op, and
the subsequent "delete non-highlighted styled text" passes then collapse
the document's paragraph structure. Our reimplementation should either
specify an explicit color (not a UI-state-dependent "true") or, better,
not need the armoring trick at all (since we're not constrained to
Word's find/replace semantics).

**Effect to replicate**: a non-destructive "show me only what I'll read"
view, plus an export-only path for when a frozen read-version doc is
genuinely wanted (see §e/§f).

### e) `CreateReadDoc (Pretty)` — non-destructive read-version export
`Create Read Doc (Pretty).txt`

Save the original, copy to `READ_<filename>.docx`, run InvisibilityOn
on the copy *including* the condense-adjacent-highlighted-paragraphs pass,
reopen the original. The "pretty" qualifier refers to the condense pass:
the read version reads as flowing prose rather than choppy paragraph
fragments.

### f) `CreateReadDoc (Fast)` — same, without the condense pass
`Create Read Doc (Fast).txt`

Same pipeline, calls `InvisibilityOnFast` which skips the
join-highlighted-paragraphs pass. Faster on large documents.

**Effect to replicate (combined e+f)**: an "export read version" command
that takes a doc and emits a derived doc containing only the read-aloud
material, with a quality knob (paragraph-flow vs. fast). In ProseMirror
this is naturally a *transform-then-serialize* pipeline — no need for the
"copy file, mutate, reopen, save" dance.

### g) `CreateSendDoc` — sharing-safe export
`Create Send Doc.txt`

Save the original, copy to `SEND_<filename>.docx`, on the copy: find all
text styled `Analytic` or `Undertag` and replace with a paragraph break.
This produces a version safe to share with opponents — strips the team's
private analytic commentary and undertag annotations. Other content
(cards, tags, cites, highlighting) is preserved.

**Effect to replicate**: an "export shareable copy" command that strips
configurable styles. We should make the strip-list configurable rather
than hardcoded; teams may want different defaults.

---

## 3. Cross-cutting design implications for the editor

1. **The `#555555` font-color sentinel is part of the data contract.**
   Documents in this ecosystem embed semantic information as raw font
   color. Our import must recognize it and our export must reproduce it
   (or produce its semantic equivalent that the existing `InvisibilityOn`
   macro can still find — but that means it has to be `#555555` exactly).

2. **Highlight has dual semantic load.** Beyond direct visual emphasis,
   highlight presence is the implicit predicate for "is this text part
   of what gets read aloud?" Several macros (read-mode, word count,
   condense-paragraphs) all key on "is anything in this run/paragraph
   highlighted?" Our schema should make this predicate cheap to query.

3. **The "transform-and-export" pattern recurs.** Read version, send
   version — both are derived documents. Our editor should expose a
   first-class "transform pipeline → save as" facility rather than
   a kitchen-sink macro per variant.

4. **In-place destructive operations should be reframed as reversible.**
   The custom `InvisibilityOn` is destructive purely as a performance
   hack against Word; the project owner would prefer reversible behavior
   if perf permits. With a ProseMirror-based renderer, hide/show via
   class toggle or derived view should be cheap enough to make
   reversibility the default. Keep destructive-export-to-file (§e/§f)
   as a separate, opt-in operation.

5. **The "read-aloud" predicate is style-aware, not bold-aware.** A
   single canonical predicate should drive both word-count and read-mode
   filtering: *"the run is in Tag / Cite / Analytic style, OR is
   highlighted (or sits inside an already-passing block)."* Implement
   once, share across features.

6. **Reader-time analysis is per-team configurable data.** The hardcoded
   seven-reader list with `WPM=111` placeholders implies users edit the
   macro source. Expose as a settings panel (list of `{name, wpm}`
   pairs) and ship without placeholders.

7. **Don't replicate the "armored paragraph mark" trick.** The custom
   `InvisibilityOn` pre-marks every `^p` so Word's find/replace
   non-highlighted-deletion passes don't collapse paragraph structure.
   This is also where the "highlight: no color" bug bites — the armoring
   silently no-ops if the user's highlighter is set to no color, and the
   subsequent deletion passes then destroy paragraph structure. Our
   schema-level transforms can simply preserve paragraph nodes by
   construction.
