function headerKey(h) {
  return h.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseRawCSV(csvText) {
  const result = Papa.parse(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: headerKey,
  });
  return result.data;
}

function aggregateByYear(rows) {
  const map = {};

  rows.forEach(r => {
    const yr = parseInt(r['collision_year'] ?? r['year'], 10);
    if (isNaN(yr)) return;

    if (!map[yr]) {
      map[yr] = {
        year: yr,
        total_collisions: 0,
        total_fatalities: 0,
        total_major_injuries: 0,
        total_minor_injuries: 0,
        pedestrian_collisions: 0,
        bicycle_collisions: 0,
        motorcycle_collisions: 0,
        property_damage_only_pdo: 0,
        fatalities_intersection: 0,
        fatalities_midblock: 0,
        injuries_intersection: 0,
        injuries_midblock: 0,
        _hourly: new Array(24).fill(0),   // ← ADD
        _monthly: new Array(12).fill(0),
        _ctrl: {},
      };
    }

    const y = map[yr];
    y.total_collisions++;

    const fatal  = parseInt(r['fatalities']           ?? 0, 10) || 0;
    const major  = parseInt(r['major_injuries']       ?? 0, 10) || 0;
    const minor  = parseInt(r['minor_injuries']       ?? 0, 10) || 0;
    const peds   = parseInt(r['pedestrians_involved'] ?? 0, 10) || 0;
    const cycs   = parseInt(r['cyclists_involved']    ?? 0, 10) || 0;
    const motos  = parseInt(r['motorcycles_involved'] ?? 0, 10) || 0;
    const pdoRaw = (r['property_damage_only'] ?? r['property_damage_only_y_n'] ?? '').toString().trim().toUpperCase();
    const pdo    = pdoRaw === 'Y' || pdoRaw === 'YES' || pdoRaw === '1';
    const locType = (r['location_type'] ?? '').trim().toLowerCase();
    const ctrl    = (r['traffic_control'] ?? r['traffic_control_name'] ?? 'Unknown').trim();

    y.total_fatalities     += fatal;
    y.total_major_injuries += major;
    y.total_minor_injuries += minor;

    if (peds  > 0) y.pedestrian_collisions++;
    if (cycs  > 0) y.bicycle_collisions++;
    if (motos > 0) y.motorcycle_collisions++;
    if (pdo)       y.property_damage_only_pdo++;

    const totalInjuries = minor + major;

    if (locType === 'intersection') {
      y.fatalities_intersection += fatal;
      y.injuries_intersection   += totalInjuries;
    } else if (locType === 'midblock') {
      y.fatalities_midblock += fatal;
      y.injuries_midblock   += totalInjuries;
    }

    const ctrlKey = ctrl || 'Unknown';
    y._ctrl[ctrlKey] = (y._ctrl[ctrlKey] || 0) + 1;
    const rawDT = (r['collision_date_time'] ?? r['collision_date___time'] ?? '').trim();
    if (rawDT) {
    const parts = rawDT.split(' ');
    if (parts[0]) { const mo = parseInt(parts[0].split('-')[1], 10) - 1; if (!isNaN(mo) && mo >= 0 && mo < 12) y._monthly[mo]++; }
    if (parts[1]) { const hr = parseInt(parts[1].split(':')[0], 10);     if (!isNaN(hr) && hr >= 0 && hr < 24) y._hourly[hr]++; }
    }
  });

  return Object.values(map).sort((a, b) => a.year - b.year);
}

function topControls(ys, n = 7) {
  const totals = {};
  ys.forEach(y => {
    Object.entries(y._ctrl).forEach(([k, v]) => {
      totals[k] = (totals[k] || 0) + v;
    });
  });
  return Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label]) => label);
}

async function loadAndAggregate(csvPath = 'data/data.csv') {
  const resp = await fetch(csvPath + '?_=' + Date.now());
  if (!resp.ok) throw new Error(`Could not load ${csvPath}: ${resp.status}`);
  const text = await resp.text();
  const rows = parseRawCSV(text);
  const ys   = aggregateByYear(rows);
  const ctrlLabels = topControls(ys, 7);
  return { ys, ctrlLabels, rawRows: rows };
}