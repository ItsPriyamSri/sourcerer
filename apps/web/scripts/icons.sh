#!/usr/bin/env bash
#
# Regenerate the raster icons from the single vector source.
#
# public/favicon.svg is the one place the mark is defined. Every PNG the manifest, the
# favicon link and iOS ask for is a rasterisation of it — so the icon cannot drift into
# three slightly different logos, which is what happens when each size is drawn by hand.
#
# Rasterising through headless Chrome keeps this dependency-free: no ImageMagick, no
# sharp, no build step, nothing to install. Chrome is rendered at each exact target size
# with a 1:1 device scale factor, so there is no resampling blur to explain away.
#
#   bash scripts/icons.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

CHROME="${CHROME:-$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)}"
if [ -z "$CHROME" ]; then
  echo "No Chrome found. Set CHROME=/path/to/chrome and re-run." >&2
  exit 1
fi

# size:filename — the two 512s are deliberately identical: the mark is already drawn
# inside a rounded square on its own background, which is what a maskable icon wants.
TARGETS=(
  "512:pwa-512.png"
  "512:pwa-maskable-512.png"
  "192:pwa-192.png"
  "180:apple-touch-icon.png"
)

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

for target in "${TARGETS[@]}"; do
  size="${target%%:*}"
  out="${target##*:}"

  # An SVG loaded directly by Chrome keeps its intrinsic 512x512 size and gets cropped at
  # smaller windows. Wrapping it in a page that sizes it explicitly is the reliable way to
  # ask Chrome for "this mark, exactly this many pixels".
  cat > "$tmp/page.html" <<HTML
<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}
img{display:block;width:${size}px;height:${size}px}</style>
<img src="file://$PWD/public/favicon.svg" alt="">
HTML

  "$CHROME" \
    --headless \
    --disable-gpu \
    --hide-scrollbars \
    --no-sandbox \
    --force-device-scale-factor=1 \
    --default-background-color=00000000 \
    --window-size="${size},${size}" \
    --screenshot="$tmp/$out" \
    "file://$tmp/page.html" >/dev/null 2>&1

  if [ ! -s "$tmp/$out" ]; then
    echo "Chrome produced nothing for $out" >&2
    exit 1
  fi

  mv "$tmp/$out" "public/$out"
  echo "wrote public/$out (${size}x${size})"
done

echo
echo "Done. Sizes verified by the browser, not by this script."
