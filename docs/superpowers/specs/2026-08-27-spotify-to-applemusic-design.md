# Spotify link → Apple Music, on iPhone

**Date:** 2026-08-27
**Status:** Approved design, not yet implemented

## Problem

Friends share Spotify links. The user is an Apple Music subscriber. Opening
those links means either listening in a Spotify free tier or manually
re-searching the song in Apple Music.

## Constraints (established during design)

These are load-bearing. Changing any of them invalidates parts of this design.

| Constraint | Value | Consequence |
|---|---|---|
| Apple Music storefront | Switzerland (`ch`) | All output URLs use `/ch/`; matching uses `userCountry=CH` |
| Apple Developer account | Free tier only | No Safari extension; no Apple Music API (needs a signed JWT) |
| Spotify app on device | User willing to delete | Irrelevant to the chosen design; kept as a note |
| Hosting | None wanted | No server, no serverless function, nothing to keep alive |

### Why not a Safari extension

A Safari Web Extension would be genuinely zero-tap, but on a free developer
account the containing app expires every 7 days and must be reinstalled from a
Mac over cable — forever. That maintenance cost exceeds the two taps it saves.

It also has a coverage gap independent of the account tier: extensions only run
in Safari. WhatsApp, Instagram, and Slack open links in their own in-app
browsers, where an extension never executes. Those are the apps friends
actually share from, so an extension would need the share-sheet path as a
fallback regardless.

Revisit only if the user moves to a paid account.

## Approach

A share-sheet Shortcut. Long-press a link → Share → "Open in Apple Music".

Roughly three taps, works from every app that has a share sheet (including
in-app browsers), never expires, and requires no Mac, no signing, and no
account.

### Matching engine: Odesli

`https://api.song.link/v1-alpha.1/links` — the public API behind song.link.
No API key, no auth, ~10 requests/minute unauthenticated. Personal-use volume
is far below that ceiling.

The official Apple Music API was ruled out: it requires a developer token
(JWT signed with a private key), which requires a paid account.

**Privacy note:** each lookup sends the Spotify URL to Odesli, a third party.
The URL is a public song link, not personal data, but it does leave the device.

## Architecture

Two artifacts, deliberately not sharing code at runtime:

```
src/resolve.js   ← the algorithm, pure and testable (Node)
test/            ← recorded Odesli fixtures + assertions
shortcut/        ← generated .shortcut plist + manual build steps
```

### Why the JS exists if the Shortcut can't import it

The Shortcuts app cannot run a JavaScript module. Truly sharing code would
require hosting a resolver endpoint, which reintroduces exactly the
maintenance burden the Safari extension was rejected for.

So `resolve.js` is not a runtime dependency. It is:

1. **The test harness.** Shortcuts is untestable — there is no way to assert
   its behavior on malformed input, a 429, or an `/intl-de/` URL. The JS lets
   the algorithm's edge cases be verified before the Shortcut is built.
2. **The reference implementation.** The Shortcut is a transcription of
   behavior already proven correct here.
3. **The head start on a Safari extension**, if the account tier ever changes.
   It drops in nearly verbatim.

## The algorithm

### Public interface (`src/resolve.js`)

```js
extractSpotifyUrl(text)            // -> string | null
normalizeSpotifyUrl(url)           // -> { url, kind, id } | null
resolveToAppleMusic(input, opts)   // -> Promise<Result>
```

`kind` is one of `track | album | artist | playlist | episode | show`.
`opts` is `{ country = 'CH', fetch = globalThis.fetch }`.

`Result` is a tagged union:

```js
{ status: 'match',  url, kind, title, artist }
{ status: 'search', url, term, title, artist }
{ status: 'none',   reason }
```

### Steps

1. **Extract.** Share sheets frequently pass a sentence, not a bare URL
   ("this is so good <link>"). Pull the first Spotify URL out of the text.
2. **Normalize.**
   - Strip Spotify's locale segment: `/intl-de/track/…` → `/track/…`
   - Strip tracking params (`?si=`, `?context=`, `?nd=`)
   - Accept `spotify:track:<id>` URIs and convert to https form
3. **Match.** `GET /v1-alpha.1/links?url=<encoded>&userCountry=CH`
4. **Read** `linksByPlatform.appleMusic.url`. Prefer `appleMusic` over
   `itunes` — the latter points at the Store, not the streaming catalog.
5. **Force storefront.** Odesli may return any country's URL. Replace a
   leading two-letter path segment with `ch`; insert `/ch` if absent.
6. **Open.** The Apple Music app claims `music.apple.com` universal links, so
   this opens the app rather than the web. No `music://` scheme needed.
7. **Fall back to search** when there is no Apple Music link: read `title` and
   `artistName` from `entitiesByUniqueId[entityUniqueId]` and open
   `music.apple.com/ch/search?term=<title> <artist>`.
8. **Give up loudly** when Odesli errors, rate-limits, or the input is not a
   music link. Show a notification; never open something arbitrary.

### Short links

`spotify.link/<code>` needs expansion. Shortcuts has no built-in URL expander,
and `Get Contents of URL` follows redirects without exposing the final URL.

**Open question, resolve during implementation:** test whether Odesli accepts
a `spotify.link` URL directly. If it does, no expansion is needed on either
side. If it does not, `resolve.js` follows the redirect itself, and the
Shortcut issues a throwaway `Get Contents of URL` against the short link and
scrapes the canonical URL from the returned HTML's `og:url` meta tag.

### Error handling

| Condition | Behavior |
|---|---|
| HTTP 429 | Notification: rate-limited, retry shortly |
| HTTP 4xx/5xx, network failure | Notification: lookup failed |
| 200 but no `appleMusic` link, title/artist present | Search fallback (step 7) |
| 200 but no usable title/artist | Notification: no match |
| Input contains no Spotify URL | Notification: not a Spotify link |

### Known limitations

- **Playlists and podcasts** have no cross-service equivalent. They will reach
  the search fallback, and for playlists the search terms will be meaningless.
  Inherent, not fixable.
- **Forced storefront** could theoretically point at content absent from the
  Swiss catalog. Passing `userCountry=CH` should make Odesli return a
  CH-valid match, but verify with a track that has patchy regional licensing.
- **Odesli API drift.** It is `v1-alpha.1` and unversioned in practice. A
  live smoke test guards against silent breakage.
- **Short links on the phone.** `spotify.link` URLs are expanded by the JS
  reference implementation but cannot be expanded by the Shortcut, which has
  no way to read the final URL after a redirect. They will usually fail to a
  notification. Workaround documented in the plan if it proves annoying.
- **Unauthenticated access is unverified.** A probe during design returned
  HTTP 401, from an environment with no direct internet egress, so the result
  is inconclusive. Task 1 of the plan settles it before any code depends on it.

## Testing

`node:test`, with recorded Odesli responses as fixtures. Cases:

- track, album, artist — happy paths
- `/intl-de/` prefixed URL
- `spotify:track:` URI form
- URL embedded in surrounding prose
- `spotify.link` short link
- playlist and podcast episode — search fallback
- HTTP 429 and malformed JSON — error paths
- storefront rewriting: `/us/` → `/ch/`, and a URL with no country segment

Plus one **live smoke test**, opt-in behind an env var, hitting the real API
with a known-stable track. Not part of the default run; it exists to catch
Odesli changing its response shape.

## Delivery

`.shortcut` files are property lists. iOS imports unsigned ones only when
Settings → Shortcuts → **Allow Untrusted Shortcuts** is enabled — a security
toggle the user must flip themselves, and which only appears after at least
one shortcut has been run on the device.

Plan: generate the plist with a script, transfer by AirDrop.

The `WFWorkflowActions` plist format is undocumented and a malformed file can
fail to import with no error message. Therefore the repo also ships
**action-by-action manual build instructions** as a guaranteed fallback —
roughly five minutes of tapping.

### Shortcut action outline

1. Receive URLs and Text from Share Sheet
2. Get URLs from Input
3. Text: `https://api.song.link/v1-alpha.1/links?url=…&userCountry=CH`
4. Get Contents of URL
5. Get Dictionary Value → `linksByPlatform.appleMusic.url`
6. If it has a value → Replace Text (storefront regex) → Open URLs
7. Otherwise → read `title` / `artistName` → Open the search URL
8. Otherwise → Show Notification

Name it **Open in Apple Music** so it reads correctly in the share sheet.

## Out of scope

- Safari extension (see rationale above)
- Any hosted service
- Reverse direction (Apple Music → Spotify)
- Playlist conversion
- Library management — this opens a song, it does not add it
