// ============================================================
//  map.js  —  Main App Controller + Leaflet Map Logic
// ============================================================

const App = (() => {

  // ── State ─────────────────────────────────────────────────
  let state = {
    sites:       [],
    weather:     {},
    cityFilter:  "all",
    hazardMode:  "aqi",
    interpMode:  "none",
    basemap:     "dark",
    corrView:    "trend",
    layerVis:    { cov: false, gap: false, wind: false },
    zoneNav:     { cat: "admin", layer: "divisions" },
  };

  // ── Leaflet layer groups ──────────────────────────────────
  let map, LG = {}, baseLayers = {};


  // ── Hazard color helpers ──────────────────────────────────
  const H = {
    temp:  t => t<20?"#00aaff":t<28?"#00e4a0":t<33?"#ffcc00":t<38?"#ff7700":"#ff2200",
    uv:    u => u<3?"#00e400":u<6?"#ffee00":u<8?"#ff7700":u<11?"#ff0000":"#8f3f97",
    wind:  w => w<10?"#00e400":w<25?"#ffee00":w<40?"#ff7700":"#ff2200",
    rain:  r => r<1?"#aaddff":r<5?"#3388ff":r<20?"#0022ff":"#6600cc",
    humid: h => h<40?"#ffee00":h<60?"#00e400":h<80?"#00aaff":"#0044ff",
    risk:  r => r<25?"#00e400":r<50?"#ffcc00":r<75?"#ff7700":"#ff1111",
    uvCat: u => u<3?"Low":u<6?"Moderate":u<8?"High":u<11?"Very High":"Extreme",
    riskLabel: r => r<25?"Low":r<50?"Moderate":r<75?"High Risk":"Critical",
  };

  function compositeRisk(site, wx) {
    const pm   = site._pm || site.pm25;
    const aqS  = Math.min(pm / 250 * 40, 40);
    const tS   = wx ? Math.min(Math.max(wx.temp - 28, 0) / 12 * 20, 20) : 0;
    const uvS  = wx ? Math.min(wx.uv / 11 * 20, 20)  : 0;
    const huS  = wx ? Math.min(Math.max(wx.humidity - 70, 0) / 30 * 10, 10) : 0;
    const rnS  = wx ? Math.min(wx.rain / 20 * 10, 10) : 0;
    return Math.min(100, aqS + tS + uvS + huS + rnS);
  }

  function hazardVal(site, wx, mode) {
    const pm = site._pm || site.pm25;
    const { aqiColor, aqiCategory } = AirQoService;
    if (mode === "aqi")       return { v: pm,          c: aqiColor(pm),           lbl: pm.toFixed(0)          };
    if (!wx)                  return { v: 0,            c: "#888",                 lbl: "—"                    };
    if (mode === "temp")      return { v: wx.temp,      c: H.temp(wx.temp),        lbl: wx.temp.toFixed(1)+"°" };
    if (mode === "uv")        return { v: wx.uv,        c: H.uv(wx.uv),            lbl: wx.uv.toFixed(1)       };
    if (mode === "wind")      return { v: wx.wind,      c: H.wind(wx.wind),        lbl: wx.wind.toFixed(0)     };
    if (mode === "rain")      return { v: wx.rain,      c: H.rain(wx.rain),        lbl: wx.rain.toFixed(1)     };
    if (mode === "humid")     return { v: wx.humidity,  c: H.humid(wx.humidity),   lbl: wx.humidity+"%" };
    if (mode === "composite") { const r=compositeRisk(site,wx); return {v:r, c:H.risk(r), lbl:r.toFixed(0)}; }
    return { v: 0, c: "#888", lbl: "—" };
  }

  // ── Basemap tile definitions ──────────────────────────────
  const BASEMAPS = {
    dark: {
      url:   "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      attr:  '&copy; <a href="https://carto.com">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
      opts:  { maxZoom: 19, subdomains: "abcd" },
    },
    osm: {
      url:   "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      attr:  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      opts:  { maxZoom: 19 },
    },
    satellite: {
      url:   "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attr:  'Tiles &copy; Esri &mdash; Source: Esri, USGS, NOAA',
      opts:  { maxZoom: 19 },
    },
  };

  // ── Init Leaflet map ──────────────────────────────────────
  function initMap() {
    map = L.map("map", { zoomControl: true, attributionControl: false })
           .setView([4.0, 10.6], 7);

    // Build all base layers; add the default one
    Object.entries(BASEMAPS).forEach(([key, bm]) => {
      baseLayers[key] = L.tileLayer(bm.url, { ...bm.opts, attribution: bm.attr });
    });
    baseLayers[state.basemap].addTo(map);

    L.control.attribution({ prefix:
      '<a href="https://airqo.net">AirQo</a> · ' +
      '<a href="https://openweathermap.org">OWM</a>'
    }).addTo(map);

    // Coordinates readout on mouse move
    map.on("mousemove", e => {
      const el = document.getElementById("map-coords");
      if (el) el.textContent = `${e.latlng.lat.toFixed(4)}°N  ${e.latlng.lng.toFixed(4)}°E`;
    });
    map.on("mouseout", () => {
      const el = document.getElementById("map-coords");
      if (el) el.textContent = "Hover map for coordinates";
    });

    const groups = ["markers","interp","cov","gap","wind"];
    groups.forEach(g => { LG[g] = L.layerGroup(); });
    // Only markers are on by default; overlays start hidden
    LG.markers.addTo(map);
    LG.interp.addTo(map);
    ContextLayers.init(map);
    // Pre-fetch boundary data for the zone navigator
    ["divisions","subdivision","health_district","health_area"].forEach(k =>
      ContextLayers.preload(k)
    );
  }

  // ── Render all layers ─────────────────────────────────────
  function render() {
    const sites = activeSites();
    sites.forEach(s => {
      const wx = state.weather[s.city];
      s._pm  = s.pm25;
      s._hv  = hazardVal(s, wx, state.hazardMode).v;
    });

    ["markers","interp","cov","gap","wind"].forEach(g => LG[g].clearLayers());

    // Interpolation surface
    const iLayer = Interpolation.build(sites, state.hazardMode, state.interpMode, hazardValToColor);
    if (iLayer) LG.interp.addLayer(iLayer);

    // Coverage circles + gaps
    renderCoverage(sites);

    // Sensor markers
    renderMarkers(sites);

    // Wind arrows
    renderWind(sites);

    // Sidebar
    updateStats(sites);
    buildSiteList(sites);
    updateWxStrip();
    updateLegend();
    Charts.draw(state.corrView, activeSites(), state.weather, state.cityFilter);
  }

  function activeSites() {
    return state.sites.filter(s =>
      state.cityFilter === "all" || s.city === state.cityFilter
    );
  }

  function hazardValToColor(v, mode) {
    const hex = h => ({ r: parseInt(h.slice(1,3),16), g: parseInt(h.slice(3,5),16), b: parseInt(h.slice(5,7),16) });
    if (mode === "aqi")       return hex(AirQoService.aqiColor(v));
    if (mode === "temp")      return hex(H.temp(v));
    if (mode === "uv")        return hex(H.uv(v));
    if (mode === "wind")      return hex(H.wind(v));
    if (mode === "rain")      return hex(H.rain(v));
    if (mode === "humid")     return hex(H.humid(v));
    if (mode === "composite") return hex(H.risk(v));
    return { r:128, g:128, b:128 };
  }

  function renderCoverage(sites) {
    sites.forEach(s => {
      const hv = hazardVal(s, state.weather[s.city], state.hazardMode);
      LG.cov.addLayer(L.circle([s.lat, s.lng], {
        radius: CONFIG.COVERAGE_RADIUS_KM * 1000,
        color: hv.c, fillColor: hv.c,
        fillOpacity: 0.06, weight: 1.5,
        dashArray: "4 4", opacity: 0.6,
      }));
    });
    const gaps = Interpolation.findGaps(sites, CONFIG.COVERAGE_RADIUS_KM);
    gaps.forEach(g => {
      const ic = L.divIcon({ className:"", iconSize:[26,26], iconAnchor:[13,13],
        html:`<div style="width:26px;height:26px;border-radius:50%;background:#ff4d0018;border:2px dashed #ff6020;display:flex;align-items:center;justify-content:center;font-size:12px;">➕</div>`
      });
      LG.gap.addLayer(L.marker(g, { icon: ic })
        .bindPopup(`<div class="pi"><b>⚠️ Coverage Gap</b><br><small>Optimal sensor placement: furthest point from all existing sensors.<br>A new sensor here would cover uncovered area with minimal overlap with neighbours.</small><br><code>${g[0].toFixed(4)}, ${g[1].toFixed(4)}</code></div>`,
          { className: "cpop" }));
    });
  }

  function renderMarkers(sites) {
    let totalPM = 0, hotCount = 0, highRisk = 0;
    sites.forEach(s => {
      const wx   = state.weather[s.city];
      const hv   = hazardVal(s, wx, state.hazardMode);
      const risk = compositeRisk(s, wx);
      const { label: aqCat, color: aqCol } = AirQoService.aqiCategory(s.pm25);
      totalPM += s.pm25;
      if (s.pm25 > 55) hotCount++;
      if (risk  > 60)  highRisk++;

      const ic = L.divIcon({ className:"", iconSize:[36,36], iconAnchor:[18,18],
        html:`<div style="width:36px;height:36px;border-radius:50%;background:${hv.c};border:3px solid rgba(255,255,255,.8);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;color:#000;box-shadow:0 0 14px ${hv.c}99;">${hv.lbl}</div>`
      });

      const wx2 = wx || {};
      const popup = `
        <div class="pi">
          <div class="pi-site">📍 ${s.name}</div>
          <div class="pi-sub">${s.city} · <b style="color:${H.risk(risk)}">${H.riskLabel(risk)} Risk (${risk.toFixed(0)})</b></div>
          <div class="hazard-grid">
            <div class="hg-card"><div class="hg-icon">🌫️</div><div class="hg-val" style="color:${aqCol}">${s.pm25.toFixed(0)}</div><div class="hg-lbl">PM2.5</div></div>
            <div class="hg-card"><div class="hg-icon">🌡️</div><div class="hg-val">${wx2.temp ? wx2.temp.toFixed(1)+"°" : "—"}</div><div class="hg-lbl">Temp °C</div></div>
            <div class="hg-card"><div class="hg-icon">☀️</div><div class="hg-val" style="color:${H.uv(wx2.uv||0)}">${wx2.uv ? wx2.uv.toFixed(1) : "—"}</div><div class="hg-lbl">UV</div></div>
            <div class="hg-card"><div class="hg-icon">💧</div><div class="hg-val">${wx2.humidity ? wx2.humidity+"%" : "—"}</div><div class="hg-lbl">Humidity</div></div>
            <div class="hg-card"><div class="hg-icon">💨</div><div class="hg-val">${wx2.wind ? wx2.wind.toFixed(0) : "—"}</div><div class="hg-lbl">Wind km/h</div></div>
            <div class="hg-card"><div class="hg-icon">🌧️</div><div class="hg-val">${wx2.rain ? wx2.rain.toFixed(1) : "—"}</div><div class="hg-lbl">Rain mm</div></div>
          </div>
          <div class="risk-bars">
            ${riskBar("AQ",    Math.min(s.pm25/250*100,100), aqCol)}
            ${riskBar("Heat",  wx2.temp>28 ? Math.min((wx2.temp-28)/12*100,100) : 0, H.temp(wx2.temp||28))}
            ${riskBar("UV",    wx2.uv ? wx2.uv/11*100 : 0, H.uv(wx2.uv||0))}
            ${riskBar("Composite", risk, H.risk(risk))}
          </div>
          <div class="health-tip">${AirQoService.healthAdvice(s.pm25)}</div>
        </div>`;

      LG.markers.addLayer(L.marker([s.lat, s.lng], { icon: ic })
        .bindPopup(popup, { className:"cpop", maxWidth: 290 }));
    });

    // Stats
    const n = sites.length;
    document.getElementById("st-sites").textContent = n;
    document.getElementById("st-avg").textContent   = n ? (totalPM/n).toFixed(0) : "—";
    document.getElementById("st-hot").textContent   = hotCount;
    document.getElementById("st-risk").textContent  = highRisk;
  }

  function riskBar(lbl, pct, col) {
    return `<div class="risk-row">
      <span class="risk-lbl">${lbl}</span>
      <div class="risk-track"><div class="risk-fill" style="width:${pct.toFixed(0)}%;background:${col}"></div></div>
      <span class="risk-pct">${pct.toFixed(0)}%</span>
    </div>`;
  }

  function renderWind(sites) {
    sites.forEach(s => {
      const wx = state.weather[s.city];
      if (!wx) return;
      const ic = L.divIcon({ className:"", iconSize:[20,20], iconAnchor:[10,10],
        html:`<div style="transform:rotate(${wx.windDir}deg);font-size:${10+wx.wind/5}px;opacity:.8">➤</div>`
      });
      LG.wind.addLayer(L.marker([s.lat, s.lng], { icon: ic, interactive: false }));
    });
  }


  function buildSiteList(sites) {
    const el       = document.getElementById("site-list");
    const filtered = [...sites]
      .sort((a,b) => compositeRisk(b, state.weather[b.city]) - compositeRisk(a, state.weather[a.city]));

    const cnt = document.getElementById("site-count");
    if (cnt) cnt.textContent = `(${filtered.length})`;

    el.innerHTML = "";
    if (!filtered.length) {
      el.innerHTML = `<div style="padding:14px 12px;color:#4a88aa;font-size:11px;">— No active sites</div>`;
      return;
    }
    filtered.forEach(s => {
        const hv   = hazardVal(s, state.weather[s.city], state.hazardMode);
        const risk = compositeRisk(s, state.weather[s.city]);
        const d = document.createElement("div");
        d.className = "si";
        d.title = `Click to zoom to ${s.name}`;
        d.innerHTML = `
          <div class="si-b" style="background:${hv.c}22;border:1px solid ${hv.c}55;color:${hv.c}">${hv.lbl}</div>
          <div class="si-info">
            <div class="si-n">${s.name}</div>
            <div class="si-m">${s.city} · <span style="color:${H.risk(risk)}">${H.riskLabel(risk)}</span></div>
          </div>
          <div class="si-arrow">›</div>`;
        d.onclick = () => { map.setView([s.lat, s.lng], 15); };
        el.appendChild(d);
      });
  }

  function updateWxStrip() {
    const city = state.cityFilter === "all" ? "Douala" : state.cityFilter;
    document.getElementById("wx-city-lbl").textContent = city;
    const wx = state.weather[city];
    if (!wx) return;

    const hi = WeatherService.heatIndex(wx.temp, wx.humidity);

    document.getElementById("wx-temp").textContent  = wx.temp.toFixed(1)+"°";
    document.getElementById("wx-feel").textContent  = wx.feels.toFixed(1)+"°";
    document.getElementById("wx-uv").textContent    = wx.uv.toFixed(1)+" ("+H.uvCat(wx.uv)+")";
    document.getElementById("wx-hum").textContent   = wx.humidity+"%";
    document.getElementById("wx-wind").textContent  = wx.wind.toFixed(0);
    document.getElementById("wx-rain").textContent  = wx.rain.toFixed(1);
    document.getElementById("wx-pres").textContent  = wx.pressure ? wx.pressure+" hPa" : "—";
    document.getElementById("wx-hi").textContent    = hi.toFixed(1)+"°";
    document.getElementById("wx-hi").style.color    = H.temp(hi);
    document.getElementById("wx-desc").textContent  = wx.desc || "—";
    if (wx.icon) {
      document.getElementById("wx-icon").innerHTML =
        `<img src="https://openweathermap.org/img/wn/${wx.icon}.png" style="width:28px;height:28px;" alt="${wx.desc||''}" />`;
    }
    document.getElementById("wx-uv").style.color    = H.uv(wx.uv);
    document.getElementById("wx-temp").style.color  = H.temp(wx.temp);

    // Last updated
    const lu = document.getElementById("last-updated");
    if (lu && wx.fetchedAt) {
      const t = new Date(wx.fetchedAt);
      lu.textContent = "Last updated: " + t.toUTCString().replace(/ GMT$/," UTC");
    }

    const alertsEl = document.getElementById("wx-alerts");
    if (alertsEl) {
      if (wx.alerts && wx.alerts.length) {
        alertsEl.innerHTML = wx.alerts.map(a =>
          `<div class="wx-alert">⚠️ <b>${a.event}</b> · <span class="wx-alert-src">${a.sender}</span><br>`
          + `<small>${a.description.slice(0, 160)}${a.description.length > 160 ? "…" : ""}</small></div>`
        ).join("");
        alertsEl.style.display = "";
      } else {
        alertsEl.innerHTML = "";
        alertsEl.style.display = "none";
      }
    }
  }

  function updateStats(sites) { /* handled in renderMarkers */ }

  const LEGEND_STOPS = {
    aqi:       [["#00e400","0–12"],["#d4d400","12–35"],["#ff7e00","35–55"],["#ff0000","55–150"],["#8f3f97","150+"]],
    temp:      [["#00aaff","<20°"],["#00e4a0","20–28°"],["#ffcc00","28–33°"],["#ff7700","33–38°"],["#ff2200","38°+"]],
    uv:        [["#00e400","Low"],["#ffee00","Mod"],["#ff7700","High"],["#ff0000","VHigh"],["#8f3f97","Extreme"]],
    wind:      [["#00e400","<10"],["#ffee00","10–25"],["#ff7700","25–40"],["#ff2200","40+"]],
    rain:      [["#aaddff","0–1mm"],["#3388ff","1–5mm"],["#0022ff","5–20mm"],["#6600cc","20mm+"]],
    humid:     [["#ffee00","<40%"],["#00e400","40–60%"],["#00aaff","60–80%"],["#0044ff","80%+"]],
    composite: [["#00e400","Low"],["#ffcc00","Moderate"],["#ff7700","High"],["#ff1111","Critical"]],
  };
  function updateLegend() {
    const lg = document.getElementById("map-legend");
    const titles = {
      aqi:"AQI (PM2.5 µg/m³)", temp:"Temperature °C", uv:"UV Index",
      wind:"Wind km/h", rain:"Rain mm/h", humid:"Humidity %", composite:"Risk Score"
    };
    const title = document.getElementById("ml-title");
    if (title) title.textContent = titles[state.hazardMode] || "Legend";
    const rows = (LEGEND_STOPS[state.hazardMode]||[])
      .map(([c,l])=>`<div class="ml-row"><div class="ml-dot" style="background:${c}"></div><span>${l}</span></div>`)
      .join("");
    // Replace everything after the title
    lg.innerHTML = `<div class="ml-title">${titles[state.hazardMode]||"Legend"}</div>${rows}`;
  }
  // ── Zone Navigator ─────────────────────────────────────────
  function setZoneCat(cat, btn) {
    state.zoneNav.cat = cat;
    document.querySelectorAll(".zone-cat").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const sel = document.getElementById("zone-layer");
    sel.innerHTML = cat === "admin"
      ? "<option value='divisions'>Divisions</option>"
        + "<option value='subdivision'>Subdivisions</option>"
      : "<option value='health_district'>Health Districts</option>"
        + "<option value='health_area'>Health Areas</option>";
    state.zoneNav.layer = sel.value;
    const inp = document.getElementById("zone-search");
    if (inp) inp.value = "";
    _refreshZoneSuggestions("");
    const res = document.getElementById("zone-result");
    if (res) { res.textContent = ""; res.className = "zone-result"; }
  }

  function setZoneLayer(val) {
    state.zoneNav.layer = val;
    const inp = document.getElementById("zone-search");
    if (inp) inp.value = "";
    _refreshZoneSuggestions("");
    const res = document.getElementById("zone-result");
    if (res) { res.textContent = ""; res.className = "zone-result"; }
  }

  function searchZone(query) {
    _refreshZoneSuggestions(query);
    const res = document.getElementById("zone-result");
    if (!query.trim()) {
      if (res) { res.textContent = ""; res.className = "zone-result"; }
      return;
    }
    const found = ContextLayers.zoomToFeature(state.zoneNav.layer, query.trim());
    if (res) {
      res.textContent = found ? `✔ Zoomed to ${query.trim()}` : `✗ "${query.trim()}" not found`;
      res.className   = "zone-result " + (found ? "found" : "miss");
    }
  }

  function _refreshZoneSuggestions(q) {
    const names = ContextLayers.searchFeatures(state.zoneNav.layer, q);
    const dl = document.getElementById("zone-suggestions");
    if (dl) dl.innerHTML = names.slice(0, 40)
      .map(n => `<option value="${n.replace(/"/g, '&quot;')}"/>`).join("");
  }
  // ── Public controls ───────────────────────────────────────
  function filterCity(city, btn) {
    state.cityFilter = city;
    document.querySelectorAll(".city-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    if (city==="Douala")  map.setView([4.055, 9.72],   12);
    else if (city==="Yaoundé") map.setView([3.865, 11.515], 12);
    else map.setView([4.0, 10.6], 7);
    render();
  }

  function setHazard(h, btn) {
    state.hazardMode = h;
    document.querySelectorAll(".htab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const descs = {
      aqi:"Air Quality Index — PM2.5 µg/m³", temp:"Heat Index — Temperature & feels-like",
      uv:"UV Index — solar radiation", wind:"Wind Speed km/h & direction",
      rain:"Precipitation mm/hour", humid:"Relative Humidity %",
      composite:"⚠️ Composite Environmental Risk Score",
    };
    document.getElementById("hazard-desc").textContent = descs[h];
    render();
  }

  function setBasemap(key, btn) {
    if (key === state.basemap) return;
    map.removeLayer(baseLayers[state.basemap]);
    state.basemap = key;
    baseLayers[key].addTo(map);
    baseLayers[key].bringToBack();
    document.querySelectorAll("#bm-dark,#bm-osm,#bm-satellite").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  }

  function setInterp(m) {
    state.interpMode = m;
    document.querySelectorAll(".ibtn:not([id^='bm-'])").forEach(b => b.classList.remove("active"));
    document.getElementById("btn-"+m).classList.add("active");
    render();
  }

  function toggleLayer(k, on) {
    state.layerVis[k] = on;
    on ? LG[k].addTo(map) : map.removeLayer(LG[k]);
  }

  function filterSites(q) {} // no-op: zone navigator replaced site search

  function setCorrView(v, btn) {
    state.corrView = v;
    document.querySelectorAll(".cp-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    Charts.draw(v, activeSites(), state.weather, state.cityFilter);
  }

  let _panelOpen = true;

  function togglePanel() {
    _panelOpen = !_panelOpen;
    const body   = document.getElementById("cp-body");
    const toggle = document.getElementById("cp-toggle");
    const panel  = document.getElementById("corr-panel");
    if (_panelOpen) {
      body.style.display   = "";
      panel.style.height   = "175px";
      toggle.textContent   = "▼";
    } else {
      body.style.display   = "none";
      panel.style.height   = "36px";
      toggle.textContent   = "▲";
    }
    setTimeout(() => map.invalidateSize(), 300);
  }

  function openAbout() {
    document.getElementById("about-modal").style.display = "flex";
  }
  function closeAbout(e) {
    if (!e || e.target === document.getElementById("about-modal")) {
      document.getElementById("about-modal").style.display = "none";
    }
  }

  async function manualRefresh() {
    const btn = document.getElementById("btn-refresh");
    if (btn) { btn.textContent = "⟳ Refreshing…"; btn.disabled = true; }
    try {
      state.weather = await WeatherService.fetchAll();
      state.sites   = await AirQoService.fetchSites();
      render();
    } finally {
      if (btn) { btn.textContent = "⟳ Refresh"; btn.disabled = false; }
    }
  }

  // ── Init ──────────────────────────────────────────────────
  async function init() {
    const msg = document.getElementById("loader-msg");

    // Update API badges
    document.getElementById("badge-aq").textContent = CONFIG.USE_AIRQO ? "⬤ AirQo LIVE" : "⬤ AirQo DEMO";
    document.getElementById("badge-wx").textContent = CONFIG.USE_OWM   ? "⬤ OWM LIVE"   : "⬤ OWM DEMO";
    document.getElementById("badge-aq").style.color = CONFIG.USE_AIRQO ? "#00e98a" : "#ff9944";
    document.getElementById("badge-wx").style.color = CONFIG.USE_OWM   ? "#60aaff" : "#ff9944";

    initMap();

    msg.textContent = "Fetching weather data…";
    state.weather = await WeatherService.fetchAll();

    msg.textContent = "Fetching AirQo sensor data…";
    state.sites = await AirQoService.fetchSites();

    render();
    document.getElementById("loader").style.display = "none";
    setTimeout(() => Charts.draw(state.corrView, activeSites(), state.weather, state.cityFilter), 200);

    // Clock
    setInterval(() => {
      document.getElementById("clk").textContent =
        new Date().toUTCString().split(" ")[4] + " UTC";
    }, 1000);

    // Auto-refresh
    setInterval(async () => {
      state.weather = await WeatherService.fetchAll();
      state.sites   = await AirQoService.fetchSites();
      render();
    }, CONFIG.REFRESH_INTERVAL_MS);

    window.addEventListener("resize", () =>
      Charts.draw(state.corrView, activeSites(), state.weather, state.cityFilter));
  }

  return { init, filterCity, setHazard, setBasemap, setInterp, toggleLayer, setCorrView,
           togglePanel, openAbout, closeAbout, filterSites, manualRefresh,
           setZoneCat, setZoneLayer, searchZone };

})();