import { LookupError } from './errors.js';

/** Spotify's og:type values, mapped to the kinds this project cares about. */
const KIND_BY_OG_TYPE = new Map([
  ['music.song', 'track'],
  ['music.album', 'album'],
  ['music.playlist', 'playlist'],
  ['profile', 'artist']
]);

const ALBUM_TITLE_SUFFIX_RE = /\s+-\s+Album by .*$/;
const SPOTIFY_TITLE_SUFFIX_RE = /\s*\|\s*Spotify\s*$/;

function readMeta(html, property) {
  const match = html.match(
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i')
  );
  return match ? decodeEntities(match[1]) : null;
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

/**
 * Reads title, artist and entity kind out of a Spotify page's Open Graph tags.
 * Spotify server-renders these, so no JS execution is needed.
 * Returns null when the page carries no recognisable og tags.
 */
export function parseSpotifyMeta(html) {
  if (typeof html !== 'string') return null;

  const ogType = readMeta(html, 'og:type');
  const ogTitle = readMeta(html, 'og:title');
  const ogDescription = readMeta(html, 'og:description');

  if (!ogType || !ogTitle) return null;

  const kind = KIND_BY_OG_TYPE.get(ogType) ?? 'unknown';
  // For tracks and albums the artist is the first "·"-separated segment.
  const leadSegment = ogDescription ? ogDescription.split('·')[0].trim() : null;

  if (kind === 'artist') {
    return { kind, title: ogTitle, artist: ogTitle };
  }

  if (kind === 'album') {
    const title = ogTitle.replace(ALBUM_TITLE_SUFFIX_RE, '').replace(SPOTIFY_TITLE_SUFFIX_RE, '').trim();
    return { kind, title, artist: leadSegment || null };
  }

  if (kind === 'track') {
    return { kind, title: ogTitle, artist: leadSegment || null };
  }

  // Playlists and anything unrecognised have no meaningful artist.
  return { kind, title: ogTitle, artist: null };
}

/**
 * Fetches a Spotify URL and parses its metadata.
 * Redirects are followed, which resolves spotify.link short URLs for free.
 */
export async function fetchSpotifyMeta(url, { fetchImpl = globalThis.fetch } = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; spotify-to-applemusic)' }
    });
  } catch {
    throw new LookupError('network', 'Could not reach Spotify.');
  }

  if (!response.ok) {
    throw new LookupError('http', `Spotify returned ${response.status}.`);
  }

  const meta = parseSpotifyMeta(await response.text());
  if (!meta) {
    throw new LookupError('parse', 'Could not read the track details.');
  }

  return meta;
}
