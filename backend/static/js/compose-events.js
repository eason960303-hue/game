function clearPhotoPreview(resetInput = true) {
  if (photoPreviewUrl) {
    URL.revokeObjectURL(photoPreviewUrl);
    photoPreviewUrl = null;
  }
  if (resetInput) photoInput.value = "";
  photoPreviewImage.removeAttribute("src");
  photoFileName.textContent = "";
  photoPreview.hidden = true;
}

photoInput.addEventListener("change", () => {
  clearPhotoPreview(false);
  const [file] = photoInput.files;
  if (!file) {
    showSavedEntryPhoto();
    return;
  }
  if (!file.type.startsWith("image/")) {
    statusMessage.textContent = "請選擇有效的圖片檔案。";
    photoInput.value = "";
    showSavedEntryPhoto();
    return;
  }
  statusMessage.textContent = "";
  photoPreviewUrl = URL.createObjectURL(file);
  photoPreviewImage.src = photoPreviewUrl;
  photoFileName.textContent = file.name;
  photoPreview.hidden = false;
});

document.querySelector("#remove-photo").addEventListener("click", () => {
  clearPhotoPreview();
  entryPhotoRemoved = Boolean(savedEntryPhotoUrl);
});

function showSavedEntryPhoto() {
  if (!savedEntryPhotoUrl || entryPhotoRemoved) return;
  photoPreviewImage.src = mediaUrl(savedEntryPhotoUrl);
  photoFileName.textContent = "目前的照片";
  photoPreview.hidden = false;
}

document.querySelectorAll("[data-mood]").forEach((button) => {
  button.addEventListener("click", () => {
    selectedMood.value = button.dataset.mood;
    document.querySelectorAll("[data-mood]").forEach((option) => {
      option.setAttribute("aria-pressed", String(option === button));
    });
  });
});

function resetEntryEditor() {
  editingEntryId = null;
  form.reset();
  form.elements.tags.value = "";
  selectedMood.value = "開心";
  document.querySelectorAll("[data-mood]").forEach((option) => {
    option.setAttribute("aria-pressed", String(option.dataset.mood === "開心"));
  });
  document.querySelector("#dialog-title").textContent = "新增一筆記錄";
  saveButton.textContent = "儲存記錄";
  statusMessage.textContent = "";
  savedEntryPhotoUrl = null;
  entryPhotoRemoved = false;
  clearPhotoPreview();
}

function entryFormSnapshot() {
  return JSON.stringify([
    form.elements.title.value,
    form.elements.content.value,
    form.elements.location.value,
    selectedMood.value,
    photoInput.value,
    entryPhotoRemoved,
  ]);
}

function closeEntryDialog() {
  if (
    entryFormSnapshot() !== savedEntryForm &&
    !window.confirm("要放棄尚未儲存的內容嗎？")
  ) {
    return;
  }
  dialog.close();
  resetEntryEditor();
}

async function openEntryEditor(entryId = null) {
  if (!currentUser) {
    openLoginDialog();
    return;
  }
  resetEntryEditor();
  if (entryId !== null) {
    try {
      const entry = await apiRequest(`/entries/${entryId}`);
      if (!entry.is_owner) {
        showToast("只能編輯自己的日記。");
        return;
      }
      if (!entryCanBeEdited(entry.created_at)) {
        showToast("發布已超過 24 小時，無法變更內容");
        return;
      }
      editingEntryId = Number(entry.id);
      form.elements.title.value = entry.title || "";
      form.elements.content.value = entry.content || "";
      form.elements.location.value = entry.location || "";
      form.elements.tags.value = entry.tags || "";
      savedEntryPhotoUrl = entry.photo_url || null;
      showSavedEntryPhoto();
      selectedMood.value = entry.mood || "開心";
      document.querySelectorAll("[data-mood]").forEach((option) => {
        option.setAttribute(
          "aria-pressed",
          String(option.dataset.mood === selectedMood.value),
        );
      });
      document.querySelector("#dialog-title").textContent = "編輯日記";
      saveButton.textContent = "儲存變更";
    } catch (error) {
      showToast(`無法開啟日記編輯：${error.message}`);
      return;
    }
  }
  savedEntryForm = entryFormSnapshot();
  dialog.showModal();
  form.elements.title.focus();
}

aiChatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) {
    openLoginDialog();
    return;
  }
  const values = new FormData(aiChatForm);
  const message = getFormText(values, "message");
  if (!message) return;
  appendAiChatMessage(message, "user");
  const pending = appendAiChatMessage("正在整理你的日記…");
  aiChatSendButton.disabled = true;
  aiChatSendButton.textContent = "整理中…";
  try {
    const result = await apiRequest(
      "/diary-chat",
      jsonOptions("POST", { message }),
    );
    pending.remove();
    const entry = result.entry;
    const tags = entry.tags
      ? `\n標籤：${entry.tags
          .split(",")
          .map((tag) => `#${tag.trim().replace(/^#/, "")}`)
          .join(" ")}`
      : "";
    appendAiChatMessage(
      `${result.reply}\n\n已儲存「${entry.title}」\n心情：${entry.mood}${tags}`,
    );
    aiChatInput.value = "";
    await loadEntries();
  } catch (error) {
    pending.remove();
    appendAiChatMessage(
      `這次尚未儲存日記：${error.message}`,
      "error",
    );
  } finally {
    aiChatSendButton.disabled = false;
    aiChatSendButton.textContent = "整理並儲存";
  }
});
