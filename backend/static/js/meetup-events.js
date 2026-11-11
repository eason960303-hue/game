function resetMeetupForm() {
  meetupForm.reset();
  setMeetupTimeMode("picker", false);
  editingMeetupId = null;
  meetupSourceTripId = null;
  meetupFormTitle.textContent = "發起揪團";
  meetupSubmitButton.textContent = "發起揪團";
}

function meetupFormSnapshot() {
  return JSON.stringify([...new FormData(meetupForm)]);
}

function setMeetupTimeMode(mode, copyValues = true) {
  const pickerFields = document.querySelector("#meetup-picker-fields");
  const manualFields = document.querySelector("#meetup-manual-fields");
  const currentFields = pickerFields.hidden ? manualFields : pickerFields;
  const nextFields = mode === "picker" ? pickerFields : manualFields;
  if (copyValues && currentFields !== nextFields) {
    nextFields.querySelector(".meetup-start-date").value =
      currentFields.querySelector(".meetup-start-date").value;
    nextFields.querySelector(".meetup-start-time").value =
      currentFields.querySelector(".meetup-start-time").value;
  }
  pickerFields.hidden = mode !== "picker";
  manualFields.hidden = mode !== "manual";
  for (const field of [pickerFields, manualFields]) {
    for (const input of field.querySelectorAll("input")) {
      input.disabled = field !== nextFields;
    }
  }
  for (const button of document.querySelectorAll("[data-meetup-time-mode]")) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.meetupTimeMode === mode),
    );
  }
}

const meetupFootprintField = document.querySelector("#meetup-footprint-field");
const meetupFootprintPick = document.querySelector("#meetup-footprint-pick");

// Only your own trips, and only ones that still have places to reuse.
function showPastFootprints() {
  const footprints = mapPoints.filter(
    (point) => point.is_owner && footprintStopNames(point).length > 0,
  );
  meetupFootprintField.hidden = footprints.length === 0;
  meetupFootprintPick.replaceChildren(
    meetupFootprintPick.options[0],
    ...footprints.map((point) => {
      const option = document.createElement("option");
      option.value = String(point.id);
      option.textContent = `${point.name}（${footprintStopNames(point).length} 站）`;
      return option;
    }),
  );
  meetupFootprintPick.value = "";
}

meetupFootprintPick.addEventListener("change", () => {
  const point = mapPoints.find(
    (item) => String(item.id) === meetupFootprintPick.value,
  );
  meetupFootprintPick.value = "";
  if (!point) return;
  const field = meetupForm.elements.destinations;
  const typed = field.value.trim();
  const stops = footprintStopNames(point).join("\n");
  // Added after what's there, so it can extend a route as well as start one.
  field.value = typed ? `${typed}\n${stops}` : stops;
});

function showMeetupDialog() {
  document.querySelector("#meetup-form-status").textContent = "";
  showPastFootprints();
  savedMeetupForm = meetupFormSnapshot();
  meetupDialog.showModal();
  meetupForm.elements.title.focus();
}

function closeMeetupDialog() {
  // The form is on its way out; it comes back by itself if sending fails.
  if (meetupSending) return;
  if (
    meetupFormSnapshot() !== savedMeetupForm &&
    !window.confirm("要放棄尚未儲存的內容嗎？")
  ) {
    return;
  }
  resetMeetupForm();
  meetupDialog.close();
}

function localDateTimeValue(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

function editMeetup(meetup) {
  resetMeetupForm();
  editingMeetupId = meetup.id;
  meetupFormTitle.textContent = "編輯揪團";
  meetupSubmitButton.textContent = "儲存變更";
  meetupForm.elements.title.value = meetup.title;
  const [startDate, startTime] = localDateTimeValue(meetup.starts_at).split("T");
  for (const fields of [
    document.querySelector("#meetup-picker-fields"),
    document.querySelector("#meetup-manual-fields"),
  ]) {
    fields.querySelector(".meetup-start-date").value = startDate || "";
    fields.querySelector(".meetup-start-time").value = startTime || "";
  }
  meetupForm.elements.destinations.value = [meetup.origin, ...meetup.destinations]
    .filter(Boolean)
    .map(meetupStopName)
    .join("\n");
  showMeetupDialog();
}

let meetupSending = false;

function canFlyPaperPlane() {
  return (
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
    "showPopover" in HTMLElement.prototype
  );
}

async function refreshAfterMeetupSaved() {
  // Saving also creates or updates the meetup's footprint, and may count as a trip's use.
  await Promise.all([loadMeetups(), loadMapPoints(), loadTrips()]);
}

// A new meetup leaves as a paper plane, however long the AI takes to read its route.
async function sendMeetupWithPlane(request, status) {
  let settled = false;
  const sent = request.then(
    () => null,
    (error) => error,
  );
  meetupDialog.classList.add("is-folding");
  const plane = playPaperPlane(meetupDialog, () => {
    meetupDialog.classList.remove("is-folding");
    meetupDialog.close();
  });
  sent.then((error) => {
    settled = true;
    if (error) plane.cancel();
  });
  await plane.finished;
  if (!settled) showToast("正在安排路線，完成後會通知你。");
  const error = await sent;
  meetupDialog.classList.remove("is-folding");
  if (error) {
    if (!currentUser) return;
    if (!meetupDialog.open) meetupDialog.showModal();
    status.textContent = error.message;
    return;
  }
  resetMeetupForm();
  await refreshAfterMeetupSaved();
  showToast("揪團已發起！");
}

meetupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (meetupSending) return;
  const values = new FormData(meetupForm);
  const status = document.querySelector("#meetup-form-status");
  status.textContent = "";
  meetupSubmitButton.disabled = true;
  meetupSending = true;
  const idleLabel = meetupSubmitButton.textContent;
  try {
    const destinations = getFormText(values, "destinations")
      .split(/\r?\n/)
      .map((destination) => destination.trim())
      .filter(Boolean);
    const activeTimeFields = document.querySelector("#meetup-picker-fields").hidden
      ? document.querySelector("#meetup-manual-fields")
      : document.querySelector("#meetup-picker-fields");
    const startsAt = `${activeTimeFields.querySelector(".meetup-start-date").value}T${activeTimeFields.querySelector(".meetup-start-time").value}`;
    const payload = {
      title: getFormText(values, "title"),
      starts_at: startsAt,
      destinations,
    };
    const wasEditing = editingMeetupId !== null;
    if (!wasEditing && meetupSourceTripId !== null) {
      payload.source_trip_id = meetupSourceTripId;
    }
    const request = apiRequest(
      wasEditing ? `/meetups/${editingMeetupId}` : "/meetups",
      jsonOptions(wasEditing ? "PUT" : "POST", payload),
    );
    if (!wasEditing && canFlyPaperPlane()) {
      await sendMeetupWithPlane(request, status);
      return;
    }
    meetupSubmitButton.textContent = wasEditing ? "儲存中…" : "發起中…";
    await request;
    resetMeetupForm();
    meetupDialog.close();
    await refreshAfterMeetupSaved();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    meetupSending = false;
    meetupSubmitButton.disabled = false;
    // Resetting the form already picks the right label for what comes next.
    if (meetupSubmitButton.textContent.endsWith("中…")) {
      meetupSubmitButton.textContent = idleLabel;
    }
  }
});

document.querySelector("#meetup-open").addEventListener("click", () => {
  if (!currentUser) {
    openLoginDialog();
    return;
  }
  if (meetupSending) {
    showToast("上一個揪團還在送出，請稍候。");
    return;
  }
  resetMeetupForm();
  showMeetupDialog();
});

document.querySelectorAll("[data-meetup-time-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    setMeetupTimeMode(button.dataset.meetupTimeMode);
  });
});

guardDialog(meetupDialog, closeMeetupDialog, "#meetup-dismiss", "#meetup-cancel");

document.querySelector("#meetup-retry").addEventListener("click", loadMeetups);

meetupList.addEventListener("click", async (event) => {
  if (event.target.closest("[data-meetup-login]")) {
    openLoginDialog();
    return;
  }
  const editButton = event.target.closest("[data-edit-meetup]");
  if (editButton) {
    const meetup = meetups.find(
      (item) => item.id === Number(editButton.dataset.editMeetup),
    );
    if (meetupSending) showToast("上一個揪團還在送出，請稍候。");
    else if (meetup?.is_owner) editMeetup(meetup);
    return;
  }
  const deleteButton = event.target.closest("[data-delete-meetup]");
  if (deleteButton) {
    const meetupId = Number(deleteButton.dataset.deleteMeetup);
    if (!window.confirm("確定取消這個揪團嗎？參加名單也會一併移除。")) {
      return;
    }
    deleteButton.disabled = true;
    try {
      await apiRequest(`/meetups/${meetupId}`, { method: "DELETE" });
      // Cancelling also removes the meetup's footprint.
      await Promise.all([loadMeetups(), loadMapPoints()]);
    } catch (error) {
      showToast(`取消揪團失敗：${error.message}`);
      deleteButton.disabled = false;
    }
    return;
  }
  const joinButton = event.target.closest("[data-join-meetup]");
  const leaveButton = event.target.closest("[data-leave-meetup]");
  const button = joinButton || leaveButton;
  if (!button) return;
  const meetupId = Number(
    joinButton?.dataset.joinMeetup || leaveButton?.dataset.leaveMeetup,
  );
  button.disabled = true;
  try {
    const updated = await apiRequest(
      `/meetups/${meetupId}/participants`,
      { method: joinButton ? "POST" : "DELETE" },
    );
    meetups = meetups.map((meetup) =>
      meetup.id === meetupId ? updated : meetup,
    );
    renderMeetups();
    if (joinButton) showToast("已參加！點卡片上的成員列，可以跟大家約集合細節。");
  } catch (error) {
    showToast(
      joinButton
        ? `參加失敗：${error.message}`
        : `退出揪團失敗：${error.message}`,
    );
    button.disabled = false;
  }
});
