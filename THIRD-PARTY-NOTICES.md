# Third-Party Notices

CardMirror incorporates the following third-party materials. Each is
used under its own license, reproduced or summarized below. This file
satisfies the attribution / notice obligations of those licenses; it
does not modify the terms under which CardMirror itself is offered (see
[`LICENSE`](./LICENSE)).

---

## ProseMirror

The rich-text editing core (schema, transactions, NodeViews, plugins,
keymap, history, etc.) is [ProseMirror](https://prosemirror.net/) by
Marijn Haverbeke, used under the **MIT License**. ProseMirror's
copyright and permission notices are preserved in the project's
`node_modules/` as distributed.

---

## Untitled UI Icons

The application's interface icons (toolbar, banners, dialogs, status
bar) are from the [Untitled UI free icons](https://www.untitledui.com/free-icons),
© 2025 Untitled UI. They are obtained from the community packaging at
<https://github.com/untitleduico/icons>.

The icons are used under the **Untitled UI free license**. Per that
license:

> **You are allowed to:**
> - Use the icons in personal and commercial projects.
>
> **You are not allowed to:**
> - Sell, sublicense, or distribute the icons (in original or modified form).
> - Create derivative icon libraries based on the icons.
> - Use the icons in any form of UI kit, library, or template intended for resale.

The full agreement is at <https://www.untitledui.com/license>.

In CardMirror the icons are used as product UI. The upstream `.svg`
files and the icon set as a whole are not committed or redistributed:
the full set lives only in a developer's gitignored local clone.
`scripts/gen-icons.mjs` bakes the specific glyphs the app uses into
`src/editor/icons.css` as `currentColor` mask images (so that single
generated file does embed those glyphs' path data), and the shipped
application renders from it. The icons are not repackaged as an icon
library or offered for resale.
