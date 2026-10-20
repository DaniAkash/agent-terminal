#!/usr/bin/env bash
# Render the Play feature graphic from its SVG source.
#
# Output lands where Fastlane's `supply` looks for it, so the same file serves
# a manual Console upload and an automated one later. Google accepts 1024x500
# and nothing else for this slot, hence the explicit size and the check.
set -euo pipefail

cd "$(dirname "$0")"
OUT=../fastlane/metadata/android/en-US/images/featureGraphic.png
ICON=../assets/icon.png

command -v rsvg-convert >/dev/null || {
  echo "rsvg-convert not found. brew install librsvg" >&2
  exit 1
}
[ -f "$ICON" ] || { echo "missing $ICON" >&2; exit 1; }

# librsvg refuses to follow a relative href out of the SVG's own directory, so
# the icon is inlined into a temporary copy at render time. Keeping the base64
# out of the committed source is the point: it stays reviewable, and it cannot
# drift from the icon the app actually ships.
tmp="$(mktemp -t feature-graphic).svg"
trap 'rm -f "$tmp"' EXIT
python3 inline-icon.py "$ICON" feature-graphic.svg "$tmp"

mkdir -p "$(dirname "$OUT")"
rsvg-convert -w 1024 -h 500 "$tmp" -o "$OUT"

# A wrong size is rejected at upload rather than at render, which is a slow way
# to find out. sips is macOS only, so skip rather than fail where it is absent.
if command -v sips >/dev/null; then
  dims=$(sips -g pixelWidth -g pixelHeight "$OUT" | awk '/pixel/{printf "%s ", $2}')
  set -- $dims
  if [ "${1:-}" != "1024" ] || [ "${2:-}" != "500" ]; then
    echo "expected 1024x500, got ${1:-?}x${2:-?}" >&2
    exit 1
  fi
  echo "wrote $OUT (${1}x${2})"
else
  echo "wrote $OUT (size unverified, sips unavailable)"
fi
