// Measures management for Daily Tracker

import { elements as el, show, hide, setText } from "./dom.js";
import { encryptEntry, decryptEntry } from "./entryCrypto.js";
import { state } from "./state.js";

let measures = [];
let editingMeasure = null;
let draggedItem = null;
let openMenuId = null; // Track which measure's menu is open

// Check if user is typing in an input/textarea (to prevent focus stealing)
function isUserTyping() {
  const active = document.activeElement;
  if (!active) return false;
  const tag = active.tagName.toLowerCase();
  return tag === "input" || tag === "textarea";
}

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

  // Prevent unchecking the encryption checkbox
  el.measureEncrypted?.addEventListener("change", handleEncryptedChange);

  // Close any open menus when clicking elsewhere
  document.addEventListener("click", handleDocumentClick);

  // Listen for tab switches to reload measures
  window.addEventListener("tab-switched", (e) => {
    if (e.detail.tab === "measures") {
      void loadMeasures();
    }
  });

  // Listen for SSE updates to reload measures
  window.addEventListener("sse:measures", () => {
    // Skip re-render if user is typing in an input
    if (isUserTyping()) return;
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
    const rawMeasures = data.measures || [];

    // Decrypt measure names and configs
    measures = await decryptMeasures(rawMeasures);
    renderMeasuresList();
  } catch (err) {
    console.error("Failed to load measures:", err);
    measures = [];
    renderMeasuresList();
  }
}

// Decrypt measure names and config fields
async function decryptMeasures(rawMeasures) {
  const decrypted = [];

  for (const m of rawMeasures) {
    try {
      // Try to decrypt name
      let name = m.name;
      let needsMigration = false;

      try {
        const decryptedName = await decryptEntry(m.name);
        if (decryptedName && typeof decryptedName === "string") {
          name = decryptedName;
        } else {
          // Decryption returned invalid value - treat as plaintext, flag for migration
          needsMigration = true;
        }
      } catch (_err) {
        // If decryption fails, it's likely plaintext (pre-encryption data)
        needsMigration = true;
      }

      // Try to decrypt config if present
      let config = m.config;
      if (m.config) {
        try {
          const decryptedConfig = await decryptEntry(m.config);
          if (decryptedConfig && typeof decryptedConfig === "string") {
            config = decryptedConfig;
          }
        } catch (_err) {
          // If decryption fails, keep as-is (might be plaintext JSON)
        }
      }

      decrypted.push({
        ...m,
        name,
        config,
        _needsMigration: needsMigration,
      });

      // Auto-migrate plaintext measures to encrypted
      if (needsMigration) {
        void migrateMeasureToEncrypted(m.id, name, config);
      }
    } catch (err) {
      console.error(`Failed to process measure ${m.id}:`, err);
      decrypted.push({
        ...m,
        name: "[Unable to decrypt]",
        _decryptError: true,
      });
    }
  }

  return decrypted;
}

// Migrate a plaintext measure to encrypted storage
async function migrateMeasureToEncrypted(id, name, config) {
  try {
    const encryptedName = await encryptEntry(name);
    const encryptedConfig = config ? await encryptEntry(config) : null;

    await fetch("/api/measures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        name: encryptedName,
        config: encryptedConfig,
        _migrationOnly: true,
      }),
    });
  } catch (_err) {
    // Migration failed silently - will retry on next load
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
      <div class="measure-menu-container">
        <button class="measure-menu-btn" data-menu-measure="${m.id}" title="More options">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="2"/>
            <circle cx="12" cy="12" r="2"/>
            <circle cx="12" cy="19" r="2"/>
          </svg>
        </button>
        <div class="measure-dropdown" data-dropdown="${m.id}" hidden>
          <button class="measure-dropdown-item" data-edit-measure="${m.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
            Edit
          </button>
          <button class="measure-dropdown-item measure-dropdown-delete" data-delete-measure="${m.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
            Delete
          </button>
        </div>
      </div>
    </div>
  `
    )
    .join("");

  el.measuresList.innerHTML = html;

  // Wire up 3-dot menu buttons
  el.measuresList.querySelectorAll("[data-menu-measure]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.menuMeasure, 10);
      toggleMenu(id);
    });
  });

  // Wire up edit handlers (via dropdown)
  el.measuresList.querySelectorAll("[data-edit-measure]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.editMeasure, 10);
      const measure = measures.find((m) => m.id === id);
      closeAllMenus();
      if (measure) openEditModal(measure);
    });
  });

  // Wire up delete handlers (via dropdown)
  el.measuresList.querySelectorAll("[data-delete-measure]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.deleteMeasure, 10);
      closeAllMenus();
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
  if (el.measureType) el.measureType.disabled = false; // Enable type selection for new measures
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
  if (el.measureType) {
    el.measureType.value = measure.type;
    el.measureType.disabled = true; // Can't change type on existing measure
  }
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
    // Encrypt name and config before saving
    const encryptedName = await encryptEntry(name);
    const encryptedConfig = config ? await encryptEntry(JSON.stringify(config)) : null;

    const response = await fetch("/api/measures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        name: encryptedName,
        type,
        encrypted,
        config: encryptedConfig,
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
// 3-dot menu handling
// ============================================================

function toggleMenu(measureId) {
  const dropdown = document.querySelector(`[data-dropdown="${measureId}"]`);
  if (!dropdown) return;

  // Close other menus first
  if (openMenuId !== measureId) {
    closeAllMenus();
  }

  if (dropdown.hasAttribute("hidden")) {
    dropdown.removeAttribute("hidden");
    openMenuId = measureId;
  } else {
    dropdown.setAttribute("hidden", "");
    openMenuId = null;
  }
}

function closeAllMenus() {
  document.querySelectorAll(".measure-dropdown").forEach((d) => {
    d.setAttribute("hidden", "");
  });
  openMenuId = null;
}

function handleDocumentClick(e) {
  // Close menus when clicking outside
  if (!e.target.closest(".measure-menu-container")) {
    closeAllMenus();
  }
}

// ============================================================
// Encryption checkbox handling
// ============================================================

function handleEncryptedChange(e) {
  if (!e.target.checked) {
    e.target.checked = true;
    alert("Don't be silly, encryption rules. I don't want to see what you're tracking!");
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
