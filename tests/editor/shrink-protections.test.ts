/**
 * Unit tests for `compileShrinkProtections` — the pipeline that
 * combines the static built-in protected patterns with user-supplied
 * custom rules and (when configured) the warning-marker patterns for
 * the user's custom condense-with-warning delimiter.
 */

import { describe, expect, it } from 'vitest';
import { compileShrinkProtections } from '../../src/editor/ribbon-commands.js';

function sources(regexes: readonly RegExp[]): string[] {
  return regexes.map((r) => r.source);
}

describe('compileShrinkProtections', () => {
  it('returns the built-in patterns when there are no customs', () => {
    const list = compileShrinkProtections([], '', '');
    // Built-ins: 6 omission shapes + 6 warning-marker shapes = 12.
    expect(list.length).toBe(12);
    // All have `gi` flags.
    for (const r of list) {
      expect(r.flags).toContain('g');
      expect(r.flags).toContain('i');
    }
  });

  it('escapes literal-string customs so regex metacharacters are matched verbatim', () => {
    const list = compileShrinkProtections(
      [{ pattern: '[Hello.World]', isRegex: false }],
      '',
      '',
    );
    const added = list[list.length - 1]!;
    // `.` becomes `\.`, brackets escaped — the source should match the
    // literal string only.
    expect(added.source).toBe('\\[Hello\\.World\\]');
    expect('[Hello.World]'.match(added)).toBeTruthy();
    expect('[HelloXWorld]'.match(added)).toBeFalsy();
  });

  it('treats isRegex=true customs as raw regex sources', () => {
    const list = compileShrinkProtections(
      [{ pattern: 'foo\\d+', isRegex: true }],
      '',
      '',
    );
    const added = list[list.length - 1]!;
    expect(added.source).toBe('foo\\d+');
    expect('foo123'.match(added)).toBeTruthy();
    expect('foo'.match(added)).toBeFalsy();
  });

  it('skips invalid regex sources rather than throwing', () => {
    const before = compileShrinkProtections([], '', '').length;
    const list = compileShrinkProtections(
      [
        { pattern: '(unclosed', isRegex: true }, // invalid
        { pattern: 'valid', isRegex: false }, // valid literal
      ],
      '',
      '',
    );
    // Only the valid one is added; built-ins are unchanged.
    expect(list.length).toBe(before + 1);
    expect(list[list.length - 1]!.source).toBe('valid');
  });

  it('skips empty pattern strings', () => {
    const before = compileShrinkProtections([], '', '').length;
    const list = compileShrinkProtections(
      [{ pattern: '', isRegex: false }],
      '',
      '',
    );
    expect(list.length).toBe(before);
  });

  it('adds a warning-marker regex when custom delimiters are configured', () => {
    const before = sources(compileShrinkProtections([], '', ''));
    const list = compileShrinkProtections([], '#@', '@#');
    const added = sources(list).filter((s) => !before.includes(s));
    expect(added.length).toBe(1);
    expect(added[0]).toBe('#@PARAGRAPH INTEGRITY (?:PAUSES|RESUMES)@#');
  });

  it('escapes regex metacharacters in custom delimiters', () => {
    const list = compileShrinkProtections([], '|+|', '|+|');
    const before = compileShrinkProtections([], '', '');
    const added = list.length === before.length + 1 ? list[list.length - 1]! : null;
    expect(added).not.toBeNull();
    expect(added!.source).toBe('\\|\\+\\|PARAGRAPH INTEGRITY (?:PAUSES|RESUMES)\\|\\+\\|');
    // The compiled regex matches literal `|+|PARAGRAPH INTEGRITY PAUSES|+|`,
    // case-insensitive.
    expect('|+|PARAGRAPH INTEGRITY PAUSES|+|'.match(added!)).toBeTruthy();
    expect('|+|paragraph integrity resumes|+|'.match(added!)).toBeTruthy();
  });

  it('skips the custom-delim auto-pattern when either half is empty', () => {
    const baseline = compileShrinkProtections([], '', '').length;
    expect(compileShrinkProtections([], 'only-open', '').length).toBe(baseline);
    expect(compileShrinkProtections([], '', 'only-close').length).toBe(baseline);
  });
});
