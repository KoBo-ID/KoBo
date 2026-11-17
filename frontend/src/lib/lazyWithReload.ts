import { lazy, type ComponentType } from 'react';

const KEY = 'kobo:chunk-reloaded';

/**
 * React.lazy that survives a deploy: a tab opened before a release requests
 * hashed chunks that no longer exist. On a dynamic-import failure, reload once
 * (guarded by sessionStorage so a genuinely broken chunk cannot loop).
 */
export function lazyWithReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      const mod = await factory();
      try { sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
      return mod;
    } catch (err) {
      let alreadyReloaded = true;
      try {
        alreadyReloaded = sessionStorage.getItem(KEY) === '1';
        if (!alreadyReloaded) sessionStorage.setItem(KEY, '1');
      } catch { /* storage unavailable: do not reload, avoids loops */ }
      if (!alreadyReloaded) {
        window.location.reload();
        // Keep Suspense pending while the page reloads.
        return new Promise<never>(() => {});
      }
      throw err;
    }
  });
}
