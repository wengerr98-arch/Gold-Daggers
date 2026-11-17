#!/usr/bin/env bash
# Gold Daggers wiki — one-time setup on your Mac
#
#   ./setup-mac.sh                      uses the vault at ~/Documents/Obsidian/Gold Daggers Vault V2
#   ./setup-mac.sh --vault "/path/to/vault"
#   ./setup-mac.sh --skip-install       skip the downloads (when you only want to re-test)
#
# It checks Node, installs what the wiki needs, creates your settings file (wiki.config.yaml),
# then does a test export and a test build. It never publishes anything and never writes to the vault.
# Safe to run again: an existing wiki.config.yaml is kept.

set -euo pipefail
cd "$(dirname "$0")"

VAULT="$HOME/Documents/Obsidian/Gold Daggers Vault V2"
SKIP_INSTALL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --vault) VAULT="${2:?--vault needs a path}"; shift 2 ;;
    --skip-install) SKIP_INSTALL=1; shift ;;
    -h|--help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)"; exit 1 ;;
  esac
done
VAULT="${VAULT/#\~/$HOME}"

step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  ✓ %s\n' "$1"; }
stop() { printf '\n  ✗ %s\n' "$1"; shift; for l in "$@"; do printf '    %s\n' "$l"; done; exit 1; }

step "1/6  Tools"
command -v git >/dev/null 2>&1 || stop "git is missing." \
  "Run:  xcode-select --install   (Apple's developer tools, a few minutes), then run this script again."
ok "git"
command -v node >/dev/null 2>&1 || stop "Node.js is missing." \
  "Install the LTS version from https://nodejs.org (or: brew install node), open a new Terminal window, run this script again."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" -ge 22 ]] || stop "Node.js $(node -v) is too old; the wiki needs version 22 or newer." \
  "Install the current LTS from https://nodejs.org (or: brew upgrade node), open a new Terminal window, run this script again."
ok "Node.js $(node -v)"

step "2/6  Install what the wiki needs (takes a minute or two the first time)"
if [[ "$SKIP_INSTALL" -eq 1 ]]; then
  ok "skipped (--skip-install)"
else
  npm ci --no-audit --no-fund
  npx quartz plugin install
  ok "installed"
fi

step "3/6  Settings file"
if [[ -f wiki.config.yaml ]]; then
  ok "wiki.config.yaml is already there, kept as it is"
else
  [[ -f wiki.config.proposed.yaml ]] || stop "wiki.config.proposed.yaml is missing; is this the wiki folder?"
  # copy the proposed settings and write the vault path into the line that starts with "vault:"
  VAULT_PATH="$VAULT" node -e '
    const fs = require("fs")
    const text = fs.readFileSync("wiki.config.proposed.yaml", "utf8")
    if (!/^vault:.*$/m.test(text)) { console.error("no vault: line in wiki.config.proposed.yaml"); process.exit(1) }
    fs.writeFileSync("wiki.config.yaml", text.replace(/^vault:.*$/m, () => "vault: " + JSON.stringify(process.env.VAULT_PATH)))
  '
  ok "created wiki.config.yaml (it stays on this Mac; git ignores it)"
fi
CONFIG_VAULT="$(node -e '
  const yaml = require("js-yaml"), fs = require("fs")
  const v = String((yaml.load(fs.readFileSync("wiki.config.yaml", "utf8")) || {}).vault || "")
  console.log(v.startsWith("~") ? process.env.HOME + v.slice(1) : v)
')"
[[ -d "$CONFIG_VAULT" ]] || stop "The vault folder was not found: $CONFIG_VAULT" \
  "Open wiki.config.yaml in a text editor and correct the line that starts with  vault:" \
  "or delete wiki.config.yaml and run:  ./setup-mac.sh --vault \"/the/right/path\""
ok "vault found: $CONFIG_VAULT"

step "4/6  Test export (reads the vault, writes only into this folder)"
# A fresh clone has the published pages in content/ but not the export's own marker file.
# If git knows that folder and nothing in it was changed by hand, it is safe to let the export replace it.
if [[ -d content && ! -f content/.wiki-export && -n "$(ls -A content)" ]]; then
  if [[ -n "$(git ls-files content | head -1)" && -z "$(git status --porcelain content)" ]]; then
    echo "Created by scripts/export-vault.mjs — this folder is wiped on every export." > content/.wiki-export
  fi
fi
node scripts/export-vault.mjs
ok "export done, the report is in wiki-export-report.md"

step "5/6  Test build (nothing goes online)"
npx quartz build > .setup-build.log 2>&1 || { tail -20 .setup-build.log; stop "The build failed. The last lines are above; the full log is in .setup-build.log"; }
rm -f .setup-build.log
ok "the site builds"

step "6/6  GitHub sign-in (needed only for publishing)"
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  ok "signed in to GitHub"
else
  echo "  Not signed in yet. Once, before your first publish:"
  echo "    1. Install the GitHub command line tool: https://cli.github.com  (or: brew install gh)"
  echo "    2. Run:  gh auth login"
  echo "       choose: GitHub.com → HTTPS → Yes (authenticate Git) → Login with a web browser"
fi

printf '\n\033[1mSetup finished. Nothing was published.\033[0m\n'
echo "  Look at the wiki:   ./wiki.sh preview    then open http://localhost:8080"
echo "  Put it online:      ./wiki.sh publish    (asks before anything goes online)"
