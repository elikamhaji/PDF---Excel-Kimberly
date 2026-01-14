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

// Configure PDF.js worker
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

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") fileInput.click();
});

fileInput.addEventListener("change", (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  if (f.type !== "application/pdf") {
    setMessage("Please select a PDF file.", true);
    return;
  }
  setFile(f);
});

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragover");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  const f = e.dataTransfer.files?.[0];
  if (!f) return;
  if (f.type !== "application/pdf") {
    setMessage("Only PDF files please.", true);
    return;
  }
  setFile(f);
});

// Helpers
function stripLeadingZerosFactura(raw) {
  // Keep only digits, then strip leading zeros; if all zeros -> "0"
  const digits = String(raw).replace(/\D/g, "");
  const stripped = digits.replace(/^0+/, "");
  return stripped.length ? stripped : "0";
}

function yyyyMmDdToDdMmYyyy(dateStr) {
  // dateStr: "2026-01-14"
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return dateStr;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Extract plain text from a PDF file (all pages).
 */
async function extractPdfText(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  let full = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const strings = content.items.map((it) => it.str);
    // Join with spaces; add a page break marker for safer splitting
    full += strings.join(" ") + "\n\n";
  }
  return full;
}

/**
 * Parse the report text into rows:
 * Columns: factura, beneficiario, fecha, forma de pago, banco, monto
 *
 * Heuristics:
 * - Identify factura blocks by numbers that look like "0000009962" etc (>= 6 leading zeros)
 * - Within each block:
 *   - Extract date "YYYY-MM-DD"
 *   - Extract beneficiary between "Cliente" and date (best-effort)
 *   - Extract all bank entries "<Bank> -- (1234.56)"
 *   - Classify as transferencia vs cheque:
 *      - If forced mode chosen -> all entries set to that
 *      - Otherwise auto tries to split into two chunks if it detects a boundary.
 */
function parseReport(text, mode = "auto") {
  // Normalize spacing
  const cleaned = text
    .replace(/\s+/g, " ")
    .replace(/Mercantil bank/gi, "Mercantil Bank")
    .replace(/Caja de ahorros/gi, "Caja de Ahorros")
    .trim();

  // Find factura-like tokens: lots of leading zeros then digits
  const facturaRegex = /\b0{4,}\d+\b/g;
  const matches = [...cleaned.matchAll(facturaRegex)];
  if (matches.length === 0) return [];

  // Build blocks from match positions
  const blocks = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = (i + 1 < matches.length) ? matches[i + 1].index : cleaned.length;
    blocks.push(cleaned.slice(start, end));
  }

  const rows = [];

  for (const block of blocks) {
    const rawFactura = (block.match(facturaRegex) || [null])[0];
    if (!rawFactura) continue;
    const factura = stripLeadingZerosFactura(rawFactura);

    // Date
    const dateMatch = block.match(/\b20\d{2}-\d{2}-\d{2}\b/);
    const dateIso = dateMatch ? dateMatch[0] : "";
    const fecha = dateIso ? yyyyMmDdToDdMmYyyy(dateIso) : "";

    // Beneficiary (best effort):
    // Try: after "Cliente" and before identification/date.
    // If that fails, take text between the factura and the date, remove known noise words.
    let beneficiario = "";
    if (dateIso) {
      const preDate = block.split(dateIso)[0];

      // Remove factura and common labels
      let candidate = preDate
        .replace(rawFactura, "")
        .replace(/FACTURA|TIPO|CLIENTE\/STATUS|NOMBRE|DEL|CLIENTE|Cliente|Ocasional|Frecuente|CREADO|POR/gi, " ")
        .replace(/\bE-\d+-\d+\b/gi, " ")
        .replace(/\b\d+-\d+-\d+\b/g, " ")
        .replace(/\b\d{5,}\b/g, " ")
        .replace(/\bMeir\b|\bk\b|\bkoby\b|\bkami\b|\bKimberly\b|\bSanchez\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();

      // Keep a sensible slice
      beneficiario = candidate;
      if (beneficiario.length > 70) beneficiario = beneficiario.slice(0, 70).trim();
    }

    // Bank entries: "<bank> -- (amount)"
    const bankRegex = /([A-Za-zÁÉÍÓÚÑáéíóúñ ]+?)\s*--\s*\(([\d]+\.\d{2})\)/g;
    const bankMatches = [...block.matchAll(bankRegex)];
    if (bankMatches.length === 0) continue;

    // If forced mode, easy:
    if (mode === "cheque" || mode === "transferencia") {
      for (const m of bankMatches) {
        const banco = m[1].trim();
        const monto = m[2];
        rows.push({ factura, beneficiario, fecha, forma: mode, banco, monto });
      }
      continue;
    }

    // AUTO MODE:
    // Attempt to split into transferencia chunk then cheque chunk if there is a boundary:
    // We look for the largest gap between bank entries where the text between them contains
    // a standalone decimal number NOT in parentheses (likely "TOTAL TRANSFERENCIA").
    const entries = bankMatches.map((m) => {
      return {
        banco: m[1].trim(),
        monto: m[2],
        start: m.index,
        end: m.index + m[0].length
      };
    });

    let splitAt = -1;
    let bestScore = 0;

    for (let i = 0; i < entries.length - 1; i++) {
      const midText = block.slice(entries[i].end, entries[i + 1].start);

      // standalone totals like "41625.04" (not inside parentheses)
      const hasStandaloneTotal = /\b\d+\.\d{2}\b/.test(midText);

      // if there's a standalone number and some spacing/commas, it’s a decent boundary
      const score = (hasStandaloneTotal ? 2 : 0) + (midText.includes(",") ? 1 : 0) + (midText.length > 10 ? 1 : 0);

      if (score > bestScore) {
        bestScore = score;
        splitAt = i;
      }
    }

    if (bestScore >= 3 && splitAt >= 0) {
      // Treat entries[0..splitAt] as transferencia, rest as cheque
      for (let i = 0; i <= splitAt; i++) {
        rows.push({ factura, beneficiario, fecha, forma: "transferencia", banco: entries[i].banco, monto: entries[i].monto });
      }
      for (let i = splitAt + 1; i < entries.length; i++) {
        rows.push({ factura, beneficiario, fecha, forma: "cheque", banco: entries[i].banco, monto: entries[i].monto });
      }
    } else {
      // No clear split detected.
      // Heuristic default:
      // - If block contains "transfer" total patterns like "... ) 5000.38 0.00 ..." (cheque total 0)
      //   classify as transferencia; else cheque.
      const afterLast = block.slice(entries[entries.length - 1].end);
      const looksLikeChequeTotalZero = /\b0\.00\b/.test(afterLast);

      const defaultForma = looksLikeChequeTotalZero ? "transferencia" : "cheque";
      for (const e of entries) {
        rows.push({ factura, beneficiario, fecha, forma: defaultForma, banco: e.banco, monto: e.monto });
      }
    }
  }

  // Sort by factura numeric, then keep order
  rows.sort((a, b) => (Number(a.factura) - Number(b.factura)));
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
      setMessage("No factura rows found. Try another PDF or change mode.", true);
      return;
    }

    output.value = rowsToTsv(rows, includeHeader.checked);
    setMessage(`Done. Rows generated: ${rows.length}`);
    copyBtn.disabled = false;
  } catch (err) {
    console.error(err);
    setMessage("Failed to parse PDF. Try a different PDF or Force mode.", true);
  } finally {
    generateBtn.disabled = !currentFile;
  }
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(output.value || "");
    setMessage("Copied to clipboard ✅");
  } catch (err) {
    console.error(err);
    setMessage("Clipboard copy failed (browser permissions). You can still manually copy.", true);
  }
});

clearBtn.addEventListener("click", () => {
  output.value = "";
  fileInput.value = "";
  setFile(null);
  setMessage("");
});
