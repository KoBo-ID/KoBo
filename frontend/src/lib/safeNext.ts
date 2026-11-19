import { safeNextPath } from '@kobo/shared/safe-next';

/** `?next=` target for this origin: a same-origin path, or `fallback` (G2-17). The only `next` parser in the app. */
export const safeNext = (raw: string | null | undefined, fallback = '/'): string => safeNextPath(raw, window.location.origin, fallback);
