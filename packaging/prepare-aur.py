"""Render AUR metadata for an already-published Linux release asset."""
import argparse
import hashlib
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]


def render(version, repository, maintainer, deb, output):
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("AUR requires a stable semantic version")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("Invalid GitHub repository")
    if not maintainer or any(c in maintainer for c in "\r\n"):
        raise ValueError("Maintainer must be one nonempty line")
    license_file = ROOT / "LICENSE"
    values = {"VERSION": version, "REPOSITORY": repository, "MAINTAINER": maintainer,
              "SHA256": hashlib.sha256(deb.read_bytes()).hexdigest(),
              "LICENSE_SHA256": hashlib.sha256(license_file.read_bytes()).hexdigest()}
    text = (ROOT / "packaging/aur/PKGBUILD.in").read_text()
    for name, value in values.items():
        text = text.replace(f"@{name}@", value)
    output.mkdir(parents=True, exist_ok=True)
    (output / "PKGBUILD").write_text(text)
    shutil.copy2(license_file, output / "LICENSE")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for name in ["version", "repository", "maintainer", "deb", "output"]:
        parser.add_argument(f"--{name}", required=True)
    args = parser.parse_args()
    render(args.version, args.repository, args.maintainer, Path(args.deb), Path(args.output))
