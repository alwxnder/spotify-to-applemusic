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
