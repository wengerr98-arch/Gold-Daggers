// Gold Daggers table tools — "Who is this?" (vanilla JS, no dependencies).
// A portrait quiz over the same portraits the Gallery shows. Nothing is made up: names and pictures
// come straight from the published pages. The best streak is kept in this browser (localStorage).
// init(ctx) runs on every Quartz "nav" event.

const KEY = "gd-table-quiz"
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
let facesCache = null
// kept while the tab stays open, so leaving the page and coming back keeps the run
const run = { mode: "name", streak: 0, right: 0, asked: 0, deck: [] }

function best(set) {
  try {
    if (set != null) localStorage.setItem(KEY, JSON.stringify({ v: 1, best: set }))
    return JSON.parse(localStorage.getItem(KEY) || "{}").best || 0
  } catch {
    return set || 0
  }
}

export function init(ctx) {
  for (const box of document.querySelectorAll(".gd-quiz")) if (!box.querySelector(".gdt-qz")) draw(ctx, box)
}

async function draw(ctx, box) {
  const link = box.querySelector("a.gd-table-data")
  if (!link) return
  if (!facesCache) facesCache = fetch(link.href).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
  let faces
  try {
    // one entry per picture: two pages that share a portrait would make a question with two right answers
    const seen = new Set()
    faces = (await facesCache).faces.filter((f) => !seen.has(f.i) && seen.add(f.i))
  } catch (err) {
    facesCache = null
    console.error("Portrait list could not be loaded", err)
    return
  }
  if (!box.isConnected || box.querySelector(".gdt-qz") || faces.length < 4) return
  const src = (f) => ctx.root + f.i
  const ui = document.createElement("div")
  ui.className = "gdt gdt-qz"
  ui.innerHTML = `
    <div class="gdt-row">
      <button type="button" data-mode="name">Face → name</button>
      <button type="button" data-mode="face">Name → face</button>
    </div>
    <p class="gdt-qz-score" aria-live="polite"></p>
    <div class="gdt-qz-q"></div>
    <div class="gdt-qz-opts"></div>
    <div class="gdt-row gdt-qz-after"></div>`
  const $ = (s) => ui.querySelector(s)
  let q = null // { face, options, picked }

  const score = () => {
    $(".gdt-qz-score").innerHTML = `Streak <b>${run.streak}</b> · Best <b>${best()}</b> · Right <b>${run.right}</b> of <b>${run.asked}</b>`
    ui.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === run.mode)))
  }
  const ask = () => {
    if (!run.deck.length) run.deck = shuffle(faces.map((_, i) => i))
    const face = faces[run.deck.pop()]
    // wrong answers come from the same kind of page first (people among people, gods among gods)
    const others = shuffle(faces.filter((f) => f !== face && f.n !== face.n))
    const near = others.filter((f) => f.k === face.k)
    const options = shuffle([face, ...[...near, ...others.filter((f) => f.k !== face.k)].slice(0, 3)])
    q = { face, options, picked: null }
    paint()
  }
  const paint = () => {
    const { face, options, picked } = q
    const byName = run.mode === "name"
    $(".gdt-qz-q").innerHTML = byName ? `<div class="gdt-qz-face"><img src="${esc(src(face))}" alt="Portrait to guess"></div>` : `<p class="gdt-qz-ask">${esc(face.n)}</p>`
    const opts = $(".gdt-qz-opts")
    opts.className = `gdt-qz-opts${byName ? "" : " is-faces"}${picked ? " is-done" : ""}`
    opts.innerHTML = options
      .map((f, i) => {
        const cls = picked ? (f === face ? "is-right" : f === picked ? "is-wrong" : "") : ""
        const mark = cls === "is-right" ? "✓ " : cls === "is-wrong" ? "✕ " : ""
        const inner = byName ? `${mark}${esc(f.n)}` : `<img src="${esc(src(f))}" alt="${picked ? "" : `Portrait ${i + 1}`}">${picked ? `<span class="gdt-qz-cap">${mark}${esc(f.n)}</span>` : ""}`
        return `<button type="button" data-pick="${i}" class="${cls}"${picked ? " disabled" : ""}>${inner}</button>`
      })
      .join("")
    $(".gdt-qz-after").innerHTML = picked
      ? `<span class="gdt-qz-verdict">${picked === face ? "Right." : "No."} <a class="internal" href="${esc(ctx.root + face.h)}">${esc(face.n)}</a></span><button type="button" class="gdt-main" data-next>Next</button>`
      : ""
    if (picked) $("[data-next]").focus({ preventScroll: true })
    score()
  }
  const pick = (i) => {
    if (!q || q.picked || !q.options[i]) return
    q.picked = q.options[i]
    run.asked++
    if (q.picked === q.face) {
      run.right++
      run.streak++
      if (run.streak > best()) best(run.streak)
    } else run.streak = 0
    paint()
  }
  ui.addEventListener("click", (e) => {
    const t = e.target.closest("[data-pick],[data-next],[data-mode]")
    if (!t) return
    if (t.dataset.pick != null) pick(+t.dataset.pick)
    else if (t.dataset.mode) {
      if (t.dataset.mode === run.mode) return
      run.mode = t.dataset.mode
      ask()
    } else ask()
  })
  const onKey = (e) => {
    if (!ui.isConnected) return document.removeEventListener("keydown", onKey)
    if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return
    if (/^[1-4]$/.test(e.key)) pick(+e.key - 1)
  }
  document.addEventListener("keydown", onKey)
  box.querySelector(".gd-table-fallback")?.remove()
  box.appendChild(ui)
  ask()
}
