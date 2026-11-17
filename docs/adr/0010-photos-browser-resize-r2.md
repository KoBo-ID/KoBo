# 0010. Browser-side image resize and presigned R2 uploads

**Context.** Server-side `sharp` adds a native dependency and RAM spikes for tens of uploads a month. R2 has no presigned POST, so there is no size policy at upload time.

**Decision.** The browser resizes to 800 and 1600 px WebP and uploads each with a presigned PUT that signs `Content-Type` and `Content-Length` and expires quickly; the server HEAD-checks type and size before writing the `KosImage` row. Storage is a port: an in-memory fake for tests and dev, plus one contract test against a real R2 test bucket on `main` and tags. R2 CORS must allow `PUT` from the app origin.

**Consequences.** No image processing on the server. Production refuses to start without R2 configuration unless `ALLOW_FAKE_STORAGE=1`. Seeded kos keep their external photo URLs.
