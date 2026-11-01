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
    privacy: formData.get("privacy"),
    tags: "",
  };

  try {
    await apiRequest("/entries", jsonOptions("POST", payload));
    form.reset();
    selectedMood.value = "開心";
    document.querySelectorAll("[data-mood]").forEach((option) => {
      option.setAttribute(
        "aria-pressed",
        String(option.dataset.mood === "開心"),
      );
    });
    clearPhotoPreview();
    dialog.close();
    await loadEntries();
  } catch (error) {
    statusMessage.textContent = error.message;
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "儲存記錄";
  }
});
