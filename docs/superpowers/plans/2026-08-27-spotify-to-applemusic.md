# Spotify → Apple Music Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A share-sheet Shortcut that turns any Spotify link a friend sends into the same song opened in Apple Music on iPhone.

**Architecture:** Four small modules — pure URL parsing, pure storefront rewriting, one I/O module wrapping the matching API, and a thin orchestrator returning a tagged union. The matching API is isolated behind `src/odesli.js` so it can be swapped without touching parsing, rewriting, or orchestration. The JS is the tested reference implementation; the Shortcut is a hand-built transcription of behavior proven here.

**Tech Stack:** Node 20+ (built-in `fetch` and `node:test`), zero runtime dependencies, iOS Shortcuts.

## Global Constraints

- **Node >= 20.0.0** — required for built-in `fetch` and the `node:test` runner.
- **Zero runtime dependencies.** Dev dependencies also forbidden; `node:test` covers testing.
- **ES modules.** `"type": "module"` in package.json. Use `import`, never `require`.
- **Storefront is `ch`** (Switzerland). API country param is uppercase `CH`; URL path segment is lowercase `ch`.
- **Odesli endpoint:** `https://api.song.link/v1-alpha.1/links`
- **No network in tests.** Every test except the opt-in live smoke test uses fixtures or an injected fake `fetch`. Tests must pass with networking disabled.
- **Never throw across the public boundary.** `resolveToAppleMusic` returns a `Result`; it does not reject for expected failures.

---

### Task 1: Scaffold + verify the Odesli contract

Establishes the project and answers the one unresolved question: whether unauthenticated Odesli access still works. A `WebFetch` probe during planning returned **HTTP 401**, which may mean the proxy was blocked or may mean the API now requires a key. This task settles it.

**This task requires a machine with internet access.** Tasks 2 and 3 are pure and can proceed in parallel if this is blocked.

**Files:**
- Create: `package.json`
- Create: `test/fixtures/` (populated by this task)
- Create: `scripts/record-fixtures.sh`

**Interfaces:**
- Consumes: nothing
- Produces: fixture files `test/fixtures/{track,album,artist,playlist,episode}.json`, consumed by Tasks 4 and 5.

- [ ] **Step 1: Create package.json**

```json
{
  "name": "spotify-to-applemusic",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20.0.0" },
  "scripts": {
    "test": "node --test",
    "smoke": "ODESLI_LIVE=1 node --test test/live.smoke.test.js"
  }
}
```

- [ ] **Step 2: Probe the API by hand**

Run:

```bash
curl -s -w '\nHTTP:%{http_code}\n' \
  'https://api.song.link/v1-alpha.1/links?url=https%3A%2F%2Fopen.spotify.com%2Ftrack%2F11dFghVXANMlKmJXsNCbNl&userCountry=CH' \
  | tail -5
```

Expected: `HTTP:200` and a JSON body containing `linksByPlatform`.

**Branch on the result — this decision shapes Task 4:**

| Result | Action |
|---|---|
| `HTTP:200` | Proceed as planned. No API key needed. |
| `HTTP:401` or `403` | Request a free API key at <https://odesli.co/#contact>. Add `key` to the `lookup()` options in Task 4 and read it from `process.env.ODESLI_KEY`. The Shortcut then needs the key embedded in its URL — note this in Task 7. |
| `HTTP:429` | You are rate-limited. Wait 60s and retry. Not a contract failure. |
| Persistent failure | **Stop and report.** Do not invent a fallback. The alternative (scraping `og:` tags from open.spotify.com, then opening an Apple Music search) is a different design and needs the spec revisited. |

- [ ] **Step 3: Record fixtures**

Create `scripts/record-fixtures.sh`:

```bash
#!/usr/bin/env bash
# Records real Odesli responses as test fixtures.
# Re-run when Odesli's response shape is suspected to have drifted.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p test/fixtures
API="https://api.song.link/v1-alpha.1/links"

record() {
  local name="$1" spotify_url="$2"
  echo "recording ${name}..."
  curl -sf -G "$API" \
    --data-urlencode "url=${spotify_url}" \
    --data-urlencode "userCountry=CH" \
    -o "test/fixtures/${name}.json"
  sleep 7   # Odesli allows ~10 req/min unauthenticated
}

record track    "https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl"
record album     "https://open.spotify.com/album/0JGOiO34nwfUdDrD612dOp"
record artist    "https://open.spotify.com/artist/6sFIWsNpZYqfjUpaCgueju"
record playlist  "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"
record episode   "https://open.spotify.com/episode/512ojhOuo1ktJprKbVcKyQ"

echo "done. recorded:"
ls -1 test/fixtures/
```

Run:

```bash
chmod +x scripts/record-fixtures.sh && ./scripts/record-fixtures.sh
```

Expected: five JSON files in `test/fixtures/`. Any individual `record` may fail if that Spotify ID has been withdrawn — substitute any live URL of the same type and note the swap in the commit message.

- [ ] **Step 4: Confirm the assumptions the plan depends on**

Run:

```bash
node -e '
const d = JSON.parse(require("fs").readFileSync("test/fixtures/track.json","utf8"));
const e = d.entitiesByUniqueId[d.entityUniqueId];
console.log("userCountry:", d.userCountry);
console.log("has appleMusic:", !!d.linksByPlatform.appleMusic);
console.log("appleMusic.url:", d.linksByPlatform.appleMusic?.url);
console.log("title:", e?.title, "| artistName:", e?.artistName);
'
```

Expected: `userCountry: CH`, `has appleMusic: true`, a `music.apple.com` URL, and non-empty title/artist.

If `entitiesByUniqueId` or `artistName` are absent, the field names in Tasks 4–5 are wrong — fix them there before writing those tasks' tests.

- [ ] **Step 5: Check the playlist fixture proves the fallback path**

Run:

```bash
node -e '
const d = JSON.parse(require("fs").readFileSync("test/fixtures/playlist.json","utf8"));
console.log("playlist has appleMusic:", !!d.linksByPlatform?.appleMusic);
'
```

Expected: `false`. This fixture is what exercises the search fallback in Task 5.

If it prints `true`, Odesli matched the playlist and this fixture cannot test the fallback — find a Spotify link with no Apple Music equivalent (a Spotify-exclusive podcast works) and re-record it as `playlist.json`.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/record-fixtures.sh test/fixtures/
git commit -m "chore: scaffold project and record Odesli fixtures"
```

---

### Task 2: URL extraction and normalization

Pure functions, no I/O. **Needs no network** — implementable even if Task 1 is blocked.

**Files:**
- Create: `src/extract.js`
- Test: `test/extract.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `extractSpotifyUrl(text: string): string | null`
  - `normalizeSpotifyUrl(url: string): { url: string, kind: string, id: string } | null`
  - `kind` is one of `track | album | artist | playlist | episode | show | short`

- [ ] **Step 1: Write the failing tests**

Create `test/extract.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSpotifyUrl, normalizeSpotifyUrl } from '../src/extract.js';

test('extracts a bare track URL', () => {
  assert.equal(
    extractSpotifyUrl('https://open.spotify.com/track/abc123'),
    'https://open.spotify.com/track/abc123'
  );
});

test('extracts a URL embedded in prose', () => {
  assert.equal(
    extractSpotifyUrl('omg listen to this https://open.spotify.com/track/abc123 so good'),
    'https://open.spotify.com/track/abc123'
  );
});

test('strips trailing sentence punctuation', () => {
  assert.equal(
    extractSpotifyUrl('this one https://open.spotify.com/track/abc123.'),
    'https://open.spotify.com/track/abc123'
  );
});

test('converts a spotify: URI to https form', () => {
  assert.equal(
    extractSpotifyUrl('spotify:track:abc123'),
    'https://open.spotify.com/track/abc123'
  );
});

test('extracts a spotify.link short URL', () => {
  assert.equal(
    extractSpotifyUrl('check https://spotify.link/xYz9'),
    'https://spotify.link/xYz9'
  );
});

test('returns null when there is no Spotify link', () => {
  assert.equal(extractSpotifyUrl('just a normal message'), null);
  assert.equal(extractSpotifyUrl('https://music.apple.com/ch/album/123'), null);
});

test('returns null for non-string input', () => {
  assert.equal(extractSpotifyUrl(undefined), null);
  assert.equal(extractSpotifyUrl(null), null);
});

test('normalizes a plain track URL', () => {
  assert.deepEqual(
    normalizeSpotifyUrl('https://open.spotify.com/track/abc123'),
    { url: 'https://open.spotify.com/track/abc123', kind: 'track', id: 'abc123' }
  );
});

test('strips the intl- locale segment', () => {
  assert.deepEqual(
    normalizeSpotifyUrl('https://open.spotify.com/intl-de/track/abc123'),
    { url: 'https://open.spotify.com/track/abc123', kind: 'track', id: 'abc123' }
  );
});

test('strips si and context tracking params', () => {
  assert.deepEqual(
    normalizeSpotifyUrl('https://open.spotify.com/track/abc123?si=deadbeef&context=xyz'),
    { url: 'https://open.spotify.com/track/abc123', kind: 'track', id: 'abc123' }
  );
});

test('recognises albums and artists', () => {
  assert.equal(normalizeSpotifyUrl('https://open.spotify.com/album/a1').kind, 'album');
  assert.equal(normalizeSpotifyUrl('https://open.spotify.com/artist/a1').kind, 'artist');
});

test('marks spotify.link URLs as kind short', () => {
  assert.deepEqual(
    normalizeSpotifyUrl('https://spotify.link/xYz9'),
    { url: 'https://spotify.link/xYz9', kind: 'short', id: 'xYz9' }
  );
});

test('returns null for unknown paths and hosts', () => {
  assert.equal(normalizeSpotifyUrl('https://open.spotify.com/wat/abc123'), null);
  assert.equal(normalizeSpotifyUrl('https://example.com/track/abc123'), null);
  assert.equal(normalizeSpotifyUrl('not a url'), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/extract.test.js`
Expected: FAIL — `Cannot find module '../src/extract.js'`

- [ ] **Step 3: Write the implementation**

Create `src/extract.js`:

```js
const SPOTIFY_URL_RE = /https?:\/\/(?:open\.spotify\.com|spotify\.link)\/[^\s<>"')\]]+/i;
const SPOTIFY_URI_RE = /spotify:(track|album|artist|playlist|episode|show):([A-Za-z0-9]+)/i;
const LOCALE_SEGMENT_RE = /^intl-[a-z]{2}$/i;

const KINDS = new Set(['track', 'album', 'artist', 'playlist', 'episode', 'show']);

/**
 * Pulls the first Spotify link out of arbitrary shared text.
 * Share sheets routinely hand over a whole sentence, not a bare URL.
 */
export function extractSpotifyUrl(text) {
  if (typeof text !== 'string') return null;

  const uri = text.match(SPOTIFY_URI_RE);
  if (uri) return `https://open.spotify.com/${uri[1].toLowerCase()}/${uri[2]}`;

  const url = text.match(SPOTIFY_URL_RE);
  if (url) return url[0].replace(/[.,!?;:]+$/, '');

  return null;
}

/**
 * Canonicalises a Spotify URL: drops locale segments and tracking params.
 * Returns null for anything that is not a recognisable Spotify entity.
 */
export function normalizeSpotifyUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();

  if (host === 'spotify.link') {
    const id = parsed.pathname.replace(/^\//, '');
    if (!id) return null;
    return { url: `https://spotify.link/${id}`, kind: 'short', id };
  }

  if (host !== 'open.spotify.com') return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length && LOCALE_SEGMENT_RE.test(segments[0])) segments.shift();

  const [kind, id] = segments;
  if (!KINDS.has(kind) || !id) return null;

  return { url: `https://open.spotify.com/${kind}/${id}`, kind, id };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/extract.test.js`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/extract.js test/extract.test.js
git commit -m "feat: extract and normalize Spotify URLs"
```

---

### Task 3: Storefront rewriting

Pure function, no I/O. **Needs no network.**

Odesli may return an Apple Music URL for any country. Forcing the path to `/ch/` keeps links inside the user's storefront.

**Files:**
- Create: `src/storefront.js`
- Test: `test/storefront.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `forceStorefront(url: string, country: string): string | null`

- [ ] **Step 1: Write the failing tests**

Create `test/storefront.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { forceStorefront } from '../src/storefront.js';

test('replaces an existing storefront segment', () => {
  assert.equal(
    forceStorefront('https://music.apple.com/us/album/blonde/1146195596', 'CH'),
    'https://music.apple.com/ch/album/blonde/1146195596'
  );
});

test('inserts a storefront when none is present', () => {
  assert.equal(
    forceStorefront('https://music.apple.com/album/blonde/1146195596', 'CH'),
    'https://music.apple.com/ch/album/blonde/1146195596'
  );
});

test('leaves a URL already on the target storefront unchanged', () => {
  assert.equal(
    forceStorefront('https://music.apple.com/ch/album/blonde/1146195596', 'CH'),
    'https://music.apple.com/ch/album/blonde/1146195596'
  );
});

test('preserves query strings such as the track selector', () => {
  assert.equal(
    forceStorefront('https://music.apple.com/us/album/blonde/1146195596?i=1146195597', 'CH'),
    'https://music.apple.com/ch/album/blonde/1146195596?i=1146195597'
  );
});

test('accepts lowercase country codes', () => {
  assert.equal(
    forceStorefront('https://music.apple.com/us/album/x/1', 'ch'),
    'https://music.apple.com/ch/album/x/1'
  );
});

test('returns null for non-Apple-Music hosts', () => {
  assert.equal(forceStorefront('https://open.spotify.com/track/abc', 'CH'), null);
  assert.equal(forceStorefront('not a url', 'CH'), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/storefront.test.js`
Expected: FAIL — `Cannot find module '../src/storefront.js'`

- [ ] **Step 3: Write the implementation**

Create `src/storefront.js`:

```js
const STOREFRONT_SEGMENT_RE = /^\/([a-z]{2})(\/|$)/i;

/**
 * Forces an Apple Music URL onto a given storefront.
 * Odesli returns links for whichever country it chose; the Apple Music app
 * can refuse content addressed to a storefront the account is not in.
 */
export function forceStorefront(rawUrl, country) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.hostname.toLowerCase() !== 'music.apple.com') return null;

  const code = String(country).toLowerCase();
  parsed.pathname = STOREFRONT_SEGMENT_RE.test(parsed.pathname)
    ? parsed.pathname.replace(STOREFRONT_SEGMENT_RE, `/${code}$2`)
    : `/${code}${parsed.pathname}`;

  return parsed.toString();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/storefront.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/storefront.js test/storefront.test.js
git commit -m "feat: force Apple Music links onto the CH storefront"
```

---

### Task 4: Odesli client

The only module that performs I/O. Isolated so the matching backend can be replaced without touching anything else.

**Files:**
- Create: `src/odesli.js`
- Test: `test/odesli.test.js`

**Interfaces:**
- Consumes: fixtures from Task 1
- Produces:
  - `lookup(spotifyUrl, { country, key, fetchImpl }): Promise<object>`
  - `expandShortLink(shortUrl, { fetchImpl }): Promise<string>`
  - `class OdesliError extends Error` with a `.kind` of `network | rate_limited | auth | http | parse`

- [ ] **Step 1: Write the failing tests**

Create `test/odesli.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lookup, expandShortLink, OdesliError } from '../src/odesli.js';

const trackFixture = JSON.parse(
  readFileSync(new URL('./fixtures/track.json', import.meta.url), 'utf8')
);

/** Builds a fake fetch that records the URL it was called with. */
function fakeFetch({ status = 200, body = trackFixture, throws = false } = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    if (throws) throw new Error('ECONNREFUSED');
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (body === 'INVALID') throw new SyntaxError('Unexpected token');
        return body;
      }
    };
  };
  impl.calls = calls;
  return impl;
}

test('requests the endpoint with url and userCountry', async () => {
  const impl = fakeFetch();
  await lookup('https://open.spotify.com/track/abc', { country: 'CH', fetchImpl: impl });

  const called = new URL(impl.calls[0]);
  assert.equal(called.origin + called.pathname, 'https://api.song.link/v1-alpha.1/links');
  assert.equal(called.searchParams.get('url'), 'https://open.spotify.com/track/abc');
  assert.equal(called.searchParams.get('userCountry'), 'CH');
  assert.equal(called.searchParams.get('key'), null);
});

test('includes an API key when one is supplied', async () => {
  const impl = fakeFetch();
  await lookup('https://open.spotify.com/track/abc', { fetchImpl: impl, key: 'secret' });
  assert.equal(new URL(impl.calls[0]).searchParams.get('key'), 'secret');
});

test('defaults the country to CH', async () => {
  const impl = fakeFetch();
  await lookup('https://open.spotify.com/track/abc', { fetchImpl: impl });
  assert.equal(new URL(impl.calls[0]).searchParams.get('userCountry'), 'CH');
});

test('returns the parsed body on success', async () => {
  const result = await lookup('https://open.spotify.com/track/abc', { fetchImpl: fakeFetch() });
  assert.ok(result.linksByPlatform);
});

test('maps 429 to a rate_limited error', async () => {
  await assert.rejects(
    () => lookup('https://open.spotify.com/track/abc', { fetchImpl: fakeFetch({ status: 429 }) }),
    (err) => err instanceof OdesliError && err.kind === 'rate_limited'
  );
});

test('maps 401 and 403 to an auth error', async () => {
  for (const status of [401, 403]) {
    await assert.rejects(
      () => lookup('https://open.spotify.com/track/abc', { fetchImpl: fakeFetch({ status }) }),
      (err) => err instanceof OdesliError && err.kind === 'auth'
    );
  }
});

test('maps other non-2xx responses to an http error', async () => {
  await assert.rejects(
    () => lookup('https://open.spotify.com/track/abc', { fetchImpl: fakeFetch({ status: 500 }) }),
    (err) => err instanceof OdesliError && err.kind === 'http'
  );
});

test('maps a transport failure to a network error', async () => {
  await assert.rejects(
    () => lookup('https://open.spotify.com/track/abc', { fetchImpl: fakeFetch({ throws: true }) }),
    (err) => err instanceof OdesliError && err.kind === 'network'
  );
});

test('maps unparseable JSON to a parse error', async () => {
  await assert.rejects(
    () => lookup('https://open.spotify.com/track/abc', { fetchImpl: fakeFetch({ body: 'INVALID' }) }),
    (err) => err instanceof OdesliError && err.kind === 'parse'
  );
});

test('expands a short link to the URL it redirects to', async () => {
  const impl = async () => ({
    ok: true,
    status: 200,
    url: 'https://open.spotify.com/track/abc123',
    json: async () => ({})
  });

  assert.equal(
    await expandShortLink('https://spotify.link/xYz9', { fetchImpl: impl }),
    'https://open.spotify.com/track/abc123'
  );
});

test('maps a short link that does not resolve to an http error', async () => {
  const impl = async () => ({ ok: true, status: 200, url: '', json: async () => ({}) });

  await assert.rejects(
    () => expandShortLink('https://spotify.link/xYz9', { fetchImpl: impl }),
    (err) => err instanceof OdesliError && err.kind === 'http'
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/odesli.test.js`
Expected: FAIL — `Cannot find module '../src/odesli.js'`

- [ ] **Step 3: Write the implementation**

Create `src/odesli.js`:

```js
const ENDPOINT = 'https://api.song.link/v1-alpha.1/links';

/** A failure talking to the matching service. `kind` drives the user-facing message. */
export class OdesliError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'OdesliError';
    this.kind = kind;
  }
}

/**
 * Asks Odesli which Apple Music content corresponds to a Spotify URL.
 * Returns the raw response body; interpreting it is resolve.js's job.
 */
export async function lookup(spotifyUrl, { country = 'CH', key, fetchImpl = globalThis.fetch } = {}) {
  const params = new URLSearchParams({ url: spotifyUrl, userCountry: country });
  if (key) params.set('key', key);

  let response;
  try {
    response = await fetchImpl(`${ENDPOINT}?${params}`, {
      headers: { accept: 'application/json' }
    });
  } catch {
    throw new OdesliError('network', 'Could not reach the matching service.');
  }

  if (response.status === 429) {
    throw new OdesliError('rate_limited', 'Too many lookups. Try again in a minute.');
  }
  if (response.status === 401 || response.status === 403) {
    throw new OdesliError('auth', 'The matching service rejected the request.');
  }
  if (!response.ok) {
    throw new OdesliError('http', `The matching service returned ${response.status}.`);
  }

  try {
    return await response.json();
  } catch {
    throw new OdesliError('parse', 'The matching service returned invalid data.');
  }
}

/**
 * Expands a spotify.link short URL into its canonical open.spotify.com form
 * by following the redirect and reading the final URL.
 */
export async function expandShortLink(shortUrl, { fetchImpl = globalThis.fetch } = {}) {
  let response;
  try {
    response = await fetchImpl(shortUrl, { redirect: 'follow' });
  } catch {
    throw new OdesliError('network', 'Could not expand the short link.');
  }

  if (!response.url) {
    throw new OdesliError('http', 'The short link did not resolve.');
  }

  return response.url;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/odesli.test.js`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/odesli.js test/odesli.test.js
git commit -m "feat: add Odesli client with typed error mapping"
```

---

### Task 5: Resolution orchestrator

Ties the pieces together and produces the tagged union the Shortcut mirrors.

**Files:**
- Create: `src/resolve.js`
- Test: `test/resolve.test.js`

**Interfaces:**
- Consumes: `extractSpotifyUrl`, `normalizeSpotifyUrl` (Task 2); `forceStorefront` (Task 3); `lookup`, `expandShortLink`, `OdesliError` (Task 4)
- Produces: `resolveToAppleMusic(input, opts): Promise<Result>` where `Result` is one of:
  - `{ status: 'match',  url, kind, title, artist }`
  - `{ status: 'search', url, term, title, artist }`
  - `{ status: 'none',   reason, message? }`

- [ ] **Step 1: Write the failing tests**

Create `test/resolve.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveToAppleMusic } from '../src/resolve.js';

const load = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

const fakeFetch = (body, status = 200) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body
});

test('returns a match for a track, forced onto the CH storefront', async () => {
  const result = await resolveToAppleMusic(
    'https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl',
    { fetchImpl: fakeFetch(load('track')) }
  );

  assert.equal(result.status, 'match');
  assert.equal(result.kind, 'track');
  assert.match(result.url, /^https:\/\/music\.apple\.com\/ch\//);
  assert.ok(result.title);
  assert.ok(result.artist);
});

test('accepts a URL wrapped in prose', async () => {
  const result = await resolveToAppleMusic(
    'you have to hear this https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl !!',
    { fetchImpl: fakeFetch(load('track')) }
  );
  assert.equal(result.status, 'match');
});

test('falls back to search when there is no Apple Music link', async () => {
  const result = await resolveToAppleMusic(
    'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
    { fetchImpl: fakeFetch(load('playlist')) }
  );

  assert.equal(result.status, 'search');
  assert.match(result.url, /^https:\/\/music\.apple\.com\/ch\/search\?term=/);
  assert.ok(result.term.length > 0);
});

test('expands a spotify.link short URL before looking it up', async () => {
  const calls = [];
  const impl = async (url) => {
    const href = String(url);
    calls.push(href);
    if (href.startsWith('https://spotify.link/')) {
      return {
        ok: true,
        status: 200,
        url: 'https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl',
        json: async () => ({})
      };
    }
    return { ok: true, status: 200, url: href, json: async () => load('track') };
  };

  const result = await resolveToAppleMusic('https://spotify.link/xYz9', { fetchImpl: impl });

  assert.equal(result.status, 'match');
  assert.ok(calls.some((href) => href.includes('api.song.link')), 'never reached the matching API');
});

test('reports not_spotify for input containing no Spotify link', async () => {
  const result = await resolveToAppleMusic('hello there', {
    fetchImpl: () => assert.fail('should not perform a lookup')
  });
  assert.deepEqual(result, { status: 'none', reason: 'not_spotify' });
});

test('surfaces rate limiting as a none result, not a throw', async () => {
  const result = await resolveToAppleMusic(
    'https://open.spotify.com/track/abc',
    { fetchImpl: fakeFetch({}, 429) }
  );
  assert.equal(result.status, 'none');
  assert.equal(result.reason, 'rate_limited');
  assert.ok(result.message);
});

test('surfaces auth failure as a none result', async () => {
  const result = await resolveToAppleMusic(
    'https://open.spotify.com/track/abc',
    { fetchImpl: fakeFetch({}, 401) }
  );
  assert.equal(result.status, 'none');
  assert.equal(result.reason, 'auth');
});

test('reports no_match when the response has neither link nor title', async () => {
  const result = await resolveToAppleMusic(
    'https://open.spotify.com/track/abc',
    { fetchImpl: fakeFetch({ entityUniqueId: 'x', entitiesByUniqueId: {}, linksByPlatform: {} }) }
  );
  assert.deepEqual(result, { status: 'none', reason: 'no_match' });
});

test('honours a non-default country', async () => {
  const result = await resolveToAppleMusic(
    'https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl',
    { country: 'DE', fetchImpl: fakeFetch(load('track')) }
  );
  assert.match(result.url, /^https:\/\/music\.apple\.com\/de\//);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/resolve.test.js`
Expected: FAIL — `Cannot find module '../src/resolve.js'`

- [ ] **Step 3: Write the implementation**

Create `src/resolve.js`:

```js
import { extractSpotifyUrl, normalizeSpotifyUrl } from './extract.js';
import { forceStorefront } from './storefront.js';
import { lookup, expandShortLink, OdesliError } from './odesli.js';

/**
 * Turns shared text containing a Spotify link into an Apple Music destination.
 * Never throws for expected failures — callers switch on `status`.
 */
export async function resolveToAppleMusic(input, options = {}) {
  const country = options.country ?? 'CH';

  const raw = extractSpotifyUrl(input);
  if (!raw) return { status: 'none', reason: 'not_spotify' };

  let normalized = normalizeSpotifyUrl(raw);
  if (!normalized) return { status: 'none', reason: 'not_spotify' };

  // spotify.link short URLs carry no entity id, so they must be expanded first.
  if (normalized.kind === 'short') {
    try {
      normalized = normalizeSpotifyUrl(await expandShortLink(normalized.url, options));
    } catch (error) {
      if (error instanceof OdesliError) {
        return { status: 'none', reason: error.kind, message: error.message };
      }
      throw error;
    }
    if (!normalized || normalized.kind === 'short') {
      return { status: 'none', reason: 'not_spotify' };
    }
  }

  let data;
  try {
    data = await lookup(normalized.url, { ...options, country });
  } catch (error) {
    if (error instanceof OdesliError) {
      return { status: 'none', reason: error.kind, message: error.message };
    }
    throw error;
  }

  const entity = data?.entitiesByUniqueId?.[data?.entityUniqueId] ?? {};
  const title = entity.title ?? null;
  const artist = entity.artistName ?? null;

  const appleMusicUrl = data?.linksByPlatform?.appleMusic?.url;
  if (appleMusicUrl) {
    const url = forceStorefront(appleMusicUrl, country);
    if (url) return { status: 'match', url, kind: normalized.kind, title, artist };
  }

  if (title) {
    const term = [title, artist].filter(Boolean).join(' ');
    return {
      status: 'search',
      url: `https://music.apple.com/${country.toLowerCase()}/search?term=${encodeURIComponent(term)}`,
      term,
      title,
      artist
    };
  }

  return { status: 'none', reason: 'no_match' };
}
```

- [ ] **Step 4: Run the whole suite**

Run: `node --test`
Expected: PASS — all tests from Tasks 2, 3, 4, and 5.

- [ ] **Step 5: Commit**

```bash
git add src/resolve.js test/resolve.test.js
git commit -m "feat: resolve Spotify links to Apple Music destinations"
```

---

### Task 6: CLI for manual verification

Lets the algorithm be exercised against real links from a desktop before any tapping happens on the phone.

**Files:**
- Create: `src/cli.js`
- Modify: `package.json` (add the `resolve` script)

**Interfaces:**
- Consumes: `resolveToAppleMusic` (Task 5)
- Produces: `node src/cli.js "<text containing a spotify link>"`, printing the resolved URL to stdout. Exit code 0 on `match` or `search`, 1 on `none`.

- [ ] **Step 1: Write the implementation**

Create `src/cli.js`:

```js
#!/usr/bin/env node
import { resolveToAppleMusic } from './resolve.js';

const input = process.argv.slice(2).join(' ');

if (!input) {
  console.error('usage: node src/cli.js "<text containing a Spotify link>"');
  process.exit(2);
}

const result = await resolveToAppleMusic(input, {
  country: process.env.STOREFRONT ?? 'CH',
  key: process.env.ODESLI_KEY
});

if (result.status === 'none') {
  console.error(`no match (${result.reason})${result.message ? ': ' + result.message : ''}`);
  process.exit(1);
}

console.error(`${result.status}: ${result.title ?? '?'} — ${result.artist ?? '?'}`);
console.log(result.url);
```

The human-readable line goes to stderr and the bare URL to stdout, so the output can be piped straight into `open`.

- [ ] **Step 2: Add the script to package.json**

Add to the `scripts` block:

```json
"resolve": "node src/cli.js"
```

- [ ] **Step 3: Verify against a real link**

Run:

```bash
node src/cli.js "https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl"
```

Expected: a `match: <title> — <artist>` line on stderr and a `https://music.apple.com/ch/...` URL on stdout.

Then confirm it opens the right thing:

```bash
open "$(node src/cli.js 'https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl')"
```

Expected: Apple Music opens the correct song.

- [ ] **Step 4: Verify the failure path**

Run:

```bash
node src/cli.js "no link here"; echo "exit=$?"
```

Expected: `no match (not_spotify)` on stderr and `exit=1`.

- [ ] **Step 5: Commit**

```bash
git add src/cli.js package.json
git commit -m "feat: add CLI for verifying resolution against real links"
```

---

### Task 7: Build the Shortcut

The actual deliverable. **Deviation from the spec, deliberate:** the spec proposed generating a `.shortcut` plist first with manual steps as fallback. This plan inverts that — manual build first, because it is guaranteed to work, and the plist format is undocumented enough that a generator could burn hours before producing anything usable. Task 8 covers generation as an optional convenience once a known-good Shortcut exists to compare against.

**Files:**
- Create: `shortcut/BUILD.md`

**Interfaces:**
- Consumes: the verified algorithm and exact URL formats from Tasks 2–5
- Produces: a Shortcut named **Open in Apple Music**, present in the iOS share sheet

- [ ] **Step 1: Write the build guide**

Create `shortcut/BUILD.md` documenting, action by action, the Shortcut below. Build it in the Shortcuts app on the iPhone (or on the Mac and let iCloud sync it).

**Shortcut settings**
- Name: `Open in Apple Music`
- Details → **Show in Share Sheet**: ON
- Accepted input types: **URLs** and **Text** only (uncheck the rest)

**Actions**

1. **Receive** `URLs` and `Text` input from `Share Sheet`
2. **Text** — set to exactly:
   `https://api.song.link/v1-alpha.1/links?url=[Shortcut Input]&userCountry=CH`
   Insert `Shortcut Input` as a variable token, not literal text.
   *If Task 1 determined an API key is required, append `&key=YOUR_KEY`.*
3. **URL Encode** the `Shortcut Input` variable before it lands in that string. In Shortcuts this is the `Text` action's variable options — tap the token, choose **URL Encode**. Without this, `?si=` params truncate the request.
4. **Get Contents of URL** — Method `GET`, input the `Text` from step 2
5. **Get Dictionary Value** — Get `Value` for key `linksByPlatform.appleMusic.url` from `Contents of URL`
6. **If** `Dictionary Value` `has any value`:
   - **Replace Text** — Find `music\.apple\.com/[a-z]{2}/` (Regular Expression ON), Replace with `music.apple.com/ch/`, input `Dictionary Value`
   - **Open URLs** — the `Updated Text`
7. **Otherwise**:
   - **Get Dictionary Value** — Get `Value` for key `entityUniqueId` from `Contents of URL`
   - **Get Dictionary Value** — Get `Value` for key `entitiesByUniqueId` from `Contents of URL`
   - **Get Dictionary Value** — Get `Value` for the key matching the `entityUniqueId` variable, from the previous dictionary
   - **Get Dictionary Value** — Get `Value` for key `title`
   - **Get Dictionary Value** — Get `Value` for key `artistName`
   - **If** `title` `has any value`:
     - **Text**: `https://music.apple.com/ch/search?term=[title] [artistName]` (URL Encode the two tokens)
     - **Open URLs** — that Text
   - **Otherwise**:
     - **Show Notification** — `Not on Apple Music`
8. **End If**

**Known gap: `spotify.link` short links.** `src/resolve.js` expands these by
following the redirect, but Shortcuts' `Get Contents of URL` does not expose
the final URL, so the Shortcut cannot do the same. Short links will therefore
reach step 5 unresolved and most likely fall through to the notification.

Accept this for now. Most links shared from the Spotify iOS app are full
`open.spotify.com` URLs; `spotify.link` mainly appears in links copied from
the Android app. If it turns out to bite in practice, the workaround is an
extra `Get Contents of URL` against the short link followed by a
`Match Text` action pulling the canonical URL out of the returned HTML's
`og:url` meta tag — roughly four extra actions.

- [ ] **Step 2: Verify the match path on the phone**

In Messages or Notes, long-press a Spotify **track** link → Share → **Open in Apple Music**.

Expected: the Apple Music app opens the correct song.

If Safari opens instead of the app, the URL lost its `/ch/` storefront or is malformed — check the Replace Text regex in step 6.

- [ ] **Step 3: Verify the search fallback**

Share a Spotify **playlist** link into the Shortcut.

Expected: Apple Music opens on a search results screen. The results will likely be poor — that is the documented, inherent limitation, not a bug.

- [ ] **Step 4: Verify the failure path**

Share plain text with no link (or a broken Spotify URL) into the Shortcut.

Expected: a `Not on Apple Music` notification, and nothing opens.

- [ ] **Step 5: Commit**

```bash
git add shortcut/BUILD.md
git commit -m "docs: add step-by-step Shortcut build guide"
```

---

### Task 8 (optional): Generate an importable .shortcut file

Convenience only. Skip if the hand-built Shortcut from Task 7 is working — it delivers nothing new, it just makes the Shortcut reinstallable and reviewable in git.

Attempt this **only after** Task 7 produced a working Shortcut, so there is a known-good reference to compare against.

**Files:**
- Create: `scripts/build-shortcut.js`
- Create: `shortcut/OpenInAppleMusic.shortcut` (generated)

**Interfaces:**
- Consumes: the action list from Task 7
- Produces: an unsigned plist importable on iOS

- [ ] **Step 1: Export the working Shortcut as a reference**

On the iPhone: Shortcuts → **Open in Apple Music** → Share → **Export File**. AirDrop it to the Mac and save it as `shortcut/reference.shortcut`.

- [ ] **Step 2: Inspect the real format**

Run:

```bash
plutil -convert xml1 -o - shortcut/reference.shortcut | head -60
```

Expected: XML with a `WFWorkflowActions` array. This is the ground truth for the generator — do not write the generator against guessed field names.

- [ ] **Step 3: Write the generator**

Write `scripts/build-shortcut.js` to emit the same structure observed in step 2, then convert it:

```bash
node scripts/build-shortcut.js > shortcut/OpenInAppleMusic.plist
plutil -convert binary1 -o shortcut/OpenInAppleMusic.shortcut shortcut/OpenInAppleMusic.plist
```

Because the exact `WFWorkflowActions` schema is only knowable from step 2's output, the generator's contents cannot be specified in advance here. Mirror the reference file's structure exactly, changing only what must differ.

- [ ] **Step 4: Verify import**

Enable Settings → Shortcuts → **Allow Untrusted Shortcuts** on the iPhone (this toggle only appears after at least one Shortcut has been run on the device). AirDrop `OpenInAppleMusic.shortcut` over and open it.

Expected: Shortcuts offers to add it, and the added Shortcut behaves identically to the Task 7 build.

**If the file fails to import**, stop and delete the generator. The hand-built Shortcut is the deliverable; this task is not worth extended debugging.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-shortcut.js shortcut/OpenInAppleMusic.shortcut
git commit -m "feat: generate importable .shortcut file"
```

---

### Task 9: Live smoke test

Guards against Odesli silently changing its response shape, which every fixture-based test would happily keep passing through.

**Files:**
- Create: `test/live.smoke.test.js`

**Interfaces:**
- Consumes: `resolveToAppleMusic` (Task 5)
- Produces: an opt-in test, skipped unless `ODESLI_LIVE=1`

- [ ] **Step 1: Write the test**

Create `test/live.smoke.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveToAppleMusic } from '../src/resolve.js';

const live = process.env.ODESLI_LIVE === '1';

test('resolves a known-stable track against the real API', { skip: !live }, async () => {
  const result = await resolveToAppleMusic(
    'https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl',
    { key: process.env.ODESLI_KEY }
  );

  assert.equal(result.status, 'match', `expected a match, got ${result.status} (${result.reason ?? ''})`);
  assert.match(result.url, /^https:\/\/music\.apple\.com\/ch\//);
  assert.ok(result.title, 'response carried no title — the entity shape may have changed');
  assert.ok(result.artist, 'response carried no artistName — the entity shape may have changed');
});
```

- [ ] **Step 2: Confirm it skips by default**

Run: `node --test`
Expected: the smoke test reports as skipped; no network is touched.

- [ ] **Step 3: Run it for real**

Run: `npm run smoke`
Expected: PASS.

A failure here means Odesli changed. Re-run `./scripts/record-fixtures.sh` and re-check Tasks 4–5.

- [ ] **Step 4: Commit**

```bash
git add test/live.smoke.test.js
git commit -m "test: add opt-in live smoke test against Odesli"
```

---

## Done when

- `node --test` passes with networking disabled
- `npm run smoke` passes with networking enabled
- Sharing a Spotify track link from Messages opens the right song in Apple Music
- Sharing a playlist link opens an Apple Music search
- Sharing junk shows a notification and opens nothing
