/* global pdfjsLib */

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const fileLabel = document.getElementById("fileLabel");
const msg = document.getElementById("msg");

const generateBtn = document.getElementById("generateBtn");
const copyBtn = document.getElementById("copyBtn");
const clearBtn = document.getElementById("clearBtn");

const output = document.getElementById("output");
const modeSelect = document.getElementById("modeSelect");
const includeHeader = document.getElementById("includeHeader");

let currentFile = null;

// PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

function setMessage(text, isError = false) {
  msg.textContent = text || "";
  msg.classList.toggle("error", !!isError);
}

function setFile(file) {
  currentFile = file;
  if (file) {
    fileLabel.textContent = `Selected: ${file.name}`;
    generateBtn.disabled = false;
    setMessage("");
  } else {
    fileLabel.textContent = "No PDF selected";
    generateBtn.disabled = true;
    copyBtn.disabled = true;
  }
}

// Dropzone wiring
dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("dragover"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  const f = e.dataTransfer.files?.[0];
  if (!f) return;
  if (f.type !== "application/pdf") return setMessage("Only PDF files please.", true);
  setFile(f);
});

fileInput.addEventListener("change", (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  if (f.type !== "application/pdf") return setMessage("Please select a PDF file.", true);
  setFile(f);
});

clearBtn.addEventListener("click", () => {
  output.value = "";
  fileInput.value = "";
  setFile(null);
  setMessage("");
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(output.value || "");
    setMessage("Copied to clipboard ✅");
  } catch {
    setMessage("Clipboard copy failed (browser permissions). You can still manually copy.", true);
  }
});

// Helpers
function stripLeadingZerosFactura(raw) {
  const digits = String(raw).replace(/\D/g, "");
  const stripped = digits.replace(/^0+/, "");
  return stripped.length ? stripped : "0";
}
function yyyyMmDdToDdMmYyyy(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : dateStr;
}

/**
 * Fix common PDF extraction artifacts:
 * - "7316. 00" -> "7316.00"
 * - "2042. 26" -> "2042.26"
 * - remove weird spaces around decimals generally
 */
function normalizeNumbers(text) {
  // collapse whitespace first
  let t = text.replace(/\s+/g, " ");

  // fix decimal splits like ". 00" or ". 26"
  t = t.replace(/(\d)\.\s+(\d{2})/g, "$1.$2");

  // also catch "1367. 65" etc after other cleanup
  t = t.replace(/(\d+)\s*\.\s*(\d{2})/g, "$1.$2");

  return t;
}

async function extractPdfText(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  let full = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const strings = content.items.map((it) => it.str);
    full += strings.join(" ") + "\n";
  }
  return full;
}

/**
 * Parse this specific report style (like "Grupo Kadima Reportes")
 * into exploded rows: one row per bank payment.
 */
function parseReport(text, mode = "auto") {
  let cleaned = normalizeNumbers(text);

  // Normalize bank name capitalization for consistency
  cleaned = cleaned
    .replace(/Mercantil bank/gi, "Mercantil Bank")
    .replace(/Caja de ahorros/gi, "Caja de Ahorros");

  // Factura tokens (works for 0000009962 etc)
  const facturaRegex = /\b0{3,}\d+\b/g;
  const matches = [...cleaned.matchAll(facturaRegex)];
  if (!matches.length) return [];

  // Create blocks from factura → next factura
  const blocks = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = (i + 1 < matches.length) ? matches[i + 1].index : cleaned.length;
    blocks.push(cleaned.slice(start, end));
  }

  const rows = [];

  // Bank entry: "Banco Aliado -- (23148.04)"
  const bankRegex = /([A-Za-zÁÉÍÓÚÑáéíóúñ ]+?)\s*--\s*\((\d+\.\d{2})\)/g;

  for (const block of blocks) {
    const rawFactura = (block.match(facturaRegex) || [null])[0];
    if (!rawFactura) continue;
    const factura = stripLeadingZerosFactura(rawFactura);

  // --- FECHA ---
const dateMatch = block.match(/\b20\d{2}-\d{2}-\d{2}\b/);
const fecha = dateMatch ? yyyyMmDdToDdMmYyyy(dateMatch[0]) : "";

// --- BENEFICIARIO ---
// Extract text after "Cliente Ocasional/Frecuente" up to the next column break
let beneficiario = "";

const nameMatch = block.match(
  /Cliente\s+(?:Ocasional|Frecuente)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ\s]+?)\s+(?:E-|[0-9]{5,}|20\d{2}-\d{2}-\d{2})/i
);

if (nameMatch) {
  beneficiario = nameMatch[1]
    .replace(/\s+/g, " ")
    .trim();
}

    }

    const bankMatches = [...block.matchAll(bankRegex)];
    if (!bankMatches.length) continue;

    // AUTO classify: for this report, transfer list often appears first,
    // and a standalone number (TOTAL TRANSFERENCIA) appears between transfer & cheque lists.
    // We'll detect the best split using presence of a standalone total between entries.
    const entries = bankMatches.map(m => ({
      banco: m[1].trim(),
      monto: m[2],
      start: m.index,
      end: m.index + m[0].length
    }));

    const forced = mode === "cheque" || mode === "transferencia";
    if (forced) {
      for (const e of entries) {
        rows.push({ factura, beneficiario, fecha, forma: mode, banco: e.banco, monto: e.monto });
      }
      continue;
    }

    // Find a split point between transfer and cheque lists
    let splitAt = -1;
    let best = 0;

    for (let i = 0; i < entries.length - 1; i++) {
      const between = block.slice(entries[i].end, entries[i + 1].start);

      // Standalone total number between lists (not inside parentheses)
      const hasStandaloneTotal = /\b\d+\.\d{2}\b/.test(between);

      // Extra signals: long gap, multiple spaces, etc.
      const score = (hasStandaloneTotal ? 3 : 0) + (between.length > 12 ? 1 : 0);

      if (score > best) {
        best = score;
        splitAt = i;
      }
    }

    if (best >= 3 && splitAt >= 0) {
      for (let i = 0; i <= splitAt; i++) {
        rows.push({ factura, beneficiario, fecha, forma: "transferencia", banco: entries[i].banco, monto: entries[i].monto });
      }
      for (let i = splitAt + 1; i < entries.length; i++) {
        rows.push({ factura, beneficiario, fecha, forma: "cheque", banco: entries[i].banco, monto: entries[i].monto });
      }
    } else {
      // If no clear split, default to cheque (safer for these reports)
      for (const e of entries) {
        rows.push({ factura, beneficiario, fecha, forma: "cheque", banco: e.banco, monto: e.monto });
      }
    }
  }

  rows.sort((a, b) => Number(a.factura) - Number(b.factura));
  return rows;
}

function rowsToTsv(rows, includeHeaderRow = true) {
  const header = "# factura\tBeneficiario\tFecha\tForma de pago\tBanco\tMonto";
  const lines = rows.map(r =>
    `${r.factura}\t${r.beneficiario}\t${r.fecha}\t${r.forma}\t${r.banco}\t${r.monto}`
  );
  return includeHeaderRow ? [header, ...lines].join("\n") : lines.join("\n");
}

generateBtn.addEventListener("click", async () => {
  if (!currentFile) return;

  setMessage("Reading PDF…");
  generateBtn.disabled = true;
  copyBtn.disabled = true;

  try {
    const text = await extractPdfText(currentFile);
    const rows = parseReport(text, modeSelect.value);

    if (!rows.length) {
      output.value = "";
      setMessage("No factura rows found. This PDF may be scanned (image-only).", true);
      return;
    }

    output.value = rowsToTsv(rows, includeHeader.checked);
    setMessage(`Done. Rows generated: ${rows.length}`);
    copyBtn.disabled = false;
  } catch (err) {
    console.error(err);
    setMessage("Failed to parse PDF. Try Force mode or run via a local server.", true);
  } finally {
    generateBtn.disabled = !currentFile;
  }
});
