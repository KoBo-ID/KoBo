import { createAuthClient } from 'better-auth/client';

// Imported ONLY through `await import('../lib/authClient')` from the sign-in flow, so better-auth
// never lands in the initial chunk (spec section 10 bundle budget). Same-origin: /api/auth.
export const authClient = createAuthClient();
