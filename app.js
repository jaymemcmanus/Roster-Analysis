// =================== ELEMENT REFERENCES ===================
const elInput   = document.getElementById('input');
const elStatus  = document.getElementById('status');
const elSummary = document.getElementById('summary');
const elDuties  = document.getElementById('duties');

const pasteBtn  = document.getElementById('pasteBtn');
const clearBtn  = document.getElementById('clearBtn');
const pdfFile   = document.getElementById('pdfFile');

// ======= SIMPLE ON-SCREEN LOGGER =======
function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  if (elStatus) elStatus.textContent = line;
}

// Catch silent JS errors and show them on-screen
window.addEventListener('error', (e) => log(`JS ERROR: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => {
  const msg = e?.reason?.message || String(e.reason || e);
  log(`PROMISE ERROR: ${msg}`);
});

log("app.js loaded ✅");

// =================== BASIC BUTTONS ===================
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

// =================== PDF.JS SETUP ===================
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  log("pdfjsLib detected ✅");
} else {
  log("pdfjsLib NOT found ❌ (PDF.js script didn’t load)");
}

// =================== FILE PICKER HANDLERS ===================
window.__onPdfSelected = function (input) {
  log("Inline onchange fired (Safari fallback)");
  const file = input?.files?.[0];
  if (!file) return log("No file in inline handler");
  handlePdfFile(file);
};

pdfFile?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return log("No file selected (standard handler)");
  log("Standard change fired");
  handlePdfFile(file);
});

async function handlePdfFile(file) {
  try {
    log(`File selected: ${file.name} (${Math.round(file.size / 1024)} KB)`);
    if (!window.pdfjsLib) throw new Error("PDF.js not loaded (pdfjsLib undefined)");

    log("Starting PDF parse…");
    const dutyDays = await parseRosterPdfToDutyDays(file);
    log(`PDF parsed. Duty-days found: ${dutyDays.length}`);

    const payload = {
      source: "pdf",
      capturedAt: new Date().toISOString(),
      fileName: file.name,
      duties: dutyDays
    };

    elInput.value = JSON.stringify(payload, null, 2);
    parseAndRender();
  } catch (err) {
    const msg = err?.message || String(err);
    log(`PDF import failed: ${msg}`);
    alert(`PDF import failed:\n${msg}`);
  } finally {
    if (pdfFile) pdfFile.value = '';
  }
}

// =================== MAIN PARSE + RENDER ===================
function parseAndRender(silent = false) {
  const txt = (elInput?.value || '').trim();
  if (!txt) return;

  let data;
  try {
    data = JSON.parse(txt);
  } catch {
    if (!silent) log("Invalid JSON in textarea");
    return;
  }

  const duties = data?.duties ? normalizeDutyDaysForTable(data.duties) : [];
  log(`Rendered: Source=${data.source || 'manual'} | Duties=${duties.length}`);

  renderSummary(duties);
  renderDutiesTable(duties);
}

function normalizeDutyDaysForTable(days) {
  return (days || []).map(d => ({
    startDate: d.startDate || '',
    duty: (d.dutyCodes && d.dutyCodes[0]) || '',
    flightNumber: (d.flights || []).join(', '),
    sector: (d.sectors || []).join(', '),
    rpt: (d.times || [])[0] || '',
    signOff: (d.times || []).slice(-1)[0] || '',
    hotel: (d.hotels || []).join(', '),
    remarks: (d.remarks || []).join(' | ')
  }));
}

// =================== SUMMARY (SANITY) ===================
function renderSummary(duties) {
  const counts = {};
  for (const d of duties) counts[d.duty] = (counts[d.duty] || 0) + 1;

  const uniqueDates = uniq(duties.map(d => d.startDate)).length;

  elSummary.innerHTML = `
    <table>
      <tr><th>Metric</th><th>Value</th></tr>
      <tr><td>Duty blocks (rows)</td><td>${duties.length}</td></tr>
      <tr><td>Unique dates</td><td>${uniqueDates}</td></tr>
      <tr><td>Duty mix</td><td class="mono">${escapeHtml(JSON.stringify(counts))}</td></tr>
    </table>
  `;
}

// =================== DUTIES TABLE ===================
function renderDutiesTable(duties) {
  if (!duties.length) {
    elDuties.innerHTML = '<div class="muted">No duties detected.</div>';
    return;
  }

  let html = `
    <table>
      <tr>
        <th>Date</th><th>Duty</th><th>Flights</th><th>Sectors</th>
        <th>Rpt</th><th>Sign Off</th><th>Hotels</th><th>Remarks</th>
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

// =================== PDF PARSER (IMPROVED) ===================
async function parseRosterPdfToDutyDays(file) {
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
      const key = `${p}-${Math.round(it.y * 2) / 2}`; // 0.5 resolution
      (buckets[key] ||= []).push(it);
    }

    for (const k in buckets) {
      buckets[k].sort((a, b) => a.x - b.x);
      const text = buckets[k].map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
      if (text) lines.push({ page: p, y: buckets[k][0].y, text });
    }
  }

  lines.sort((a, b) => a.page - b.page || b.y - a.y);

  // New-day rule: date token + weekday token near the start of the line
  const dateRe = /\b\d{2}[A-Z]{3}\d{2}\b/;
  const dowRe  = /\b(SUN|MON|TUE|WED|THU|FRI|SAT)\b/;

  const dutyDays = [];
  let current = null;

  for (const ln of lines) {
    const t = ln.text;

    // Skip obvious non-roster lines/legends/headers
    if (/Roster Report|Hotel Codes|Training Codes|Duty Codes/i.test(t)) continue;
    if (/\bSTD\b.*\bSTA\b/i.test(t)) continue; // header line
    if (/Start Date|Pairing Duty|Flt Time|Duty Time|Sign Off/i.test(t)) continue;

    const dm = t.match(dateRe);
    const dow = t.match(dowRe);
    const dateNearStart = dm && t.indexOf(dm[0]) <= 6;

    const isNewDay = Boolean(dateNearStart && dow && t.indexOf(dow[0]) < 25);

    if (isNewDay) {
      if (current) dutyDays.push(current);
      current = {
        startDate: dm[0],
        dutyCodes: [],
        flights: [],
        sectors: [],
        times: [],
        hotels: [],
        remarks: []
      };
    }

    if (!current) continue;

    // Duty codes
    t.match(/\bFLY|TVL|LO|RDO\b/g)?.forEach(c => current.dutyCodes.push(c));

    // Flights VA0916 / VA 0916
    t.match(/\bVA\s?\d{3,4}\b/g)?.forEach(f => current.flights.push(f.replace(/\s+/g, '')));

    // Sectors: two IATA codes adjacent, but NOT "STD STA"
    t.match(/\b[A-Z]{3}\s+[A-Z]{3}\b/g)?.forEach(s => {
      const cleaned = s.replace(/\s+/g, ' ');
      if (cleaned === "STD STA") return;
      current.sectors.push(cleaned.replace(/\s+/g, '-'));
    });

    // Times: accept only valid HHMM (0000–2359)
    (t.match(/\b\d{4}\b/g) || []).forEach(raw => {
      const hh = parseInt(raw.slice(0,2), 10);
      const mm = parseInt(raw.slice(2,4), 10);
      if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) current.times.push(raw);
    });

    // Training codes (keep as remarks)
    t.match(/\bRTP\d[\w-]*\b/g)?.forEach(r => current.remarks.push(r));

    // OA remark
    t.match(/\bOA\s+\d{1,2}\/\d{1,2}\s+[A-Z]{3}\b/g)?.forEach(o => current.remarks.push(o));

    // Hotels: allow patterns like BNEO, MEL1, CBR5 (exclude RTP*)
    (t.match(/\b[A-Z]{3}\d\b|\b[A-Z]{4}\b/g) || []).forEach(h => {
      if (/^RTP/i.test(h)) return;
      // Keep likely hotel tokens (BNEO, MEL1, CBR5 etc)
      if (/^[A-Z]{4}$/.test(h) || /^[A-Z]{3}\d$/.test(h)) current.hotels.push(h);
    });
  }

  if (current) dutyDays.push(current);

  // Deduplicate
  dutyDays.forEach(d => {
    d.dutyCodes = uniq(d.dutyCodes);
    d.flights   = uniq(d.flights);
    d.sectors   = uniq(d.sectors);
    d.times     = uniq(d.times);
    d.hotels    = uniq(d.hotels);
    d.remarks   = uniq(d.remarks);
  });

  return dutyDays;
}

// =================== HELPERS ===================
function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  );
}
