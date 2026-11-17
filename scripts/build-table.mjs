#!/usr/bin/env node
// Gold Daggers wiki — table tools
// Small things to use at the game table. Each has its own switch in wiki.config.yaml → table
// (all off by default). Run AFTER scripts/export-vault.mjs (wiki.sh does): this script only reads
// the finished, player-safe export in content/ and adds
//   content/table-tools.json   which tools are on (plugins/gd-table reads it when the site is built)
//   content/table-faces.json   name, page and portrait of everyone who has a portrait (same set as the Gallery)
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
for (const [file, title, body] of pages) fs.writeFileSync(path.join(OUT, file), `---\ntitle: ${JSON.stringify(title)}\npublish: true\n---\n\n${body}\n`)
fs.writeFileSync(path.join(OUT, "table-tools.json"), JSON.stringify(tools))
console.log(`✓ Table tools on: ${Object.keys(tools).join(", ")}${pages.length ? ` · pages: ${pages.map((p) => p[1]).join(", ")}` : ""}`)
