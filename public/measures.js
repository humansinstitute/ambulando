// Measures management for Daily Tracker

import { elements as el, show, hide, setText } from "./dom.js";
import { state } from "./state.js";

let measures = [];
let editingMeasure = null;

const TYPE_LABELS = {
  number: "Number",
  text: "Text",
  goodbad: "Good/Bad",
  time: "Time tracker",
};

export async function initMeasures() {
  if (!state.session) return;

  // Wire up add button
  el.addMeasureBtn?.addEventListener("click", openAddModal);

  // Wire up modal close buttons
  el.measureClose?.addEventListener("click", closeModal);
  el.measureCancel?.addEventListener("click", closeModal);

  // Wire up form submission
  el.measureForm?.addEventListener("submit", handleSaveMeasure);

  // Close modal on backdrop click
  el.measureModal?.addEventListener("click", (e) => {
    if (e.target === el.measureModal) closeModal();
  });

  // Listen for tab switches to reload measures
  window.addEventListener("tab-switched", (e) => {
    if (e.detail.tab === "measures") {
      void loadMeasures();
    }
  });

  // Load measures initially
  await loadMeasures();
}

export async function loadMeasures() {
  if (!state.session) return;

  try {
    const response = await fetch("/measures");
    if (!response.ok) throw new Error("Failed to fetch measures");

    const data = await response.json();
    measures = data.measures || [];
    renderMeasuresList();
  } catch (err) {
    console.error("Failed to load measures:", err);
    measures = [];
    renderMeasuresList();
  }
}

function renderMeasuresList() {
  if (!el.measuresList) return;

  if (measures.length === 0) {
    el.measuresList.innerHTML = '<p class="track-empty">No measures defined yet. Add your first one below.</p>';
    return;
  }

  const html = measures
    .map(
      (m) => `
    <div class="measure-item" data-measure-id="${m.id}">
      <div class="measure-item-info">
        <div class="measure-item-name">${escapeHtml(m.name)}</div>
        <div class="measure-item-type">${TYPE_LABELS[m.type] || m.type}</div>
      </div>
      <div class="measure-item-badges">
        ${m.encrypted ? '<span class="measure-encrypted-badge">Encrypted</span>' : ""}
      </div>
      <button class="measure-delete-btn" data-delete-measure="${m.id}" title="Delete">&times;</button>
    </div>
  `
    )
    .join("");

  el.measuresList.innerHTML = html;

  // Wire up edit handlers (click on item)
  el.measuresList.querySelectorAll(".measure-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      // Don't trigger edit when clicking delete button
      if (e.target.closest("[data-delete-measure]")) return;
      const id = parseInt(item.dataset.measureId, 10);
      const measure = measures.find((m) => m.id === id);
      if (measure) openEditModal(measure);
    });
  });

  // Wire up delete handlers
  el.measuresList.querySelectorAll("[data-delete-measure]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.deleteMeasure, 10);
      await handleDeleteMeasure(id);
    });
  });
}

function openAddModal() {
  editingMeasure = null;
  setText(el.measureModalTitle, "Add Measure");
  el.measureForm?.reset();
  if (el.measureId) el.measureId.value = "";
  if (el.measureEncrypted) el.measureEncrypted.checked = true;
  hide(el.measureError);
  show(el.measureModal);
  el.measureName?.focus();
}

function openEditModal(measure) {
  editingMeasure = measure;
  setText(el.measureModalTitle, "Edit Measure");
  if (el.measureId) el.measureId.value = measure.id;
  if (el.measureName) el.measureName.value = measure.name;
  if (el.measureType) el.measureType.value = measure.type;
  if (el.measureEncrypted) el.measureEncrypted.checked = !!measure.encrypted;
  hide(el.measureError);
  show(el.measureModal);
  el.measureName?.focus();
}

function closeModal() {
  hide(el.measureModal);
  editingMeasure = null;
}

async function handleSaveMeasure(e) {
  e.preventDefault();
  if (!state.session) return;

  const name = el.measureName?.value?.trim();
  const type = el.measureType?.value;
  const encrypted = el.measureEncrypted?.checked ?? true;
  const id = el.measureId?.value ? parseInt(el.measureId.value, 10) : null;

  if (!name) {
    showError("Name is required");
    return;
  }

  try {
    const response = await fetch("/measures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        name,
        type,
        encrypted,
        sort_order: editingMeasure?.sort_order ?? measures.length,
      }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Failed to save measure");
    }

    closeModal();
    await loadMeasures();

    // Notify tracker to refresh
    window.dispatchEvent(new CustomEvent("measures-changed"));
  } catch (err) {
    showError(err.message || "Failed to save measure");
  }
}

async function handleDeleteMeasure(id) {
  if (!confirm("Delete this measure and all its data?")) return;

  try {
    const response = await fetch(`/measures/${id}`, {
      method: "DELETE",
    });

    if (!response.ok) throw new Error("Failed to delete measure");

    await loadMeasures();

    // Notify tracker to refresh
    window.dispatchEvent(new CustomEvent("measures-changed"));
  } catch (err) {
    console.error("Failed to delete measure:", err);
    alert("Failed to delete measure");
  }
}

function showError(message) {
  if (el.measureError) {
    setText(el.measureError, message);
    show(el.measureError);
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export function getMeasures() {
  return measures;
}
