/**
 * csv_loader.js
 * Parses a CSV file from a URL.
 * Handles:
 *   - RFC 4180 quoted fields (commas and quotes inside "..." are safe)
 *   - Pipe-separated values like "2018|2019|2023" → [2018, 2019, 2023]
 *   - Automatic number coercion for pure numeric strings
 *
 * Source data modelled after City of Edmonton Open Data Portal
 * (data.edmonton.ca – Traffic Incidents & Safety datasets)
 */

function parseCSVRow(row) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '"') {
            // Escaped quote inside a quoted field ("") → literal "
            if (inQuotes && row[i + 1] === '"') { current += '"'; i++; }
            else { inQuotes = !inQuotes; }
        } else if (ch === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    values.push(current.trim());
    return values;
}

async function loadCSV(filePath) {
    const response = await fetch(filePath);
    if (!response.ok) throw new Error(`Could not load CSV: ${filePath} (${response.status})`);
    const text = await response.text();

    const rows = text.trim().split('\n').filter(r => r.trim() !== '');
    const headers = parseCSVRow(rows.shift());

    return rows.map(row => {
        const values = parseCSVRow(row);
        const obj = {};

        headers.forEach((h, i) => {
            let val = values[i] !== undefined ? values[i] : '';

            if (val.includes('|')) {
                // Pipe-separated array — coerce each element to number if possible
                val = val.split('|').map(v => {
                    const t = v.trim();
                    return t !== '' && !isNaN(t) ? Number(t) : t;
                });
            } else if (val !== '' && !isNaN(val)) {
                val = Number(val);
            }

            obj[h.trim()] = val;
        });

        return obj;
    });
}