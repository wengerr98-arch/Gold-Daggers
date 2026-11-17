#!/usr/bin/env node
// Gold Daggers wiki export
// Copies the player-safe part of the Obsidian vault into Quartz's content folder.
// It only ever READS the vault. Everything it writes goes to the output folder and the report.
//
// Usage: node scripts/export-vault.mjs [--config wiki.config.yaml] [--vault <path>]

import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"
import yaml from "js-yaml"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const MARKER = ".wiki-export"

// ---------- config ----------

function arg(name) {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : undefined
}

const configPath = path.resolve(ROOT, arg("--config") ?? "wiki.config.yaml")
if (!fs.existsSync(configPath)) {
  console.error("✗ No wiki.config.yaml yet. Copy wiki.config.example.yaml to wiki.config.yaml and set the vault path.")
  process.exit(1)
}
const cfg = yaml.load(fs.readFileSync(configPath, "utf8")) ?? {}
const expandHome = (p) => (p?.startsWith("~") ? path.join(process.env.HOME ?? "", p.slice(1)) : p)

const VAULT = path.resolve(expandHome(arg("--vault") ?? cfg.vault ?? ""))
const OUT = path.resolve(ROOT, expandHome(cfg.output ?? "content"))
const REPORT = path.resolve(ROOT, cfg.report ?? "wiki-export-report.md")
const trimSlashes = (f) => String(f).replace(/^\/+|\/+$/g, "")
const publishMode = String(cfg.publish?.mode ?? "whitelist") // whitelist | all
const allowedLevels = new Set((cfg.publish?.spoiler_levels ?? []).map(String))
const blockedLevels = new Set((cfg.publish?.blocked_spoiler_levels ?? []).map(String))
const blockedTags = new Set((cfg.publish?.blocked_tags ?? []).map((t) => String(t).replace(/^#/, "").toLowerCase()))
const reviewedMode = String(cfg.publish?.require_reviewed ?? "all") // all | generated | off
const includeFolders = (cfg.include_folders ?? []).map(trimSlashes)
const excludeFolders = (cfg.exclude_folders ?? []).map(trimSlashes)
const folderAliases = Object.entries(cfg.folder_aliases ?? {})
  .map(([from, to]) => [trimSlashes(from), trimSlashes(to)])
  .sort((a, b) => b[0].length - a[0].length)
const dmHeadings = (cfg.dm_headings ?? []).map((s) => new RegExp(s, "i"))
const stripHeadings = (cfg.strip_headings ?? []).map((s) => new RegExp(s, "i"))
const dmLines = (cfg.dm_line_patterns ?? []).map((s) => new RegExp(s, "i"))
const inFolder = (rel, f) => rel === f || rel.startsWith(f + "/")
const includeNotes = new Set((cfg.include_notes ?? []).map((p) => trimSlashes(p).replace(/\.md$/i, "")))
const mapPath = (rel) => {
  for (const [from, to] of folderAliases) if (inFolder(rel, from)) return to + rel.slice(from.length)
  return rel
}
const dmCallouts = new Set((cfg.dm_callouts ?? ["dm"]).map((c) => c.toLowerCase()))
const stripComments = cfg.strip_comments !== false
const keepProps = cfg.keep_properties ?? ["title", "aliases", "tags", "description"]
const hiddenTags = new Set((cfg.hidden_tags ?? []).map((t) => String(t).replace(/^#/, "").toLowerCase()))
const reviewKeywords = cfg.review_keywords ?? []
const homeNote = cfg.home_note ?? null
const siteTitle = cfg.site_title ?? "Gold Daggers"
const includeNotesRaw = cfg.include_notes ?? []
const portraitCfg = cfg.portraits ?? null // { folders: [...], embed: true, width: 260 }
const homeCfg = cfg.home ?? null // { mode: generated, arcs: [{name, sessions}], countdown_label }
const mapCfg = cfg.map ?? null // { image, title, height, minZoom, maxZoom, defaultZoom, zoomDelta }
const galleryCfg = cfg.gallery ?? null // { title, intro }
// Session pages: a small header line (number, arc, in-world date) and previous/next links.
const sessionsCfg = { header: cfg.sessions?.header !== false, nav: cfg.sessions?.nav !== false, played_date: cfg.sessions?.played_date !== false }
// Web-sized copies of images, made at export time. The vault's files are never changed.
const imagesCfg = {
  optimize: cfg.images?.optimize !== false, // false → copy every image as it is
  max_size: Number(cfg.images?.max_size ?? 900), // longest edge of portraits and other pictures, in px
  format: String(cfg.images?.format ?? "webp").toLowerCase(), // webp | jpeg | keep
  quality: Number(cfg.images?.quality ?? 80),
  map_max_size: Number(cfg.images?.map_max_size ?? 0), // 0 = keep the map's pixel size (pins stay exact)
  map_format: String(cfg.images?.map_format ?? "webp").toLowerCase(),
  map_quality: Number(cfg.images?.map_quality ?? 82),
  map_keep_original: cfg.images?.map_keep_original !== false, // the "full-size map" link
}
// the image library has to load before any link is rewritten to a new file name
let sharp = null
if (imagesCfg.optimize) {
  try {
    sharp = (await import("sharp")).default
  } catch (e) {
    imagesCfg.optimize = false
    console.warn(`! Image library (sharp) didn't load, images are copied as they are: ${e.message.split("\n")[0]}`)
  }
}

if (!cfg.vault && !arg("--vault")) fail("No vault path set (wiki.config.yaml → vault).")
if (!fs.existsSync(VAULT) || !fs.statSync(VAULT).isDirectory()) fail(`Vault not found: ${VAULT}`)
const inside = (child, parent) => {
  const r = path.relative(parent, child)
  return r === "" || (!r.startsWith("..") && !path.isAbsolute(r))
}
if (inside(OUT, VAULT) || inside(VAULT, OUT)) fail("Output folder and vault overlap. Refusing to run.")

function fail(msg) {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

// ---------- read the vault ----------

const toPosix = (p) => p.split(path.sep).join("/")

function walk(dir, base = dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue // .obsidian, .trash, .git, hidden files
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, base, acc)
    else if (e.isFile()) acc.push(toPosix(path.relative(base, full)))
  }
  return acc
}

const allFiles = walk(VAULT)
const isNote = (rel) => rel.toLowerCase().endsWith(".md")
const noteBase = (rel) => path.posix.basename(rel).replace(/\.md$/i, "")

const byLowerPath = new Map() // "folder/note" and "folder/note.md" and "img/a.png" → rel
const notesByBase = new Map() // "note" → [rel]
const filesByBase = new Map() // "a.png" → [rel]
const push = (m, k, v) => (m.has(k) ? m.get(k).push(v) : m.set(k, [v]))
for (const rel of allFiles) {
  byLowerPath.set(rel.toLowerCase(), rel)
  if (isNote(rel)) {
    byLowerPath.set(rel.toLowerCase().replace(/\.md$/, ""), rel)
    push(notesByBase, noteBase(rel).toLowerCase(), rel)
  } else {
    push(filesByBase, path.posix.basename(rel).toLowerCase(), rel)
  }
}

function parseNote(text) {
  text = text.replace(/\r\n?/g, "\n")
  if (!text.startsWith("---\n")) return { fm: null, body: text }
  const end = text.indexOf("\n---", 4)
  if (end === -1) return { fm: null, body: text }
  const after = text.indexOf("\n", end + 4)
  const raw = text.slice(4, end)
  const body = after === -1 ? "" : text.slice(after + 1)
  try {
    const fm = yaml.load(raw)
    return { fm: fm && typeof fm === "object" ? fm : {}, body }
  } catch (e) {
    return { fm: null, fmError: e.message.split("\n")[0], body }
  }
}

// ---------- decide what is published ----------

const notes = new Map() // rel → { fm, body, published, reason }
const levelCounts = new Map()
const skipped = {
  notIncluded: [],
  excluded: [],
  noFrontmatter: [],
  badFrontmatter: [],
  level: new Map(),
  blockedTag: [],
  notReviewed: [],
}
const noteTags = (fm) =>
  (Array.isArray(fm?.tags) ? fm.tags : fm?.tags ? String(fm.tags).split(/[,\s]+/) : []).map((t) =>
    String(t).replace(/^#/, "").toLowerCase(),
  )
const failsReview = (fm) =>
  (reviewedMode === "all" && fm?.reviewed !== true) ||
  (reviewedMode === "generated" && fm?.generated === true && fm?.reviewed !== true)

for (const rel of allFiles.filter(isNote)) {
  const { fm, fmError, body } = parseNote(fs.readFileSync(path.join(VAULT, rel), "utf8"))
  const level = fm?.spoiler_level == null ? "(none)" : String(fm.spoiler_level)
  levelCounts.set(level, (levelCounts.get(level) ?? 0) + 1)

  let published = false
  if (includeFolders.length && !includeFolders.some((f) => inFolder(rel, f)) && !includeNotes.has(rel.replace(/\.md$/i, ""))) skipped.notIncluded.push(rel)
  else if (excludeFolders.some((f) => inFolder(rel, f))) skipped.excluded.push(rel)
  else if (fmError) skipped.badFrontmatter.push(`${rel} — ${fmError}`)
  else if (publishMode === "all") {
    // opt-out: everything in the included folders, minus blocked levels/tags
    if (blockedLevels.has(level)) push(skipped.level, level, rel)
    else if (noteTags(fm).some((t) => blockedTags.has(t))) skipped.blockedTag.push(rel)
    else if (failsReview(fm)) skipped.notReviewed.push(rel)
    else published = true
  } else if (!fm) skipped.noFrontmatter.push(rel)
  else if (!allowedLevels.has(level)) push(skipped.level, level, rel)
  else if (failsReview(fm)) skipped.notReviewed.push(rel)
  else published = true

  notes.set(rel, { fm, body, published })
}

// ---------- link resolution (Obsidian "shortest path" style, plus aliases like Quartz) ----------

const notesByAlias = new Map() // "lin" → [rel]
for (const [rel, n] of notes) {
  const a = n.fm?.aliases
  for (const alias of Array.isArray(a) ? a : a ? [a] : []) push(notesByAlias, String(alias).toLowerCase(), rel)
}

function pick(cands, fromRel) {
  if (!cands?.length) return null
  if (cands.length === 1) return cands[0]
  const dir = path.posix.dirname(fromRel)
  return cands.find((c) => path.posix.dirname(c) === dir) ?? [...cands].sort((a, b) => a.length - b.length)[0]
}

function resolve(target, fromRel) {
  const t = target.trim().replace(/^\.\//, "")
  if (!t) return null
  const lower = t.toLowerCase()
  let rel = null
  if (t.includes("/")) {
    const relToNote = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), t)).toLowerCase()
    rel =
      byLowerPath.get(relToNote) ??
      byLowerPath.get(path.posix.normalize(t).replace(/^\/+/, "").toLowerCase()) ??
      pick(
        allFiles.filter((f) => {
          const fl = f.toLowerCase()
          return fl.endsWith("/" + lower) || fl.endsWith("/" + lower + ".md")
        }),
        fromRel,
      )
  } else {
    rel =
      pick(notesByBase.get(lower.replace(/\.md$/, "")), fromRel) ??
      pick(filesByBase.get(lower), fromRel) ??
      pick(notesByAlias.get(lower), fromRel)
  }
  if (!rel) return null
  return { rel, kind: isNote(rel) ? "note" : "file" }
}

// ---------- images: web-sized copies ----------

const IMG_RE = /\.(png|jpe?g|webp)$/i
const mapSource = mapCfg?.image ? resolve(mapCfg.image, "") : null
const mapRel = mapSource?.kind === "file" ? mapSource.rel : null
const outNames = new Map() // vault rel → output rel
const outNamesTaken = new Set(allFiles.map((f) => f.toLowerCase()))
// Where an attachment lands in the output. Optimised images change their extension (koda.png → koda.webp).
function assetOut(rel) {
  if (outNames.has(rel)) return outNames.get(rel)
  let out = rel
  if (imagesCfg.optimize && IMG_RE.test(rel)) {
    const isMap = rel === mapRel
    const fmt = isMap ? imagesCfg.map_format : imagesCfg.format
    const ext = fmt === "keep" ? rel.match(IMG_RE)[0] : fmt === "jpeg" || fmt === "jpg" ? ".jpg" : ".webp"
    // the map's web copy gets its own name so the untouched original can sit next to it
    const cand = rel.replace(IMG_RE, (isMap && imagesCfg.map_keep_original ? ".web" : "") + ext)
    // never let two different source images land on the same output name
    if (cand === rel || !outNamesTaken.has(cand.toLowerCase())) out = cand
  }
  outNamesTaken.add(out.toLowerCase())
  outNames.set(rel, out)
  return out
}
// Rewrite the file name inside a link when the export renames the image.
function renameInLink(text, rel) {
  const from = path.posix.basename(rel)
  const to = path.posix.basename(assetOut(rel))
  if (from === to) return text
  const stem = (n) => n.replace(/\.[^.]+$/, "")
  const ext = (n) => n.slice(stem(n).length)
  const i = text.toLowerCase().lastIndexOf(ext(from).toLowerCase())
  if (i === -1) return text
  return text.slice(0, i) + (stem(to).slice(stem(from).length) + ext(to)) + text.slice(i + ext(from).length)
}

// ---------- tidy import-pipeline "extract" notes (cleanup_extracts in the config) ----------

// These notes are raw pipeline output: a header of "# ..." comment lines, then per session
//   [TAG] Session NNN | passage | context | context
// with stray "|", "736|" line numbers and sections out of order. The tidy-up rewrites the layout only:
// every passage and every context is kept, word for word.
const cleanupNotes = new Set((cfg.cleanup_extracts ?? []).map((p) => trimSlashes(p).replace(/\.md$/i, "").toLowerCase()))
const cleanupReport = []
function tidyExtracts(body, rel) {
  const lines = body.split("\n")
  let title = null
  const legend = []
  const sections = new Map() // session number → { title, items: [] }
  const loose = [] // anything before the first session heading that isn't pipeline header
  const stats = { entries: 0, repaired: 0, headerLines: 0, emptySections: 0, unparsed: 0 }
  let current = null
  let seenSection = false
  const section = (num) => {
    if (!sections.has(num)) sections.set(num, { title: null, items: [] })
    return sections.get(num)
  }
  const clean = (t) => t.trim().replace(/\\"/g, '"')
  for (let raw of lines) {
    let line = raw
    // "736|" line numbers and stray leading pipes from the pipeline
    const fixed = line.replace(/^\s*\d+\|(?=\s*(\[|#|$))/, "").replace(/^\s*\|+\s*(?=\[[A-Z])/, "")
    if (fixed !== line) stats.repaired++
    line = fixed
    if (/^\s*\|*\s*$/.test(line)) continue // blank, "|", "||"
    const h = line.match(/^##\s+Session\s+0*(\d+)\s*(?:[—–-]\s*(.*?))?\s*$/)
    if (h) {
      seenSection = true
      current = Number(h[1])
      const t = (h[2] ?? "").trim()
      if (t && !/^title unknown$/i.test(t)) section(current).title ??= t
      else section(current)
      continue
    }
    if (!seenSection) {
      // pipeline header: "# Title", then "# Generated by …", "#   [TAG] — meaning", "#"
      const c = line.match(/^#(?!#)\s?(.*)$/)
      if (c) {
        const lg = c[1].match(/^\s*\[([A-Z/]+)\]\s*[—–-]\s*(.+)$/)
        if (title === null) title = c[1].trim()
        else if (lg) legend.push([lg[1], lg[2].trim()])
        else stats.headerLines++
        continue
      }
      loose.push(line)
      continue
    }
    if (/^\(no historical content found\)\s*$/i.test(line)) continue
    const e = line.match(/^\s*\[([A-Z]+(?:\/[A-Z]+)*)\]\s*Session\s+0*(\d+)\s*\|(.*)$/)
    if (e) {
      const [text, ...ctx] = e[3].split(" | ").map(clean)
      section(Number(e[2])).items.push({ tag: e[1], text, ctx: ctx.filter(Boolean) })
      stats.entries++
      continue
    }
    // a passage that lost its tag ("| text | context"), or anything else: keep it, never drop
    const parts = line.replace(/^\s*\|\s*/, "").split(" | ").map(clean).filter(Boolean)
    section(current).items.push({ tag: null, text: parts[0] ?? line.trim(), ctx: parts.slice(1) })
    stats.unparsed++
  }
  const sessionLink = (num) => {
    const hit = [...notes].find(([r, n]) => n.published && inFolder(r, "01_sessions") && Number((noteBase(r).match(/Session\s+0*(\d+)/i) || [])[1]) === num)
    return hit ? mapPath(hit[0]).replace(/\.md$/i, "") : null
  }
  const out = [`# ${title ?? noteBase(rel)}`, ""]
  out.push(cfg.cleanup_extracts_intro ?? "Passages about history, lore and legends, collected from the session protocols and sorted by session. Each line gives the passage as it stands in the protocol, then a short note on what it is about.", "")
  if (legend.length) out.push(legend.map(([t, d]) => `**${t}** ${d.replace(/\s*\(.*?\)\s*$/, "")}`).join(" · "), "")
  out.push(...loose, ...(loose.length ? [""] : []))
  const pad = (n) => String(n).padStart(3, "0")
  for (const [num, sec] of [...sections].sort((a, b) => a[0] - b[0])) {
    if (!sec.items.length) {
      stats.emptySections++
      continue
    }
    const label = `Session ${pad(num)}${sec.title ? ` — ${sec.title}` : ""}`
    const target = sessionLink(num)
    out.push(`## ${label}`, "")
    for (const it of sec.items) {
      const ctx = it.ctx.length ? ` — *${it.ctx.join("; ").replace(/\*/g, "\\*")}*` : ""
      out.push(`- ${it.tag ? `**${it.tag}** · ` : ""}${it.text}${ctx}`)
    }
    if (target) out.push("", `[[${target}|→ Session ${num}]]`)
    out.push("")
  }
  cleanupReport.push({ rel, ...stats, sections: [...sections.values()].filter((x) => x.items.length).length })
  return out.join("\n")
}

// ---------- re-flow notes that were hard-wrapped by the import (text.unwrap in the config) ----------

// Most session protocols came through a converter that broke every line at 72 characters. Each of those
// breaks shows as a line break on the wiki, which leaves ragged half-lines on a phone. A line is only joined
// to the next one when the converter must have wrapped it: the next line's first word would not have fitted.
// Short lines, lists, headings, tables, quotes' structure and lines ending in "\" are left alone.
const unwrapCfg = { on: cfg.text?.unwrap === true, width: Number(cfg.text?.wrap_width ?? 72) }
const unwrapReport = []
function unwrapSoft(body, rel) {
  const lines = body.split("\n")
  const special = (l) => /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|\||\+[-=+]|```|~~~|<|!\[|\[\^|---\s*$|\*\*\*\s*$)/.test(l)
  const prose = lines.filter((l) => l.trim() && !special(l))
  const W = unwrapCfg.width
  const near = prose.filter((l) => l.length >= W - 12 && l.length <= W).length
  const over = prose.filter((l) => l.length > W + 8).length
  if (prose.length < 20 || near / prose.length < 0.3 || over / prose.length > 0.08) return body // not a hard-wrapped note
  const out = []
  let fence = null, joined = 0
  for (let i = 0; i < lines.length; i++) {
    let cur = lines[i]
    const f = cur.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null
      out.push(cur)
      continue
    }
    if (f) {
      fence = f[1]
      out.push(cur)
      continue
    }
    if (/^\s*(\||\+[-=+])/.test(cur)) {
      out.push(cur) // tables
      continue
    }
    let width = cur.length // the length the converter saw for this line
    while (i + 1 < lines.length) {
      const next = lines[i + 1]
      if (!cur.trim() || !next.trim() || special(next) || /(\\|\s{2})$/.test(cur) || /^\s*(#{1,6}\s|```|~~~|<|---\s*$)/.test(cur)) break
      const q = (l) => (l.match(/^\s*(?:>\s?)*/) ?? [""])[0]
      if ((q(cur).match(/>/g) ?? []).length !== (q(next).match(/>/g) ?? []).length) break // quote starts or ends
      const rest = next.slice(q(next).length).trimStart()
      const firstWord = rest.split(/\s+/)[0] ?? ""
      if (!firstWord || /^\[!/.test(rest)) break
      if (width + 1 + firstWord.length <= W) break // the word would have fitted: this break is meant
      cur = cur.replace(/\s+$/, "") + " " + rest
      width = next.length
      joined++
      i++
    }
    out.push(cur)
  }
  if (joined) unwrapReport.push({ rel, joined })
  return out.join("\n")
}

// ---------- map pins (map-pins.yaml; off until map.pins: true) ----------

const pinsFile = path.resolve(ROOT, mapCfg?.pins_file ?? "map-pins.yaml")
const pinsOn = mapCfg?.pins === true
const pinsByNote = new Map() // vault rel → [{ coordinates, icon, colour }]
const pinReport = { on: pinsOn, placed: [], problems: [] }
if (pinsOn && mapRel && fs.existsSync(pinsFile)) {
  const pf = yaml.load(fs.readFileSync(pinsFile, "utf8")) ?? {}
  const [w, h] = pf.image_size ?? []
  // the web map keeps the original pixel size unless images.map_max_size shrinks it
  const shrink = imagesCfg.optimize && imagesCfg.map_max_size > 0 && w && h ? Math.min(1, imagesCfg.map_max_size / Math.max(w, h)) : 1
  for (const pin of pf.pins ?? []) {
    const res = resolve(String(pin.note ?? ""), "")
    const x = Number(pin.x), y = Number(pin.y)
    if (!res || res.kind !== "note") pinReport.problems.push(`${pin.note}: no such note`)
    else if (!notes.get(res.rel)?.published) pinReport.problems.push(`${pin.note}: note is not published, pin left out`)
    else if (!Number.isFinite(x) || !Number.isFinite(y) || !h || x < 0 || y < 0 || x > w || y > h) pinReport.problems.push(`${pin.note}: x/y missing or outside the image`)
    else {
      // the map view counts "latitude" up from the bottom edge, "longitude" from the left
      const marker = { coordinates: `${Math.round((h - y) * shrink)}, ${Math.round(x * shrink)}`, icon: String(pin.icon ?? mapCfg.pin_icon ?? "lucide:map-pin"), colour: String(pin.colour ?? mapCfg.pin_colour ?? "#23201C") }
      push(pinsByNote, res.rel, marker)
      pinReport.placed.push(`${pin.note} → ${marker.coordinates}${pin.confidence ? ` (${pin.confidence})` : ""}`)
    }
  }
} else if (pinsOn) pinReport.problems.push(mapRel ? `pins file not found: ${pinsFile}` : "no map image configured")

// ---------- transform a published note ----------

const report = {
  callouts: [],
  dmSections: [],
  dmLines: [],
  strippedSections: new Map(),
  unlinked: [],
  embedsRemoved: [],
  unresolved: [],
  missingAssets: [],
  keywords: [],
  portraits: [],
}
const assets = new Set()

function quoteDepth(line) {
  const m = line.match(/^(?:[ \t]*>)+/)
  return m ? (m[0].match(/>/g) ?? []).length : 0
}

function rewriteLinks(line, fromRel) {
  // [[wikilinks]] and ![[embeds]]
  line = line.replace(/(!?)\[\[([^\[\]\n]+?)\]\]/g, (m, bang, inner) => {
    const unescaped = inner.replace(/\\\|/g, "|")
    const [targetFull, ...aliasParts] = unescaped.split("|")
    const alias = aliasParts.length ? aliasParts.join("|") : null
    const target = targetFull.split("#")[0]
    if (!target.trim()) return m // [[#Heading]] inside the same note
    const res = resolve(target, fromRel)
    const text = alias ?? path.posix.basename(target.trim()).replace(/\.md$/i, "")
    if (!res) {
      // a link to a note that doesn't exist would still carry its target name in the page's link address
      report.unresolved.push({ from: fromRel, link: m })
      return bang ? m : text
    }
    if (res.kind === "file") {
      assets.add(res.rel)
      if (assetOut(res.rel) === res.rel) return m
      const sub = targetFull.slice(target.length)
      const sep = inner.includes("\\|") ? "\\|" : "|"
      return `${bang}[[${renameInLink(target, res.rel)}${sub}${alias !== null ? sep + alias : ""}]]`
    }
    if (notes.get(res.rel)?.published) {
      if (!target.includes("/")) return m
      // path-qualified link: point it at the note's new (renamed-folder) path
      const sep = inner.includes("\\|") ? "\\|" : "|"
      const sub = targetFull.slice(target.length)
      return `${bang}[[${mapPath(res.rel).replace(/\.md$/i, "")}${sub}${alias !== null ? sep + alias : ""}]]`
    }
    if (bang) {
      report.embedsRemoved.push({ from: fromRel, target: res.rel })
      return ""
    }
    report.unlinked.push({ from: fromRel, text, target: res.rel })
    return text
  })

  // [markdown](links) and ![images](path)
  line = line.replace(/(!?)\[([^\]\n]*)\]\(([^)\n]+)\)/g, (m, bang, label, hrefRaw) => {
    let href = hrefRaw.trim()
    href = href.startsWith("<") ? href.slice(1, href.indexOf(">") > 0 ? href.indexOf(">") : undefined) : href.split(/\s+/)[0]
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) return m // web, obsidian://, mailto, anchors
    let decoded = href
    try {
      decoded = decodeURIComponent(href)
    } catch {}
    const res = resolve(decoded.split("#")[0], fromRel)
    if (!res) {
      if (bang) {
        report.missingAssets.push({ from: fromRel, link: m })
        return m
      }
      report.unresolved.push({ from: fromRel, link: m })
      return label
    }
    if (res.kind === "file") {
      assets.add(res.rel)
      if (assetOut(res.rel) === res.rel) return m
      const at = m.lastIndexOf(hrefRaw)
      return m.slice(0, at) + renameInLink(hrefRaw, res.rel) + m.slice(at + hrefRaw.length)
    }
    if (notes.get(res.rel)?.published) return m
    if (bang) {
      report.embedsRemoved.push({ from: fromRel, target: res.rel })
      return ""
    }
    report.unlinked.push({ from: fromRel, text: label, target: res.rel })
    return label
  })
  return line
}

// Cut whole sections whose heading matches dm_headings (secrets) or strip_headings (bookkeeping).
// A section runs until the next heading of the same or a higher level.
function stripSections(body, fromRel) {
  if (!dmHeadings.length && !stripHeadings.length) return body
  const out = []
  let fence = null
  let skipLevel = 0
  for (const line of body.split("\n")) {
    const f = line.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null
      if (!skipLevel) out.push(line)
      continue
    }
    if (f) {
      fence = f[1]
      if (!skipLevel) out.push(line)
      continue
    }
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/)
    if (h) {
      const level = h[1].length
      if (skipLevel && level <= skipLevel) skipLevel = 0
      if (!skipLevel) {
        const text = h[2].replace(/[*_`]/g, "").trim()
        if (dmHeadings.some((r) => r.test(text))) {
          skipLevel = level
          report.dmSections.push({ from: fromRel, heading: text })
          continue
        }
        if (stripHeadings.some((r) => r.test(text))) {
          skipLevel = level
          report.strippedSections.set(text, (report.strippedSections.get(text) ?? 0) + 1)
          continue
        }
      }
    }
    if (!skipLevel) out.push(line)
  }
  return out.join("\n")
}

function transformBody(body, fromRel) {
  body = stripSections(body, fromRel)
  const out = []
  let fence = null
  let inComment = false
  let skipDepth = 0
  let removedCallouts = 0

  for (const original of body.split("\n")) {
    let line = original

    // inside a DM callout: drop every line that still belongs to it
    if (skipDepth > 0) {
      if (quoteDepth(line) >= skipDepth) continue
      skipDepth = 0
    }

    // fenced code blocks pass through untouched
    if (!inComment) {
      const f = line.match(/^\s*(`{3,}|~{3,})/)
      if (fence) {
        if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null
        out.push(line)
        continue
      }
      if (f) {
        fence = f[1]
        out.push(line)
        continue
      }
    }

    // %% Obsidian comments %% (can span lines)
    if (stripComments) {
      let rest = line
      let kept = ""
      let touched = false
      while (true) {
        if (inComment) {
          const end = rest.indexOf("%%")
          touched = true
          if (end === -1) {
            rest = ""
            break
          }
          rest = rest.slice(end + 2)
          inComment = false
        } else {
          const start = rest.indexOf("%%")
          if (start === -1) {
            kept += rest
            break
          }
          kept += rest.slice(0, start)
          rest = rest.slice(start + 2)
          inComment = true
          touched = true
        }
      }
      if (touched && kept.trim() === "") continue
      line = kept
    }

    // > [!dm] callouts
    const c = line.match(/^((?:[ \t]*>)+)[ \t]*\[!([\w-]+)\][+-]?/)
    if (c && dmCallouts.has(c[2].toLowerCase())) {
      skipDepth = (c[1].match(/>/g) ?? []).length
      removedCallouts++
      continue
    }

    if (dmLines.some((r) => r.test(line))) {
      report.dmLines.push({ from: fromRel, text: line.trim().slice(0, 120) })
      continue
    }

    out.push(rewriteLinks(line, fromRel))
  }

  if (removedCallouts) report.callouts.push({ from: fromRel, count: removedCallouts })
  if (inComment) report.unresolved.push({ from: fromRel, link: "(unclosed %% comment — everything after it was cut)" })
  return out.join("\n")
}

function outputFrontmatter(fm, srcStat, extra = {}) {
  const o = {}
  for (const k of keepProps) if (fm[k] !== undefined && fm[k] !== null) o[k] = fm[k]
  if (o.tags !== undefined) {
    const list = (Array.isArray(o.tags) ? o.tags : String(o.tags).split(/[,\s]+/)).filter(Boolean)
    o.tags = list.filter((t) => !hiddenTags.has(String(t).replace(/^#/, "").toLowerCase()))
  }
  if (o.modified === undefined) o.modified = srcStat.mtime.toISOString()
  o.publish = true
  Object.assign(o, extra)
  return `---\n${yaml.dump(o, { lineWidth: -1 })}---\n`
}

// ---------- write the output ----------

function hashDir(dir, base = dir, acc = new Map()) {
  if (!fs.existsSync(dir)) return acc
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) hashDir(full, base, acc)
    else if (e.name.endsWith(".md"))
      acc.set(toPosix(path.relative(base, full)), crypto.createHash("sha1").update(fs.readFileSync(full)).digest("hex"))
  }
  return acc
}

// safety: only wipe a folder this script created (or Quartz's empty starter folder)
fs.mkdirSync(OUT, { recursive: true })
const existing = fs.readdirSync(OUT)
const starterOnly = existing.every((n) => [".gitkeep", "index.md"].includes(n))
if (!existing.includes(MARKER) && !starterOnly)
  fail(`${OUT} has files this script didn't create. Empty it yourself first if it's really the wiki output.`)
const before = hashDir(OUT)
for (const n of existing) fs.rmSync(path.join(OUT, n), { recursive: true, force: true })
fs.writeFileSync(path.join(OUT, MARKER), "Created by scripts/export-vault.mjs — this folder is wiped on every export.\n")

const keywordRe = reviewKeywords.length
  ? new RegExp(`(^|[^\\p{L}\\p{N}])(${reviewKeywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?=$|[^\\p{L}\\p{N}])`, "iu")
  : null

// a portrait: the first image the published note embeds, or an image file named exactly like the note
function findPortrait(rel, body) {
  const m = body.match(/!\[\[([^\]|#]+\.(?:png|jpe?g|webp))(?:\|[^\]]*)?\]\]/i)
  if (m) {
    const r = resolve(m[1], rel)
    if (r?.kind === "file") return { rel: r.rel, embedded: true }
    // the embed may already carry the web copy's name (koda.png → koda.webp): find the vault file behind it
    const want = path.posix.basename(m[1]).toLowerCase()
    for (const [src, out] of outNames) if (path.posix.basename(out).toLowerCase() === want) return { rel: src, embedded: true }
  }
  for (const ext of ["png", "jpg", "jpeg", "webp"]) {
    const hit = pick(filesByBase.get(`${noteBase(rel)}.${ext}`.toLowerCase()), rel)
    if (hit) return { rel: hit, embedded: false }
  }
  return null
}
function insertAfterTitle(body, line) {
  const m = body.match(/^(\s*#\s+[^\n]*\n)/)
  return m ? m[1] + "\n" + line + "\n" + body.slice(m[1].length) : line + "\n\n" + body
}

let publishedCount = 0
let homeWritten = false
const publishedSessions = []
for (const [rel, n] of notes) {
  if (!n.published) continue
  const srcStat = fs.statSync(path.join(VAULT, rel))
  let body = transformBody(n.body, rel)
  if (cleanupNotes.has(rel.replace(/\.md$/i, "").toLowerCase())) body = tidyExtracts(body, rel)
  else if (unwrapCfg.on) body = unwrapSoft(body, rel)
  const extra = {}
  if (portraitCfg && (portraitCfg.folders ?? []).some((f) => inFolder(rel, trimSlashes(f)))) {
    const img = findPortrait(rel, body)
    if (img) {
      const name = path.posix.basename(assetOut(img.rel))
      assets.add(img.rel)
      extra.image = `[[${name}]]`
      extra.gallery = true
      if (portraitCfg.embed !== false && !img.embedded) body = insertAfterTitle(body, `![[${name}|${portraitCfg.width ?? 260}]]`)
      report.portraits.push({ from: rel, image: img.rel, how: img.embedded ? "already embedded" : "matched by name" })
    }
  }
  if (pinsByNote.has(rel)) extra.marker = pinsByNote.get(rel)
  const dest = path.join(OUT, mapPath(rel))
  if (inFolder(rel, "01_sessions")) publishedSessions.push({ rel, fm: n.fm ?? {}, body, dest, srcStat, head: outputFrontmatter(n.fm ?? {}, srcStat, extra) })
  const text = outputFrontmatter(n.fm ?? {}, srcStat, extra) + body
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, text)
  fs.utimesSync(dest, srcStat.atime, srcStat.mtime)
  publishedCount++

  if (homeNote && noteBase(rel).toLowerCase() === String(homeNote).replace(/\.md$/i, "").toLowerCase()) {
    fs.writeFileSync(path.join(OUT, "index.md"), text)
    homeWritten = true
  }
  if (keywordRe)
    body.split("\n").forEach((l, i) => {
      if (keywordRe.test(l)) report.keywords.push({ from: rel, line: i + 1, text: l.trim().slice(0, 140) })
    })
}

let copied = 0

function sessionInfo({ rel, fm, body }) {
  const num = Number(fm.session_number ?? (noteBase(rel).match(/Session\s+0*(\d+)/i) || [])[1])
  // "831 p.b. | später Sommer | Aarum | 43 Tage", also when written in italics or as a heading
  const d = body.match(/^[ \t]*(?:#{1,6}[ \t]+)?[*_]*[ \t]*(\d{1,4})\s*p\.?\s*b\.?\s*\|([^|\n*_]*)\|([^|\n*_]*)(?:\|([^|\n*_]*))?/im)
  let summary = ""
  const sm = body.match(/^##\s+(?:Extracted Summary|Summary|Session Summary)[ \t]*\n([\s\S]*?)(?=\n##\s|(?![\s\S]))/m)
  if (sm) {
    const subs = [...sm[1].matchAll(/^###\s+(.+)$/gm)].map((x) => x[1].trim()).filter((h) => !/^(timeline|key revelations|entities|open threads)$/i.test(h))
    const paras = sm[1].split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p && !/^#{1,6}\s/.test(p) && !/^[-*]\s/.test(p))
    summary = subs.length >= 2 ? subs.join(" · ") : (paras[0] ?? "")
    if (summary.length > 600) summary = summary.slice(0, 600).replace(/\s+\S*$/, "") + " …"
  }
  const link = `[[${mapPath(rel).replace(/\.md$/i, "")}|${noteBase(rel)}]]`
  return { rel, num, link, played: fm.session_date instanceof Date ? fm.session_date.toISOString().slice(0, 10) : fm.session_date ? String(fm.session_date).slice(0, 10) : null, year: d?.[1], season: d?.[2]?.trim(), place: d?.[3]?.trim(), countdown: d?.[4]?.trim(), summary }
}
// Session pages: header line under the title, previous/next at the bottom.
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
function arcOf(num) {
  const arcs = homeCfg?.arcs ?? []
  for (let i = 0; i < arcs.length; i++) {
    const m = String(arcs[i].sessions ?? "").match(/^\s*(\d+)\s*(?:[–—-]\s*(\d+)?)?\s*$/)
    if (!m) continue
    const from = Number(m[1])
    const to = m[2] ? Number(m[2]) : /[–—-]/.test(arcs[i].sessions) ? Infinity : from
    if (num >= from && num <= to) {
      const name = String(arcs[i].name ?? "").replace(/[*_]/g, "").trim()
      return /^\(.*\)$/.test(name) ? `Arc ${i + 1} ${name}` : `Arc ${i + 1} · ${name}`
    }
  }
  return null
}
if (sessionsCfg.header || sessionsCfg.nav) {
  const sess = publishedSessions.map((x) => ({ ...x, info: sessionInfo(x) })).filter((x) => x.info.num).sort((a, b) => a.info.num - b.info.num || a.rel.localeCompare(b.rel))
  sess.forEach((x, i) => {
    const { num, year, season, place, countdown, played } = x.info
    let body = x.body
    if (sessionsCfg.header) {
      const when = year ? [`${year} p.B.`, season, place, countdown].filter(Boolean).join(", ") : null
      const bits = [`Session ${num}`, arcOf(num), when, sessionsCfg.played_date && played ? `played ${played}` : null].filter(Boolean)
      body = insertAfterTitle(body, `<p class="session-meta">${bits.map((b) => `<span>${esc(b)}</span>`).join(" ")}</p>`)
    }
    if (sessionsCfg.nav) {
      const prev = sess[i - 1], next = sess[i + 1]
      const link = (y, label) => `[[${mapPath(y.rel).replace(/\.md$/i, "")}|${label}]]`
      const left = prev ? `<span class="session-prev">${link(prev, `← Session ${prev.info.num}`)}</span>` : `<span class="session-prev"></span>`
      const right = next ? `<span class="session-next">${link(next, `Session ${next.info.num} →`)}</span>` : `<span class="session-next"></span>`
      body = body.replace(/\s*$/, "") + `\n\n<div class="session-nav">\n\n${left} ${right}\n\n</div>\n`
    }
    fs.writeFileSync(x.dest, x.head + body)
    fs.utimesSync(x.dest, x.srcStat.atime, x.srcStat.mtime)
  })
}

function writePage(name, title, bodyText) {
  fs.writeFileSync(path.join(OUT, name), `---\ntitle: ${JSON.stringify(title)}\npublish: true\n---\n\n${bodyText}\n`)
}
const extraPages = []
if (galleryCfg) {
  const t = galleryCfg.title ?? "Gallery"
  writePage(`${t}.md`, t, `${galleryCfg.intro ?? ""}\n\n\`\`\`base\nfilters:\n  and:\n    - "!image.isEmpty()"\nviews:\n  - type: cards\n    name: ${t}\n    order:\n      - file.name\n    image: note.image\n    cardSize: ${galleryCfg.cardSize ?? 190}\n    imageAspectRatio: ${galleryCfg.imageAspectRatio ?? 1.3}\n\`\`\``)
  extraPages.push(t)
}
if (mapCfg?.image) {
  const r = resolve(mapCfg.image, "")
  if (r?.kind === "file") {
    assets.add(r.rel)
    const keepOriginal = !imagesCfg.optimize || imagesCfg.map_keep_original || assetOut(r.rel) === r.rel
    const sizeOf = (rel) => ((fs.statSync(path.join(VAULT, rel)).size / 1048576).toFixed(1) + " MB")
    // Quartz only publishes attachments a page links to or embeds, and the map view's image doesn't count:
    // the link to the web copy below is what gets it published. Keep it.
    const webLink = assetOut(r.rel) !== r.rel ? `[[${path.posix.basename(assetOut(r.rel))}|${mapCfg.webSizeLabel ?? "Map as a plain image"}]]` : ""
    const fullLink = keepOriginal ? `[[${path.posix.basename(r.rel)}|${mapCfg.fullSizeLabel ?? "Open the full-size map"}]]${webLink ? ` (${sizeOf(r.rel)})` : ""}` : ""
    const fullSize = `\n\n${[fullLink, webLink].filter(Boolean).join(" · ")}`
    const t = mapCfg.title ?? "Map"
    writePage(`${t}.md`, t, `${(pinsOn && pinReport.placed.length ? mapCfg.intro_pins : null) ?? mapCfg.intro ?? ""}\n\n\`\`\`base\nviews:\n  - type: leaflet-map\n    name: ${t}\n    image: "${assetOut(r.rel)}"\n    height: ${mapCfg.height ?? 700}\n    minZoom: ${mapCfg.minZoom ?? -2}\n    maxZoom: ${mapCfg.maxZoom ?? 1}\n    defaultZoom: ${mapCfg.defaultZoom ?? -1.5}\n    zoomDelta: ${mapCfg.zoomDelta ?? 0.25}\n    scale: "${mapCfg.scale ?? 1}"\n    unit: ${mapCfg.unit ?? "px"}\n\`\`\`${fullSize}`)
    extraPages.push(t)
  } else report.missingAssets.push({ from: "map", link: mapCfg.image })
}
// The Timeline page itself is written afterwards by scripts/build-timeline.mjs (wiki.sh runs both);
// here it only gets its place among the browse links on the front page.
if (cfg.timeline?.enabled) extraPages.push(cfg.timeline.title ?? "Timeline")
// copy attachments; images get a web-sized copy (cached in .wiki-cache so re-exports stay fast)
const imageStats = { count: 0, before: 0, after: 0, rows: [] }
const CACHE = path.join(ROOT, ".wiki-cache", "images")
async function webCopy(src, rel, dest) {
  const isMap = rel === mapRel
  const max = isMap ? imagesCfg.map_max_size : imagesCfg.max_size
  const quality = isMap ? imagesCfg.map_quality : imagesCfg.quality
  const ext = path.extname(dest).toLowerCase()
  const buf = fs.readFileSync(src)
  const key = crypto.createHash("sha1").update(buf).update(JSON.stringify([max, quality, ext, 1])).digest("hex") + ext
  const cached = path.join(CACHE, key)
  if (!fs.existsSync(cached)) {
    let img = sharp(buf, { limitInputPixels: false }).rotate() // honour camera orientation
    if (max > 0) img = img.resize({ width: max, height: max, fit: "inside", withoutEnlargement: true })
    if (ext === ".webp") img = img.webp({ quality, effort: 5, smartSubsample: true })
    else if (ext === ".png") img = img.png({ compressionLevel: 9, palette: true, quality })
    else img = img.flatten({ background: "#15130F" }).jpeg({ quality, mozjpeg: true })
    let out = await img.toBuffer()
    // same format and no gain (small, already compressed pictures): keep the original bytes
    if (ext === path.extname(src).toLowerCase() && out.length >= buf.length) out = buf
    fs.mkdirSync(CACHE, { recursive: true })
    fs.writeFileSync(cached, out)
  }
  fs.copyFileSync(cached, dest)
  const after = fs.statSync(dest).size
  imageStats.count++
  imageStats.before += buf.length
  imageStats.after += after
  imageStats.rows.push({ rel, before: buf.length, after })
}
for (const rel of assets) {
  const src = path.join(VAULT, rel)
  const out = assetOut(rel)
  const dest = path.join(OUT, out)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  if (imagesCfg.optimize && IMG_RE.test(rel)) {
    try {
      await webCopy(src, rel, dest)
      // the untouched map stays available for the "full-size" link
      if (rel === mapRel && imagesCfg.map_keep_original && out !== rel) fs.copyFileSync(src, path.join(OUT, rel))
    } catch (e) {
      // pages already link to the new file name: put the untouched picture there (browsers go by content, not by name)
      report.missingAssets.push({ from: "image optimiser", link: `${rel} — ${e.message.split("\n")[0]} (copied unchanged)` })
      fs.copyFileSync(src, dest)
    }
  } else fs.copyFileSync(src, dest)
  copied++
}
if (!homeWritten && !fs.existsSync(path.join(OUT, "index.md"))) {
  const folders = new Map()
  for (const [rel, n] of notes)
    if (n.published) {
      const out = mapPath(rel)
      const top = out.includes("/") ? out.split("/")[0] : null
      if (top) folders.set(top, (folders.get(top) ?? 0) + 1)
    }
  const browse = [...extraPages.map((p) => `[[${p}]]`), ...[...folders].sort(([a], [b]) => a.localeCompare(b)).map(([f, c]) => `[${f}](./${encodeURI(f.replace(/ /g, "-"))}/) (${c})`)].join(" · ")
  let page = `The player wiki for the ${siteTitle} campaign.\n\n${browse}\n`
  if (homeCfg?.mode === "generated") {
    const sess = publishedSessions.map(sessionInfo).filter((x) => x.num).sort((a, b) => b.num - a.num)
    const last = sess[0], prev = sess[1], dated = sess.find((x) => x.year)
    const lines = []
    if (last) {
      lines.push(`## Where we stand`, ``, `**Last played:** ${last.link}${last.played ? ` · ${last.played}` : ""}`, ``)
      if (dated) {
        const cd = dated.countdown ? ` · **${dated.countdown.replace(/\s*Tage?$/i, "")} days** ${homeCfg.countdown_label ?? "on the countdown"}` : ""
        lines.push(`| | |`, `|---|---|`, `| **Date** | ${dated.year} p.B.${dated.season ? `, ${dated.season}` : ""}${cd}${dated.num !== last.num ? ` *(as of Session ${dated.num})*` : ""} |`, `| **Where** | ${dated.place || "–"} |`, ``)
      }
      if (last.summary) lines.push(`**Last session:** ${last.summary}`, ``)
      if (prev?.summary) lines.push(`**The session before:** ${prev.summary}`, ``)
    }
    if (homeCfg.arcs?.length) {
      lines.push(`## The journey so far`, ``, `| Arc | Sessions |`, `|---|---|`, ...homeCfg.arcs.map((a, i) => `| ${i + 1} · ${a.name} | ${a.sessions} |`), ``)
    }
    lines.push(`## Browse`, ``, browse)
    page = lines.join("\n")
  }
  writePage("index.md", siteTitle, page)
}

// ---------- report ----------

const after = hashDir(OUT)
const added = [...after.keys()].filter((k) => !before.has(k))
const changed = [...after.keys()].filter((k) => before.has(k) && before.get(k) !== after.get(k))
const removed = [...before.keys()].filter((k) => !after.has(k))

const lines = []
const L = (s = "") => lines.push(s)
const list = (arr, fmt = (x) => x, max = 200) => {
  arr.slice(0, max).forEach((x) => L(`- ${fmt(x)}`))
  if (arr.length > max) L(`- … and ${arr.length - max} more`)
}

L(`# Wiki export report`)
L(`${new Date().toLocaleString("de-CH")} · vault: \`${VAULT}\``)
L()
L(`## Summary`)
L(`- Notes in vault: ${notes.size}`)
L(`- **Published: ${publishedCount}**, attachments copied: ${copied}`)
L(`- Mode: ${publishMode}${publishMode === "all" ? " (everything in the included folders except blocked)" : " (only listed spoiler levels)"}, review check: ${reviewedMode}`)
L(`- Skipped: ${skipped.notIncluded.length} outside the included folders, ${skipped.excluded.length} in excluded folders, ${skipped.blockedTag.length} with a blocked tag, ${skipped.noFrontmatter.length} without frontmatter, ${skipped.badFrontmatter.length} with broken frontmatter, ${[...skipped.level.values()].reduce((a, b) => a + b.length, 0)} by spoiler_level, ${skipped.notReviewed.length} not reviewed`)
L(`- Since the last export: ${added.length} new, ${changed.length} changed, ${removed.length} removed`)
L()
L(`## Check before publishing`)
L(`### Links to hidden notes turned into plain text (${report.unlinked.length})`)
L(`The link is gone, but these words are still visible on the page.`)
list(report.unlinked, (x) => `**${x.text}** in \`${x.from}\` → hidden \`${x.target}\``)
L()
L(`### Keyword hits in published text (${report.keywords.length})`)
list(report.keywords, (x) => `\`${x.from}\`:${x.line} — ${x.text}`)
L()
L(`### New or changed pages`)
list([...added.map((a) => `new: \`${a}\``), ...changed.map((c) => `changed: \`${c}\``), ...removed.map((r) => `removed: \`${r}\``)])
L()
L(`## What was cut`)
L(`- DM callouts removed: ${report.callouts.reduce((a, b) => a + b.count, 0)} in ${report.callouts.length} notes`)
L(`- DM sections removed by heading: ${report.dmSections.length}`)
list(report.dmSections, (x) => `\`${x.from}\` — "${x.heading}"`)
L(`- DM lines removed (dm_line_patterns): ${report.dmLines.length}`)
list(report.dmLines, (x) => `\`${x.from}\`: ${x.text}`)
L(`- Bookkeeping sections removed: ${[...report.strippedSections.values()].reduce((a, b) => a + b, 0)}`)
list([...report.strippedSections].sort((a, b) => b[1] - a[1]), ([h, c]) => `"${h}" ×${c}`, 30)
L(`- Embeds of hidden notes removed: ${report.embedsRemoved.length}`)
list(report.embedsRemoved, (x) => `\`${x.from}\` embedded hidden \`${x.target}\``)
L()
L(`## Portraits (${report.portraits.length})`)
list(report.portraits, (x) => `\`${x.from}\` ← \`${x.image}\` (${x.how})`, 400)
L()
const mb = (n) => (n / 1048576).toFixed(1) + " MB"
L(`## Images`)
if (!imagesCfg.optimize) L(`- Web-sized copies are off (\`images.optimize: false\`): images were copied as they are.`)
else {
  L(`- ${imageStats.count} images made web-sized: ${mb(imageStats.before)} in the vault → **${mb(imageStats.after)}** on the wiki (max ${imagesCfg.max_size}px, ${imagesCfg.format}, quality ${imagesCfg.quality}; map: ${imagesCfg.map_max_size || "original size"}, ${imagesCfg.map_format}, quality ${imagesCfg.map_quality}).`)
  list([...imageStats.rows].sort((a, b) => b.before - a.before), (x) => `\`${x.rel}\`: ${(x.before / 1024).toFixed(0)} KB → ${(x.after / 1024).toFixed(0)} KB`, 10)
}
L()
if (cleanupReport.length) {
  L(`## Tidied extract notes`)
  list(cleanupReport, (x) => `\`${x.rel}\`: ${x.entries} tagged passages kept in ${x.sections} session sections; ${x.unparsed} untagged lines kept as they are; ${x.repaired} broken line starts repaired; ${x.headerLines} pipeline header lines and ${x.emptySections} empty sections removed`)
  L()
}
if (unwrapCfg.on) {
  L(`## Re-flowed text`)
  L(`- ${unwrapReport.length} hard-wrapped notes re-flowed, ${unwrapReport.reduce((a, b) => a + b.joined, 0)} line breaks joined (\`text.unwrap\`).`)
  L()
}
L(`## Map pins`)
if (!pinReport.on) L(`- Off (\`map.pins: false\`). The draft positions are in \`map-pins.yaml\`.`)
else {
  L(`- ${pinReport.placed.length} pins placed from \`map-pins.yaml\`.`)
  list(pinReport.placed)
  list(pinReport.problems, (x) => `**Problem:** ${x}`)
}
L()
L(`## Problems`)
L(`### Broken frontmatter (${skipped.badFrontmatter.length})`)
list(skipped.badFrontmatter)
L(`### Links to notes that don't exist, made plain text (${report.unresolved.length})`)
list(report.unresolved, (x) => `\`${x.from}\`: ${x.link}`, 50)
L(`### Missing images (${report.missingAssets.length})`)
list(report.missingAssets, (x) => `\`${x.from}\`: ${x.link}`, 50)
L()
L(`## spoiler_level values in the vault`)
list([...levelCounts].sort((a, b) => b[1] - a[1]), ([v, c]) => `\`${v}\`: ${c}${allowedLevels.has(v) ? " (published)" : ""}`)
L()
L(`## Skipped notes`)
L(`### Blocked tag (${skipped.blockedTag.length})`)
list(skipped.blockedTag, (x) => `\`${x}\``, 50)
L(`### Not reviewed (${skipped.notReviewed.length})`)
list(skipped.notReviewed, (x) => `\`${x}\``, 100)
for (const [lvl, rels] of skipped.level) {
  L(`### spoiler_level \`${lvl}\` (${rels.length})`)
  list(rels, (x) => `\`${x}\``, 30)
}

fs.writeFileSync(REPORT, lines.join("\n") + "\n")

console.log(`✓ Exported ${publishedCount} of ${notes.size} notes, ${copied} attachments → ${toPosix(path.relative(ROOT, OUT))}/`)
console.log(`  ${report.unlinked.length} links unlinked, ${report.keywords.length} keyword hits, ${report.callouts.reduce((a, b) => a + b.count, 0)} DM callouts + ${report.dmSections.length} DM sections cut`)
console.log(`  ${added.length} new, ${changed.length} changed, ${removed.length} removed since last export`)
if (imagesCfg.optimize) console.log(`  ${imageStats.count} images web-sized: ${mb(imageStats.before)} → ${mb(imageStats.after)}`)
console.log(`  Report: ${toPosix(path.relative(ROOT, REPORT))}`)
