// Pure UI-state machine for the favorites toolbar + settings panel.
// Invariant: at most one form is open (add XOR edit), enforced by the single
// tagged-union `activeForm`. Any open form implies the settings panel is open.

export function createInitialFavoritesUiState() {
  return { settingsOpen: false, activeForm: { kind: "none" } };
}

export function openSettings(state) {
  return { settingsOpen: true, activeForm: state.activeForm };
}

export function closeSettings() {
  return { settingsOpen: false, activeForm: { kind: "none" } };
}

export function startAdd() {
  return { settingsOpen: true, activeForm: { kind: "add" } };
}

export function startEdit(state, id) {
  if (typeof id !== "string" || id === "") {
    throw new Error("startEdit requires a non-empty id");
  }

  return { settingsOpen: true, activeForm: { kind: "edit", id } };
}

export function cancelForm(state) {
  return { settingsOpen: state.settingsOpen, activeForm: { kind: "none" } };
}

export function isSettingsOpen(state) {
  return state.settingsOpen === true;
}

export function isAdding(state) {
  return state.activeForm.kind === "add";
}

export function editingId(state) {
  return state.activeForm.kind === "edit" ? state.activeForm.id : null;
}

export function isFormOpen(state) {
  return state.activeForm.kind !== "none";
}
