// ======= SIMPLE ON-SCREEN LOGGER =======
const elInput   = document.getElementById('input');
const elStatus  = document.getElementById('status');
const elSummary = document.getElementById('summary');
const elDuties  = document.getElementById('duties');

const pasteBtn  = document.getElementById('pasteBtn');
const clearBtn  = document.getElementById('clearBtn');
const pdfFile   = document.getElementById('pdfFile');

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  if (elStatus) elStatus.textContent = line;
}

// Catch silent JS errors and show them
window.addEventListener('error', (e) => {
  log(`JS ERROR: ${e.message}`);
  alert(`JS ERROR: ${e.message}`);
});
window.addEventListener('unhandledrejection', (e) => {
  const msg = e?.reason?.message || String(e.reason || e);
  log(`PROMISE ERROR: ${msg}`);
  alert(`PROMISE ERROR: ${msg}`);
});

log("app.js loaded ✅");

// ======= BASIC BUTTONS =======
pasteBtn?.addEventListener('click', async () => {
  log("Paste button clicked");
  try {
    const txt = await navigator.clipboard.readText();
    elInput.value = txt;
    parseAndRender();
  } catch {
    log("Clipboard read failed. Paste manually into the box.");
  }
});

clearBtn?.addEventListener('click', () => {
  log("Clear clicked");
  elInput.value = '';
  elSummary.innerHTML = '';
  elDuties.innerHTML = '';
});

elInput?.addEventListener('input', () => parseAndRender(true));

// ======= PDF.JS SETUP =======
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  log("pdfjsLib detected ✅");
} else {
  log("pdfjsLib NOT found ❌ (PDF.js script didn’t load)");
}

// ======= PDF PICKER =======
pdfFile?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) {
    log("No file selected");
    return;
  }

  log(`File selected: ${file.name} (${Math.round(file.size/1024)} KB)`);

  try {
    if (!window.pdfjsLib) {
      throw new Error("PDF.js not loaded (pdfjsLib is undefined).");
    }

    log("Starting PDF parse…");
    const duties = await parseRosterPdfToDuties(file);
    log(`PDF parsed. Duty-days found: ${duties.length}`);

    const payload = {
      source: "pdf",
      capturedAt: new Date().toISOString(),
      fileName: file.name,
      duties
    };

    elInput.value = JSON.stringify(payload, null, 2);
    parseAndRender();
  } catch (err) {
    const msg = err?.message || String(err);
    log(`PDF import failed: ${msg}`);
    alert(`PDF import failed:\n${msg}`);
  } finally {
    e.target.value = '';
  }
});

// ======= MAIN PARSE + RENDER =======
function parseAndRender(silent = false) {
  const txt = elInput.value.trim();
  if (!txt) return;

  let data;
  try {
    data = JSON.parse(txt);
  } catch {
    if (!silent) log("Invalid JSON in textarea");
    return;
  }

  const duties = data?.duties ? normalizePdfDuties(data.duties) : [];
  log(`Rendered: Source=${data.source || 'manual'} | Duties=${duties.length}`);

  renderSummary(duties);
  renderDuties(duties);
}

// ======= NORMALISER =======
function normalizePdfDuties(days) {
  return days.map(d => ({
    startDate: d.startDate || '',
    duty: (d.dutyCodes && d.dutyCodes[0]) || '',
    flightNumber: (d.flights || []).join(', '),
    sector: (d.sectors || []).join(', '),
    rpt: (d.times || [])[0] || '',
    signOff: (d.times || []).slice(-1)[0] || '',
    dutyTime: '',
    hotel: (d.hotels || []).join(', '),
    remarks: (d.remarks || []).join(' | ')
  }));
}

// ======= SUMMARY =======
function renderSummary(duties) {
  const counts = {};
  for (const d of duties) counts[d.duty] = (counts[d.duty] || 0) + 1;

  elSummary.innerHTML = `
    <table>
      <tr><th>Metric</th><th>Value</th></tr>
      <tr><td>Total Duty-days</td><td>${duties.length}</td></tr>
      <tr><td>Duty Mix</td><td class="mono">${escapeHtml(JSON.stringify(counts))}</td></tr>
    </table>
  `;
}

// ======= DUTIES TABLE =======
function renderDuties(duties) {
  if (!duties.length) {
    elDuties.innerHTML = '<div class="muted">No duties detected.</div>';
    return;
  }

  let html = `
    <table>
      <tr>
        <th>Date</th><th>Duty</th><th>Flights</th><th>Sectors</th>
        <th>Rpt</th><th>Sign Off</th><th>Hotel</th><th>Remarks</th>
      </tr>
  `;

  for (const d of duties) {
    html += `
      <tr>
        <td>${escapeHtml(d.startDate)}</td>
        <td>${escapeHtml(d.duty)}</td>
        <td>${escapeHtml(d.flightNumber)}</td>
        <td>${escapeHtml(d.sector)}</td>
        <td>${escapeHtml(d.rpt)}</td>
        <td>${escapeHtml(d.signOff)}</td>
        <td>${escapeHtml(d.hotel)}</td>
        <td>${escapeHtml(d.remarks)}</td>
      </tr>
    `;
  }

  html += '</table>';
  elDuties.innerHTML = html;
}

// ======= PDF PARSER (DAY-GROUPING BY DATE TOKEN) =======
async function parseRosterPdfToDuties(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();

    const items = tc.items
      .map(it => {
        const [, , , , x, y] = it.transform || [];
        return { str: (it.str || '').trim(), x: x || 0, y: y || 0, page: p };
      })
      .filter(i => i.str);

    const buckets = {};
    for (const it of items) {
      const key = `${p}-${Math.round(it.y * 2) / 2}`;
      (buckets[key] ||= []).push(it);
    }

    for (const k in buckets) {
      buckets[k].sort((a, b) => a.x - b.x);
      const text = buckets[k].map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
      if (text) lines.push({ page: p, y: buckets[k][0].y, text });
    }
  }

  lines.sort((a, b) => a.page - b.page || b.y - a.y);

  const dateRe = /\b\d{2}[A-Z]{3}\d{2}\b/;
  const duties = [];
  let current = null;

  for (const ln of lines) {
    if (/Roster Report|Hotel Codes|Training Codes|Duty Codes/i.test(ln.text)) continue;

    const m = ln.text.match(dateRe);
    const isNewDay = m && ln.text.indexOf(m[0]) < 6;

    if (isNewDay) {
      if (current) duties.push(current);
      current = { startDate: m[0], dutyCodes: [], flights: [], sectors: [], times: [], hotels: [], remarks: [] };
    }
    if (!current) continue;

    ln.text.match(/\bFLY|TVL|LO|RDO\b/g)?.forEach(c => current.dutyCodes.push(c));
    ln.text.match(/\bVA\s?\d{3,4}\b/g)?.forEach(f => current.flights.push(f.replace(/\s+/g, '')));
    ln.text.match(/\b[A-Z]{3}\s+[A-Z]{3}\b/g)?.forEach(s => current.sectors.push(s.replace(/\s+/g, '-')));
    ln.text.match(/\b\d{4}\b/g)?.forEach(t => current.times.push(t));
    ln.text.match(/\b[A-Z]{3}\d\b|\b[A-Z]{4}\b/g)?.forEach(h => current.hotels.push(h));
    ln.text.match(/\bRTP\d[\w-]*\b/g)?.forEach(r => current.remarks.push(r));
    ln.text.match(/\bOA\s+\d{1,2}\/\d{1,2}\s+[A-Z]{3}\b/g)?.forEach(o => current.remarks.push(o));
  }

  if (current) duties.push(current);

  duties.forEach(d => {
    d.dutyCodes = uniq(d.dutyCodes);
    d.flights = uniq(d.flights);
    d.sectors = uniq(d.sectors);
    d.times = uniq(d.times);
    d.hotels = uniq(d.hotels);
    d.remarks = uniq(d.remarks);
  });

  return duties;
}

// ======= HELPERS =======
function uniq(arr) { return [...new Set((arr || []).filter(Boolean))]; }
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
