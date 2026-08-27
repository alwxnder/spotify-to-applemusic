# spotify-to-applemusic

Open Spotify links in Apple Music on iPhone.

Friends send Spotify links; this turns them into the same song on Apple Music,
via a share-sheet Shortcut. No server, no API keys, nothing that expires.

## How it works

1. Fetch the Spotify page and read its Open Graph tags for title, artist, and type
2. Search Apple Music's public catalogue via the iTunes Search API
3. Score the results and open the best match, forced to the `ch` storefront

Both endpoints are public and unauthenticated. Requests go to Spotify and
Apple only — no third-party service is involved.

## Using it on the phone

Follow [shortcut/BUILD.md](shortcut/BUILD.md). Roughly five minutes.

## Using it from the terminal

```bash
node src/cli.js "https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl"
```

Prints the Apple Music URL to stdout and a human-readable line to stderr, so
it pipes straight into `open`:

```bash
open "$(node src/cli.js 'https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl')"
```

Set `STOREFRONT` to target a different country (defaults to `CH`).

## Tests

```bash
npm test
```

Runs offline against recorded fixtures. The live smoke test is opt-in:

```bash
npm run smoke
```

It hits the real endpoints and exists to catch Spotify moving its metadata
behind client-side rendering, or iTunes Search changing shape.

## Design notes

- [Design spec](docs/superpowers/specs/2026-08-27-spotify-to-applemusic-design.md)
- [Implementation plan](docs/superpowers/plans/2026-08-27-spotify-to-applemusic.md)

Two decisions worth knowing:

**No Safari extension.** It would be zero-tap, but on a free Apple Developer
account the containing app expires every 7 days and needs reinstalling over
cable. Extensions also never run in the in-app browsers used by WhatsApp,
Instagram, and Slack — where most links actually arrive.

**Matching is by text, not recording identity.** The original design used
Odesli, which matched by ISRC, but it now returns
`401 PUBLIC_API_ACCESS_DEPRECATED` for unauthenticated callers. Name-based
search can return the wrong edition; result scoring reduces this but does not
eliminate it.
