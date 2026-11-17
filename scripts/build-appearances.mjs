#!/usr/bin/env node
// Gold Daggers wiki — "who was there"
// Adds to the exported pages in content/ (never to the vault):
//   session pages    a strip of the characters who appear in that session   (sessions.who_was_there)
//   character pages  "Seen in": first and last session, how many, the full list (seen_in.enabled)
//   place pages      "Visited in" (seen_in.places) · item pages "Mentioned in" (seen_in.items)
//   Arcs/Arc N.md    one page per campaign arc of home.arcs: its sessions, most-seen characters,
//                    main places; linked from the front page's arcs table and the session header (arc_pages.enabled)
// Run it AFTER scripts/export-vault.mjs and scripts/build-timeline.mjs (wiki.sh does).
//
// Where "appears" comes from — both are already player-safe:
//   1. links in the published session note to a published page
//   2. content/timeline-data.json, the file the timeline builder wrote (player-known events only)
//   3. for the kinds named in seen_in.appearance_lists (default: items only): the note's own
//      "## Session Appearances" list, which is published text
// Only pages that exist in content/ are ever linked. Nothing is written in the script's own words
// except short labels ("The party", "Also mentioned"). Session summaries on arc pages are the
// first lines of the summary the published session note already has.
//
// Usage: node scripts/build-appearances.mjs [--config wiki.config.yaml]

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import yaml from "js-yaml"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : undefined
}
const configPath = path.resolve(ROOT, arg("--config") ?? "wiki.config.yaml")
if (!fs.existsSync(configPath)) {
  console.error("✗ Who was there: no wiki.config.yaml.")
  process.exit(1)
}
const cfg = yaml.load(fs.readFileSync(configPath, "utf8")) ?? {}
const expandHome = (p) => (p?.startsWith("~") ? path.join(process.env.HOME ?? "", p.slice(1)) : p)
const OUT = path.resolve(ROOT, expandHome(cfg.output ?? "content"))
if (!fs.existsSync(path.join(OUT, ".wiki-export"))) {
  console.error(`✗ Who was there: ${OUT} is not an export folder. Run the export first.`)
  process.exit(1)
}

const on = {
  who: cfg.sessions?.who_was_there !== false,
  seen: cfg.seen_in?.enabled !== false,
  seenPlaces: cfg.seen_in?.enabled !== false && cfg.seen_in?.places !== false,
  seenItems: cfg.seen_in?.enabled !== false && cfg.seen_in?.items !== false,
  arcs: cfg.arc_pages?.enabled !== false && (cfg.home?.arcs ?? []).length > 0,
}
const ARC_FOLDER = String(cfg.arc_pages?.folder ?? "Arcs").replace(/^\/+|\/+$/g, "")
const ARC_PEOPLE = Number(cfg.arc_pages?.characters ?? 12)
const ARC_PLACES = Number(cfg.arc_pages?.places ?? 8)
// summaries that are only the import's placeholder say nothing about the session: left out
const ARC_SKIP = (cfg.arc_pages?.skip_summaries ?? ["^Draft import of Session"]).map((x) => new RegExp(x, "i"))
const ARC_SUMMARY = cfg.arc_pages?.summaries === false ? 0 : Number(cfg.arc_pages?.summary_length ?? 260)
// whose own "Session Appearances" list also counts: characters | places | items
const LISTS = new Set((cfg.seen_in?.appearance_lists ?? ["items"]).map((x) => String(x).toLowerCase()))
const WHO_CAP = Number(cfg.sessions?.who_phone_cap ?? 8)
if (!Object.values(on).some(Boolean)) {
  console.log("· Who was there: all switched off. Nothing written.")
  process.exit(0)
}

// ---------- the exported pages ----------

const alias = (vaultFolder, fallback) => cfg.folder_aliases?.[vaultFolder] ?? fallback
const F = {
  sessions: alias("01_sessions", "Sessions"),
  entities: alias("03_Entities", "Entities"),
  places: alias("04_Places", "Places"),
  items: alias("05_Items and Artefacts", "Items and Artefacts"),
}
const inFolder = (rel, f) => rel.startsWith(f + "/")
const toPosix = (p) => p.split(path.sep).join("/")
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, acc)
    else acc.push(toPosix(path.relative(OUT, full)))
  }
  return acc
}
fs.rmSync(path.join(OUT, ARC_FOLDER), { recursive: true, force: true }) // always rebuilt from scratch
const files = walk(OUT)
// same rule as Quartz 5 (and scripts/build-timeline.mjs): lower-case slugs
const slugSeg = (s) => s.replace(/\s/g, "-").replace(/&/g, "-and-").replace(/%/g, "-percent").replace(/\?/g, "").replace(/#/g, "").replace(/[<>:"|*]/g, "").toLowerCase()
const slugOf = (rel) => rel.replace(/\.md$/i, "").split("/").map(slugSeg).join("/")
const baseOf = (rel) => path.posix.basename(rel).replace(/\.md$/i, "")

// our own blocks: one line each, always written as "\n<block>\n\n", so a re-run (and the export's change report) can take them out exactly
const GENERATED = /\n<div class="gd-(?:who|seen)\b[^\n]*\n\n/g
const ARC_LINK = /<a class="gd-arc-link"[^>]*>([^<]*)<\/a>/g // the arc label in a session header, once linked
const ARC_ROW = /\[\[[^\]|\n]*\/Arc \d+\\\|([^\]\n]*)\]\]/g // a linked row of the front page's arcs table
const pages = new Map() // rel → { rel, name, fm, head, body, kind }
const bySlug = new Map()
const byBase = new Map()
const byPath = new Map()
const byAlias = new Map()
const assetsByBase = new Map()
const push = (m, k, v) => (m.has(k) ? m.get(k).push(v) : m.set(k, [v]))
const partyFolders = [`${F.entities}/Player Characters`, `${F.entities}/Companions`]
const peopleFolders = (cfg.portraits?.folders ?? ["03_Entities/NPCs", "03_Entities/Companions", "03_Entities/Player Characters", "03_Entities/Gods", "03_Entities/Titans", "03_Entities/Monsters"]).map((f) =>
  String(f).replace(/^\/+|\/+$/g, "").replace(/^03_Entities/, F.entities),
)
function kindOf(rel) {
  if (inFolder(rel, F.sessions)) return "session"
  if (partyFolders.some((f) => inFolder(rel, f))) return "party"
  if (peopleFolders.some((f) => inFolder(rel, f))) return "person"
  if (inFolder(rel, F.entities)) return "entity"
  if (inFolder(rel, F.places)) return "place"
  if (inFolder(rel, F.items)) return "item"
  return "other"
}
for (const rel of files) {
  if (!rel.toLowerCase().endsWith(".md")) {
    assetsByBase.set(path.posix.basename(rel).toLowerCase(), rel)
    continue
  }
  const text = fs.readFileSync(path.join(OUT, rel), "utf8")
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  let fm = {}
  try {
    fm = m ? (yaml.load(m[1]) ?? {}) : {}
  } catch {}
  const page = { rel, name: baseOf(rel), fm, head: m ? m[0] : "", body: (m ? text.slice(m[0].length) : text).replace(GENERATED, "").replace(ARC_LINK, "$1").replace(ARC_ROW, "$1"), kind: kindOf(rel), raw: text }
  pages.set(rel, page)
  bySlug.set(slugOf(rel), page)
  byPath.set(rel.replace(/\.md$/i, "").toLowerCase(), page)
  push(byBase, page.name.toLowerCase(), page)
  for (const a of [].concat(fm.aliases ?? [])) if (a) push(byAlias, String(a).toLowerCase(), page)
}
// an Obsidian link target → the page it means (path, then note name, then alias; ambiguous names stay unlinked)
function resolve(target) {
  const t = String(target).split("#")[0].replace(/\.md$/i, "").trim().toLowerCase()
  if (!t) return null
  if (byPath.has(t)) return byPath.get(t)
  const tail = [...byPath.keys()].filter((k) => k.endsWith("/" + t))
  if (t.includes("/")) return tail.length === 1 ? byPath.get(tail[0]) : null
  const c = byBase.get(t) ?? byAlias.get(t) ?? []
  return c.length === 1 ? c[0] : null
}

// ---------- sessions ----------

const sessions = new Map() // number → { n, page, title }
for (const p of pages.values()) {
  if (p.kind !== "session") continue
  const m = p.name.match(/^Session\s+0*(\d+)(?:\s+-\s+(.+))?$/i)
  if (!m) continue
  const n = Number(m[1])
  if (!sessions.has(n)) sessions.set(n, { n, page: p, title: m[2]?.trim() ?? "" })
}

// ---------- who appears where ----------

const seen = new Map() // page rel → Map(session number → weight)
const mark = (page, n, w = 1) => {
  if (!page || !sessions.has(n)) return
  if (!seen.has(page.rel)) seen.set(page.rel, new Map())
  const m = seen.get(page.rel)
  m.set(n, (m.get(n) ?? 0) + w)
}
const counts = { links: 0, timeline: 0, lists: 0 }
// 1. links in the session notes (not the previous/next links at the foot)
for (const s of sessions.values()) {
  const body = s.page.body.replace(/<div class="session-nav">[\s\S]*?<\/div>/g, "")
  const hit = new Set()
  for (const m of body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
    const p = resolve(m[1].replace(/\\$/, ""))
    if (p && p.kind !== "session" && p.kind !== "other" && !hit.has(p.rel)) {
      hit.add(p.rel)
      mark(p, s.n)
      counts.links++
    }
  }
}
// 2. the timeline builder's player-safe data file
const tlFile = path.join(OUT, "timeline-data.json")
let timeline = null
if (fs.existsSync(tlFile)) {
  try {
    timeline = JSON.parse(fs.readFileSync(tlFile, "utf8"))
  } catch (e) {
    console.error(`! Who was there: could not read timeline-data.json (${e.message}). Using links only.`)
  }
}
if (timeline) {
  const people = (timeline.people ?? []).map((p) => (p.href ? (bySlug.get(p.href) ?? null) : null))
  const place = (pl, n) => {
    for (const [, href] of pl?.l ?? []) {
      const p = bySlug.get(href)
      if (p) mark(p, n), counts.timeline++
    }
  }
  for (const e of timeline.events ?? []) {
    for (const i of [...(e.n ?? []), ...(e.c ?? [])]) if (people[i]) mark(people[i], e.s), counts.timeline++
    place(e.p, e.s)
  }
  for (const s of timeline.sessions ?? []) place(s.place, s.n)
}

// 3. a note's own "## Session Appearances" list ("- Session 045: …"), only for the kinds asked for
const listKind = { party: "characters", person: "characters", entity: "characters", place: "places", item: "items" }
for (const p of pages.values()) {
  if (!LISTS.has(listKind[p.kind])) continue
  const sec = p.body.match(/^##\s+Session Appearances[ \t]*\n([\s\S]*?)(?=\n##\s|(?![\s\S]))/m)
  if (!sec) continue
  const had = new Set(seen.get(p.rel)?.keys() ?? [])
  for (const m of sec[1].matchAll(/^[ \t]*[-*][ \t]+\**Sessions?[ \t]+0*(\d+)\b/gim)) {
    const n = Number(m[1])
    if (!had.has(n)) had.add(n), mark(p, n), counts.lists++
  }
}

// ---------- html helpers ----------

const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
// a relative link from one page to another page or picture (the site lives in a sub-folder online)
function hrefFrom(fromRel, toSlug) {
  const depth = slugOf(fromRel).split("/").length - 1
  return "../".repeat(depth) + toSlug // as it is: Quartz slugifies hrefs again, so percent-encoding would break names with commas
}
function portraitOf(page) {
  const m = String(page.fm.image ?? "").match(/\[\[([^\]|]+)/)
  const rel = m ? assetsByBase.get(path.posix.basename(m[1]).toLowerCase()) : null
  return rel ? rel.split("/").map(slugSeg).join("/") : null
}
const titleOf = (page) => String(page.fm.title ?? page.name)
function chip(fromRel, page, extra = "", note = "") {
  const img = portraitOf(page)
  const name = titleOf(page)
  const av = img ? `<img class="gd-av" src="${esc(hrefFrom(fromRel, img))}" alt="" loading="lazy">` : `<span class="gd-av is-ph" aria-hidden="true">${esc([...name.replace(/^[^\p{L}\p{N}]+/u, "")][0]?.toUpperCase() ?? "?")}</span>`
  return `<a class="gd-chip${extra}" href="${esc(hrefFrom(fromRel, slugOf(page.rel)))}">${av}<span class="gd-chip-name">${esc(name)}</span>${note}</a>`
}
const sessionLabel = (s) => `Session ${s.n}${s.title ? ` · ${s.title}` : ""}`
function insertAfterTitle(body, block, { afterPortrait = false, afterMeta = false } = {}) {
  const m = body.match(/^(\s*#\s+[^\n]*\n)/)
  if (!m) return "\n" + block + "\n\n" + body
  let at = m[1].length
  const skip = (re) => {
    const x = body.slice(at).match(re)
    if (x) at += x[0].length
  }
  if (afterMeta) skip(/^\s*<p class="session-meta">[^\n]*\n/)
  if (afterPortrait) skip(/^\s*!\[\[[^\]\n]+\]\][ \t]*\n/)
  return body.slice(0, at) + "\n" + block + "\n\n" + body.slice(at)
}
const changed = new Set()

// ---------- session pages: who was there ----------

const stats = { strips: 0, chips: 0, biggest: [0, 0] }
if (on.who) {
  for (const s of sessions.values()) {
    const here = [...seen].filter(([rel, m]) => m.has(s.n) && ["party", "person"].includes(pages.get(rel).kind)).map(([rel, m]) => ({ page: pages.get(rel), w: m.get(s.n) }))
    if (!here.length) continue
    const order = (a, b) => b.w - a.w || a.page.name.localeCompare(b.page.name)
    const pcFirst = (a, b) => Number(inFolder(b.page.rel, partyFolders[0])) - Number(inFolder(a.page.rel, partyFolders[0])) || order(a, b)
    const party = here.filter((x) => x.page.kind === "party").sort(pcFirst)
    const others = here.filter((x) => x.page.kind === "person").sort(order)
    const hidden = Math.max(0, others.length - WHO_CAP)
    const group = (label, list, cap) =>
      list.length ? `<div class="gd-who-group"><span class="gd-who-label">${label}</span><span class="gd-who-list">${list.map((x, i) => chip(s.page.rel, x.page, cap && i >= WHO_CAP ? " is-extra" : "")).join("")}</span></div>` : ""
    const id = `gd-who-${s.n}`
    const more = hidden > 1 ? `<label class="gd-who-more" for="${id}"><span class="gd-who-plus">+${hidden}</span><span class="gd-who-less">show fewer</span></label>` : ""
    const block = `<div class="gd-who" aria-label="Who was there">${more ? `<input type="checkbox" class="gd-who-toggle" id="${id}" aria-label="Show everyone">` : ""}${group("The party", party, false)}${group(party.length ? "Also mentioned" : "Mentioned", others, hidden > 1)}${more}</div>`
    s.page.body = insertAfterTitle(s.page.body, block, { afterMeta: true })
    changed.add(s.page.rel)
    stats.strips++
    stats.chips += here.length
    if (here.length > stats.biggest[1]) stats.biggest = [s.n, here.length]
  }
}

// ---------- character, place and item pages: seen in ----------

const seenStats = { characters: 0, places: 0, items: 0 }
if (on.seen) {
  const label = { party: "Seen in", person: "Seen in", entity: "Seen in", place: "Visited in", item: "Mentioned in" }
  for (const [rel, m] of seen) {
    const p = pages.get(rel)
    if (!label[p.kind] || (p.kind === "place" && !on.seenPlaces) || (p.kind === "item" && !on.seenItems)) continue
    const list = [...m.keys()].sort((a, b) => a - b).map((n) => sessions.get(n))
    const a = (s, text) => `<a href="${esc(hrefFrom(rel, slugOf(s.page.rel)))}">${esc(text)}</a>`
    const first = list[0], last = list[list.length - 1]
    const bits =
      list.length === 1
        ? [`${label[p.kind]} 1 session`, a(first, sessionLabel(first))]
        : [`${label[p.kind]} ${list.length} sessions`, `first ${a(first, sessionLabel(first))}`, `last ${a(last, sessionLabel(last))}`]
    const all =
      list.length > 2
        ? `<details><summary>All ${list.length} sessions</summary><ul>${list.map((s) => `<li>${a(s, `Session ${s.n}`)}${s.title ? ` <span>${esc(s.title)}</span>` : ""}</li>`).join("")}</ul></details>`
        : ""
    const block = `<div class="gd-seen"><p>${bits.map((b) => `<span>${b}</span>`).join(" ")}</p>${all}</div>`
    p.body = insertAfterTitle(p.body, block, { afterPortrait: true })
    changed.add(rel)
    seenStats[listKind[p.kind]]++
  }
}

// ---------- arc pages ----------

const arcStats = { pages: 0, headers: 0, home: 0 }
if (on.arcs) {
  // same reading of home.arcs as the export's session header
  const arcs = cfg.home.arcs
    .map((a, i) => {
      const m = String(a.sessions ?? "").match(/^\s*(\d+)\s*(?:[–—-]\s*(\d+)?)?\s*$/)
      if (!m) return null
      const from = Number(m[1])
      const to = m[2] ? Number(m[2]) : /[–—-]/.test(a.sessions) ? Infinity : from
      const name = String(a.name ?? "").replace(/[*_]/g, "").trim()
      const list = [...sessions.values()].filter((s) => s.n >= from && s.n <= to).sort((x, y) => x.n - y.n)
      return { i: i + 1, name, title: /^\(.*\)$/.test(name) ? `Arc ${i + 1} ${name}` : `Arc ${i + 1} · ${name}`, range: String(a.sessions).trim(), list, rel: `${ARC_FOLDER}/Arc ${i + 1}.md` }
    })
    .filter((a) => a && a.list.length)
  const tlSession = new Map((timeline?.sessions ?? []).map((s) => [s.n, s]))
  const playedOf = (s) => s.page.body.match(/<p class="session-meta">.*?<span>played (\d{4}-\d{2}-\d{2})<\/span>/)?.[1] ?? tlSession.get(s.n)?.played ?? null
  // in-world year: the session's own date line ("831 p.b. | Sommer | Aarum"), else the timeline's year for that session
  const yearOf = (s) => {
    const d = s.page.body.match(/^[ \t]*(?:#{1,6}[ \t]+)?[*_]*[ \t]*(\d{1,4})\s*p\.?\s*b\.?\s*\\?\|/im)
    if (d) return { y: Number(d[1]), stated: true }
    const y = tlSession.get(s.n)?.y
    return y == null ? null : { y, stated: false }
  }
  // the summary the session note already has: its first paragraph (or its sub-headings), shortened at a word
  const summaryOf = (s) => {
    const sm = s.page.body.match(/^##\s+(?:Extracted Summary|Summary|Session Summary)[ \t]*\n([\s\S]*?)(?=\n##\s|(?![\s\S]))/m)
    if (!sm || !ARC_SUMMARY) return ""
    const subs = [...sm[1].matchAll(/^###\s+(.+)$/gm)].map((x) => x[1].trim()).filter((h) => !/^(timeline|key revelations|entities|open threads)$/i.test(h))
    const paras = sm[1].split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p && !/^#{1,6}\s/.test(p) && !/^[-*]\s/.test(p) && !/^</.test(p))
    let t = (subs.length >= 2 ? subs.join(" · ") : (paras[0] ?? "")).replace(/\s*\n\s*/g, " ")
    if (ARC_SKIP.some((re) => re.test(t))) return ""
    if (t.length > ARC_SUMMARY) {
      t = t.slice(0, ARC_SUMMARY).replace(/\s+\S*$/, "")
      const open = t.lastIndexOf("[[")
      if (open > t.lastIndexOf("]]")) t = t.slice(0, open).trimEnd() // never cut a link in half
      t = t.replace(/[,;:–-]+$/, "") + " …"
    }
    return t
  }
  const wl = (rel, text) => `[[${rel.replace(/\.md$/i, "")}|${text}]]`
  fs.mkdirSync(path.join(OUT, ARC_FOLDER), { recursive: true })
  arcs.forEach((arc, idx) => {
    const inArc = new Set(arc.list.map((s) => s.n))
    const tally = (kinds) =>
      [...seen]
        .filter(([rel]) => kinds.includes(pages.get(rel).kind))
        .map(([rel, m]) => ({ page: pages.get(rel), w: [...m.keys()].filter((n) => inArc.has(n)).length }))
        .filter((x) => x.w > 0)
        .sort((a, b) => b.w - a.w || a.page.name.localeCompare(b.page.name))
    const count = (x) => `<span class="gd-chip-n">${x.w}</span>`
    const party = tally(["party"])
    const others = tally(["person"]).slice(0, ARC_PEOPLE)
    const places = tally(["place"]).slice(0, ARC_PLACES)
    const group = (label, list) => (list.length ? `<div class="gd-who-group"><span class="gd-who-label">${label}</span><span class="gd-who-list">${list.map((x) => chip(arc.rel, x.page, "", count(x))).join("")}</span></div>` : "")
    const played = arc.list.map(playedOf).filter(Boolean).sort()
    const years = arc.list.map(yearOf).filter(Boolean)
    const y0 = years[0], y1 = years[years.length - 1]
    const world = y0 ? `${y0.y === y1.y ? y0.y : `${y0.y}–${y1.y}`} p.B.${years.every((y) => y.stated) || !timeline?.draft ? "" : " (timeline draft)"}` : null
    const nums = arc.list.map((s) => s.n)
    const meta = [`Sessions ${nums[0]}${nums.length > 1 ? `–${nums[nums.length - 1]}` : ""}`, `${nums.length} session${nums.length > 1 ? "s" : ""}`, world ? `in the world ${world}` : null, played.length ? `played ${played[0]}${played.length > 1 && played[played.length - 1] !== played[0] ? ` – ${played[played.length - 1]}` : ""}` : null].filter(Boolean)
    const L = [`<p class="session-meta">${meta.map((b) => `<span>${esc(b)}</span>`).join(" ")}</p>`, ``]
    if (party.length || others.length) L.push(`## Most seen`, ``, `<div class="gd-who gd-who-arc" aria-label="Most seen, with the number of sessions">${group("The party", party)}${group("Others", others)}</div>`, ``)
    if (places.length) L.push(`## Places`, ``, `<p class="gd-arc-places">${places.map((x) => `<span><a href="${esc(hrefFrom(arc.rel, slugOf(x.page.rel)))}">${esc(titleOf(x.page))}</a> <span class="gd-chip-n">${x.w}</span></span>`).join(" ")}</p>`, ``)
    L.push(`## Sessions`, ``)
    for (const s of arc.list) {
      const date = playedOf(s)
      const sum = summaryOf(s)
      L.push(`- ${wl(s.page.rel, `Session ${s.n}`)}${s.title ? ` · *${s.title.replace(/([*_\[\]])/g, "\\$1")}*` : ""}${date ? ` <span class="gd-arc-date">${date}</span>` : ""}${sum ? `<br><span class="gd-arc-sum">${sum}</span>` : ""}`)
    }
    const prev = arcs[idx - 1], next = arcs[idx + 1]
    const tl = cfg.timeline?.enabled ? `[[${cfg.timeline.title ?? "Timeline"}|On the timeline]]` : ""
    L.push(``, `<div class="session-nav gd-arc-nav">`, ``, `<span class="session-prev">${prev ? wl(prev.rel, `← ${prev.title}`) : ""}</span> ${tl ? `<span class="gd-arc-tl">${tl}</span> ` : ""}<span class="session-next">${next ? wl(next.rel, `${next.title} →`) : ""}</span>`, ``, `</div>`)
    fs.writeFileSync(path.join(OUT, arc.rel), `---\ntitle: ${JSON.stringify(arc.title)}\npublish: true\n---\n\n${L.join("\n")}\n`)
    arcStats.pages++
    // the arc label in each session's header line becomes a link to the arc page
    for (const s of arc.list) {
      const linked = s.page.body.replace(/(<p class="session-meta">.*?<span>)(Arc \d+\b[^<]*)(<\/span>)/, (_, a, label, z) => `${a}<a class="gd-arc-link" href="${esc(hrefFrom(s.page.rel, slugOf(arc.rel)))}">${label}</a>${z}`)
      if (linked !== s.page.body) (s.page.body = linked), changed.add(s.page.rel), arcStats.headers++
    }
  })
  // the front page's arcs table (only the generated one has it)
  const home = pages.get("index.md")
  if (home) {
    for (const arc of arcs) {
      const row = new RegExp(`^(\\|\\s*)(${arc.i} · [^|\\n]*?)(\\s*\\|[^|\\n]*\\|\\s*)$`, "m")
      home.body = home.body.replace(row, (_, a, label, z) => (arcStats.home++, `${a}[[${arc.rel.replace(/\.md$/i, "")}\\|${label.match(/^[^*_]*/)[0].trimEnd()}]]${label.slice(label.match(/^[^*_]*/)[0].trimEnd().length)}${z}`))
    }
  }
}
for (const p of pages.values()) if (p.head + p.body !== p.raw) changed.add(p.rel)

// ---------- write ----------

for (const rel of changed) {
  const p = pages.get(rel)
  const dest = path.join(OUT, rel)
  const st = fs.statSync(dest)
  fs.writeFileSync(dest, p.head + p.body)
  fs.utimesSync(dest, st.atime, st.mtime)
}
console.log(`✓ Who was there: ${timeline ? "links + timeline data" : "links only (no timeline data file)"}`)
if (on.who) console.log(`  session strips: ${stats.strips} of ${sessions.size} sessions, ${stats.chips} portraits/initials in all (most: Session ${stats.biggest[0]} with ${stats.biggest[1]})`)
if (on.seen) console.log(`  "Seen in": ${seenStats.characters} characters and factions, ${seenStats.places} places ("Visited in"), ${seenStats.items} items ("Mentioned in")${counts.lists ? ` — ${counts.lists} session entries from the notes' own Session Appearances lists` : ""}`)
if (on.arcs) console.log(`  arc pages: ${arcStats.pages} in ${ARC_FOLDER}/, linked from ${arcStats.headers} session headers and ${arcStats.home} rows of the front page`)
