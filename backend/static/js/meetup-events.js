const meetupCitySelect = document.querySelector("#meetup-departure-city");

function populateCityOptions() {
  if (meetupCitySelect.options.length > 1) return;
  const fragment = document.createDocumentFragment();
  for (const city of Object.keys(TW_REGIONS)) {
    const option = document.createElement("option");
    option.value = city;
    option.textContent = city;
    fragment.appendChild(option);
  }
  meetupCitySelect.appendChild(fragment);
}

function resetMeetupForm() {
  meetupForm.reset();
  setMeetupTimeMode("picker", false);
  populateCityOptions();
  meetupCitySelect.value = "";
  editingMeetupId = null;
  meetupFormTitle.textContent = "發起公開邀請";
  meetupSubmitButton.textContent = "發起邀請";
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

function showMeetupDialog() {
  document.querySelector("#meetup-form-status").textContent = "";
  savedMeetupForm = meetupFormSnapshot();
  meetupDialog.showModal();
  meetupForm.elements.title.focus();
}

function closeMeetupDialog() {
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
  meetupFormTitle.textContent = "編輯公開邀請";
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
  populateCityOptions();
  // Older meetups may store the 臺 form, but the options use 台.
  meetupCitySelect.value = meetup.departure_city.replace("臺", "台");
  meetupForm.elements.origin.value = meetup.origin ? meetup.origin.name : "";
  meetupForm.elements.destinations.value = meetup.destinations
    .map((destination) =>
      typeof destination === "string" ? destination : destination.name,
    )
    .join("\n");
  showMeetupDialog();
}

meetupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = new FormData(meetupForm);
  const status = document.querySelector("#meetup-form-status");
  status.textContent = "";
  meetupSubmitButton.disabled = true;
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
      departure_city: getFormText(values, "departure_city"),
      origin: getFormText(values, "origin"),
      destinations,
    };
    const wasEditing = editingMeetupId !== null;
    await apiRequest(
      wasEditing ? `/meetups/${editingMeetupId}` : "/meetups",
      jsonOptions(wasEditing ? "PUT" : "POST", payload),
    );
    resetMeetupForm();
    meetupDialog.close();
    await loadMeetups();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    meetupSubmitButton.disabled = false;
  }
});

document.querySelector("#meetup-open").addEventListener("click", () => {
  if (!currentUser) {
    openLoginDialog();
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

document
  .querySelector("#meetup-dismiss")
  .addEventListener("click", closeMeetupDialog);
document
  .querySelector("#meetup-cancel")
  .addEventListener("click", closeMeetupDialog);

meetupDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeMeetupDialog();
});

meetupDialog.addEventListener("click", (event) => {
  if (event.target === meetupDialog) closeMeetupDialog();
});

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
    if (meetup?.is_owner) editMeetup(meetup);
    return;
  }
  const deleteButton = event.target.closest("[data-delete-meetup]");
  if (deleteButton) {
    const meetupId = Number(deleteButton.dataset.deleteMeetup);
    if (!window.confirm("確定取消這個公開邀請嗎？參加名單也會一併移除。")) {
      return;
    }
    deleteButton.disabled = true;
    try {
      await apiRequest(`/meetups/${meetupId}`, { method: "DELETE" });
      await loadMeetups();
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
  } catch (error) {
    showToast(
      joinButton
        ? `參加失敗：${error.message}`
        : `退出揪團失敗：${error.message}`,
    );
    button.disabled = false;
  }
});
