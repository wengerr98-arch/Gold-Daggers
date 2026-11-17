// Gold Daggers table tools — Quartz 5 plugin (plain ESM, nothing to build).
//
// Which tools are on is decided by the export, not here: scripts/build-table.mjs reads
// wiki.config.yaml → table and writes content/table-tools.json. That file travels with the
// content, so the site builds the same way on GitHub (where wiki.config.yaml does not exist).
// No file, or nothing switched on: this plugin adds nothing to the site.
//
// A tool is a pair of files in ../client: <name>.js (exports init(ctx), called on every Quartz
// "nav" event) and optionally <name>.css. Everything a tool remembers stays in the visitor's
// browser (localStorage); nothing is sent anywhere.
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const clientDir = path.join(here, "..", "client")

function switchedOn(ctx) {
  const dir = path.resolve(ctx?.argv?.directory ?? "content")
  try {
    const flags = JSON.parse(fs.readFileSync(path.join(dir, "table-tools.json"), "utf8"))
    return Object.fromEntries(Object.entries(flags).filter(([name, v]) => v && fs.existsSync(path.join(clientDir, `${name}.js`))))
  } catch {
    return {}
  }
}

export const GdTable = () => ({
  name: "GdTable",
  htmlPlugins() {
    return []
  },
  externalResources(ctx) {
    const tools = switchedOn(ctx)
    const names = Object.keys(tools)
    if (!names.length) return {}
    const read = (f) => (fs.existsSync(path.join(clientDir, f)) ? fs.readFileSync(path.join(clientDir, f), "utf8") : "")
    const css = [read("table.css"), ...names.map((n) => read(`${n}.css`))].join("\n")
    const v = crypto.createHash("sha1").update(names.map((n) => read(`${n}.js`)).join("")).digest("hex").slice(0, 8)
    const loader = `
document.addEventListener("nav", () => {
  const tools = ${JSON.stringify(tools)}
  const script = document.querySelector('script[src*="postscript"]') || document.querySelector('link[href*="index"][rel="stylesheet"]')
  const root = new URL(".", script ? (script.src || script.href) : document.baseURI).href
  for (const name of Object.keys(tools))
    import(root + "static/plugins/gd-table/" + name + ".js?v=${v}")
      .then((m) => m.init({ root, options: tools[name], slug: document.body.dataset.slug || "" }))
      .catch((err) => console.error("Table tool could not load: " + name, err))
})`
    return {
      css: [{ content: css, inline: true }],
      js: [{ script: loader, loadTime: "afterDOMReady", contentType: "inline" }],
      assets: [{ from: clientDir, to: "gd-table" }],
    }
  },
})

export default GdTable
