// =================== ELEMENT REFERENCES ===================
const elInput   = document.getElementById('input');
const elStatus  = document.getElementById('status');
const elWindows = document.getElementById('windows');
const elSummary = document.getElementById('summary');
const elDuties  = document.getElementById('duties');

const pasteBtn  = document.getElementById('pasteBtn');
const clearBtn  = document.getElementById('clearBtn');
const pdfFile   = document.getElementById('pdfFile');

const elFortnightStart = document.getElementById('fortnightStart');
const elPayDate = document.getElementById('payDate');
const elPayRunType = document.getElementById('payRunType');

// ======= LOGGER =======
function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  if (elStatus) elStatus.textContent = line;
}
window.addEventListener('error', (e) => log(`JS ERROR: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => {
  const msg = e?.reason?.message || String(e.reason || e);
  log(`PROMISE ERROR: ${msg}`);
});

log("app.js loaded ✅");

// =================== STATE ===================
let lastParsedDutyDays = [];

// =================== STORAGE KEYS ===================
const LS_FORTNIGHT_START = "va_fortnight_start";
const LS_PAY_DATE = "va_pay_date";
const LS_PAYRUN_TYPE = "va_payrun_type";

// Restore
(function restoreUiState() {
  const fs = localStorage.getItem(LS_FORTNIGHT_START);
  const pd = localStorage.getItem(LS_PAY_DATE);
  const pt = localStorage.getItem(LS_PAYRUN_TYPE);
  if (fs && elFortnightStart) elFortnightStart.value = fs;
  if (pd && elPayDate) elPayDate.value = pd;
  if (pt && elPayRunType) elPayRunType.value = pt;
})();

elFortnightStart?.addEventListener('change', () => {
  localStorage.setItem(LS_FORTNIGHT_START, elFortnightStart.value || "");
  renderAll();
});

elPayRunType?.addEventListener('change', () => {
  localStorage.setItem(LS_PAYRUN_TYPE, elPayRunType.value || "allowances");
  renderAll();
});

elPayDate?.addEventListener('change', () => {
  localStorage.setItem(LS_PAY_DATE, elPayDate.value || "");
  // Suggest fortnight start based on observed pattern:
  // PeriodEnd = PayDate - 4 days; PeriodStart = PeriodEnd - 13 days
  const pd = elPayDate.value;
  if (pd) {
    const pay = isoToDate(pd);
    const periodEnd = addDays(pay, -4);
    const periodStart = addDays(periodEnd, -13);
    const suggested = toISO(periodStart);
    // Only auto-set if fortnightStart is empty or user wants it aligned
    if (!elFortnightStart.value) elFortnightStart.value = suggested;
    localStorage.setItem(LS_FORTNIGHT_START, elFortnightStart.value || suggested);
  }
  renderAll();
});

// =================== BUTTONS ===================
pasteBtn?.addEventListener('click', async () => {
  log("Paste button clicked");
  try {
    const txt = await navigator.clipboard.readText();
    elInput.value = txt;
    parseInputJson();
    renderAll();
  } catch {
    log("Clipboard read failed. Paste manually into the box.");
  }
});

clearBtn?.addEventListener('click', () => {
  log("Clear clicked");
  elInput.value = '';
  lastParsedDutyDays = [];
  elWindows.innerHTML = '';
  elSummary.innerHTML = '';
  elDuties.innerHTML = '';
});

elInput?.addEventListener('input', () => {
  parseInputJson(true);
  renderAll(true);
});

// =================== PDF.JS SETUP ===================
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  log("pdfjsLib detected ✅");
} else {
  log("pdfjsLib NOT found ❌ (PDF.js script didn’t load)");
}

// =================== FILE PICKER ===================
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

    lastParsedDutyDays = dutyDays;

    // Write debug JSON
    elInput.value = JSON.stringify({
      source: "pdf",
      capturedAt: new Date().toISOString(),
      fileName: file.name,
      duties: dutyDays
    }, null, 2);

    // Auto-suggest fortnight start from roster date range if empty
    if (!elFortnightStart.value && dutyDays.length) {
      // Choose earliest date in duties list
      const dates = dutyDays.map(d => rosterDateToDate(d.startDate)).filter(Boolean).sort((a,b)=>a-b);
      if (dates.length) {
        elFortnightStart.value = toISO(dates[0]);
        localStorage.setItem(LS_FORTNIGHT_START, elFortnightStart.value);
      }
    }

    renderAll();
  } catch (err) {
    const msg = err?.message || String(err);
    log(`PDF import failed: ${msg}`);
    alert(`PDF import failed:\n${msg}`);
  } finally {
    if (pdfFile) pdfFile.value = '';
  }
}

// =================== INPUT JSON ===================
function parseInputJson(silent = false) {
  const txt = (elInput?.value || '').trim();
  if (!txt) return;

  let data;
  try {
    data = JSON.parse(txt);
  } catch {
    if (!silent) log("Invalid JSON in textarea");
    return;
  }

  if (Array.isArray(data?.duties)) {
    lastParsedDutyDays = data.duties;
    log(`Loaded duties from JSON | Duties=${lastParsedDutyDays.length}`);
  }
}

// =================== RENDER PIPELINE ===================
function renderAll(silent = false) {
  const dutyRows = normalizeDutyDaysForTable(lastParsedDutyDays);

  const fortnightStart = elFortnightStart?.value || "";
  const payDateISO = elPayDate?.value || "";
  const payRunType = elPayRunType?.value || "allowances";

  const windows = computeWindows(fortnightStart, payDateISO);

  renderWindows(windows, payRunType);

  const tagged = tagDutiesByWindow(dutyRows, windows);
  renderSummary(tagged, windows, payRunType);
  renderDutiesTable(tagged);

  if (!silent) log(`Rendered | Duties=${dutyRows.length}`);
}

// =================== WINDOWS ===================
function computeWindows(fortnightStartISO, payDateISO) {
  if (!fortnightStartISO) return null;

  const start = isoToDate(fortnightStartISO);
  const currentStart = start;
  const currentEnd = addDays(currentStart, 13);

  const prevStart = addDays(currentStart, -14);
  const prevEnd = addDays(currentStart, -1);

  // Helper: infer paydate from start using observed offset (end +4)
  const inferredPayDate = addDays(currentEnd, 4);

  // If user entered a pay date, show delta vs inferred
  let payDate = payDateISO ? isoToDate(payDateISO) : null;
  let payDeltaDays = null;
  if (payDate) {
    payDeltaDays = Math.round((payDate - inferredPayDate) / (24*3600*1000));
  }

  return {
    current: { start: currentStart, end: currentEnd },
    prev: { start: prevStart, end: prevEnd },
    inferredPayDate,
    enteredPayDate: payDate,
    payDeltaDays
  };
}

function renderWindows(windows, payRunType) {
  if (!windows) {
    elWindows.innerHTML = `<div class="muted">Select a fortnight start date to compute posting windows.</div>`;
    return;
  }

  const extrasLabel = payRunType === "allowances"
    ? "Allowances posted for PREVIOUS fortnight"
    : "WDO/Overtime posted for PREVIOUS fortnight";

  const inferred = windows.inferredPayDate;
  const entered = windows.enteredPayDate;

  let payLine = `<div class="muted">Inferred pay date (from start): <b>${fmtDate(inferred)}</b> (end + 4 days)</div>`;
  if (entered) {
    const delta = windows.payDeltaDays;
    const deltaTxt = delta === 0 ? "matches inferred" : (delta > 0 ? `is ${delta} day(s) later` : `is ${Math.abs(delta)} day(s) earlier`);
    payLine = `<div class="muted">Entered pay date: <b>${fmtDate(entered)}</b> — ${deltaTxt} than inferred (<b>${fmtDate(inferred)}</b>)</div>`;
  }

  elWindows.innerHTML = `
    ${payLine}
    <table style="margin-top:10px;">
      <tr><th>Bucket</th><th>Date range</th><th>Notes</th></tr>
      <tr>
        <td><span class="pill">CURRENT</span> Standard pay period</td>
        <td>${fmtDate(windows.current.start)} → ${fmtDate(windows.current.end)} (14 days)</td>
        <td>Standard fortnight pay assumed to apply here.</td>
      </tr>
      <tr>
        <td><span class="pill">PREV</span> Extras posting period</td>
        <td>${fmtDate(windows.prev.start)} → ${fmtDate(windows.prev.end)} (14 days)</td>
        <td>${extrasLabel}.</td>
      </tr>
    </table>
  `;
}

// =================== DUTY TAGGING & SUMMARY ===================
function tagDutiesByWindow(duties, windows) {
  if (!windows) return duties.map(d => ({ ...d, bucket: "" }));

  return duties.map(d => {
    const dt = rosterDateToDate(d.startDate);
    if (!dt) return { ...d, bucket: "" };

    if (inRange(dt, windows.current.start, windows.current.end)) return { ...d, bucket: "CURRENT" };
    if (inRange(dt, windows.prev.start, windows.prev.end)) return { ...d, bucket: "PREV" };
    return { ...d, bucket: "" };
  });
}

function renderSummary(taggedDuties, windows, payRunType) {
  if (!windows) {
    elSummary.innerHTML = `<div class="muted">Pick a fortnight start date to see counts by posting window.</div>`;
    return;
  }

  const current = taggedDuties.filter(d => d.bucket === "CURRENT");
  const prev = taggedDuties.filter(d => d.bucket === "PREV");

  const mix = (arr) => {
    const m = {};
    for (const d of arr) m[d.duty] = (m[d.duty] || 0) + 1;
    return m;
  };

  const extrasLabel = payRunType === "allowances" ? "Allowances (prev)" : "WDO/OT (prev)";

  elSummary.innerHTML = `
    <table>
      <tr><th>Bucket</th><th>Duty-days</th><th>Duty mix</th></tr>
      <tr>
        <td><span class="pill">CURRENT</span> Standard period</td>
        <td>${current.length}</td>
        <td class="mono">${escapeHtml(JSON.stringify(mix(current)))}</td>
      </tr>
      <tr>
        <td><span class="pill">PREV</span> ${escapeHtml(extrasLabel)}</td>
        <td>${prev.length}</td>
        <td class="mono">${escapeHtml(JSON.stringify(mix(prev)))}</td>
      </tr>
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
        <th>Bucket</th><th>Date</th><th>Duty</th><th>Flights</th><th>Sectors</th>
        <th>Rpt</th><th>Sign Off</th><th>Hotels</th><th>Remarks</th>
      </tr>
  `;

  for (const d of duties) {
    html += `
      <tr>
        <td>${d.bucket ? `<span class="pill">${escapeHtml(d.bucket)}</span>` : ''}</td>
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

// =================== NORMALIZE ===================
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

// =================== PDF PARSER (STABLE v9) ===================
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
  const dowRe  = /\b(SUN|MON|TUE|WED|THU|FRI|SAT)\b/;

  const dutyDays = [];
  let current = null;

  for (const ln of lines) {
    const t = ln.text;

    if (/Roster Report|Hotel Codes|Training Codes|Duty Codes/i.test(t)) continue;
    if (/\bSTD\b.*\bSTA\b/i.test(t)) continue;
    if (/Start Date|Pairing Duty|Flt Time|Duty Time|Sign Off/i.test(t)) continue;

    const dm = t.match(dateRe);
    const dow = t.match(dowRe);
    const dateNearStart = dm && t.indexOf(dm[0]) <= 6;
    const isNewDay = Boolean(dateNearStart && dow && t.indexOf(dow[0]) < 25);

    if (isNewDay) {
      if (current) dutyDays.push(current);
      current = { startDate: dm[0], dutyCodes: [], flights: [], sectors: [], times: [], hotels: [], remarks: [] };
    }

    if (!current) continue;

    t.match(/\bFLY|TVL|LO|RDO\b/g)?.forEach(c => current.dutyCodes.push(c));
    t.match(/\bVA\s?\d{3,4}\b/g)?.forEach(f => current.flights.push(f.replace(/\s+/g, '')));

    t.match(/\b[A-Z]{3}\s+[A-Z]{3}\b/g)?.forEach(s => {
      const cleaned = s.replace(/\s+/g, ' ');
      if (cleaned === "STD STA") return;
      current.sectors.push(cleaned.replace(/\s+/g, '-'));
    });

    (t.match(/\b\d{4}\b/g) || []).forEach(raw => {
      const hh = parseInt(raw.slice(0,2), 10);
      const mm = parseInt(raw.slice(2,4), 10);
      if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) current.times.push(raw);
    });

    t.match(/\bRTP\d[\w-]*\b/g)?.forEach(r => current.remarks.push(r));
    t.match(/\bOA\s+\d{1,2}\/\d{1,2}\s+[A-Z]{3}\b/g)?.forEach(o => current.remarks.push(o));

    (t.match(/\b[A-Z]{3}\d\b|\b[A-Z]{4}\b/g) || []).forEach(h => {
      if (/^RTP/i.test(h)) return;
      if (/^[A-Z]{4}$/.test(h) || /^[A-Z]{3}\d$/.test(h)) current.hotels.push(h);
    });
  }

  if (current) dutyDays.push(current);

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

// =================== DATE HELPERS ===================
function isoToDate(iso) {
  // Date-only in local time (safe for our day math)
  const [y,m,d] = iso.split('-').map(n => parseInt(n,10));
  return new Date(y, m-1, d);
}
function toISO(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth()+1).padStart(2,'0');
  const d = String(dt.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}
function addDays(dt, n) {
  const x = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  x.setDate(x.getDate() + n);
  return x;
}
function fmtDate(dt) {
  return dt.toLocaleDateString(undefined, { year:'numeric', month:'short', day:'2-digit' });
}
function inRange(dt, start, end) {
  const t = dt.getTime(), a = start.getTime(), b = end.getTime();
  return t >= a && t <= b;
}
function rosterDateToDate(ddmmmyy) {
  if (!ddmmmyy || ddmmmyy.length !== 7) return null;
  const dd = parseInt(ddmmmyy.slice(0,2),10);
  const mmm = ddmmmyy.slice(2,5);
  const yy = parseInt(ddmmmyy.slice(5,7),10);
  const months = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 };
  const mm = months[mmm];
  if (mm === undefined) return null;
  const fullYear = 2000 + yy;
  return new Date(fullYear, mm, dd);
}

// =================== MISC HELPERS ===================
function uniq(arr) { return [...new Set((arr || []).filter(Boolean))]; }
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  );
}
