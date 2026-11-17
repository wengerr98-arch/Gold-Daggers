// Export-time text clean-ups for the Gold Daggers wiki.
// Every function here takes note text and returns new text; nothing reads or writes the vault.
// Each one is switched on or off in wiki.config.yaml under "cleanup:".

// ---------- grid tables (cleanup.grid_tables) ----------
//
// The protocol converter wrote some tables as "grid tables":
//   +--------+-----------------+
//   | Snix   | text that wraps |
//   |        | over more lines |
//   +--------+-----------------+
// Markdown shows these as lines of pipes. Regular ones become normal Markdown tables; a table with one
// row of very long cells becomes headings with text underneath (readable on a phone); anything with
// merged cells or a broken shape is kept in a preformatted block, so nothing is lost.

const chars = (s) => Array.from(s)
const isBorder = (l) => /^\+(?:[-=:]{2,}\+)+\s*$/.test(l)
const borderCols = (l) => {
  const c = chars(l.trimEnd())
  const at = []
  c.forEach((ch, i) => ch === "+" && at.push(i))
  return at
}

// Lines the vault's editor glued together or cut short are put back into shape where that is unambiguous.
function normaliseBlock(lines, cols) {
  const out = []
  const width = cols[cols.length - 1] + 1
  for (let l of lines) {
    l = l.trimEnd()
    // "| a | b || c | d |" – two table lines on one line
    if (chars(l).length > width + 2 && l.includes("||")) {
      const parts = l.split("||")
      if (parts.length === 2) {
        out.push(parts[0].trimEnd() + "|", "|" + parts[1])
        continue
      }
    }
    // "|   | +-----+------+" – a border line that slipped into a cell
    const b = l.match(/\+(?:[-=]{2,}\+)+$/)
    if (!isBorder(l) && b && borderCols(b[0]).length === cols.length && /^\|[\s|]*$/.test(l.slice(0, b.index))) {
      out.push(b[0])
      continue
    }
    out.push(l)
  }
  return out
}

// One content line → its cells, or null when the line doesn't fit the column layout.
function splitRowLine(line, cols) {
  const c = chars(line)
  const n = cols.length - 1
  if (cols.every((p) => c[p] === "|")) return cols.slice(0, -1).map((p, i) => c.slice(p + 1, cols[i + 1]).join(""))
  // misaligned (wide characters, a cut-off line): split on the pipes instead
  let inner = line.replace(/^\|/, "")
  if (/\|\s*$/.test(inner)) inner = inner.replace(/\|\s*$/, "")
  const parts = inner.split("|")
  if (parts.length === n) return parts
  // a cut-off line: all column pipes up to the break are in place, the rest is one cell
  const cells = []
  let ok = c[0] === "|"
  for (let i = 0; i < n && ok; i++) {
    const last = i === n - 1
    if (last) cells.push(c.slice(cols[i] + 1).join("").replace(/\|\s*$/, ""))
    else if (c[cols[i + 1]] === "|") cells.push(c.slice(cols[i] + 1, cols[i + 1]).join(""))
    else ok = false
  }
  return ok && cells.length === n && !cells[n - 1].includes("|") ? cells : null
}

// Cell lines → paragraphs of lines. Fixes the converter's "text.\*" (line break inside emphasis).
function cellParagraphs(cellLines) {
  const paras = []
  let cur = []
  for (const raw of cellLines) {
    const l = raw.trim()
    if (!l) {
      if (cur.length) paras.push(cur)
      cur = []
    } else cur.push(l.replace(/\\(\*{1,3})$/, "$1\\"))
  }
  if (cur.length) paras.push(cur)
  return paras
}
// A paragraph's lines joined: wrapped lines with a space, forced breaks ("\" at the end) with `br`.
function joinPara(lines, br) {
  let out = ""
  lines.forEach((l, i) => {
    const hard = /\\$/.test(l) && !/\\\\$/.test(l)
    const text = hard ? l.slice(0, -1).trimEnd() : l
    const list = /^([-*+]|\d+[.)])\s/.test(l)
    if (i > 0) out += /\u0000$/.test(out) || list ? "" : " "
    if (list && i > 0 && !/\u0000$/.test(out)) out += "\u0000"
    out += text
    if (hard && i < lines.length - 1) out += "\u0000"
  })
  return out.replace(/\u0000/g, br)
}

function parseGrid(block) {
  const first = block[0].trimEnd()
  const cols = borderCols(first)
  if (cols.length < 2) return null
  const lines = normaliseBlock(block, cols)
  const rows = []
  let cur = null
  let headerAfter = -1
  for (const l of lines) {
    if (isBorder(l)) {
      const at = borderCols(l)
      if (at.length !== cols.length || at.some((p, i) => p !== cols[i])) return null // merged columns
      if (cur) rows.push(cur)
      cur = null
      if (l.includes("=")) headerAfter = rows.length
      continue
    }
    if (!l.startsWith("|")) return null
    if (/\+[-=]{3,}/.test(l)) return null // a border inside a row: merged rows
    const cells = splitRowLine(l, cols)
    if (!cells) return null
    if (!cur) cur = cells.map(() => [])
    cells.forEach((c, i) => cur[i].push(c))
  }
  // no closing border: the table was cut off in the vault. The rows that are there are still good.
  const cutOff = !!cur
  if (cur) rows.push(cur)
  if (!rows.length) return null
  return { rows: rows.map((r) => r.map(cellParagraphs)), headerAfter, ncols: cols.length - 1, cutOff }
}

const escPipes = (s) => s.replace(/\\\|/g, "|").replace(/\|/g, "\\|")
const cellInline = (paras) => escPipes(paras.map((p) => joinPara(p, "<br>")).join("<br>"))

function renderGrid(t, opts) {
  const { rows, ncols } = t
  // the header row: marked with "=====" underneath, or a first row made only of headings
  const isHeadingRow = (r) => r.every((c) => c.length === 1 && c[0].length === 1 && /^#{1,6}\s+\S/.test(c[0][0]))
  let header = null
  let body = rows
  if (t.headerAfter === 1 && rows.length > 1) [header, body] = [rows[0], rows.slice(1)]
  else if (rows.length > 1 && isHeadingRow(rows[0])) [header, body] = [rows[0], rows.slice(1)]

  // one row of long texts next to each other: headings with the text underneath
  const longest = Math.max(...body.flat().map((c) => c.reduce((a, p) => a + p.length, 0)))
  if (opts.long === "sections" && body.length === 1 && longest > (opts.longLines ?? 20)) {
    const out = []
    body[0].forEach((cell, i) => {
      const h = header?.[i]?.[0]?.[0]
      if (h) out.push(/^#{1,6}\s/.test(h) ? h : `**${h}**`, "")
      for (const p of cell) out.push(joinPara(p, "\\\n"), "")
    })
    return { kind: "sections", text: out.join("\n").trimEnd() }
  }

  const head = header ? header.map((c) => cellInline(c).replace(/^#{1,6}\s+/, "")) : Array(ncols).fill(" ")
  const md = [`| ${head.join(" | ")} |`, `|${Array(ncols).fill("---").join("|")}|`]
  for (const r of body) md.push(`| ${r.map((c) => cellInline(c) || " ").join(" | ")} |`)
  return { kind: "table", text: md.join("\n") }
}

export function convertGridTables(body, opts = {}) {
  const src = body.split("\n")
  const out = []
  const found = []
  let fence = null
  for (let i = 0; i < src.length; i++) {
    const line = src[i]
    const f = line.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null
      out.push(line)
      continue
    }
    if (f) {
      fence = f[1]
      out.push(line)
      continue
    }
    if (!isBorder(line)) {
      out.push(line)
      continue
    }
    let j = i
    while (j < src.length && /^[+|]/.test(src[j])) j++
    const block = src.slice(i, j)
    if (block.length < 3) {
      out.push(line)
      continue
    }
    const t = parseGrid(block)
    let res
    if (t) res = renderGrid(t, opts)
    else res = { kind: "preformatted", text: ["```text", ...block.map((l) => l.trimEnd()), "```"].join("\n") }
    if (out.length && out[out.length - 1].trim() !== "") out.push("")
    out.push(res.text)
    if (j < src.length && src[j].trim() !== "") out.push("")
    found.push({ line: i + 1, kind: res.kind, rows: t ? t.rows.length : 0, cols: t ? t.ncols : 0, sourceLines: block.length, cutOff: !!t?.cutOff })
    i = j - 1
  }
  return { body: out.join("\n"), found }
}

// ---------- picture embeds from the converter (cleanup.missing_images) ----------
//
// The protocol converter left embeds like
//   ![](media/image8.jpg){width="5.3in"
//   height="7.0in"}
// The exporter decides what happens to each one (use a file found in the vault, or drop it); this
// function finds them, hands them over and tidies the line. The {width=… height=…} tail always goes:
// Markdown would show it as text.

const MD_IMAGE = /!\[([^\]\n]*)\]\(([^)\n]+)\)/g
export function rewriteImageEmbeds(body, decide) {
  const src = body.split("\n")
  const out = []
  let fence = null
  for (let i = 0; i < src.length; i++) {
    let line = src[i]
    const f = line.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null
      out.push(line)
      continue
    }
    if (f) {
      fence = f[1]
      out.push(line)
      continue
    }
    if (!line.includes("![")) {
      out.push(line)
      continue
    }
    // an attribute tail that runs over the line end: pull the following line(s) in
    let pulled = 0
    while (/!\[[^\]\n]*\]\([^)\n]+\)\{[^}]*$/.test(line) && pulled < 12 && i + 1 < src.length && !/^\s*$/.test(src[i + 1])) {
      line += " " + src[++i].trim()
      pulled++
    }
    let dropped = false
    const next = line.replace(new RegExp(MD_IMAGE.source + "(\\{[^}\\n]*\\})?", "g"), (m, alt, hrefRaw, attrs) => {
      const r = decide({ alt, hrefRaw, embed: `![${alt}](${hrefRaw})` })
      if (r === null) {
        dropped = true
        return ""
      }
      return r ?? `![${alt}](${hrefRaw})`
    })
    // a line that only held the picture disappears with it
    if (dropped && next.replace(/^(?:[ \t]*>)+/, "").trim() === "") {
      if (out.length && out[out.length - 1].trim() === "" && (i + 1 >= src.length || src[i + 1].trim() === "")) i++
      continue
    }
    out.push(next)
  }
  return out.join("\n")
}

// Does a file path belong to a protocol part ("5 Protokoll – Gold Daggers Part 5 - Cleaned Boundaries")?
// True when a folder on the path carries the part's name or its "Part N".
const normName = (s) => String(s).toLowerCase().replace(/\.[a-z0-9]{2,5}$/, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim()
export function partKeys(ref) {
  const name = normName(String(ref).replace(/^\[\[|\]\]$/g, "").split("|")[0].split("/").pop().replace(/\.md$/i, "").replace(/\s*\(\d+\)\s*$/, ""))
    .replace(/\s*cleaned boundaries.*$/, "")
    .trim()
  const keys = new Set()
  if (name) keys.add(name)
  const part = name.match(/\bpart (\d+)\b/)
  if (part) keys.add(`part ${part[1]}`)
  return [...keys]
}
export function pathInPart(rel, keys) {
  const dirs = rel.split("/").slice(0, -1).map(normName)
  return keys.some((k) => dirs.some((d) => d === k || new RegExp(`(^| )${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(d)))
}

// ---------- "the sidecar" (cleanup.sidecar: keep | reword | remove) ----------
//
// The import kept a side file per session (names, open threads). Notes written from it say things like
// "Referenced in the sidecar as …" or "Named in session frontmatter and sidecar". Players don't know that word.
//   reword – same sentence, with "the session notes" / "the session's list of names" instead
//   remove – takes out the part that only says where the import found a name; whatever else is on the
//            line stays. A sentence that needs the reference to make sense is reworded instead.

const SIDECAR_REWORD = [
  [/\bin session frontmatter(?:\/| and | or )sidecars?\b(?=.*\bbody text\b)/gi, "in the session's list of names"],
  [/\bin session frontmatter(?:\/| and | or )sidecars?\b/gi, "in the session notes"],
  [/\bin (Session \d{1,3}) frontmatter(?:\/| and )sidecars?\b/gi, (m, s) => `in ${s}'s list of names`],
  [/\bsession frontmatter(?:\/| and )sidecars?\b/gi, "the session's list of names"],
  [/\bthe session entity sidecar\b/gi, "the session notes"],
  [/\b(?:the )?sidecar entit(?:y|ies) list\b/gi, "the session's list of names"],
  [/\bamong sidecar entities\b/gi, "among the names in the session notes"],
  [/\bamong sidecar companions\b/gi, "among the companions in the session notes"],
  [/\bthe sidecar open thread\b/gi, "an open thread in the session notes"],
  [/\bsidecar cross-reference\b/gi, "cross-reference in the session notes"],
  [/\b(Session \d{1,3}) sidecar (?:notes?|descriptions)\b/gi, (m, s) => `the ${s} notes`],
  [/\bsession sidecar descriptions\b/gi, "session notes"],
  [/\bin session sidecars\b/gi, "in the session notes"],
  [/\b(in|from) sidecar (?:notes|context|descriptions)\b/gi, (m, p) => `${p} the session notes`],
  [/\bsidecar (descriptions|references)\b/gi, (m, w) => `session-note ${w}`],
  [/\bthe sidecar notes(?= (?:that\b|"|\p{Lu}))/giu, "the session notes mention"],
  [/\bthe sidecar flags\b/gi, "the session notes flag"],
  [/\bthe sidecar identifies\b/gi, "the session notes identify"],
  [/\bthe sidecar raises\b/gi, "the session notes raise"],
  [/\bin (?:the )?sidecars?\b/gi, "in the session notes"],
  [/\bthe sidecars?\b/gi, "the session notes"],
  [/\bsidecars?\b/gi, "session notes"],
]
const SIDECAR_REMOVE = [
  // whole sentences / clauses that are only about where a name was found
  [/(^\s*(?:[-*+]\s+)?|[.!?]\s+)[^.;:(]*\bappears? in session frontmatter(?:\/| and )sidecars?\b[^.]*\.?\s*/gi, "$1"],
  [/;\s*listed in the session entity sidecar[^.;]*/gi, ""],
  [/;\s*listed as a named companion reference in the sidecar/gi, ""],
  [/;\s*the sidecar flags some spelling uncertainty around the name/gi, ""],
  [/,\s*with the sidecar linking the two characters explicitly/gi, ""],
  // phrases inside a sentence that goes on to say something
  [/\s+per Session \d{1,3} sidecar notes?/gi, ""],
  [/\s+inferred from sidecar context(?=:)/gi, ""],
  [/\bsidecar cross-reference,\s*/gi, ""],
  [/\s+in (?:the )?sidecar entit(?:y|ies) list/gi, ""],
  [/\s+in session frontmatter(?:\/| and | or )sidecars?/gi, ""],
  [/(\bSession \d{1,3}) frontmatter(?:\/| and )sidecars?/gi, "$1"],
  [/\s+among sidecar (?:entities|companions)/gi, ""],
  [/\s+in (?:the )?sidecar open thread/gi, " in an open thread"],
  [/\s+in sidecar (?:notes|context)/gi, ""],
  [/\s+in session sidecars/gi, ""],
  [/\s+in (?:the )?sidecars?(?! (?:notes|flags|identifies|raises))/gi, ""],
]
// Replacements keep a capital at the start ("The sidecar notes" → "The session notes mention").
const applyRules = (text, rules) =>
  rules.reduce(
    (t, [re, to]) =>
      t.replace(re, (...a) => {
        const m = a[0]
        const r = typeof to === "function" ? to(...a) : to.replace(/\$1/g, a[1] ?? "")
        return r && /^\p{Lu}/u.test(m) && !/^Session\b/.test(m) && /^\p{Ll}/u.test(r) ? r[0].toUpperCase() + r.slice(1) : r
      }),
    text,
  )

function sidecarRemoveLine(line) {
  let t = line
  // brackets that only hold import bookkeeping go completely; the ones with content lose only the phrase
  t = applyRules(t, SIDECAR_REMOVE.slice(5, 9))
  t = t.replace(/\s*\((?:[^()]|\([^()]*\))*\bsidecars?\b(?:[^()]|\([^()]*\))*\)/gi, "")
  t = applyRules(t, SIDECAR_REMOVE)
  // "- Session 078: Referenced; the party …" → "- Session 078: The party …"
  const m = t.match(/^(\s*(?:[-*+]\s+)?(?:(?:\[\[[^\]]+\]\]|Session \d{1,3})\s*:\s*)?)([\s\S]*)$/)
  let rest = m[2].replace(/^(?:Referenced|Named|Listed|Mentioned)(?: in passing)?\s*(?:;|—|–|\.|,)\s*/i, "")
  rest = rest.replace(/^\s+/, "")
  if (rest !== m[2].replace(/^\s+/, "")) rest = rest.replace(/^\p{Ll}/u, (c) => c.toUpperCase())
  if (/^\p{Ll}/u.test(rest) && /^\p{Lu}/u.test(m[2].trimStart())) rest = rest.replace(/^\p{Ll}/u, (c) => c.toUpperCase())
  t = m[1] + rest
  t = t.replace(/[ \t]{2,}/g, " ").replace(/\s+([.;,])/g, "$1").replace(/[ \t]+$/, "")
  // nothing left but the bullet (or "Session 029:"): the line goes
  if (/^\s*(?:[-*+]\s*)?(?:(?:\[\[[^\]]+\]\]|Session \d{1,3})\s*:?\s*)?$/.test(t)) return null
  return t
}

export function cleanSidecar(body, mode) {
  const changes = []
  if (mode !== "reword" && mode !== "remove") return { body, changes }
  const out = []
  let fence = null
  for (const line of body.split("\n")) {
    const f = line.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null
      out.push(line)
      continue
    }
    if (f) fence = f[1]
    if (f || !/sidecar/i.test(line)) {
      out.push(line)
      continue
    }
    let next = line
    let how = "reworded"
    if (mode === "remove") {
      next = sidecarRemoveLine(line)
      how = next === null ? "line removed" : "part removed"
      if (next !== null && /sidecar/i.test(next)) {
        next = applyRules(next, SIDECAR_REWORD)
        how = "reworded (the sentence needs the reference)"
      }
    } else next = applyRules(line, SIDECAR_REWORD)
    changes.push({ before: line, after: next, how })
    if (next !== null) out.push(next)
  }
  return { body: out.join("\n"), changes }
}

// ---------- protocol text inside a code fence (cleanup.protocol_fences) ----------
//
// Some session notes carry their whole protocol inside ```text … ``` (or ```markdown). The page then shows
// one long grey code box: no paragraphs, no links, sideways scrolling on a phone. The fence lines are
// taken away; the text between them is left exactly as it is and is then treated like any other note text.
export function unwrapProtocolFences(body, langs = ["text", "markdown", "md"]) {
  const src = body.split("\n")
  const out = []
  let unwrapped = 0
  for (let i = 0; i < src.length; i++) {
    const open = src[i].match(/^(`{3,}|~{3,})\s*([\w-]*)\s*$/)
    if (!open) {
      out.push(src[i])
      continue
    }
    let j = i + 1
    while (j < src.length && !new RegExp(`^${open[1][0]}{${open[1].length},}\\s*$`).test(src[j])) j++
    if (j < src.length && langs.includes(open[2].toLowerCase())) {
      out.push(...src.slice(i + 1, j))
      unwrapped++
    } else out.push(...src.slice(i, Math.min(j + 1, src.length)))
    i = j
  }
  return { body: out.join("\n"), unwrapped }
}

// ---------- leftover headings (cleanup.stray_headings) ----------
//
// Three kinds of heading the import left behind:
//   · the note's title a second time ("# Session 067" again under "Clean Protocol Text")
//   · headings with no words ("##")
//   · a level-1 heading with nothing under it at the end of the protocol – the heading of the NEXT
//     session in the source file ("# Weekend 23")
export function tidyHeadings(body) {
  const src = body.split("\n")
  const removed = []
  const drop = new Set()
  let fence = null
  const heads = []
  src.forEach((line, i) => {
    const f = line.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null
      return
    }
    if (f) return void (fence = f[1])
    const h = line.match(/^(#{1,6})(?:\s+(.*?))?\s*#*\s*$/)
    if (h) heads.push({ i, level: h[1].length, text: (h[2] ?? "").trim() })
  })
  const norm = (t) => t.toLowerCase().replace(/[*_`]/g, "").replace(/\s+/g, " ").trim()
  const first = heads.find((h) => h.level === 1 && h.text)
  // the sections the import always puts after the protocol text
  const AFTER_PROTOCOL = /^##\s+(extracted summary|entities mentioned|open threads|import notes)\s*$/i
  const own = first?.text.match(/^session\s+0*(\d{1,3})\b/i)?.[1]
  const nextContent = (i) => {
    for (let k = i + 1; k < src.length; k++) if (src[k].trim() && !/^<!--.*-->\s*$/.test(src[k].trim())) return src[k]
    return null
  }
  for (const h of heads) {
    if (!h.text) {
      drop.add(h.i)
      removed.push({ kind: "empty heading", text: src[h.i].trim() })
    } else if (first && h !== first && h.level === 1) {
      const a = norm(h.text)
      const b = norm(first.text)
      const next = nextContent(h.i)
      if (a === b || (a.length >= 8 && b.startsWith(a))) {
        drop.add(h.i)
        removed.push({ kind: "title repeated", text: h.text })
      } else if ((next === null || AFTER_PROTOCOL.test(next)) && !/\]\(|\[\[/.test(h.text) && !(own && new RegExp(`\\bsession\\s*0*${own}\\b`, "i").test(h.text))) {
        drop.add(h.i)
        removed.push({ kind: "heading of the next session", text: h.text })
      }
    }
  }
  if (!drop.size) return { body, removed }
  const out = []
  src.forEach((line, i) => {
    if (drop.has(i)) return
    if (line.trim() === "" && out.length && out[out.length - 1].trim() === "" && drop.has(i - 1)) return
    out.push(line)
  })
  return { body: out.join("\n"), removed }
}

// ---------- converter marks (cleanup.converter_marks) ----------
//
// The converter wrote highlighted and underlined words as [words]{.mark} and [words]{.underline}.
// Markdown shows the brackets and the {.mark}. They become ==words== (highlight) and <u>words</u>.
export function convertMarks(body) {
  let count = 0
  const parts = body.split(/(^[ \t]*(?:`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*(?:`{3,}|~{3,})[ \t]*$)/m)
  const span = /\[((?:[^\[\]\n]|\n(?!\s*\n))*?)\]\{\.(mark|underline)\}/g
  const fix = (text) => {
    for (let pass = 0; pass < 4; pass++) {
      let hit = false
      text = text.replace(span, (m, inner, cls) => {
        hit = true
        count++
        if (!inner.trim()) return inner
        return cls === "mark" ? `==${inner}==` : `<u>${inner}</u>`
      })
      if (!hit) break
    }
    return text
  }
  const out = parts.map((p, i) => (i % 2 ? p : fix(p))).join("")
  return { body: out, count }
}

// ---------- shared-document links (cleanup.doc_links) ----------
//
// Links to Google Docs/Sheets/Drive and other shared-document hosts open the real document for anyone who
// finds them (sometimes even for editing). On the public wiki the link goes, the words of the link stay;
// a bare link becomes "(link removed)".
const DOC_HOSTS = /https?:\/\/(?:docs|drive|sheets)\.google\.com\/[^\s)>\]]*|https?:\/\/(?:[a-z0-9-]+\.)?(?:sharepoint\.com|onedrive\.live\.com|1drv\.ms|dropbox\.com|notion\.so)\/[^\s)>\]]*/gi
// targets (cleanup.doc_link_targets): [[part of the document's address, vault note], …]. A removed link whose
// address contains such a part becomes a link to that note (a copy of the document kept in the vault).
// The exporter turns the link back into plain words if the note is not published.
const plainLabel = (s) => s.replace(/<[^>]+>/g, "").replace(/\[([^\[\]]*)\]\{[^}]*\}/g, "$1").replace(/[*_=`|\[\]]/g, "").trim()
export function stripDocLinks(body, targets = []) {
  let count = 0
  let linked = 0
  const targetOf = (url) => targets.find(([part]) => part && url.includes(part))?.[1]
  const noteName = (t) => t.split("/").pop().replace(/\.md$/i, "")
  let out = body.replace(/\[((?:[^\[\]\n]|\[[^\[\]\n]*\])*)\]\(\s*<?(https?:\/\/[^)\s>]*)>?\s*\)/g, (m, label, url) => {
    if (!new RegExp(DOC_HOSTS.source, "i").test(url)) return m
    count++
    const t = targetOf(url)
    if (!t) return label
    linked++
    return `[[${t.replace(/\.md$/i, "")}|${plainLabel(label) || noteName(t)}]]`
  })
  out = out.replace(DOC_HOSTS, (url) => {
    count++
    const t = targetOf(url)
    if (!t) return "(link removed)"
    linked++
    return `[[${t.replace(/\.md$/i, "")}|${noteName(t)}]]`
  })
  return { body: out, count, linked }
}

// ---------- "OUTPUT TRUNCATED" lines (cleanup.truncation_notes) ----------
//
// Where the import tool cut a long note it left "... [OUTPUT TRUNCATED - 12203 chars omitted …] ...".
// The text is missing in the vault; the export can only say so in plain words. The half line that
// follows a cut inside a table (a few characters and a "|") goes too.
export function markTruncations(body, label) {
  const src = body.split("\n")
  const out = []
  const found = []
  for (let i = 0; i < src.length; i++) {
    const m = src[i].match(/^\s*\.{3}\s*\[OUTPUT TRUNCATED\s*-\s*(\d+) chars omitted[^\]]*\]\s*\.{3}\s*$/)
    if (!m) {
      out.push(src[i])
      continue
    }
    found.push({ chars: Number(m[1]) })
    out.push(label)
    let k = i + 1
    while (k < src.length && !src[k].trim()) k++
    if (k < src.length && /^[^|+].{0,200}\|\s*$/.test(src[k])) {
      let n = k + 1
      while (n < src.length && !src[n].trim()) n++
      if (n < src.length && /^\+[-=+]+\s*$/.test(src[n])) {
        found[found.length - 1].fragment = src[k].trim().replace(/\s*\|$/, "")
        src[k] = ""
      }
    }
  }
  return { body: out.join("\n"), found }
}

// ---------- e-mail addresses (cleanup.email_addresses) ----------
//
// Word "@mentions" came through the converter as [Name](mailto:address). The wiki is public:
// the address goes, the words of the link stay. Bare addresses in the text go as well.
// names: "first_name" = of a former @-mention ("[First Last](mailto:…)") only the first name stays.
export function stripEmails(body, { names = "keep" } = {}) {
  let count = 0
  let shortened = 0
  let out = body.replace(/\[((?:[^\[\]\n]|\n(?!\s*\n))*)\]\(\s*<?mailto:[^)\s>]*>?\s*\)/gi, (m, label) => {
    count++
    if (/@/.test(label)) return ""
    if (names !== "first_name") return label
    const words = label.replace(/<[^>]+>|\{\.[a-z]+\}|[\[\]]/g, " ").trim().split(/\s+/)
    if (words.length < 2) return label
    shortened++
    return /<u>/i.test(label) ? `<u>${words[0]}</u>` : words[0]
  })
  out = out.replace(/<?(?:mailto:)?[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}>?/g, () => {
    count++
    return ""
  })
  return { body: out, count, shortened }
}

// ---------- the import's own bookkeeping (cleanup.import_notes) ----------
//
// Notes written by the import carry remarks that were meant for whoever reviews the import, not for readers:
// "Draft import of Session 020 from the converted protocol source …", "- Not extracted in first pass.",
// "— DM to confirm", "(stub needed)", "Old vault entry existed but was empty", "Confidence: low — …".
// Only the remark goes: a whole line when the line is nothing else, otherwise just the clause or sentence.
// A heading whose section held nothing but such lines goes with them. Everything is logged with before/after.

// whole lines (after an optional list bullet or quote mark)
const IMPORT_LINES = [
  ["draft import line", /^Draft import of Session \d+ from the converted protocol source\..*$/i],
  ["draft import line", /^This is a generated draft import from a converted protocol file and has not been reviewed\.$/i],
  ["first-pass filler", /^Not extracted in (the )?first pass\.?$/i],
  ["first-pass filler", /^None (explicitly |clearly )?(identified|named)( explicitly)?( in (this|the) (first-pass draft|source (chunk|block)))?\.?$/i],
  ["first-pass filler", /^Not identified\.?$/i],
  ["review to-do", /^Review the source text for campaign-specific entity extraction and canon handling\.$/i],
  ["review to-do", /^Follow up on the session's immediate scene progression in the next imported material\.$/i],
  ["review to-do", /^Preserve any unresolved source ambiguities for later review\.$/i],
  ["review to-do", /^Continue following the session-specific lead on the next imported batch\.$/i],
  ["review to-do", /^Verify any unclear named figure in later review if it becomes relevant\.$/i],
  ["file bookkeeping", /^A duplicate stub exists at `[^`]+`.*$/i],
  ["file bookkeeping", /^Folder placement\b.*pending DM confirmation\.?$/i],
  ["file bookkeeping", /^Filed under\b.*pending DM confirmation\.?$/i],
  ["file bookkeeping", /^(DM confirmation: track as|Confirmed by DM to track as|DM-flagged: track)\b.*$/i],
  ["review flag", /^Flagged in Session \d+ manual review\b.*$/i],
  ["review flag", /^Confidence: (low|medium|high)\b.*$/i],
  ["old vault remark", /^(\*\*)?Old vault (entry|stub|file|image reference|reference)\b.*$/i],
  ["old vault remark", /^(Referenced by old vault image|Two old vault files existed|No dedicated old vault|An old vault image file)\b.*$/i],
  ["old vault remark", /^No race, class, age,? or group recorded in the old vault\.?$/i],
  ["import heading", /^#{1,6}\s+Cross-File Continuation\s*$/i],
  ["review flag", /^\*\*Needs review:?\*\*:?.*$/i],
  ["review flag", /^.*\bMerge Candidate Index\b.*$/i],
  ["review flag", /^May be related to "[^"]*\/[^"]*"\s*[—–-]\s*identity unconfirmed\.?$/i],
  ["file bookkeeping", /^An image file \([^)]*\) exists in (the )?vault\b.*$/i],
  ["file bookkeeping", /^Currently filed under\b.*$/i],
  ["file bookkeeping", /^A separate (location |faction |item )?stub exists at `[^`]+`.*$/i],
]
// parts of a line; [kind, pattern, replacement]
const IMPORT_PARTS = [
  ["not importable", /\s*\[embedded [^\]\n]*not importable\]/gi, ""],
  ["review flag", /⚠️\s*MANUAL REVIEW REQUIRED:\s*/g, ""],
  ["review flag", /\s*Do not canoni[sz]e [^.\n]*\./gi, ""],
  ["review flag", /\s*(High lore interest\s*[—–-]\s*)?flagged for DM review\./gi, ""],
  ["review flag", /,? and was flagged in Session \d+ manual review[^.\n]*\./gi, "."],
  ["file bookkeeping", /\s*Update filename[^.\n]*\./gi, ""],
  ["review flag", /\s*[^.\n]*"Golem \/ Fourth Titan \/[^.\n]*\./g, ""],
  ["review flag", /⚠️\s*Lore-significant (artifact|artefact|item|figure|character)\.\s*/gi, ""],
  ["review flag", /\s*[—–-]\s*potential lore significance(?=\.)/gi, ""],
  ["tool word", /\s*\(Raphael,[^)\n]*\)/g, ""],
  ["tool word", /\b(Session \d+) Correction Memory\b/g, "$1"],
  ["tool word", /\s*\((?:noted in )?Correction Memory[^)\n]*\)/gi, ""],
  ["tool word", /\s+(?:per|via)\s+(?:the )?Correction Memory(?:,?\s+S(?:ession)?\s*\d+)?/gi, ""],
  ["tool word", /^Alias in frontmatter:/i, "Alias:"],
  ["DM to confirm", /\s*\(DM to confirm\)/gi, ""],
  ["DM to confirm", /\s*[;,]\s*DM to confirm(?=[),.;]|$)/gi, ""],
  ["DM to confirm", /\s*[—–-]\s*DM (to confirm|confirmation (is )?(needed|required)|clarification pending)\.?\s*$/gi, ""],
  ["DM to confirm", /\s*;\s*DM confirmation needed(?=\))/gi, ""],
  ["stub remark", /\s*[—–-]?\s*\((stub needed|no stub yet)\)/gi, ""],
  ["import remark", /\s*\((Detailed sensory description not yet documented in sidecars|Information needed from future sessions or DM clarification|Sources: session sidecar descriptions[^)\n]*|URL noted in Import Notes|as noted in frontmatter|alias in frontmatter)\.?\)/gi, ""],
  ["import remark", /\s*\(no additional detail on file\)/gi, ""],
  ["import remark", /\s*;\s*no further details? recorded\s*$/gi, ""],
  ["no further detail", /\s*No further (details?|information)( about [^.\n]*?)? (has |have |was |were |is |are )?(been )?(recorded|available|confirmed)( yet| in the source vault)?(; the sidecar flags [^.\n]*)?\./gi, ""],
  ["import heading", /^(#{1,6}\s+.*?)\s*\(from source\)\s*$/i, "$1"],
  ["title unknown", /^(#{1,6}\s+Session \d+)\s*[-–—]\s*Title Unknown\s*$/i, "$1"],
]
const IMPORT_SOURCE_FILE = /^\d*\s*Protokoll\s*[–-]\s*Gold Daggers Part \d+\b.*$/i

export function cleanImportNotes(body) {
  const src = body.split("\n")
  const out = []
  const changes = []
  const touched = [] // indexes in `out` after which a line was removed
  let fence = null
  for (let i = 0; i < src.length; i++) {
    const line = src[i]
    const f = line.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null
      out.push(line)
      continue
    }
    if (f && /^\s*(`{3,}|~{3,})\s*img-gallery\b/i.test(line)) {
      // an Obsidian gallery block: shows as a code box with a vault folder path
      let k = i + 1
      while (k < src.length && !new RegExp("^\\s*" + f[1][0] + "{" + f[1].length + ",}\\s*$").test(src[k])) k++
      changes.push({ kind: "gallery block", before: src.slice(i, k + 1).join(" ").trim(), after: "" })
      touched.push(out.length)
      i = k
      continue
    }
    if (f) {
      fence = f[1]
      out.push(line)
      continue
    }
    if (/^\s*</.test(line)) {
      out.push(line)
      continue
    }
    const lead = line.match(/^(\s*(?:>\s*)*(?:[-*+]\s+)?)(.*)$/)
    const text = lead[2].trim()
    // "Source:" followed by the name of the converted protocol file
    if (/^Source:\s*$/i.test(text) && IMPORT_SOURCE_FILE.test((src[i + 1] ?? "").trim())) {
      changes.push({ kind: "source line", before: `${text} ${src[i + 1].trim()}`, after: "" })
      touched.push(out.length)
      i++
      continue
    }
    const whole = IMPORT_LINES.find(([, re]) => re.test(text) || re.test(line.trim()))
    if (whole) {
      changes.push({ kind: whole[0], before: line.trim(), after: "" })
      touched.push(out.length)
      continue
    }
    let rest0 = lead[2]
    const kinds = []
    for (const [kind, re, rep] of IMPORT_PARTS) {
      const r = rest0.replace(re, rep)
      if (r !== rest0) {
        kinds.push(kind)
        rest0 = r
      }
    }
    let next = line
    if (kinds.length) {
      rest0 = rest0.trim().replace(/\(\s*\)/g, "").replace(/ {2,}/g, " ").replace(/\s+([.;,])/g, "$1")
      next = lead[1] + rest0
      const rest = next.replace(/^\s*(?:>\s*)*(?:[-*+]\s+)?/, "").trim()
      // nothing left, or only a bare label like "**Das Spielfeld:**"
      if (!rest || /^⚠️?$/u.test(rest) || /^(\*\*[^*]+:\*\*|\*\*[^*]+\*\*:|[A-Za-zÄÖÜäöü' ]{1,40}:)$/.test(rest)) {
        changes.push({ kind: kinds[0], before: line.trim(), after: "" })
        touched.push(out.length)
        continue
      }
      changes.push({ kind: kinds[0], before: line.trim(), after: next.trim() })
      out.push(next)
      continue
    }
    out.push(line)
  }
  if (!changes.length) return { body, changes }

  // headings left without anything under them because their lines were removed
  const headingAt = (k) => out[k]?.match(/^(#{1,6})\s+\S/)
  // each removal point: where it is, and how deep a heading above it may be to count as "its" heading
  // (after a heading went, only its parent may follow — never an empty neighbour that was empty before)
  const points = touched.map((at) => ({ at, below: 7 }))
  let again = true
  while (again) {
    again = false
    for (const p of points) {
      if (p.done) continue
      let h = Math.min(p.at, out.length) - 1
      while (h >= 0 && !headingAt(h)) {
        if (out[h].trim()) { h = -1; break }
        h--
      }
      const level = h >= 0 ? headingAt(h)[1].length : 0
      const isTitle = level === 1 && !out.slice(0, h).some((l) => /^#{1,6}\s+\S/.test(l))
      if (h < 0 || isTitle || level >= p.below) { p.done = true; continue }
      let k = h + 1
      let empty = true
      for (; k < out.length; k++) {
        const hk = headingAt(k)
        if (hk && hk[1].length <= level) break
        if (out[k].trim()) { empty = false; break }
      }
      if (!empty) { p.done = true; continue }
      changes.push({ kind: "emptied heading", before: out[h].trim(), after: "" })
      out.splice(h, k - h)
      for (const q of points) if (q.at > h) q.at = Math.max(h, q.at - (k - h))
      p.at = h
      p.below = level
      again = true
    }
  }
  return { body: out.join("\n").replace(/\n{4,}/g, "\n\n\n"), changes }
}

// ---------- pages with nothing on them (cleanup.hide_empty) ----------
//
// Some notes are only what the import left as a placeholder: a title, "No information currently recorded for
// the Bands of Imprisonment. This stub is a placeholder …", "*(No session appearances recorded.)*", "- Aliases: X".
// realWords() counts the words a reader would actually get: everything except headings, sections that are cut
// anyway (dropHeadings: the DM and bookkeeping headings), DM callouts, %% comments %%, and those filler lines.
// A picture counts as content.
const EMPTY_LINES = [
  /^none( confirmed| recorded| known| yet)?\.?$/i,
  /^\(?no (direct )?(session (appearances|entries)|confirmed (facts|information)|information|detailed information|further (details?|information))\b[^)]*\)?\.?$/i,
  /^(aliases?|also known as)\s*:.*$/i,
  /^unknown\.?$/i,
]
const EMPTY_SENTENCES = [
  /No (detailed |confirmed )?information (has been |is )?(currently )?(recorded|available)[^.]*\./gi,
  /This stub[^.]*\./gi,
  /It is referenced by name only[^.]*\./gi,
  /No further (details?|information)[^.]*\./gi,
  /[^.]*\bis an? (item|faction|npc|place|location|character|entity)[^.]{0,60}\b(within|in|referenced in) the Gold Daggers campaign\./gi,
]
export function realWords(body, { dropHeadings = [], dmCallouts = new Set() } = {}) {
  const text = body.replace(/%%[\s\S]*?%%/g, "").replace(/<!--[\s\S]*?-->/g, "")
  let skipLevel = 0
  let skipQuote = 0
  let words = 0
  for (const line of text.split("\n")) {
    const depth = (line.match(/^(?:[ \t]*>)+/)?.[0].match(/>/g) ?? []).length
    if (skipQuote) {
      if (depth >= skipQuote) continue
      skipQuote = 0
    }
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/)
    if (h) {
      if (skipLevel && h[1].length <= skipLevel) skipLevel = 0
      if (!skipLevel && dropHeadings.some((r) => r.test(h[2].replace(/[*_`]/g, "").trim()))) skipLevel = h[1].length
      continue
    }
    if (skipLevel) continue
    const c = line.match(/^((?:[ \t]*>)+)[ \t]*\[!([\w-]+)\]/)
    if (c && dmCallouts.has(c[2].toLowerCase())) {
      skipQuote = depth
      continue
    }
    if (/!\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)]+\)/.test(line)) return Infinity // a picture is content
    let s = line.replace(/^\s*(?:>\s*)*(?:[-*+]\s+)?/, "").replace(/^[*_]+|[*_]+$/g, "").trim()
    if (!s || EMPTY_LINES.some((r) => r.test(s))) continue
    for (const r of EMPTY_SENTENCES) s = s.replace(r, "")
    words += (s.match(/[\p{L}\p{N}]+/gu) ?? []).length
  }
  return words
}

// ---------- facts the page says it has from the DM (cleanup.dm_sourced: keep | remove) ----------
//
// "confirmed by DM", "per DM correction note", "classified by the DM", "(DM note)": the page tells readers the DM
// said so outside the game — and the fact may be one the party was never told. keep = nothing changes, the export
// report lists every such line. remove = a list entry goes as a whole, in running text the sentence goes.
const DM_SOURCED = /\bDM[- ](?:confirm\w*|correct\w*|approv\w*|classif\w*|note|clarif\w*)|\b(?:confirmed|classified|approved|corrected|established)\b[^.\n]{0,40}\bby (?:the )?DM\b|\b(?:per|according to) (?:the |a )?DM\b|\bDM (?:has |had )?(?:confirmed|classified|approved|corrected|established)\b|\bDM confirmation(?: has|:)|\bDM (?:long-rest )?exposition\b/i
const sentences = (text) => text.match(/(?:[^.!?]|\.(?=\S)|(?<=\b(?:Dr|St|vs|ca|z\.B|e\.g|i\.e|approx|No|Nr))\.)+[.!?]*["”')\]]*\s*/g) ?? [text]
export function cleanDmSourced(body, mode = "keep") {
  const found = []
  const out = []
  let fence = null
  for (const line of body.split("\n")) {
    const f = line.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null
      out.push(line)
      continue
    }
    if (f) fence = f[1]
    if (f || /^\s*(<|#)/.test(line) || !DM_SOURCED.test(line)) {
      out.push(line)
      continue
    }
    const lead = line.match(/^(\s*(?:>\s*)*(?:[-*+]\s+)?)(.*)$/)
    const isItem = /[-*+]\s+$/.test(lead[1]) || /^\s*\|/.test(line)
    if (isItem) {
      found.push({ before: line.trim(), after: "" })
      if (mode !== "remove") out.push(line)
      continue
    }
    const parts = sentences(lead[2])
    const kept = parts.filter((p) => !DM_SOURCED.test(p)).join("").trim()
    found.push({ before: parts.filter((p) => DM_SOURCED.test(p)).join("").trim(), after: mode === "remove" ? "(sentence removed)" : "" })
    if (mode !== "remove") out.push(line)
    else if (kept) out.push(lead[1] + kept)
  }
  return { body: mode === "remove" ? out.join("\n") : body, found }
}

// ---------- real-world details of the players (cleanup.player_details: keep | strip) ----------
//
// Session protocols start with "Anwesend: …", "Protokoll: …", "Location: …" / "Ort: …" (who sat at the table, who
// wrote, where the group met); two sessions link every character to a D&D Beyond profile (the address carries the
// player's account name), two character pages embed a D&D Beyond sheet. strip = the header lines go (only in
// session notes; "In Game Location:" stays), a profile link becomes the plain character name, the embedded
// sheet goes together with its "Character Sheet" heading. Other dndbeyond.com links (monsters, rules) stay.
const TABLE_HEADER = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?(Anwesend|Protokoll|Location|Ort)(?:\*\*|__)?\s*:/i
// A header line of the protocol, not a line of the story ("Anwesend: Loxodon-Bibliothekar" under a scene heading):
// it stands in the first lines under the session's own heading, or directly after another header line.
const SESSION_HEADING = /session|weekend|week\b|d\s*&\s*d|dnd|protocol|protokoll|titel|\d{4}/i
export function stripPlayerDetails(body, { session = false, ingameNames = [], ingamePlaces = [] } = {}) {
  const changes = []
  // header lines that name only characters (or an in-game place) are part of the story and stay
  const names = new Set(ingameNames.map((n) => String(n).trim().toLowerCase()))
  const places = new Set(ingamePlaces.map((n) => String(n).trim().toLowerCase()))
  const inGame = (line) => {
    const m = line.match(/^\s*\**\s*(Anwesend|Protokoll|Location|Ort)\s*:\s*\**\s*(.*)$/i)
    if (!m || !m[2].trim()) return false
    const kind = m[1].toLowerCase()
    const val = m[2].trim()
    if (kind === "location" || kind === "ort") return places.has(val.toLowerCase())
    // names in brackets ("(Barzan weg)") must be characters too
    const bracketNames = [...val.matchAll(/\(([^)]*)\)/g)].flatMap((b) => b[1].match(/\b[A-ZÄÖÜ][\wäöüé-]*/g) || [])
    if (bracketNames.some((w) => !names.has(w.toLowerCase()))) return false
    const list = val.replace(/\([^)]*\)/g, "").split(/,|&| und /).map((x) => x.trim().toLowerCase()).filter(Boolean)
    return list.length > 0 && list.every((x) => names.has(x))
  }
  // profile links first, on the whole text: the protocols are hard-wrapped, so a link can run over two lines
  let text = body.replace(/\[((?:[^\[\]\n]|\n(?!\s*\n)|\[[^\]\n]*\])*)\]\s?\(\s*<?https?:\/\/(?:www\.)?dndbeyond\.com\/profile\/[^)\s>]*>?\s*\)/gi, (m, label) => {
    const name = label.replace(/<\/?u>/g, "")
    changes.push({ kind: "profile link", before: m.replace(/\s+/g, " ").replace(/\/profile\/[^/]+/, "/profile/…"), after: name.replace(/\s+/g, " ") })
    return name
  })
  const out = []
  const lines = text.split("\n")
  let fence = null
  let zone = session ? 0 : 99 // lines of text since the session's heading (or the top of the note)
  let afterHeader = false
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    const f = line.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null
      out.push(line)
      continue
    }
    if (f) {
      fence = f[1]
      out.push(line)
      continue
    }
    if (!line.trim() || /^\s*<!--/.test(line) || /^\s*</.test(line) && !/<iframe/i.test(line)) {
      out.push(line)
      continue
    }
    const h = line.match(/^#{1,6}\s+(.*)$/)
    if (h) {
      if (SESSION_HEADING.test(h[1])) zone = 0
      afterHeader = false
      out.push(line)
      continue
    }
    if (session && TABLE_HEADER.test(line) && (zone <= 6 || afterHeader) && inGame(line) && (li + 1 >= lines.length || !lines[li + 1].trim() || TABLE_HEADER.test(lines[li + 1]))) {
      afterHeader = true
      out.push(line)
      continue
    }
    if (session && TABLE_HEADER.test(line) && (zone <= 6 || afterHeader)) {
      // the line and what the hard wrap pushed onto the following lines
      let k = li
      while (k + 1 < lines.length && lines[k + 1].trim() && !TABLE_HEADER.test(lines[k + 1]) && !/^\s*(#{1,6}\s|[-*+]\s|>|<|\||In Game Location)/i.test(lines[k + 1]) && lines[k].length >= 60) k++
      changes.push({ kind: line.match(TABLE_HEADER)[1].toLowerCase().replace(/^ort$/, "location") + " line", before: lines.slice(li, k + 1).join(" ").trim(), after: "" })
      li = k
      afterHeader = true
      continue
    }
    if (/<iframe\b[^>]*dndbeyond\.com/i.test(line)) {
      changes.push({ kind: "embedded sheet", before: line.trim().replace(/\s+/g, " "), after: "" })
      let k = out.length - 1
      while (k >= 0 && !out[k].trim()) k--
      if (k >= 0 && /^#{1,6}\s+Character Sheet\s*$/i.test(out[k])) out.length = k
      continue
    }
    if (!/^\s*In Game Location/i.test(line)) afterHeader = false
    zone++
    out.push(line)
  }
  return { body: changes.length ? out.join("\n") : body, changes }
}

