document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    const view = button.dataset.view;
    if (view !== "map" && pickingMapPoint) {
      pickingMapPoint = false;
      pendingMapPickRow = null;
      mapPickBanner.hidden = true;
    }
    document.querySelectorAll("[data-view]").forEach((item) => {
      item.removeAttribute("aria-current");
    });
    button.setAttribute("aria-current", "page");

    homeView.hidden = view !== "home";
    profileView.hidden = view !== "profile";
    aiDiaryView.hidden = view !== "ai-diary";
    mapView.hidden = view !== "map";
    tripsView.hidden = view !== "trips";
    if (view === "ai-diary") {
      if (currentUser) loadAiDiaryStatus();
      else openLoginDialog();
    } else if (view === "profile") {
      if (currentUser) loadProfile();
      else openLoginDialog();
    } else if (view === "map") {
      initMap();
      if (currentUser) {
        loadMapPoints();
        loadFriends();
      }
      else openLoginDialog();
    } else if (view === "trips") {
      if (currentUser) loadTravelData();
      else openLoginDialog();
    }
  });
});

document.querySelector("#retry-load").addEventListener("click", loadEntries);
document.querySelector("#profile-retry").addEventListener("click", loadProfile);
entriesContainer.addEventListener("change", updateEntryPrivacy);

document.querySelector("#profile-edit-open").addEventListener("click", () => {
  if (!currentUser) {
    openLoginDialog();
    return;
  }
  profileEditStatus.textContent = "";
  profileEditForm.elements.display_name.value =
    currentProfile?.display_name || "";
  profileEditForm.elements.bio.value = currentProfile?.bio || "";
  profileEditForm.elements.avatar_url.value =
    currentProfile?.avatar_url || "";
  profileEditDialog.showModal();
  profileEditForm.elements.display_name.focus();
});

document
  .querySelector("#profile-edit-dismiss")
  .addEventListener("click", () => profileEditDialog.close());
document
  .querySelector("#profile-edit-cancel")
  .addEventListener("click", () => profileEditDialog.close());

profileEditForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  profileEditStatus.textContent = "";
  profileEditSaveButton.disabled = true;
  const values = new FormData(profileEditForm);
  try {
    await apiRequest(
      "/user/profile",
      jsonOptions("PATCH", {
        display_name: getFormText(values, "display_name"),
        bio: getFormText(values, "bio"),
        avatar_url: getFormText(values, "avatar_url"),
      }),
    );
    await loadProfile();
    profileEditDialog.close();
  } catch (error) {
    profileEditStatus.textContent = error.message;
  } finally {
    profileEditSaveButton.disabled = false;
  }
});
