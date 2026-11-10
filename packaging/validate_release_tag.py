"""Validate that a release tag describes the version being packaged."""
import re
import sys

VERSION = re.compile(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?\Z")


def validate(version, tag):
    configured = VERSION.fullmatch(version)
    tagged = VERSION.fullmatch(tag[1:]) if tag.startswith("v") else None
    if not configured or not tagged:
        raise ValueError("Expected a semantic version and a v-prefixed release tag")
    if tag == f"v{version}":
        return
    if configured.group(4) is None and tagged.group(4) and tagged.groups()[:3] == configured.groups()[:3]:
        return
    raise ValueError(f"Release tag {tag!r} does not match configured version {version!r}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Usage: validate_release_tag.py VERSION TAG")
    try:
        validate(sys.argv[1], sys.argv[2])
    except ValueError as error:
        sys.exit(str(error))
