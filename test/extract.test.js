import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSpotifyUrl, normalizeSpotifyUrl } from '../src/extract.js';

test('extracts a bare track URL', () => {
  assert.equal(
    extractSpotifyUrl('https://open.spotify.com/track/abc123'),
    'https://open.spotify.com/track/abc123'
  );
});

test('extracts a URL embedded in prose', () => {
  assert.equal(
    extractSpotifyUrl('omg listen to this https://open.spotify.com/track/abc123 so good'),
    'https://open.spotify.com/track/abc123'
  );
});

test('strips trailing sentence punctuation', () => {
  assert.equal(
    extractSpotifyUrl('this one https://open.spotify.com/track/abc123.'),
    'https://open.spotify.com/track/abc123'
  );
});

test('converts a spotify: URI to https form', () => {
  assert.equal(
    extractSpotifyUrl('spotify:track:abc123'),
    'https://open.spotify.com/track/abc123'
  );
});

test('extracts a spotify.link short URL', () => {
  assert.equal(
    extractSpotifyUrl('check https://spotify.link/xYz9'),
    'https://spotify.link/xYz9'
  );
});

test('returns null when there is no Spotify link', () => {
  assert.equal(extractSpotifyUrl('just a normal message'), null);
  assert.equal(extractSpotifyUrl('https://music.apple.com/ch/album/123'), null);
});

test('returns null for non-string input', () => {
  assert.equal(extractSpotifyUrl(undefined), null);
  assert.equal(extractSpotifyUrl(null), null);
});

test('normalizes a plain track URL', () => {
  assert.deepEqual(
    normalizeSpotifyUrl('https://open.spotify.com/track/abc123'),
    { url: 'https://open.spotify.com/track/abc123', kind: 'track', id: 'abc123' }
  );
});

test('strips the intl- locale segment', () => {
  assert.deepEqual(
    normalizeSpotifyUrl('https://open.spotify.com/intl-de/track/abc123'),
    { url: 'https://open.spotify.com/track/abc123', kind: 'track', id: 'abc123' }
  );
});

test('strips si and context tracking params', () => {
  assert.deepEqual(
    normalizeSpotifyUrl('https://open.spotify.com/track/abc123?si=deadbeef&context=xyz'),
    { url: 'https://open.spotify.com/track/abc123', kind: 'track', id: 'abc123' }
  );
});

test('recognises albums and artists', () => {
  assert.equal(normalizeSpotifyUrl('https://open.spotify.com/album/a1').kind, 'album');
  assert.equal(normalizeSpotifyUrl('https://open.spotify.com/artist/a1').kind, 'artist');
});

test('marks spotify.link URLs as kind short', () => {
  assert.deepEqual(
    normalizeSpotifyUrl('https://spotify.link/xYz9'),
    { url: 'https://spotify.link/xYz9', kind: 'short', id: 'xYz9' }
  );
});

test('returns null for unknown paths and hosts', () => {
  assert.equal(normalizeSpotifyUrl('https://open.spotify.com/wat/abc123'), null);
  assert.equal(normalizeSpotifyUrl('https://example.com/track/abc123'), null);
  assert.equal(normalizeSpotifyUrl('not a url'), null);
});
