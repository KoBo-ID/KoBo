# 0001. One container, same origin

**Context.** The SPA needs first-party cookies for auth, and the team has one small VPS (about 1 GB used) and little ops time. Splitting the SPA onto a CDN needs `SameSite=None`, CORS, a Worker proxy and two pipelines, and risks version skew between SPA and API.

**Decision.** Hono serves the built SPA (with an `index.html` fallback) and `/api` from one Node 24 container behind a Cloudflare Tunnel. Hashed assets get `immutable` cache headers and `index.html` is `no-cache`, so the edge serves static files and the tunnel carries API traffic only.

**Consequences.** One deploy artifact and no API CORS. The only CORS left is browser to R2 for photo uploads. A tab opened before a deploy may request chunks that no longer exist, so lazy imports reload once on a chunk-load error. Static traffic shares the box with the API (acceptable at 0-100 users a month).
