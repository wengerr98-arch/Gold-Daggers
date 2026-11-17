# Gold Daggers wiki — setting up your Mac and publishing

The wiki is live. These are the steps to run it from your own Mac.
Nothing goes online until you run `./wiki.sh publish` and answer yes.

## Once: set up (about 10 minutes)

Open the **Terminal** app and paste these lines one at a time.

**1. Get the project** (into your Documents folder, outside the vault):

```
cd ~/Documents
git clone https://github.com/wengerr98-arch/Gold-Daggers
cd Gold-Daggers
```

If the Mac offers to install "command line developer tools", say yes, wait, and repeat the line.

**2. Run the setup script:**

```
./setup-mac.sh
```

It checks Node.js (version 22 or newer; if it is missing, the script tells you where to get it), installs what the wiki needs, creates your settings file `wiki.config.yaml` pointing at `~/Documents/Obsidian/Gold Daggers Vault V2`, and does a test export and a test build. It publishes nothing and never writes to the vault.

Vault somewhere else? `./setup-mac.sh --vault "/path/to/your vault"`

**3. Sign in to GitHub** (once, so that publishing works):

1. Install the GitHub command line tool from https://cli.github.com (download, double-click, next, next).
2. In Terminal: `gh auth login`
3. Choose: **GitHub.com** → **HTTPS** → **Yes** (authenticate Git with your GitHub credentials) → **Login with a web browser**.
4. Copy the code it shows, press Enter, paste the code in the browser, approve.

The Mac remembers this. You will not be asked again.

## Every time: preview, then publish

```
cd ~/Documents/Gold-Daggers
./wiki.sh preview
```

Open http://localhost:8080 and look around. Stop the preview with Ctrl+C.
Read `wiki-export-report.md` first: links that became plain text, keyword hits, new and changed pages.

```
./wiki.sh publish
```

Exports, builds, and asks before anything goes online. After a yes, GitHub rebuilds the site in a minute or two:
https://wengerr98-arch.github.io/Gold-Daggers/

## The repository is public

- Everything committed to this folder can be read by anyone, players included.
- `wiki.config.yaml` (your settings) and `wiki-export-report.md` stay on your Mac; git ignores them.
- Do not write spoiler details into files that get committed: this checklist, `map-pins.yaml`, `wiki.config.proposed.yaml`, commit messages.
- Only the player-safe export in `content/` is meant to be public.

## Switches (all in `wiki.config.yaml`)

| What | Setting |
|---|---|
| Web-sized images (smaller downloads on phones) | `images.optimize`, `images.max_size`, `images.quality` |
| Session header line and previous/next links | `sessions.header`, `sessions.nav`, `sessions.played_date` |
| Map pins (draft positions in `map-pins.yaml`) | `map.pins: true` once you have checked the positions |
| Map scale for the measuring tool | `map.scale`, `map.unit` |
| Tidy-up of the Historical Extracts note | `cleanup_extracts` |
| Re-flow session text that the import hard-wrapped | `text.unwrap: true` |
| Notes from the campaign bible | `include_notes` |
| Portraits | any image named exactly like a character note shows up automatically |
| Theme | campaign theme is the default; for the stock theme set `enabled: true` on `@quartz-themes/core` in `quartz.config.yaml` |

After changing a switch: `./wiki.sh preview` to look, `./wiki.sh publish` to put it online.

## Optional housekeeping

- Empty `_to_delete/` and `.wiki-snapshot/` in the vault when you no longer need them.

## If something goes wrong

- **"Vault not found"**: open `wiki.config.yaml` in a text editor and correct the `vault:` line.
- **Publish asks for a user name or password**: run `gh auth login` again (step 3).
- **Anything else**: run `./setup-mac.sh` again; it is safe to repeat and says what is missing.

## Timeline page (draft, off by default)
The Timeline page is built from the per-session timeline files (`session-NNN.json`), not from the vault.
Those files are **not in the repository**.

1. Put the `session-NNN.json` files in `private/timeline/sessions/` (the `private/` folder is ignored by git),
   or set `timeline.data` in `wiki.config.yaml` to the folder where they are (`~/…` works).
2. Set `timeline.enabled: true` in `wiki.config.yaml`.
3. `./wiki.sh preview` — the export now also runs `node scripts/build-timeline.mjs`, which writes
   `content/Timeline.md` and `content/timeline-data.json` and links the page on the front page.
   Read `wiki-timeline-report.md` (what was left out, data problems).

After a correction run: replace the JSON files and run `./wiki.sh preview` again. Nothing else to change.
Only entries marked `player_known` are used; DM notes and open questions never reach the page.
To switch it off again: `timeline.enabled: false`. The page and its front-page link disappear with the next export.
The display itself lives in `plugins/gd-timeline/` (styles and script; no build step, no outside libraries).
