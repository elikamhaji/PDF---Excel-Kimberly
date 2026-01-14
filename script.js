const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const fileLabel = document.getElementById("fileLabel");
const msg = document.getElementById("msg");

const generateBtn = document.getElementById("generateBtn");
const copyBtn = document.getElementById("copyBtn");
const clearBtn = document.getElementById("clearBtn");

const output = document.getElementById("output");
const includeHeader = document.getElementById("includeHeader");

let csvText = "";

// ---------- helpers ----------
function setMessage(text, isError = false) {
  msg.textContent = text || "";
  msg.classList.toggle("error", isError);
}

function reset() {
  csvText = "";
  output.value = "";
  fileInput.value = "";
  fileLabel.textContent = "No CSV selected";
  generateBtn.disabled = true;
  copyBtn.disabled = true;
  setMessage("");
}

// ---------- drag & drop ----------
dropzone.addEventListener("click", () => {
  fileInput.value = "";
  fileInput.click();
});

["dragover", "drop"].forEach(evt =>
  dropzone.addEventListener(evt, e => e.preventDefault())
);

dropzone.addEventListener("drop", e => {
  const file = e.dataTransfer.files[0];
  if (!file || !file.name.toLowerCase().endsWith(".csv")) {
    setMessage("CSV files only.", true);
    return;
  }
  loadCSV(file);
});

fileInput.addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file || !file.name.toLowerCase().endsWith(".csv")) {
    setMessage("CSV files only.", true);
    return;
  }
  loadCSV(file);
});

clearBtn.addEventListener("click", reset);

// ---------- load CSV ----------
function loadCSV(file) {
  const reader = new FileReader();
  reader.onload = () => {
    csvText = reader.result;
    fileLabel.textContent = `Selected: ${file.name}`;
    generateBtn.disabled = false;
    setMessage("");
  };
  reader.readAsText(file);
}

// ---------- CSV parsing ----------
function parseCSV(text) {
  const rows = [];
  const regex = /("([^"]|"")*"|[^,\n]+)(?=,|\n|$)/g;
  let match, row = [];

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    row = [];
    while ((match = regex.exec(line))) {
      row.push(match[1]?.replace(/^"|"$/g, "").trim());
    }
    rows.push(row);
  }
  return rows;
}

function explode(detail, forma) {
  if (!detail) return [];
  const rx = /([A-Za-zÁÉÍÓÚÑáéíóúñ ]+?)\s*--\s*\((\d+\.\d{2})\)/g;
  return [...detail.matchAll(rx)].map(m => ({
    forma,
    banco: m[1].trim(),
    monto: m[2]
  }));
}

// ---------- generate ----------
generateBtn.addEventListener("click", () => {
  if (!csvText) return;

  const table = parseCSV(csvText);
  if (table.length < 2) {
    setMessage("CSV appears empty.", true);
    return;
  }

  const headers = table[0].map(h => h.trim().toUpperCase());
  const idx = name => headers.indexOf(name);

  const required = [
    "FACTURA",
    "NOMBRE DEL CLIENTE",
    "FECHA",
    "DETALLE TRANSFERENCIA",
    "DETALLE CHEQUE"
  ];

  if (!required.every(r => idx(r) !== -1)) {
    setMessage("CSV headers not recognized.", true);
    return;
  }

  const rows = [];

  for (const r of table.slice(1)) {
    if (!r[idx("FACTURA")]) continue;

    const factura = String(parseInt(r[idx("FACTURA")], 10));
    const beneficiario = r[idx("NOMBRE DEL CLIENTE")];
    const fecha = r[idx("FECHA")].split(" ")[0].split("-").reverse().join("/");

    explode(r[idx("DETALLE TRANSFERENCIA")], "transferencia")
      .forEach(e => rows.push([factura, beneficiario, fecha, e.forma, e.banco, e.monto]));

    explode(r[idx("DETALLE CHEQUE")], "cheque")
      .forEach(e => rows.push([factura, beneficiario, fecha, e.forma, e.banco, e.monto]));
  }

  if (!rows.length) {
    setMessage("No valid rows found.", true);
    return;
  }

  const headerRow = "# factura\tBeneficiario\tFecha\tForma de pago\tBanco\tMonto";
  const body = rows.map(r => r.join("\t")).join("\n");

  output.value = includeHeader.checked ? `${headerRow}\n${body}` : body;
  copyBtn.disabled = false;
  setMessage(`Done. Rows generated: ${rows.length}`);
});

// ---------- copy ----------
copyBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(output.value);
  setMessage("Copied to clipboard ✅");
});
