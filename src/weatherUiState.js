// Pure UI-state machine for the weather panel's city form: one flag,
// whether the form is open over an already-configured city. Unlike
// favoritesUiState there is no add/edit distinction — the same form covers
// first-time setup and later city changes.

export function createInitialWeatherUiState() {
  return { editing: false };
}

export function startEditingCity() {
  return { editing: true };
}

export function stopEditingCity() {
  return { editing: false };
}

export function isEditingCity(state) {
  return state.editing === true;
}
