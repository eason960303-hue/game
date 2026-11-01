tripForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = new FormData(tripForm);
  const status = document.querySelector("#trip-form-status");
  status.textContent = "";
  const pointIds = Array.from(
    tripPointOptions.querySelectorAll("[data-trip-point]:checked"),
    (checkbox) => Number(checkbox.value),
  );
  try {
    await apiRequest(
      "/trips",
      jsonOptions("POST", {
        title: getFormText(values, "title"),
        description: getFormText(values, "description"),
        point_ids: pointIds,
        is_public: values.get("is_public") === "on",
      }),
    );
    tripForm.reset();
    status.textContent = "行程包已建立。";
    await loadTrips();
  } catch (error) {
    status.textContent = error.message;
  }
});

tripList.addEventListener("click", async (event) => {
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
