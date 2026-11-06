function openTripForm() {
  if (!currentUser) {
    openLoginDialog();
    return;
  }
  setTripFormMode();
  showTripForm();
  tripForm.elements.title.focus();
}

function showTripForm() {
  tripForm.hidden = false;
  tripFormOpenButton.hidden = true;
  tripForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

tripFormOpenButton.addEventListener("click", openTripForm);

function setTripFormMode(trip = null) {
  editingTripId = trip?.id ?? null;
  tripFormTitle.textContent = trip ? "編輯行程" : "建立行程";
  tripSubmitButton.textContent = trip ? "儲存變更" : "建立行程";
  document.querySelector("#trip-form-status").textContent = "";
  if (!trip) {
    tripForm.reset();
    tripForm.elements.privacy.value = appSetting("footprintPrivacy");
    tripForm.hidden = true;
    tripFormOpenButton.hidden = false;
    return;
  }
  tripForm.elements.title.value = trip.title;
  tripForm.elements.description.value = trip.description || "";
  tripForm.elements.privacy.value = trip.privacy;
  setCheckedTripPoints(trip.points.map((point) => point.id));
  showTripForm();
}

tripAddFootprintButton.addEventListener("click", () => {
  openNewMapPointDialog(true);
  mapPointDialogTitle.textContent = "新增足跡";
  document.querySelector("#map-point-dialog-description").textContent =
    "儲存後會自動勾選加入行程，你也可以再調整足跡清單。";
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
      privacy: values.get("privacy"),
    };
    const wasEditing = editingTripId !== null;
    const saved = await apiRequest(
      wasEditing ? `/trips/${editingTripId}` : "/trips",
      jsonOptions(wasEditing ? "PUT" : "POST", payload),
    );
    setTripFormMode();
    showToast(wasEditing ? "行程已更新。" : "行程已建立。");
    const listed = { ...saved, is_owner: true, is_saved: false, save_count: 0 };
    trips = wasEditing
      ? trips.map((trip) =>
          trip.id === saved.id ? { ...trip, ...saved, is_owner: true } : trip,
        )
      : [listed, ...trips];
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
        `確定要刪除行程「${trip.title}」嗎？裡面的足跡會保留，分享連結會失效，刪除後無法復原。`,
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
      showToast(`刪除行程失敗：${error.message}`);
    }
    return;
  }
  const reactionButton = event.target.closest("[data-trip-reaction]");
  if (reactionButton) {
    toggleTripReaction(
      reactionButton.dataset.tripReaction,
      Number(reactionButton.dataset.tripId),
    );
    return;
  }
  const meetupButton = event.target.closest("[data-meetup-trip]");
  if (meetupButton) {
    const trip = trips.find((item) => item.id === Number(meetupButton.dataset.meetupTrip));
    if (trip) startMeetupFromTrip(trip);
    return;
  }
  const viewButton = event.target.closest("[data-view-trip-point]");
  if (viewButton) {
    selectedMapPointId = Number(viewButton.dataset.viewTripPoint);
    document.querySelector('.navigation [data-view="map"]').click();
    return;
  }
  const copyButton = event.target.closest("[data-copy-trip]");
  if (copyButton) copyTripToFootprints(Number(copyButton.dataset.copyTrip), copyButton);
});

const tripReactionsPending = new Set();

// The tap shows at once; the server's answer then settles the counts.
async function toggleTripReaction(kind, tripId) {
  const key = `${kind}:${tripId}`;
  const trip = trips.find((item) => item.id === tripId);
  if (!trip || tripReactionsPending.has(key)) return;
  const before = {
    is_liked: trip.is_liked,
    is_saved: trip.is_saved,
    like_count: trip.like_count,
    save_count: trip.save_count,
  };
  const active = kind === "like" ? !trip.is_liked : !trip.is_saved;
  if (kind === "like") {
    trip.is_liked = active;
    trip.like_count += active ? 1 : -1;
  } else {
    trip.is_saved = active;
  }
  // The list is redrawn, so put the focus back on the same button.
  const rerender = () => {
    const hadFocus = document.activeElement?.matches?.(`[data-trip-reaction="${kind}"][data-trip-id="${tripId}"]`);
    renderTripList();
    if (hadFocus) {
      tripList
        .querySelector(`[data-trip-reaction="${kind}"][data-trip-id="${tripId}"]`)
        ?.focus({ preventScroll: true });
    }
  };
  rerender();

  tripReactionsPending.add(key);
  try {
    const saved = await apiRequest(`/trips/${tripId}/${kind}`, {
      method: active ? "PUT" : "DELETE",
    });
    // A refresh may have replaced the list while this was on its way.
    Object.assign(trips.find((item) => item.id === tripId) || {}, saved);
    if (kind === "save") {
      showToast(active ? "已收藏這個行程。" : "已取消收藏。");
      tripsFilter.refresh();
    }
  } catch (error) {
    Object.assign(trip, before);
    showToast(`${kind === "like" ? "按愛心" : "收藏"}失敗：${error.message}`);
  } finally {
    tripReactionsPending.delete(key);
    rerender();
  }
}

// Someone's trip becomes the stops of a new meetup, ready to set a date and send.
function startMeetupFromTrip(trip) {
  if (meetupSending) {
    showToast("上一個揪團還在送出，請稍候。");
    return;
  }
  resetMeetupForm();
  meetupForm.elements.title.value = trip.title;
  meetupSourceTripId = trip.id;
  // A meetup takes up to 20 stops.
  meetupForm.elements.destinations.value = tripStops(trip).slice(0, 20).join("\n");
  showMeetupDialog();
}

// Someone's trip becomes footprints of your own, to plan the same outing.
async function copyTripToFootprints(tripId, button) {
  const trip = trips.find((item) => item.id === tripId);
  if (!trip) return;
  button.disabled = true;
  button.textContent = "新增中…";
  try {
    const created = await apiRequest(
      `/trips/${tripId}/copy`,
      jsonOptions("POST", { privacy: appSetting("footprintPrivacy") }),
    );
    copiedTripIds.add(tripId);
    trip.use_count = (trip.use_count || 0) + 1;
    renderTripList();
    showToast(`已新增 ${created.length} 個足跡到你的足跡。`);
    loadMapPoints();
  } catch (error) {
    button.disabled = false;
    button.textContent = "新增至足跡";
    showToast(`新增失敗：${error.message}`);
  }
}
