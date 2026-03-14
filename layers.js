// ============================================================
//  layers.js  —  Context Layer Loader & Manager
//  Handles GeoJSON vectors + GeoTIFF rasters (population density, land cover).
//  All layers are lazy-loaded on first toggle.
//  Placeholder .tif / empty .geojson files show ⚠ badge until replaced.
// ============================================================

const ContextLayers = (() => {

  // ── Road style helper (uses OSM `highway` tag) ─────────────
  function _roadStyle(f) {
    const t = (f?.properties?.highway || f?.properties?.type || "").toLowerCase();
    if (["motorway", "trunk", "primary"].includes(t))
      return { color: "#ffdd55", weight: 2.5, opacity: 0.85 };
    if (["secondary", "tertiary"].includes(t))
      return { color: "#aaaaaa", weight: 1.5, opacity: 0.75 };
    return { color: "#444444", weight: 0.8, opacity: 0.6 };
  }

  // ── Land cover palette — covers both ESA WorldCover (10-100)
  //    and Copernicus Global Land Cover 100m (CGLS-LC100, 20-200) ──
  const LC_PALETTE = {
    10:  "rgba(0,160,0,.70)",      // Tree cover (ESA WC)
    20:  "rgba(195,155,100,.70)",  // Shrubs / Shrubland
    30:  "rgba(220,215,60,.65)",   // Herbaceous vegetation / Grassland
    40:  "rgba(255,165,0,.65)",    // Cropland
    50:  "rgba(210,50,30,.70)",    // Built-up
    60:  "rgba(215,195,160,.55)",  // Bare / sparse vegetation
    70:  "rgba(230,245,255,.55)",  // Snow / Ice
    80:  "rgba(0,100,205,.55)",    // Permanent water
    90:  "rgba(0,185,155,.55)",    // Herbaceous wetland
    95:  "rgba(0,145,105,.55)",    // Mangroves
    100: "rgba(185,205,165,.50)",  // Moss / lichen
    200: "rgba(0,70,200,.45)",     // Ocean / Sea (CGLS-LC100)
  };

  // ── Layer registry ──────────────────────────────────────────
  const DEFS = {

    // ▸ Rasters ─────────────────────────────────────────────
    popdens: {
      label: "Population Density", emoji: "👥", group: "raster",
      file: "data/population_density.tif", type: "raster",
      colorFn(v, info) {
        if (v == null || Number.isNaN(v) || v === info.noDataValue || v < 0) return null;
        const lo = Math.max(info.min, 0);
        const t  = Math.min((v - lo) / ((info.max - lo) + 1e-6), 1);
        const r  = Math.round(255 * t);
        const g  = Math.round(55  * (1 - t));
        return `rgba(${r},${g},10,0.72)`;
      },
      // Continuous gradient legend (people/km²)
      gradientLegend: {
        stops: ["rgba(0,55,10,.85)", "rgba(128,28,10,.85)", "rgba(255,0,10,.85)"],
        min: "Low", max: "High", unit: "people / km²",
      },
    },
    landcover: {
      label: "Land Cover", emoji: "🌿", group: "raster",
      file: "data/landcover.tif", type: "raster",
      colorFn(v, info) {
        if (v == null || Number.isNaN(v) || v === 0 || v === info.noDataValue || v < 0) return null;
        // Handle CGLS-LC100 closed/open forest classes (111-116, 121-126)
        if (v >= 111 && v <= 116) return "rgba(0,120,0,.75)";
        if (v >= 121 && v <= 126) return "rgba(60,155,40,.68)";
        return LC_PALETTE[v] || LC_PALETTE[Math.round(v / 10) * 10] || null;
      },
      legend: [
        { color: "rgba(210,50,30,.70)",   label: "Built-up" },
        { color: "rgba(255,165,0,.65)",   label: "Cropland" },
        { color: "rgba(195,155,100,.70)", label: "Shrubs" },
        { color: "rgba(220,215,60,.65)",  label: "Herbaceous veg." },
        { color: "rgba(0,120,0,.75)",     label: "Closed forest" },
        { color: "rgba(60,155,40,.68)",   label: "Open forest" },
        { color: "rgba(0,100,205,.55)",   label: "Water bodies" },
        { color: "rgba(0,70,200,.45)",    label: "Ocean / Sea" },
      ],
    },

    // ▸ Infrastructure ───────────────────────────────────────
    roads: {
      label: "Roads", emoji: "🛣️", group: "infra",
      file: "data/roads.geojson", type: "line",
      extraProp: "fclass",
      style: f => _roadStyle(f),
    },
    railways: {
      label: "Railways", emoji: "🚂", group: "infra",
      file: "data/railways.geojson", type: "line",
      extraProp: "fclass",
      style: () => ({ color: "#886644", weight: 2, opacity: 0.8, dashArray: "6 3" }),
    },
    // ▸ Water ────────────────────────────────────────────────
    rivers: {
      label: "Rivers", emoji: "🌊", group: "nature",
      file: "data/rivers.geojson", type: "line",
      extraProp: "fclass",
      style: () => ({ color: "#3399ff", weight: 1.5, opacity: 0.85 }),
    },
    lakes: {
      label: "Lakes & Wetlands", emoji: "💧", group: "nature",
      file: "data/lakes.geojson", type: "polygon",
      extraProp: "fclass",
      style: () => ({ color: "#2277dd", weight: 1, fillColor: "#3399ff", fillOpacity: 0.35 }),
    },

    // ▸ Places ───────────────────────────────────────────────
    localities: {
      label: "Localities",         emoji: "📌", group: "places",
      file: "data/localities.geojson", type: "point", color: "#ffcc44",
    },
    worship: {
      label: "Places of Worship",  emoji: "⛪", group: "places",
      file: "data/worship.geojson",    type: "point", color: "#cc88ff",
      extraProp: "fclass",
    },
    pois: {
      label: "Points of Interest", emoji: "⭐", group: "places",
      file: "data/pois.geojson",       type: "point", color: "#ffaa44",
      extraProp: "fclass",
    },
    transport: {
      label: "Public Transport Hub", emoji: "🚌", group: "places",
      file: "data/transport.geojson",  type: "point", color: "#44ddff",
      extraProp: "fclass",
    },

    // ▸ Admin Boundaries ─────────────────────────────────────
    divisions: {
      label: "Divisions", emoji: "🏙️", group: "admin",
      file: "data/divisions.geojson", type: "polygon", nameProp: "NAME_2",
      style: () => ({ color: "#00bcd4", weight: 2.5, opacity: 0.9, fillColor: "#00bcd4", fillOpacity: 0.06 }),
    },
    subdivision: {
      label: "Subdivisions", emoji: "🗺️", group: "admin",
      file: "data/subdivision.geojson", type: "polygon", nameProp: "NAME_3",
      style: () => ({ color: "#ff9800", weight: 1.5, opacity: 0.85, fillColor: "#ff9800", fillOpacity: 0.05 }),
    },

    // ▸ Health Boundaries ────────────────────────────────────
    health_district: {
      label: "Health Districts", emoji: "🏥", group: "health",
      file: "data/health_district.geojson", type: "polygon", nameProp: "District_S",
      style: () => ({ color: "#e53935", weight: 2, opacity: 0.85, fillColor: "#e53935", fillOpacity: 0.07 }),
    },
    health_area: {
      label: "Health Areas", emoji: "🩺", group: "health",
      file: "data/health_area.geojson", type: "polygon", nameProp: "Nom_AS",
      style: () => ({ color: "#f06292", weight: 1, opacity: 0.8, fillColor: "#f06292", fillOpacity: 0.05 }),
    },

  };

  // ── Runtime state ───────────────────────────────────────────
  let _map = null;
  const _st    = {}; // key → { active, loaded, empty, layer }
  const _cache = {}; // key → GeoJSON features array (for search & zoom)

  function init(leafletMap) {
    _map = leafletMap;
    // Create a dedicated pane for rasters — sits between basemap (200) and vector overlays (400)
    if (!_map.getPane('rasterPane')) {
      const p = _map.createPane('rasterPane');
      p.style.zIndex = 250;
      p.style.pointerEvents = 'none';
    }
    Object.keys(DEFS).forEach(k => {
      _st[k] = { active: false, loaded: false, empty: false, layer: null };
    });
  }

  // ── GeoJSON vector loader ───────────────────────────────────
  async function _loadVector(key, def) {
    let json;
    if (_cache[key]) {
      json = { type: "FeatureCollection", features: _cache[key] };
    } else {
      const res = await fetch(def.file);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${def.file}`);
      json = await res.json();
      _cache[key] = json.features || [];
    }

    if (!json.features || !json.features.length) {
      _st[key].empty = true;
      return L.layerGroup();
    }

    if (def.type === "point") {
      // Use canvas renderer — handles tens of thousands of points efficiently
      const renderer = L.canvas({ padding: 0.5 });
      return L.geoJSON(json, {
        pointToLayer: (f, ll) => L.circleMarker(ll, {
          radius: 4, renderer,
          color: def.color, fillColor: def.color,
          fillOpacity: 0.7, weight: 1, opacity: 0.9,
        }),
        onEachFeature: _popupFn(def),
      });
    }

    return L.geoJSON(json, {
      style:         def.style,
      onEachFeature: _popupFn(def),
    });
  }

  // ── GeoTIFF raster loader (requires georaster CDN libs) ─────
  async function _loadRaster(key, def) {
    if (typeof parseGeoraster   === "undefined" ||
        typeof GeoRasterLayer   === "undefined") {
      console.warn("[ContextLayers] georaster CDN libraries not available.");
      _st[key].empty = true;
      return L.layerGroup();
    }
    const res    = await fetch(def.file);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${def.file}`);
    const buffer = await res.arrayBuffer();
    if (!buffer.byteLength) {
      console.warn(`[ContextLayers] "${key}" — placeholder file is empty. Replace with a real GeoTIFF.`);
      _st[key].empty = true;
      return L.layerGroup();
    }
    const raster = await parseGeoraster(buffer);
    // Guard: if georaster included NoData in min/max, use only finite valid range
    const rawMin = raster.mins[0];
    const rawMax = raster.maxs[0];
    const nd     = raster.noDataValue;
    const info   = {
      noDataValue: nd,
      min:   (Number.isFinite(rawMin) && rawMin !== nd) ? rawMin : 0,
      max:   (Number.isFinite(rawMax) && rawMax !== nd) ? rawMax : 1,
    };
    info.range = info.max - info.min;
    console.info(`[ContextLayers] "${key}" raster — noData:${nd}, min:${info.min}, max:${info.max}`);
    return new GeoRasterLayer({
      georaster:            raster,
      opacity:              0.75,
      pixelValuesToColorFn: ([v]) => def.colorFn(v, info),
      resolution:           256,
      pane:                 'rasterPane',
    });
  }

  // ── Popup factory ───────────────────────────────────────────
  function _popupFn(def) {
    return (f, layer) => {
      const p    = f.properties || {};
      const name = (def.nameProp && p[def.nameProp]) || p.name || p.Name || p.nom || p.label || def.label;
      const extraVal = def.extraProp ? (p[def.extraProp] || "").toString().trim() || "Unknown" : null;
      const extra = extraVal
        ? `<div class="pi-extra">${def.extraProp}: <b>${extraVal}</b></div>`
        : "";
      layer.bindPopup(
        `<div class="pi"><div class="pi-site">${def.emoji} ${name}</div>`
        + `<div class="pi-sub">${def.label}</div>${extra}</div>`,
        { className: "cpop" }
      );
    };
  }

  // ── Public: toggle a layer on / off ────────────────────────
  async function toggle(key, on) {
    const def = DEFS[key];
    const st  = _st[key];
    if (!def || !st || !_map) return;

    st.active = on;

    if (!on) {
      if (st.layer) _map.removeLayer(st.layer);
      _updateBadge(key);
      if (def.type === "raster") _updateRasterLegend();
      return;
    }

    // Lazy-load on first activation
    if (!st.loaded) {
      _setBadge(key, "⏳", "cl-badge");
      try {
        st.layer  = def.type === "raster"
          ? await _loadRaster(key, def)
          : await _loadVector(key, def);
        st.loaded = true;
      } catch (err) {
        console.warn(`[ContextLayers] Failed to load "${key}":`, err.message);
        st.empty  = true;
        st.loaded = true;
        st.layer  = L.layerGroup();
      }
    }

    if (st.active) {
      st.layer.addTo(_map);
    }
    _updateBadge(key);
    if (def.type === "raster") _updateRasterLegend();
  }

  function _updateBadge(key) {
    const st = _st[key];
    if (!st.active) { _setBadge(key, "",  "cl-badge"); return; }
    if (st.empty)   {
      _setBadge(key, "⚠", "cl-badge cl-empty",
        "No data yet — replace placeholder file");
      return;
    }
    const n = st.layer?.getLayers?.()?.length;
    _setBadge(key, n != null ? n.toLocaleString() : "✓", "cl-badge cl-ok");
  }

  function _setBadge(key, text, cls, title = "") {
    const el = document.getElementById(`cl-${key}`);
    if (!el) return;
    el.textContent = text;
    el.className   = cls;
    el.title       = title;
  }

  // ── Raster legend in the map legend panel ──────────────────
  function _updateRasterLegend() {
    const el = document.getElementById("ml-raster");
    if (!el) return;
    const active = Object.keys(DEFS).filter(
      k => DEFS[k].type === "raster" && _st[k]?.active && !_st[k]?.empty
    );
    if (!active.length) { el.innerHTML = ""; return; }
    let html = "";
    active.forEach(k => {
      const def = DEFS[k];
      html += `<div class="ml-sep"></div><div class="ml-title">${def.emoji} ${def.label}</div>`;
      if (def.gradientLegend) {
        const g    = def.gradientLegend;
        const grad = g.stops.join(", ");
        html += `<div class="ml-grad" style="background:linear-gradient(to right,${grad})"></div>`;
        html += `<div class="ml-grad-labels"><span>${g.min}</span><span>${g.max}</span></div>`;
        html += `<div class="ml-grad-unit">${g.unit}</div>`;
      } else if (def.legend) {
        html += def.legend
          .map(({color, label}) =>
            `<div class="ml-row"><div class="ml-dot" style="background:${color}"></div><span>${label}</span></div>`
          ).join("");
      }
    });
    el.innerHTML = html;
  }

  // ── Pre-fetch a layer's data for searching (without adding to map) ──
  async function preload(key) {
    const def = DEFS[key];
    if (!def || _cache[key]) return;
    try {
      const res  = await fetch(def.file);
      if (!res.ok) return;
      const json = await res.json();
      _cache[key] = json.features || [];
    } catch (e) {
      console.warn(`[ContextLayers] preload failed for "${key}":`, e.message);
    }
  }

  // ── Zoom map to a named feature ─────────────────────────────
  function zoomToFeature(key, name) {
    const def      = DEFS[key];
    const features = _cache[key] || [];
    const prop     = def?.nameProp;
    if (!prop || !_map || !name) return false;
    const n = name.toLowerCase().trim();
    const match = features.find(f =>
      (f.properties?.[prop] || "").toLowerCase() === n
    );
    if (!match) return false;
    try {
      const bounds = L.geoJSON(match).getBounds();
      if (bounds.isValid()) _map.fitBounds(bounds, { padding: [40, 40] });
      return true;
    } catch { return false; }
  }

  // ── Return matching names for autocomplete ──────────────────
  function searchFeatures(key, query) {
    const def      = DEFS[key];
    const features = _cache[key] || [];
    const prop     = def?.nameProp;
    if (!prop) return [];
    const q = (query || "").toLowerCase();
    return features
      .map(f => (f.properties?.[prop] || ""))
      .filter(n => n && (!q || n.toLowerCase().includes(q)))
      .sort();
  }

  return { init, toggle, preload, zoomToFeature, searchFeatures };
})();
