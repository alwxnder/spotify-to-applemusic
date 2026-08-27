const STOREFRONT_SEGMENT_RE = /^\/([a-z]{2})(\/|$)/i;

/**
 * Forces an Apple Music URL onto a given storefront.
 * Odesli returns links for whichever country it chose; the Apple Music app
 * can refuse content addressed to a storefront the account is not in.
 */
export function forceStorefront(rawUrl, country) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.hostname.toLowerCase() !== 'music.apple.com') return null;

  const code = String(country).toLowerCase();
  parsed.pathname = STOREFRONT_SEGMENT_RE.test(parsed.pathname)
    ? parsed.pathname.replace(STOREFRONT_SEGMENT_RE, `/${code}$2`)
    : `/${code}${parsed.pathname}`;

  return parsed.toString();
}
