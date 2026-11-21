#!/usr/bin/env python3
"""Bump the integration version in manifest.json.

Version format: release.major.minor

  v+     minor + 1          2.1.0 -> 2.1.1
  v++    major + 1, minor=0 2.1.0 -> 2.2.0
  v+++   release + 1, major=0, minor=0   2.1.0 -> 3.0.0

Usage:
  scripts/bump_version.py v+
  scripts/bump_version.py v++
  scripts/bump_version.py v+++
  scripts/bump_version.py v+ --manifest path/to/manifest.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

DEFAULT_MANIFEST = (
    Path(__file__).resolve().parent.parent
    / "custom_components"
    / "magnolia_proxy"
    / "manifest.json"
)
VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
COMMANDS = {"v+", "v++", "v+++"}


def bump(version: str, command: str) -> str:
    """Return the new version string for a bump command."""
    match = VERSION_RE.match(version)
    if not match:
        raise ValueError(f"Version {version!r} is not in release.major.minor form")
    release, major, minor = (int(part) for part in match.groups())

    if command == "v+":
        minor += 1
    elif command == "v++":
        major += 1
        minor = 0
    elif command == "v+++":
        release += 1
        major = 0
        minor = 0
    else:
        raise ValueError(f"Unknown command {command!r}; use v+, v++ or v+++")
    return f"{release}.{major}.{minor}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=sorted(COMMANDS), help="v+, v++ or v+++")
    parser.add_argument(
        "--manifest",
        type=Path,
        default=DEFAULT_MANIFEST,
        help="manifest.json to update (default: the integration's manifest)",
    )
    args = parser.parse_args(argv)

    manifest_path: Path = args.manifest
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        old_version = data["version"]
        new_version = bump(old_version, args.command)
    except (OSError, KeyError, ValueError) as err:
        print(f"error: {err}", file=sys.stderr)
        return 1

    data["version"] = new_version
    manifest_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{old_version} -> {new_version}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
