// Gold Daggers map — "?place=kasta" on the Map page centres the map on that pin and opens a small label.
// Inlined on every page by the plugin (see ../dist/index.js); it does nothing where there is no map.
//
// The map plugin (quartz-leaflet-bases-plugin) keeps its Leaflet map to itself and loads Leaflet when a
// map page is opened. So this waits for Leaflet to arrive and asks it to report every map it creates.
// Nothing in the plugin is changed.
;(() => {
  if (window.__gdMapHook) return
  window.__gdMapHook = true
  const plain = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

  function focus(map) {
    const want = plain(new URLSearchParams(window.location.search).get("place"))
    const L = window.L
    if (!want || !L || !map._container?.isConnected) return
    let hit = null
    map.eachLayer((layer) => {
      if (hit || !layer.getLatLng || !layer.getTooltip?.()) return
      const name = String(layer.getTooltip().getContent?.() ?? "")
      const link = String(layer.options?.icon?.options?.html ?? "").match(/href="([^"]*)"/)?.[1] ?? ""
      let slug = link.split(/[?#]/)[0].replace(/\/+$/, "").split("/").pop() ?? ""
      try { slug = decodeURIComponent(slug) } catch {}
      if (plain(name) === want || plain(slug) === want || plain(slug) === want.replace(/\s/g, "-")) hit = { layer, name, link }
    })
    if (!hit) return
    // the plugin sets its opening zoom with an animation: wait until the map stands still
    if (map._animatingZoom) return void map.once("zoomend", () => setTimeout(() => focus(map), 20))
    const zoom = Math.min(map.getMaxZoom(), Math.max(map.getZoom(), map.getMinZoom() + (map.getMaxZoom() - map.getMinZoom()) * 0.55))
    map.stop?.()
    map.invalidateSize({ animate: false }) // the box may have got its final size after the map was made
    // pins near the edge: give the map some room beyond the picture, so the pin can sit in the middle and its label fits
    if (map.options.maxBounds && !map.__gdRoom) {
      map.__gdRoom = true
      map.setMaxBounds(L.latLngBounds(map.options.maxBounds).pad(0.25))
    }
    map.setView(hit.layer.getLatLng(), zoom, { animate: false })
    // the hidden note the timeline builder leaves on the Map page says where the timeline is and which places are on it
    const note = document.querySelector(".gd-map-tl")
    let key = hit.link.split(/[?#]/)[0].replace(/\/+$/, "").split("/").pop() ?? ""
    try { key = decodeURIComponent(key) } catch {}
    let tl = null
    if (note?.dataset.href && (note.dataset.places ?? "").split("|").includes(key)) {
      tl = new URL(note.dataset.href, window.location.href)
      tl.search = "?place=" + encodeURIComponent(key)
    }
    const html = `<a class="internal gd-map-name" href="${esc(hit.link)}">${esc(hit.name)}</a>` + (tl ? `<a class="internal gd-map-totl" href="${esc(tl.href)}">On the timeline →</a>` : "")
    hit.layer.unbindPopup?.()
    hit.layer.bindPopup(html, { offset: [0, -42], className: "gd-map-popup", closeButton: true, autoPan: true, minWidth: 120 }).openPopup()
    hit.layer.getElement?.()?.classList.add("gd-map-target")
    const box = map._container.getBoundingClientRect()
    if (box.bottom > window.innerHeight || box.top < 0) map._container.scrollIntoView({ block: box.height > window.innerHeight ? "start" : "center" })
  }

  function hook(L) {
    if (!L?.Map?.addInitHook || L.__gdHooked) return
    L.__gdHooked = true
    // the plugin adds the pins right after it creates the map, in the same breath: look once that is done
    L.Map.addInitHook(function () {
      setTimeout(() => focus(this), 30)
    })
  }
  if (window.L) hook(window.L)
  else {
    let value
    try {
      Object.defineProperty(window, "L", { configurable: true, enumerable: true, get: () => value, set: (v) => { value = v; hook(v) } })
    } catch {}
  }
})()
