// ============================================================
//  weather.js  —  OpenWeatherMap API Service
//  Fetches via One Call API 3.0: current weather, 48 h hourly
//  forecast, 8-day daily forecast, government alerts + air
//  pollution (data/2.5 — separate endpoint)
// ============================================================

const WeatherService = (() => {

  // ── Internal fetch helper ─────────────────────────────────
  async function _get(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OWM error ${res.status}: ${url}`);
    return res.json();
  }

  // ── One Call API 3.0: current + 48 h hourly + 8-day daily + alerts ─
  async function fetchOneCall(lat, lng) {
    const url = `${CONFIG.OWM_ONE_CALL}`
      + `?lat=${lat}&lon=${lng}`
      + `&appid=${CONFIG.OWM_TOKEN}`
      + `&units=metric&exclude=minutely`;
    const d = await _get(url);
    const cur = d.current;
    return {
      current: {
        temp:     cur.temp,
        feels:    cur.feels_like,
        humidity: cur.humidity,
        pressure: cur.pressure,
        wind:     cur.wind_speed * 3.6,       // m/s → km/h
        windDir:  cur.wind_deg,
        rain:     cur.rain ? (cur.rain["1h"] || 0) : 0,
        uv:       cur.uvi,                    // UV now included in One Call
        desc:     cur.weather[0].description,
        icon:     cur.weather[0].icon,
      },
      // First 24 h of 48-hour hourly forecast
      forecast: d.hourly.slice(0, 24).map(h => ({
        time:  new Date(h.dt * 1000).toISOString().slice(0, 16).replace("T", " "),
        temp:  h.temp,
        feels: h.feels_like,
        humid: h.humidity,
        wind:  h.wind_speed * 3.6,
        rain:  h.rain ? (h.rain["1h"] || 0) : 0,
      })),
      // 8-day daily forecast
      daily: (d.daily || []).slice(0, 8).map(day => ({
        date:    new Date(day.dt * 1000).toISOString().slice(0, 10),
        tempMin: day.temp.min,
        tempMax: day.temp.max,
        rain:    day.rain || 0,
        uv:      day.uvi,
        desc:    day.weather[0].description,
        icon:    day.weather[0].icon,
      })),
      // Government / national weather service alerts (optional field)
      alerts: (d.alerts || []).map(a => ({
        event:       a.event,
        sender:      a.sender_name,
        description: a.description,
        start:       new Date(a.start * 1000).toISOString(),
        end:         new Date(a.end   * 1000).toISOString(),
      })),
    };
  }

  // ── Air pollution (still at data/2.5 — separate endpoint) ─
  async function fetchAirPollution(lat, lng) {
    const url = `${CONFIG.OWM_AIR_BASE}`
      + `?lat=${lat}&lon=${lng}`
      + `&appid=${CONFIG.OWM_TOKEN}`;
    const d = await _get(url);
    const comp = d.list[0].components;
    return {
      pm25: comp.pm2_5,
      pm10: comp.pm10,
      no2:  comp.no2,
      o3:   comp.o3,
      so2:  comp.so2,
      co:   comp.co,
      aqi:  d.list[0].main.aqi,   // OWM AQI 1–5
    };
  }

  // ── Fetch everything for one city (2 parallel calls) ──────
  async function fetchCity(cityName) {
    const { lat, lng } = CONFIG.CITIES[cityName];
    try {
      const [oneCall, pollution] = await Promise.all([
        fetchOneCall(lat, lng),
        fetchAirPollution(lat, lng),
      ]);
      return {
        city: cityName,
        lat, lng,
        ...oneCall.current,
        forecast: oneCall.forecast,
        daily:    oneCall.daily,
        alerts:   oneCall.alerts,
        pollution,
        source: "OpenWeatherMap",
        fetchedAt: new Date().toISOString(),
      };
    } catch (err) {
      console.warn(`[WeatherService] Failed for ${cityName}:`, err.message);
      return _demoWeather(cityName);
    }
  }

  // ── Fetch all configured cities ───────────────────────────
  async function fetchAll() {
    const results = {};
    for (const city of Object.keys(CONFIG.CITIES)) {
      results[city] = await fetchCity(city);
    }
    return results;
  }

  // ── Demo fallback (when token not set) ────────────────────
  // Douala : hot, very humid coastal city at sea level
  // Yaoundé: cooler inland plateau (~750 m), lower humidity
  function _demoWeather(city) {
    const isDouala = city === "Douala";
    const profile = isDouala
      ? { temp: 31, feels: 37, humidity: 87, wind: 16, windDir: 215,
          rain: 0.9, uv: 7,  pressure: 1009, desc: "hazy and humid",
          pollution: { pm25: 72, pm10: 95, no2: 38, o3: 40, so2: 12, co: 520, aqi: 4 } }
      : { temp: 25, feels: 27, humidity: 65, wind:  8, windDir: 185,
          rain: 0.1, uv: 10, pressure: 1018, desc: "partly cloudy",
          pollution: { pm25: 28, pm10: 42, no2: 18, o3: 55, so2:  5, co: 280, aqi: 2 } };

    return {
      city,
      temp:     profile.temp,
      feels:    profile.feels,
      humidity: profile.humidity,
      wind:     profile.wind,
      windDir:  profile.windDir,
      rain:     profile.rain,
      uv:       profile.uv,
      pressure: profile.pressure,
      desc:     profile.desc,
      pollution: profile.pollution,
      forecast: Array.from({ length: 24 }, (_, i) => ({
        time:  `+${i}h`,
        temp:  profile.temp  + 3 * Math.sin(i / 6),
        feels: profile.feels + 2 * Math.sin(i / 6),
        humid: profile.humidity + 8 * Math.cos(i / 8),
        wind:  profile.wind  + 5 * Math.random(),
        rain:  i > 10 && i < 16 ? profile.rain * 2 * Math.random() : 0,
      })),
      daily: Array.from({ length: 8 }, (_, i) => ({
        date:    `Day +${i+1}`,
        tempMin: profile.temp - 4 + Math.random() * 2,
        tempMax: profile.temp + 3 + Math.random() * 3,
        rain:    i === 2 || i === 5 ? profile.rain * 3 : 0,
        uv:      profile.uv,
        desc:    profile.desc,
        icon:    "02d",
      })),
      alerts: [],
      source: "Demo",
      fetchedAt: new Date().toISOString(),
    };
  }

  // ── Heat index (Steadman formula) ─────────────────────────
  function heatIndex(T, RH) {
    if (T < 27) return T;
    return -8.78469475556
      + 1.61139411 * T
      + 2.33854883889 * RH
      - 0.14611605 * T * RH
      - 0.012308094 * T * T
      - 0.0164248277778 * RH * RH
      + 0.002211732 * T * T * RH
      + 0.00072546 * T * RH * RH
      - 0.000003582 * T * T * RH * RH;
  }

  return { fetchAll, fetchCity, heatIndex };

})();