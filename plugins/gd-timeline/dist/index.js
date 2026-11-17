// Gold Daggers timeline — Quartz 5 plugin (plain ESM, nothing to build).
// It sits in dist/ because that is where Quartz looks for a plugin entry; this file is the source.
//
// The Timeline page (written by scripts/build-timeline.mjs) only carries an empty container and a
// link to its data file. This plugin adds, on every page:
//   - the styles (one small stylesheet), and
//   - a few lines of loader script that wait for Quartz's "nav" event (fired on first load and
//     after every SPA navigation) and import the real client script only where a container exists.
// The client script itself is shipped as a static file (static/plugins/gd-timeline/timeline.js).
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const clientDir = path.join(here, "..", "client")

export const GdTimeline = () => ({
  name: "GdTimeline",
  htmlPlugins() {
    return [] // nothing to change in the pages themselves
  },
  externalResources() {
    const css = fs.readFileSync(path.join(clientDir, "timeline.css"), "utf8")
    const js = fs.readFileSync(path.join(clientDir, "timeline.js"), "utf8")
    const v = crypto.createHash("sha1").update(js).digest("hex").slice(0, 8)
    const loader = `
document.addEventListener("nav", () => {
  const boxes = document.querySelectorAll(".gd-timeline")
  if (!boxes.length) return
  const script = document.querySelector('script[src*="postscript"]') || document.querySelector('link[href*="index"][rel="stylesheet"]')
  const root = new URL(".", script ? (script.src || script.href) : document.baseURI)
  import(new URL("static/plugins/gd-timeline/timeline.js?v=${v}", root).href)
    .then((m) => boxes.forEach((box) => m.init(box)))
    .catch((err) => console.error("Timeline could not load", err))
})`
    return {
      css: [{ content: css, inline: true }],
      js: [{ script: loader, loadTime: "afterDOMReady", contentType: "inline" }],
      assets: [{ from: clientDir, to: "gd-timeline" }],
    }
  },
})

export default GdTimeline
