"""Substitute the real app icon into the feature graphic before rendering.

librsvg will not load an image referenced outside the SVG's own directory, so
the committed SVG carries an ICON_DATA_URI placeholder and this inlines the
icon into a throwaway copy. That keeps a base64 blob out of version control
while still rendering from the icon the app actually ships.
"""

import base64
import sys


def main() -> None:
    if len(sys.argv) != 4:
        sys.exit("usage: inline-icon.py <icon.png> <source.svg> <output.svg>")

    icon, source, output = sys.argv[1:]

    with open(icon, "rb") as handle:
        data = base64.b64encode(handle.read()).decode("ascii")

    with open(source, encoding="utf-8") as handle:
        svg = handle.read()

    if "ICON_DATA_URI" not in svg:
        sys.exit(f"ICON_DATA_URI placeholder not found in {source}")

    with open(output, "w", encoding="utf-8") as handle:
        handle.write(svg.replace("ICON_DATA_URI", f"data:image/png;base64,{data}"))


if __name__ == "__main__":
    main()
