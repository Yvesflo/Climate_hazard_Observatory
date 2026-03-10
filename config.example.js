// ============================================================
//  config.example.js  —  TEMPLATE — copy to config.js and add your tokens
//  DO NOT add real tokens to this file
// ============================================================

const CONFIG = {

  // ── 🔑 AirQo API ─────────────────────────────────────────
  // Get yours at: https://platform.airqo.net
  AIRQO_TOKEN: "YOUR_AIRQO_TOKEN_HERE",

  // ── 🔑 OpenWeatherMap API ─────────────────────────────────
  // Get yours at: https://openweathermap.org/api
  OWM_TOKEN: "YOUR_OPENWEATHERMAP_TOKEN_HERE",

  // ── App Settings ──────────────────────────────────────────
  COVERAGE_RADIUS_KM: 3,        // sensor coverage radius
  INTERP_GRID_SIZE:   40,       // interpolation grid resolution
  REFRESH_INTERVAL_MS: 300000,  // auto-refresh every 5 minutes

  // ── Cities ────────────────────────────────────────────────
  CITIES: {
    Douala:  { lat: 4.0511, lng: 9.7085 },
    Yaoundé: { lat: 3.8667, lng: 11.5167 },
  },

  // ── OWM endpoints ─────────────────────────────────────────
  OWM_ONE_CALL: "https://api.openweathermap.org/data/3.0/onecall",
  OWM_AIR_BASE: "https://api.openweathermap.org/data/2.5/air_pollution",

  // ── AirQo endpoint ────────────────────────────────────────
  AIRQO_BASE: "https://platform.airqo.net/api/v2",
};

CONFIG.USE_AIRQO = CONFIG.AIRQO_TOKEN !== "YOUR_AIRQO_TOKEN_HERE";
CONFIG.USE_OWM   = CONFIG.OWM_TOKEN   !== "YOUR_OPENWEATHERMAP_TOKEN_HERE";
