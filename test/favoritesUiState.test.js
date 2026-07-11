import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cancelForm,
  closeSettings,
  createInitialFavoritesUiState,
  editingId,
  isAdding,
  isFormOpen,
  isSettingsOpen,
  openSettings,
  startAdd,
  startEdit
} from "../src/favoritesUiState.js";

describe("favoritesUiState", () => {
  it("starts closed with no active form", () => {
    const state = createInitialFavoritesUiState();
    assert.equal(isSettingsOpen(state), false);
    assert.equal(isFormOpen(state), false);
    assert.equal(isAdding(state), false);
    assert.equal(editingId(state), null);
  });

  it("openSettings opens the panel without a form", () => {
    const state = openSettings(createInitialFavoritesUiState());
    assert.equal(isSettingsOpen(state), true);
    assert.equal(isFormOpen(state), false);
  });

  it("startAdd opens panel and the add form", () => {
    const state = startAdd(createInitialFavoritesUiState());
    assert.equal(isSettingsOpen(state), true);
    assert.equal(isAdding(state), true);
    assert.equal(editingId(state), null);
  });

  it("startEdit opens panel and the edit form for an id", () => {
    const state = startEdit(createInitialFavoritesUiState(), "fav-9");
    assert.equal(isSettingsOpen(state), true);
    assert.equal(isAdding(state), false);
    assert.equal(editingId(state), "fav-9");
  });

  it("add and edit are mutually exclusive — startEdit replaces an open add form", () => {
    const state = startEdit(startAdd(createInitialFavoritesUiState()), "fav-9");
    assert.equal(isAdding(state), false);
    assert.equal(editingId(state), "fav-9");
  });

  it("startEdit rejects an empty id", () => {
    assert.throws(() => startEdit(createInitialFavoritesUiState(), ""), /id/);
  });

  it("cancelForm clears the form but keeps the panel open", () => {
    const state = cancelForm(startEdit(createInitialFavoritesUiState(), "fav-9"));
    assert.equal(isSettingsOpen(state), true);
    assert.equal(isFormOpen(state), false);
    assert.equal(editingId(state), null);
  });

  it("closeSettings closes the panel and clears any form", () => {
    const state = closeSettings(startAdd(createInitialFavoritesUiState()));
    assert.equal(isSettingsOpen(state), false);
    assert.equal(isFormOpen(state), false);
  });

  it("transitions do not mutate the previous state", () => {
    const initial = createInitialFavoritesUiState();
    openSettings(initial);
    assert.equal(isSettingsOpen(initial), false);
  });
});
