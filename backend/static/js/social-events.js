friendForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.querySelector("#friend-form-status");
  status.textContent = "";
  const values = new FormData(friendForm);
  try {
    await apiRequest(
      "/friends",
      jsonOptions("POST", {
        email: getFormText(values, "email"),
        is_close_friend: values.get("is_close_friend") === "on",
      }),
    );
    friendForm.reset();
    status.textContent = "已追蹤好友，權限清單已更新。";
    await Promise.all([loadFriends(), loadEntries(), loadMapPoints()]);
  } catch (error) {
    status.textContent = error.message;
  }
});

friendList.addEventListener("change", async (event) => {
  const checkbox = event.target.closest("[data-close-friend]");
  if (!checkbox) return;
  checkbox.disabled = true;
  try {
    await apiRequest(
      `/friends/${checkbox.dataset.closeFriend}`,
      jsonOptions("PATCH", { is_close_friend: checkbox.checked }),
    );
    await Promise.all([loadFriends(), loadEntries(), loadMapPoints()]);
  } catch (error) {
    window.alert(`更新摯友名單失敗：${error.message}`);
    await loadFriends();
  } finally {
    checkbox.disabled = false;
  }
});

friendList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-unfollow-friend]");
  if (!button) return;
  button.disabled = true;
  try {
    await apiRequest(`/friends/${button.dataset.unfollowFriend}`, {
      method: "DELETE",
    });
    await Promise.all([loadFriends(), loadEntries(), loadMapPoints()]);
  } catch (error) {
    window.alert(`取消追蹤失敗：${error.message}`);
    await loadFriends();
  }
});

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
