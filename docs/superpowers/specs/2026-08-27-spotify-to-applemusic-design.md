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

### Matching engine: Spotify og: tags + iTunes Search API

**Revised 2026-08-27.** The original design used Odesli (song.link). During
implementation its API returned:

```
HTTP 401 {"statusCode":401,"code":"PUBLIC_API_ACCESS_DEPRECATED"}
```

Odesli has retired unauthenticated public API access. Obtaining a key requires
a human request of unknown cost and turnaround, and the key would have to be
embedded in the Shortcut and kept out of this public repo. Replaced with two
endpoints that are public today and verified working:

1. **`https://open.spotify.com/<kind>/<id>`** — the page's Open Graph meta
   tags carry title, artist, and entity type in server-rendered HTML. No JS
   execution needed.
2. **`https://itunes.apple.com/search`** — Apple's own public search endpoint.
   With `country=CH` it returns URLs already on the Swiss storefront.

Neither requires a key or auth.

**Improvements over the Odesli design:**

- **No third party.** Requests go to Spotify and Apple only. The original
  privacy caveat is gone.
- **Short links resolve for free.** Fetching the Spotify page follows
  redirects, so `spotify.link` URLs work without a separate expansion step —
  including inside the Shortcut, where this was previously documented as an
  unfixable gap.

**Regression from the Odesli design:**

- **Matching is by text, not ISRC.** Odesli matched recording identity;
  iTunes Search matches names. It can return a remaster, a live cut, or the
  wrong edition. Mitigated by scoring (below), not eliminated.

### Open Graph shapes (observed, not assumed)

| Kind | `og:type` | `og:title` | `og:description` |
|---|---|---|---|
| track | `music.song` | track name | `Artist · Title · Song · Year` |
| album | `music.album` | `Title - Album by Artist \| Spotify` | `Artist · album · Year · N songs` |
| artist | `profile` | artist name | `Artist · N monthly listeners.` |
| playlist | `music.playlist` | playlist name | `Playlist · Owner · N items · N saves` |

`og:type` is the discriminator. For tracks and albums the artist is the first
`·`-separated segment of `og:description`.

## Architecture

Nothing hosted, nothing to keep alive.

```
src/extract.js       - URL extraction + normalization (pure)
src/storefront.js    - storefront rewriting (pure)
src/spotify-meta.js  - fetch + parse og: tags
src/itunes.js        - Apple Music search + result scoring
src/resolve.js       - orchestration -> Result union
src/cli.js           - desktop verification harness
shortcut/            - build guide for the iOS Shortcut
```

`spotify-meta.js` and `itunes.js` are the only modules performing I/O, and are
the only ones that would change if the matching strategy changes again.

### Why a JS implementation exists if the Shortcut cannot import it

The Shortcuts app cannot run a JavaScript module, and hosting a resolver would
reintroduce the maintenance burden the Safari extension was rejected for. So
the JS is not a runtime dependency. It is the tested reference implementation:
Shortcuts is untestable, so this is the only way to verify edge cases before
transcribing proven behavior into Shortcut actions. It also becomes a Safari
extension nearly verbatim if the account tier ever changes.

## The algorithm

1. **Extract** the Spotify URL from shared text (share sheets pass sentences,
   not bare URLs).
2. **Normalize** - strip `/intl-xx/` locale segments and `?si=` tracking
   params; accept `spotify:track:<id>` URIs.
3. **Fetch** the Spotify page, following redirects. This resolves
   `spotify.link` short URLs as a side effect.
4. **Parse** `og:type`, `og:title`, `og:description` into `{kind, title, artist}`.
5. **Search** iTunes with `term="<artist> <title>"`, `country=CH`, and an
   `entity` matching the kind (`song` / `album` / `musicArtist`).
6. **Score** the results rather than taking the first. Verified necessary: a
   search for Billie Eilish's *Happier Than Ever* returns the "(Edit) - Single"
   at index 0 and the real 16-track album at index 1.
   - +2 when the normalized candidate name equals the normalized target title
   - +1 when the normalized artist matches
   - ties broken by original result order
7. **Read the URL** by entity type - songs and albums use `trackViewUrl` /
   `collectionViewUrl`; artists use **`artistLinkUrl`**, a different field name.
   Verified against real responses.
8. **Force the storefront** to `/ch/` as a safety net. iTunes already returns
   CH URLs when `country=CH` is passed, so this is belt-and-braces.
9. **Fall back to search** for playlists and anything unmatched: open
   `music.apple.com/ch/search?term=...`.
10. **Give up loudly** on network failure or non-Spotify input - show a
    notification, never open something arbitrary.

### Error handling

| Condition | Behavior |
|---|---|
| Input contains no Spotify URL | Notification: not a Spotify link |
| Spotify page unreachable | Notification: lookup failed |
| og tags missing or unparseable | Notification: could not read the link |
| iTunes returns zero results, title known | Search fallback |
| iTunes returns zero results, no title | Notification: no match |
| Playlist link | Search fallback (terms will be poor - inherent) |

### Known limitations

- **Text matching, not identity matching.** See the regression note above.
  Scoring reduces but does not remove wrong-edition matches.
- **Playlists and podcasts** have no cross-service equivalent and will always
  reach the search fallback with poor terms.
- **Dependent on Spotify's server-rendered og tags.** If Spotify moves that
  metadata behind client-side rendering, parsing breaks. The live smoke test
  is what surfaces this.
- **iTunes Search is undocumented as a public contract** in the same way
  Odesli was. It has been stable for years, but Odesli's deprecation is a
  reminder that free endpoints can close.

## Testing

`node:test`, with real recorded responses as fixtures — trimmed Spotify pages
(the og tags only; full pages are ~250KB) and full iTunes Search JSON. Cases:

- track, album, artist — happy paths
- `/intl-de/` prefixed URL, `spotify:track:` URI, URL embedded in prose
- playlist — search fallback
- og tag parsing for each of the four `og:type` values
- **scoring**: the recorded *Happier Than Ever* album search, asserting the
  16-track album wins over the "(Edit) - Single" at index 0
- **artist field name**: asserting `artistLinkUrl` is read, not `artistViewUrl`
- zero-result search — fallback path
- network failure and malformed HTML — error paths
- storefront rewriting: `/us/` → `/ch/`, and a URL with no country segment

Plus one **live smoke test**, opt-in behind an env var, hitting both real
endpoints with a known-stable track. Not part of the default run; it exists to
catch Spotify moving og tags behind client-side rendering, or iTunes Search
changing shape.

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
3. Get Contents of URL (the Spotify link itself — follows redirects, so
   `spotify.link` short URLs resolve here)
4. Match Text — `<meta property="og:description" content="([^"]*)"` to get
   `Artist · Title · …`, and the same against `og:title`
5. Split Text on ` · ` and take the first item — the artist
6. Text: `https://itunes.apple.com/search?term=<artist> <title>&media=music&entity=song&country=CH&limit=5`
   (URL-encode the terms)
7. Get Contents of URL → Get Dictionary Value `results`
8. If `results` has any value → Get Item 1 → Get Dictionary Value
   `trackViewUrl` → Open URLs
9. Otherwise → Open `https://music.apple.com/ch/search?term=<artist> <title>`
10. Otherwise → Show Notification

**Deliberate simplification on the phone:** the Shortcut takes the first
iTunes result rather than reproducing the scoring from step 6 of the
algorithm — expressing that in Shortcut actions costs far more than it
returns. Consequence: the Shortcut will occasionally open a different edition
than the CLI does for the same link. Accepted; revisit only if it proves
annoying in practice.

Name it **Open in Apple Music** so it reads correctly in the share sheet.

## Out of scope

- Safari extension (see rationale above)
- Any hosted service
- Reverse direction (Apple Music → Spotify)
- Playlist conversion
- Library management — this opens a song, it does not add it
