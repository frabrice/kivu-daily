// After a new version of Kivu Daily is deployed, a tab that is already open
// still knows the OLD file names of its pages. Opening a page then asks for
// a file that no longer exists, and the browser shows "Failed to fetch
// dynamically imported module" or "'text/html' is not a valid JavaScript
// MIME type". Reloading fetches the new version - so we do it for people,
// once, instead of showing an error. A guard stops reload loops if the
// problem is something else.

const KEY = 'kivu-chunk-reload-at';
const PATTERNS = [
  'Failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'Importing a module script failed',
  'is not a valid JavaScript MIME type',
  'Unable to preload CSS',
  'Loading chunk',
  'ChunkLoadError',
];

export function isChunkError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err ?? '');
  return PATTERNS.some((p) => msg.includes(p));
}

// When we last reloaded for this, kept across the reload: sessionStorage,
// or the tab's window.name where storage is blocked (it used to reload on
// every error then - an endless loop when the problem wasn't a deploy).
function lastReload(): number {
  try { return Number(sessionStorage.getItem(KEY) ?? 0); } catch { /* blocked */ }
  const m = /kivu-chunk-reload:(\d+)/.exec(window.name);
  return m ? Number(m[1]) : 0;
}
function markReload() {
  try { sessionStorage.setItem(KEY, String(Date.now())); return; } catch { /* blocked */ }
  window.name = `kivu-chunk-reload:${Date.now()}`;
}

// Reloads the page unless we already did in the last 2 minutes. Returns
// true when a reload is under way; false means a reload didn't fix it, so
// the problem is something else and the page should say what failed.
export function reloadOnce(): boolean {
  if (Date.now() - lastReload() < 120_000) return false;
  markReload();
  window.location.reload();
  return true;
}

// Wraps a page import: a stale-file error reloads the app with the new version.
export function withChunkReload<T>(load: () => Promise<T>): () => Promise<T> {
  return () => load().catch((err) => {
    if (isChunkError(err) && reloadOnce()) return new Promise<T>(() => { /* the page is reloading */ });
    throw err;
  });
}

// Vite fires this when preloading a page's files fails.
export function listenForStaleChunks() {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadOnce()) event.preventDefault();
  });
}
