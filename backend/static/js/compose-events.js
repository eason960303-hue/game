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
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    statusMessage.textContent = "請選擇有效的圖片檔案。";
    photoInput.value = "";
    return;
  }
  statusMessage.textContent = "";
  photoPreviewUrl = URL.createObjectURL(file);
  photoPreviewImage.src = photoPreviewUrl;
  photoFileName.textContent = file.name;
  photoPreview.hidden = false;
});

document.querySelector("#remove-photo").addEventListener("click", clearPhotoPreview);

document.querySelectorAll("[data-mood]").forEach((button) => {
  button.addEventListener("click", () => {
    selectedMood.value = button.dataset.mood;
    document.querySelectorAll("[data-mood]").forEach((option) => {
      option.setAttribute("aria-pressed", String(option === button));
    });
  });
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
  const pending = appendAiChatMessage("正在整理你的日記…");
  aiChatSendButton.disabled = true;
  aiChatSendButton.textContent = "整理中…";
  try {
    const result = await apiRequest(
      "/diary-chat",
      jsonOptions("POST", {
        message,
        privacy: values.get("privacy"),
      }),
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
      `${result.reply}\n\n已整理並儲存「${entry.title}」\n心情：${entry.mood}${tags}`,
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
