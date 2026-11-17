// Gold Daggers table tools — Spotlight (vanilla JS, no dependencies).
// One portrait, full screen: for the TV, or a phone held up. Plus a line-up that is put together
// beforehand and stepped through during play. The line-up lives in this browser only (localStorage).
// init(ctx) runs on every Quartz "nav" event.

const KEY = "gd-table-lineup"
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const plain = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || "null")
    if (d && Array.isArray(d.items)) return { names: d.names !== false, items: d.items.filter((x) => x && x.i && x.n) }
  } catch {}
  return { names: true, items: [] }
}
function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, names: state.names, items: state.items }))
    return true
  } catch {
    return false // private mode or storage full: the list then only lasts until the page is left
  }
}
let state = load()
let stage = null // the open overlay, if any
let facesCache = null

export function init(ctx) {
  closeStage()
  state = load()
  const article = document.querySelector("article")
  if (!article) return
  // a character page: a button under the portrait
  if (ctx.slug.startsWith("entities/") && !article.querySelector(".gdt-showbar")) {
    const img = article.querySelector("img")
    const h1 = article.querySelector("h1")
    if (img && !img.closest(".gdt, a")) {
      const face = { n: (h1?.textContent || document.title).trim(), h: ctx.slug, i: rel(img.currentSrc || img.src, ctx.root) }
      const bar = document.createElement("p")
      bar.className = "gdt-showbar"
      bar.innerHTML = `<button type="button" class="gdt-btn">Show at the table</button>`
      bar.firstChild.addEventListener("click", () => openStage(ctx, [face], 0, { single: true }))
      ;(img.closest("p") || img).after(bar)
    }
  }
  // the line-up page
  for (const box of document.querySelectorAll(".gd-lineup")) if (!box.querySelector(".gdt-lu")) drawLineup(ctx, box)
}

const rel = (url, root) => (url.startsWith(root) ? url.slice(root.length) : url)
const abs = (p, root) => (/^[a-z]+:/i.test(p) ? p : root + p)

// ---------------------------------------------------------------- the stage

function closeStage() {
  if (!stage) return
  stage.cleanup()
  stage = null
}

function openStage(ctx, faces, start, { single = false } = {}) {
  closeStage()
  // a line-up starts and ends on a dark screen, so nothing shows before the DM wants it to
  let at = single ? 0 : -1
  if (!single && start != null) at = start
  const el = document.createElement("div")
  el.className = "gdt-stage"
  el.setAttribute("role", "dialog")
  el.setAttribute("aria-label", "Portrait, full screen")
  el.innerHTML = `
    <div class="gdt-stage-fig"><img alt=""></div>
    <p class="gdt-stage-name"></p>
    <div class="gdt-stage-ctl">
      ${single ? "" : `<button type="button" data-do="prev" aria-label="Back">←</button><button type="button" data-do="next" aria-label="Next">→</button><button type="button" data-do="dark">Dark</button>`}
      <button type="button" data-do="names">Name</button>
      ${single ? `<button type="button" data-do="keep"></button>` : ""}
      <button type="button" data-do="full">Full screen</button>
      <button type="button" data-do="close">Close</button>
    </div>`
  const img = el.querySelector("img")
  const name = el.querySelector(".gdt-stage-name")
  const btn = (d) => el.querySelector(`[data-do="${d}"]`)
  const inLineup = () => state.items.some((x) => x.h === faces[0].h)
  let names = single ? true : state.names

  const draw = () => {
    const f = faces[at]
    el.classList.toggle("is-dark", !f)
    el.classList.toggle("no-names", !names)
    if (f) {
      img.src = abs(f.i, ctx.root)
      name.textContent = f.n
      // have the next picture ready, so stepping on is instant on a slow connection
      if (faces[at + 1]) new Image().src = abs(faces[at + 1].i, ctx.root)
    }
    btn("names").setAttribute("aria-pressed", String(names))
    if (btn("dark")) btn("dark").setAttribute("aria-pressed", String(!f))
    if (btn("keep")) btn("keep").textContent = inLineup() ? "In the line-up ✓" : "Add to line-up"
  }
  let before = 0
  const act = (what) => {
    if (what === "next") at = at >= faces.length - 1 ? -1 : at + 1
    else if (what === "prev") at = at < 0 ? faces.length - 1 : at - 1
    else if (what === "dark") {
      if (at >= 0) (before = at), (at = -1)
      else at = before
    } else if (what === "names") {
      names = !names
      if (!single) (state.names = names), save(state)
    } else if (what === "keep") {
      if (inLineup()) state.items = state.items.filter((x) => x.h !== faces[0].h)
      else state.items.push(faces[0])
      save(state)
    } else if (what === "full") {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement
      const req = el.requestFullscreen || el.webkitRequestFullscreen
      const exit = document.exitFullscreen || document.webkitExitFullscreen
      try {
        if (fsEl) exit?.call(document)
        else req?.call(el) // iPhone has no element full screen: the stage already covers the page
      } catch {}
    } else if (what === "close") return closeStage()
    draw()
  }

  let idle
  const wake = () => {
    el.classList.remove("is-idle")
    clearTimeout(idle)
    idle = setTimeout(() => el.classList.add("is-idle"), 2600)
  }
  el.addEventListener("click", (e) => {
    const awake = !el.classList.contains("is-idle")
    wake()
    const b = e.target.closest("button[data-do]")
    if (b) return act(b.dataset.do)
    // a tap on the picture: right half next, left half back — but the first tap only wakes the buttons
    if (!single && awake) act(e.clientX > window.innerWidth / 2 ? "next" : "prev")
  })
  el.addEventListener("mousemove", wake)
  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const map = { Escape: "close", ArrowRight: "next", " ": "next", ArrowLeft: "prev", b: "dark", B: "dark", n: "names", N: "names", f: "full", F: "full" }
    const what = map[e.key]
    if (!what || (single && ["next", "prev", "dark"].includes(what))) return
    if (what === "close" && (document.fullscreenElement || document.webkitFullscreenElement)) return // Esc leaves full screen first
    e.preventDefault()
    e.stopPropagation()
    act(what)
  }
  document.addEventListener("keydown", onKey, true)
  const scrollWas = document.documentElement.style.overflow
  document.documentElement.style.overflow = "hidden"
  document.body.appendChild(el)
  stage = {
    cleanup() {
      clearTimeout(idle)
      document.removeEventListener("keydown", onKey, true)
      document.documentElement.style.overflow = scrollWas
      if ((document.fullscreenElement || document.webkitFullscreenElement) === el) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)
      el.remove()
      document.querySelectorAll(".gdt-lu").forEach((x) => x.dispatchEvent(new Event("gdt-refresh")))
    },
  }
  draw()
  wake()
  btn("close").focus({ preventScroll: true })
}

// ---------------------------------------------------------------- the line-up page

async function drawLineup(ctx, box) {
  const link = box.querySelector("a.gd-table-data")
  if (!link) return
  if (!facesCache) facesCache = fetch(link.href).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
  let faces
  try {
    faces = (await facesCache).faces
  } catch (err) {
    facesCache = null
    console.error("Portrait list could not be loaded", err)
    return
  }
  if (!box.isConnected || box.querySelector(".gdt-lu")) return
  const ui = document.createElement("div")
  ui.className = "gdt gdt-lu"
  ui.innerHTML = `
    <div>
      <p class="gdt-lbl">Tonight's line-up</p>
      <ol class="gdt-lu-list"></ol>
      <p class="gdt-lu-empty" hidden>Nobody yet. Add portraits below, or use “Show at the table” on a character page.</p>
    </div>
    <div class="gdt-row">
      <button type="button" class="gdt-main" data-do="start">Start the show</button>
      <button type="button" data-do="names"></button>
      <button type="button" class="gdt-plain" data-do="clear">Clear the list</button>
    </div>
    <p class="gdt-note">Starts and ends on a dark screen. → next · ← back · B dark · N name · F full screen · Esc close. On a phone: tap the right or left half.</p>
    <div>
      <p class="gdt-lbl">Add a portrait</p>
      <input type="search" placeholder="Name…" aria-label="Find a portrait by name" autocomplete="off">
      <ul class="gdt-lu-hits"></ul>
    </div>`
  const list = ui.querySelector(".gdt-lu-list")
  const hits = ui.querySelector(".gdt-lu-hits")
  const input = ui.querySelector("input")
  const thumb = (f) => `<img src="${esc(abs(f.i, ctx.root))}" alt="" loading="lazy">`

  const drawList = () => {
    list.innerHTML = state.items
      .map(
        (f, i) => `<li><span class="gdt-lu-no">${i + 1}</span>${thumb(f)}<span class="gdt-lu-name">${esc(f.n)}</span>
        <button type="button" class="gdt-plain" data-up="${i}" aria-label="Move ${esc(f.n)} up"${i ? "" : " disabled"}>↑</button>
        <button type="button" class="gdt-plain" data-down="${i}" aria-label="Move ${esc(f.n)} down"${i < state.items.length - 1 ? "" : " disabled"}>↓</button>
        <button type="button" class="gdt-plain" data-drop="${i}" aria-label="Take ${esc(f.n)} out">✕</button></li>`,
      )
      .join("")
    ui.querySelector(".gdt-lu-empty").hidden = state.items.length > 0
    ui.querySelector('[data-do="start"]').disabled = !state.items.length
    ui.querySelector('[data-do="clear"]').hidden = !state.items.length
    const nb = ui.querySelector('[data-do="names"]')
    nb.textContent = state.names ? "Names: shown" : "Names: hidden"
    nb.setAttribute("aria-pressed", String(state.names))
  }
  const drawHits = () => {
    const q = plain(input.value.trim())
    const taken = new Set(state.items.map((x) => x.h))
    const starts = (f) => (plain(f.n).startsWith(q) ? 0 : 1)
    const found = q ? faces.filter((f) => !taken.has(f.h) && plain(f.n).includes(q)).sort((a, b) => starts(a) - starts(b)).slice(0, 8) : []
    hits.innerHTML = found.map((f) => `<li data-add="${esc(f.h)}" tabindex="0" role="button">${thumb(f)}<span class="gdt-lu-name">${esc(f.n)}</span><span class="gdt-lbl">add</span></li>`).join("")
  }
  const add = (h) => {
    const f = faces.find((x) => x.h === h)
    if (!f) return
    state.items.push({ n: f.n, h: f.h, i: f.i })
    save(state)
    input.value = ""
    drawList()
    drawHits()
    input.focus()
  }
  ui.addEventListener("click", (e) => {
    const t = e.target.closest("[data-up],[data-down],[data-drop],[data-add],[data-do]")
    if (!t) return
    const d = t.dataset
    if (d.add) return add(d.add)
    if (d.do === "start") return openStage(ctx, state.items.slice(), null)
    if (d.do === "names") state.names = !state.names
    else if (d.do === "clear") state.items = []
    else if (d.drop) state.items.splice(+d.drop, 1)
    else {
      const i = +(d.up ?? d.down), j = d.up ? i - 1 : i + 1
      ;[state.items[i], state.items[j]] = [state.items[j], state.items[i]]
    }
    save(state)
    drawList()
    drawHits()
  })
  hits.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.dataset.add) add(e.target.dataset.add)
  })
  input.addEventListener("input", drawHits)
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && hits.firstElementChild) add(hits.firstElementChild.dataset.add)
  })
  ui.addEventListener("gdt-refresh", () => {
    state = load()
    drawList()
  })
  box.querySelector(".gd-table-fallback")?.remove()
  box.appendChild(ui)
  drawList()
}
