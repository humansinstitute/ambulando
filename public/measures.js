// Measures management for Daily Tracker

import { elements as el, show, hide, setText } from "./dom.js";
import { state } from "./state.js";

let measures = [];
let editingMeasure = null;
let draggedItem = null;

const TYPE_LABELS = {
  number: "Number",
  text: "Text",
  goodbad: "Good/Bad",
  options: "Multiple choice",
  rating: "Rating (1-10)",
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

  // Wire up type change to show/hide options config
  el.measureType?.addEventListener("change", handleTypeChange);

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

  // Listen for SSE updates to reload measures
  window.addEventListener("sse:measures", () => {
    void loadMeasures();
    // Also notify tracker to refresh
    window.dispatchEvent(new CustomEvent("measures-changed"));
  });

  // Load measures initially
  await loadMeasures();
}

function handleTypeChange() {
  const type = el.measureType?.value;
  if (type === "options") {
    show(el.measureOptionsConfig);
  } else {
    hide(el.measureOptionsConfig);
  }
}

export async function loadMeasures() {
  if (!state.session) return;

  try {
    const response = await fetch("/api/measures");
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
    <div class="measure-item" data-measure-id="${m.id}" draggable="true">
      <div class="measure-drag-handle" title="Drag to reorder">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="6" r="2"/><circle cx="15" cy="6" r="2"/>
          <circle cx="9" cy="12" r="2"/><circle cx="15" cy="12" r="2"/>
          <circle cx="9" cy="18" r="2"/><circle cx="15" cy="18" r="2"/>
        </svg>
      </div>
      <div class="measure-item-info">
        <div class="measure-item-name">${escapeHtml(m.name)}</div>
        <div class="measure-item-type">${TYPE_LABELS[m.type] || m.type}</div>
      </div>
      <div class="measure-item-badges">
        ${m.encrypted ? '<span class="measure-encrypted-badge" title="Encrypted"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg></span>' : ""}
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

  // Wire up drag-and-drop handlers
  el.measuresList.querySelectorAll(".measure-item").forEach((item) => {
    item.addEventListener("dragstart", handleDragStart);
    item.addEventListener("dragend", handleDragEnd);
    item.addEventListener("dragover", handleDragOver);
    item.addEventListener("drop", handleDrop);
    item.addEventListener("dragenter", handleDragEnter);
    item.addEventListener("dragleave", handleDragLeave);
  });
}

function openAddModal() {
  editingMeasure = null;
  setText(el.measureModalTitle, "Add Measure");
  el.measureForm?.reset();
  if (el.measureId) el.measureId.value = "";
  if (el.measureEncrypted) el.measureEncrypted.checked = true;
  if (el.measureOptions) el.measureOptions.value = "";
  hide(el.measureOptionsConfig);
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

  // Handle options config
  if (measure.type === "options" && measure.config) {
    show(el.measureOptionsConfig);
    try {
      const opts = JSON.parse(measure.config);
      if (el.measureOptions) el.measureOptions.value = opts.join(", ");
    } catch (_err) {
      if (el.measureOptions) el.measureOptions.value = "";
    }
  } else {
    hide(el.measureOptionsConfig);
    if (el.measureOptions) el.measureOptions.value = "";
  }

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

  // Parse options config if type is options
  let config = null;
  if (type === "options") {
    const optionsStr = el.measureOptions?.value?.trim();
    if (!optionsStr) {
      showError("Options are required for multiple choice type");
      return;
    }
    const opts = optionsStr.split(",").map((o) => o.trim()).filter((o) => o);
    if (opts.length < 2 || opts.length > 5) {
      showError("Please provide 2-5 options");
      return;
    }
    config = opts;
  }

  try {
    const response = await fetch("/api/measures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        name,
        type,
        encrypted,
        config,
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
    const response = await fetch(`/api/measures/${id}`, {
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

// ============================================================
// Drag and Drop reordering
// ============================================================

function handleDragStart(e) {
  draggedItem = e.currentTarget;
  draggedItem.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", draggedItem.dataset.measureId);
}

function handleDragEnd(e) {
  e.currentTarget.classList.remove("dragging");
  draggedItem = null;

  // Remove any lingering drag-over classes
  el.measuresList?.querySelectorAll(".measure-item").forEach((item) => {
    item.classList.remove("drag-over");
  });
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
}

function handleDragEnter(e) {
  e.preventDefault();
  const item = e.currentTarget;
  if (item !== draggedItem) {
    item.classList.add("drag-over");
  }
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove("drag-over");
}

function handleDrop(e) {
  e.preventDefault();
  const dropTarget = e.currentTarget;
  dropTarget.classList.remove("drag-over");

  if (!draggedItem || dropTarget === draggedItem) return;

  const draggedId = parseInt(draggedItem.dataset.measureId, 10);
  const dropId = parseInt(dropTarget.dataset.measureId, 10);

  // Find indices
  const draggedIndex = measures.findIndex((m) => m.id === draggedId);
  const dropIndex = measures.findIndex((m) => m.id === dropId);

  if (draggedIndex === -1 || dropIndex === -1) return;

  // Reorder the array
  const [removed] = measures.splice(draggedIndex, 1);
  measures.splice(dropIndex, 0, removed);

  // Re-render immediately for visual feedback
  renderMeasuresList();

  // Save new order to server
  void saveNewOrder();
}

async function saveNewOrder() {
  const orders = measures.map((m, index) => ({
    id: m.id,
    sort_order: index,
  }));

  try {
    const response = await fetch("/api/measures/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orders }),
    });

    if (!response.ok) throw new Error("Failed to save order");

    // Notify other tabs/panels to refresh
    window.dispatchEvent(new CustomEvent("measures-changed"));
  } catch (err) {
    console.error("Failed to save measure order:", err);
    // Reload to get correct order from server
    await loadMeasures();
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
