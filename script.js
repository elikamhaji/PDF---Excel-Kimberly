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

// ------------------ UI HELPERS ------------------
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

// ------------------ DROPZONE (FIXED) ------------------
dropzone.addEventListener("click", () => {
  fileInput.value = "";
  fileInput.click();
});

fileInput.addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  if (file.type !== "application/pdf") {
    setMessage("Only PDF files allowed.", true);
    return;
  }
  setFile(file);
});

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragover");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("dragover");
});

dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");

  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;

  if (file.type !== "application/pdf") {
    setMessage("Only PDF files allowed.", true);
    return;
  }
  setFile(file);
});

clearBtn.addEventListener("click", () => {
  output.value = "";
  fileInput.value = "";
  setFile(null);
  setMessage("");
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(output.value);
    setMessage("Copied to clipboard ✅");
  } catch {
    setMessage("Clipboard blocked by browser.", true);
  }
});

// ------------------ HELPERS ------------------
function stripLeadingZerosFactura(raw) {
  const digits = raw.replace(/\D/g, "");
  const stripped = digits.replace(/^0+/, "");
  return stripped || "0";
}

function normalizeNumbers(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/(\d)\.\s+(\d{2})/g, "$1.$2")
    .replace(/(\d+)\s*\.\s*(\d{2})/g, "$1.$2");
}

function yyyyMmDdToDdMmYyyy(d) {
  const m = d.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

// ------------------ PDF TEXT EXTRACTION ------------------
async function extractPdfText(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(i => i.str).join(" ") + "\n";
  }
  return normalizeNumbers(text);
}

// ------------------ PARSER ------------------
function parseReport(text, mode) {
  const facturaRegex = /\b0{3,}\d+\b/g;
  const facturas = [...text.matchAll(facturaRegex)];
  if (!facturas.length) return [];

  const blocks = [];
  for (let i = 0; i < facturas.length; i++) {
    const start = facturas[i].index;
    const end = facturas[i + 1]?.index || text.length;
    blocks.push(text.slice(start, end));
  }

  const rows = [];
  const bankRegex = /([A-Za-zÁÉÍÓÚÑáéíóúñ ]+?)\s*--\s*\((\d+\.\d{2})\)/g;

  for (const block of blocks) {
    const rawFactura = block.match(facturaRegex)?.[0];
    if (!rawFactura) continue;

    const factura = stripLeadingZerosFactura(rawFactura);

    const dateMatch = block.match(/\b20\d{2}-\d{2}-\d{2}\b/);
    const fecha = dateMatch ? yyyyMmDdToDdMmYyyy(dateMatch[0]) : "";

    let beneficiario = "";
    const nameMatch = block.match(
      /Cliente\s+(?:Ocasional|Frecuente)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ\s]+?)\s+(?:E-|[0-9]{5,}|20\d{2}-\d{2}-\d{2})/i
    );
    if (nameMatch) beneficiario = nameMatch[1].replace(/\s+/g, " ").trim();

    const banks = [...block.matchAll(bankRegex)];
    if (!banks.length) continue;

    const entries = banks.map(b => ({
      banco: b[1].trim(),
      monto: b[2],
      index: b.index
    }));

    if (mode === "cheque" || mode === "transferencia") {
      for (const e of entries) {
        rows.push({ factura, beneficiario, fecha, forma: mode, ...e });
      }
      continue;
    }

    // AUTO: default cheque unless transfer total exists
    const hasTransferTotal = block.includes("TOTAL TRANSFERENCIA");
    const formaDefault = hasTransferTotal ? "transferencia" : "cheque";

    for (const e of entries) {
      rows.push({
        factura,
        beneficiario,
        fecha,
        forma: formaDefault,
        banco: e.banco,
        monto: e.monto
      });
    }
  }

  return rows.sort((a, b) => Number(a.factura) - Number(b.factura));
}

// ------------------ OUTPUT ------------------
function rowsToTSV(rows, header) {
  const h = "# factura\tBeneficiario\tFecha\tForma de pago\tBanco\tMonto";
  const lines = rows.map(r =>
    `${r.factura}\t${r.beneficiario}\t${r.fecha}\t${r.forma}\t${r.banco}\t${r.monto}`
  );
  return header ? [h, ...lines].join("\n") : lines.join("\n");
}

// ------------------ GENERATE ------------------
generateBtn.addEventListener("click", async () => {
  if (!currentFile) return;

  generateBtn.disabled = true;
  copyBtn.disabled = true;
  setMessage("Processing PDF…");

  try {
    const text = await extractPdfText(currentFile);
    const rows = parseReport(text, modeSelect.value);

    if (!rows.length) {
      output.value = "";
      setMessage("No factura rows found.", true);
      return;
    }

    output.value = rowsToTSV(rows, includeHeader.checked);
    copyBtn.disabled = false;
    setMessage(`Done. Rows: ${rows.length}`);
  } catch (err) {
    console.error(err);
    setMessage("PDF parsing failed.", true);
  } finally {
    generateBtn.disabled = false;
  }
});
