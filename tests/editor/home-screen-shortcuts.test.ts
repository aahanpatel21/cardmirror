// @vitest-environment jsdom
/**
 * Home-screen number shortcuts (1-9) must stand down while a modal or the
 * command bar is layered over the home screen — otherwise they fire over the
 * modal and swallow number input meant for it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { homeScreen, type HomeScreenCallbacks } from '../../src/editor/home-screen.js';
import { pushOverlay, popOverlay } from '../../src/editor/overlay-stack.js';

function makeCallbacks(): HomeScreenCallbacks & { newDoc: ReturnType<typeof vi.fn> } {
  return {
    newDoc: vi.fn(),
    newSpeechDoc: vi.fn(),
    open: vi.fn(),
    openRecent: vi.fn(),
    manageQuickCards: vi.fn(),
  };
}

function press(key: string, target: EventTarget = document.body): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

describe('home-screen number shortcuts', () => {
  let cb: ReturnType<typeof makeCallbacks>;

  beforeEach(() => {
    document.body.innerHTML = '';
    cb = makeCallbacks();
    homeScreen.mount(document.body, cb);
    homeScreen.show();
  });

  afterEach(() => {
    homeScreen.hide();
  });

  it('fires the action when the home screen is the active layer', () => {
    press('1');
    expect(cb.newDoc).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire while a modal overlay is open', () => {
    const token = pushOverlay();
    try {
      press('1');
      expect(cb.newDoc).not.toHaveBeenCalled();
    } finally {
      popOverlay(token);
    }
  });

  it('does NOT fire when focus is in a text input (e.g. the command bar)', () => {
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.focus();
    press('1', input);
    expect(cb.newDoc).not.toHaveBeenCalled();
  });

  it('resumes firing once the overlay closes', () => {
    const token = pushOverlay();
    press('1');
    popOverlay(token);
    press('1');
    expect(cb.newDoc).toHaveBeenCalledTimes(1);
  });
});
