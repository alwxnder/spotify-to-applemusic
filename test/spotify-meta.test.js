import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSpotifyMeta, fetchSpotifyMeta } from '../src/spotify-meta.js';
import { LookupError } from '../src/errors.js';

const html = (name) =>
  readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), 'utf8');

test('parses a track page', () => {
  assert.deepEqual(parseSpotifyMeta(html('spotify-track')), {
    kind: 'track',
    title: 'Cut To The Feeling',
    artist: 'Carly Rae Jepsen'
  });
});

test('parses an album page, stripping the " - Album by ..." suffix', () => {
  assert.deepEqual(parseSpotifyMeta(html('spotify-album')), {
    kind: 'album',
    title: 'Happier Than Ever',
    artist: 'Billie Eilish'
  });
});

test('parses an artist page', () => {
  const meta = parseSpotifyMeta(html('spotify-artist'));
  assert.equal(meta.kind, 'artist');
  assert.equal(meta.artist, 'Carly Rae Jepsen');
  assert.equal(meta.title, 'Carly Rae Jepsen');
});

test('parses a playlist page and reports no artist', () => {
  const meta = parseSpotifyMeta(html('spotify-playlist'));
  assert.equal(meta.kind, 'playlist');
  assert.equal(meta.title, 'Today’s Top Hits');
  assert.equal(meta.artist, null);
});

test('returns null when og tags are absent', () => {
  assert.equal(parseSpotifyMeta('<html><head></head><body>hi</body></html>'), null);
  assert.equal(parseSpotifyMeta(''), null);
});

test('fetches and parses, following redirects', async () => {
  const impl = async () => ({ ok: true, status: 200, text: async () => html('spotify-track') });
  const meta = await fetchSpotifyMeta('https://spotify.link/xYz9', { fetchImpl: impl });
  assert.equal(meta.title, 'Cut To The Feeling');
});

test('maps a transport failure to a network LookupError', async () => {
  const impl = async () => { throw new Error('ECONNREFUSED'); };
  await assert.rejects(
    () => fetchSpotifyMeta('https://open.spotify.com/track/abc', { fetchImpl: impl }),
    (e) => e instanceof LookupError && e.kind === 'network'
  );
});

test('maps a non-2xx response to an http LookupError', async () => {
  const impl = async () => ({ ok: false, status: 404, text: async () => '' });
  await assert.rejects(
    () => fetchSpotifyMeta('https://open.spotify.com/track/abc', { fetchImpl: impl }),
    (e) => e instanceof LookupError && e.kind === 'http'
  );
});

test('maps unparseable HTML to a parse LookupError', async () => {
  const impl = async () => ({ ok: true, status: 200, text: async () => '<html></html>' });
  await assert.rejects(
    () => fetchSpotifyMeta('https://open.spotify.com/track/abc', { fetchImpl: impl }),
    (e) => e instanceof LookupError && e.kind === 'parse'
  );
});
