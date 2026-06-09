import { describe, it, expect } from 'vitest';
import {
  chunkText,
  TRANSLATION_LANGUAGES,
  languageName,
  buildTranslationMarker,
  TRANSLATION_MARKER_NAMES,
} from '../../src/editor/translate.js';
import { compileShrinkProtections } from '../../src/editor/ribbon-commands.js';

describe('chunkText (MyMemory request splitting)', () => {
  it('returns the text whole when under the limit', () => {
    expect(chunkText('short text', 480)).toEqual(['short text']);
  });

  it('every chunk stays within the limit', () => {
    const text = Array.from({ length: 50 }, (_, i) => `This is sentence number ${i} with some words.`).join(' ');
    const chunks = chunkText(text, 100);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100);
  });

  it('rejoining the chunks reproduces the original text exactly', () => {
    const text = 'Alpha. Beta! Gamma? Delta.\nEpsilon zeta eta theta iota kappa lambda mu nu xi omicron pi.';
    const chunks = chunkText(text, 30);
    expect(chunks.join('')).toBe(text);
  });

  it('hard-splits an oversized atom with no break points', () => {
    const text = 'x'.repeat(1000);
    const chunks = chunkText(text, 100);
    expect(chunks.length).toBe(10);
    expect(chunks.join('')).toBe(text);
  });
});

describe('TRANSLATION_LANGUAGES', () => {
  it('includes English and uses ISO 639-1 codes', () => {
    expect(TRANSLATION_LANGUAGES.find((l) => l.code === 'en')?.name).toBe('English');
    for (const l of TRANSLATION_LANGUAGES) expect(l.code).toMatch(/^[a-z]{2}$/);
  });

  it('languageName falls back to the raw code', () => {
    expect(languageName('fr')).toBe('French');
    expect(languageName('zz')).toBe('zz');
  });
});

describe('translation marker', () => {
  it('wraps the attribution in the default condense delimiter', () => {
    // Fresh test env → condenseWarningDelimiter defaults to '['.
    expect(buildTranslationMarker('MYMEMORY')).toBe('[TRANSLATION BY MYMEMORY]');
    expect(buildTranslationMarker('OPUS 4.8')).toBe('[TRANSLATION BY OPUS 4.8]');
  });

  it('every possible marker is protected from Shrink', () => {
    const patterns = compileShrinkProtections([], '', '');
    for (const name of TRANSLATION_MARKER_NAMES) {
      const marker = buildTranslationMarker(name);
      const matched = patterns.some((re) => {
        re.lastIndex = 0;
        return re.test(marker);
      });
      expect(matched, `unprotected: ${marker}`).toBe(true);
    }
  });
});
