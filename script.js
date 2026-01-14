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

// ---------------- UI HELPERS ----------------
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

// ---------------- DROPZONE ----------------
dropzone.addEventListener("click", () => {
  fileInput.value = "";
  fileInput.click();
});

dropzone.addEventListener("dragover", e => {
  e.preventDefault();
  dropzone.classList.add("dragover");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("dragover");
});

dropzone.addEventListener("drop", e => {
  e.preventDefault();
  dropzone.classList.remove("dragover");

  const file = e.dataTransfer.files[0];
  if (!file || !file.name.endsWith(".csv")) {
    setMessage("CSV files only.", true);
    return;
  }
  loadCSV(file);
});

fileInput.addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file || !file.name.endsWith(".csv")) {
    setMessage("CSV files only.", true);
    return;
  }
  loadCSV(file);
});

clearBtn.addEventListener("click", reset);

// ---------------- CSV LOADING ----------------
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

// ---------------- CORE LOGIC ----------------
function explodeDetails(detail, forma) {
  if (!detail) return [];
  const regex = /([A-Za-zÁÉÍÓÚÑáéíóúñ ]+?)\s*--\s*\((\d+\.\d{2})\)/g;
  return [...detail.matchAll(regex)].map(m => ({
    forma,
    banco: m[1].trim(),
    monto: m[2]
  }));
}

generateBtn.addEventListener("click", () => {
  if (!csvText) return;

  const lines = csvText.split("\n").filter(l => l.trim());
  const headers = lines[0].split(",");
  const data = lines.slice(1);

  const idx = name => headers.indexOf(name);

  const rows = [];

  for (const line of data) {
    const cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);

    if (!cols[idx("FACTURA")]) continue;

    const factura = String(parseInt(cols[idx("FACTURA")], 10));
    const beneficiario = cols[idx("NOMBRE DEL CLIENTE")];
    const fecha = cols[idx("FECHA")].split(" ")[0].split("-").reverse().join("/");

    explodeDetails(cols[idx("DETALLE TRANSFERENCIA")], "transferencia")
      .forEach(e => rows.push([factura, beneficiario, fecha, e.forma, e.banco, e.monto]));

    explodeDetails(cols[idx("DETALLE CHEQUE")], "cheque")
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

// ---------------- COPY ----------------
copyBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(output.value);
  setMessage("Copied to clipboard ✅");
});
