#!/usr/bin/env node
import { resolveToAppleMusic } from './resolve.js';

const input = process.argv.slice(2).join(' ');

if (!input) {
  console.error('usage: node src/cli.js "<text containing a Spotify link>"');
  process.exit(2);
}

const result = await resolveToAppleMusic(input, {
  country: process.env.STOREFRONT ?? 'CH'
});

if (result.status === 'none') {
  console.error(`no match (${result.reason})${result.message ? ': ' + result.message : ''}`);
  process.exit(1);
}

console.error(`${result.status}: ${result.title ?? '?'} — ${result.artist ?? '?'}`);
console.log(result.url);
