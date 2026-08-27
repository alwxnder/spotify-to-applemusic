import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickBestMatch, searchAppleMusic } from '../src/itunes.js';
import { LookupError } from '../src/errors.js';

const load = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

const respond = (body, ok = true, status = 200) => async () => ({
  ok,
  status,
  json: async () => body
});

test('picks the exact-title album over a higher-ranked single', () => {
  // Recorded fixture: "Happier Than Ever (Edit) - Single" is results[0];
  // the real 16-track album is results[1]. Taking the first would be wrong.
  const results = load('itunes-album').results;
  const best = pickBestMatch(results, {
    title: 'Happier Than Ever',
    artist: 'Billie Eilish',
    kind: 'album'
  });

  assert.equal(best.collectionName, 'Happier Than Ever');
  assert.equal(best.trackCount, 16);
});

test('picks the matching song', () => {
  const best = pickBestMatch(load('itunes-song').results, {
    title: 'Cut To The Feeling',
    artist: 'Carly Rae Jepsen',
    kind: 'track'
  });
  assert.equal(best.trackName, 'Cut To The Feeling');
});

test('prefers a matching artist when titles tie', () => {
  const results = [
    { trackName: 'Lovely', artistName: 'Someone Else' },
    { trackName: 'Lovely', artistName: 'Billie Eilish' }
  ];
  const best = pickBestMatch(results, { title: 'Lovely', artist: 'Billie Eilish', kind: 'track' });
  assert.equal(best.artistName, 'Billie Eilish');
});

test('matches across diacritics and punctuation', () => {
  const results = [
    { trackName: 'Something Else', artistName: 'Nobody' },
    { trackName: 'Deja Vu', artistName: 'Beyonce' }
  ];
  const best = pickBestMatch(results, { title: 'Déjà Vu', artist: 'Beyoncé', kind: 'track' });
  assert.equal(best.trackName, 'Deja Vu');
});

test('falls back to the first result when nothing matches well', () => {
  const results = [{ trackName: 'A' }, { trackName: 'B' }];
  assert.equal(pickBestMatch(results, { title: 'Z', artist: 'Z', kind: 'track' }).trackName, 'A');
});

test('returns null for an empty result set', () => {
  assert.equal(pickBestMatch([], { title: 'A', artist: 'B', kind: 'track' }), null);
});

test('reads artistLinkUrl for artists, not artistViewUrl', async () => {
  // Verified against a real response: artist entities expose artistLinkUrl.
  const match = await searchAppleMusic(
    { title: 'Carly Rae Jepsen', artist: 'Carly Rae Jepsen', kind: 'artist' },
    { fetchImpl: respond(load('itunes-artist')) }
  );

  assert.equal(match.url, 'https://music.apple.com/ch/artist/carly-rae-jepsen/284363062?uo=4');
});

test('reads trackViewUrl for songs', async () => {
  const match = await searchAppleMusic(
    { title: 'Cut To The Feeling', artist: 'Carly Rae Jepsen', kind: 'track' },
    { fetchImpl: respond(load('itunes-song')) }
  );
  assert.match(match.url, /^https:\/\/music\.apple\.com\/ch\/album\//);
  assert.equal(match.name, 'Cut To The Feeling');
  assert.equal(match.artistName, 'Carly Rae Jepsen');
});

test('reads collectionViewUrl for albums', async () => {
  const match = await searchAppleMusic(
    { title: 'Happier Than Ever', artist: 'Billie Eilish', kind: 'album' },
    { fetchImpl: respond(load('itunes-album')) }
  );
  assert.match(match.url, /^https:\/\/music\.apple\.com\/ch\/album\//);
  assert.equal(match.name, 'Happier Than Ever');
});

test('sends the expected query parameters', async () => {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    return { ok: true, status: 200, json: async () => load('itunes-song') };
  };

  await searchAppleMusic(
    { title: 'Cut To The Feeling', artist: 'Carly Rae Jepsen', kind: 'track' },
    { fetchImpl: impl, country: 'CH' }
  );

  const q = new URL(calls[0]).searchParams;
  assert.equal(q.get('term'), 'Carly Rae Jepsen Cut To The Feeling');
  assert.equal(q.get('country'), 'CH');
  assert.equal(q.get('entity'), 'song');
  assert.equal(q.get('media'), 'music');
});

test('returns null when the search finds nothing', async () => {
  const match = await searchAppleMusic(
    { title: 'zzzzqqqx', artist: '', kind: 'track' },
    { fetchImpl: respond(load('itunes-empty')) }
  );
  assert.equal(match, null);
});

test('maps a transport failure to a network LookupError', async () => {
  const impl = async () => { throw new Error('ECONNREFUSED'); };
  await assert.rejects(
    () => searchAppleMusic({ title: 'A', artist: 'B', kind: 'track' }, { fetchImpl: impl }),
    (e) => e instanceof LookupError && e.kind === 'network'
  );
});

test('maps a non-2xx response to an http LookupError', async () => {
  await assert.rejects(
    () => searchAppleMusic({ title: 'A', artist: 'B', kind: 'track' }, { fetchImpl: respond({}, false, 503) }),
    (e) => e instanceof LookupError && e.kind === 'http'
  );
});
