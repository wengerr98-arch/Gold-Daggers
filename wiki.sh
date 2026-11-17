#!/usr/bin/env bash
# Gold Daggers wiki
#
#   ./wiki.sh preview   copy the player-safe notes out of the vault and open a local preview
#   ./wiki.sh publish   same export, then asks before anything goes online
#   ./wiki.sh export    only the export (writes content/ and wiki-export-report.md)
#
# Nothing goes online without "publish" and a yes.

set -euo pipefail
cd "$(dirname "$0")"

export_vault() {
  node scripts/export-vault.mjs
  # Timeline page: does nothing unless wiki.config.yaml has timeline.enabled: true
  node scripts/build-timeline.mjs
  # "Who was there", "Seen in" and the arc pages: need the export and (for most of their data) the timeline file
  node scripts/build-appearances.mjs

  # Table tools: does nothing unless wiki.config.yaml switches one on under table:
  node scripts/build-table.mjs
}

case "${1:-}" in
  export)
    export_vault
    ;;
  preview)
    export_vault
    echo
    echo "Preview at http://localhost:8080 — Ctrl+C to stop."
    npx quartz build --serve
    ;;
  publish)
    export_vault
    npx quartz build > /dev/null # stop here if the site doesn't build
    echo
    echo "Before you say yes: read wiki-export-report.md"
    echo "(links that became plain text, keyword hits, new and changed pages)."
    read -r -p "Put this on the live wiki? [y/N] " ok
    if [[ "$ok" =~ ^[yYjJ]$ ]]; then
      npx quartz sync --message "Wiki update $(date '+%Y-%m-%d %H:%M')"
      echo "Pushed. GitHub rebuilds the site; it's live in a minute or two."
    else
      echo "Nothing published."
    fi
    ;;
  *)
    sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
