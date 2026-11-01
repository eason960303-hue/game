document.querySelector("#open-entry").addEventListener("click", () => {
  statusMessage.textContent = "";
  if (!currentUser) {
    openLoginDialog();
    return;
  }
  dialog.showModal();
  form.elements.title.focus();
});

document.querySelector("#close-dialog").addEventListener("click", () => {
  dialog.close();
});

document.querySelector("#dismiss-dialog").addEventListener("click", () => {
  dialog.close();
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
  mapPointDialogTitle.textContent = "新增足跡行程";
  mapPointSaveButton.textContent = "儲存足跡";
  pickingMapPoint = false;
  pendingMapPickRow = null;
  mapPickBanner.hidden = true;
  document.querySelector("#map-form-status").textContent = "";
  mapPointDialog.showModal();
  mapPointForm.elements.name.focus();
});

document.querySelector("#cancel-map-pick").addEventListener("click", () => {
  pickingMapPoint = false;
  pendingMapPickRow = null;
  mapPickBanner.hidden = true;
});

document.querySelector("#map-point-dismiss").addEventListener("click", () => {
  pickingMapPoint = false;
  pendingMapPickRow = null;
  editingMapPointId = null;
  mapPickBanner.hidden = true;
  mapPointDialog.close();
});

mapPointDialog.addEventListener("click", (event) => {
  if (event.target === mapPointDialog) {
    pickingMapPoint = false;
    pendingMapPickRow = null;
    editingMapPointId = null;
    mapPointDialog.close();
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
      lat: Number(row.querySelector("[data-route-lat]").value),
      lng: Number(row.querySelector("[data-route-lng]").value),
      order: index + 1,
    }),
  );
  try {
    const payload = {
        name: getFormText(values, "name"),
        latitude: points[0].lat,
        longitude: points[0].lng,
        note: getFormText(values, "note"),
        privacy: values.get("privacy"),
        points,
      };
    await apiRequest(
      editingMapPointId
        ? `/map-points/${editingMapPointId}`
        : "/map-points",
      jsonOptions(editingMapPointId ? "PUT" : "POST", payload),
    );
    const statusMessage = editingMapPointId
      ? "足跡行程已更新。"
      : "足跡行程已儲存。";
    mapPointForm.reset();
    resetRoutePoints();
    editingMapPointId = null;
    mapPointDialogTitle.textContent = "新增足跡行程";
    mapPointSaveButton.textContent = "儲存足跡";
    pickingMapPoint = false;
    pendingMapPickRow = null;
    mapPickBanner.hidden = true;
    status.textContent = statusMessage;
    await loadMapPoints();
    mapPointDialog.close();
  } catch (error) {
    status.textContent = error.message;
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
