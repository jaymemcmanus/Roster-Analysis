const elInput   = document.getElementById('input');
const elStatus  = document.getElementById('status');
const elWindows = document.getElementById('windows');
const elSummary = document.getElementById('summary');
const elDuties  = document.getElementById('duties');
const elDebug   = document.getElementById('debug');

const pasteBtn  = document.getElementById('pasteBtn');
const clearBtn  = document.getElementById('clearBtn');
const pdfFile   = document.getElementById('pdfFile');

const elFortnightStart = document.getElementById('fortnightStart');
const elPayDate = document.getElementById('payDate');
const elPayRunType = document.getElementById('payRunType');

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  if (elStatus) elStatus.textContent = line;
}
function debug(obj) {
  if (!elDebug) return;
  elDebug.textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
}
window.addEventListener('error', (e) => log(`JS ERROR: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => {
  const msg = e?.reason?.message || String(e.reason || e);
  log(`PROMISE ERROR: ${msg}`);
});

log("app.js loaded ✅ (v16)");

let lastParsedDutyDays = [];

const LS_FORTNIGHT_START = "va_fortnight_start";
const LS_PAY_DATE = "va_pay_date";
const LS_PAYRUN_TYPE = "va_payrun_type";

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
  const pd = elPayDate.value;
  if (pd) {
    const pay = isoToDate(pd);
    const periodEnd = addDays(pay, -4);
    const periodStart = addDays(periodEnd, -13);
    const suggested = toISO(periodStart);
    if (!elFortnightStart.value) elFortnightStart.value = suggested;
    localStorage.setItem(LS_FORTNIGHT_START, elFortnightStart.value || suggested);
  }
  renderAll();
});

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
  if (elWindows) elWindows.innerHTML = '';
  if (elSummary) elSummary.innerHTML = '';
  if (elDuties) elDuties.innerHTML = '';
  if (elDebug) elDebug.textContent = '';
});

elInput?.addEventListener('input', () => {
  parseInputJson(true);
  renderAll(true);
});

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  log("pdfjsLib detected ✅");
} else {
  log("pdfjsLib NOT found ❌ (PDF.js script didn’t load)");
}

window.__onPdfSelected = function (input) {
  log("Inline onchange fired (Safari fallback)");
  const file = input?.files?.[0];
  if (!file) return log("No file in inline handler");
  handlePdfFile(file);
};

pdfFile?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return log("No file selected");
  handlePdfFile(file);
});

async function handlePdfFile(file) {
  try {
    log(`File selected: ${file.name} (${Math.round(file.size / 1024)} KB)`);
    if (!window.pdfjsLib) throw new Error("PDF.js not loaded (pdfjsLib undefined)");

    log("Starting PDF parse…");
    const { dutyDays, parserDebug } = await parseRosterPdfToDutyDays(file);
    debug(parserDebug);

    log(`PDF parsed. Duty-days found: ${dutyDays.length}`);
    lastParsedDutyDays = dutyDays;

    elInput.value = JSON.stringify({
      source: "pdf",
      capturedAt: new Date().toISOString(),
      fileName: file.name,
      duties: dutyDays
    }, null, 2);

    if (!elFortnightStart.value && dutyDays.length) {
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

function parseInputJson(silent = false) {
  const txt = (elInput?.value || '').trim();
  if (!txt) return;

  let data;
  try { data = JSON.parse(txt); }
  catch { if (!silent) log("Invalid JSON"); return; }

  if (Array.isArray(data?.duties)) {
    lastParsedDutyDays = data.duties;
    if (!silent) log(`Loaded duties from JSON | Duties=${lastParsedDutyDays.length}`);
  }
}

function renderAll(silent = false) {
  const dutyRows = normalizeDutyDaysForTable(lastParsedDutyDays);

  const fortnightStart = elFortnightStart?.value || "";
  const payDateISO = elPayDate?.value || "";
  const payRunType = elPayRunType?.value || "allowances";

  const windows = computeWindows(fortnightStart, payDateISO);
  renderWindows(windows, payRunType);

  const withBucket = tagDutiesByWindow(dutyRows, windows);

  const oaFromRemark = computeOAStartDateKeys(withBucket);

  // NEW: OA from LO + hotel BNEO
  const oaFromHotel = computeOAFromOwnAccom(withBucket);

  const oaUnion = new Set([...oaFromRemark, ...oaFromHotel]);

  const withFlags = withBucket.map(r => addFlags(r, oaUnion));

  renderSummary(withFlags, windows, payRunType);
  renderDutiesTable(withFlags);

  if (!silent) log(`Rendered | Duties=${dutyRows.length}`);
}

function computeWindows(fortnightStartISO, payDateISO) {
  if (!fortnightStartISO) return null;

  const start = isoToDate(fortnightStartISO);
  const currentStart = start;
  const currentEnd = addDays(currentStart, 13);

  const prevStart = addDays(currentStart, -14);
  const prevEnd = addDays(currentStart, -1);

  const inferredPayDate = addDays(currentEnd, 4);

  let enteredPayDate = payDateISO ? isoToDate(payDateISO) : null;
  let payDeltaDays = null;
  if (enteredPayDate) payDeltaDays = Math.round((enteredPayDate - inferredPayDate) / (24*3600*1000));

  return {
    current: { start: currentStart, end: currentEnd },
    prev: { start: prevStart, end: prevEnd },
    inferredPayDate,
    enteredPayDate,
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
    const d = windows.payDeltaDays;
    const deltaTxt = d === 0 ? "matches inferred" : (d > 0 ? `is ${d} day(s) later` : `is ${Math.abs(d)} day(s) earlier`);
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

// OA 12/13 BNE → OA only on 12DEC25 (start day)
function computeOAStartDateKeys(rows) {
  const out = new Set();
  for (const r of rows) {
    const remarks = String(r.remarks || "");
    const dtBase = rosterDateToDate(r.startDate);
    if (!dtBase) continue;

    const matches = remarks.match(/\bOA\s+\d{1,2}\/\d{1,2}\s+[A-Z]{3}\b/gi) || [];
    for (const s of matches) {
      const m = s.match(/\bOA\s+(\d{1,2})\/(\d{1,2})\s+([A-Z]{3})\b/i);
      if (!m) continue;
      const d1 = parseInt(m[1], 10);
      const oaDate = new Date(dtBase.getFullYear(), dtBase.getMonth(), d1);
      out.add(dateToRosterKey(oaDate));
    }
  }
  return out;
}

// NEW: LO + hotel includes BNEO => OA
function computeOAFromOwnAccom(rows) {
  const out = new Set();
  for (const r of rows) {
    const dutyCodesAll = String(r.dutyCodesAll || "");
    const hasLO = /\bLO\b/.test(dutyCodesAll) || r.duty === "LO";
    const hotels = String(r.hotel || "");
    const hasBNEO = /\bBNEO\b/.test(hotels);
    if (hasLO && hasBNEO) out.add(r.startDate);
  }
  return out;
}

function dateToRosterKey(dt) {
  const dd = String(dt.getDate()).padStart(2, '0');
  const mmm = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][dt.getMonth()];
  const yy = String(dt.getFullYear()).slice(-2);
  return `${dd}${mmm}${yy}`;
}

function addFlags(r, oaStartDateKeys) {
  const flags = [];

  const dutyCodesAll = r.dutyCodesAll || "";
  const hasFLY = /\bFLY\b/.test(dutyCodesAll) || (r.flightNumber || "").trim().length > 0;
  const hasLO  = /\bLO\b/.test(dutyCodesAll);
  const hasTVL = /\bTVL\b/.test(dutyCodesAll);
  const hasRDO = /\bRDO\b/.test(dutyCodesAll);
  const hasTRN = /\bRTP\d/i.test(String(r.remarks || ""));
  const hasOA  = oaStartDateKeys?.has(r.startDate);

  if (hasFLY) flags.push("FLY");
  if (hasLO) flags.push("LO");
  if (hasTVL) flags.push("TVL");
  if (hasRDO) flags.push("RDO");
  if (hasTRN) flags.push("TRN");
  if (hasOA) flags.push("OA");

  return { ...r, flags };
}

function renderSummary(rows, windows, payRunType) {
  if (!windows) {
    elSummary.innerHTML = `<div class="muted">Pick a fortnight start date to see counts by posting window.</div>`;
    return;
  }

  const cur = rows.filter(r => r.bucket === "CURRENT");
  const prev = rows.filter(r => r.bucket === "PREV");

  const dutyMix = (arr) => {
    const m = {};
    for (const r of arr) {
      const key = r.duty || "(blank)";
      m[key] = (m[key] || 0) + 1;
    }
    return m;
  };

  const flagCounts = (arr) => {
    const c = {};
    for (const r of arr) {
      for (const f of (r.flags || [])) c[f] = (c[f] || 0) + 1;
    }
    return c;
  };

  const extrasLabel = payRunType === "allowances" ? "Allowances (prev)" : "WDO/OT (prev)";

  elSummary.innerHTML = `
    <table>
      <tr><th>Bucket</th><th>Duty-days</th><th>Duty mix</th><th>Flag counts</th></tr>
      <tr>
        <td><span class="pill">CURRENT</span></td>
        <td>${cur.length}</td>
        <td class="mono">${escapeHtml(JSON.stringify(dutyMix(cur)))}</td>
        <td class="mono">${escapeHtml(JSON.stringify(flagCounts(cur)))}</td>
      </tr>
      <tr>
        <td><span class="pill">PREV</span> ${escapeHtml(extrasLabel)}</td>
        <td>${prev.length}</td>
        <td class="mono">${escapeHtml(JSON.stringify(dutyMix(prev)))}</td>
        <td class="mono">${escapeHtml(JSON.stringify(flagCounts(prev)))}</td>
      </tr>
    </table>
  `;
}

function renderDutiesTable(rows) {
  if (!rows.length) {
    elDuties.innerHTML = '<div class="muted">No duties detected.</div>';
    return;
  }

  const flagHtml = (flags) => (flags || []).map(f => `<span class="flag">${escapeHtml(f)}</span>`).join(' ');

  let html = `
    <table>
      <tr>
        <th>Bucket</th><th>Date</th><th>Flags</th><th>Duty</th><th>Flights</th><th>Sectors</th>
        <th>Rpt</th><th>Sign Off</th><th>Hotels</th><th>Remarks</th>
      </tr>
  `;

  for (const r of rows) {
    html += `
      <tr>
        <td>${r.bucket ? `<span class="pill">${escapeHtml(r.bucket)}</span>` : ''}</td>
        <td>${escapeHtml(r.startDate)}</td>
        <td>${flagHtml(r.flags)}</td>
        <td>${escapeHtml(r.duty)}</td>
        <td>${escapeHtml(r.flightNumber)}</td>
        <td>${escapeHtml(r.sector)}</td>
        <td>${escapeHtml(r.rpt)}</td>
        <td>${escapeHtml(r.signOff)}</td>
        <td>${escapeHtml(r.hotel)}</td>
        <td>${escapeHtml(r.remarks)}</td>
      </tr>
    `;
  }

  html += '</table>';
  elDuties.innerHTML = html;
}

function normalizeDutyDaysForTable(days) {
  return (days || []).map(d => ({
    startDate: d.startDate || '',
    duty: (d.dutyCodes && d.dutyCodes[0]) || '',
    dutyCodesAll: (d.dutyCodes || []).join(' '),
    flightNumber: (d.flights || []).join(', '),
    sector: (d.sectors || []).join(', '),
    rpt: (d.times || [])[0] || '',
    signOff: (d.times || []).slice(-1)[0] || '',
    hotel: (d.hotels || []).join(', '),
    remarks: (d.remarks || []).join(' | ')
  }));
}

// ===== PDF PARSER: airport-only sector pairing =====
async function parseRosterPdfToDutyDays(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  let sectorX = null;
  let headerFound = false;

  const parserDebug = { headerFound: false, sectorX: null, notes: [], sampleRows: [] };
  const dutyDays = [];
  let current = null;

  const dateRe = /\b\d{2}[A-Z]{3}\d{2}\b/;
  const dowRe  = /\b(SUN|MON|TUE|WED|THU|FRI|SAT)\b/;
  const DOW = new Set(["SUN","MON","TUE","WED","THU","FRI","SAT"]);

  const NOT_AIRPORT = new Set([
    "STD","STA","RPT","SIM","DAY","OFF",
    "TVL","FLY","RDO","FWA","LO",
    "BNEO","MEL1","CBR5","OOL1","PER1",
  ]);

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();

    const items = tc.items
      .map(it => {
        const [, , , , x, y] = it.transform || [];
        return { str: (it.str || '').trim(), x: x || 0, y: y || 0, page: p };
      })
      .filter(i => i.str);

    const rows = groupByY(items, 1.2);

    for (const row of rows) {
      row.sort((a,b)=>a.x-b.x);
      const text = row.map(i=>i.str).join(' ').replace(/\s+/g,' ').trim();

      if (/Roster Report|Hotel Codes|Training Codes|Duty Codes/i.test(text)) continue;

      if (!headerFound && /Flight\s+Number/i.test(text) && /\bSector\b/i.test(text)) {
        headerFound = true;
        parserDebug.headerFound = true;

        const sectorTok = row.find(i => /^Sector$/i.test(i.str));
        const acTok = row.find(i => /^A\/C$/i.test(i.str) || /^A\/C$/i.test(i.str.replace(/\s/g,'')));

        if (sectorTok) {
          const left = sectorTok.x - 8;
          const right = acTok ? (acTok.x - 8) : (sectorTok.x + 90);
          sectorX = { left, right };
          parserDebug.sectorX = sectorX;
          parserDebug.notes.push(`Header found p${p}. Sector x=[${left.toFixed(1)}, ${right.toFixed(1)}]`);
        } else {
          parserDebug.notes.push(`Header found but Sector token missing x.`);
        }
        continue;
      }

      const dm = text.match(dateRe);
      const dow = text.match(dowRe);
      const dateNearStart = dm && text.indexOf(dm[0]) <= 6;
      const isNewDay = Boolean(dateNearStart && dow && text.indexOf(dow[0]) < 25);

      if (isNewDay) {
        if (current) dutyDays.push(current);
        current = { startDate: dm[0], dutyCodes: [], flights: [], sectors: [], times: [], hotels: [], remarks: [] };
      }
      if (!current) continue;

      (text.match(/\bFLY|TVL|LO|RDO\b/g) || []).forEach(c => current.dutyCodes.push(c));
      (text.match(/\bVA\s?\d{3,4}\b/g) || []).forEach(f => current.flights.push(f.replace(/\s+/g, '')));

      (text.match(/\b\d{4}\b/g) || []).forEach(raw => {
        const hh = parseInt(raw.slice(0,2), 10);
        const mm = parseInt(raw.slice(2,4), 10);
        if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) current.times.push(raw);
      });

      (text.match(/\bRTP\d[\w-]*\b/g) || []).forEach(r => current.remarks.push(r));
      (text.match(/\bOA\s+\d{1,2}\/\d{1,2}\s+[A-Z]{3}\b/g) || []).forEach(o => current.remarks.push(o));

      (text.match(/\b[A-Z]{3}\d\b|\b[A-Z]{4}\b/g) || []).forEach(h => {
        if (/^RTP/i.test(h)) return;
        if (DOW.has(h)) return;
        if (/^[A-Z]{4}$/.test(h) || /^[A-Z]{3}\d$/.test(h)) current.hotels.push(h);
      });

      const hasVaFlight = row.some(i => /\bVA\d{3,4}\b/.test(i.str.replace(/\s+/g,'')));
      if (hasVaFlight && sectorX) {
        const rawTokens = row
          .filter(i => i.x >= sectorX.left && i.x <= sectorX.right)
          .map(i => i.str.toUpperCase())
          .flatMap(s => s.split(/[^A-Z]/g).filter(Boolean));

        const airportTokens = rawTokens
          .filter(s => /^[A-Z]{3}$/.test(s))
          .filter(s => !DOW.has(s))
          .filter(s => !NOT_AIRPORT.has(s));

        if (airportTokens.length >= 2) {
          for (let i = 0; i + 1 < airportTokens.length; i += 2) {
            const a = airportTokens[i], b = airportTokens[i+1];
            if (a && b && a !== b) current.sectors.push(`${a}-${b}`);
          }
        }

        if (parserDebug.sampleRows.length < 10) {
          parserDebug.sampleRows.push({
            page: p,
            day: current.startDate,
            rowText: text,
            rawTokens,
            airportTokens,
            sectorX
          });
        }
      }
    }
  }

  if (current) dutyDays.push(current);

  for (const d of dutyDays) {
    d.dutyCodes = uniq(d.dutyCodes);
    d.flights   = uniq(d.flights);
    d.times     = uniq(d.times);
    d.hotels    = uniq(d.hotels);
    d.remarks   = uniq(d.remarks);
    d.sectors   = uniq((d.sectors || []).filter(s => /^[A-Z]{3}-[A-Z]{3}$/.test(s)));
  }

  if (!parserDebug.headerFound) {
    parserDebug.notes.push("WARNING: Header not found; sector column x-range unavailable.");
  }

  return { dutyDays, parserDebug };
}

function groupByY(items, tol = 1.0) {
  const sorted = [...items].sort((a,b)=> b.y - a.y);
  const out = [];
  for (const it of sorted) {
    let placed = false;
    for (const g of out) {
      if (Math.abs(g[0].y - it.y) <= tol) { g.push(it); placed = true; break; }
    }
    if (!placed) out.push([it]);
  }
  return out;
}

function isoToDate(iso) {
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
  return new Date(2000 + yy, mm, dd);
}

function uniq(arr) { return [...new Set((arr || []).filter(Boolean))]; }
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  );
}
