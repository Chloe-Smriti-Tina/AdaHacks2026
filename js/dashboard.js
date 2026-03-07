/**
 * dashboard.js
 * Entry point for index.html (Overview dashboard).
 *
 * Architecture:
 *   csv_loader.js  → loadCSV()          parses data/yearly_stats.csv
 *   index.html     → updateKPIs()       updates KPI cards for selected year
 *   index.html     → renderCharts()     creates all Chart.js instances from YS data
 *   dashboard.js   → initDashboard()    orchestrates load → KPIs → charts
 *
 * Data source: modelled after City of Edmonton Open Data Portal
 * https://data.edmonton.ca  (Traffic Incidents / Road Safety datasets)
 */

// YS is declared as `let YS = []` in index.html so it's in global scope here too.

async function initDashboard() {
    const allRows = await loadCSV('data/records.csv');
    YS = allRows.filter(r => r.record_type === 'yearly');
    updateKPIs();
    renderCharts();
}

document.addEventListener('DOMContentLoaded', initDashboard);