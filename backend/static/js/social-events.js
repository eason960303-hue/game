function setTripFormMode(trip = null) {
  editingTripId = trip?.id ?? null;
  tripFormTitle.textContent = trip ? "編輯行程包" : "建立行程包";
  tripSubmitButton.textContent = trip ? "儲存變更" : "建立行程包";
  tripCancelEditButton.hidden = !trip;
  if (!trip) {
    tripForm.reset();
    return;
  }
  tripForm.elements.title.value = trip.title;
  tripForm.elements.description.value = trip.description || "";
  tripForm.elements.is_public.checked = trip.is_public;
  setCheckedTripPoints(trip.points.map((point) => point.id));
  tripForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

tripAddFootprintButton.addEventListener("click", () => {
  openNewMapPointDialog(true);
  mapPointDialogTitle.textContent = "新增足跡";
  document.querySelector("#map-point-dialog-description").textContent =
    "儲存後會自動勾選加入行程包，你也可以再調整足跡清單。";
});

tripForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = new FormData(tripForm);
  const status = document.querySelector("#trip-form-status");
  status.textContent = "";
  try {
    const payload = {
      title: getFormText(values, "title"),
      description: getFormText(values, "description"),
      point_ids: checkedTripPointIds(),
      is_public: values.get("is_public") === "on",
    };
    const wasEditing = editingTripId !== null;
    const saved = await apiRequest(
      wasEditing ? `/trips/${editingTripId}` : "/trips",
      jsonOptions(wasEditing ? "PUT" : "POST", payload),
    );
    setTripFormMode();
    status.textContent = wasEditing ? "行程包已更新。" : "行程包已建立。";
    trips = wasEditing
      ? trips.map((trip) => (trip.id === saved.id ? saved : trip))
      : [saved, ...trips];
    renderTrips();
  } catch (error) {
    status.textContent = error.message;
  }
});

tripCancelEditButton.addEventListener("click", () => {
  setTripFormMode();
  document.querySelector("#trip-form-status").textContent = "";
});

tripList.addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-edit-trip]");
  if (editButton) {
    const trip = trips.find(
      (item) => item.id === Number(editButton.dataset.editTrip),
    );
    if (trip) {
      document.querySelector("#trip-form-status").textContent = "";
      setTripFormMode(trip);
    }
    return;
  }
  const deleteButton = event.target.closest("[data-delete-trip]");
  if (deleteButton) {
    const tripId = Number(deleteButton.dataset.deleteTrip);
    const trip = trips.find((item) => item.id === tripId);
    if (
      !trip ||
      !window.confirm(
        `確定要刪除行程包「${trip.title}」嗎？裡面的足跡會保留，分享連結會失效，刪除後無法復原。`,
      )
    ) {
      return;
    }
    deleteButton.disabled = true;
    try {
      await apiRequest(`/trips/${tripId}`, { method: "DELETE" });
      if (editingTripId === tripId) setTripFormMode();
      trips = trips.filter((item) => item.id !== tripId);
      renderTrips();
    } catch (error) {
      deleteButton.disabled = false;
      showToast(`刪除行程包失敗：${error.message}`);
    }
    return;
  }
  const button = event.target.closest("[data-share-trip]");
  if (!button) return;
  const shareUrl = `${window.location.origin}${apiUrl(
    `/trips/${button.dataset.shareTrip}/share`,
  )}`;
  try {
    await navigator.clipboard.writeText(shareUrl);
    button.textContent = "分享 API 連結已複製";
  } catch {
    window.prompt("複製這個公開行程 API 連結：", shareUrl);
  }
});
