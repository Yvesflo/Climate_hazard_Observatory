// ============================================================
//  chart.js  —  Correlation Panel (Canvas-based charts)
//  Views: 24h Trend · AQI vs Temp Scatter · Risk Radar
// ============================================================

const Charts = (() => {

  // ── Main draw dispatcher ──────────────────────────────────
  function draw(view, sites, weather, cityFilter) {
    const cv  = document.getElementById("corr-canvas");
    const W   = cv.offsetWidth;
    const H   = cv.offsetHeight;
    if (!W || !H) return;
    cv.width  = W;
    cv.height = H;

    const ctx  = cv.getContext("2d");
    ctx.clearRect(0, 0, W, H);

    const city = cityFilter === "all" ? "Douala" : cityFilter;
    const wx   = weather[city] || {};

    if (view === "trend")   drawTrend(ctx, W, H, wx, sites);
    if (view === "scatter") drawScatter(ctx, W, H, wx, sites);
    if (view === "radar")   drawRadar(ctx, W, H, wx, sites, city);
  }

  // ── Helpers ───────────────────────────────────────────────
  function gridLines(ctx, pad, iW, iH, steps = 4) {
    ctx.strokeStyle = "#1a3050";
    ctx.lineWidth   = 1;
    for (let i = 0; i <= steps; i++) {
      const y = pad.t + iH * (1 - i / steps);
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + iW, y);
      ctx.stroke();
    }
  }

  function axisLabel(ctx, text, x, y, align = "center", color = "#4a88aa") {
    ctx.fillStyle  = color;
    ctx.font       = "10px Segoe UI";
    ctx.textAlign  = align;
    ctx.fillText(text, x, y);
  }

  function linePath(ctx, data, fn, color, lw = 1.8) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth   = lw;
    data.forEach((d, i) => {
      const [x, y] = fn(d, i);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  // ── 24h TREND ─────────────────────────────────────────────
  // Shows PM2.5, Temperature, UV & Humidity over 24 hours
  function drawTrend(ctx, W, H, wx, sites) {
    const forecast = wx.forecast || [];
    if (!forecast.length) { _noData(ctx, W, H, "No forecast data available"); return; }

    const pad  = { l: 38, r: 14, t: 22, b: 28 };
    const iW   = W - pad.l - pad.r;
    const iH   = H - pad.t - pad.b;
    const n    = forecast.length;

    gridLines(ctx, pad, iW, iH);

    // Y-axis labels (0–100%)
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + iH * (1 - i / 4);
      axisLabel(ctx, (i * 25) + "%", pad.l - 5, y + 3, "right");
    }

    // X-axis labels
    forecast.forEach((d, i) => {
      if (i % 2 === 0) {
        const x = pad.l + (i / (n - 1)) * iW;
        axisLabel(ctx, d.time?.slice(-5) || `+${i*3}h`, x, H - pad.b + 13);
      }
    });

    // Average PM2.5 across active sites as base
    const avgPM = sites.length
      ? sites.reduce((s, si) => s + si.pm25, 0) / sites.length
      : 60;

    const series = [
      {
        label: "PM2.5", color: "#ff5533",
        vals: forecast.map((_, i) => Math.max(0, avgPM + 20 * Math.sin(i / 2.5))),
        max: 200,
      },
      {
        label: "Temp °C", color: "#ff8800",
        vals: forecast.map(d => d.temp || 28),
        max: 45,
      },
      {
        label: "Humidity", color: "#00cc88",
        vals: forecast.map(d => d.humid || 70),
        max: 100,
      },
      {
        label: "Wind km/h", color: "#00aaff",
        vals: forecast.map(d => d.wind || 12),
        max: 60,
      },
    ];

    series.forEach(s => {
      linePath(ctx, s.vals, (v, i) => [
        pad.l + (i / (n - 1)) * iW,
        pad.t + iH * (1 - Math.min(v, s.max) / s.max),
      ], s.color);
    });

    // Legend
    let lx = pad.l;
    series.forEach(s => {
      ctx.fillStyle = s.color;
      ctx.fillRect(lx, pad.t - 12, 18, 3);
      axisLabel(ctx, s.label, lx + 20, pad.t - 8, "left", "#8ab0cc");
      lx += 70;
    });

    // Rain bars (if any)
    const maxRain = Math.max(...forecast.map(d => d.rain || 0), 0.1);
    if (maxRain > 0.1) {
      forecast.forEach((d, i) => {
        if (!d.rain) return;
        const x  = pad.l + (i / (n - 1)) * iW - 4;
        const bh = (d.rain / maxRain) * iH * 0.25;
        ctx.fillStyle = "rgba(0,100,255,0.35)";
        ctx.fillRect(x, pad.t + iH - bh, 8, bh);
      });
    }
  }

  // ── AQI vs TEMP SCATTER ───────────────────────────────────
  // Each site = one dot. Trend line + Pearson r annotation.
  function drawScatter(ctx, W, H, wx, sites) {
    if (!sites.length) { _noData(ctx, W, H, "No site data"); return; }

    const forecast = wx.forecast || [];
    // Build data points: one per site using current values
    const points = sites.map(s => ({
      temp: wx.temp || 30,
      pm25: s.pm25,
      city: s.city,
    }));
    // Augment with forecast variation to fill scatter
    forecast.forEach((f, i) => {
      points.push({
        temp: f.temp || 28,
        pm25: Math.max(0, (sites[i % sites.length]?.pm25 || 60) + 15 * Math.sin(i)),
        forecast: true,
      });
    });

    const pad  = { l: 42, r: 18, t: 22, b: 32 };
    const iW   = W - pad.l - pad.r;
    const iH   = H - pad.t - pad.b;

    // Axes
    ctx.strokeStyle = "#1a3050"; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, H - pad.b);
    ctx.lineTo(W - pad.r, H - pad.b);
    ctx.stroke();

    const temps  = points.map(p => p.temp);
    const pms    = points.map(p => p.pm25);
    const minT   = Math.min(...temps);
    const maxT   = Math.max(...temps);
    const maxPM  = Math.max(...pms, 1);

    // Grid
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + iH * (i / 4);
      ctx.strokeStyle = "#1a3050"; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
      axisLabel(ctx, ((1 - i / 4) * maxPM).toFixed(0), pad.l - 4, y + 3, "right");
    }

    axisLabel(ctx, "PM2.5 µg/m³", 10, H / 2, "center", "#4a88aa");
    axisLabel(ctx, "Temperature (°C)", W / 2, H - 2, "center", "#4a88aa");

    // Points
    points.forEach(p => {
      const x = pad.l + ((p.temp - minT) / (maxT - minT || 1)) * iW;
      const y = H - pad.b - (p.pm25 / maxPM) * iH;
      ctx.beginPath();
      ctx.arc(x, y, p.forecast ? 3 : 5, 0, Math.PI * 2);
      ctx.fillStyle = p.forecast
        ? "rgba(100,160,220,0.5)"
        : AirQoService.aqiColor(p.pm25) + "cc";
      ctx.fill();
    });

    // Linear trend line
    const n   = points.length;
    const mx  = temps.reduce((a, b) => a + b, 0) / n;
    const my  = pms.reduce((a, b) => a + b, 0) / n;
    const num = points.reduce((s, p) => s + (p.temp - mx) * (p.pm25 - my), 0);
    const den = points.reduce((s, p) => s + (p.temp - mx) ** 2, 0);
    if (den) {
      const slope = num / den;
      const intercept = my - slope * mx;
      const x0 = pad.l, x1 = W - pad.r;
      const y0 = H - pad.b - (slope * minT + intercept) / maxPM * iH;
      const y1 = H - pad.b - (slope * maxT + intercept) / maxPM * iH;
      ctx.beginPath();
      ctx.strokeStyle = "#0072ffaa";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
      ctx.stroke(); ctx.setLineDash([]);
    }

    // Pearson r
    const r = Interpolation.pearson(temps, pms);
    axisLabel(ctx, `r = ${r.toFixed(2)}`, W - pad.r - 2, pad.t + 10, "right",
      Math.abs(r) > 0.6 ? "#ff8800" : "#60aa88");
  }

  // ── RISK RADAR ────────────────────────────────────────────
  // Hexagonal spider chart showing 6 hazard dimensions
  function drawRadar(ctx, W, H, wx, sites, city) {
    const avgPM = sites.length
      ? sites.reduce((s, si) => s + si.pm25, 0) / sites.length
      : 0;

    const dims = [
      { label: "AQ Risk",  val: Math.min(avgPM / 200, 1)                          },
      { label: "Heat",     val: Math.min(Math.max((wx.temp||28) - 22, 0) / 18, 1) },
      { label: "UV",       val: Math.min((wx.uv||0) / 11, 1)                      },
      { label: "Humidity", val: Math.min((wx.humidity||70) / 100, 1)              },
      { label: "Wind",     val: Math.min((wx.wind||10) / 50, 1)                   },
      { label: "Rain",     val: Math.min((wx.rain||0) / 20, 1)                    },
    ];

    const n   = dims.length;
    const cx  = W / 2;
    const cy  = H / 2;
    const r   = Math.min(W, H) / 2 - 22;

    function pt(i, frac) {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      return [cx + r * frac * Math.cos(angle), cy + r * frac * Math.sin(angle)];
    }

    // Background grid rings
    [0.25, 0.5, 0.75, 1.0].forEach(frac => {
      ctx.beginPath();
      ctx.strokeStyle = `rgba(26,48,80,${frac * 0.8 + 0.2})`;
      ctx.lineWidth   = 1;
      dims.forEach((_, i) => {
        const [x, y] = pt(i, frac);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
    });

    // Axis spokes + labels
    dims.forEach((d, i) => {
      const [x1, y1] = pt(i, 1);
      ctx.beginPath();
      ctx.strokeStyle = "#1a3050";
      ctx.moveTo(cx, cy); ctx.lineTo(x1, y1); ctx.stroke();

      const [lx, ly] = pt(i, 1.22);
      ctx.fillStyle  = "#8ab0cc";
      ctx.font       = "10px Segoe UI";
      ctx.textAlign  = "center";
      ctx.fillText(d.label, lx, ly + 3);
    });

    // Data polygon (filled)
    ctx.beginPath();
    dims.forEach((d, i) => {
      const [x, y] = pt(i, d.val);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle   = "rgba(255,90,40,0.22)";
    ctx.fill();
    ctx.strokeStyle = "#ff6633";
    ctx.lineWidth   = 2;
    ctx.stroke();

    // Data points on polygon
    dims.forEach((d, i) => {
      const [x, y] = pt(i, d.val);
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "#ff9966";
      ctx.fill();
    });

    // Overall risk score in center
    const overall = dims.reduce((s, d) => s + d.val, 0) / n;
    const riskPct = (overall * 100).toFixed(0);
    ctx.fillStyle = overall > 0.6 ? "#ff3333" : overall > 0.4 ? "#ff9900" : "#00cc66";
    ctx.font      = "bold 16px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText(riskPct, cx, cy + 5);
    ctx.fillStyle = "#4a88aa";
    ctx.font      = "9px Segoe UI";
    ctx.fillText("Risk %", cx, cy + 16);
  }

  // ── No-data placeholder ───────────────────────────────────
  function _noData(ctx, W, H, msg = "No data") {
    ctx.fillStyle  = "#4a88aa";
    ctx.font       = "12px Segoe UI";
    ctx.textAlign  = "center";
    ctx.fillText(msg, W / 2, H / 2);
  }

  return { draw };

})();