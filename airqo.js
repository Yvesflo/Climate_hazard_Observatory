// ============================================================
//  airqo.js  —  AirQo API Service
//  Fetches real-time PM2.5, PM10, NO2 per sensor site
// ============================================================

const AirQoService = (() => {

  async function _get(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`AirQo error ${res.status}`);
    return res.json();
  }

  // ── Normalize raw AirQo response to internal site format ──
  function _normalize(raw) {
    return (raw.measurements || raw.data || [])
      .map(m => ({
        id:   m.site_id   || m.device,
        name: m.site_name || m.device || "Unknown Site",
        city: _guessCity(m),
        lat:  m.location?.latitude  || m.latitude,
        lng:  m.location?.longitude || m.longitude,
        pm25: m.pm2_5?.value ?? m.pm25 ?? 0,
        pm10: m.pm10?.value  ?? m.pm10  ?? 0,
        no2:  m.no2?.value   ?? m.no2   ?? 0,
        time: m.time || m.timestamp || null,
        source: "AirQo",
      }))
      .filter(s => s.lat && s.lng && s.lat !== 0);
  }

  function _guessCity(m) {
    const name = (m.city || m.site_name || m.region || "").toLowerCase();
    if (name.includes("yaound")) return "Yaoundé";
    if (name.includes("doual"))  return "Douala";
    // fallback: classify by coordinates
    if (m.location?.latitude > 3.95) return "Douala";
    return "Yaoundé";
  }

  // ── Fetch recent measurements for Cameroon ────────────────
  async function fetchSites() {
    if (!CONFIG.USE_AIRQO) {
      console.info("[AirQoService] No token — using demo data");
      return DEMO_SITES;   // from data/demo_sites.js
    }
    try {
      const url = `${CONFIG.AIRQO_BASE}/devices/measurements/countries/CM/recent`
        + `?token=${CONFIG.AIRQO_TOKEN}`;
      const raw = await _get(url);
      const sites = _normalize(raw);
      console.info(`[AirQoService] Loaded ${sites.length} real sites`);
      return sites.length ? sites : DEMO_SITES;
    } catch (err) {
      console.warn("[AirQoService] Fetch failed, using demo data:", err.message);
      return DEMO_SITES;
    }
  }

  // ── Historical measurements for a site (time-slider) ─────
  async function fetchHistory(siteId, hours = 12) {
    if (!CONFIG.USE_AIRQO) return _demoHistory(hours);
    try {
      const url = `${CONFIG.AIRQO_BASE}/devices/measurements/sites/${siteId}/historical`
        + `?token=${CONFIG.AIRQO_TOKEN}&hours=${hours}`;
      const raw = await _get(url);
      return (raw.measurements || raw.data || []).map(m => ({
        time:  m.time || m.timestamp,
        pm25:  m.pm2_5?.value ?? m.pm25 ?? 0,
        pm10:  m.pm10?.value  ?? m.pm10  ?? 0,
        no2:   m.no2?.value   ?? m.no2   ?? 0,
      }));
    } catch (err) {
      console.warn("[AirQoService] History fetch failed:", err.message);
      return _demoHistory(hours);
    }
  }

  // ── AQI helpers ───────────────────────────────────────────
  function aqiColor(pm) {
    if (pm <= 12)    return "#00e400";
    if (pm <= 35.4)  return "#d4d400";
    if (pm <= 55.4)  return "#ff7e00";
    if (pm <= 150.4) return "#ff0000";
    if (pm <= 250.4) return "#8f3f97";
    return "#7e0023";
  }

  function aqiCategory(pm) {
    if (pm <= 12)    return { label: "Good",             color: "#00e400" };
    if (pm <= 35.4)  return { label: "Moderate",         color: "#d4d400" };
    if (pm <= 55.4)  return { label: "Unhealthy*",       color: "#ff7e00" };
    if (pm <= 150.4) return { label: "Unhealthy",        color: "#ff0000" };
    if (pm <= 250.4) return { label: "Very Unhealthy",   color: "#8f3f97" };
    return               { label: "Hazardous",           color: "#7e0023" };
  }

  function healthAdvice(pm) {
    if (pm <= 12)    return "Air quality is satisfactory. Enjoy outdoor activities.";
    if (pm <= 35.4)  return "Unusually sensitive people should reduce prolonged outdoor exertion.";
    if (pm <= 55.4)  return "Sensitive groups should limit prolonged outdoor activity.";
    if (pm <= 150.4) return "Everyone should reduce outdoor activity. Wear a mask outside.";
    if (pm <= 250.4) return "Avoid outdoor activity. Keep windows closed.";
    return "Emergency conditions. Stay indoors with air filtration.";
  }

  // ── Demo history fallback ─────────────────────────────────
  function _demoHistory(hours) {
    const factors = [1.6,1.5,1.4,1.3,1.2,1.1,1.0,0.95,1.05,1.0,1.0,1.0];
    return Array.from({ length: hours }, (_, i) => ({
      time:  `-${hours - i}h`,
      pm25:  +(60 * factors[i % factors.length] + (Math.random() - 0.5) * 8).toFixed(1),
      pm10:  +(75 * factors[i % factors.length]).toFixed(1),
      no2:   +(30 + Math.random() * 10).toFixed(1),
    }));
  }

  return { fetchSites, fetchHistory, aqiColor, aqiCategory, healthAdvice };

})();