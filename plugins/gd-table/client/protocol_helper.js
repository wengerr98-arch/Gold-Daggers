// Gold Daggers table tools — Protocol helper (vanilla JS, no dependencies).
// A plain writing page for whoever keeps the session protocol. Typing a name offers the names of the
// published pages (content/table-names.json: names, other names, kind — no page text); choosing one
// puts it in as [[Name]] or [[Name|other name]], so the text links up when pasted into the vault.
// The text stays in this browser (localStorage); nothing is sent anywhere.
// init(ctx) runs on every Quartz "nav" event.

const KEY = "gd-table-protocol"
const MAX = 6 // suggestions shown
const MIN = 3 // letters before suggestions start (a shorter full name still counts)
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const plain = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
const pad = (n) => String(n).padStart(2, "0")
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const niceDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number)
  try {
    return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
  } catch {
    return iso
  }
}
const SAVED = "Kept on this device"
const NOT_SAVED = "This browser does not keep the text (private mode?) — copy it before you close the tab"

let memory = null // used when the browser refuses storage: lasts until the tab closes
function load() {
  if (memory) return memory
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || "null")
    if (d && typeof d === "object") return { v: 1, title: String(d.title ?? ""), text: String(d.text ?? ""), d: /^\d{4}-\d\d-\d\d$/.test(d.d) ? d.d : "", prev: d.prev && typeof d.prev === "object" ? d.prev : null }
  } catch {}
  return { v: 1, title: "", text: "", d: "", prev: null }
}
function save(doc) {
  try {
    localStorage.setItem(KEY, JSON.stringify(doc))
    memory = null
    return true
  } catch {
    memory = doc
    return false
  }
}

let namesCache = null
// one entry per name and per other name: { p: plain text to match, e: the page, a: the other name or null }
function index(names) {
  const keys = []
  for (const e of names) {
    keys.push({ p: plain(e.n), e, a: null })
    for (const a of e.a ?? []) if (plain(a) !== plain(e.n)) keys.push({ p: plain(a), e, a })
  }
  return keys
}

// The pieces of text before the caret that could be the start of a name: the last one to four words of
// the line, or whatever follows an open "[[".
export function candidates(text, caret) {
  const lineStart = text.lastIndexOf("\n", caret - 1) + 1
  const from = Math.max(lineStart, caret - 80)
  const before = text.slice(from, caret)
  const open = before.lastIndexOf("[[")
  if (open > -1 && open > before.lastIndexOf("]]")) {
    const q = before.slice(open + 2)
    return q.includes("|") || !q.trim() ? [] : [{ start: from + open, q, bracket: true }]
  }
  if (!before || /\s$/.test(before)) return []
  const out = []
  for (let i = before.length - 1; i >= 0 && out.length < 4; i--) {
    if (/\s/.test(before[i])) continue
    if (i > 0 && !/\s/.test(before[i - 1])) continue
    let s = i
    while (s < before.length && /[(\["'„“”«»‚‘’*_>-]/.test(before[s])) s++ // an opening bracket or quote is not part of the name
    if (s < before.length) out.push({ start: from + s, q: before.slice(s) })
  }
  return out.reverse() // longest first: among equally good matches the one that covers more of what was typed wins
}

export function suggest(keys, text, caret) {
  const best = new Map() // page → hit
  candidates(text, caret).forEach((c, order) => {
    const q = plain(c.q).replace(/\s+/g, " ")
    if (!q) return
    for (const k of keys) {
      let rank
      if (k.p === q) rank = 0
      else if (q.length < MIN && !c.bracket) continue
      else if (k.p.startsWith(q)) rank = 2
      else {
        const at = k.p.indexOf(q)
        if (at < 1 || !/[\s(\-'’]/.test(k.p[at - 1])) continue
        rank = 4
      }
      if (k.a) rank++
      const hit = { ...c, order, rank, e: k.e, a: k.a, len: k.p.length }
      const old = best.get(k.e)
      if (!old || hit.rank < old.rank || (hit.rank === old.rank && hit.order < old.order)) best.set(k.e, hit)
    }
  })
  return [...best.values()].sort((a, b) => a.rank - b.rank || a.order - b.order || a.len - b.len || a.e.n.localeCompare(b.e.n)).slice(0, MAX)
}

export function init(ctx) {
  for (const box of document.querySelectorAll(".gd-protocol")) if (!box.querySelector(".gdt-pr")) draw(ctx, box)
}

async function draw(ctx, box) {
  const link = box.querySelector("a.gd-table-data")
  if (!link) return
  if (!namesCache) namesCache = fetch(link.href).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
  let keys = []
  try {
    keys = index((await namesCache).names)
  } catch (err) {
    // the page still works for writing; only the suggestions are missing
    namesCache = null
    console.error("Name list could not be loaded", err)
  }
  if (!box.isConnected || box.querySelector(".gdt-pr")) return
  const coarse = window.matchMedia?.("(pointer: coarse)").matches
  const HINT = !keys.length
    ? "The name list could not be loaded. Writing works; suggestions do not."
    : coarse
      ? "Type a name: suggestions appear here. Tap one to put it in as a link."
      : "Type a name: suggestions appear here · Tab takes the first · ↓ ↑ choose, Enter takes · Esc closes"

  const ui = document.createElement("div")
  ui.className = "gdt gdt-pr"
  ui.innerHTML = `
    <div class="gdt-pr-head">
      <span class="gdt-lbl gdt-pr-date"></span>
      <input type="text" class="gdt-pr-title" aria-label="Session title" placeholder="Session N" autocomplete="off">
    </div>
    <div class="gdt-row gdt-pr-tools">
      <button type="button" data-do="copy">Copy all</button>
      <button type="button" data-do="download">Download .md</button>
      <button type="button" data-do="clear">Clear</button>
      <button type="button" data-do="undo" class="gdt-main" hidden>Undo clear</button>
      <span class="gdt-note gdt-pr-status" aria-live="polite"></span>
    </div>
    <div class="gdt-pr-sug" role="listbox" aria-label="Name suggestions"></div>
    <textarea class="gdt-pr-text" aria-label="Protocol text" spellcheck="false" autocapitalize="sentences" placeholder="Write here."></textarea>`
  const $ = (s) => ui.querySelector(s)
  const area = $("textarea"), title = $(".gdt-pr-title"), sug = $(".gdt-pr-sug"), status = $(".gdt-pr-status")
  let doc = load()
  let hits = [], active = -1, closedFor = null, timer

  const words = () => (area.value.trim() ? area.value.trim().split(/\s+/).length : 0)
  const paint = (note) => {
    $(".gdt-pr-date").textContent = niceDate(doc.d || today())
    $('[data-do="undo"]').hidden = !(doc.prev && !area.value)
    $('[data-do="clear"]').disabled = !area.value && !title.value
    status.textContent = note ?? `${words()} words`
  }
  const flush = (note) => {
    clearTimeout(timer)
    const text = area.value, t = title.value
    if (text === doc.text && t === doc.title) return paint(note)
    doc = { ...doc, text, title: t, d: text || t ? doc.d || today() : "" }
    const ok = save(doc)
    paint(note ?? (ok ? `${words()} words · ${SAVED}` : NOT_SAVED))
  }
  const later = () => {
    clearTimeout(timer)
    timer = setTimeout(flush, 300)
  }
  // what is copied and downloaded: the title as a heading, the date, the text
  const whole = () => [title.value.trim() ? `# ${title.value.trim()}` : "", doc.d || today(), area.value.replace(/\s+$/, "")].filter(Boolean).join("\n\n") + "\n"

  // ---- suggestions
  const drawSug = () => {
    if (!hits.length) {
      sug.innerHTML = `<span class="gdt-note gdt-pr-hint">${esc(HINT)}</span>`
      sug.classList.remove("is-open")
      return
    }
    sug.classList.add("is-open")
    sug.innerHTML = hits
      .map((h, i) => `<button type="button" role="option" data-i="${i}" aria-selected="${i === active}"><span class="gdt-pr-nm">${esc(h.e.n)}</span><span class="gdt-pr-via">${h.a ? `${esc(h.a)} · ` : ""}${esc(h.e.k)}</span></button>`)
      .join("")
    sug.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }
  const look = () => {
    const caret = area.selectionStart
    const key = `${caret}:${area.value.length}`
    hits = area.selectionStart !== area.selectionEnd || closedFor === key ? [] : suggest(keys, area.value, caret)
    if (closedFor !== key) closedFor = null
    active = -1
    drawSug()
  }
  const close = () => {
    closedFor = `${area.selectionStart}:${area.value.length}`
    hits = []
    active = -1
    drawSug()
  }
  const take = (h) => {
    if (!h) return
    const link = h.a ? `[[${h.e.n}|${h.a}]]` : `[[${h.e.n}]]`
    let end = area.selectionStart
    if (h.bracket && area.value.slice(end, end + 2) === "]]") end += 2
    area.focus({ preventScroll: true })
    area.setSelectionRange(h.start, end)
    let done = false
    try {
      done = document.execCommand("insertText", false, link) // keeps the browser's own undo (Ctrl+Z)
    } catch {}
    if (!done || area.value.slice(h.start, h.start + link.length) !== link) area.setRangeText(link, h.start, end, "end")
    close()
    flush()
  }

  area.addEventListener("input", () => {
    closedFor = null
    look()
    later()
  })
  area.addEventListener("keyup", (e) => {
    if (/^(Arrow(Left|Right)|Home|End)$/.test(e.key)) look()
  })
  area.addEventListener("click", look)
  area.addEventListener("keydown", (e) => {
    if (e.isComposing || !hits.length || e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === "Escape") close()
    else if (e.key === "Tab" && !e.shiftKey) take(hits[Math.max(active, 0)])
    else if (e.key === "Enter" && active > -1) take(hits[active])
    else if (e.key === "ArrowDown") {
      active = (active + 1) % hits.length
      drawSug()
    } else if (e.key === "ArrowUp" && active > -1) {
      active--
      drawSug()
    } else return
    e.preventDefault()
  })
  // a tap on a suggestion must not take the caret (and the phone's keyboard) away from the text
  for (const ev of ["pointerdown", "mousedown"]) sug.addEventListener(ev, (e) => e.target.closest("button") && e.preventDefault())
  sug.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-i]")
    if (b) take(hits[+b.dataset.i])
  })
  title.addEventListener("input", later)
  title.addEventListener("blur", () => flush())
  area.addEventListener("blur", () => flush())

  // ---- buttons
  ui.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-do]")
    if (!b) return
    const what = b.dataset.do
    flush()
    if (what === "copy") {
      const text = whole()
      let ok = false
      try {
        await navigator.clipboard.writeText(text)
        ok = true
      } catch {
        // older browsers, or no permission: copy through a hidden text box
        const t = document.createElement("textarea")
        t.value = text
        t.style.cssText = "position:fixed;top:0;left:0;opacity:0"
        document.body.appendChild(t)
        t.select()
        try {
          ok = document.execCommand("copy")
        } catch {}
        t.remove()
      }
      paint(ok ? "Copied" : "Could not copy — select the text and copy it by hand")
    } else if (what === "download") {
      const name = `${today()} ${title.value.trim() || "Protocol"}`.replace(/[\\/:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ").trim()
      const a = document.createElement("a")
      a.href = URL.createObjectURL(new Blob([whole()], { type: "text/markdown;charset=utf-8" }))
      a.download = `${name}.md`
      a.dataset.routerIgnore = "" // or Quartz's page router takes the click and opens the file as a page
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
      paint(`Saved as ${name}.md`)
    } else if (what === "clear") {
      if (!area.value && !title.value) return
      doc = { v: 1, title: "", text: "", d: "", prev: { title: title.value, text: area.value, d: doc.d } }
      area.value = ""
      title.value = ""
      const ok = save(doc)
      hits = []
      drawSug()
      paint(ok ? "Cleared" : NOT_SAVED)
      $('[data-do="undo"]').focus({ preventScroll: true })
    } else if (what === "undo" && doc.prev) {
      doc = { v: 1, title: String(doc.prev.title ?? ""), text: String(doc.prev.text ?? ""), d: doc.prev.d || "", prev: null }
      area.value = doc.text
      title.value = doc.title
      const ok = save(doc)
      paint(ok ? `Back again · ${SAVED}` : NOT_SAVED)
    }
  })

  // ---- phones: while writing, the suggestions and the text fill what the keyboard leaves free
  const vv = window.visualViewport
  const fit = () => {
    if (!ui.isConnected) return vv?.removeEventListener("resize", fit)
    if (!coarse || document.activeElement !== area) {
      area.style.height = ""
      return
    }
    // the site's bar that stays at the top of a phone screen takes its share
    const bar = [...document.querySelectorAll(".sidebar.left, header")].find((el) => /sticky|fixed/.test(getComputedStyle(el).position) && el.getBoundingClientRect().height < 200)
    const top = bar ? bar.getBoundingClientRect().height : 0
    const room = Math.floor((vv ? vv.height : window.innerHeight) - top - sug.offsetHeight - 14)
    area.style.height = `${Math.max(130, room)}px`
    window.scrollTo({ top: sug.getBoundingClientRect().top + window.scrollY - top - 4 })
  }
  area.addEventListener("focus", () => [60, 400].forEach((ms) => setTimeout(fit, ms)))
  area.addEventListener("blur", () => setTimeout(fit, 200))
  vv?.addEventListener("resize", fit)

  // write what is still pending when the tab is hidden or Quartz swaps the page
  const onHide = () => (ui.isConnected ? flush() : document.removeEventListener("visibilitychange", onHide))
  document.addEventListener("visibilitychange", onHide)
  window.addEventListener("pagehide", onHide)
  window.addCleanup?.(() => {
    flush()
    window.removeEventListener("pagehide", onHide)
  })

  area.value = doc.text
  title.value = doc.title
  box.querySelector(".gd-table-fallback")?.remove()
  box.appendChild(ui)
  drawSug()
  paint(doc.text ? `${words()} words · ${SAVED}` : undefined)
}
