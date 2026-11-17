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
| "Who was there" strip of portraits on session pages | `sessions.who_was_there`, `sessions.who_phone_cap` (how many faces a phone shows before "+N") |
| "Seen in" on character pages, "Visited in" on places, "Mentioned in" on items | `seen_in.enabled`, `seen_in.places`, `seen_in.items`; `seen_in.appearance_lists` says for which kinds the note's own Session Appearances list counts too |
| Arc pages (folder `Arcs`), linked from the front page and the session header | `arc_pages.enabled`; `arc_pages.characters`, `arc_pages.places`, `arc_pages.summaries` |
| Map pins (draft positions in `map-pins.yaml`) | `map.pins: true` once you have checked the positions |
| Map scale for the measuring tool | `map.scale`, `map.unit` |
| Timeline search: other names, story text, places | `timeline.aliases`, `timeline.story_search`, `timeline.places` (each on unless set to `false`) |
| "On the timeline →" on session, character and place pages | `timeline.backlinks` (on unless set to `false`) |
| Tidy-up of the Historical Extracts note | `cleanup_extracts` |
| Re-flow session text that the import hard-wrapped | `text.unwrap: true` |
| Converter "grid tables" (boxes of `+---+` and pipes) shown as normal tables | `cleanup.grid_tables` (on), `cleanup.grid_tables_long: sections \| table` |
| Converter picture embeds (`media/image8.jpg`): use the file if it is in the vault, otherwise drop the broken embed and list it in the report | `cleanup.missing_images` (on), `cleanup.image_blocked_folders` |
| The import's word "sidecar" on NPC and place pages | `cleanup.sidecar: keep \| reword \| remove` (keep until you decide) |
| Links like `[[Session 084]]` open the session page even when the note has a title in its name | `cleanup.session_links` (on) |
| Protocol text that sits in a code box (sessions 040–050) shown as normal text | `cleanup.protocol_fences` (on) |
| Leftover headings (title repeated, empty `##`, the next session's heading at the end) removed | `cleanup.stray_headings` (on) |
| Converter marks `[words]{.mark}` / `{.underline}` shown as highlight / underline | `cleanup.converter_marks` (on) |
| "OUTPUT TRUNCATED" lines of the import tool replaced by a plain note | `cleanup.truncation_notes` (on), `cleanup.truncation_label` |
| E-mail addresses never go online (the linked name stays) | `cleanup.email_addresses` (on) |
| The import's own remarks taken out ("Draft import of …", "Not extracted in first pass", "(stub needed)", "DM to confirm", "Title Unknown"); the fact next to the remark stays | `cleanup.import_notes` (on) |
| Links to a name no note has open the note they mean (list of names in `link-aliases.yaml`) | `cleanup.link_aliases` (on), `cleanup.link_aliases_file` |
| Notes with nothing but an import placeholder are left out (the report lists them either way) | `cleanup.hide_empty` (off), `cleanup.hide_empty_max_words` (0) |
| Lines that name the DM as the source of a fact ("confirmed by DM", "per DM correction note"): listed in the report, or taken out | `cleanup.dm_sourced` (keep \| remove) |
| Players' real-world details: "Anwesend:", "Protokoll:", "Location:" lines, D&D Beyond profile links and embedded sheets | `cleanup.player_details` (keep \| strip) |
| Former @-mentions: full name or first name only | `cleanup.mention_names` (keep \| first_name) |
| Notes from the campaign bible | `include_notes` |
| Table tool: portrait full screen + line-up for the TV (off) | `table.spotlight: true` |
| Table tool: portrait quiz "Who is this?" (off) | `table.quiz: true` |
| Table tool: private pins and notes, Logbook page (off) | `table.logbook: true` |
| Removed document links point to a copy in the wiki (off until set) | `cleanup.doc_link_targets:` map in the local `wiki.config.yaml` (address part → vault note); the note must be in `include_notes` |
| Portraits | any image named exactly like a character note shows up automatically |
| Theme | campaign theme is the default; for the stock theme set `enabled: true` on `@quartz-themes/core` in `quartz.config.yaml` |

After changing a switch: `./wiki.sh preview` to look, `./wiki.sh publish` to put it online.

## Optional housekeeping

- Empty `_to_delete/` and `.wiki-snapshot/` in the vault when you no longer need them.

## If something goes wrong

- **"Vault not found"**: open `wiki.config.yaml` in a text editor and correct the `vault:` line.
- **Publish asks for a user name or password**: run `gh auth login` again (step 3).
- **Anything else**: run `./setup-mac.sh` again; it is safe to repeat and says what is missing.

## Table tools (off by default)
Small things for the game table, each with its own switch under `table:` in `wiki.config.yaml`.
None of them needs live updates: what they remember stays in the visitor's browser, on that device (nothing is sent anywhere, nothing syncs).
After changing a switch: `./wiki.sh preview`. Switched off, a tool leaves no page, no link and no script on the site.
They only reuse what the export already publishes (names, portraits, page addresses); they add no campaign text.

- **Spotlight** (`table.spotlight`): a "Show at the table" button under every portrait opens it full screen with the name.
  The **Line-up** page (`/line-up`, in the explorer) lets you pick portraits beforehand and step through them:
  → next, ← back, B dark screen, N name on/off, F full screen, Esc close; on a phone tap the right or left half.
  The show starts and ends on a dark screen and never shows what comes next. Put the list together on your own screen, not on the TV.
  Only portraits that are already published can be shown.
- **Who is this?** (`table.quiz`): a quiz over the Gallery's portraits, face → name or name → face. Best streak is kept per device.
- **Logbook** (`table.logbook`): "Pin" and "Add a note" under every page title; the **Logbook** page lists them, with loose notes,
  copy as text and a backup file (the only way to move notes to another device). Notes are private to each reader's browser.

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
Other pages can link into the timeline: `timeline?s=109` (a session), `timeline?p=dr.-mason` (follow a person: page
name, slug or any other name), `timeline?place=kasta` (follow a place), `timeline?q=drache` (search the story),
`timeline?e=s31-e2` (one event), `&o=play` (play order). The Map page takes `map?place=kasta`.
To switch it off again: `timeline.enabled: false`. The page and its front-page link disappear with the next export.
The display itself lives in `plugins/gd-timeline/` (styles and script; no build step, no outside libraries).
