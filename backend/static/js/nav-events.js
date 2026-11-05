const navigationButtons = document.querySelectorAll(".navigation [data-view]");
const viewButtons = document.querySelectorAll("[data-view]");

// The address remembers the page so a refresh stays on it.
function usernameFromUrl() {
  const hash = window.location.hash.slice(1);
  if (!hash.startsWith("user/")) return null;
  try {
    return decodeURIComponent(hash.slice("user/".length)) || null;
  } catch {
    return null;
  }
}

function viewFromUrl() {
  if (usernameFromUrl()) return "profile";
  const view = window.location.hash.slice(1);
  return Array.from(navigationButtons).some((item) => item.dataset.view === view)
    ? view
    : "home";
}

const navigationBar = document.querySelector(".navigation");
const navIndicator = document.querySelector("#nav-indicator");
const navigationLinks = [...navigationBar.querySelectorAll(".nav-link")];
const NAV_DRAG_START_PX = 8;
let navDrag = null;
let ignoreNavClick = false;

function moveNavIndicator(left, link) {
  navIndicator.style.setProperty("--nav-indicator-x", `${left}px`);
  navIndicator.style.setProperty("--nav-indicator-y", `${link.offsetTop}px`);
  navIndicator.style.setProperty("--nav-indicator-width", `${link.offsetWidth}px`);
  navIndicator.style.setProperty("--nav-indicator-height", `${link.offsetHeight}px`);
}

// Someone else's profile selects no tab, so the capsule fades out in place.
function placeNavIndicator(animate) {
  // Appearing for the first time, it has no earlier tab to slide from.
  const wasPlaced = navIndicator.classList.contains("is-placed");
  navigationBar.classList.toggle("is-animated", animate && wasPlaced);
  const current = navigationBar.querySelector('.nav-link[aria-current="page"]');
  navIndicator.classList.toggle("is-placed", Boolean(current));
  if (current) moveNavIndicator(current.offsetLeft, current);
}

// Covers the first paint, web fonts arriving, and the bar changing shape between layouts.
new ResizeObserver(() => {
  if (!navDrag?.active) placeNavIndicator(false);
}).observe(navigationBar);

function nearestNavLink(x) {
  const distance = (link) => Math.abs(link.offsetLeft + link.offsetWidth / 2 - x);
  return navigationLinks.reduce((best, link) =>
    distance(link) < distance(best) ? link : best,
  );
}

function followNavDrag(clientX) {
  const x = clientX - navigationBar.getBoundingClientRect().left - navigationBar.clientLeft;
  const link = nearestNavLink(x);
  const last = navigationLinks.at(-1);
  const left = Math.min(
    Math.max(x - link.offsetWidth / 2, navigationLinks[0].offsetLeft),
    last.offsetLeft + last.offsetWidth - link.offsetWidth,
  );
  moveNavIndicator(left, link);
  navDrag.target?.classList.remove("is-drag-target");
  link.classList.add("is-drag-target");
  navDrag.target = link;
}

function endNavDrag() {
  const { target } = navDrag;
  navDrag = null;
  target?.classList.remove("is-drag-target");
  navigationBar.classList.remove("is-dragging");
  return target;
}

navigationBar.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  ignoreNavClick = false;
  navDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    active: false,
    target: null,
  };
});

navigationBar.addEventListener("pointermove", (event) => {
  if (navDrag?.pointerId !== event.pointerId) return;
  if (!navDrag.active) {
    const dx = Math.abs(event.clientX - navDrag.startX);
    const dy = Math.abs(event.clientY - navDrag.startY);
    if (dx < NAV_DRAG_START_PX) {
      if (dy >= NAV_DRAG_START_PX) navDrag = null;
      return;
    }
    navDrag.active = true;
    navigationBar.setPointerCapture(event.pointerId);
    navigationBar.classList.add("is-dragging");
    navIndicator.classList.add("is-placed");
  }
  followNavDrag(event.clientX);
});

navigationBar.addEventListener("pointerup", (event) => {
  if (navDrag?.pointerId !== event.pointerId) return;
  const wasDragging = navDrag.active;
  const target = endNavDrag();
  if (!wasDragging) return;
  // Released on the tab already open: there is nothing to switch, so it just settles back.
  if (target.getAttribute("aria-current") === "page") placeNavIndicator(true);
  else target.click();
  // A mouse still sends a click once a drag ends; only the switch above should count.
  ignoreNavClick = true;
  setTimeout(() => {
    ignoreNavClick = false;
  }, 100);
});

navigationBar.addEventListener("pointercancel", (event) => {
  if (navDrag?.pointerId !== event.pointerId) return;
  endNavDrag();
  placeNavIndicator(true);
});

navigationBar.addEventListener(
  "click",
  (event) => {
    if (ignoreNavClick) event.stopPropagation();
  },
  true,
);

function applyView(view, username = null) {
  flushPrivacyDrafts();
  viewedUsername = username;
  const leftMapPick = view !== "map" && pickingMapPoint;
  if (leftMapPick) stopMapPick();
  navigationButtons.forEach((item) => {
    // Someone else's profile is not the "my profile" tab.
    if (item.dataset.view === view && !username) {
      item.setAttribute("aria-current", "page");
    } else {
      item.removeAttribute("aria-current");
    }
  });

  homeView.hidden = view !== "home";
  profileView.hidden = view !== "profile";
  aiDiaryView.hidden = view !== "ai-diary";
  mapView.hidden = view !== "map";
  document.body.classList.toggle("map-mode", view === "map");
  tripsView.hidden = view !== "trips";
  // Leaving mid-pick must not lose the form that is waiting behind the map.
  if (leftMapPick) mapPointDialog.showModal();
  placeNavIndicator(true);
}

function loadViewData(view) {
  if (view === "home") return;
  if (view === "map") initMap();
  if (!currentUser) {
    openLoginDialog();
    return;
  }
  if (view === "ai-diary") {
    loadAiDiaryStatus();
    loadEntries();
  }
  else if (view === "map") loadMapPoints();
  else if (view === "trips") loadTravelData();
  else if (viewedUsername) loadMemberProfile(viewedUsername);
  else loadProfile();
}

const LAST_PAGE_KEY = "life-logger-last-page";
let shownPageUrl = window.location.href;

// Storage can be blocked; the address still works as the page's memory then.
function rememberPage() {
  shownPageUrl = window.location.href;
  try {
    localStorage.setItem(LAST_PAGE_KEY, window.location.hash);
  } catch {}
}

function forgetPage() {
  try {
    localStorage.removeItem(LAST_PAGE_KEY);
  } catch {}
}

// Reopening the site's plain link has no #page in it, so the page it was last on
// comes from storage. Links with a query (email verification, password reset) open
// their own dialog and are left alone.
function restoreLastPage() {
  if (appSetting("startPage") === "last" && !window.location.hash && !window.location.search) {
    try {
      const saved = localStorage.getItem(LAST_PAGE_KEY);
      if (saved) window.history.replaceState(null, "", saved);
    } catch {}
  }
  rememberPage();
}

function applyViewFromUrl() {
  const view = viewFromUrl();
  applyView(view, usernameFromUrl());
  return view;
}

viewButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const view = button.dataset.view;
    applyView(view);
    const url =
      view === "home"
        ? window.location.pathname + window.location.search
        : `#${view}`;
    if (window.location.hash !== (view === "home" ? "" : url)) {
      window.history.pushState(null, "", url);
    }
    rememberPage();
    loadViewData(view);
  });
});

function dismissTopDialog(top) {
  if (top === dialog) closeEntryDialog();
  else if (top === meetupDialog) closeMeetupDialog();
  else if (top === mapPointDialog) closeMapPointDialog();
  else top.close();
}

function hasUnsavedForm() {
  return (
    (dialog.open && entryFormSnapshot() !== savedEntryForm) ||
    (meetupDialog.open && meetupFormSnapshot() !== savedMeetupForm) ||
    (mapPointDialog.open && mapPointFormSnapshot() !== savedMapPointForm) ||
    [...footprintPhotoDrafts.values()].some(footprintPhotoDraftHasChanges)
  );
}

// There is no earlier page to catch "back" on when the site was just opened.
window.addEventListener("beforeunload", (event) => {
  if (hasUnsavedForm()) event.preventDefault();
});

// Profile links are plain anchors, so the browser's back button just works.
window.addEventListener("popstate", () => {
  // On a phone, back means "close this": put the page back and dismiss the dialog.
  const openDialogs = document.querySelectorAll("dialog[open]");
  if (openDialogs.length > 0) {
    window.history.pushState(null, "", shownPageUrl);
    dismissTopDialog(openDialogs[openDialogs.length - 1]);
    return;
  }
  rememberPage();
  const view = applyViewFromUrl();
  window.scrollTo(0, 0);
  loadViewData(view);
});

document.addEventListener("click", (event) => {
  if (!event.target.closest('a[href^="#user/"]')) return;
  if (profileSocialDialog.open) profileSocialDialog.close();
  closeAccountSearchResults();
});

profileAvatarOpen.addEventListener("click", () => {
  avatarViewerImage.src = profileAvatar.src;
  avatarViewerImage.alt = profileAvatar.alt;
  avatarViewer.showModal();
});

// Like the app it copies, a tap anywhere dismisses the enlarged photo.
avatarViewer.addEventListener("click", () => avatarViewer.close());

profileFollowButton.addEventListener("click", async () => {
  if (!viewedProfile?.id) return;
  profileFollowButton.disabled = true;
  try {
    const wasFollowing = viewedProfile.is_following;
    await toggleFollow(viewedProfile);
    const feedChanged = viewedProfile.is_following !== wasFollowing;
    await Promise.all([
      loadMemberProfile(viewedUsername),
      feedChanged ? loadEntries() : null,
    ]);
  } catch (error) {
    profileFollowButton.disabled = false;
    showToast(`更新追蹤狀態失敗：${error.message}`);
  }
});

document.querySelector("#retry-load").addEventListener("click", loadEntries);
document.querySelector("#profile-retry").addEventListener("click", () => {
  loadViewData("profile");
});

const AVATAR_SIZE = 1024;
const profileAvatarInput = document.querySelector("#profile-edit-avatar-input");
const profileAvatarPreview = document.querySelector("#profile-edit-avatar-preview");
const profileAvatarPreviewInitial = document.querySelector(
  "#profile-edit-avatar-initial",
);
const profileAvatarRemove = document.querySelector("#profile-edit-avatar-remove");
let pendingAvatarBlob = null;
let avatarRemovalPending = false;
let avatarPreviewObjectUrl = null;

function showProfileAvatarPreview(url) {
  profileAvatarPreview.hidden = !url;
  profileAvatarPreviewInitial.hidden = Boolean(url);
  if (url) profileAvatarPreview.src = url;
  else profileAvatarPreview.removeAttribute("src");
  profileAvatarRemove.hidden = !url;
}

function resetProfileAvatarEditor() {
  if (avatarPreviewObjectUrl) URL.revokeObjectURL(avatarPreviewObjectUrl);
  avatarPreviewObjectUrl = null;
  pendingAvatarBlob = null;
  avatarRemovalPending = false;
  profileAvatarInput.value = "";
  profileAvatarPreviewInitial.textContent = avatarInitial(currentProfile?.display_name);
  showProfileAvatarPreview(mediaUrl(currentProfile?.avatar_url));
}

profileAvatarInput.addEventListener("change", async () => {
  const [file] = profileAvatarInput.files;
  if (!file) return;
  profileEditStatus.textContent = "";
  try {
    if (file.size > MAX_IMAGE_SOURCE_BYTES) {
      throw new Error("圖片太大，請選擇 25 MB 以下的檔案。");
    }
    let blob;
    try {
      blob = await cropImageToJpeg(file, AVATAR_SIZE, AVATAR_SIZE, 0.9);
    } catch {
      blob = null;
    }
    if (!blob) throw new Error("無法讀取這張圖片，請改用 JPG、PNG 或 WebP。");
    if (avatarPreviewObjectUrl) URL.revokeObjectURL(avatarPreviewObjectUrl);
    avatarPreviewObjectUrl = URL.createObjectURL(blob);
    pendingAvatarBlob = blob;
    avatarRemovalPending = false;
    showProfileAvatarPreview(avatarPreviewObjectUrl);
  } catch (error) {
    profileEditStatus.textContent = error.message;
  } finally {
    profileAvatarInput.value = "";
  }
});

profileAvatarRemove.addEventListener("click", () => {
  pendingAvatarBlob = null;
  avatarRemovalPending = true;
  showProfileAvatarPreview(null);
});

profileEditOpen.addEventListener("click", () => {
  if (!currentUser) {
    openLoginDialog();
    return;
  }
  profileEditStatus.textContent = "";
  profileEditForm.elements.display_name.value =
    currentProfile?.display_name || "";
  profileEditForm.elements.bio.value = currentProfile?.bio || "";
  profileEditForm.elements.username.value = currentProfile?.username || "";
  resetProfileAvatarEditor();
  profileEditForm.elements.is_private.checked = Boolean(
    currentProfile?.is_private,
  );
  profileEditDialog.showModal();
  profileEditForm.elements.display_name.focus();
});

document
  .querySelector("#profile-edit-dismiss")
  .addEventListener("click", () => profileEditDialog.close());
document
  .querySelector("#profile-edit-cancel")
  .addEventListener("click", () => profileEditDialog.close());

// Drops a chosen photo the dialog no longer needs, whichever way it closed.
profileEditDialog.addEventListener("close", resetProfileAvatarEditor);

profileEditForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  profileEditStatus.textContent = "";
  profileEditSaveButton.disabled = true;
  const values = new FormData(profileEditForm);
  const cardsChanged =
    Boolean(pendingAvatarBlob) ||
    avatarRemovalPending ||
    getFormText(values, "display_name") !== currentProfile?.display_name ||
    getFormText(values, "username").toLowerCase() !== currentProfile?.username;
  try {
    await apiRequest(
      "/user/profile",
      jsonOptions("PATCH", {
        display_name: getFormText(values, "display_name"),
        bio: getFormText(values, "bio"),
        username: getFormText(values, "username"),
        is_private: values.get("is_private") === "on",
      }),
    );
    if (pendingAvatarBlob) {
      await apiRequest("/user/avatar", {
        method: "POST",
        headers: { "Content-Type": pendingAvatarBlob.type },
        body: pendingAvatarBlob,
      });
    } else if (avatarRemovalPending) {
      await apiRequest("/user/avatar", { method: "DELETE" });
    }
    // Cards everywhere show this name, ID and avatar; a bio edit touches none of them.
    await Promise.all(
      cardsChanged ? [loadProfile(), loadEntries(), loadMapPoints()] : [loadProfile()],
    );
    profileEditDialog.close();
  } catch (error) {
    profileEditStatus.textContent = error.message;
  } finally {
    profileEditSaveButton.disabled = false;
  }
});

// The logo fetches the latest content in place, keeping the current tab, filters and scroll.
const BRAND_SPIN_MS = 600;
const brandRefreshButton = document.querySelector("#brand-refresh");
brandRefreshButton.addEventListener("click", async () => {
  if (brandRefreshButton.classList.contains("is-refreshing")) return;
  brandRefreshButton.classList.add("is-refreshing");
  brandRefreshButton.setAttribute("aria-busy", "true");
  const shown = new Promise((resolve) => setTimeout(resolve, BRAND_SPIN_MS));
  await Promise.allSettled([loadSessionData(), shown]);
  brandRefreshButton.classList.remove("is-refreshing");
  brandRefreshButton.removeAttribute("aria-busy");
});
