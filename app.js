// ====== v1: parse captured roster JSON and show basic counts ======
// Next iterations will: compute ODTA/DTA/own accom, WDO/OT timing, and full EBA credit rules.

const elInput = document.getElementById('input');
const elStatus = document.getElementById('status');
const elSummary = document.getElementById('summary');
const elDuties = document.getElementById('duties');

document.getElementById('pasteBtn').addEventListener('click', async () => {
  try {
    const txt = await navigator.clipboard.readText();
    elInput.value = txt;
    parseAndRender();
  } catch (e) {
    elStatus.textContent = "Clipboard read failed. Paste manually into the box.";
  }
});

document.getElementById('clearBtn').addEventListener('click', () => {
  elInput.value = '';
  elSummary.innerHTML = '';
  elDuties.innerHTML = '';
  elStatus.textContent = '';
});

elInput.addEventListener('input', () => {
  // live parse if valid JSON
  parseAndRender(true);
});

function parseAndRender(silent=false) {
  const txt = elInput.value.trim();
  if (!txt) return;

  let data;
  try {
    data = JSON.parse(txt);
  } catch (e) {
    if (!silent) elStatus.textContent = "Not valid JSON yet.";
    return;
  }

  const duties = normalizeRowsToDuties(data);
  elStatus.textContent = `CapturedAt: ${data.capturedAt || 'unknown'} | Rows: ${(data.rows||[]).length} | Duties: ${duties.length}`;

  renderSummary(duties);
  renderDuties(duties);
}

function normalizeRowsToDuties(data) {
  // Data comes from the bookmarklet as: { capturedAt, url, headers, rows:[{...}] }
  const rows = Array.isArray(data.rows) ? data.rows : [];
  // Keep only rows with a date + duty
  return rows
    .filter(r => r.startDate && r.duty)
    .map(r => ({
      startDate: r.startDate,
      day: r.day || null,
      flightNumber: r.flightNumber || null,
      sector: r.sector || null,
      ac: r.ac || null,
      duty: r.duty || null,
      pairing: r.pairing || null,
      rpt: r.rpt || null,
      std: r.std || null,
      sta: r.sta || null,
      signOff: r.signOff || null,
      fltTime: r.fltTime || null,
      dutyTime: r.dutyTime || null,
      hotel: r.hotel || null,
      training: r.training || null,
      remarks: r.remarks || null,
    }));
}

function renderSummary(duties) {
  const counts = duties.reduce((acc, d) => {
    acc[d.duty] = (acc[d.duty] || 0) + 1;
    return acc;
  }, {});
  const hotelNights = duties.filter(d => d.duty === 'LO' && d.hotel).length;

  // Known from your payslips: standard pay is 80 hrs each fortnight.
  const standardHours = 80;
  const standardRate = 90.68; // from your payslip screenshots
  const standardPay = round2(standardHours * standardRate);

  elSummary.innerHTML = `
    <table>
      <tr><th>Item</th><th>Value</th></tr>
      <tr><td>Standard pay (fixed)</td><td>$${standardPay} (${standardHours}h @ $${standardRate})</td></tr>
      <tr><td>Duties by type</td><td class="mono">${escapeHtml(JSON.stringify(counts))}</td></tr>
      <tr><td>Layover rows with hotel code</td><td>${hotelNights}</td></tr>
      <tr><td class="muted" colspan="2">Next: compute DTA/ODTA hours + Own Accommodation nights + WDO hours + OT/credit trigger.</td></tr>
    </table>
  `;
}

function renderDuties(duties) {
  const head = `
    <table>
      <tr>
        <th>Date</th><th>Duty</th><th>Flight</th><th>Sector</th><th>Rpt</th><th>SignOff</th><th>DutyTime</th><th>Hotel</th><th>Remarks</th>
      </tr>`;
  const rows = duties.slice(0, 120).map(d => `
      <tr>
        <td>${escapeHtml(d.startDate)}</td>
        <td>${escapeHtml(d.duty)}</td>
        <td>${escapeHtml(d.flightNumber||'')}</td>
        <td>${escapeHtml(d.sector||'')}</td>
        <td>${escapeHtml(d.rpt||'')}</td>
        <td>${escapeHtml(d.signOff||'')}</td>
        <td>${escapeHtml(d.dutyTime||'')}</td>
        <td>${escapeHtml(d.hotel||'')}</td>
        <td>${escapeHtml(d.remarks||'')}</td>
      </tr>`).join('');
  elDuties.innerHTML = head + rows + `</table>`;
}

function round2(n){ return Math.round(n*100)/100; }
function escapeHtml(s){
  return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}
