// -------------------- PDF Import (Printable Roster) --------------------
const importBtn = document.getElementById('importPdfBtn');
const pdfFile = document.getElementById('pdfFile');

// Configure PDF.js worker (required)
if (window.pdfjsLib) {
  // Must match the version above
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

importBtn?.addEventListener('click', () => pdfFile?.click());

pdfFile?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    elStatus.textContent = `Loading PDF: ${file.name} ...`;
    const duties = await parseRosterPdfToDuties(file);

    // Put the JSON into the textarea for transparency/debugging
    const payload = {
      source: "pdf",
      capturedAt: new Date().toISOString(),
      fileName: file.name,
      duties
    };

    elInput.value = JSON.stringify(payload, null, 2);
    parseAndRender(); // reuse your existing renderer (it expects JSON)
  } catch (err) {
    console.error(err);
    elStatus.textContent = `PDF import failed: ${err?.message || err}`;
    alert(`PDF import failed: ${err?.message || err}`);
  } finally {
    // allow importing the same file again
    e.target.value = "";
  }
});

async function parseRosterPdfToDuties(file) {
  if (!window.pdfjsLib) throw new Error("PDF.js did not load.");

  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  // Extract "lines" as arrays of positioned text items
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();

    // Map each text item to a simpler structure with x/y coords
    const items = tc.items
      .map(it => {
        const [a,b,c,d,e,f] = it.transform || [];
        return {
          str: (it.str || "").trim(),
          x: e ?? 0,
          y: f ?? 0,
          w: it.width ?? 0,
          page: p
        };
      })
      .filter(it => it.str);

    // Group items into lines by similar y coordinate (PDF uses floating coords)
    // Tweak the rounding if needed (2 works well for many printable rosters).
    const buckets = new Map();
    for (const it of items) {
      const key = `${it.page}:${Math.round(it.y * 2) / 2}`; // y rounded to 0.5
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(it);
    }

    for (const [key, bucket] of buckets.entries()) {
      bucket.sort((a,b) => a.x - b.x);
      const text = bucket.map(b => b.str).join(" ").replace(/\s+/g, " ").trim();
      if (!text) continue;
      lines.push({ page: p, y: bucket[0].y, text, items: bucket });
    }
  }

  // Sort lines top-to-bottom across pages (higher y is typically "higher" on page)
  lines.sort((a,b) => (a.page - b.page) || (b.y - a.y));

  // Reconstruct "duty days" grouped by Start Date token like 07DEC25
  const dateRe = /\b\d{2}[A-Z]{3}\d{2}\b/;
  const dutiesByDay = [];
  let current = null;

  for (const ln of lines) {
    // Skip obvious non-roster parts
    if (/Roster Report from/i.test(ln.text)) continue;
    if (/Hotel Codes|Training Codes|Duty Codes/i.test(ln.text)) continue;
    if (/MCMANUS|29563|\/ FO \//i.test(ln.text)) continue;

    const m = ln.text.match(dateRe);
    // We treat a line as "new day" if a date appears near the start
    const isNewDay = m && ln.text.indexOf(m[0]) <= 6;

    if (isNewDay) {
      // close previous
      if (current) dutiesByDay.push(current);

      current = {
        startDate: m[0],
        rawLines: [ln.text],
        // extracted fields we’ll fill incrementally:
        dutyCodes: [],
        flights: [],
        sectors: [],
        times: [],
        hotels: [],
        remarks: []
      };

      extractFromLineInto(current, ln.text);
    } else if (current) {
      // continuation line (wrapped row, extra sector, LO row, training, etc.)
      current.rawLines.push(ln.text);
      extractFromLineInto(current, ln.text);
    }
  }
  if (current) dutiesByDay.push(current);

  // Normalize and dedupe lists
  for (const d of dutiesByDay) {
    d.dutyCodes = uniq(d.dutyCodes);
    d.flights = uniq(d.flights);
    d.sectors = uniq(d.sectors);
    d.times = uniq(d.times);
    d.hotels = uniq(d.hotels);
    d.remarks = uniq(d.remarks);
  }

  return dutiesByDay;
}

function extractFromLineInto(dayObj, lineText) {
  // Duty codes we care about (extend later)
  const dutyCodes = ["FLY","TVL","LO","RDO"];
  for (const c of dutyCodes) {
    if (new RegExp(`\\b${c}\\b`).test(lineText)) dayObj.dutyCodes.push(c);
  }

  // Training code patterns like RTP4-Day1, RTP4-25_A
  const trainingHits = lineText.match(/\bRTP\d[\w-]*\b/g);
  if (trainingHits) trainingHits.forEach(t => dayObj.remarks.push(t));

  // Flight numbers like VA 0916 or VA0916 (and OW)
  const flightHits = lineText.match(/\bVA\s?\d{3,4}\b/g);
  if (flightHits) flightHits.forEach(f => dayObj.flights.push(f.replace(/\s+/g,'')));
  if (/\bOW\b/.test(lineText)) dayObj.flights.push("OW");

  // Sectors like SYD BNE (in PDF it sometimes appears as "SYD BNE" or "SYD - LO")
  // Try a couple of common shapes:
  const sectorHits = [];
  // A-B format
  const m1 = lineText.match(/\b([A-Z]{3})\s*[-–]\s*([A-Z]{3})\b/g);
  if (m1) sectorHits.push(...m1.map(s => s.replace(/\s+/g,'')));
  // Two IATA codes adjacent (e.g. "SYD BNE")
  const m2 = lineText.match(/\b([A-Z]{3})\s+([A-Z]{3})\b/g);
  if (m2) {
    for (const s of m2) {
      // filter obvious false positives
      if (!/^(SUN|MON|TUE|WED|THU|FRI|SAT)$/.test(s)) sectorHits.push(s.replace(/\s+/g,'-'));
    }
  }
  sectorHits.forEach(s => dayObj.sectors.push(s));

  // Times (0500, 1456, etc.)
  const timeHits = lineText.match(/\b\d{4}\b/g);
  if (timeHits) timeHits.forEach(t => dayObj.times.push(t));

  // Hotel codes appear in your PDF as BNEO, MEL1, CBR5
  // Also "OWN ACCOM" is described elsewhere, but roster uses BNEO
  const hotelHits = lineText.match(/\b[A-Z]{3}\d\b|\b[A-Z]{4}\b/g);
  if (hotelHits) {
    // Keep likely hotel tokens only (e.g., BNEO, MEL1, CBR5)
    hotelHits
      .filter(h => /^[A-Z]{3}\d$/.test(h) || /^[A-Z]{4}$/.test(h))
      .forEach(h => dayObj.hotels.push(h));
  }

  // Remarks like "OA 12/13 BNE"
  const oa = lineText.match(/\bOA\s+\d{1,2}\/\d{1,2}\s+[A-Z]{3}\b/g);
  if (oa) oa.forEach(x => dayObj.remarks.push(x));
}

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}
// ----------------------------------------------------------------------
