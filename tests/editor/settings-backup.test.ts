import { describe, it, expect } from 'vitest';
import { SettingsStore } from '../../src/editor/settings.js';

// SettingsStore tolerates the absence of localStorage / window (its
// load + persist are try/caught), so a fresh instance boots to DEFAULTS
// in the node test env.

describe('settings export', () => {
  it('excludes the Anthropic API key but keeps everything else', () => {
    const s = new SettingsStore();
    s.set('anthropicApiKey', 'sk-secret');
    s.set('commentAuthor', 'Alice');
    const out = s.exportObject();
    expect('anthropicApiKey' in out).toBe(false);
    expect(out['commentAuthor']).toBe('Alice');
    expect(out['ribbonKeyOverrides']).toBeDefined();
  });
});

describe('settings import (replaceAll)', () => {
  it('overwrites listed fields and preserves the current API key', () => {
    const s = new SettingsStore();
    s.set('anthropicApiKey', 'keep-me');
    s.set('commentAuthor', 'Old');
    s.replaceAll({ commentAuthor: 'New' });
    expect(s.get('commentAuthor')).toBe('New');
    expect(s.get('anthropicApiKey')).toBe('keep-me');
  });

  it('fills defaults for missing fields and drops unknown keys', () => {
    const s = new SettingsStore();
    s.set('commentAuthor', 'Set');
    s.replaceAll({ navWidth: 300, bogusField: 123 });
    expect(s.get('navWidth')).toBe(300);
    expect(s.get('commentAuthor')).toBe('You'); // missing in import → default
    expect('bogusField' in (s.all() as Record<string, unknown>)).toBe(false);
  });

  it('coerces / clamps garbage values via sanitize', () => {
    const s = new SettingsStore();
    s.replaceAll({
      navWidth: 999999,
      ribbonKeyOverrides: 'not-an-object',
      keyboardMacros: 'nope',
    });
    expect(s.get('navWidth')).toBe(800); // clamped to max
    expect(s.get('ribbonKeyOverrides')).toEqual({});
    expect(s.get('keyboardMacros')).toEqual([]);
  });

  it('round-trips an export back through import', () => {
    const a = new SettingsStore();
    a.set('commentAuthor', 'Round');
    a.set('keyboardMacros', [{ id: 'm1', key: 'Mod-Shift-j', text: 'hi' }]);
    a.set('anthropicApiKey', 'a-key');
    const b = new SettingsStore();
    b.set('anthropicApiKey', 'b-key');
    b.replaceAll(a.exportObject());
    expect(b.get('commentAuthor')).toBe('Round');
    expect(b.get('keyboardMacros')).toEqual([{ id: 'm1', key: 'Mod-Shift-j', text: 'hi' }]);
    expect(b.get('anthropicApiKey')).toBe('b-key'); // not carried by export
  });
});
