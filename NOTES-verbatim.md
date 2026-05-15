# Verbatim — style manipulation reference

Notes from reading the VBA source of upstream Verbatim
(<https://github.com/ashtarcommunications/verbatim>, `desktop/src/`).
File names below (`Formatting.bas`, `Paperless.bas`, `Settings.bas`,
etc.) are relative to that directory.

The headline takeaway for our docx contract: **Verbatim's document model is
*hybrid*** — structural meaning lives in **named Word styles + outline level**,
while emphasis/highlighting is split awkwardly between **named character
styles** AND **direct character formatting**, and the two layers interact.

---

## 1. Style vocabulary (the canonical names)

### Paragraph styles (structural hierarchy)

Each is bound to a specific Word `OutlineLevel`. In OOXML, the style is keyed
by `w:styleId="HeadingN"` with the debate-specific name carried as an
`<w:aliases>` element. Word's UI displays this as the comma-joined string
`Heading N,Alias` and Verbatim's VBA matches against that joined form
(`NameLocal`), but at the docx level the canonical identifier is the styleId.

| Alias       | styleId      | Aliases element        | OOXML outlineLvl | Hotkey | Role                          |
|-------------|--------------|------------------------|------------------|--------|-------------------------------|
| Pocket      | `Heading1`   | `Pocket`               | `0` (Level 1)    | F4     | Top-level section             |
| Hat         | `Heading2`   | `Hat`                  | `1` (Level 2)    | F5     | Subsection                    |
| Block       | `Heading3`   | `Block`                | `2` (Level 3)    | F6     | Sub-subsection                |
| Tag         | `Heading4`   | `Tag`                  | `3` (Level 4)    | F7     | Card label / argument tag     |
| Normal/Card | `Normal`     | `Normal/Card` (display alias) | body text  | —      | Card body (evidence text)     |

(OOXML `outlineLvl` is 0-indexed; Word's `wdOutlineLevelN` is 1-indexed, so
`outlineLvl=3` ↔ `wdOutlineLevel4`.)

Each `HeadingN` also has a linked character style `HeadingNChar`
(`<w:link w:val="HeadingNChar"/>`) so inline application works transparently.

References: `Formatting.bas` `RemoveExtraStyles` (allowlist),
`Settings.bas` hotkey table, and `Debate.dotm`'s `word/styles.xml`
for the canonical style definitions.

### Character styles (emphasis)

Same `styleId + aliases` pattern as the headings: the styleId is what
appears in `<w:rStyle>` references in the docx, while the alias is the
short name Verbatim's VBA matches via `NameLocal`. Easy to confuse.

| Alias     | styleId          | Aliases element | Hotkey | Role                                  |
|-----------|------------------|-----------------|--------|---------------------------------------|
| Cite      | `Style13ptBold`  | `Cite`          | F8     | Author/date metadata within a card    |
| Underline | `StyleUnderline` | `Underline`     | F9     | Underlined chunks of evidence text    |
| Emphasis  | `Emphasis`       | (none)          | F10    | High-emphasis chunks (often + yellow highlight) |

So when reading real docx files, expect `<w:rStyle w:val="Style13ptBold"/>`
and `<w:rStyle w:val="StyleUnderline"/>` — the names `Cite` and `Underline`
appear nowhere in the OOXML for these character styles.

References: `Formatting.bas` (style allowlist + F-key handlers),
`Settings.bas` (hotkey table), `Debate.dotm` `word/styles.xml`.

### Legacy / cleanup-only

- `Analytic*` — in **stock** Verbatim, any style whose name starts with
  `analytic` (case-insensitive) is rewritten to `Tag` by
  `ConvertAnalyticsToTags` (`Formatting.bas`). See §7 below for how
  this project's custom variant repurposes the name.

---

## 2. Direct formatting layered on top

These are **not** styles; they're direct character properties that Verbatim
reads/writes alongside styles:

- **Highlight color** — `range.HighlightColorIndex` (yellow/blue/red/green/teal/…).
  *There is no "Highlighted" style.* All highlighting is direct formatting.
  Color name ↔ enum: `Formatting.bas`.
- **Font size** — direct override; shrink cycles 11 → 8 → 7 → 6 → 5 → 4 → Normal
  (`Shrink.bas`).
- **Bold** — direct only; e.g. `FixFakeTags` reclassifies bold body-level text
  bigger than the Underline style's size as a Tag (`Formatting.bas`).
- **Font.Underline** — both a style (`Underline`) *and* a direct property.
  Comment at `Formatting.bas` explicitly notes that style-only checks don't
  work; you must inspect both.
- **Font color** — used for marker annotations (e.g. red "Marked [time]"
  inserted by `Paperless.SendToSpeech`).
- **Pilcrow glyph** — Unicode ¶ (Win char code 182, Mac 166), forced to 6 pt
  non-bold non-underlined; Verbatim uses these to *encode* paragraph breaks
  inside a condensed run while keeping it visually one paragraph
  (`Condense.bas`).

### Coexistence rules

- Applying the `Underline` style sets `Font.Underline` too (and removing the
  style does not always clear the property — hence the dual checks).
- The `Emphasis` style is sometimes paired with yellow highlight; some cleanup
  paths re-pair them deliberately (`Formatting.bas`).
- Direct font size overrides whatever the style declares.
- `ClearFormatting()` clears both layers but leaves paragraph style at `Normal`.

---

## 3. Operations catalog (user-facing, ribbon-bound)

Routing happens in `Ribbon.bas:RibbonMain()` which dispatches to
module-level subs. Grouped below by what they touch.

### a) Apply structural styles
- F4 / F5 / F6 / F7 → Pocket / Hat / Block / Tag (`Settings.bas`)
- F8 → Cite character style (`Settings.bas`)

### b) Emphasis & highlighting
- `Formatting.ToggleUnderline` (F9, `Ribbon.bas`) — toggle Underline style.
- `Formatting.UnderlineMode` (`Formatting.bas`) — interactive "underline as
  you type" loop until toggled off.
- `Formatting.AutoUnderline` (`Formatting.bas`) — analyzes the *Tag*
  for synonyms, scores chunks of card text, applies `Underline` if score ≥ 0.1
  and (optionally) `Emphasis` if ≥ 0.25.
- `Formatting.AutoEmphasizeFirst` (`Formatting.bas`) — emphasizes the
  first character of each word in selection.
- `Formatting.UniHighlight` (`Formatting.bas`) — recolor every
  highlight in the doc to a chosen color.
- `Formatting.UniHighlightWithException` (`Formatting.bas`) — same,
  but skip one configured color.
- `Formatting.RemoveEmphasis` (`Formatting.bas`) — find/replace
  Emphasis → Underline (with confirmation).
- `Formatting.RemoveNonHighlightedUnderlining` (`Formatting.bas`).

### c) Shrink / condense / expand
- `Shrink.ShrinkAllOrCard` (`Shrink.bas`) — cycle font size on current card,
  or whole doc if cursor is in empty area.
- `Shrink.ShrinkAll` / `Shrink.UnshrinkAll` (`Shrink.bas`).
- `Shrink.ShrinkPilcrows` (`Shrink.bas`) — force pilcrows to 6pt clean.
- `Condense.CondenseNoPilcrows` / `CondenseWithPilcrows` / `Uncondense`
  (`Condense.bas`) — collapse a card's whitespace, optionally encoding
  paragraph breaks as 6pt pilcrows.
- `Condense.RemovePilcrows` (`Condense.bas`).

### d) Structural reorganization
- `Paperless.MoveUp` / `MoveDown` / `MoveToBottom`
  (`Paperless.bas`) — outline-aware reordering.
- `Paperless.SelectHeadingAndContent` (`Paperless.bas`) — select a
  heading and everything under it down to the next same-or-larger heading.
- `Formatting.AutoNumberTags` / `DeNumberTags` (`Formatting.bas`).
- `Formatting.CopyPreviousCite` (`Formatting.bas`).

### e) Cleanup / normalization
- `Formatting.FixFakeTags` (`592-602`) — bold body text > Underline-style size → Tag.
- `Formatting.ConvertAnalyticsToTags` (`604-610`).
- `Formatting.FixFormattingGaps` (`1031-1093`) — bridge punctuation/space gaps
  in styled runs.
- `Formatting.ConvertToDefaultStyles` (`720-941`) — heavy normalize: collapse
  variant style names into canonical ones, unlink linked styles, re-pair
  Emphasis with yellow highlight.
- `Formatting.RemoveExtraStyles` (`612-718`) — keep only canonical + built-in
  styles; hide the rest.
- `Formatting.RemoveBlanks` (`234-246`) — short blank-ish lines → Normal so
  they stop appearing in the nav pane.
- `Formatting.UpdateStyles` (`267-270`) — `ActiveDocument.UpdateStyles` from
  the attached template.
- `Formatting.AutoFormatCite` / `ReformatAllCites` (`303-405`) — author/date
  detection inside a paragraph.
- `Formatting.SelectSimilar` (`272-288`) — wraps `WordBasic.SelectSimilarFormatting`
  with a workaround.

### f) View / paste
- `View.InvisibilityMode` (`View.bas`) — hide all non-highlighted body
  text (sets `Font.Hidden`) except Cite paragraphs.
- `Formatting.PasteText` (`Formatting.bas`) — unformatted paste, with
  optional auto-condense.
- `Formatting.RemoveHyperlinks` (`290-301`).

---

## 4. Document-level metadata

Set in `Startup.AutoNew` (`Startup.bas`) as Word document variables:

- `Creator`, `Team`, `VerbatimVersion`, `OS`, `OSVersion`, `WordVersion`

These are pure metadata, not load-bearing for rendering. Round-trip should
preserve them but we don't have to interpret them.

`RibbonPointer` is a runtime-only document variable (a pointer to the live
`IRibbonUI` object); it has no persistence value and should be ignored on
import.

**No custom XML parts.** Verbatim sticks to native Word styles + variables +
direct formatting. Bookmarks appear in the VirtualTub flow but don't seem to
carry style-relevant info (TODO: confirm if we touch that feature).

---

## 5. Gotchas for our reimplementation

These are the things most likely to bite us:

1. **`Underline` is dual** — both a character style and a direct font property.
   Verbatim's own code commits the dual representation
   (`Formatting.bas` comment). Our docx import must read both; our export
   must produce both, otherwise Verbatim's checks will misclassify our text.
2. **Outline level is read directly**, not derived from style name. Many code
   paths use `OutlineLevel < wdOutlineLevel5` to find headings rather than
   matching `Style.NameLocal`. Our exported styles must declare the correct
   outline level — not just have the right name.
3. **`Cite` detection has two modes** — the explicit style (`IdentifyCiteStyle`,
   `Paperless.bas`) and a heuristic one (`IdentifyCite`,
   `Paperless.bas`) keyed on `[(<`, URLs, and tokens like
   "omitted/edited/modified/sic". Round-trip should keep the explicit style.
4. **`Emphasis` ↔ yellow highlight pairing** — `ConvertToDefaultStyles`
   (`Formatting.bas`) re-introduces yellow highlight on Emphasis-styled
   ranges. If we strip highlights on import we'll lose information; if we
   strip on export we may *break* a document on the next "Update Styles" run.
5. **`FixFakeTags` is destructive** — bold body-level text larger than the
   `Underline` style's font size is silently rewritten to `Tag`. Our exports
   should not produce such text accidentally.
6. **Pilcrow encoding is settings-dependent** — whether `^p` becomes a 6pt ¶
   depends on user-side registry settings (`ParagraphIntegrity`, `UsePilcrows`).
   We can't infer "is this doc condensed?" from the doc alone; we must detect
   pilcrows by Unicode/glyph + font size.
7. **`NameLocal` is locale-sensitive** — Verbatim's `RemoveExtraStyles`
   compares `NameLocal` against English strings like `"Heading 1,Pocket"`. On
   a non-English Word install this breaks. We should round-trip by *style ID*
   where possible, not by display name.
8. **Hidden styles are not deleted** — `RemoveExtraStyles` toggles
   `s.Visibility`. Our import must look at hidden styles too.
9. **Linked styles** — `ConvertToDefaultStyles` explicitly unlinks via
   `s.LinkStyle = "Normal"` (`Formatting.bas`). If we preserve links
   we'll cause cleanup churn next time the user runs it.
10. **`Normal` style is load-bearing** — every shrink/unshrink op falls back
    to `Styles("Normal").Font.size`. Documents we produce must have a `Normal`
    with a sensible default size (Verbatim assumes ~11pt).

---

## 6. Real-world observations from working documents

Findings from surveying real Verbatim working files. These are facts
about how Verbatim docs get serialized in practice — distinct from
how the source code suggests they "should" look.

### Body paragraphs have no `pStyle`

Paragraphs that the user thinks of as "Normal/Card body" emit no
`<w:pStyle>` at all. Word omits the default style by convention.
**Importer rule**: a `<w:p>` with no `<w:pStyle>` is a body
paragraph, not malformed.

### Multiple "files" coexist in one .docx

Real working docs routinely bundle multiple separate "files" (e.g. a
disad and a companion counterplan) in a single `.docx`. The boundary
is just an empty `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr></w:p>`
followed by a new top-level Heading1 paragraph. No page break, no
comment, no special markup. This pattern is normal — the docx root
is effectively a *sequence of pocket-like sections*, not "the
document."

### Personal cutting-board conventions show up at the top of real docs

Working docs often lead with a `Heading3`-styled block — typically
titled something like "Patch Notes" — that the author uses as a
version log or cutting board, before any real card content. **These
are personal conventions, not a community-wide debate practice** —
don't generalize from any particular title. The schema admits the
loose paragraphs in such a block as ordinary block-level content;
the importer should not special-case heading titles.

### Pocket-level structure is optional

Plenty of real working docs have zero Heading1 paragraphs and open
straight at `Heading2` or `Heading3`. **Schema implication**: don't
require Pocket at the root.

### Outline-level skips happen, especially around cutting-board regions

The "Patch Notes" → first real card transition routinely jumps levels.
Real docs are not guaranteed to have contiguous heading levels. Our
schema accepts skips directly — heading nodes are flat paragraphs whose
hierarchy is implicit in document order, not enforced by containment.

### Paragraph-mark formatting in `<w:pPr>/<w:rPr>` does NOT propagate to runs

This was misread during the original survey. Real Word docs sometimes
contain `<w:pPr><w:rPr>...</w:rPr></w:pPr>` with formatting on it, but
per OOXML 17.7.5.10 that describes only the formatting of the
*paragraph-mark glyph* (the ¶), NOT the runs in the paragraph. Runs
take their formatting from their own `<w:rPr>` plus the paragraph's
`<w:pStyle>`'s linked character style. They do NOT inherit from
`<w:pPr>/<w:rPr>`.

When real-doc users do mass-formatting operations (Verbatim's
`UniHighlight` etc.), Word actually applies the formatting to every
run individually. The pPr/rPr is incidental noise that affects only
the paragraph-mark glyph. **Importer rule**: ignore pPr/rPr; parse
each run's rPr independently.

### Run-level rPr churn is normal

Every Word edit creates a new run. Real paragraphs contain dozens of
adjacent `<w:r>` elements with identical `<w:rPr>`. Importer needs an
adjacent-runs-with-same-formatting → merge pass to normalize.

### Direct-formatting patterns to expect

Patterns the importer must handle because they appear in real
working docs (orders of magnitude vary; the qualitative shape doesn't):

- `<w:color w:val="555555"/>` runs — the "for reference, do not read"
  grey-text sentinel; ubiquitous, can number in the thousands per doc.
- `<w:shd w:fill="D2D2D2"/>` runs — Verbatim's protected-highlight
  shading (`HighlightToBackgroundColor`); common but lighter than 555555.
- 6pt pilcrow (`¶` glyphs sized down) — present only in
  `Condense`-processed docs; absent from typical working drafts.
- `StyleUnderline` rStyle — the everyday emphasis mark, applied
  heavily (often more than every other emphasis combined).
- `Emphasis` rStyle — heavy use, often comparable to `StyleUnderline`.
- `Style13ptBold` rStyle — cite metadata bolded inline; sparse compared
  to the underline / emphasis runs.
- `Analytic` paragraphs — heavy use, not a niche feature.
- `Undertag` paragraphs — present but rare.

### Stylepox is a real, ambient threat

The user has separately documented the "stylepox" phenomenon — random
custom styles that propagate via copy-paste — and built a Stylepox
Cleaner utility that normalizes infected docs. Reported infection rate:
~62% of open-source college policy docs. A representative artifact:
unrecognized style ids like `AAAUNDERLINEKEYBOARD` show up in working
docs as copy-paste residue from infected sources. Treat it as an
ambient hazard the import normalizer must handle.

Reference: `https://debate-decoded.ghost.io/leveling-up-your-debate-software-3-curing-stylepox/`.

---

## 7. Advanced Verbatim — this project's target variant

We're not targeting stock Verbatim. The project owner maintains and
disseminates **Advanced Verbatim**, a forked Verbatim build with two extra
styles, which any document we import/export may legitimately contain. Our
docx contract must round-trip them losslessly even though stock Verbatim
does not know about them.

Reference for the fork's documented features:
`https://debate-decoded.ghost.io/leveling-up-verbatim/`.

### Custom styles — verified against `Debate.dotm`

Both customs ship as **linked paragraph+character pairs**. The paragraph form
applies to whole paragraphs; the linked `*Char` character form is what Word
applies automatically when the user selects an inline run. Round-trip must
preserve both halves.

#### Analytic (paragraph) + AnalyticChar (character)

`Debate.dotm` `word/styles.xml`

```xml
<w:style w:type="paragraph" w:customStyle="1" w:styleId="Analytic">
  <w:name w:val="Analytic"/>
  <w:basedOn w:val="Heading4"/>
  <w:link w:val="AnalyticChar"/>
  <w:autoRedefine/>
  <w:uiPriority w:val="5"/>
  <w:qFormat/>
  <w:rPr>
    <w:color w:val="1F3864" w:themeColor="accent1" w:themeShade="80"/>
  </w:rPr>
</w:style>
<w:style w:type="character" w:customStyle="1" w:styleId="AnalyticChar">
  <w:name w:val="Analytic Char"/>
  <w:basedOn w:val="DefaultParagraphFont"/>
  <w:link w:val="Analytic"/>
  <w:rPr>
    <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" .../>
    <w:b/>
    <w:color w:val="1F3864" w:themeColor="accent1" w:themeShade="80"/>
    <w:sz w:val="26"/>     <!-- 13pt -->
  </w:rPr>
</w:style>
```

- **Inheritance**: paragraph form is `basedOn="Heading4"`, so it inherits Tag's
  outline level (`outlineLvl=3` = `wdOutlineLevel4`), `keepNext`/`keepLines`,
  bold (`<w:b/>`), 13pt size. The override is just the dark-blue color.
- **Color**: `#1F3864` (theme `accent1` shade `80`).
- **AnalyticChar** redeclares font/bold/color/size explicitly rather than
  relying on inheritance — typical Word linked-style boilerplate.

#### Undertag (paragraph) + UndertagChar (character)

`Debate.dotm` `word/styles.xml`

```xml
<w:style w:type="paragraph" w:customStyle="1" w:styleId="Undertag">
  <w:name w:val="Undertag"/>
  <w:link w:val="UndertagChar"/>
  <w:autoRedefine/>
  <w:uiPriority w:val="5"/>
  <w:qFormat/>
  <w:pPr>
    <w:spacing w:after="0"/>
  </w:pPr>
  <w:rPr>
    <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" .../>
    <w:i/>
    <w:iCs/>
    <w:color w:val="385623" w:themeColor="accent6" w:themeShade="80"/>
    <w:sz w:val="24"/>     <!-- 12pt -->
  </w:rPr>
</w:style>
<w:style w:type="character" w:customStyle="1" w:styleId="UndertagChar">
  <w:name w:val="Undertag Char"/>
  <w:basedOn w:val="DefaultParagraphFont"/>
  <w:link w:val="Undertag"/>
  <w:rPr>
    <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" .../>
    <w:i/>
    <w:iCs/>
    <w:color w:val="385623" w:themeColor="accent6" w:themeShade="80"/>
    <w:sz w:val="24"/>
  </w:rPr>
</w:style>
```

- **Inheritance**: paragraph form has no `basedOn` → defaults to `Normal`,
  i.e. body-text outline level.
- **Color**: `#385623` (theme `accent6` shade `80`, dark forest green).
- **Italic**: declared on both halves via `<w:i/>` and `<w:iCs/>`.
- **Spacing**: paragraph form sets `spacing after = 0`.

#### Quick-reference summary

| Alias    | styleId    | Linked char styleId | Type        | Outline level         | Visual                           |
|----------|------------|---------------------|-------------|-----------------------|----------------------------------|
| Analytic | `Analytic` | `AnalyticChar`      | linked pair | `wdOutlineLevel4` (inherited from `Heading4`) | Tag-like, color `#1F3864` |
| Undertag | `Undertag` | `UndertagChar`      | linked pair | body text             | TNR 12pt italic, color `#385623` |

### What the user's fork actually changes

Confirmed by the project owner: the fork **does not modify** any of
`ConvertAnalyticsToTags`, `RemoveExtraStyles`, `ConvertToDefaultStyles`, or
`FixFakeTags`. The fork only adds:

- New code in the dedicated **Custom section** (`Custom.bas`) of the VBA.
- Modifications to `InvisibilityOn` / `InvisibilityOff` in `View.bas`.

When we move on to bucket-3 (functionality replication), those two scopes
are where the fork's behavior diverges from upstream and will need separate
inspection.

### Latent collision risks (deliberate-invocation only)

The cleanup ops below *would* clobber `Analytic` and `Undertag` on a stock
Verbatim install, but in practice none of them auto-run — they're all
behind explicit ribbon buttons. The user's workflow simply doesn't press
those buttons, which is why their fork works without patching them.

For our exports, the implication is: docs we produce are safe to open in
stock Verbatim, but a user who explicitly hits "Convert to Default Styles"
or "Remove Extra Styles" on the Format menu will silently degrade them.
This is a documentation-and-warnings problem, not a docx-format problem.

- **`ConvertAnalyticsToTags`** (`Formatting.bas`) — prefix-matches
  `analytic` (via `LCase$(Left$(p.Style, 8))`) and rewrites to `Tag`. The
  string `Analytic` matches exactly, so this *would* destroy the style if
  invoked. Just doesn't get invoked.
- **`RemoveExtraStyles`** (`Formatting.bas`) — keeps only an
  allowlist of canonical names + Word built-ins; would hide both customs.
- **`ConvertToDefaultStyles`** (`Formatting.bas`) — would collapse
  variants into canonical names.
- **`FixFakeTags`** (`Formatting.bas`) — rewrites bold body-level
  text bigger than the Underline-style size into `Tag`. Since `Analytic`
  inherits Heading4's outline level (4) and is *not* body-level, it would
  not be affected. `Undertag` is body-level but italic-not-bold, so also
  unaffected.

### Round-trip implication

Documents from this ecosystem may contain any of seven paragraph-or-character
styles relevant to us:

- Paragraph: `Pocket`, `Hat`, `Block`, `Tag`, `Analytic` (custom),
  `Normal/Card`
- Character: `Cite`, `Underline`, `Emphasis`, `Undertag` (custom)

Our ProseMirror schema needs first-class support for both customs.

---

## 8. Schema design implications

This section moved to [`ARCHITECTURE.md`](./ARCHITECTURE.md), which is now
the source of truth for editor design decisions. This file stays focused on
documenting Verbatim's data model and the docx contract.
