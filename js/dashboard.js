/* ─── State ─────────────────────────────────────────────── */
let YS          = [];       // yearly aggregated stats array
let CTRL_LABELS = [];       // traffic control labels for bar chart
let RAW_ROWS    = [];       // raw CSV rows (kept for future use)
let curYear     = null;

/* ─── Chart instances (kept so we can destroy/re-render) ─── */
const charts = {};

/* ─── Helpers ────────────────────────────────────────────── */
const f   = n  => (typeof n === 'number') ? n.toLocaleString() : (n ?? '—');
const pct = n  => (typeof n === 'number') ? n.toFixed(1) + '%' : '—';

function dlt(c, p, label) {
  if (p == null) return '—';
  const d = c - p;
  const sign = d > 0 ? '▲ +' : d < 0 ? '▼ ' : '→ ';
  return `${sign}${f(Math.abs(d))} vs ${label ?? (curYear - 1)}`;
}
function dCls(c, p) {
  if (p == null) return 'dn';
  return c > p ? 'dd' : c < p ? 'du' : 'dn';
}

/* ─── Year buttons ───────────────────────────────────────── */
function buildYearButtons() {
  const container = document.getElementById('yr-btns');
  container.innerHTML = '';
  YS.forEach(y => {
    const btn = document.createElement('button');
    btn.className = 'yr-btn';
    btn.textContent = y.year;
    btn.addEventListener('click', () => selectYear(y.year));
    container.appendChild(btn);
  });
}

function selectYear(yr) {
  curYear = yr;
  document.querySelectorAll('.yr-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.textContent, 10) === yr);
  });
  updateKPIs();
  updateCtrlChart();
}

/* ─── KPI Cards ──────────────────────────────────────────── */
function updateKPIs() {
  const d = YS.find(y => y.year === curYear);
  const p = YS.find(y => y.year === curYear - 1);
  if (!d) return;

  const s  = (id, v)  => { const e = document.getElementById(id); if (e) e.textContent = v; };
  const sc = (id, cl) => { const e = document.getElementById(id); if (e) e.className = 'c-delta ' + cl; };

  s('kv-total',   f(d.total_collisions));
  s('kv-fatal',   f(d.total_fatalities));
  s('kv-serious', f(d.total_major_injuries));
  s('kv-minor',   f(d.total_minor_injuries));
  s('kv-bike',    f(d.bicycle_collisions));
  s('kv-ped',     f(d.pedestrian_collisions));
  s('kv-pdo',     f(d.property_damage_only_pdo));

  // Collision rate: derive a simple rate from total (rough per-1k population proxy)
  const rate = (d.total_collisions / 1040000 * 1000).toFixed(1);
  s('kv-rate', rate);

  // Deltas
  s('kd-total',   dlt(d.total_collisions,        p?.total_collisions));
  s('kd-fatal',   dlt(d.total_fatalities,         p?.total_fatalities));
  s('kd-serious', dlt(d.total_major_injuries,     p?.total_major_injuries));
  s('kd-minor',   dlt(d.total_minor_injuries,     p?.total_minor_injuries));
  s('kd-bike',    dlt(d.bicycle_collisions,       p?.bicycle_collisions));
  s('kd-ped',     dlt(d.pedestrian_collisions,    p?.pedestrian_collisions));
  s('kd-pdo',     dlt(d.property_damage_only_pdo, p?.property_damage_only_pdo));

  if (p) {
    const rates = {
      fatal:   ['total_fatalities',         'kd-fatal'],
      serious: ['total_major_injuries',     'kd-serious'],
      minor:   ['total_minor_injuries',     'kd-minor'],
      bike:    ['bicycle_collisions',       'kd-bike'],
      ped:     ['pedestrian_collisions',    'kd-ped'],
      pdo:     ['property_damage_only_pdo', 'kd-pdo'],
    };
    Object.entries(rates).forEach(([, [field, id]]) => sc(id, dCls(d[field], p[field])));
  }

  const prevRate = p ? (p.total_collisions / 1040000 * 1000).toFixed(1) : null;
  s('kd-rate', prevRate ? `${(rate - prevRate).toFixed(1) >= 0 ? '▲ +' : '▼ '}${Math.abs((rate - prevRate).toFixed(1))} vs ${curYear - 1}` : '—');

  // Year label + intersection/midblock grid
  s('yr-lbl',      curYear);
  s('yr-lbl-ctrl', curYear);
  s('iv-fi',  f(d.fatalities_intersection));
  s('iv-fm',  f(d.fatalities_midblock));
  s('iv-ii',  f(d.injuries_intersection));
  s('iv-im',  f(d.injuries_midblock));

  // Update page subtitle
  const years = YS.map(y => y.year);
  s('ph-sub-years', `${Math.min(...years)}–${Math.max(...years)}`);
}

/* ─── Charts ─────────────────────────────────────────────── */
const P = '#39b6fb', S = '#e87d95', RED = '#e84646', AMB = '#f5a623', TEAL = '#0891b2';
const tk  = { color: '#7a92ab', font: { family: 'Sora', size: 11 } };
const gr  = { color: '#e2eaf3' };
const bs  = {
  x: { ticks: tk, grid: gr,                     border: { color: '#e2eaf3' } },
  y: { ticks: tk, grid: gr,                     border: { color: '#e2eaf3' } },
};

function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); delete charts[key]; }
}

function renderCharts() {
  const yrs = YS.map(y => y.year);

  /* Trend line */
  destroyChart('trend');
  charts.trend = new Chart(document.getElementById('ch-trend'), {
    type: 'line',
    data: {
      labels: yrs,
      datasets: [
        { label: 'Collisions',    data: YS.map(y => y.total_collisions),    borderColor: P,   backgroundColor: 'rgba(57,182,251,.07)', fill: true, tension: .4, pointBackgroundColor: P,   pointRadius: 4, yAxisID: 'y'  },
        { label: 'Fatalities',    data: YS.map(y => y.total_fatalities),    borderColor: RED, backgroundColor: 'transparent',           tension: .4, pointBackgroundColor: RED, pointRadius: 4, yAxisID: 'y1' },
        { label: 'Major Inj.',    data: YS.map(y => y.total_major_injuries),borderColor: AMB, backgroundColor: 'transparent',           tension: .4, pointBackgroundColor: AMB, pointRadius: 4, yAxisID: 'y1' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#7a92ab', font: { family: 'Sora', size: 11 }, boxWidth: 9, padding: 10 } } },
      scales: { x: bs.x, y: bs.y, y1: { position: 'right', ticks: tk, grid: { drawOnChartArea: false }, border: { color: '#e2eaf3' } } },
    },
  });

  /* Mode pie — derived from raw aggregates */
  const latest = YS[YS.length - 1];
  const pedN  = YS.reduce((a, y) => a + y.pedestrian_collisions, 0);
  const cycN  = YS.reduce((a, y) => a + y.bicycle_collisions,    0);
  const totN  = YS.reduce((a, y) => a + y.total_collisions,      0);
  const vehN  = Math.max(0, totN - pedN - cycN);

  destroyChart('pie');
  charts.pie = new Chart(document.getElementById('ch-pie'), {
    type: 'doughnut',
    data: {
      labels: ['Vehicle Only', 'Pedestrian', 'Bicyclist'],
      datasets: [{ data: [vehN, pedN, cycN], backgroundColor: [P, S, TEAL], borderColor: '#fff', borderWidth: 2, hoverOffset: 5 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: { legend: { position: 'right', labels: { color: '#7a92ab', font: { family: 'Sora', size: 10 }, boxWidth: 9, padding: 7 } } },
    },
  });

  /* Vulnerable users bar */
  destroyChart('vul');
  charts.vul = new Chart(document.getElementById('ch-vul'), {
    type: 'bar',
    data: {
      labels: yrs,
      datasets: [
        { label: 'Bicycle',    data: YS.map(y => y.bicycle_collisions),    backgroundColor: TEAL, borderRadius: 4 },
        { label: 'Pedestrian', data: YS.map(y => y.pedestrian_collisions), backgroundColor: S,    borderRadius: 4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#7a92ab', font: { family: 'Sora', size: 11 }, boxWidth: 9, padding: 10 } } },
      scales: bs,
    },
  });

  /* Traffic control bar — year-specific, built separately */
  renderCtrlChart();
}

function renderCtrlChart() {
  const d = YS.find(y => y.year === curYear);
  if (!d) return;

  const counts = CTRL_LABELS.map(l => d._ctrl[l] || 0);

  destroyChart('ctrl');
  charts.ctrl = new Chart(document.getElementById('ch-ctrl'), {
    type: 'bar',
    data: {
      labels: CTRL_LABELS,
      datasets: [{ label: 'Collisions', data: counts, backgroundColor: P, borderRadius: 4 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { ...tk, font: { family: 'Sora', size: 10 } }, grid: gr,                      border: { color: '#e2eaf3' } },
        y: { ticks: { ...tk, font: { family: 'Sora', size: 10 } }, grid: { color: 'transparent' }, border: { color: 'transparent' } },
      },
    },
  });
}

function updateCtrlChart() {
  const d = YS.find(y => y.year === curYear);
  if (!d || !charts.ctrl) return;
  charts.ctrl.data.datasets[0].data = CTRL_LABELS.map(l => d._ctrl[l] || 0);
  charts.ctrl.update();
}

/* ─── Import Button ──────────────────────────────────────── */
function setupImport() {
  const btn   = document.getElementById('btn-import');
  const input = document.getElementById('csv-file-input');

  btn.addEventListener('click', () => input.click());

  input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setImportState('loading', '⏳ Processing…');

    try {
      const text = await file.text();

      // Validate it looks like a collision CSV
      const firstLine = text.split('\n')[0].toLowerCase();
      if (!firstLine.includes('collision') && !firstLine.includes('year') && !firstLine.includes('location')) {
        throw new Error('File does not appear to be a collision dataset. Check column headers.');
      }

      // Parse + aggregate
      const rows = parseRawCSV(text);
      if (rows.length === 0) throw new Error('No data rows found in CSV.');

      const ys   = aggregateByYear(rows);
      if (ys.length === 0) throw new Error('Could not find a valid "Collision Year" column.');

      const ctrlLabels = topControls(ys, 7);

      // Commit to global state
      YS          = ys;
      CTRL_LABELS = ctrlLabels;
      RAW_ROWS    = rows;
      curYear     = YS[YS.length - 1].year;

      // Re-build UI
      buildYearButtons();
      selectYear(curYear);
      renderCharts();

      setImportState('success', `✓ Loaded ${rows.length.toLocaleString()} records`);
      setTimeout(() => setImportState('idle', 'Import Data'), 3500);

    } catch (err) {
      console.error('Import error:', err);
      setImportState('error', '✗ ' + err.message);
      setTimeout(() => setImportState('idle', 'Import Data'), 5000);
    }

    // Reset so same file can be re-imported
    input.value = '';
  });
}

function setImportState(state, label) {
  const btn = document.getElementById('btn-import');
  btn.textContent = label;
  btn.dataset.state = state;
}

/* ─── Init ───────────────────────────────────────────────── */
async function initDashboard() {
  try {
    const { ys, ctrlLabels, rawRows } = await loadAndAggregate('data/data.csv');
    YS          = ys;
    CTRL_LABELS = ctrlLabels;
    RAW_ROWS    = rawRows;
    curYear     = YS[YS.length - 1].year;
  } catch (err) {
    console.warn('Could not load data/data.csv — dashboard will show empty state.', err);
    YS          = [];
    CTRL_LABELS = [];
    curYear     = null;
    showEmptyState();
  }

  buildYearButtons();
  if (curYear) {
    selectYear(curYear);
    renderCharts();
  }
  setupImport();
}

function showEmptyState() {
  const s = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  ['kv-total','kv-fatal','kv-serious','kv-minor','kv-rate','kv-bike','kv-ped','kv-pdo'].forEach(id => s(id, '—'));
  ['kd-total','kd-fatal','kd-serious','kd-minor','kd-rate','kd-bike','kd-ped','kd-pdo'].forEach(id => s(id, 'no data'));
  ['iv-fi','iv-fm','iv-ii','iv-im'].forEach(id => s(id, '—'));
  s('ph-sub-years', 'No data loaded');

  const btn = document.getElementById('btn-import');
  if (btn) {
    btn.style.background = 'var(--p)';
    btn.style.color = '#fff';
    btn.textContent = '⬆ Import Data to Begin';
  }
}

document.addEventListener('DOMContentLoaded', initDashboard);