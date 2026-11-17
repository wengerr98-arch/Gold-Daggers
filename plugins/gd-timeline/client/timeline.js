// Gold Daggers timeline — client script (vanilla JS, no dependencies).
// Loaded on demand by the plugin's loader (see ../dist/index.js) on pages with a .gd-timeline box.
// init(box) may be called on every Quartz "nav" event; it draws once per box.

const dataCache = new Map() // data url → Promise<model>
const saved = new Map() // data url → view state, so coming back to the page keeps your place

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const plain = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
const num = (n) => (n < 0 ? "−" : "") + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")
const yr = (y) => (y < 0 ? "−" : "") + Math.abs(y) // years are written without digit grouping
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : (many ?? one + "s")}`
const shortSeason = (s) => (s && !/^(unknown|cold|winter-like)/i.test(s) ? s.split(/\s*[(;]/)[0].trim() : null)

export async function init(box) {
  if (box.querySelector(".gdtl")) return
  const link = box.querySelector("a.gd-timeline-data")
  if (!link) return
  const url = link.href
  if (!dataCache.has(url)) {
    dataCache.set(
      url,
      fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json()
        })
        .then((d) => prepare(d, new URL(".", url).href)),
    )
  }
  let model
  try {
    model = await dataCache.get(url)
  } catch (err) {
    dataCache.delete(url)
    console.error("Timeline data could not be loaded", err)
    return
  }
  if (!box.isConnected || box.querySelector(".gdtl")) return
  if (!saved.has(url)) saved.set(url, { mode: "world", level: LEVELS.world.includes(model.zoom) ? model.zoom : "Arcs", person: null, only: true, quotes: true, open: {} })
  new View(box, model, saved.get(url))
}

// ---------------------------------------------------------------- model

function prepare(d, root) {
  const m = { ...d, root }
  const approx = new Set(d.approx ?? [])
  m.yl = (y) => `${approx.has(y) ? "≈ " : ""}${yr(y)}`
  m.pb = (y) => `${m.yl(y)} p.B.`
  m.eph = (y) => `${approx.has(y) ? "≈ " : ""}${yr(y + d.offset)}`
  m.href = (h) => root + h.split("/").map(encodeURIComponent).join("/")
  m.sByN = new Map(d.sessions.map((s) => [s.n, s]))
  m.arcByN = new Map(d.arcs.map((a) => [a.n, a]))
  d.events.forEach((e, i) => (e.i = i))
  d.people.forEach((p, i) => (p.id = i))
  m.jumpOut = new Map(d.jumps.map((j) => [j.a, j]))
  m.jumpIn = new Map(d.jumps.map((j) => [j.b, j]))
  m.byPerson = d.people.map(() => [])
  d.events.forEach((e) => [...(e.n ?? []), ...(e.c ?? [])].forEach((id) => m.byPerson[id].push(e.i)))
  const home = d.events.filter((e) => !e.tt).map((e) => e.y)
  m.campaignStart = Math.min(...home)
  m.world = worldTree(m)
  m.play = playTree(m)
  return m
}

const ERAS = [
  { k: "deep", name: "The deep past", test: (y) => y < -1000 },
  { k: "before", name: "Before the Forgotten War", test: (y) => y < 0 },
  { k: "after", name: "After the Forgotten War", test: (y, m) => y < m.campaignStart },
  { k: "campaign", name: "The campaign", test: () => true },
]

// days inside one session (or the part of it that lies in one year)
function dayBlocks(m, evIdx) {
  const days = []
  for (const i of evIdx) {
    const e = m.events[i]
    const last = days[days.length - 1]
    if (last && last.d === e.d) last.ev.push(i)
    else days.push({ d: e.d, ev: [i] })
  }
  return days
}

function worldTree(m) {
  const years = new Map() // y → { lore: [], parts: Map(session → [event idx]) }
  const at = (y) => {
    if (!years.has(y)) years.set(y, { lore: [], parts: new Map() })
    return years.get(y)
  }
  m.events.forEach((e) => {
    const p = at(e.y).parts
    if (!p.has(e.s)) p.set(e.s, [])
    p.get(e.s).push(e.i)
  })
  const undated = [], written = []
  m.lore.forEach((l, i) => {
    if (l.y != null && !(l.cal && l.cal !== "Ephraim's count")) at(l.y).lore.push(i)
    else if (l.cal && l.y == null) written.push(i)
    else undated.push(i)
  })
  const ys = [...years.keys()].sort((a, b) => a - b)
  const eras = []
  let prevY = null
  for (const y of ys) {
    const def = ERAS.find((e) => e.test(y, m))
    let era = eras[eras.length - 1]
    if (!era || era.def !== def) {
      era = { kind: "era", k: def.k, depth: 0, def, name: def.name, kids: [], ev: [], lore: [], gapBefore: prevY == null ? 0 : y - prevY - 1, sessions: new Set() }
      eras.push(era)
    }
    const yd = years.get(y)
    const year = { kind: "year", k: `${era.k}/y${y}`, depth: 1, y, kids: [], ev: [], lore: yd.lore, gapBefore: era.kids.length && prevY != null ? y - prevY - 1 : 0, sessions: new Set() }
    if (yd.lore.length) year.kids.push({ kind: "loregroup", k: `${year.k}/lore`, depth: 2, y, lore: yd.lore, ev: [], kids: [] })
    let group = null
    for (const [sn, evs] of [...yd.parts].sort((a, b) => a[1][0] - b[1][0])) {
      const s = m.sByN.get(sn)
      if (!group || group.arc !== s.arc) {
        group = { kind: "arc", k: `${year.k}/a${s.arc}-${sn}`, depth: 2, arc: s.arc, y, kids: [], ev: [], sessions: new Set() }
        year.kids.push(group)
      }
      const part = { kind: "session", k: `${group.k}/s${sn}`, depth: 3, s: sn, y, ev: evs, partial: evs.length !== s.ev.length }
      group.kids.push(part)
      group.ev.push(...evs)
      group.sessions.add(sn)
      year.ev.push(...evs)
      year.sessions.add(sn)
      era.sessions.add(sn)
    }
    era.kids.push(year)
    era.ev.push(...year.ev)
    era.lore.push(...yd.lore)
    prevY = y
  }
  return { kids: eras, undated, written, years: ys, yearNodes: eras.flatMap((e) => e.kids) }
}

function playTree(m) {
  const arcs = m.arcs.map((a) => ({ kind: "arc", k: `p/a${a.n}`, depth: 0, arc: a.n, kids: [], ev: [], sessions: new Set(), play: true }))
  for (const s of m.sessions) {
    const arc = arcs.find((a) => a.arc === s.arc) ?? arcs[arcs.length - 1]
    arc.kids.push({ kind: "session", k: `${arc.k}/s${s.n}`, depth: 1, s: s.n, y: s.y, ev: s.ev ?? [], lore: s.lore ?? [], play: true })
    arc.ev.push(...(s.ev ?? []))
    arc.sessions.add(s.n)
  }
  return { kids: arcs.filter((a) => a.kids.length) }
}

// ---------------------------------------------------------------- view

const LEVELS = { world: ["Eras", "Years", "Arcs", "Sessions", "Days"], play: ["Arcs", "Sessions", "Days"] }

class View {
  constructor(box, model, state) {
    this.m = model
    this.st = state
    this.box = box
    this.full = false
    this.native = false
    box.querySelector(".gd-timeline-fallback")?.remove()
    this.el = document.createElement("div")
    this.el.className = "gdtl"
    box.appendChild(this.el)
    this.el.innerHTML = this.shell()
    this.$ = (sel) => this.el.querySelector(sel)
    this.bind()
    this.renderAll()
  }

  get levels() {
    return LEVELS[this.st.mode]
  }
  get zoom() {
    const i = this.levels.indexOf(this.st.level)
    return i < 0 ? 1 : i
  }
  get hits() {
    return this.st.person == null ? null : (this._hits ??= new Set(this.m.byPerson[this.st.person]))
  }

  shell() {
    const m = this.m
    return `
      ${m.draft ? `<p class="gdtl-draft" role="note">${esc(m.draft)}</p>` : ""}
      <div class="gdtl-bar">
        <div class="gdtl-ctl">
          <span class="gdtl-lbl" id="gdtl-order">Order</span>
          <div class="gdtl-seg" role="group" aria-labelledby="gdtl-order">
            <button type="button" data-act="mode" data-v="world" title="Events where they happen in the world's time">World time</button>
            <button type="button" data-act="mode" data-v="play" title="Events in the order they were played, session by session">Play order</button>
          </div>
        </div>
        <div class="gdtl-ctl">
          <span class="gdtl-lbl" id="gdtl-zoom">Zoom</span>
          <div class="gdtl-seg gdtl-zoom" role="group" aria-labelledby="gdtl-zoom"></div>
        </div>
        <label class="gdtl-check"><input type="checkbox" data-act="quotes"> Protocol quotes</label>
        <button type="button" class="gdtl-fsbtn" data-act="full" aria-pressed="false" title="Show the timeline on the whole screen (Esc to leave)"><span class="gdtl-fsicon" aria-hidden="true">⤢</span> <span class="gdtl-fslbl">Full screen</span></button>
      </div>
      <div class="gdtl-people">
        <div class="gdtl-find">
          <label class="gdtl-lbl" for="gdtl-q">Follow someone</label>
          <input id="gdtl-q" type="search" placeholder="Search a name…" autocomplete="off" spellcheck="false">
        </div>
        <div class="gdtl-chips" aria-live="polite"></div>
        <div class="gdtl-person" hidden></div>
      </div>
      <div class="gdtl-over" data-drop>
        <div class="gdtl-over-scroll"></div>
        <p class="gdtl-key"></p>
      </div>
      <div class="gdtl-stream" data-drop></div>`
  }

  bind() {
    this.el.addEventListener("click", (ev) => {
      const t = ev.target.closest("[data-act]")
      if (!t || !this.el.contains(t)) return
      const act = t.dataset.act
      if (act === "quotes") return // handled on change
      if (act === "only") return
      ev.preventDefault()
      if (act === "mode") this.setMode(t.dataset.v)
      else if (act === "level") this.setLevel(t.dataset.v)
      else if (act === "in") this.setLevel(this.levels[Math.min(this.levels.length - 1, this.zoom + 1)])
      else if (act === "out") this.setLevel(this.levels[Math.max(0, this.zoom - 1)])
      else if (act === "toggle") this.toggle(t.dataset.k)
      else if (act === "person") this.setPerson(Number(t.dataset.p))
      else if (act === "clear") this.setPerson(null)
      else if (act === "goto") this.gotoEvent(Number(t.dataset.e))
      else if (act === "cell") this.gotoCell(t.dataset)
      else if (act === "more") t.closest(".gdtl-who")?.classList.add("is-all")
      else if (act === "full") this.setFull(!this.full)
    })
    // full screen: the browser's own mode where it exists, otherwise (iPhone) the box covers the page
    const onFsChange = () => {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement
      if (this.full && this.native && fsEl !== this.el) this.setFull(false)
    }
    const onKey = (ev) => { if (ev.key === "Escape" && this.full && !this.native) this.setFull(false) }
    document.addEventListener("fullscreenchange", onFsChange)
    document.addEventListener("webkitfullscreenchange", onFsChange)
    document.addEventListener("keydown", onKey)
    const cleanup = () => {
      if (this.full) this.setFull(false)
      document.removeEventListener("fullscreenchange", onFsChange)
      document.removeEventListener("webkitfullscreenchange", onFsChange)
      document.removeEventListener("keydown", onKey)
    }
    if (typeof window.addCleanup === "function") window.addCleanup(cleanup)
    this.el.addEventListener("change", (ev) => {
      const t = ev.target
      if (t.dataset?.act === "quotes") {
        this.st.quotes = t.checked
        this.el.classList.toggle("gdtl-noquotes", !t.checked)
      } else if (t.dataset?.act === "only") {
        this.st.only = t.checked
        this.renderStream(true)
      }
    })
    this.$("#gdtl-q").addEventListener("input", () => this.renderChips())
    // a portrait that does not load becomes the initial-letter placeholder (error events do not bubble: capture)
    this.el.addEventListener("error", (ev) => { const t = ev.target; if (t.tagName === "IMG" && t.dataset.ph) t.outerHTML = t.dataset.ph }, true)
    // drag a name onto the timeline
    this.el.addEventListener("dragstart", (ev) => {
      const t = ev.target.closest?.("[data-p]")
      if (!t) return
      ev.dataTransfer.setData("text/plain", "gdtl-person:" + t.dataset.p)
      ev.dataTransfer.effectAllowed = "copy"
      this.el.classList.add("gdtl-dragging")
    })
    this.el.addEventListener("dragend", () => this.el.classList.remove("gdtl-dragging"))
    this.el.addEventListener("dragover", (ev) => {
      if (this.el.classList.contains("gdtl-dragging") && ev.target.closest?.("[data-drop]")) {
        ev.preventDefault()
        ev.dataTransfer.dropEffect = "copy"
      }
    })
    this.el.addEventListener("drop", (ev) => {
      const txt = ev.dataTransfer.getData("text/plain") || ""
      if (!txt.startsWith("gdtl-person:") || !ev.target.closest?.("[data-drop]")) return
      ev.preventDefault()
      this.el.classList.remove("gdtl-dragging")
      this.setPerson(Number(txt.slice(12)))
    })
  }

  // ---- state changes

  setMode(mode) {
    if (mode === this.st.mode) return
    const was = this.st.level
    this.st.mode = mode
    this.st.open = {}
    if (!this.levels.includes(was)) this.st.level = was === "Eras" || was === "Years" ? "Arcs" : was
    this.renderAll()
  }
  setLevel(level) {
    if (!this.levels.includes(level)) return
    this.st.level = level
    this.st.open = {}
    this.renderBar()
    this.renderStream(true)
  }
  toggle(k) {
    const node = this.nodes.get(k)
    if (!node) return
    this.st.open[k] = !this.isOpen(node)
    this.renderStream(true, k)
  }
  setPerson(id) {
    this.st.person = id == null || Number.isNaN(id) ? null : id
    this._hits = null
    this.$("#gdtl-q").value = ""
    this.renderChips()
    this.renderPerson()
    this.renderOverview()
    this.renderStream(false)
  }
  isOpen(node) {
    if (this.filtering) return true
    const o = this.st.open[node.k]
    if (o != null) return o
    if (node.kind === "undated") return false
    return node.depth < this.zoom
  }
  get filtering() {
    return this.st.person != null && this.st.only
  }
  openPath(k) {
    const parts = k.split("/")
    for (let i = 1; i <= parts.length; i++) this.st.open[parts.slice(0, i).join("/")] = true
  }
  gotoEvent(i) {
    const e = this.m.events[i]
    const key = this.sessionKey(e.s, e.y)
    if (key) this.openPath(key)
    this.renderStream(false)
    this.flash(this.el.querySelector(`[data-e="${i}"]`))
  }
  gotoCell(ds) {
    let key = null
    if (ds.s) key = this.sessionKey(Number(ds.s), ds.y === undefined ? null : Number(ds.y))
    else if (ds.y) key = this.m.world.yearNodes.find((n) => n.y === Number(ds.y))?.k
    if (!key) return
    const node = this.nodes.get(key)
    if (ds.s) this.openPath(key)
    else {
      this.openPath(key.split("/").slice(0, -1).join("/"))
      this.st.open[key] = true
      const lg = node?.kids?.find((c) => c.kind === "loregroup")
      if (lg && !node.ev.length) this.st.open[lg.k] = true
    }
    this.renderStream(false)
    this.flash(this.el.querySelector(`[data-k="${CSS.escape(key)}"]`))
  }
  sessionKey(sn, y) {
    for (const [k, n] of this.nodes) if (n.kind === "session" && n.s === sn && (this.st.mode === "play" || y == null || n.y === y)) return k
    return null
  }
  flash(el) {
    if (!el) return
    el.scrollIntoView({ block: el.offsetHeight > (this.full ? this.el.clientHeight : window.innerHeight) * 0.8 ? "start" : "center", behavior: "instant" })
    el.classList.add("gdtl-flash")
    setTimeout(() => el.classList.remove("gdtl-flash"), 1600)
  }

  // ---- rendering

  get scroller() {
    return this.full ? this.el : window
  }
  async setFull(on) {
    if (on === this.full) return
    const el = this.el
    if (on) {
      this.full = true
      this.native = false
      const req = el.requestFullscreen || el.webkitRequestFullscreen
      if (req) {
        try {
          await req.call(el)
          this.native = true
        } catch (err) {
          this.native = false
        }
      }
      if (!this.native) document.documentElement.classList.add("gdtl-lock")
      el.classList.add("is-full")
      el.classList.toggle("is-pseudo", !this.native)
    } else {
      const wasNative = this.native
      this.full = false
      this.native = false
      el.classList.remove("is-full", "is-pseudo")
      document.documentElement.classList.remove("gdtl-lock")
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement
      if (wasNative && fsEl === el) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen
        try { await exit?.call(document) } catch (err) { /* already left */ }
      }
    }
    const btn = this.$('[data-act="full"]')
    if (btn) {
      btn.setAttribute("aria-pressed", String(this.full))
      btn.title = this.full ? "Leave full screen (Esc)" : "Show the timeline on the whole screen (Esc to leave)"
      btn.querySelector(".gdtl-fslbl").textContent = this.full ? "Exit full screen" : "Full screen"
      btn.querySelector(".gdtl-fsicon").textContent = this.full ? "⤡" : "⤢"
    }
  }

  renderAll() {
    this.nodes = new Map()
    const walk = (n) => {
      this.nodes.set(n.k, n)
      n.kids?.forEach(walk)
    }
    this.m[this.st.mode].kids.forEach(walk)
    if (this.st.mode === "world") this.nodes.set("undated", { kind: "undated", k: "undated", depth: 0 })
    this.el.classList.toggle("gdtl-noquotes", !this.st.quotes)
    this.$('[data-act="quotes"]').checked = this.st.quotes
    this.renderBar()
    this.renderChips()
    this.renderPerson()
    this.renderOverview()
    this.renderStream(false)
  }

  renderBar() {
    this.el.querySelectorAll('[data-act="mode"]').forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === this.st.mode)))
    const z = this.zoom
    this.$(".gdtl-zoom").innerHTML =
      `<button type="button" data-act="out" class="gdtl-step" aria-label="Zoom out" ${z === 0 ? "disabled" : ""}>−</button>` +
      this.levels.map((l, i) => `<button type="button" data-act="level" data-v="${l}" aria-pressed="${i === z}">${l}</button>`).join("") +
      `<button type="button" data-act="in" class="gdtl-step" aria-label="Zoom in" ${z === this.levels.length - 1 ? "disabled" : ""}>+</button>`
  }

  // portrait, or a quiet initial where there is none
  avatar(p, cls = "") {
    const ph = `<span class="gdtl-av is-ph ${cls}" aria-hidden="true">${esc((p.name.match(/[\p{L}\p{N}]/u) ?? ["?"])[0].toUpperCase())}</span>`
    return p.img ? `<img class="gdtl-av ${cls}" src="${this.m.href(p.img)}" alt="" loading="lazy" decoding="async" data-ph="${esc(ph)}">` : ph
  }
  chip(p, extra = "") {
    return `<button type="button" class="gdtl-chip${this.st.person === p.id ? " is-on" : ""}" draggable="true" data-act="person" data-p="${p.id}" title="Show where ${esc(p.name)} appears (or drag onto the timeline)">${this.avatar(p)}${esc(p.name)}<span class="gdtl-n">${p.c}</span>${extra}</button>`
  }
  renderChips() {
    const q = plain(this.$("#gdtl-q").value.trim())
    const people = this.m.people
    let html
    if (q) {
      const found = people.filter((p) => plain(p.name).includes(q)).sort((a, b) => b.c - a.c).slice(0, 14)
      html = found.length ? found.map((p) => this.chip(p)).join("") : `<span class="gdtl-none">Nobody by that name in the timeline.</span>`
    } else {
      const top = people.filter((p) => p.kind !== "pc").sort((a, b) => b.c - a.c).slice(0, 10)
      const party = people.filter((p) => p.kind === "pc").sort((a, b) => b.c - a.c)
      html = `<span class="gdtl-chiplbl">Often seen</span>${top.map((p) => this.chip(p)).join("")}<span class="gdtl-chiplbl">The party</span>${party.map((p) => this.chip(p)).join("")}`
    }
    this.$(".gdtl-chips").innerHTML = html
  }

  renderPerson() {
    const box = this.$(".gdtl-person")
    const id = this.st.person
    if (id == null) {
      box.hidden = true
      box.innerHTML = ""
      return
    }
    const m = this.m
    const p = m.people[id]
    const evs = m.byPerson[id].map((i) => m.events[i])
    const first = evs[0], last = evs[evs.length - 1]
    const byWorld = [...evs].sort((a, b) => a.y - b.y || a.i - b.i)
    const kind = { pc: "player character", npc: "NPC", companion: "companion", unlisted: "no wiki page yet" }[p.kind] ?? p.kind
    const sLink = (n) => {
      const s = m.sByN.get(n)
      return s?.href ? `<a class="internal" href="${m.href(s.href)}">S${n}</a>` : `S${n}`
    }
    const ages = (p.ages ?? []).map((a) => `<li><span class="gdtl-mono">${sLink(a.s)}${a.y != null ? ` · ${m.pb(a.y)}` : ""}</span> ${esc(a.t ?? (a.age != null ? `age ${a.age}` : ""))}${a.claimed ? " <em>(by their own word)</em>" : ""}</li>`).join("")
    const names = (p.names ?? []).map((a) => `<li><span class="gdtl-mono">${sLink(a.s)}</span> first known as “${esc(a.t)}”</li>`).join("")
    box.hidden = false
    box.innerHTML = `
      ${this.avatar(p, "is-big")}
      <div class="gdtl-person-main">
      <div class="gdtl-person-h">
        <h3>${p.href ? `<a class="internal" href="${m.href(p.href)}">${esc(p.name)}</a>` : esc(p.name)}</h3>
        <span class="gdtl-kind">${esc(kind)}</span>
        <button type="button" class="gdtl-x" data-act="clear" aria-label="Stop following ${esc(p.name)}">clear ×</button>
      </div>
      <p class="gdtl-person-sum">Seen in ${plural(evs.length, "event")}, ${first.s === last.s ? `session ${first.s}` : `sessions ${first.s}–${last.s}`}${
        byWorld[0].y !== byWorld[byWorld.length - 1].y ? ` · in the world's time from ${m.pb(byWorld[0].y)} to ${m.pb(byWorld[byWorld.length - 1].y)}` : ` · ${m.pb(first.y)}`
      }</p>
      ${ages ? `<p class="gdtl-sub">Age, as far as the party knows</p><ul class="gdtl-facts">${ages}</ul>` : ""}
      ${names ? `<p class="gdtl-sub">Name</p><ul class="gdtl-facts">${names}</ul>` : ""}
      <label class="gdtl-check"><input type="checkbox" data-act="only" ${this.st.only ? "checked" : ""}> Show only their events</label>
      </div>`
  }

  // the strip at the top: every year that has content, breaks where nothing is known
  renderOverview() {
    const m = this.m, hits = this.hits
    const cells = [] // {x,w,cls,attrs,title}
    const labels = [] // {x, top, sub, strong}
    const marks = [] // breaks
    const bands = [] // arcs
    const pos = new Map() // event idx → x centre
    const CW = 5, GAP = 1, H = 20, TOP = 46
    let x = 8
    const sessionCell = (sn, evs, y, extraCls = "") => {
      const s = m.sByN.get(sn)
      const n = hits ? evs.filter((i) => hits.has(i)).length : 0
      const tt = evs.some((i) => m.events[i].tt)
      cells.push({ x, w: CW, cls: `c-s${tt ? " c-tt" : ""}${n ? " c-hit" : ""}${extraCls}`, attrs: `data-act="cell" data-s="${sn}" data-y="${y}"`, title: `Session ${sn}${s.title ? " – " + s.title : ""} · ${m.pb(y)}${s.place?.t ? " · " + s.place.t : ""}${n ? ` · ${plural(n, "event")} with ${m.people[this.st.person].name}` : ""}` })
      evs.forEach((i) => pos.set(i, x + CW / 2))
      const band = bands[bands.length - 1]
      if (band && band.arc === s.arc && band.x2 + GAP + 0.5 >= x) band.x2 = x + CW
      else bands.push({ arc: s.arc, x1: x, x2: x + CW })
      x += CW + GAP
    }
    if (this.st.mode === "world") {
      let lastLabel = -99
      for (const era of m.world.kids) {
        for (const yn of era.kids) {
          const gap = yn.gapBefore || (yn === era.kids[0] ? era.gapBefore : 0)
          if (gap > 0) {
            marks.push({ x: x + 4, title: `${plural(gap, "year")} without entries` })
            x += 12
          }
          const x0 = x
          const lg = yn.kids.find((c) => c.kind === "loregroup")
          if (lg) {
            cells.push({ x, w: 7, cls: "c-lore", attrs: `data-act="cell" data-y="${yn.y}"`, title: `${m.pb(yn.y)} · ${plural(lg.lore.length, "thing")} the party was told` })
            x += 7 + GAP
          }
          for (const g of yn.kids) if (g.kind === "arc") for (const part of g.kids) sessionCell(part.s, part.ev, yn.y)
          const strong = yn.ev.length > 0
          // a year with sessions always gets its label; a told-only year just before it gives way
          if (strong && labels.length && !labels[labels.length - 1].strong && x0 - labels[labels.length - 1].x < 30) labels.pop()
          if (strong || x0 - lastLabel > 34) {
            labels.push({ x: x0, top: m.yl(yn.y), sub: m.eph(yn.y), strong })
            lastLabel = x0 + (strong ? 6 : 0)
          }
          x += 4
        }
      }
    } else {
      let lastY = null
      for (const s of m.sessions) {
        const x0 = x
        sessionCell(s.n, s.ev ?? [], s.y)
        if (s.y !== lastY) labels.push({ x: x0, top: `S${s.n}`, sub: m.yl(s.y), strong: true })
        lastY = s.y
      }
    }
    const W = Math.ceil(x + 8)
    const arcsSvg = m.jumps
      .map((j) => {
        const a = pos.get(j.a), b = pos.get(j.b)
        if (a == null || b == null) return ""
        if (Math.abs(a - b) < 9) return `<path class="o-jump" d="M${a} ${TOP - 2} v-7" marker-end="url(#gdtl-arrow)"><title>Time jump: ${m.pb(j.from)} → ${m.pb(j.to)}</title></path>`
        const lift = Math.min(15, 6 + Math.abs(a - b) / 30)
        return `<path class="o-jump" d="M${a} ${TOP - 2} Q${(a + b) / 2} ${TOP - 2 - lift * 2} ${b} ${TOP - 3}" marker-end="url(#gdtl-arrow)"><title>Time jump: ${m.pb(j.from)} → ${m.pb(j.to)}</title></path>`
      })
      .join("")
    const svg = `<svg class="gdtl-svg" width="${W}" height="92" viewBox="0 0 ${W} 92" role="img" aria-label="Overview of the timeline: years with content, time jumps and campaign arcs">
      <defs><marker id="gdtl-arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L8 4 L0 8 z" class="o-arrow"/></marker></defs>
      <line class="o-axis" x1="0" x2="${W}" y1="${TOP + H + 0.5}" y2="${TOP + H + 0.5}"/>
      ${labels.map((l) => `<text class="o-year${l.strong ? " is-strong" : ""}" x="${l.x}" y="11">${esc(l.top)}</text><text class="o-eph" x="${l.x}" y="22">${esc(l.sub)}</text>`).join("")}
      ${marks.map((k) => `<g class="o-break"><path d="M${k.x - 2} ${TOP + H + 4} l3 -${H + 8} M${k.x + 2} ${TOP + H + 4} l3 -${H + 8}"/><title>${esc(k.title)}</title></g>`).join("")}
      ${cells.map((c) => `<rect class="${c.cls}" x="${c.x}" y="${TOP}" width="${c.w}" height="${H}" ${c.attrs}><title>${esc(c.title)}</title></rect>`).join("")}
      ${bands.map((b, i) => `<rect class="o-band${b.arc % 2 ? "" : " is-alt"}" x="${b.x1}" y="${TOP + H + 4}" width="${b.x2 - b.x1}" height="3"/>${b.x2 - b.x1 > 14 ? `<text class="o-arc" x="${b.x1}" y="${TOP + H + 18}">${b.arc}</text>` : ""}`).join("")}
      ${arcsSvg}
    </svg>`
    const sc = this.$(".gdtl-over-scroll")
    sc.innerHTML = svg
    sc.scrollLeft = this.st.mode === "world" ? sc.scrollWidth : 0
    const p = this.st.person != null ? m.people[this.st.person] : null
    this.$(".gdtl-key").innerHTML =
      (this.st.mode === "world"
        ? `Top line: year p.B. · below: the same year in Ephraim's count (p.B. + ${num(m.offset)}). `
        : `Sessions in the order they were played; the year under each label is where that stretch takes place. `) +
      `<span class="k-box k-s"></span> session <span class="k-box k-tt"></span> in another time ${this.st.mode === "world" ? `<span class="k-box k-lore"></span> told to the party <span class="k-break">⫽</span> years without entries ` : ""}` +
      `<span class="k-jump">⤻</span> time jump · numbers below: campaign arcs` +
      (p ? ` · <span class="k-box k-hit"></span> ${esc(p.name)}` : "") +
      ` <span class="gdtl-swipe">· swipe sideways for more</span>`
  }

  renderStream(keepPlace, anchorKey) {
    const stream = this.$(".gdtl-stream")
    let anchor = null
    if (keepPlace) {
      const el = anchorKey ? stream.querySelector(`[data-k="${CSS.escape(anchorKey)}"]`) : [...stream.querySelectorAll("[data-k]")].find((n) => n.getBoundingClientRect().bottom > 0)
      if (el) anchor = { k: el.dataset.k, top: el.getBoundingClientRect().top }
    }
    const m = this.m
    const parts = []
    if (this.filtering && !this.m.byPerson[this.st.person].length) parts.push(`<p class="gdtl-none">No events.</p>`)
    if (this.st.mode === "world") {
      for (const era of m.world.kids) {
        if (!this.visible(era)) continue
        if (era.gapBefore > 0 && !this.filtering) parts.push(this.gap(era.gapBefore))
        parts.push(this.era(era))
      }
      if (!this.filtering) parts.push(this.undated())
    } else {
      for (const arc of m.play.kids) if (this.visible(arc)) parts.push(this.arc(arc))
    }
    stream.innerHTML = parts.join("")
    if (anchor) {
      let k = anchor.k, el = null
      while (k && !(el = stream.querySelector(`[data-k="${CSS.escape(k)}"]`))) k = k.includes("/") ? k.slice(0, k.lastIndexOf("/")) : ""
      if (el) this.scroller.scrollBy({ top: el.getBoundingClientRect().top - anchor.top, behavior: "instant" })
    }
  }

  visible(node) {
    if (!this.filtering) return true
    const h = this.hits
    return node.ev.some((i) => h.has(i))
  }
  hitCount(node) {
    const h = this.hits
    if (!h || this.filtering) return ""
    const n = node.ev.reduce((a, i) => a + (h.has(i) ? 1 : 0), 0)
    return n ? `<span class="gdtl-hits" title="${plural(n, "event")} with ${esc(this.m.people[this.st.person].name)}">${n}</span>` : ""
  }
  head(node, cls, inner) {
    const open = this.isOpen(node)
    return `<button type="button" class="gdtl-h ${cls}" data-act="toggle" data-k="${esc(node.k)}" aria-expanded="${open}">${inner}<span class="gdtl-tw" aria-hidden="true">${open ? "−" : "+"}</span></button>`
  }
  gap(years) {
    return `<div class="gdtl-gap" role="separator"><span>${plural(years, "year")} without entries</span></div>`
  }
  sRange(set) {
    const a = [...set].sort((x, y) => x - y)
    if (!a.length) return ""
    return a.length === 1 ? `S${a[0]}` : `S${a[0]}–S${a[a.length - 1]}`
  }
  counts(node) {
    const bits = []
    if (node.sessions?.size) bits.push(`${this.sRange(node.sessions)}`)
    if (node.ev.length) bits.push(plural(node.ev.length, "event"))
    if (node.lore?.length) bits.push(`${plural(node.lore.length, "thing")} told`)
    return bits.join(" · ")
  }

  era(era) {
    const m = this.m
    const ys = era.kids.map((y) => y.y)
    const span = ys.length === 1 ? m.pb(ys[0]) : `${m.yl(ys[0])} – ${m.pb(ys[ys.length - 1])}`
    const eph = ys.length === 1 ? m.eph(ys[0]) : `${m.eph(ys[0])} – ${m.eph(ys[ys.length - 1])}`
    const open = this.isOpen(era)
    const arcNames = [...new Set([...era.sessions].map((n) => m.sByN.get(n).arc))].map((a) => m.arcByN.get(a)?.name).filter(Boolean)
    let html = `<section class="gdtl-era" data-k="${era.k}">` + this.head(era, "gdtl-h-era", `<span class="gdtl-era-name">${esc(era.name)}</span><span class="gdtl-era-span">${span} <span class="gdtl-eph">${eph} in Ephraim's count</span></span>${this.hitCount(era)}`)
    if (!open) html += `<p class="gdtl-sum">${this.counts(era)}${arcNames.length ? ` · ${arcNames.map(esc).join(", ")}` : ""}</p>`
    else {
      html += `<div class="gdtl-kids">`
      for (const y of era.kids) {
        if (!this.visible(y)) continue
        if (y.gapBefore > 0 && !this.filtering) html += this.gap(y.gapBefore)
        html += this.year(y)
      }
      html += `</div>`
    }
    return html + `</section>`
  }

  year(y) {
    const m = this.m
    const open = this.isOpen(y)
    let html = `<section class="gdtl-year${y.ev.length ? "" : " is-told"}" data-k="${y.k}">` + this.head(y, "gdtl-h-year", `<span class="gdtl-y">${m.pb(y.y)}</span><span class="gdtl-eph">${m.eph(y.y)} in Ephraim's count</span>${this.hitCount(y)}`)
    if (!open) {
      const arcs = y.kids.filter((g) => g.kind === "arc")
      const seasons = [...new Set([...y.sessions].map((n) => shortSeason(m.sByN.get(n).season)).filter(Boolean))]
      html += `<p class="gdtl-sum">${this.counts(y)}</p>`
      if (arcs.length) html += `<ul class="gdtl-sumlist">${arcs.map((g) => `<li><span class="gdtl-mono">${this.sRange(g.sessions)}</span> ${esc(m.arcByN.get(g.arc)?.name ?? "")}${g.kids.some((p) => p.ev.some((i) => m.events[i].tt)) ? ` <span class="gdtl-tag is-tt">time travel</span>` : ""}</li>`).join("")}</ul>`
      if (seasons.length > 1 && y.y >= m.campaignStart) html += `<p class="gdtl-sum gdtl-seasons">${seasons.slice(0, 8).map(esc).join(" → ")}</p>`
      if (!y.ev.length) html += `<ul class="gdtl-sumlist">${y.lore.slice(0, 3).map((i) => `<li>${esc(m.lore[i].w)}</li>`).join("")}</ul>`
    } else {
      html += `<div class="gdtl-kids">`
      for (const g of y.kids) {
        if (g.kind === "loregroup") {
          if (!this.filtering) html += this.loreGroup(g)
        } else if (this.visible(g)) html += this.arc(g)
      }
      html += `</div>`
    }
    return html + `</section>`
  }

  loreGroup(g) {
    const open = this.isOpen(g)
    let html = `<section class="gdtl-group gdtl-loregroup" data-k="${g.k}">` + this.head(g, "gdtl-h-group", `<span class="gdtl-gname">Told to the party</span><span class="gdtl-gmeta">${plural(g.lore.length, "entry", "entries")}</span>`)
    if (open) html += `<div class="gdtl-kids">${g.lore.map((i) => this.loreItem(i, true)).join("")}</div>`
    else html += `<ul class="gdtl-sumlist">${g.lore.slice(0, 4).map((i) => `<li>${esc(this.m.lore[i].w)}</li>`).join("")}${g.lore.length > 4 ? `<li>…</li>` : ""}</ul>`
    return html + `</section>`
  }

  arc(g) {
    const m = this.m
    const a = m.arcByN.get(g.arc)
    const open = this.isOpen(g)
    const tt = g.ev.some((i) => m.events[i].tt)
    let html = `<section class="gdtl-group" data-k="${g.k}">` + this.head(g, "gdtl-h-group", `<span class="gdtl-gname"><span class="gdtl-arcno">Arc ${g.arc}</span> ${esc(a?.name ?? "")}</span><span class="gdtl-gmeta">${this.sRange(g.sessions)}${tt && !g.play ? ` <span class="gdtl-tag is-tt">time travel</span>` : ""}</span>${this.hitCount(g)}`)
    if (!open) {
      const places = [...new Set(g.kids.map((p) => m.sByN.get(p.s).place?.l?.[0]?.[0] ?? m.sByN.get(p.s).place?.t?.split(/\s*[,;(/]|\s+->\s+|\s+-\s+/)[0]).filter(Boolean))]
      const ys = [...new Set(g.kids.map((p) => p.y))]
      html += `<p class="gdtl-sum">${plural(g.kids.length, "session")} · ${plural(g.ev.length, "event")}${g.play && ys.length ? ` · ${ys.map((y) => m.pb(y)).join(", ")}` : ""}${places.length ? ` · ${places.slice(0, 6).map(esc).join(", ")}${places.length > 6 ? " …" : ""}` : ""}</p>`
    } else {
      html += `<div class="gdtl-kids">`
      let lastY = null
      for (const part of g.kids) {
        if (!this.visible(part)) continue
        if (g.play && part.y !== lastY && !this.filtering) html += `<div class="gdtl-yearmark"><span>${m.pb(part.y)}</span> <span class="gdtl-eph">${m.eph(part.y)} in Ephraim's count</span></div>`
        lastY = part.y
        html += this.session(part)
      }
      html += `</div>`
    }
    return html + `</section>`
  }

  session(part) {
    const m = this.m
    const s = m.sByN.get(part.s)
    const open = this.isOpen(part)
    const evs = this.filtering ? part.ev.filter((i) => this.hits.has(i)) : part.ev
    const jumpsOut = part.ev.map((i) => m.jumpOut.get(i)).filter(Boolean)
    const tt = part.ev.some((i) => m.events[i].tt)
    const date = [part.play ? m.pb(s.y) : null, shortSeason(s.season), !part.partial || part.play ? s.hint : null].filter(Boolean)
    let html = `<section class="gdtl-session${tt && !part.play ? " is-tt" : ""}" data-k="${part.k}">`
    html += this.head(part, "gdtl-h-session", `<span class="gdtl-sno">S${s.n}</span><span class="gdtl-stitle">${esc(s.title ?? `Session ${s.n}`)}${part.partial && !part.play ? ` <span class="gdtl-tag">${tt ? "the part in " + m.pb(part.y) : "part"}</span>` : ""}</span>${this.hitCount(part)}`)
    html += `<div class="gdtl-sbody">`
    if (date.length) html += `<p class="gdtl-meta gdtl-date">${date.map(esc).join(" · ")}</p>`
    if (s.place) html += `<p class="gdtl-meta">${this.placeHtml(s.place)}</p>`
    if (!open || !this.filtering) html += `<p class="gdtl-ssum">${esc(s.sum ?? "")}</p>`
    const tags = jumpsOut.map((j) => `<button type="button" class="gdtl-jumpbtn" data-act="goto" data-e="${j.b}">time jump → ${m.pb(j.to)}</button>`).join("")
    html += `<p class="gdtl-meta gdtl-links">${s.href ? `<a class="internal" href="${m.href(s.href)}">Session page</a>` : `<span>no protocol</span>`}${!open ? ` <span>${plural(part.ev.length, "event")}</span>${tags}` : ""}</p>`
    if (open) {
      const days = dayBlocks(m, evs)
      days.forEach((day, di) => {
        const first = m.events[day.ev[0]]
        let label
        if (di === 0 && first.d === 0) label = !part.partial || part.play ? (s.since && !/^unknown|^unclear/i.test(s.since) ? `${s.since} · after the session before` : null) : null
        else label = first.o
        html += `<div class="gdtl-day">${label ? `<p class="gdtl-dayh"><span>${esc(label)}</span></p>` : ""}`
        for (const i of day.ev) html += this.event(i, part.play)
        html += `</div>`
      })
      if (part.play && part.lore?.length && !this.filtering) html += `<div class="gdtl-day gdtl-told"><p class="gdtl-dayh"><span>Told this session</span></p>${part.lore.map((i) => this.loreItem(i, false)).join("")}</div>`
    }
    return html + `</div></section>`
  }

  placeHtml(p) {
    if (!p) return ""
    let html = esc(p.t)
    for (const [label, href] of p.l ?? []) html = html.replace(esc(label), `<a class="internal" href="${this.m.href(href)}">${esc(label)}</a>`)
    return `<span class="gdtl-place"><span class="gdtl-at">at</span> ${html}</span>`
  }
  // people on an event: the portrait is the "follow" button, the name links to the page
  who(npcs, pcs) {
    const all = [...npcs.map((id) => [id, "is-npc"]), ...pcs.map((id) => [id, "is-pc"])]
    const LIMIT = 3 // on phones the rest hides behind "+N"
    const html = all
      .map(([id, cls], n) => {
        const p = this.m.people[id]
        const on = this.st.person === id
        return `<span class="gdtl-p ${cls}${on ? " is-on" : ""}${n >= LIMIT ? " is-extra" : ""}" draggable="true" data-p="${id}"><button type="button" class="gdtl-pin" data-act="person" data-p="${id}" aria-label="Follow ${esc(p.name)} on the timeline" title="Follow ${esc(p.name)} on the timeline">${this.avatar(p)}</button>${p.href ? `<a class="internal" href="${this.m.href(p.href)}">${esc(p.name)}</a>` : esc(p.name)}</span>`
      })
      .join("")
    return html + (all.length > LIMIT ? `<button type="button" class="gdtl-morebtn" data-act="more" aria-label="Show all ${all.length} people">+${all.length - LIMIT}</button>` : "")
  }

  event(i, play) {
    const m = this.m
    const e = m.events[i]
    const hit = this.hits?.has(i)
    const jIn = m.jumpIn.get(i), jOut = m.jumpOut.get(i)
    let html = ""
    if (jIn) html += play ? `<p class="gdtl-jump"><span>Time jump: ${m.pb(jIn.from)} → ${m.pb(jIn.to)}</span></p>` : `<p class="gdtl-jump"><span>Arrives from ${m.pb(jIn.from)}</span> <button type="button" class="gdtl-jumpbtn" data-act="goto" data-e="${jIn.a}">show where they left</button></p>`
    const when = e.x && e.k && e.k !== "sequence" ? `<span class="gdtl-when">“${esc(e.x)}”</span>` : ""
    const off = e.o && !/^(same (day|scene|visit|time)|continuous|unknown|unclear)$/i.test(e.o) ? `<span class="gdtl-off">${esc(e.o)}</span>` : ""
    html += `<article class="gdtl-ev${hit ? " is-hit" : ""}${e.tt ? " is-tt" : ""}" data-e="${i}">`
    html += `<p class="gdtl-what">${play && e.tt ? `<span class="gdtl-tag is-tt">${m.pb(e.y)}</span> ` : ""}${esc(e.w)}</p>`
    const meta = [this.placeHtml(e.p), off, when].filter(Boolean)
    if (meta.length) html += `<p class="gdtl-meta">${meta.join(`<span class="gdtl-dot"> · </span>`)}</p>`
    if (e.n?.length || e.c?.length) html += `<p class="gdtl-who">${this.who(e.n ?? [], e.c ?? [])}</p>`
    if (e.q) html += `<blockquote class="gdtl-q">${esc(e.q)}</blockquote>`
    html += `</article>`
    if (jOut && !play) html += `<p class="gdtl-jump"><span>Time jump to ${m.pb(jOut.to)}</span> <button type="button" class="gdtl-jumpbtn" data-act="goto" data-e="${jOut.b}">follow the party</button></p>`
    return html
  }

  loreItem(i, placed) {
    const m = this.m
    const l = m.lore[i]
    const s = m.sByN.get(l.s)
    const when = l.y != null ? `${l.a ? "≈ " : ""}${yr(l.y)}${l.to != null ? "–" + yr(l.to) : ""} p.B.` : null
    const meta = []
    if (when && (l.a || l.to != null || !placed)) meta.push(`<span class="gdtl-off">${when}</span>`)
    if (l.x) meta.push(`<span class="gdtl-when">as told: “${esc(l.x)}”</span>`)
    if (l.cal) meta.push(`<span class="gdtl-tag">${esc(l.cal)}${l.y == null ? ", not converted" : ""}</span>`)
    if (placed) meta.push(s?.href ? `<a class="internal" href="${m.href(s.href)}">told in S${l.s}</a>` : `told in S${l.s}`)
    return `<article class="gdtl-ev gdtl-lore"><p class="gdtl-what">${esc(l.w)}</p><p class="gdtl-meta">${meta.join(`<span class="gdtl-dot"> · </span>`)}</p>${l.q ? `<blockquote class="gdtl-q">${esc(l.q)}</blockquote>` : ""}</article>`
  }

  undated() {
    const m = this.m
    const w = m.world
    if (!w.undated.length && !w.written.length) return ""
    const node = this.nodes.get("undated")
    const open = this.isOpen(node)
    let html = `<section class="gdtl-era gdtl-undated" data-k="undated">` + this.head(node, "gdtl-h-era", `<span class="gdtl-era-name">Heard, not yet placed in time</span><span class="gdtl-era-span">${plural(w.undated.length + w.written.length, "entry", "entries")}</span>`)
    if (!open) html += `<p class="gdtl-sum">Things the party was told without a year, and dates given in other calendars (tavern logbook, Stygia), which are shown as written.</p>`
    else {
      html += `<div class="gdtl-kids">`
      if (w.written.length) html += `<div class="gdtl-day"><p class="gdtl-dayh"><span>Dates in other calendars</span></p>${w.written.map((i) => this.loreItem(i, true)).join("")}</div>`
      let last = null
      for (const i of w.undated) {
        const l = m.lore[i]
        if (l.s !== last) {
          if (last != null) html += `</div>`
          html += `<div class="gdtl-day"><p class="gdtl-dayh"><span>Told in session ${l.s}</span></p>`
          last = l.s
        }
        html += this.loreItem(i, false)
      }
      if (last != null) html += `</div>`
      html += `</div>`
    }
    return html + `</section>`
  }
}
