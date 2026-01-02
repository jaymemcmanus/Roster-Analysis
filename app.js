// =================== ELEMENT REFERENCES ===================
const elInput   = document.getElementById('input');
const elStatus  = document.getElementById('status');
const elSummary = document.getElementById('summary');
const elDuties  = document.getElementById('duties');

const pasteBtn  = document.getElementById('pasteBtn');
const clearBtn  = document.getElementById('clearBtn');
const pdfFile   = document.getElementById('pdfFile');

// =================== BASIC BUTTONS ===================
pasteBtn?.addEventListener('click', async () => {
  try {
    const txt = await navigator.clipboard.readText();
    elInput.value = txt;
    parseAndRender();
  } catch {
    elStatus.textContent = "Clipboard read failed. Paste manually into the box.";
  }
});

clearBtn?.addEventListener('click', () => {
  elInput.value = '';
  elSummary.innerHTML = '';
  elDuties.innerHTML = '';
  elStatus.textContent = '';
});

elInput?.addEventListener('input', () => parseAndRender(true));

// =================== PDF.JS SETUP ===================
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

// =================== PDF FILE PICKER ===================
pdfFile?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    elStatus.textContent = `Importing PDF: ${file.name} …`;
    const duties = await parseRosterPdfToDuties(file);

    const payload = {
      source: "pdf",
      capturedAt: new Date().toISOString(),
      fileName: file.name,
      duties
    };

    elInput.value = JSON.stringify(payload, null, 2);
    parseAndRender();
  } catch (err) {
    console.error(err);
    alert("PDF import failed. See console for details.");
    elStatus.textContent = "PDF import failed.";
  } finally {
    e.target.value = '';
  }
});

// =================== MAIN PARSE + RENDER ===================
function parseAndRender(silent = false) {
  const txt = elInput.value.trim();
  if (!txt) return;

  let data;
  try {
    data = JSON.parse(txt);
  } catch {
    if (!silent) elStatus.textContent = "Invalid JSON.";
    return;
  }

  const duties = data?.duties
    ? normalizePdfDuties(data.duties)
    : [];

  elStatus.textContent =
    `Source: ${data.source || 'manual'} | Duties: ${duties.length}`;

  renderSummary(duties);
  renderDuties(duties);
}

// =================== NORMALISER ===================
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

// =================== SUMMARY (TEMP / PLACEHOLDER) ===================
function renderSummary(duties) {
  const counts = {};
  for (const d of duties) {
    counts[d.duty] = (counts[d.duty] || 0) + 1;
  }

  elSummary.innerHTML = `
    <table>
      <tr><th>Metric</th><th>Value</th></tr>
      <tr><td>Total Duties</td><td>${duties.length}</td></tr>
      <tr><td>Duty Mix</td><td class="mono">${escapeHtml(JSON.stringify(counts))}</td></tr>
    </table>
  `;
}

// =================== DUTIES TABLE ===================
function renderDuties(duties) {
  if (!duties.length) {
    elDuties.innerHTML = '<div class="muted">No duties detected.</div>';
    return;
  }

  let html = `
    <table>
      <tr>
        <th>Date</th>
        <th>Duty</th>
        <th>Flight(s)</th>
        <th>Sector(s)</th>
        <th>Rpt</th>
        <th>Sign Off</th>
        <th>Hotel</th>
        <th>Remarks</th>
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

// =================== PDF PARSER ===================
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
        return { str: it.str.trim(), x: x || 0, y: y || 0, page: p };
      })
      .filter(i => i.str);

    const buckets = {};
    for (const it of items) {
      const key = `${p}-${Math.round(it.y * 2) / 2}`;
      (buckets[key] ||= []).push(it);
    }

    for (const k in buckets) {
      buckets[k].sort((a,b) => a.x - b.x);
      lines.push({
        page: p,
        y: buckets[k][0].y,
        text: buckets[k].map(i => i.str).join(' ')
      });
    }
  }

  lines.sort((a,b) => a.page - b.page || b.y - a.y);

  const dateRe = /\b\d{2}[A-Z]{3}\d{2}\b/;
  const duties = [];
  let current = null;

  for (const ln of lines) {
    if (/Roster Report|Hotel Codes|Training Codes|Duty Codes/i.test(ln.text)) continue;

    const m = ln.text.match(dateRe);
    if (m && ln.text.indexOf(m[0]) < 6) {
      if (current) duties.push(current);
      current = {
        startDate: m[0],
        dutyCodes: [],
        flights: [],
        sectors: [],
        times: [],
        hotels: [],
        remarks: []
      };
    }

    if (!current) continue;

    ln.text.match(/\bFLY|TVL|LO|RDO\b/g)?.forEach(c => current.dutyCodes.push(c));
    ln.text.match(/\bVA\s?\d{3,4}\b/g)?.forEach(f => current.flights.push(f.replace(/\s+/g,'')));
    ln.text.match(/\b[A-Z]{3}\s+[A-Z]{3}\b/g)?.forEach(s => current.sectors.push(s.replace(/\s+/g,'-')));
    ln.text.match(/\b\d{4}\b/g)?.forEach(t => current.times.push(t));
    ln.text.match(/\b[A-Z]{3}\d\b|\b[A-Z]{4}\b/g)?.forEach(h => current.hotels.push(h));
    ln.text.match(/\bRTP\d[\w-]*\b/g)?.forEach(r => current.remarks.push(r));
    ln.text.match(/\bOA\s+\d{1,2}\/\d{1,2}\s+[A-Z]{3}\b/g)?.forEach(o => current.remarks.push(o));
  }

  if (current) duties.push(current);

  duties.forEach(d => {
    d.dutyCodes = uniq(d.dutyCodes);
    d.flights   = uniq(d.flights);
    d.sectors   = uniq(d.sectors);
    d.times     = uniq(d.times);
    d.hotels    = uniq(d.hotels);
    d.remarks   = uniq(d.remarks);
  });

  return duties;
}

// =================== HELPERS ===================
function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])
  );
}
