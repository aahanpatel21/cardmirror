/**
 * Preflight checks before desktop development, build, pack, or dist.
 *
 * 1. Automatically installs apps/desktop dependencies if missing.
 * 2. On macOS: If the repository is located inside ~/Documents or ~/Desktop
 *    (which are monitored by macOS iCloud Drive FileProvider), fileproviderd
 *    automatically stamps `com.apple.FinderInfo` and `com.apple.fileprovider.fpfs#P`
 *    onto .app and .framework bundles as they are created. Apple's codesign tool
 *    aborts on any bundle with FinderInfo:
 *      "resource fork, Finder information, or similar detritus not allowed"
 *    Redirecting apps/desktop/release via a symlink to ~/.cache/cardmirror-release
 *    bypasses fileproviderd while keeping the release artifacts directly accessible
 *    at apps/desktop/release/.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const desktopDir = path.join(rootDir, 'apps', 'desktop');

// 1. Ensure desktop dependencies exist
if (!fs.existsSync(path.join(desktopDir, 'node_modules', 'koffi'))) {
  console.log('Installing desktop dependencies...');
  execSync('npm --prefix apps/desktop install', { stdio: 'inherit', cwd: rootDir });
}

// 2. Protect against macOS iCloud FileProvider detritus
if (process.platform === 'darwin') {
  const home = os.homedir();
  const inCloudSyncedDir =
    rootDir.startsWith(path.join(home, 'Documents')) ||
    rootDir.startsWith(path.join(home, 'Desktop')) ||
    rootDir.includes('com~apple~CloudDocs');

  if (inCloudSyncedDir) {
    const releasePath = path.join(desktopDir, 'release');
    const cacheReleaseDir = path.join(home, '.cache', 'cardmirror-release');
    fs.mkdirSync(cacheReleaseDir, { recursive: true });

    let isLink = false;
    try {
      isLink = fs.lstatSync(releasePath).isSymbolicLink();
    } catch {
      // does not exist yet
    }

    if (!isLink) {
      try {
        if (fs.existsSync(releasePath)) {
          fs.rmSync(releasePath, { recursive: true, force: true });
        }
        fs.symlinkSync(cacheReleaseDir, releasePath);
      } catch (err) {
        console.warn(`Notice: Could not symlink desktop release dir: ${err.message}`);
      }
    }
  }
}

