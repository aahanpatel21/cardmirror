/**
 * TEMPORARY self-close probe — DELETE once the multi-window mode-switch design
 * question is answered. It determines whether a spawned PWA window can close
 * itself via `window.close()`, which decides how one-per-window → three-pane
 * works on the web (each passenger window would have to self-close).
 *
 * Why a probe and not a doc lookup: our windows are opened via a
 * `rel="noopener"` anchor click (required for app-window capture), so they have
 * no opener. `window.close()` on such a window is allowed ONLY if the browsing
 * context is "script-closable" (a top-level context with a single history
 * entry) — which is exactly the thing that needs testing on real Chrome.
 *
 * Arming: visit any app URL with `?probe=selfclose` ONCE. That sets a
 * localStorage flag (same-origin, so freshly SPAWNED windows — which don't
 * carry the query string — inherit it). Then relaunch the installed app, run
 * New Document to spawn a window, and click the button in that spawned window.
 *
 * Reading the result: `window.close()` does NOT throw when blocked — it just
 * no-ops (with a console warning). So the button calls it and, if this window
 * is still alive ~400ms later, alerts that self-close was BLOCKED (with
 * diagnostics). If self-close works, the window simply vanishes.
 *
 * Shift-click the button to disarm (clears the flag + removes the button).
 */

const SELF_CLOSE_PROBE_KEY = 'pmd-selfclose-probe';

export function installSelfCloseProbe(): void {
  let armed = false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('probe') === 'selfclose') {
      localStorage.setItem(SELF_CLOSE_PROBE_KEY, '1');
    }
    armed = localStorage.getItem(SELF_CLOSE_PROBE_KEY) === '1';
  } catch {
    armed = false;
  }
  if (!armed || typeof document === 'undefined' || !document.body) return;

  const btn = document.createElement('button');
  btn.textContent = '🧪 Try window.close()';
  btn.title = 'Attempt window.close() on this window. Shift-click to disarm the probe.';
  btn.setAttribute('data-selfclose-probe', '');
  btn.style.cssText = [
    'position:fixed',
    'bottom:12px',
    'right:12px',
    'z-index:2147483647',
    'padding:8px 12px',
    'background:#b00020',
    'color:#fff',
    'border:none',
    'border-radius:6px',
    'font:13px system-ui,sans-serif',
    'cursor:pointer',
    'box-shadow:0 2px 8px rgba(0,0,0,.35)',
  ].join(';');

  btn.addEventListener('click', (e: MouseEvent) => {
    if (e.shiftKey) {
      try {
        localStorage.removeItem(SELF_CLOSE_PROBE_KEY);
      } catch {
        /* ignore */
      }
      btn.remove();
      return;
    }
    const diagnostics = [
      `display-mode standalone: ${window.matchMedia('(display-mode: standalone)').matches}`,
      `has opener: ${window.opener ? 'yes' : 'no'}`,
      `history.length: ${window.history.length}`,
    ].join('\n');
    window.close();
    window.setTimeout(() => {
      window.alert(
        'window.close() did NOT close this window → SELF-CLOSE IS BLOCKED.\n\n' +
          diagnostics +
          '\n\n(If self-close had worked, this window would be gone and you ' +
          'would not be reading this.)',
      );
    }, 400);
  });

  document.body.appendChild(btn);
}
