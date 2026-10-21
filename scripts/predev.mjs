// Runs automatically before `npm run dev` (see "predev" in package.json).
//
// Turbopack keeps a persistent cache in `.next/dev`. If that cache was written
// by a bad run (for example one that resolved CSS imports from the wrong
// folder), every later `npm run dev` replays the same failure:
//
//   Error: Can't resolve 'tailwindcss' in '<some parent folder>'
//
// Clearing it is cheap (routes simply compile again on first visit) and makes
// that failure impossible to carry over between restarts.
//
// Set KEEP_NEXT_CACHE=1 to skip the cleanup.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const devDir = path.join(webDir, ".next", "dev");

// A running `next dev` holds `.next/dev/lock` open exclusively (on Windows,
// opening it for writing then fails with EBUSY/EPERM). Never delete the cache
// out from under a live server.
function devServerRunning() {
  const lock = path.join(devDir, "lock");
  if (!fs.existsSync(lock)) return false;
  try {
    fs.closeSync(fs.openSync(lock, "r+"));
    return false;
  } catch (err) {
    return err.code === "EBUSY" || err.code === "EPERM" || err.code === "EACCES";
  }
}

if (process.env.KEEP_NEXT_CACHE === "1") {
  console.log("[predev] KEEP_NEXT_CACHE=1 - keeping .next/dev cache");
} else if (!fs.existsSync(devDir)) {
  // nothing cached yet
} else if (devServerRunning()) {
  console.log("[predev] a dev server is already running - leaving .next/dev alone");
} else {
  try {
    fs.rmSync(devDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    console.log("[predev] cleared stale .next/dev cache");
  } catch (err) {
    console.warn(`[predev] could not clear .next/dev (${err.code ?? err.message}); continuing`);
  }
}
