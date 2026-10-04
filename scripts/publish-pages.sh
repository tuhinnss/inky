#!/usr/bin/env bash
# Commits a fresh build of the current checkout onto the gh-pages branch, which GitHub
# Pages serves (Settings → Pages → Deploy from a branch → gh-pages, / (root)).
#
# The working tree and the current branch are not touched: the build is committed with
# a throwaway index straight from dist/. Nothing is pushed; afterwards run
#
#   git push origin gh-pages
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

if [ -n "$(git status --porcelain)" ]; then
  echo "Commit or stash your changes first: the site should match a commit." >&2
  exit 1
fi

npm run build
touch dist/.nojekyll # serve files as they are, without Jekyll

source=$(git rev-parse --short HEAD)
index=$(mktemp)
trap 'rm -f "$index"' EXIT
export GIT_INDEX_FILE="$index"
git read-tree --empty
git --work-tree=dist add -A
tree=$(git write-tree)
parent=()
if git rev-parse -q --verify refs/heads/gh-pages >/dev/null; then parent=(-p gh-pages); fi
commit=$(git commit-tree "$tree" "${parent[@]}" -m "deploy: built site from $(git rev-parse --abbrev-ref HEAD) $source")
git update-ref refs/heads/gh-pages "$commit"
echo "gh-pages is now $(git rev-parse --short gh-pages), built from $source. Push it with:"
echo "  git push origin gh-pages"
