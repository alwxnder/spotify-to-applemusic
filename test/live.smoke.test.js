import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveToAppleMusic } from '../src/resolve.js';

const live = process.env.LIVE === '1';

test('resolves a known-stable track against the real endpoints', { skip: !live }, async () => {
  const result = await resolveToAppleMusic('https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl');

  assert.equal(result.status, 'match', `expected a match, got ${result.status} (${result.reason ?? ''})`);
  assert.match(result.url, /^https:\/\/music\.apple\.com\/ch\//);
  assert.equal(result.title, 'Cut To The Feeling', 'Spotify og:title may have moved behind client-side rendering');
  assert.equal(result.artist, 'Carly Rae Jepsen', 'Spotify og:description format may have changed');
});

test('scoring beats result order on a real album search', { skip: !live }, async () => {
  // iTunes ranks "Happier Than Ever (Edit) - Single" above the real album.
  const result = await resolveToAppleMusic('https://open.spotify.com/album/0JGOiO34nwfUdDrD612dOp');

  assert.equal(result.status, 'match');
  assert.equal(result.title, 'Happier Than Ever');
  assert.ok(!/single/i.test(result.url), `picked the single instead of the album: ${result.url}`);
});

test('a playlist falls back to search', { skip: !live }, async () => {
  const result = await resolveToAppleMusic('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
  assert.equal(result.status, 'search');
});
