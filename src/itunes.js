import { LookupError } from './errors.js';

const ENDPOINT = 'https://itunes.apple.com/search';

/** iTunes search entity, and the URL field it returns, per Spotify kind. */
const ENTITY_BY_KIND = new Map([
  ['track', { entity: 'song', urlField: 'trackViewUrl', nameField: 'trackName' }],
  ['album', { entity: 'album', urlField: 'collectionViewUrl', nameField: 'collectionName' }],
  // Artist results expose artistLinkUrl -- NOT artistViewUrl, which songs use.
  ['artist', { entity: 'musicArtist', urlField: 'artistLinkUrl', nameField: 'artistName' }]
]);

/** Lowercase, strip diacritics and punctuation, collapse whitespace. */
function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Chooses the best candidate rather than trusting result order.
 * Necessary: searching "Billie Eilish Happier Than Ever" returns the
 * "(Edit) - Single" first and the actual album second.
 */
export function pickBestMatch(results, { title, artist, kind }) {
  if (!Array.isArray(results) || results.length === 0) return null;

  const { nameField } = ENTITY_BY_KIND.get(kind) ?? ENTITY_BY_KIND.get('track');
  const wantedTitle = normalize(title);
  const wantedArtist = normalize(artist);

  let best = results[0];
  let bestScore = -1;

  results.forEach((result, index) => {
    const name = normalize(result[nameField] ?? result.trackName ?? result.collectionName);
    let score = 0;
    if (name && name === wantedTitle) score += 2;
    if (wantedArtist && normalize(result.artistName) === wantedArtist) score += 1;

    // Strictly greater keeps the earliest result on ties, preserving Apple's ranking.
    if (score > bestScore) {
      bestScore = score;
      best = results[index];
    }
  });

  return best;
}

/**
 * Searches Apple Music's public catalogue for the given metadata.
 * Returns null when nothing is found; throws LookupError on transport failure.
 */
export async function searchAppleMusic(
  { title, artist, kind },
  { country = 'CH', fetchImpl = globalThis.fetch } = {}
) {
  const config = ENTITY_BY_KIND.get(kind) ?? ENTITY_BY_KIND.get('track');
  const term = [artist, title].filter(Boolean).join(' ');

  const params = new URLSearchParams({
    term,
    media: 'music',
    entity: config.entity,
    country,
    limit: '5'
  });

  let response;
  try {
    response = await fetchImpl(`${ENDPOINT}?${params}`);
  } catch {
    throw new LookupError('network', 'Could not reach Apple Music.');
  }

  if (!response.ok) {
    throw new LookupError('http', `Apple Music search returned ${response.status}.`);
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new LookupError('parse', 'Apple Music search returned invalid data.');
  }

  const best = pickBestMatch(body?.results, { title, artist, kind });
  if (!best) return null;

  const url = best[config.urlField];
  if (!url) return null;

  return {
    url,
    name: best[config.nameField] ?? null,
    artistName: best.artistName ?? null
  };
}
