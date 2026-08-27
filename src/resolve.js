import { extractSpotifyUrl, normalizeSpotifyUrl } from './extract.js';
import { forceStorefront } from './storefront.js';
import { fetchSpotifyMeta } from './spotify-meta.js';
import { searchAppleMusic } from './itunes.js';
import { LookupError } from './errors.js';

/** Kinds that exist in Apple Music's catalogue and are worth searching for. */
const SEARCHABLE_KINDS = new Set(['track', 'album', 'artist']);

function searchResult(meta, country) {
  const term = [meta.artist, meta.title].filter(Boolean).join(' ');
  return {
    status: 'search',
    url: `https://music.apple.com/${country.toLowerCase()}/search?term=${encodeURIComponent(term)}`,
    term,
    title: meta.title,
    artist: meta.artist
  };
}

/**
 * Turns shared text containing a Spotify link into an Apple Music destination.
 * Never throws for expected failures - callers switch on `status`.
 */
export async function resolveToAppleMusic(input, options = {}) {
  const country = options.country ?? 'CH';

  const raw = extractSpotifyUrl(input);
  if (!raw) return { status: 'none', reason: 'not_spotify' };

  const normalized = normalizeSpotifyUrl(raw);
  if (!normalized) return { status: 'none', reason: 'not_spotify' };

  try {
    // Fetching follows redirects, so spotify.link short URLs resolve here.
    const meta = await fetchSpotifyMeta(normalized.url, options);

    // Playlists have no catalogue equivalent; searching by their name is noise.
    if (!SEARCHABLE_KINDS.has(meta.kind)) {
      return meta.title ? searchResult(meta, country) : { status: 'none', reason: 'no_match' };
    }

    const match = await searchAppleMusic(meta, { ...options, country });
    if (match) {
      const url = forceStorefront(match.url, country) ?? match.url;
      return { status: 'match', url, kind: meta.kind, title: meta.title, artist: meta.artist };
    }

    return meta.title ? searchResult(meta, country) : { status: 'none', reason: 'no_match' };
  } catch (error) {
    if (error instanceof LookupError) {
      return { status: 'none', reason: error.kind, message: error.message };
    }
    throw error;
  }
}
