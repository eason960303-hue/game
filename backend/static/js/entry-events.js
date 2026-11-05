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

  const wasEditing = editingEntryId !== null;
  const [photoFile] = photoInput.files;
  try {
    // Prepared first: an unreadable photo should stop the save, not follow it.
    const photoBlob = photoFile ? await entryPhotoBlob(photoFile) : null;
    const saved = wasEditing
      ? await apiRequest(`/entries/${editingEntryId}`, jsonOptions("PUT", payload))
      : await apiRequest("/entries", jsonOptions("POST", payload));
    // The diary exists from here on, so trying again must update it, not add a second.
    editingEntryId = Number(saved.id);
    try {
      await saveEntryPhoto(editingEntryId, photoBlob);
    } catch (error) {
      document.querySelector("#dialog-title").textContent = "編輯日記";
      statusMessage.textContent = `日記已儲存，但照片沒有存到。${error.message} 可以再按一次儲存重試。`;
      await loadEntries();
      return;
    }
    dialog.close();
    resetEntryEditor();
    showToast(wasEditing ? "已更新日記" : "已儲存日記");
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

async function saveEntryPhoto(entryId, photoBlob) {
  if (photoBlob) {
    await apiRequest(`/entries/${entryId}/photo`, {
      method: "POST",
      headers: { "Content-Type": photoBlob.type },
      body: photoBlob,
    });
  } else if (entryPhotoRemoved) {
    await apiRequest(`/entries/${entryId}/photo`, { method: "DELETE" });
  }
}

async function handleEntryAction(event) {
  const editButton = event.target.closest("[data-edit-entry]");
  if (editButton) {
    if (editButton.getAttribute("aria-disabled") === "true") {
      showToast("發布已超過 24 小時，無法變更內容");
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
    showToast("已刪除日記");
  } catch (error) {
    showToast(`刪除日記失敗：${error.message}`);
    deleteButton.disabled = false;
  }
}

profileDiariesGrid.addEventListener("click", handleEntryAction);
diaryMonthList.addEventListener("click", handleEntryAction);
