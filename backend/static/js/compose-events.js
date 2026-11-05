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
  document.querySelector("#dialog-title").textContent = "寫日記";
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

// Chat can't take a photo and may not catch a place, so it offers to fill in what's missing.
function askForMissingEntryDetails(entry, prompt = null) {
  const missingLocation = !entry.location;
  const missingPhoto = !entry.photo_url;
  if (!missingLocation && !missingPhoto) {
    prompt?.remove();
    return;
  }
  const missing = [missingLocation && "地點", missingPhoto && "照片"]
    .filter(Boolean)
    .join("和");
  const element = prompt || appendAiChatMessage("");
  element.textContent = `「${entry.title}」還沒有${missing}，要補上嗎？`;
  const actions = document.createElement("div");
  actions.className = "ai-chat-actions";
  const addAction = (label, onClick) => {
    const button = document.createElement("button");
    button.className = "small-action";
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", onClick);
    actions.append(button);
  };
  const openEditor = async (focusField) => {
    await openEntryEditor(entry.id);
    if (!dialog.open || editingEntryId !== entry.id) return;
    dialog.addEventListener(
      "close",
      async () => {
        try {
          askForMissingEntryDetails(
            await apiRequest(`/entries/${entry.id}`),
            element,
          );
        } catch {
          element.remove();
        }
      },
      { once: true },
    );
    focusField();
  };
  if (missingLocation) {
    addAction("新增地點", () =>
      openEditor(() => form.elements.location.focus()),
    );
  }
  if (missingPhoto) {
    addAction("新增照片", () => openEditor(() => photoInput.click()));
  }
  addAction("不用了", () => element.remove());
  element.append(actions);
  aiChatMessages.scrollTop = aiChatMessages.scrollHeight;
}

let aiChatBusy = false;

function updateAiChatSend() {
  aiChatSendButton.disabled = aiChatBusy || !aiChatInput.value.trim();
  aiChatSendButton.classList.toggle("is-busy", aiChatBusy);
}

// The box grows with the message, up to the limit set in the stylesheet, then scrolls.
function fitAiChatInput() {
  aiChatInput.style.height = "auto";
  aiChatInput.style.height = `${aiChatInput.scrollHeight + 2}px`;
  updateAiChatSend();
}

aiChatInput.addEventListener("input", fitAiChatInput);

// With a keyboard, Enter sends and Shift+Enter starts a new line. On a phone Enter stays a
// new line, and while choosing Chinese characters it only confirms the choice.
aiChatInput.addEventListener("keydown", (event) => {
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches
  ) {
    event.preventDefault();
    if (!aiChatSendButton.disabled) aiChatForm.requestSubmit();
  }
});

// Keeps the keyboard up after sending. Losing focus would also bring the tab bar back and
// move this button out from under the finger before the tap lands.
aiChatSendButton.addEventListener("mousedown", (event) => event.preventDefault());

// The keyboard takes the room the tab bar and newest messages were using.
aiChatInput.addEventListener("focus", () => {
  aiChatMessages.scrollTop = aiChatMessages.scrollHeight;
});

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
  // Sent means gone from the box, as in any chat app; a failure puts it back below.
  aiChatInput.value = "";
  fitAiChatInput();
  const pending = appendAiChatTyping();
  aiChatBusy = true;
  updateAiChatSend();
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
    const saved = appendAiChatMessage(
      `已存成日記「${entry.title}」\n心情：${entry.mood}${entry.location ? `\n地點：${entry.location}` : ""}${tags}`,
    );
    await flyDiaryToList(saved);
    const savedDate = serverDate(entry.created_at);
    showDiaryMonth(savedDate.getFullYear(), savedDate.getMonth() + 1);
    await loadEntries();
    revealNewDiary(entry);
    if (appSetting("aiFollowUp") === "on") askForMissingEntryDetails(entry);
  } catch (error) {
    pending.remove();
    appendAiChatMessage(
      `這次尚未儲存日記：${error.message}`,
      "error",
    );
    if (!aiChatInput.value) {
      aiChatInput.value = message;
      fitAiChatInput();
    }
  } finally {
    aiChatBusy = false;
    updateAiChatSend();
  }
});
