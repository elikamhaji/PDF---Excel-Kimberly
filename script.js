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
  dro
