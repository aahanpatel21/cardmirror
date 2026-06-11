import { defineConfig } from 'vite';
import { existsSync } from 'node:fs';
import path from 'node:path';

// The dev server (`npm run dev`) serves from `/`. Production builds
// default to `/cardmirror/` so the bundle works when hosted at
// `https://ant981228.github.io/cardmirror/` (the GitHub Pages URL
// derived from the repo name). Override with `VITE_BASE=/foo/` if
// deploying somewhere else.
//
// `@cardcutter/browser` resolves to the separately-versioned, NOT-
// shipped card-cutter package when it's checked out alongside this
// repo. The app imports it dev-only and dynamically (see
// card-cutter-port.ts, `@vite-ignore`d + try/caught), so when the
// sibling is absent the alias just never resolves — harmless.
const cardCutterEntry = path.resolve(__dirname, '../card-cutter/src/browser.ts');
const cardCutterStub = path.resolve(__dirname, 'src/editor/card-cutter-stub.ts');

export default defineConfig(({ command }) => {
  // The card-cutter engine is experimental and NOT shipped: a
  // production build always resolves `@cardcutter/browser` to the
  // in-repo no-op stub, even when the sibling package is checked out.
  // Only the dev server wires the real engine (when present).
  const cardCutterTarget =
    command === 'serve' && existsSync(cardCutterEntry) ? cardCutterEntry : cardCutterStub;
  return {
    base:
      process.env['VITE_BASE'] ??
      (command === 'build' ? '/cardmirror/' : '/'),
    resolve: { alias: { '@cardcutter/browser': cardCutterTarget } },
    server: {
      fs: { allow: [path.resolve(__dirname), path.resolve(__dirname, '../card-cutter')] },
    },
  };
});
