import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveToAppleMusic } from '../src/resolve.js';

const html = (name) => readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), 'utf8');
const json = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

/** Routes spotify.com requests to an HTML fixture and itunes.apple.com to a JSON one. */
function stubNetwork({ page = 'spotify-track', search = 'itunes-song' } = {}) {
  const calls = [];
  const impl = async (url) => {
    const href = String(url);
    calls.push(href);
    if (href.includes('itunes.apple.com')) {
      return { ok: true, status: 200, json: async () => json(search) };
    }
    return { ok: true, status: 200, text: async () => html(page) };
  };
  impl.calls = calls;
  return impl;
}

test('resolves a track to a CH Apple Music URL', async () => {
  const result = await resolveToAppleMusic(
    'https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl',
    { fetchImpl: stubNetwork() }
  );

  assert.equal(result.status, 'match');
  assert.equal(result.kind, 'track');
  assert.match(result.url, /^https:\/\/music\.apple\.com\/ch\//);
  assert.equal(result.title, 'Cut To The Feeling');
  assert.equal(result.artist, 'Carly Rae Jepsen');
});

test('resolves an album', async () => {
  const result = await resolveToAppleMusic(
    'https://open.spotify.com/album/0JGOiO34nwfUdDrD612dOp',
    { fetchImpl: stubNetwork({ page: 'spotify-album', search: 'itunes-album' }) }
  );

  assert.equal(result.status, 'match');
  assert.equal(result.kind, 'album');
  assert.match(result.url, /^https:\/\/music\.apple\.com\/ch\//);
});

test('accepts a URL wrapped in prose', async () => {
  const result = await resolveToAppleMusic(
    'you have to hear this https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl !!',
    { fetchImpl: stubNetwork() }
  );
  assert.equal(result.status, 'match');
});

test('resolves a spotify.link short URL without a separate expansion step', async () => {
  const impl = stubNetwork();
  const result = await resolveToAppleMusic('https://spotify.link/xYz9', { fetchImpl: impl });

  assert.equal(result.status, 'match');
  assert.ok(impl.calls[0].startsWith('https://spotify.link/'), 'should fetch the short URL directly');
});

test('falls back to an Apple Music search for playlists without searching iTunes', async () => {
  const impl = stubNetwork({ page: 'spotify-playlist' });
  const result = await resolveToAppleMusic(
    'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
    { fetchImpl: impl }
  );

  assert.equal(result.status, 'search');
  assert.match(result.url, /^https:\/\/music\.apple\.com\/ch\/search\?term=/);
  assert.ok(!impl.calls.some((c) => c.includes('itunes.apple.com')), 'playlists should skip the catalogue search');
});

test('falls back to search when the catalogue has no match', async () => {
  const result = await resolveToAppleMusic(
    'https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl',
    { fetchImpl: stubNetwork({ search: 'itunes-empty' }) }
  );

  assert.equal(result.status, 'search');
  assert.equal(result.term, 'Carly Rae Jepsen Cut To The Feeling');
});

test('reports not_spotify for input with no Spotify link', async () => {
  const result = await resolveToAppleMusic('hello there', {
    fetchImpl: () => assert.fail('should not hit the network')
  });
  assert.deepEqual(result, { status: 'none', reason: 'not_spotify' });
});

test('surfaces a network failure as a none result rather than throwing', async () => {
  const result = await resolveToAppleMusic(
    'https://open.spotify.com/track/abc',
    { fetchImpl: async () => { throw new Error('ECONNREFUSED'); } }
  );

  assert.equal(result.status, 'none');
  assert.equal(result.reason, 'network');
  assert.ok(result.message);
});

test('surfaces unreadable pages as a none result', async () => {
  const result = await resolveToAppleMusic(
    'https://open.spotify.com/track/abc',
    { fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<html></html>' }) }
  );

  assert.equal(result.status, 'none');
  assert.equal(result.reason, 'parse');
});

test('honours a non-default country', async () => {
  const result = await resolveToAppleMusic(
    'https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl',
    { country: 'DE', fetchImpl: stubNetwork() }
  );
  assert.match(result.url, /^https:\/\/music\.apple\.com\/de\//);
});
