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

  // ══════════════════════════════════════════════════════════
  //  RASTER 1 — Population Density (WorldPop, people/km²)
  //  Type: CONTINUOUS — uses a smooth colour ramp (YlOrRd).
  //  Each pixel value is a real number; colour interpolated.
  // ══════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════
  //  RASTER 2 — Land Cover (Copernicus CGLS-LC100 v3, 100m)
  //  Type: DISCRETE / CATEGORICAL — each integer class code
  //  gets its own fixed colour from the official Copernicus
  //  colour table. No gradients, no interpolation.
  //  Class codes: 20 Shrubs · 30 Herb. · 40 Cropland ·
  //  50 Built-up · 60 Bare · 80 Water · 90 Wetland ·
  //  95 Mangroves · 100 Moss · 111-116 Closed forest ·
  //  121-126 Open forest · 200 Ocean
  // ══════════════════════════════════════════════════════════
  // Official Copernicus CGLS-LC100 colour table (RGB hex)
  const CGLS_COLORS = {
    20:  "#ffbb22",  // Shrubs
    30:  "#ffff4c",  // Herbaceous vegetation
    40:  "#f096ff",  // Cropland
    50:  "#fa0000",  // Built-up
    60:  "#b4b4b4",  // Bare / sparse vegetation
    70:  "#f0f0f0",  // Snow and ice
    80:  "#0032c8",  // Permanent water bodies
    90:  "#0096a0",  // Herbaceous wetland
    95:  "#00cf75",  // Mangroves
    100: "#fae6a0",  // Moss and lichen
    // Closed forest sub-classes (111-116) → dark green family
    111: "#003200", 112: "#005000", 113: "#006e00",
    114: "#005000", 115: "#003c00", 116: "#003200",
    // Open forest sub-classes (121-126) → medium green family
    121: "#72d882", 122: "#54af72", 123: "#72d882",
    124: "#54af72", 125: "#63bf72", 126: "#5aad72",
    200: "#003eb2",  // Ocean / Sea
  };

  // ── Layer registry ──────────────────────────────────────────
  const DEFS = {

    // ─────────────────────────────────────────────────────────
    //  CONTINUOUS raster — Population Density (people / km²)
    //  Colour ramp: YlOrRd  (light yellow → orange → dark red)
    //  A pixel value of e.g. 347.2 is interpolated along the
    //  ramp between the raster's actual min/max.
    // ─────────────────────────────────────────────────────────
    popdens: {
      label: "Population Density", emoji: "👥", group: "raster",
      file: "data/population_density.tif", type: "raster",
      colorFn(v, info) {
        if (v == null || Number.isNaN(v) || v === info.noDataValue || v < 0) return null;
        const lo = Math.max(info.min, 0);
        const t  = Math.min((v - lo) / ((info.max - lo) + 1e-6), 1);
        // YlOrRd 3-stop: yellow → orange → dark crimson
        if (t < 0.5) {
          const s = t * 2;                               // 0→1 in first half
          return `rgba(255,${Math.round(255 - 127 * s)},0,0.78)`;  // #ffff00 → #ff8000
        } else {
          const s = (t - 0.5) * 2;                      // 0→1 in second half
          return `rgba(${Math.round(255 - 60 * s)},${Math.round(128 - 128 * s)},0,0.82)`; // #ff8000 → #c30000
        }
      },
      gradientLegend: {
        stops: ["rgba(255,255,0,.90)", "rgba(255,128,0,.90)", "rgba(195,0,0,.90)"],
        min: "Low", max: "High", unit: "people / km²",
      },
    },

    // ─────────────────────────────────────────────────────────
    //  DISCRETE raster — Land Cover CGLS-LC100
    //  Each pixel holds an integer class code.
    //  Only Math.round() is used — NO gradient, NO ramp.
    //  Colours come directly from the official Copernicus table.
    // ─────────────────────────────────────────────────────────
    landcover: {
      label: "Land Cover", emoji: "🌿", group: "raster",
      file: "data/landcover.tif", type: "raster",
      colorFn(v, info) {
        if (v == null || Number.isNaN(v) || v === info.noDataValue) return null;
        // Round to integer: resampling may produce e.g. 49.7 instead of 50
        const cls = Math.round(v);
        if (cls <= 0) return null;
        const hex = CGLS_COLORS[cls];
        if (!hex) return null;
        // Convert hex to rgba with 0.82 opacity
        const r = parseInt(hex.slice(1,3), 16);
        const g = parseInt(hex.slice(3,5), 16);
        const b = parseInt(hex.slice(5,7), 16);
        return `rgba(${r},${g},${b},0.82)`;
      },
      // Discrete legend — one swatch per class
      legend: [
        { color: "#fa0000", label: "Built-up" },
        { color: "#f096ff", label: "Cropland" },
        { color: "#ffff4c", label: "Herbaceous veg." },
        { color: "#ffbb22", label: "Shrubs" },
        { color: "#003200", label: "Closed forest" },
        { color: "#72d882", label: "Open forest" },
        { color: "#0032c8", label: "Water bodies" },
        { color: "#b4b4b4", label: "Bare / sparse veg." },
        { color: "#0096a0", label: "Herbaceous wetland" },
        { color: "#003eb2", label: "Ocean / Sea" },
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
    // Diagnostic: sample a few pixel values to help verify correct dataset
    const sampleVals = (raster.values[0] || []).flat().filter(x => x != null && x !== nd).slice(0, 8);
    console.info(`[ContextLayers] “${key}” — noData:${nd}, min:${info.min.toFixed(1)}, max:${info.max.toFixed(1)}, sample values:`, sampleVals);
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
