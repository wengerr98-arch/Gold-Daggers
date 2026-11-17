// Gold Daggers table tools — Year converter (vanilla JS, no dependencies).
// A year in p.B. and in Ephraim's count, its distance to the present, and what the timeline has for
// that year. Only these two counts are converted. Nothing is made up: the entries come from the
// timeline's own data (content/table-years.json is a cut-down copy of it).
// init(ctx) runs on every Quartz "nav" event.

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const yr = (y) => (y < 0 ? "−" : "") + Math.abs(y) // years are written without digit grouping, like on the timeline
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many ?? one + "s")}`
const OTHER = "Some calendars (the tavern logbook, Stygia) can't be converted."
let dataCache = null

export function init(ctx) {
  for (const box of document.querySelectorAll(".gd-years")) if (!box.querySelector(".gdt-yc")) draw(ctx, box)
  // a small link on the timeline page
  const tl = ctx.options?.timeline_link && document.querySelector(".gd-timeline")
  if (tl && !document.querySelector(".gdt-yc-link")) {
    const p = document.createElement("p")
    p.className = "gdt gdt-yc-link"
    p.innerHTML = `<a class="internal" href="${esc(ctx.root + ctx.options.page)}">Convert a year →</a>`
    tl.before(p)
  }
}

// "831", "-5170", "−769", "323 p.B.", "323pb", "2152 ephraim", "5'170" → { n, cal } · cal: "pb" | "eph" | null (not said)
export function parse(raw) {
  const text = String(raw ?? "").trim()
  if (!text) return { empty: true }
  if (/styg|lotti|tavern|taverne|logbook|logbuch|jahr\b/i.test(text)) return { other: true }
  let t = text.replace(/[−–—‒]/g, "-").replace(/(\d)[’'`.,\s](?=\d{3}(\D|$))/g, "$1")
  let cal = null
  if (/p\.?\s*b\.?/i.test(t)) cal = "pb"
  else if (/e(ph|f)+r/i.test(t)) cal = "eph"
  t = t.replace(/p\.?\s*b\.?/i, "").replace(/(in\s+)?e(ph|f)+r\w*('s)?(\s+count)?/i, "").replace(/\s+/g, "")
  const m = t.match(/^([+-]?)(\d{1,6})$/)
  if (!m) return { bad: true }
  return { n: (m[1] === "-" ? -1 : 1) * Number(m[2]), cal }
}

async function draw(ctx, box) {
  const link = box.querySelector("a.gd-table-data")
  if (!link) return
  if (!dataCache) dataCache = fetch(link.href).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
  let d
  try {
    d = await dataCache
  } catch (err) {
    dataCache = null
    console.error("Year data could not be loaded", err)
    return
  }
  if (!box.isConnected || box.querySelector(".gdt-yc")) return
  const approx = new Set(d.approx ?? [])
  const byYear = new Map(d.years.map((y) => [y.y, y]))
  const loreAt = (y) => d.lore.filter((l) => (l.to != null ? l.y <= y && y <= l.to : l.y === y))
  // every year that has something, for the picks and for "nearest"
  const known = [...new Set([...d.years.map((y) => y.y), ...d.lore.map((l) => l.y), d.present])].sort((a, b) => a - b)
  const tlHref = (q) => (d.timeline ? `${ctx.root}${d.timeline}?${q}` : null)

  const ui = document.createElement("div")
  ui.className = "gdt gdt-yc"
  ui.innerHTML = `
    <div class="gdt-yc-form">
      <div class="gdt-row gdt-yc-mode" role="group" aria-label="The year I type is in">
        <button type="button" data-cal="pb">p.B.</button>
        <button type="button" data-cal="eph">Ephraim's count</button>
      </div>
      <div class="gdt-yc-in">
        <button type="button" data-step="-1" aria-label="One year earlier">−</button>
        <input type="text" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" aria-label="Year" placeholder="${yr(d.present)}">
        <button type="button" data-step="1" aria-label="One year later">+</button>
      </div>
    </div>
    <div class="gdt-yc-out" aria-live="polite"></div>
    <div class="gdt-yc-picks"><p class="gdt-lbl">Years with entries</p><p class="gdt-yc-chips">${known
      .map((y) => `<button type="button" data-y="${y}">${approx.has(y) ? "≈ " : ""}${yr(y)}</button>`)
      .join("")}</p></div>
    <div class="gdt-yc-known"></div>
    <p class="gdt-note gdt-yc-other">${esc(OTHER)}</p>`
  const $ = (s) => ui.querySelector(s)
  const input = $("input")
  const st = { cal: "pb", y: d.present, msg: "" } // y is always p.B.

  const paint = () => {
    ui.querySelectorAll("[data-cal]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.cal === st.cal)))
    ui.querySelectorAll("[data-y]").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.y === st.y)))
    $(".gdt-yc-other").classList.toggle("is-on", st.msg === "other")
    const out = $(".gdt-yc-out"), kn = $(".gdt-yc-known")
    if (st.msg) {
      out.innerHTML = `<p class="gdt-yc-hint">${st.msg === "other" ? esc(OTHER) : `Type a year, for example ${yr(323)} or ${yr(-5170)}.`}</p>`
      kn.innerHTML = ""
      return
    }
    const y = st.y, gap = d.present - y, ap = approx.has(y) ? "≈ " : ""
    const dist = gap === 0 ? "The present." : `${plural(Math.abs(gap), "year")} ${gap > 0 ? "before" : "after"} the present (${yr(d.present)} p.B.)`
    const a = `<p class="gdt-yc-big"><b>${ap}${yr(y)}</b> p.B.</p>`
    const b = `<p class="gdt-yc-big"><b>${ap}${yr(y + d.offset)}</b> in Ephraim's count</p>`
    out.innerHTML = `${st.cal === "eph" ? b + a : a + b}<p class="gdt-yc-dist">${dist}</p>`

    // what the timeline has for this year
    const yd = byYear.get(y), lore = loreAt(y)
    let html = ""
    if (yd) {
      const runs = []
      for (const s of yd.s) runs.length && runs[runs.length - 1][1] === s - 1 ? (runs[runs.length - 1][1] = s) : runs.push([s, s])
      const sess = runs
        .map(([f, t]) => {
          const label = f === t ? `session ${f}` : `sessions ${f}–${t}`
          const h = tlHref(`s=${f}`)
          return h ? `<a class="internal" href="${esc(h)}">${label}</a>` : label
        })
        .join(", ")
      html += `<section><p class="gdt-lbl">The party was there</p><p class="gdt-yc-sum">${plural(yd.n, "event")} · ${sess}</p>`
      if (yd.e)
        html += `<ul>${yd.e
          .map((e) => {
            const h = tlHref(`e=${encodeURIComponent(e.id)}`)
            return `<li>${h ? `<a class="internal" href="${esc(h)}">${esc(e.w)}</a>` : esc(e.w)}</li>`
          })
          .join("")}</ul>`
      html += `</section>`
    }
    if (lore.length)
      html += `<section><p class="gdt-lbl">Told to the party</p><ul>${lore
        .map((l) => {
          const h = tlHref(`s=${l.s}`)
          const when = `${l.a ? "≈ " : ""}${yr(l.y)}${l.to != null ? `–${yr(l.to)}` : ""} p.B.`
          return `<li>${esc(l.w)} <span class="gdt-yc-src">${when} · ${h ? `<a class="internal" href="${esc(h)}">session ${l.s}</a>` : `session ${l.s}`}</span></li>`
        })
        .join("")}</ul></section>`
    if (!html) {
      const before = known.filter((k) => k < y).pop(), after = known.find((k) => k > y)
      const near = [before, after]
        .filter((k) => k != null)
        .map((k) => `<button type="button" data-y="${k}">${approx.has(k) ? "≈ " : ""}${yr(k)} p.B. <span>${plural(Math.abs(k - y), "year")} ${k < y ? "earlier" : "later"}</span></button>`)
        .join("")
      html = `<section><p class="gdt-yc-none">The timeline has nothing for this year.</p>${near ? `<p class="gdt-lbl">Nearest years with entries</p><p class="gdt-yc-near">${near}</p>` : ""}</section>`
    }
    kn.innerHTML = html
  }
  const syncUrl = () => {
    if (!ui.isConnected) return
    const u = new URL(window.location.href)
    u.searchParams.delete("y")
    u.searchParams.delete("c")
    if (!st.msg && (st.y !== d.present || st.cal === "eph")) {
      u.searchParams.set("y", String(st.y))
      if (st.cal === "eph") u.searchParams.set("c", "e")
    }
    try {
      history.replaceState(history.state, "", u)
    } catch {}
  }
  // show a p.B. year in the box, written in the count the reader types in
  const show = (y) => {
    st.y = y
    st.msg = ""
    input.value = yr(st.cal === "eph" ? y + d.offset : y)
    paint()
    syncUrl()
  }
  const read = () => {
    const r = parse(input.value)
    if (r.empty) {
      st.y = d.present
      st.msg = ""
    } else if (r.other) st.msg = "other"
    else if (r.bad) st.msg = "bad"
    else {
      if (r.cal) st.cal = r.cal
      st.y = st.cal === "eph" ? r.n - d.offset : r.n
      st.msg = ""
    }
    paint()
    syncUrl()
  }
  input.addEventListener("input", read)
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur()
    else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !st.msg) {
      e.preventDefault()
      show(st.y + (e.key === "ArrowUp" ? 1 : -1))
    }
  })
  ui.addEventListener("click", (e) => {
    const t = e.target.closest("[data-cal],[data-y],[data-step]")
    if (!t) return
    if (t.dataset.cal) {
      // the number in the box stays what the reader typed; it is read in the other count
      st.cal = t.dataset.cal
      const r = parse(input.value)
      if (r.n != null) {
        st.y = st.cal === "eph" ? r.n - d.offset : r.n
        input.value = yr(r.n)
        st.msg = ""
      }
      paint()
      syncUrl()
    } else if (t.dataset.y != null) show(+t.dataset.y)
    else show((st.msg ? d.present : st.y) + +t.dataset.step)
  })

  // a link can name the year: ?y=323 (always p.B.), &c=e shows it as typed in Ephraim's count
  const u = new URLSearchParams(window.location.search)
  if (u.get("c") === "e") st.cal = "eph"
  const fromUrl = u.has("y") ? parse(u.get("y")) : null
  box.querySelector(".gd-table-fallback")?.remove()
  box.appendChild(ui)
  if (fromUrl?.n != null) show(fromUrl.n)
  else paint()
}
