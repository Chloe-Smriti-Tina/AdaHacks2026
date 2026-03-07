/**
 * Normalise a CSV header string → camelCase-ish key
 * e.g. "Collision Date & Time" → "collision_date_time"
 */
function headerKey(h) {
  return h.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Parse the raw CSV text via PapaParse (must be loaded before this file).
 * Returns array of plain objects with normalised keys.
 */
function parseRawCSV(csvText) {
  const result = Papa.parse(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: headerKey,
  });
  return result.data;
}

/**
 * Aggregate raw rows into one object per year.
 * Returns array sorted ascending by year.
 */
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
        property_damage_only_pdo: 0,
        fatalities_intersection: 0,
        fatalities_midblock: 0,
        injuries_intersection: 0,
        injuries_midblock: 0,
        // for traffic control chart
        _ctrl: {},
        // for mode pie: vehicle-only collisions (no ped/cyc)
        vehicle_only_collisions: 0,
      };
    }

    const y = map[yr];
    y.total_collisions++;

    const fatal   = parseInt(r['fatalities']          ?? r['fatalities_']        ?? 0, 10) || 0;
    const major   = parseInt(r['major_injuries']      ?? r['major_injuries_']    ?? 0, 10) || 0;
    const minor   = parseInt(r['minor_injuries']      ?? r['minor_injuries_']    ?? 0, 10) || 0;
    const peds    = parseInt(r['pedestrians_involved']?? r['pedestrians']        ?? 0, 10) || 0;
    const cycs    = parseInt(r['cyclists_involved']   ?? r['cyclists']           ?? 0, 10) || 0;
    const pdoRaw  = (r['property_damage_only'] ?? r['property_damage_only_y_n'] ?? '').toString().trim().toUpperCase();
    const pdo     = pdoRaw === 'Y' || pdoRaw === 'YES' || pdoRaw === '1';
    const locType = (r['location_type'] ?? '').trim().toLowerCase();
    const ctrl    = (r['traffic_control'] ?? r['traffic_control_name'] ?? 'Unknown').trim();

    y.total_fatalities     += fatal;
    y.total_major_injuries += major;
    y.total_minor_injuries += minor;

    if (peds > 0) y.pedestrian_collisions++;
    if (cycs > 0) y.bicycle_collisions++;
    if (pdo)      y.property_damage_only_pdo++;

    const totalInjuries = minor + major;

    if (locType === 'intersection') {
      y.fatalities_intersection += fatal;
      y.injuries_intersection   += totalInjuries;
    } else if (locType === 'midblock') {
      y.fatalities_midblock += fatal;
      y.injuries_midblock   += totalInjuries;
    }

    if (peds === 0 && cycs === 0) y.vehicle_only_collisions++;

    // tally traffic controls
    const ctrlKey = ctrl || 'Unknown';
    y._ctrl[ctrlKey] = (y._ctrl[ctrlKey] || 0) + 1;
  });

  return Object.values(map).sort((a, b) => a.year - b.year);
}

/**
 * Top N traffic control types across all years combined (for the bar chart).
 */
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
    .map(([label, _]) => label);
}

/**
 * Build per-year control counts for the given ordered label list.
 */
function controlCountsForYear(y, labels) {
  return labels.map(l => y._ctrl[l] || 0);
}

/**
 * Main export: fetch + parse + aggregate.
 * Returns { ys, ctrlLabels } where:
 *   ys         = array of yearly aggregated stat objects
 *   ctrlLabels = ordered traffic control labels
 */
async function loadAndAggregate(csvPath = 'data/data.csv') {
  const resp = await fetch(csvPath + '?_=' + Date.now());
  if (!resp.ok) throw new Error(`Could not load ${csvPath}: ${resp.status}`);
  const text = await resp.text();
  const rows = parseRawCSV(text);
  const ys   = aggregateByYear(rows);
  const ctrlLabels = topControls(ys, 7);
  return { ys, ctrlLabels, rawRows: rows };
}