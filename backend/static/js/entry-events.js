form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusMessage.textContent = "";
  saveButton.disabled = true;
  saveButton.textContent = "儲存中…";

  const formData = new FormData(form);
  const payload = {
    title: getFormText(formData, "title"),
    content: getFormText(formData, "content"),
    location: getFormText(formData, "location") || null,
    mood: selectedMood.value,
    tags: getFormText(formData, "tags"),
  };

  try {
    if (editingEntryId === null) {
      await apiRequest("/entries", jsonOptions("POST", payload));
    } else {
      await apiRequest(
        `/entries/${editingEntryId}`,
        jsonOptions("PUT", payload),
      );
    }
    dialog.close();
    resetEntryEditor();
    await loadEntries();
    if (!profileView.hidden && currentUser) await loadProfile();
  } catch (error) {
    statusMessage.textContent = error.message;
  } finally {
    saveButton.disabled = false;
    saveButton.textContent =
      editingEntryId === null ? "儲存記錄" : "儲存變更";
  }
});

async function handleEntryAction(event) {
  const editButton = event.target.closest("[data-edit-entry]");
  if (editButton) {
    if (editButton.getAttribute("aria-disabled") === "true") {
      window.alert("發布已超過 24 小時，無法變更內容");
      return;
    }
    await openEntryEditor(Number(editButton.dataset.editEntry));
    return;
  }
  const deleteButton = event.target.closest("[data-delete-entry]");
  if (!deleteButton) return;
  if (!window.confirm("刪除後無法復原，確定要刪除這篇日記嗎？")) return;
  deleteButton.disabled = true;
  try {
    await apiRequest(`/entries/${deleteButton.dataset.deleteEntry}`, {
      method: "DELETE",
    });
    await Promise.all([loadEntries(), currentUser ? loadProfile() : Promise.resolve()]);
  } catch (error) {
    const message =
      error.status === 405
        ? "目前連線的後端尚未載入日記刪除 API，請重新啟動後端服務後再試。"
        : error.message;
    window.alert(`刪除日記失敗：${message}`);
    deleteButton.disabled = false;
  }
}

entriesContainer.addEventListener("click", handleEntryAction);
profileDiariesGrid.addEventListener("click", handleEntryAction);
