#!/usr/bin/env bash
# Records real Odesli responses as test fixtures.
# Re-run when Odesli's response shape is suspected to have drifted.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p test/fixtures
API="https://api.song.link/v1-alpha.1/links"

probe() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -G "$API" \
    --data-urlencode "url=https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl" \
    --data-urlencode "userCountry=CH")
  echo "contract probe: HTTP ${code}"
  case "$code" in
    200) echo "  -> unauthenticated access works. proceeding." ;;
    401|403) echo "  -> Odesli now requires an API key. Request one at https://odesli.co/#contact"
             echo "     then re-run as: ODESLI_KEY=xxx $0"; ;;
    429) echo "  -> rate limited. wait 60s and re-run."; exit 1 ;;
    *)   echo "  -> unexpected. stop and report before writing code against this."; exit 1 ;;
  esac
}

record() {
  local name="$1" spotify_url="$2"
  echo "recording ${name}..."
  curl -sf -G "$API" \
    --data-urlencode "url=${spotify_url}" \
    --data-urlencode "userCountry=CH" \
    ${ODESLI_KEY:+--data-urlencode "key=${ODESLI_KEY}"} \
    -o "test/fixtures/${name}.json"
  sleep 7   # Odesli allows ~10 req/min unauthenticated
}

probe

record track     "https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl"
record album     "https://open.spotify.com/album/0JGOiO34nwfUdDrD612dOp"
record artist    "https://open.spotify.com/artist/6sFIWsNpZYqfjUpaCgueju"
record playlist  "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"
record episode   "https://open.spotify.com/episode/512ojhOuo1ktJprKbVcKyQ"

echo
echo "=== assumption check ==="
node -e '
const fs = require("fs");
const d = JSON.parse(fs.readFileSync("test/fixtures/track.json","utf8"));
const e = d.entitiesByUniqueId[d.entityUniqueId];
console.log("userCountry:      ", d.userCountry);
console.log("has appleMusic:   ", !!d.linksByPlatform.appleMusic);
console.log("appleMusic.url:   ", d.linksByPlatform.appleMusic?.url);
console.log("title / artist:   ", e?.title, "|", e?.artistName);
const p = JSON.parse(fs.readFileSync("test/fixtures/playlist.json","utf8"));
console.log("playlist matched: ", !!p.linksByPlatform?.appleMusic, "(want false, to exercise the search fallback)");
'
