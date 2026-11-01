document.querySelector("#open-entry").addEventListener("click", () => {
  if (!currentUser) {
    openLoginDialog();
    return;
  }
  openEntryEditor();
});

document.querySelector("#close-dialog").addEventListener("click", () => {
  dialog.close();
  resetEntryEditor();
});

document.querySelector("#dismiss-dialog").addEventListener("click", () => {
  dialog.close();
  resetEntryEditor();
});

dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

document.querySelector("#refresh-server-status").addEventListener(
  "click",
  refreshServerStatus,
);

document.querySelector("#map-add-open").addEventListener("click", () => {
  if (!currentUser) {
    openLoginDialog();
    return;
  }
  mapPointForm.reset();
  resetRoutePoints();
  editingMapPointId = null;
  setMapPointDialogMode(false);
  pickingMapPoint = false;
  pendingMapPickRow = null;
  mapPickBanner.hidden = true;
  document.querySelector("#map-form-status").textContent = "";
  savedMapPointForm = mapPointFormSnapshot();
  mapPointDialog.showModal();
  mapPointForm.elements.name.focus();
});

document.querySelector("#cancel-map-pick").addEventListener("click", () => {
  pickingMapPoint = false;
  pendingMapPickRow = null;
  mapPickBanner.hidden = true;
  // Picking only hid the form; bring it back with what was already typed.
  mapPointDialog.showModal();
});

document
  .querySelector("#map-point-dismiss")
  .addEventListener("click", closeMapPointDialog);
document
  .querySelector("#map-point-cancel")
  .addEventListener("click", closeMapPointDialog);

mapPointDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeMapPointDialog();
});

mapPointDialog.addEventListener("click", (event) => {
  if (event.target === mapPointDialog) closeMapPointDialog();
});

document.querySelector("#map-point-delete").addEventListener("click", async () => {
  const status = document.querySelector("#map-form-status");
  const name = mapPointForm.elements.name.value.trim();
  if (
    !window.confirm(`確定要刪除「${name}」嗎？也會從行程包中移除，刪除後無法復原。`)
  ) {
    return;
  }
  const deleteButton = document.querySelector("#map-point-delete");
  deleteButton.disabled = true;
  status.textContent = "";
  try {
    await apiRequest(`/map-points/${editingMapPointId}`, { method: "DELETE" });
    editingMapPointId = null;
    mapPointDialog.close();
    await loadMapPoints();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    deleteButton.disabled = false;
  }
});

mapPointForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = new FormData(mapPointForm);
  const status = document.querySelector("#map-form-status");
  status.textContent = "";
  const points = Array.from(
    routePointList.querySelectorAll(".route-point-row"),
    (row, index) => ({
      name: row.querySelector("[data-route-name]").value.trim(),
      lat: row.dataset.lat ? Number(row.dataset.lat) : null,
      lng: row.dataset.lng ? Number(row.dataset.lng) : null,
      order: index + 1,
    }),
  );
  mapPointSaveButton.disabled = true;
  try {
    const payload = {
        name: getFormText(values, "name"),
        note: getFormText(values, "note"),
        privacy: values.get("privacy"),
        points,
      };
    const saved = await apiRequest(
      editingMapPointId
        ? `/map-points/${editingMapPointId}`
        : "/map-points",
      jsonOptions(editingMapPointId ? "PUT" : "POST", payload),
    );
    mapPointForm.reset();
    resetRoutePoints();
    editingMapPointId = null;
    pickingMapPoint = false;
    pendingMapPickRow = null;
    mapPickBanner.hidden = true;
    mapPointDialog.close();
    // Open the saved footprint so the map and card show the result right away.
    selectedMapPointId = saved.id;
    await loadMapPoints();
    mapPointsContainer
      .querySelector(`[data-map-point="${saved.id}"]`)
      ?.scrollIntoView({ block: "nearest" });
  } catch (error) {
    status.textContent = error.message;
  } finally {
    mapPointSaveButton.disabled = false;
  }
});

mapPointsContainer.addEventListener("change", async (event) => {
  const select = event.target.closest("[data-privacy-point]");
  if (!select) return;
  try {
    await apiRequest(
      `/map-points/${select.dataset.privacyPoint}/privacy`,
      jsonOptions("PATCH", { privacy: select.value }),
    );
    await loadMapPoints();
  } catch (error) {
    window.alert(`更新隱私設定失敗：${error.message}`);
    await loadMapPoints();
  }
});
