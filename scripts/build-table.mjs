#!/usr/bin/env node
// Gold Daggers wiki — table tools
// Small things to use at the game table. Each has its own switch in wiki.config.yaml → table
// (all off by default). Run AFTER scripts/export-vault.mjs (wiki.sh does): this script only reads
// the finished, player-safe export in content/ and adds
//   content/table-tools.json   which tools are on (plugins/gd-table reads it when the site is built)
//   content/table-faces.json   name, page and portrait of everyone who has a portrait (same set as the Gallery)
//   content/table-years.json   the years of the timeline that have entries, cut down from content/timeline-data.json
//   content/table-names.json   names and other names of the published character, place and item pages (no page text)
//   one small page per tool that needs a page of its own
// Nothing here writes campaign text: the pages carry interface labels only.
//
// Usage: node scripts/build-table.mjs [--config wiki.config.yaml]

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import yaml from "js-yaml"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const argAt = process.argv.indexOf("--config")
const configPath = path.resolve(ROOT, argAt > -1 ? process.argv[argAt + 1] : "wiki.config.yaml")
if (!fs.existsSync(configPath)) {
  console.error("✗ Table tools: no wiki.config.yaml.")
  process.exit(1)
}
const cfg = yaml.load(fs.readFileSync(configPath, "utf8")) ?? {}
const tcfg = cfg.table ?? {}
const expandHome = (p) => (p?.startsWith("~") ? path.join(process.env.HOME ?? "", p.slice(1)) : p)
const OUT = path.resolve(ROOT, expandHome(cfg.output ?? "content"))
if (!fs.existsSync(path.join(OUT, ".wiki-export"))) {
  console.error(`✗ Table tools: no export in ${OUT}. Run node scripts/export-vault.mjs first.`)
  process.exit(1)
}

const tools = {} // name → options handed to the tool's script; only tools that are on
const pages = [] // [file name, title, body]
let needFaces = false
const FACES_FILE = "table-faces.json"
const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
// same rule as Quartz 5 (slugifyPath): lower case, spaces to dashes
const slugSeg = (s) => s.replace(/\s/g, "-").replace(/&/g, "-and-").replace(/%/g, "-percent").replace(/\?/g, "").replace(/#/g, "").replace(/[<>:"|*]/g, "").toLowerCase()
const hrefOf = (rel) => rel.replace(/\.md$/i, "").split("/").map(slugSeg).join("/")
// A tool page: one HTML block without blank lines. The hidden link makes Quartz publish the data file
// and tells the script where it is; the fallback line shows until the script has drawn the tool.
const toolBox = (cls, data, fallback) =>
  `<div class="${cls}">${data ? `<a class="gd-table-data" href="${data}" hidden>data</a>` : ""}<p class="gd-table-fallback"><em>${escapeHtml(fallback)}</em></p></div>`

// ---------- the tools ----------

// Spotlight: one portrait, full screen, for the TV or a phone held up; and a line-up prepared beforehand.
if (tcfg.spotlight) {
  const title = tcfg.spotlight_title ?? "Line-up"
  tools.spotlight = { page: hrefOf(`${title}.md`), title }
  needFaces = true
  pages.push([
    `${title}.md`,
    title,
    [
      tcfg.spotlight_intro ?? "Pick portraits before the session, then show them one at a time, full screen. The list stays in this browser, on this device.",
      ``,
      toolBox("gd-lineup", FACES_FILE, "The line-up needs JavaScript."),
    ].join("\n"),
  ])
}

// Who is this? — a portrait quiz over the Gallery's portraits.
if (tcfg.quiz) {
  const title = tcfg.quiz_title ?? "Who is this" // also the file name; the page heading gets the question mark
  tools.quiz = { page: hrefOf(`${title}.md`) }
  needFaces = true
  pages.push([`${title}.md`, /[?!.]$/.test(title) ? title : `${title}?`, [tcfg.quiz_intro ?? "How well do you know the faces the party has met?", ``, toolBox("gd-quiz", FACES_FILE, "The quiz needs JavaScript.")].join("\n")])
}

// Logbook: a pin and a private note on any page, kept in the reader's own browser.
if (tcfg.logbook) {
  const title = tcfg.logbook_title ?? "Logbook"
  tools.logbook = { page: hrefOf(`${title}.md`) }
  pages.push([`${title}.md`, title, [tcfg.logbook_intro ?? "Your own pins and notes on the wiki's pages.", ``, toolBox("gd-logbook", null, "The logbook needs JavaScript.")].join("\n")])
}

// Year converter: a year in p.B. and in Ephraim's count, how far it is from the present, and what the
// timeline has for that year. Only these two counts are converted; other calendars are left as written.
let yearsData = null
const YEARS_FILE = "table-years.json"
if (tcfg.year_converter) {
  const title = tcfg.year_converter_title ?? "Year converter"
  const tlOn = cfg.timeline?.enabled
  const tlFile = path.join(OUT, "timeline-data.json")
  const tl = tlOn && fs.existsSync(tlFile) ? JSON.parse(fs.readFileSync(tlFile, "utf8")) : null
  const offset = Number(tl?.offset ?? cfg.timeline?.ephraim_offset ?? 1321)
  const present = Number(tl?.present ?? tcfg.year_converter_present ?? 831)
  yearsData = { v: 1, offset, present, approx: tl?.approx ?? [], timeline: tl ? hrefOf(`${cfg.timeline.title ?? "Timeline"}.md`) : null, years: [], lore: [] }
  if (tl) {
    const LIST_MAX = Number(tcfg.year_converter_list_max ?? 8) // up to this many events a year are listed one by one
    const byYear = new Map()
    for (const e of tl.events) {
      if (!Number.isFinite(e.y)) continue
      if (!byYear.has(e.y)) byYear.set(e.y, { y: e.y, n: 0, s: [], e: [] })
      const yd = byYear.get(e.y)
      yd.n++
      if (!yd.s.includes(e.s)) yd.s.push(e.s)
      yd.e.push({ id: e.id, w: e.w })
    }
    for (const yd of byYear.values()) {
      yd.s.sort((a, b) => a - b)
      if (yd.n > LIST_MAX) delete yd.e
    }
    yearsData.years = [...byYear.values()].sort((a, b) => a.y - b.y)
    // what the party was told, where the timeline places it at a year (same rule as the timeline page:
    // dates written in another calendar are not placed)
    yearsData.lore = tl.lore
      .filter((l) => Number.isFinite(l.y) && !(l.cal && l.cal !== "Ephraim's count"))
      .map((l) => ({ y: l.y, ...(Number.isFinite(l.to) ? { to: l.to } : {}), ...(l.a ? { a: 1 } : {}), w: l.w, s: l.s }))
      .sort((a, b) => a.y - b.y || a.s - b.s)
  }
  tools.year_converter = { page: hrefOf(`${title}.md`), title, timeline: yearsData.timeline, timeline_link: tcfg.year_converter_timeline_link !== false }
  pages.push([
    `${title}.md`,
    title,
    [tcfg.year_converter_intro ?? "A year in p.B. and in Ephraim's count.", ``, toolBox("gd-years", YEARS_FILE, "The year converter needs JavaScript.")].join("\n"),
  ])
}

// Protocol helper: a writing page for whoever keeps the session protocol. Typing a name offers the
// published pages' names, so the text links up when it is pasted into the vault.
let namesData = null
const NAMES_FILE = "table-names.json"
if (tcfg.protocol_helper) {
  const title = tcfg.protocol_helper_title ?? "Protocol"
  const folders = tcfg.protocol_helper_folders ?? ["Entities", "Places", "Items and Artefacts"]
  const toPosix = (p) => p.split(path.sep).join("/")
  const kindOf = (rel) => {
    const parts = rel.split("/")
    if (parts[0] === "Entities") {
      const sub = parts.length > 2 ? parts[1] : ""
      return sub === "Player Characters" ? "pc" : sub === "NPCs" ? "npc" : sub.replace(/s$/, "").toLowerCase() || "entity"
    }
    return parts[0] === "Places" ? "place" : /^Items/.test(parts[0]) ? "item" : parts[0].replace(/s$/, "").toLowerCase()
  }
  const names = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.toLowerCase().endsWith(".md") && e.name.toLowerCase() !== "index.md") {
        const rel = toPosix(path.relative(OUT, full))
        const fm = fs.readFileSync(full, "utf8").match(/^---\n([\s\S]*?)\n---/)
        let data = {}
        try {
          data = (fm && yaml.load(fm[1])) || {}
        } catch {}
        // the link target is the note's file name: that is what [[…]] opens in the vault
        const n = e.name.replace(/\.md$/i, "")
        const seen = new Set([n.toLowerCase()])
        const a = []
        const also = [data.title, ...(Array.isArray(data.aliases) ? data.aliases : data.aliases ? [data.aliases] : [])]
        for (const x of also) {
          const t = typeof x === "string" || typeof x === "number" ? String(x).trim() : ""
          if (!t || /[\[\]|]/.test(t) || seen.has(t.toLowerCase())) continue
          seen.add(t.toLowerCase())
          a.push(t)
        }
        names.push({ n, k: kindOf(rel), ...(a.length ? { a } : {}) })
      }
    }
  }
  for (const f of folders) if (fs.existsSync(path.join(OUT, f))) walk(path.join(OUT, f))
  names.sort((x, y) => x.n.localeCompare(y.n))
  namesData = { v: 1, names }
  tools.protocol_helper = { page: hrefOf(`${title}.md`) }
  pages.push([
    `${title}.md`,
    title,
    [
      tcfg.protocol_helper_intro ?? "For whoever writes the protocol. Type a name and pick it from the suggestions: it goes in as a link, spelled as in the wiki. The text stays in this browser, on this device.",
      ``,
      toolBox("gd-protocol", NAMES_FILE, "The protocol page needs JavaScript."),
    ].join("\n"),
  ])
}

// ---------- write ----------

if (!Object.keys(tools).length) {
  console.log("· Table tools: all switched off (wiki.config.yaml → table). Nothing written.")
  process.exit(0)
}

if (needFaces) {
  const toPosix = (p) => p.split(path.sep).join("/")
  const notes = []
  const assetsByBase = new Map()
  ;(function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.toLowerCase().endsWith(".md")) notes.push(toPosix(path.relative(OUT, full)))
      else if (/\.(webp|png|jpe?g|gif|avif)$/i.test(e.name)) assetsByBase.set(e.name.toLowerCase(), toPosix(path.relative(OUT, full)))
    }
  })(OUT)
  const faces = []
  for (const rel of notes) {
    const text = fs.readFileSync(path.join(OUT, rel), "utf8")
    const fm = text.match(/^---\n([\s\S]*?)\n---/)
    if (!fm) continue
    let data
    try {
      data = yaml.load(fm[1]) ?? {}
    } catch {
      continue
    }
    const im = typeof data.image === "string" ? data.image.match(/\[\[([^\]|#]+)/) : null
    const asset = im && assetsByBase.get(path.posix.basename(im[1].trim()).toLowerCase())
    if (!asset) continue
    const folder = rel.split("/").slice(-2, -1)[0] ?? ""
    faces.push({
      n: String(data.title ?? path.posix.basename(rel).replace(/\.md$/i, "")),
      h: hrefOf(rel),
      i: asset.split("/").map(slugSeg).join("/"),
      k: folder === "Player Characters" ? "pc" : folder === "Companions" ? "companion" : folder.replace(/s$/, "").toLowerCase(),
    })
  }
  faces.sort((a, b) => a.n.localeCompare(b.n))
  fs.writeFileSync(path.join(OUT, FACES_FILE), JSON.stringify({ v: 1, faces }))
  console.log(`✓ Table tools: ${faces.length} portraits listed in ${FACES_FILE}`)
}
if (yearsData) {
  fs.writeFileSync(path.join(OUT, YEARS_FILE), JSON.stringify(yearsData))
  console.log(`✓ Table tools: ${yearsData.years.length} years with events, ${yearsData.lore.length} things told at a year in ${YEARS_FILE}`)
}
if (namesData) {
  fs.writeFileSync(path.join(OUT, NAMES_FILE), JSON.stringify(namesData))
  const twice = namesData.names.map((x) => x.n.toLowerCase()).filter((x, i, all) => all.indexOf(x) !== i)
  console.log(`✓ Table tools: ${namesData.names.length} names, ${namesData.names.reduce((c, x) => c + (x.a?.length ?? 0), 0)} other names in ${NAMES_FILE}${twice.length ? ` · ${twice.length} names exist twice (a link opens only one of them)` : ""}`)
}
for (const [file, title, body] of pages) fs.writeFileSync(path.join(OUT, file), `---\ntitle: ${JSON.stringify(title)}\npublish: true\n---\n\n${body}\n`)
fs.writeFileSync(path.join(OUT, "table-tools.json"), JSON.stringify(tools))
console.log(`✓ Table tools on: ${Object.keys(tools).join(", ")}${pages.length ? ` · pages: ${pages.map((p) => p[1]).join(", ")}` : ""}`)
