# Working on this repo

## Versioning

After every merge to `main`, bump the minor version with `scripts/bump_version.py v+`
and merge that bump to `main` too (same PR flow). The bump merge itself does not
trigger another bump. Use `v++` / `v+++` only when asked.

## Releasing: `release+`, `release++`, `release+++`

When asked for `release+`, `release++` or `release+++`, do all of these in order:

1. Open a PR for the current work and merge it to `main`.
2. Bump the version with `v+`, `v++` or `v+++` (matching the command) and merge
   that bump to `main` through its own PR. This bump replaces the usual `v+` above.
3. Tag: the "Tag version" workflow tags the bump commit `vX.Y.Z` after the merge.
   Check that the tag exists; if not, run that workflow by hand.
4. Release: run the "Release" workflow (`release.yml`) with that tag.
