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

document
  .querySelector("#map-add-open")
  .addEventListener("click", () => openNewMapPointDialog());

// Picking only hid the form; this brings it back with what was already typed.
document
  .querySelector("#cancel-map-pick")
  .addEventListener("click", resumeMapPointForm);

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
    privacyDrafts.delete(editingMapPointId);
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
  status.textContent = "正在查詢地址…";
  mapPointSaveButton.disabled = true;
  try {
    await Promise.all(routeRows().map((row) => offerRowPlaces(row)));
    status.textContent = "";
    // Only warns once: a stop can be right even if its address wasn't picked.
    const unchecked = routeRows().filter(rowIsUnchecked);
    const warning = unchecked.map((row) => rowRoutePoint(row).name).join("\n");
    if (unchecked.length && warning !== uncheckedRouteWarning) {
      uncheckedRouteWarning = warning;
      const labels = unchecked.map(
        (row) => row.querySelector("[data-route-point-label]").textContent,
      );
      status.textContent = `${labels.join("、")}還沒選地址，Google 可能找到同名的地方。請點選地址選項；不選的話再按一次儲存，會照你打的文字存。`;
      return;
    }
    const points = routeRows().map((row, index) => ({
      name: row.querySelector("[data-route-name]").value.trim(),
      lat: row.dataset.lat ? Number(row.dataset.lat) : null,
      lng: row.dataset.lng ? Number(row.dataset.lng) : null,
      city: row.dataset.city || null,
      district: row.dataset.district || null,
      order: index + 1,
    }));
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
    // The form already saved its own privacy, which replaces any waiting choice.
    privacyDrafts.delete(saved.id);
    if (saved.id !== selectedMapPointId) flushPrivacyDrafts();
    mapPointForm.reset();
    resetRoutePoints();
    editingMapPointId = null;
    stopMapPick();
    mapPointDialog.close();
    // Any filter could hide what was just saved, and the card should show it.
    mapPointsFilter.clearRegion();
    if (mapPointsFilter.whoKey() !== "mine") mapPointsFilter.setWho("all");
    // Open the saved footprint so the map and card show the result right away.
    selectedMapPointId = saved.id;
    const addToTripForm = addingFootprintToTripForm;
    addingFootprintToTripForm = false;
    await Promise.all([loadMapPoints(), loadTrips()]);
    if (addToTripForm) {
      setCheckedTripPoints([...checkedTripPointIds(), saved.id]);
    }
    mapPointsContainer
      .querySelector(`[data-map-point="${saved.id}"]`)
      ?.scrollIntoView({ block: "nearest" });
  } catch (error) {
    status.textContent = error.message;
  } finally {
    mapPointSaveButton.disabled = false;
  }
});

window.addEventListener("pagehide", flushPrivacyDrafts);
mapPointsContainer.addEventListener("change", updatePrivacy);
timelineFootprints.addEventListener("change", updatePrivacy);
profileFootprintsGrid.addEventListener("change", updatePrivacy);
