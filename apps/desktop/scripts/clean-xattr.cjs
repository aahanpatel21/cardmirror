/**
 * electron-builder afterPack hook: strip any residual macOS extended
 * attributes (com.apple.FinderInfo, com.apple.quarantine, ResourceFork) from
 * the app bundle before codesign runs.
 *
 * Prevents:
 *   "resource fork, Finder information, or similar detritus not allowed"
 */
'use strict';

const { execFileSync } = require('node:child_process');

exports.default = async function cleanXattr(context) {
  if (context.electronPlatformName !== 'darwin') return;

  try {
    execFileSync('xattr', ['-cr', context.appOutDir], { stdio: 'ignore' });
  } catch {
    // Ignore errors on non-essential attributes
  }
};

