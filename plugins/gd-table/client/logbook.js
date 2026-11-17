// Gold Daggers table tools — Logbook (vanilla JS, no dependencies).
// A pin and a private note on any page, and one page that lists them. Everything stays in this
// browser (localStorage): nothing is sent anywhere, nobody else can read it, and it does not follow
// the reader to another device — hence the backup file.
// init(ctx) runs on every Quartz "nav" event.

const KEY = "gd-table-logbook"
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const plain = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

let memory = null // used when the browser refuses storage (private mode): lasts until the tab closes
function load() {
  if (memory) return memory
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || "null")
    if (d && typeof d.pages === "object" && d.pages) return { v: 1, pages: d.pages, loose: String(d.loose ?? ""), looseU: d.looseU || 0 }
  } catch {}
  return { v: 1, pages: {}, loose: "", looseU: 0 }
}
function save(book) {
  for (const [slug, e] of Object.entries(book.pages)) if (!e.p && !String(e.n ?? "").trim()) delete book.pages[slug]
  try {
    localStorage.setItem(KEY, JSON.stringify(book))
    memory = null
    return true
  } catch {
    memory = book
    return false
  }
}
const SAVED = "Kept on this device"
const NOT_SAVED = "This browser does not keep notes (private mode?)"

export function init(ctx) {
  const article = document.querySelector("article")
  if (!article) return
  for (const box of document.querySelectorAll(".gd-logbook")) if (!box.querySelector(".gdt-lb")) drawBook(ctx, box)
  // pin and note on ordinary pages: not on the front page, listings, or the tool pages themselves
  const slug = ctx.slug
  if (!slug || slug === "index" || slug === "404" || /(^|\/)index$/.test(slug) || slug.startsWith("tags/")) return
  if (article.querySelector(".gd-logbook, .gd-quiz, .gd-lineup, .gdt-lb-bar")) return
  drawBar(ctx, article, slug)
}

// ---------------------------------------------------------------- on a page

function drawBar(ctx, article, slug) {
  const h1 = article.querySelector("h1")
  const title = (h1?.textContent || document.title || slug).trim()
  const bar = document.createElement("div")
  bar.className = "gdt gdt-lb-bar"
  bar.innerHTML = `
    <div class="gdt-row">
      <button type="button" data-do="pin"></button>
      <button type="button" data-do="note"></button>
      <span class="gdt-note" aria-live="polite"></span>
    </div>
    <textarea hidden aria-label="My note on ${esc(title)}" placeholder="Only you see this. It stays on this device."></textarea>`
  const pin = bar.querySelector('[data-do="pin"]')
  const noteBtn = bar.querySelector('[data-do="note"]')
  const area = bar.querySelector("textarea")
  const status = bar.querySelector(".gdt-note")
  const entry = () => load().pages[slug] ?? { t: title, p: 0, n: "", u: 0 }
  const write = (change) => {
    const book = load()
    const e = { ...(book.pages[slug] ?? { t: title, p: 0, n: "" }), ...change, t: title, u: Date.now() }
    book.pages[slug] = e
    status.textContent = save(book) ? SAVED : NOT_SAVED
  }
  const paint = () => {
    const e = entry()
    pin.textContent = e.p ? "★ Pinned" : "☆ Pin"
    pin.setAttribute("aria-pressed", String(!!e.p))
    noteBtn.textContent = e.n ? "My note" : "Add a note"
    noteBtn.setAttribute("aria-expanded", String(!area.hidden))
  }
  const first = entry()
  if (first.n) {
    area.value = first.n
    area.hidden = false
  }
  pin.addEventListener("click", () => {
    write({ p: entry().p ? 0 : 1 })
    paint()
  })
  noteBtn.addEventListener("click", () => {
    area.hidden = !area.hidden && !area.value.trim() ? true : false
    if (!area.hidden) area.focus()
    paint()
  })
  let timer
  const flush = () => {
    clearTimeout(timer)
    if (area.value !== entry().n) write({ n: area.value })
    paint()
  }
  area.addEventListener("input", () => {
    clearTimeout(timer)
    timer = setTimeout(flush, 400)
  })
  area.addEventListener("blur", flush)
  // Quartz swaps the page without a reload: write what is still pending before the bar goes
  window.addCleanup?.(flush)
  if (h1 && h1.parentElement) h1.after(bar)
  else article.prepend(bar)
  paint()
}

// ---------------------------------------------------------------- the Logbook page

function drawBook(ctx, box) {
  const ui = document.createElement("div")
  ui.className = "gdt gdt-lb"
  ui.innerHTML = `
    <p class="gdt-note">Kept in this browser, on this device only. Nobody else can read it — not the DM, not your other devices. Clearing the browser's site data deletes it: save a backup now and then.</p>
    <div>
      <p class="gdt-lbl">Loose notes</p>
      <textarea data-loose aria-label="Loose notes" placeholder="Anything that belongs to no page."></textarea>
    </div>
    <div>
      <p class="gdt-lbl">Pinned pages and notes <span data-count></span></p>
      <input type="search" placeholder="Filter…" aria-label="Filter the logbook" autocomplete="off">
      <ul class="gdt-lb-list"></ul>
      <p class="gdt-lb-empty" hidden></p>
    </div>
    <div class="gdt-row">
      <button type="button" data-do="copy">Copy all as text</button>
      <button type="button" data-do="backup">Save a backup file</button>
      <button type="button" data-do="restore">Load a backup file</button>
      <input class="gdt-lb-file" type="file" accept="application/json,.json" aria-label="Backup file">
      <span class="gdt-note" data-status aria-live="polite"></span>
    </div>`
  const $ = (s) => ui.querySelector(s)
  const list = $(".gdt-lb-list")
  const filter = $('input[type="search"]')
  const status = $("[data-status]")
  const say = (t) => (status.textContent = t)
  const place = (slug) => slug.split("/").slice(0, -1).join(" / ").replace(/-/g, " ")
  const sorted = (book) => Object.entries(book.pages).sort(([, a], [, b]) => (b.p || 0) - (a.p || 0) || (b.u || 0) - (a.u || 0))

  const paint = () => {
    const book = load()
    const q = plain(filter.value.trim())
    const all = sorted(book)
    const rows = all.filter(([slug, e]) => !q || plain(`${e.t} ${e.n} ${slug}`).includes(q))
    $("[data-count]").textContent = all.length ? `· ${all.length}` : ""
    list.innerHTML = rows
      .map(
        ([slug, e]) => `<li data-slug="${esc(slug)}">
        <div class="gdt-lb-head">
          <a class="internal gdt-lb-title" href="${esc(ctx.root + slug)}">${esc(e.t || slug)}</a>
          <button type="button" class="gdt-plain" data-do="pin" aria-pressed="${!!e.p}" aria-label="${e.p ? "Unpin" : "Pin"} ${esc(e.t)}">${e.p ? "★" : "☆"}</button>
          <button type="button" class="gdt-plain" data-do="drop" aria-label="Remove ${esc(e.t)} from the logbook">✕</button>
        </div>
        <p class="gdt-lbl">${esc(place(slug))}</p>
        <textarea aria-label="My note on ${esc(e.t)}" placeholder="No note yet.">${esc(e.n)}</textarea></li>`,
      )
      .join("")
    const empty = $(".gdt-lb-empty")
    empty.hidden = rows.length > 0
    empty.textContent = all.length ? "Nothing matches." : "Nothing yet. Every page has “Pin” and “Add a note” under its title."
  }
  const asText = (book) =>
    [
      book.loose.trim() && `Loose notes\n${book.loose.trim()}`,
      ...sorted(book).map(([slug, e]) => `${e.p ? "★ " : ""}${e.t}\n${ctx.root + slug}${e.n.trim() ? `\n${e.n.trim()}` : ""}`),
    ]
      .filter(Boolean)
      .join("\n\n")

  $("[data-loose]").value = load().loose
  $("[data-loose]").addEventListener("input", (e) => {
    const book = load()
    book.loose = e.target.value
    book.looseU = Date.now()
    say(save(book) ? SAVED : NOT_SAVED)
  })
  filter.addEventListener("input", paint)
  list.addEventListener("input", (e) => {
    const li = e.target.closest("li[data-slug]")
    if (!li || e.target.tagName !== "TEXTAREA") return
    const book = load()
    const entry = book.pages[li.dataset.slug]
    if (!entry) return
    entry.n = e.target.value
    entry.u = Date.now()
    // an unpinned entry whose note is emptied stays listed until the page is left, so typing is never interrupted
    try {
      localStorage.setItem(KEY, JSON.stringify(book))
      say(SAVED)
    } catch {
      memory = book
      say(NOT_SAVED)
    }
  })
  ui.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-do]")
    if (!t) return
    const what = t.dataset.do
    const li = t.closest("li[data-slug]")
    const book = load()
    if (li && what === "pin") {
      const entry = book.pages[li.dataset.slug]
      entry.p = entry.p ? 0 : 1
      if (!entry.p && !entry.n.trim()) return say("Unpinned pages without a note leave the logbook: add a note, or use ✕ to remove it.")
      save(book)
      paint()
    } else if (li && what === "drop") {
      const entry = book.pages[li.dataset.slug]
      if (entry.n.trim() && !confirm(`Remove “${entry.t}” and its note from the logbook?`)) return
      delete book.pages[li.dataset.slug]
      save(book)
      paint()
    } else if (what === "copy") {
      const text = asText(book)
      if (!text) return say("Nothing to copy yet.")
      try {
        await navigator.clipboard.writeText(text)
        say("Copied.")
      } catch {
        say("This browser did not allow copying. Use the backup file.")
      }
    } else if (what === "backup") {
      const a = document.createElement("a")
      a.href = URL.createObjectURL(new Blob([JSON.stringify({ what: "Gold Daggers logbook", ...book }, null, 1)], { type: "application/json" }))
      a.download = `gold-daggers-logbook-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
      say("Backup saved to your downloads.")
    } else if (what === "restore") $(".gdt-lb-file").click()
  })
  $(".gdt-lb-file").addEventListener("change", async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    try {
      const d = JSON.parse(await file.text())
      if (!d || typeof d.pages !== "object" || !d.pages) throw new Error("not a logbook file")
      const book = load()
      let n = 0
      // merge, never wipe: for a page that is in both, the more recently changed entry wins
      for (const [slug, e2] of Object.entries(d.pages)) {
        if (!e2 || typeof e2 !== "object") continue
        const mine = book.pages[slug]
        if (mine && (mine.u || 0) >= (e2.u || 0)) continue
        book.pages[slug] = { t: String(e2.t ?? slug), p: e2.p ? 1 : 0, n: String(e2.n ?? ""), u: Number(e2.u) || 0 }
        n++
      }
      if (typeof d.loose === "string" && d.loose.trim() && (d.looseU || 0) > (book.looseU || 0)) {
        book.loose = book.loose.trim() && book.loose.trim() !== d.loose.trim() ? `${book.loose.trim()}\n\n${d.loose.trim()}` : d.loose
        book.looseU = d.looseU || Date.now()
        $("[data-loose]").value = book.loose
      }
      save(book)
      paint()
      say(`Loaded: ${n} ${n === 1 ? "entry" : "entries"} added or updated.`)
    } catch {
      say("That file is not a logbook backup.")
    }
  })
  box.querySelector(".gd-table-fallback")?.remove()
  box.appendChild(ui)
  paint()
}
