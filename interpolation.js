// ============================================================
//  interpolation.js  —  Spatial Interpolation & Gap Detection
//  Methods: IDW (Inverse Distance Weighting) + Ordinary Kriging
// ============================================================

const Interpolation = (() => {

  const GRID = CONFIG.INTERP_GRID_SIZE;

  // ── Haversine distance (km) ───────────────────────────────
  function dist(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2
      + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180)
      * Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ── Bounding box of a set of sites ───────────────────────
  function bounds(sites, pad = 0.05) {
    const lats = sites.map(s => s.lat);
    const lngs = sites.map(s => s.lng);
    return {
      minLat: Math.min(...lats) - pad,
      maxLat: Math.max(...lats) + pad,
      minLng: Math.min(...lngs) - pad,
      maxLng: Math.max(...lngs) + pad,
    };
  }

  // ── IDW Interpolation ─────────────────────────────────────
  // power: higher = more local influence (typically 2)
  function idw(sites, lat, lng, power = 2) {
    let num = 0, den = 0;
    for (const s of sites) {
      const d = dist(lat, lng, s.lat, s.lng) + 1e-6;
      const w = 1 / Math.pow(d, power);
      num += w * s._hv;
      den += w;
    }
    return num / den;
  }

  // ── Ordinary Kriging (spherical variogram model) ──────────
  // Variogram params tuned for urban air quality (~8km range)
  function kriging(sites, lat, lng) {
    const n      = sites.length;
    const range  = 8;    // km  — spatial correlation range
    const nugget = 5;    // µg² — measurement noise
    const sill   = 600;  // µg² — total variance

    // Spherical variogram γ(h)
    function gamma(h) {
      if (h >= range) return sill + nugget;
      return nugget + sill * (1.5 * (h / range) - 0.5 * (h / range) ** 3);
    }

    // Build (n+1) x (n+1) kriging matrix [covariances + lagrange row/col]
    const K = Array.from({ length: n + 1 }, (_, i) =>
      Array.from({ length: n + 1 }, (_, j) => {
        if (i === n || j === n) return (i === j) ? 0 : 1;
        return (i === j) ? 0 : gamma(dist(sites[i].lat, sites[i].lng, sites[j].lat, sites[j].lng));
      })
    );

    // RHS vector k0: covariance from each site to prediction point
    const k0 = [
      ...sites.map(s => gamma(dist(s.lat, s.lng, lat, lng))),
      1, // lagrange constraint
    ];

    // Solve K * w = k0 via Gauss-Jordan elimination
    const A = K.map((row, i) => [...row, k0[i]]);
    const sz = n + 1;

    for (let col = 0; col < sz; col++) {
      // Partial pivot
      let maxRow = col;
      for (let r = col + 1; r < sz; r++)
        if (Math.abs(A[r][col]) > Math.abs(A[maxRow][col])) maxRow = r;
      [A[col], A[maxRow]] = [A[maxRow], A[col]];

      if (Math.abs(A[col][col]) < 1e-10) continue;

      for (let r = 0; r < sz; r++) {
        if (r === col) continue;
        const f = A[r][col] / A[col][col];
        for (let c = col; c <= sz; c++) A[r][c] -= f * A[col][c];
      }
    }

    // Extract weights
    const w = A.map((row, i) => row[sz] / row[i]);

    // Weighted estimate
    const est = sites.reduce((sum, s, i) => sum + w[i] * s._hv, 0);
    return Math.max(0, est);
  }

  // ── Build interpolation canvas overlay ───────────────────
  function build(sites, hazardMode, method, valToColorFn) {
    if (!sites.length || method === "none") return null;

    const b  = bounds(sites);
    const cv = document.createElement("canvas");
    cv.width = GRID; cv.height = GRID;
    const ctx = cv.getContext("2d");
    const img = ctx.createImageData(GRID, GRID);

    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const lat = b.maxLat - (row / GRID) * (b.maxLat - b.minLat);
        const lng = b.minLng + (col / GRID) * (b.maxLng - b.minLng);

        const minD = Math.min(...sites.map(s => dist(lat, lng, s.lat, s.lng)));

        // Interpolated value using selected method
        const v = method === "idw"
          ? idw(sites, lat, lng)
          : kriging(sites, lat, lng);

        const { r, g, b: bv } = valToColorFn(v, hazardMode);

        // More opaque in coverage gaps → highlights uncovered areas
        const alpha = minD > CONFIG.COVERAGE_RADIUS_KM ? 120 : 45;

        const idx = 4 * (row * GRID + col);
        img.data[idx]     = r;
        img.data[idx + 1] = g;
        img.data[idx + 2] = bv;
        img.data[idx + 3] = alpha;
      }
    }

    ctx.putImageData(img, 0, 0);
    return L.imageOverlay(
      cv.toDataURL(),
      [[b.minLat, b.minLng], [b.maxLat, b.maxLng]],
      { opacity: 0.72, interactive: false }
    );
  }

  // ── Gap detection ─────────────────────────────────────────
  // Scans a grid for zones not covered by any sensor within
  // coverageKm, then clusters close gap points together.
  function findGaps(sites, coverageKm = 3) {
    if (!sites.length) return [];

    const b    = bounds(sites, 0.04);
    const step = 0.013; // ~1.5 km per grid step
    const raw  = [];

    for (let lat = b.minLat; lat <= b.maxLat; lat += step) {
      for (let lng = b.minLng; lng <= b.maxLng; lng += step) {
        const minD = Math.min(...sites.map(s => dist(lat, lng, s.lat, s.lng)));
        // Collect every uncovered point (beyond one coverage radius but still
        // within the study area — capped at 3× radius to avoid far suburbs)
        if (minD > coverageKm && minD < coverageKm * 3) {
          raw.push({ pt: [lat, lng], minD });
        }
      }
    }

    // Sort descending: deepest gap point first.
    // This ensures each cluster is seeded with the local distance maximum —
    // the optimal placement where the new sensor covers the most uncovered area
    // and its own circle (coverageKm radius) does not overlap with any existing
    // sensor circle (they will be at least coverageKm * 2 apart → tangent at best).
    raw.sort((a, b) => b.minD - a.minD);

    // Deduplicate with radius = 2 × coverageKm so two suggested sensors
    // are never close enough for their coverage circles to overlap.
    const clusters = [];
    for (const { pt } of raw) {
      const alreadyCovered = clusters.some(
        c => dist(pt[0], pt[1], c[0], c[1]) < coverageKm * 2
      );
      if (!alreadyCovered) clusters.push(pt);
    }

    return clusters;
  }

  // ── Pearson correlation coefficient ──────────────────────
  // Used in chart.js for correlation annotations
  function pearson(xs, ys) {
    const n  = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
    const dx  = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0));
    const dy  = Math.sqrt(ys.reduce((s, y) => s + (y - my) ** 2, 0));
    return (dx && dy) ? num / (dx * dy) : 0;
  }

  return { build, findGaps, dist, pearson };

})();