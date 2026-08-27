import test from 'node:test';
import assert from 'node:assert/strict';
import { forceStorefront } from '../src/storefront.js';

test('replaces an existing storefront segment', () => {
  assert.equal(
    forceStorefront('https://music.apple.com/us/album/blonde/1146195596', 'CH'),
    'https://music.apple.com/ch/album/blonde/1146195596'
  );
});

test('inserts a storefront when none is present', () => {
  assert.equal(
    forceStorefront('https://music.apple.com/album/blonde/1146195596', 'CH'),
    'https://music.apple.com/ch/album/blonde/1146195596'
  );
});

test('leaves a URL already on the target storefront unchanged', () => {
  assert.equal(
    forceStorefront('https://music.apple.com/ch/album/blonde/1146195596', 'CH'),
    'https://music.apple.com/ch/album/blonde/1146195596'
  );
});

test('preserves query strings such as the track selector', () => {
  assert.equal(
    forceStorefront('https://music.apple.com/us/album/blonde/1146195596?i=1146195597', 'CH'),
    'https://music.apple.com/ch/album/blonde/1146195596?i=1146195597'
  );
});

test('accepts lowercase country codes', () => {
  assert.equal(
    forceStorefront('https://music.apple.com/us/album/x/1', 'ch'),
    'https://music.apple.com/ch/album/x/1'
  );
});

test('returns null for non-Apple-Music hosts', () => {
  assert.equal(forceStorefront('https://open.spotify.com/track/abc', 'CH'), null);
  assert.equal(forceStorefront('not a url', 'CH'), null);
});
