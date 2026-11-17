#!/usr/bin/env node
// Gold Daggers wiki — timeline builder
// Turns the per-session timeline extraction (session-NNN.json) into
//   content/Timeline.md          the page (container + plain fallback)
//   content/timeline-data.json   compact, player-safe data for the interactive view
// Run it AFTER scripts/export-vault.mjs: it reads content/ to link events to pages that exist
// and to check that every quote really is on the published session page.
//
// Usage: node scripts/build-timeline.mjs [--config wiki.config.yaml] [--data <folder>] [--force]
//
// Player safety: only entries with visibility "player_known" are used. Every dm_note,
// open question and working note of the extraction stays out of the output.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import yaml from "js-yaml"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : undefined
}
const fail = (msg) => {
  console.error(`✗ Timeline: ${msg}`)
  process.exit(1)
}

const configPath = path.resolve(ROOT, arg("--config") ?? "wiki.config.yaml")
if (!fs.existsSync(configPath)) fail("no wiki.config.yaml.")
const cfg = yaml.load(fs.readFileSync(configPath, "utf8")) ?? {}
const tcfg = cfg.timeline ?? {}
if (!tcfg.enabled && !process.argv.includes("--force")) {
  console.log("· Timeline is switched off (wiki.config.yaml → timeline.enabled). Nothing written.")
  process.exit(0)
}
const expandHome = (p) => (p?.startsWith("~") ? path.join(process.env.HOME ?? "", p.slice(1)) : p)
const OUT = path.resolve(ROOT, expandHome(cfg.output ?? "content"))
const DATA = path.resolve(ROOT, expandHome(arg("--data") ?? tcfg.data ?? "private/timeline/sessions"))
const REPORT = path.resolve(ROOT, tcfg.report ?? "wiki-timeline-report.md")
const TITLE = tcfg.title ?? "Timeline"
const OFFSET = Number(tcfg.ephraim_offset ?? 1321) // Ephraim's count = p.B. + offset
const APPROX_YEARS = new Set((tcfg.approx_years ?? [-5170]).map(Number))
const ZOOMS = { eras: "Eras", years: "Years", arcs: "Arcs", sessions: "Sessions", days: "Days" }
const DEFAULT_ZOOM = ZOOMS[String(tcfg.default_zoom ?? "arcs").toLowerCase()] ?? "Arcs" // level the page opens at
const DRAFT_NOTE = tcfg.draft_note === undefined ? "Draft — dates not yet confirmed by the DM." : tcfg.draft_note
// years that were retconned or typos in the protocols: lore that hangs on them is not placed
const DEAD_YEARS = (tcfg.retconned_years ?? [818, 997, 842, 841]).map(String)
// extra caution on top of the visibility flag: entries matching these patterns (set in the local
// wiki.config.yaml only; the repository is public) are held back until the DM decides
const HOLD_BACK = (tcfg.hold_back_patterns ?? []).map((s) => new RegExp(s, "i"))

if (!fs.existsSync(OUT) || !fs.existsSync(path.join(OUT, ".wiki-export"))) fail(`no export in ${OUT}. Run node scripts/export-vault.mjs first.`)

// ---------- input ----------

function findSessionFiles(dir) {
  if (!fs.existsSync(dir)) return []
  for (const d of [dir, path.join(dir, "sessions-corrected"), path.join(dir, "sessions")]) {
    if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) continue
    const fsn = fs.readdirSync(d).filter((f) => /^session-\d+\.json$/i.test(f)).sort()
    if (fsn.length) return fsn.map((f) => path.join(d, f))
  }
  return []
}
const files = findSessionFiles(DATA)
if (!files.length)
  fail(`no session-NNN.json files in ${DATA}.\n  Put the timeline files there (the folder is not in the repository) or set timeline.data in wiki.config.yaml.`)
const sessionsIn = files.map((f) => JSON.parse(fs.readFileSync(f, "utf8"))).sort((a, b) => a.session - b.session)

// ---------- what exists in content/ (for links and quote checks) ----------

const toPosix = (p) => p.split(path.sep).join("/")
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, acc)
    else if (e.name.toLowerCase().endsWith(".md")) acc.push(toPosix(path.relative(OUT, full)))
  }
  return acc
}
// same rule as Quartz 5 (@quartz-community/utils → slugifyPath): lower case
const slugSeg = (s) => s.replace(/\s/g, "-").replace(/&/g, "-and-").replace(/%/g, "-percent").replace(/\?/g, "").replace(/#/g, "").replace(/[<>:"|*]/g, "").toLowerCase()
const hrefOf = (rel) => rel.replace(/\.md$/i, "").split("/").map(slugSeg).join("/")
const PEOPLE_ORDER = ["Entities/Player Characters", "Entities/Companions", "Entities/NPCs", "Entities/Gods", "Entities/Titans", "Entities/Monsters", "Entities/Factions", "Entities"]
const PLACE_ORDER = ["Places", "Entities", "Items and Artefacts", "Campaign"]
const rank = (rel, order) => {
  const i = order.findIndex((f) => rel.startsWith(f + "/"))
  return i < 0 ? order.length : i
}
const notesByName = new Map() // lower name or alias → [{rel, alias}]
const sessionPages = new Map() // number → rel
const imageOf = new Map() // note rel → portrait file name, from the image: property the export sets
const assetsByBase = new Map() // "koda.webp" → rel in content/
;(function walkAssets(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walkAssets(full)
    else if (/\.(webp|png|jpe?g|gif|avif)$/i.test(e.name)) assetsByBase.set(e.name.toLowerCase(), toPosix(path.relative(OUT, full)))
  }
})(OUT)
const contentNotes = walk(OUT)
for (const rel of contentNotes) {
  const base = path.posix.basename(rel, ".md")
  const add = (k, alias) => {
    const key = k.trim().toLowerCase()
    if (!key) return
    if (!notesByName.has(key)) notesByName.set(key, [])
    notesByName.get(key).push({ rel, alias })
  }
  add(base, false)
  if (rel.startsWith("Sessions/")) {
    const m = base.match(/^Session\s+0*(\d+)/i)
    if (m) sessionPages.set(Number(m[1]), rel)
    continue
  }
  const txt = fs.readFileSync(path.join(OUT, rel), "utf8")
  const fm = txt.match(/^---\n([\s\S]*?)\n---/)
  if (fm) {
    try {
      const data = yaml.load(fm[1]) ?? {}
      for (const a of [].concat(data.aliases ?? [])) if (typeof a === "string") add(a, true)
      const im = typeof data.image === "string" ? data.image.match(/\[\[([^\]|#]+)/)?.[1] ?? data.image : null
      if (im) imageOf.set(rel, path.posix.basename(im.trim()).toLowerCase())
    } catch {}
  }
}
function resolveNote(name, order) {
  const hits = notesByName.get(String(name).trim().toLowerCase())
  if (!hits) return null
  return [...hits].sort((a, b) => Number(a.alias) - Number(b.alias) || rank(a.rel, order) - rank(b.rel, order))[0].rel
}

const norm = (s) => String(s).toLowerCase().replace(/[*_`>\[\]|#"'„“”‚‘’«»]/g, "").replace(/\s+/g, " ").trim()
const sessionText = new Map()
function quoteOnPage(n, quote) {
  if (!quote || !sessionPages.has(n)) return false
  if (!sessionText.has(n)) sessionText.set(n, norm(fs.readFileSync(path.join(OUT, sessionPages.get(n)), "utf8")))
  const page = sessionText.get(n)
  const parts = norm(quote.replace(/\([^)]*\)\s*$/, "")).split(/\s*(?:\.\.\.|…| \/ )\s*/).map((p) => p.replace(/^[\s.,;:!?-]+|[\s.,;:!?-]+$/g, "")).filter((p) => p.length >= 6)
  return parts.length > 0 && parts.every((p) => page.includes(p))
}

// ---------- helpers ----------

const stats = { eventsIn: 0, eventsOut: 0, loreIn: 0, loreDated: 0, loreUndated: 0, loreAsWritten: 0, left: {}, quotesKept: 0, quotesDropped: 0, linksPeople: 0, plainPeople: 0 }
const problems = { noYear: [], yearAssumed: [], loreNotPlaced: [], retconned: [], heldBack: [], oldOffset: [], noPlace: [], quoteMissing: [], unknownPeople: new Map(), openQuestions: 0, sessionsNoPage: [] }
const leave = (why) => (stats.left[why] = (stats.left[why] ?? 0) + 1)
const clean = (s) => (s == null ? null : String(s).replace(/\s+/g, " ").replace(/\s->\s/g, " → ").trim() || null)
const held = (x) => HOLD_BACK.some((re) => re.test(`${x.what ?? ""} ${x.evidence ?? ""} ${x.expression ?? ""} ${x.place ?? ""}`))
// the extraction sometimes kept its own arithmetic with the old, wrong +1428 offset in the text
const scrub = (s, where) => {
  if (!s || !/1428|2259/.test(s)) return s
  problems.oldOffset.push(where)
  return s.replace(/\s*(\(old count\?\))?\s*:.*$/, "").replace(/\s*\([^)]*(1428|2259)[^)]*\)/g, "").trim()
}

const people = new Map() // id → person
const personId = new Map() // key → id
function person(raw) {
  const s = clean(raw)
  if (!s) return null
  const m = s.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/)
  const target = m ? m[1].trim() : s
  const rel = resolveNote(target, PEOPLE_ORDER) ?? (m?.[2] ? resolveNote(m[2], PEOPLE_ORDER) : null)
  const linked = rel && rel.startsWith("Entities/")
  const key = linked ? "n:" + rel : "t:" + (m?.[2] ?? target).toLowerCase()
  if (!personId.has(key)) {
    const id = people.size
    const folder = linked ? rel.split("/")[1] : null
    people.set(id, {
      name: linked ? path.posix.basename(rel, ".md") : (m?.[2] ?? target),
      href: linked ? hrefOf(rel) : null,
      // portrait as Quartz serves it: same folders, slugified, extension kept
      img: linked && assetsByBase.has(imageOf.get(rel)) ? assetsByBase.get(imageOf.get(rel)).split("/").map(slugSeg).join("/") : null,
      kind: folder === "Player Characters" ? "pc" : folder === "Companions" ? "companion" : folder ? folder.replace(/s$/, "").toLowerCase() : "unlisted",
      ages: [],
      names: [],
    })
    personId.set(key, id)
    if (linked) stats.linksPeople++
    else {
      stats.plainPeople++
      problems.unknownPeople.set(m?.[2] ?? target, 0)
    }
  }
  return personId.get(key)
}
// "Storm near [[Kasta]]" → text + links to the places that have a page
function place(raw) {
  const s = clean(raw)
  if (!s) return null
  const links = []
  const text = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => {
    const rel = resolveNote(target, PLACE_ORDER)
    const shown = (label ?? target).trim()
    if (rel) links.push([shown, hrefOf(rel)])
    return shown
  })
  if (!links.length) {
    const rel = resolveNote(text, PLACE_ORDER)
    if (rel && (rel.startsWith("Places/") || rel.startsWith("Entities/"))) links.push([text, hrefOf(rel)])
  }
  return links.length ? { t: text, l: links } : { t: text }
}

function parseArcs() {
  return (cfg.home?.arcs ?? []).map((a, i) => {
    const m = String(a.sessions).match(/(\d+)\s*[–-]\s*(\d+)?/)
    return { n: i + 1, name: String(a.name).replace(/\*/g, "").replace(/^\((.*)\)$/, "$1"), from: m ? Number(m[1]) : 0, to: m?.[2] ? Number(m[2]) : null }
  })
}
const arcs = parseArcs()
const arcOf = (n) => arcs.find((a) => n >= a.from && (a.to == null || n <= a.to))?.n ?? null

// a new day (or a longer gap) starts with this event?
const dayBreak = (off) => !!off && !/^(same|during|continuous|immediately|unclear|unknown|-\d)/i.test(off) && /\bnext (morning|day|evening|night)|^\+\s*\d|a night later|following (day|morning|night)|\b(days?|weeks?|months?|years?) (after|later)|^(several|a few|some|about|ca\.?|~)\s*\d*\s*(days?|weeks?|months?)|time jump/i.test(off)

// "≈ 431–631 p.B." → { y: 431, to: 631, approx: true }
function loreYear(h) {
  const d = clean(h.derived_year)
  const cal = String(h.calendar_as_written ?? "")
  if (/unknown_count|stygian/i.test(cal)) return { asWritten: /stygian/i.test(cal) ? "Stygian count" : "tavern logbook count" }
  if (!d || /^(none|null|unknown|n\/a)/i.test(d)) return null
  const all = `${d} ${h.expression ?? ""} ${h.dm_note ?? ""}`
  if (DEAD_YEARS.some((y) => new RegExp(`(^|\\D)${y}(\\D|$)`).test(`${d} ${h.expression ?? ""}`)) || /retcon|typo/i.test(h.dm_note ?? "")) return { dead: true }
  if (/not derivable|no pB year|only if|if p\.B\.|^unclear|^unknown|^before|^relative|^null|^\(/i.test(d)) return null
  const m = d.match(/(-?\d+)\s*(?:[-–]\s*(\d+))?\s*p\.B\./)
  if (!m) return null
  const y = Number(m[1])
  const to = m[2] ? Number(m[2]) : null
  return { y, to, approx: to != null || /[≈~?]|ca\.|approx|about|shortly|if |\bor\b/i.test(d) || /Ephraim/i.test(cal) === false && /relative/i.test(cal), ephraim: /ephraim/i.test(cal) }
}

// ---------- build ----------

const sessions = []
const events = []
const lore = []
let home = null // the party's "present" year as play goes on
let prevSessionYear = null

for (const d of sessionsIn) {
  const n = d.session
  const wd = d.world_date ?? {}
  problems.openQuestions += (d.open_questions ?? []).length
  const stated = Number.isFinite(wd.year) ? wd.year : null
  const tt = d.time_travel ?? null
  if (tt && Number.isFinite(tt.from_year)) home = tt.from_year
  else if (stated != null && (home == null || (stated >= home && stated <= home + 1))) home = stated
  const rel = sessionPages.get(n) ?? null
  if (!rel) problems.sessionsNoPage.push(n)
  const title = rel ? path.posix.basename(rel, ".md").replace(/^Session\s+\d+\s*(-\s*)?/i, "") || null : null
  const s = {
    n,
    title,
    href: rel ? hrefOf(rel) : null,
    played: clean(d.real_date),
    y: stated != null && stated >= (home ?? stated) - 1 && stated <= (home ?? stated) + 1 ? stated : home,
    season: clean(wd.season),
    hint: clean(wd.day_hint),
    since: clean(wd.offset),
    basis: clean(wd.basis) === "dm" ? "stated" : clean(wd.basis),
    place: place(d.place),
    sum: clean(d.summary),
    arc: arcOf(n),
    ev: [],
    lore: [],
  }
  if (stated == null) problems.yearAssumed.push(`S${n}: the session has no year; ${home} p.B. assumed from the sessions before`)
  sessions.push(s)

  let day = 0
  for (const [i, e] of (d.events ?? []).entries()) {
    stats.eventsIn++
    if (e.visibility !== "player_known") {
      leave(`events: visibility ${e.visibility ?? "missing"}`)
      continue
    }
    if (held(e)) {
      leave("events: held back (hold_back_patterns)")
      problems.heldBack.push(`${e.id}: ${clean(e.what)?.slice(0, 110)}`)
      continue
    }
    const w = e.when ?? {}
    let y = Number.isFinite(w.world_year) ? w.world_year : null
    let yb = clean(w.basis)
    if (y == null) {
      y = s.y
      yb = "assumed"
      problems.noYear.push(e.id)
    }
    if (y == null) {
      leave("events: no year at all")
      continue
    }
    const off = clean(w.offset)
    if (i > 0 && dayBreak(off)) day++
    const quoteOk = quoteOnPage(n, e.evidence)
    if (e.evidence) quoteOk ? stats.quotesKept++ : (stats.quotesDropped++, problems.quoteMissing.push(e.id))
    const pl = place(e.place)
    if (!pl) problems.noPlace.push(e.id)
    const ev = {
      id: e.id,
      s: n,
      y,
      yb,
      tt: y !== home ? 1 : 0,
      d: day,
      w: scrub(clean(e.what), e.id),
      x: clean(w.expression),
      o: off,
      k: clean(w.kind),
      p: pl,
      n: [...new Set((e.npcs ?? []).map(person).filter((v) => v != null))],
      c: [...new Set((e.pcs ?? []).map(person).filter((v) => v != null))],
      q: quoteOk ? clean(e.evidence) : null,
    }
    s.ev.push(events.length)
    events.push(ev)
    stats.eventsOut++
  }

  for (const h of d.historical_mentions ?? []) {
    stats.loreIn++
    if (h.visibility !== "player_known") {
      leave(`lore: visibility ${h.visibility ?? "missing"}`)
      continue
    }
    if (held(h)) {
      leave("lore: held back (hold_back_patterns)")
      problems.heldBack.push(`S${n} lore: ${clean(h.what)?.slice(0, 110)}`)
      continue
    }
    const ly = loreYear(h)
    if (ly?.dead) {
      leave("lore: hangs on a retconned year or typo")
      problems.retconned.push(`S${n}: ${clean(h.what)?.slice(0, 90)} (${clean(h.expression)})`)
      continue
    }
    const item = { s: n, w: scrub(clean(h.what), `S${n} lore`), x: clean(h.expression), q: quoteOnPage(n, h.evidence) ? clean(h.evidence) : null }
    if (ly?.asWritten) {
      item.cal = ly.asWritten
      stats.loreAsWritten++
    } else if (ly && Number.isFinite(ly.y)) {
      item.y = ly.y
      if (ly.to != null) item.to = ly.to
      if (ly.approx) item.a = 1
      if (ly.ephraim) item.cal = "Ephraim's count"
      stats.loreDated++
    } else {
      stats.loreUndated++
      if (h.derived_year && !/^(none|null|unknown|n\/a)$/i.test(String(h.derived_year).trim())) problems.loreNotPlaced.push(`S${n}: ${clean(h.what)?.slice(0, 70)} — "${clean(h.derived_year)?.slice(0, 80)}"`)
    }
    s.lore.push(lore.length)
    lore.push(item)
  }

  for (const a of d.ages ?? []) {
    const id = person(a.who)
    if (id == null || held({ what: a.statement })) continue
    people.get(id).ages.push({ s: n, y: Number.isFinite(a.as_of_world_year) ? a.as_of_world_year : s.y, age: Number.isFinite(a.age) ? a.age : null, t: clean(a.statement), claimed: a.claimed ? 1 : 0 })
  }
  for (const r of d.name_reveals ?? []) {
    const id = person(r.who)
    if (id == null || !clean(r.previously_called)) continue
    if (held({ what: r.previously_called })) {
      leave("name notes: held back (hold_back_patterns)")
      continue
    }
    people.get(id).names.push({ s: n, t: clean(r.previously_called) })
  }
  prevSessionYear = s.y
}

// time jumps: consecutive events (play order) that do not sit in the same stretch of time
const jumps = []
for (let i = 1; i < events.length; i++) {
  const a = events[i - 1], b = events[i]
  if (a.y !== b.y && (a.tt || b.tt)) jumps.push({ a: i - 1, b: i, from: a.y, to: b.y })
}

// people: only those who appear in an event (ages of others are dropped), counts for the picker
const seen = new Map()
events.forEach((e) => [...e.n, ...e.c].forEach((id) => seen.set(id, (seen.get(id) ?? 0) + 1)))
const remap = new Map()
const peopleOut = []
for (const [id, p] of people) {
  if (!seen.has(id)) continue
  remap.set(id, peopleOut.length)
  if (!p.href && problems.unknownPeople.has(p.name)) problems.unknownPeople.set(p.name, seen.get(id))
  const o = { name: p.name, kind: p.kind, c: seen.get(id) }
  if (p.href) o.href = p.href
  if (p.img) o.img = p.img
  if (p.ages.length) o.ages = p.ages
  if (p.names.length) o.names = p.names
  peopleOut.push(o)
}
for (const e of events) {
  e.n = e.n.map((id) => remap.get(id))
  e.c = e.c.map((id) => remap.get(id))
}
for (const [name, c] of [...problems.unknownPeople]) if (!c) problems.unknownPeople.delete(name)

const strip = (o) => {
  for (const k of Object.keys(o)) if (o[k] == null || (Array.isArray(o[k]) && !o[k].length) || o[k] === 0 && k === "tt") delete o[k]
  return o
}
const data = {
  v: 1,
  draft: DRAFT_NOTE || null,
  offset: OFFSET,
  present: home,
  zoom: DEFAULT_ZOOM,
  approx: [...APPROX_YEARS],
  arcs,
  sessions: sessions.map(strip),
  events: events.map(strip),
  lore: lore.map(strip),
  people: peopleOut,
  jumps,
}

// last line of defence: nothing from the DM side of the extraction may be in the output
const blob = JSON.stringify(data)
for (const bad of ["dm_note", "dm_only", "open_questions", "Raphael, 15 Nov"]) if (blob.includes(bad)) fail(`"${bad}" found in the output. Nothing written.`)
for (const re of HOLD_BACK) { const m = blob.match(re); if (m) fail(`a held-back pattern is still in the output: "${blob.slice(Math.max(0, m.index - 150), m.index + 150)}". Nothing written.`) }

// ---------- write ----------

const years = [...new Set([...events.map((e) => e.y), ...lore.filter((l) => l.y != null).map((l) => l.y)])].sort((a, b) => a - b)
const fmtY = (y) => `${APPROX_YEARS.has(y) ? "≈ " : ""}${y < 0 ? "−" + -y : y} p.B.`
const fallback = [
  `<p>${events.length} events from ${sessions.length} sessions, ${fmtY(years[0])} to ${fmtY(years[years.length - 1]).replace(/\.$/, "")}. The interactive view needs JavaScript.</p>`,
  `<ul>${arcs.map((a) => `<li>${a.n} · ${escapeHtml(a.name)} — sessions ${a.from}–${a.to ?? ""}</li>`).join("")}</ul>`,
].join("")
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
const DATA_FILE = "timeline-data.json"
fs.writeFileSync(path.join(OUT, DATA_FILE), blob)
const page = [
  `---`,
  `title: ${JSON.stringify(TITLE)}`,
  `publish: true`,
  `---`,
  ``,
  tcfg.intro ?? "The world's time as the party knows it: what they saw, and what they were told.",
  ``,
  // one HTML block, no blank lines inside. The link makes Quartz publish the data file and tells the script where it is.
  `<div class="gd-timeline" data-title="${escapeHtml(TITLE)}"><a class="gd-timeline-data" href="${DATA_FILE}" hidden>timeline data</a><div class="gd-timeline-fallback">${DRAFT_NOTE ? `<p><em>${escapeHtml(DRAFT_NOTE)}</em></p>` : ""}${fallback}</div></div>`,
  ``,
].join("\n")
fs.writeFileSync(path.join(OUT, `${TITLE}.md`), page)

// ---------- report ----------

const L = []
const list = (arr, max = 60) => {
  arr.slice(0, max).forEach((x) => L.push(`- ${x}`))
  if (arr.length > max) L.push(`- … and ${arr.length - max} more`)
}
const byYear = new Map()
events.forEach((e) => byYear.set(e.y, (byYear.get(e.y) ?? 0) + 1))
L.push(`# Timeline build report`, `${new Date().toLocaleString("de-CH")} · data: \`${DATA}\` (${files.length} session files)`, ``)
L.push(`## Counts`)
L.push(`- Events shown: **${stats.eventsOut}** of ${stats.eventsIn}`)
L.push(`- Lore the party was told: ${stats.loreIn} entries → ${stats.loreDated} placed at a year, ${stats.loreAsWritten} in another calendar (shown as written), ${stats.loreUndated} without a usable year (listed under their session and in "not yet placed")`)
L.push(`- Left out: ${Object.entries(stats.left).map(([k, v]) => `${v} × ${k}`).join("; ") || "nothing"}`)
L.push(`- People in the picker: ${peopleOut.length} (${peopleOut.filter((p) => p.href).length} with a wiki page, ${peopleOut.filter((p) => p.img).length} with a portrait), ages: ${peopleOut.reduce((a, p) => a + (p.ages?.length ?? 0), 0)} statements`)
L.push(`- Quotes: ${stats.quotesKept} shown, ${stats.quotesDropped} not shown because the words are not on the published session page`)
L.push(`- Events per year: ${[...byYear].sort((a, b) => a[0] - b[0]).map(([y, c]) => `${fmtY(y)}: ${c}`).join(" · ")}`)
L.push(`- Time jumps drawn: ${jumps.map((j) => `${events[j.a].id} → ${events[j.b].id} (${fmtY(j.from)} → ${fmtY(j.to)})`).join("; ")}`)
L.push(`- Open questions still in the data (not shown anywhere): ${problems.openQuestions}`, ``)
L.push(`## Data problems`)
L.push(`### Events without a year of their own (${problems.noYear.length}) — the session's year was used`)
L.push(problems.noYear.join(", ") || "none")
L.push(`### Sessions without a year (${problems.yearAssumed.length})`)
list(problems.yearAssumed)
L.push(`### Held back by caution (${problems.heldBack.length})`)
list(problems.heldBack)
L.push(`### Lore that hangs on a retconned year or typo, left out (${problems.retconned.length})`)
list(problems.retconned)
L.push(`### Lore with a year note the builder could not place (${problems.loreNotPlaced.length})`)
list(problems.loreNotPlaced, 80)
L.push(`### Text that still carried the old +1428 arithmetic, trimmed (${problems.oldOffset.length})`)
L.push(problems.oldOffset.join(", ") || "none")
L.push(`### Events without a place (${problems.noPlace.length})`)
L.push(problems.noPlace.join(", ") || "none")
L.push(`### Names without a wiki page (${problems.unknownPeople.size}) — shown as plain text`)
L.push([...problems.unknownPeople].map(([n, c]) => `${n} (${c})`).join(", ") || "none")
L.push(`### Sessions without a published page (${problems.sessionsNoPage.length})`)
L.push(problems.sessionsNoPage.join(", ") || "none")
L.push(`### Quotes not found on the session page (${problems.quoteMissing.length})`)
L.push(problems.quoteMissing.join(", ") || "none")
fs.writeFileSync(REPORT, L.join("\n") + "\n")

console.log(`✓ Timeline: ${stats.eventsOut} events, ${stats.loreDated + stats.loreAsWritten + stats.loreUndated} lore entries, ${peopleOut.length} people → ${toPosix(path.relative(ROOT, OUT))}/${TITLE}.md + ${DATA_FILE} (${Math.round(blob.length / 1024)} KB)`)
console.log(`  Left out: ${Object.entries(stats.left).map(([k, v]) => `${v} ${k}`).join("; ") || "nothing"}`)
console.log(`  Report: ${toPosix(path.relative(ROOT, REPORT))}`)
