function renderEntries(entries) {
  loadError.hidden = true;
  entriesContainer.hidden = false;
  entryCount.textContent = `${entries.length} 筆記錄`;
  const cards = entries.length === 0
    ? '<div class="empty-state">還沒有生活記錄，透過 AI 聊天日記留下第一段回憶吧。</div>'
    : entries
        .map(
          (entry) => {
            const entryActions = `
                <div class="entry-actions" aria-label="日記操作">
                  <button class="small-action${entryCanBeEdited(entry.created_at) ? "" : " is-locked"}" type="button" data-edit-entry="${Number(entry.id)}" aria-disabled="${!entryCanBeEdited(entry.created_at)}" title="${entryCanBeEdited(entry.created_at) ? "編輯日記" : "發布已超過 24 小時，無法變更內容"}">編輯</button>
                  <button class="small-action is-destructive" type="button" data-delete-entry="${Number(entry.id)}">刪除</button>
                </div>
              `;
            return `
        <article class="entry-card">
          <span class="mood">${escapeHtml(entry.mood || "生活")}</span>
          <h3>${escapeHtml(entry.title)}</h3>
          <p>${escapeHtml(entry.content)}</p>
          <div class="entry-meta">
            <time>${escapeHtml(formatDate(entry.created_at))}</time>
            <span class="entry-location">${escapeHtml(entry.location || "未記錄地點")}</span>
          </div>
          <div class="entry-card-footer">
            ${ownerLink(entry, "我的日記")}
            ${entryActions}
          </div>
        </article>
            `;
          },
        )
        .join("");
  entriesContainer.innerHTML = cards;
}

function entryCanBeEdited(createdAt) {
  const normalized = String(createdAt || "").replace(" ", "T");
  const timestamp = Date.parse(
    /(Z|[+-]\d{2}:\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`,
  );
  return Number.isFinite(timestamp) && Date.now() - timestamp <= 24 * 60 * 60 * 1000;
}

const timelineFilter = createContentFilter({
  rootId: "timeline-filter",
  label: "篩選足跡",
  items: () => mapPoints,
  regionOf: (point) => mapPointRegion(point),
  who: FOOTPRINT_WHO,
  onChange: () => renderTimelineFootprints(),
});

function footprintReactionsHtml(point) {
  const id = Number(point.id);
  const likes = Number(point.like_count) || 0;
  return `
    <div class="footprint-reactions">
      <button class="footprint-reaction is-like" type="button" data-footprint-reaction="like" data-point-id="${id}" aria-pressed="${Boolean(point.is_liked)}" aria-label="按讚，目前 ${likes} 個讚">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5S3.5 15.4 3.5 9.2A4.7 4.7 0 0 1 12 6.5a4.7 4.7 0 0 1 8.5 2.7c0 6.2-8.5 11.3-8.5 11.3z"/></svg>
        <span data-like-count>${likes}</span>
      </button>
      <button class="footprint-reaction is-save" type="button" data-footprint-reaction="save" data-point-id="${id}" aria-pressed="${Boolean(point.is_saved)}" aria-label="收藏這趟足跡">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4.5-6.5 4.5v-16a1 1 0 0 1 1-1z"/></svg>
        <span>收藏</span>
      </button>
    </div>
  `;
}

function renderTimelineFootprints() {
  timelineFilter.refresh();
  if (mapPoints.length === 0) {
    timelineFootprints.innerHTML =
      '<div class="module-empty">目前還沒有可顯示的足跡，新增一趟旅程或追蹤好友後就會出現在這裡。</div>';
    return;
  }
  const visible = timelineFilter.visible();
  if (visible.length === 0) {
    timelineFootprints.innerHTML = `<div class="module-empty">${timelineFilter.emptyMessage()}</div>`;
    return;
  }
  timelineFootprints.innerHTML = visible
    .map((point) => {
      const stops = Array.isArray(point.points) ? point.points : [];
      const stopSummary = stops
        .slice(0, 3)
        .map((stop) => escapeHtml(stop.name))
        .join(" ・ ");
      const remainingStops = stops.length > 3 ? ` 等 ${stops.length} 個地點` : "";
      return `
        <article class="timeline-footprint-card">
          <div class="timeline-footprint-icon" aria-hidden="true">⌖</div>
          <div class="timeline-footprint-content">
            <div class="timeline-footprint-meta">
              <time datetime="${escapeHtml(point.created_at || "")}">${escapeHtml(formatDate(point.created_at))}</time>
              ${
                point.is_owner
                  ? `<label class="entry-privacy-field">足跡隱私${privacySelectHtml(point.id, point.name, point.privacy)}</label>`
                  : `<span class="mood">${privacyLabel(point.privacy)}</span>`
              }
            </div>
            <h3>${escapeHtml(point.name)}</h3>
            <p>${ownerLink(point, "我的足跡")} · ${stops.length} 個途經點</p>
            <p class="timeline-footprint-stops">${stopSummary || "尚未新增途經點"}${remainingStops}</p>
            ${point.note ? `<p class="timeline-footprint-note">${escapeHtml(point.note)}</p>` : ""}
            ${footprintReactionsHtml(point)}
          </div>
          <button class="small-action" type="button" data-timeline-map-point="${Number(point.id)}">在地圖查看</button>
        </article>
      `;
    })
    .join("");
}

function profileHref(username) {
  return `#user/${encodeURIComponent(username)}`;
}

function avatarInitial(name) {
  return Array.from(name || "")[0] || "✦";
}

function avatarHtml(url, name, extraClass = "") {
  const classes = `social-avatar ${extraClass}`.trim();
  return url
    ? `<img class="${classes}" src="${escapeHtml(mediaUrl(url))}" alt="" loading="lazy" decoding="async" />`
    : `<span class="${classes} social-avatar-fallback">${escapeHtml(avatarInitial(name))}</span>`;
}

function ownerLink(item, fallback) {
  const name = item.owner_name || fallback;
  if (!item.owner_username) {
    return `<span class="entry-owner">${escapeHtml(name)}</span>`;
  }
  return `<a class="entry-owner owner-link" href="${escapeHtml(profileHref(item.owner_username))}">${avatarHtml(item.owner_avatar_url, name, "social-avatar-small")}<span>${escapeHtml(name)}</span></a>`;
}

function privacySelectHtml(id, title, privacy) {
  return `
    <select class="privacy-select" data-privacy-point="${Number(id)}" data-saved="${escapeHtml(privacy)}" aria-label="設定「${escapeHtml(title)}」的隱私層級">
      ${Object.entries(PRIVACY_LABELS)
        .map(
          ([value, label]) =>
            `<option value="${value}" ${privacy === value ? "selected" : ""}>${label}</option>`,
        )
        .join("")}
    </select>
  `;
}

function setFollowRequestCount(count) {
  navRequestsBadge.textContent = String(count);
  navRequestsBadge.hidden = !count;
  profileRequestsCount.textContent = String(count);
  profileRequestsOpen.hidden = !count || Boolean(viewedProfile);
}

async function refreshFollowRequestCount() {
  try {
    const requests = await apiRequest("/user/follow-requests");
    setFollowRequestCount(requests.length);
  } catch (error) {
    console.warn("Follow request count failed", error);
  }
}

function renderProfile(profile) {
  profilePageTitle.textContent = `@${profile.username}`;
  profileDisplayName.textContent = profile.display_name;
  profileBio.textContent = profile.bio || "分享一段關於自己的小故事。";
  profilePostsCount.textContent = Number(profile.posts_count).toLocaleString("zh-TW");
  profileFollowersCount.textContent = Number(
    profile.followers_count,
  ).toLocaleString("zh-TW");
  profileFollowingCount.textContent = Number(
    profile.following_count,
  ).toLocaleString("zh-TW");
  profileAvatarInitial.textContent = avatarInitial(
    profile.display_name || profile.username,
  );
  profileAvatar.alt = `${profile.display_name} 的頭貼`;
  const avatarUrl = profile.avatar_url ? mediaUrl(profile.avatar_url) : null;
  // A refresh of the same photo must not flicker back to the initial.
  if (avatarUrl && !profileAvatar.hidden && profileAvatar.getAttribute("src") === avatarUrl) {
    return;
  }
  profileAvatar.hidden = true;
  profileAvatar.removeAttribute("src");
  profileAvatarOpen.disabled = true;
  if (avatarUrl) {
    profileAvatar.onload = () => {
      profileAvatar.hidden = false;
      profileAvatarInitial.hidden = true;
      profileAvatarOpen.disabled = false;
    };
    profileAvatar.onerror = () => {
      profileAvatar.hidden = true;
      profileAvatarInitial.hidden = false;
      profileAvatar.removeAttribute("src");
    };
    profileAvatar.src = avatarUrl;
  } else {
    profileAvatarInitial.hidden = false;
  }
}
function renderProfilePostCard(post, type, expandedId) {
  const isFootprint = type === "footprint";
  const icon = isFootprint ? "⌖" : "✦";
  const caption = isFootprint
    ? `${Array.isArray(post.points) ? post.points.length : 1} 個途經地點`
    : post.mood || "生活日記";
  const isExpanded = expandedId === post.id;
  const routePoints = (Array.isArray(post.points) ? post.points : [])
    .slice()
    .sort((left, right) => left.order - right.order);
  const details = isFootprint
    ? `
        <p class="profile-post-content">${escapeHtml(post.content || "尚未新增旅程備註。")}</p>
        <ol class="profile-route-list">
          ${routePoints
            .map(
              (point, index) => `
                <li>
                  <span class="profile-route-order">${Number(point.order) || index + 1}</span>
                  <span>
                    <span class="profile-route-name">${escapeHtml(point.name)}</span>
                    ${hasCoordinates(point) ? `<span class="profile-route-coordinates">${Number(point.lat).toFixed(5)}, ${Number(point.lng).toFixed(5)}</span>` : ""}
                  </span>
                </li>
              `,
            )
            .join("")}
        </ol>
        <div class="profile-footprint-actions">
          <a class="small-action" href="${escapeHtml(profileFootprintDirectionsUrl(post, routePoints))}" target="_blank" rel="noopener noreferrer">在 Google 地圖開啟</a>
          <button class="small-action" type="button" data-open-profile-footprint="${Number(post.id)}">在足跡開啟</button>
        </div>
      `
    : `
        <p class="profile-post-content">${escapeHtml(post.content || "這篇日記尚無內容。")}</p>
        ${post.location ? `<p>地點：${escapeHtml(post.location)}</p>` : ""}
        ${post.tags ? `<p>標籤：${escapeHtml(post.tags)}</p>` : ""}
      `;
  const privacyControl = isFootprint && post.is_owner
    ? `<label class="entry-privacy-field">足跡隱私${privacySelectHtml(post.id, post.title, post.privacy)}</label>`
    : "";
  const entryActions =
    !isFootprint && post.is_owner
      ? `
        <div class="entry-actions profile-entry-actions">
          <button class="small-action${entryCanBeEdited(post.created_at) ? "" : " is-locked"}" type="button" data-edit-entry="${Number(post.id)}" aria-disabled="${!entryCanBeEdited(post.created_at)}" title="${entryCanBeEdited(post.created_at) ? "編輯日記" : "發布已超過 24 小時，無法變更內容"}">編輯日記</button>
          <button class="small-action is-destructive" type="button" data-delete-entry="${Number(post.id)}">刪除日記</button>
        </div>
      `
      : "";
  const coverUrl = isFootprint ? mediaUrl(post.cover_url) : null;
  const coverActions =
    isFootprint && post.is_owner
      ? `
        <div class="profile-footprint-cover-actions">
          <label class="small-action profile-cover-upload">
            ${post.cover_url ? "更換背景照片" : "新增背景照片"}
            <input class="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" data-footprint-cover-upload="${Number(post.id)}" />
          </label>
          ${
            post.cover_url
              ? `<button class="small-action is-destructive" type="button" data-remove-footprint-cover="${Number(post.id)}">移除照片</button>`
              : ""
          }
          <span class="privacy-note" data-footprint-cover-status="${Number(post.id)}" role="status">照片會顯示在足跡卡片背景，最大 25 MB。</span>
        </div>
      `
      : "";
  return `
    <article class="profile-post-tile${isExpanded ? " is-expanded" : ""}">
      <button
        class="profile-post-toggle${coverUrl ? " has-cover" : ""}"
        type="button"
        data-profile-post-type="${type}"
        data-profile-post-id="${post.id}"
        data-profile-post-title="${escapeHtml(post.title)}"
        aria-expanded="${isExpanded}"
        aria-controls="profile-post-details-${type}-${post.id}"
        aria-label="${isExpanded ? "收合" : "展開"}${isFootprint ? "足跡" : "日記"}：${escapeHtml(post.title)}"
      >
        ${
          coverUrl
            ? `<span class="profile-post-cover" aria-hidden="true"><img src="${escapeHtml(coverUrl)}" alt="" loading="lazy" decoding="async" /></span>`
            : ""
        }
        <span class="profile-post-tile-top">
          <span class="profile-post-type">${icon} ${isFootprint ? "足跡" : "日記"}</span>
          ${isFootprint ? `<span class="profile-post-privacy" data-privacy-badge="point:${Number(post.id)}">${privacyLabel(post.privacy)}</span>` : '<span class="profile-post-privacy">僅自己</span>'}
        </span>
        <span class="profile-post-art" aria-hidden="true">${icon}</span>
        <span class="profile-post-tile-bottom">
          <span class="profile-post-title-block">
            <strong class="profile-post-tile-title">${escapeHtml(post.title)}</strong>
            <span class="profile-post-date">${escapeHtml(caption)}</span>
          </span>
          <time class="profile-post-date" datetime="${escapeHtml(post.created_at || "")}">${escapeHtml(formatDate(post.created_at))}</time>
        </span>
      </button>
      <div
        class="profile-post-details"
        id="profile-post-details-${type}-${post.id}"
        aria-hidden="${!isExpanded}"${isExpanded ? "" : " inert"}
      >
        <div class="profile-post-details-inner">
          <div class="profile-post-details-content">${details}${coverActions}${privacyControl}${entryActions}</div>
        </div>
      </div>
    </article>
  `;
}

function profileFootprintDirectionsUrl(post, routePoints) {
  if (routePoints.length <= 1) {
    const url = new URL("https://www.google.com/maps/search/");
    url.searchParams.set("api", "1");
    url.searchParams.set(
      "query",
      routePoints.length ? routePointQuery(routePoints[0]) : post.title,
    );
    return url.toString();
  }
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", routePointQuery(routePoints[0]));
  url.searchParams.set(
    "destination",
    routePointQuery(routePoints[routePoints.length - 1]),
  );
  url.searchParams.set("travelmode", "driving");
  if (routePoints.length > 2) {
    url.searchParams.set(
      "waypoints",
      routePoints.slice(1, -1).map(routePointQuery).join("|"),
    );
  }
  return url.toString();
}

function renderProfilePosts(
  posts,
  emptyDiaries = "還沒有日記，前往「AI 聊天日記」記下生活片段吧。",
  emptyFootprints = "還沒有足跡，前往「地圖足跡」新增一趟旅程吧。",
) {
  const diaries = posts.filter((post) => post.type === "entry");
  const footprints = posts.filter((post) => post.type === "footprint");
  profileDiariesCount.textContent = `${diaries.length} 篇`;
  profileFootprintsCount.textContent = `${footprints.length} 趟`;

  profileDiariesGrid.innerHTML = diaries.length
    ? diaries
        .map((post) =>
          renderProfilePostCard(post, "diary", expandedProfileDiaryId),
        )
        .join("")
    : `<div class="profile-empty">${escapeHtml(emptyDiaries)}</div>`;
  profileFootprintsGrid.innerHTML = footprints.length
    ? footprints
        .map((post) =>
          renderProfilePostCard(
            post,
            "footprint",
            expandedProfileFootprintId,
          ),
        )
        .join("")
    : `<div class="profile-empty">${escapeHtml(emptyFootprints)}</div>`;
}

function setProfileOwner(person) {
  const isOwnProfile = person === null;
  viewedProfile = person;
  profileEditOpen.hidden = !isOwnProfile;
  themeToggle.hidden = !isOwnProfile;
  profilePostsTitle.textContent = isOwnProfile ? "我的生活" : "貼文";
  // Diaries belong to their author alone, so other profiles have no diary section.
  profileDiariesGrid.closest(".profile-post-section").hidden = !isOwnProfile;
  document.querySelectorAll("[data-profile-relations]").forEach((button) => {
    button.disabled = !isOwnProfile;
  });
  if (!isOwnProfile) profileRequestsOpen.hidden = true;
  profileFollowButton.hidden = isOwnProfile;
  if (person) {
    profileFollowButton.textContent = followLabel(person);
    profileFollowButton.classList.toggle(
      "is-following",
      person.is_following || person.is_requested,
    );
    profileFollowButton.disabled = false;
  }
}

function clearProfileHeader() {
  profilePageTitle.textContent = "個人檔案";
  profileDisplayName.textContent = "";
  profileBio.textContent = "";
  profileAvatar.hidden = true;
  profileAvatar.removeAttribute("src");
  profileAvatarInitial.textContent = "✦";
  profileAvatarInitial.hidden = false;
  profileAvatarOpen.disabled = true;
  profilePostsCount.textContent = "—";
  profileFollowersCount.textContent = "—";
  profileFollowingCount.textContent = "—";
  profileEditOpen.hidden = true;
  themeToggle.hidden = true;
  profileFollowButton.hidden = true;
}

function beginProfileLoad(owner) {
  const load = beginListLoad(
    profileDiariesGrid,
    owner,
    '<div class="profile-empty">正在載入日記…</div>',
  );
  beginListLoad(
    profileFootprintsGrid,
    owner,
    '<div class="profile-empty">正在載入足跡…</div>',
  );
  profileLoadError.hidden = true;
  if (load.isNewOwner) {
    clearProfileHeader();
    expandedProfileDiaryId = null;
    expandedProfileFootprintId = null;
  }
  return load;
}

function showProfileError(message) {
  forgetListLoad(profileDiariesGrid, profileFootprintsGrid);
  profileDiariesGrid.innerHTML = "";
  profileFootprintsGrid.innerHTML = "";
  profileLoadErrorMessage.textContent = message;
  profileLoadError.hidden = false;
}

async function loadMemberProfile(username) {
  if (username === currentProfile?.username) {
    showOwnProfile();
    return;
  }
  const load = beginProfileLoad(`member:${username}`);
  try {
    const { profile, posts } = await apiRequest(
      `/profiles/${encodeURIComponent(username)}`,
    );
    if (!load.isCurrent()) return;
    if (profile.is_self) {
      showOwnProfile();
      return;
    }
    setProfileOwner(profile);
    profilePosts = posts;
    renderProfile(profile);
    const locked = profile.is_private && !profile.is_following;
    const lockedMessage = profile.is_requested
      ? "已送出追蹤請求，對方同意後就能看見公開貼文。"
      : "這是私人帳號，對方同意你的追蹤請求後才能看見公開貼文。";
    renderProfilePosts(
      posts,
      locked ? lockedMessage : "沒有你可以查看的日記。",
      locked ? lockedMessage : "沒有你可以查看的足跡。",
    );
  } catch (error) {
    if (!load.isCurrent()) return;
    profilePageTitle.textContent = `@${username}`;
    showProfileError(error.message);
  }
}

function showOwnProfile() {
  window.history.replaceState(null, "", "#profile");
  rememberPage();
  applyView("profile");
  loadProfile();
}

async function loadProfile() {
  if (!currentUser) {
    setProfileOwner(null);
    profileDiariesGrid.innerHTML =
      '<div class="profile-empty">請先登入以查看個人日記。</div>';
    profileFootprintsGrid.innerHTML =
      '<div class="profile-empty">請先登入以查看個人足跡。</div>';
    return;
  }
  const load = beginProfileLoad(`self:${currentUser.id}`);
  try {
    await privacySavesFinished();
    const [profile, posts] = await Promise.all([
      apiRequest("/user/profile"),
      apiRequest("/user/posts"),
    ]);
    if (!load.isCurrent()) return;
    if (!Array.isArray(posts)) {
      throw new Error("伺服器回傳的貼文資料格式不正確。");
    }
    setProfileOwner(null);
    currentProfile = profile;
    setFollowRequestCount(profile.follow_requests_count);
    profilePosts = withPrivacyDrafts(posts);
    renderProfile(profile);
    renderProfilePosts(profilePosts);
  } catch (error) {
    if (!load.isCurrent()) return;
    currentProfile = null;
    showProfileError(
      error.status === 401
        ? "登入已失效，請重新登入後查看個人檔案。"
        : error.message || "目前無法載入個人檔案。",
    );
  }
}

// The longest vertical move sets the duration, so long and short cards move at one speed.
const PROFILE_TILE_SPEED_PX_PER_SECOND = 600;
const PROFILE_TILE_MIN_MS = 500;
const PROFILE_TILE_MAX_MS = 1600;
const profileTileAnimations = new WeakMap();

function clearProfileTileAnimation(grid) {
  profileTileAnimations.get(grid)?.forEach((animation) => animation.cancel());
  profileTileAnimations.delete(grid);
  grid.querySelectorAll(".profile-post-tile.is-reflowing").forEach((tile) => {
    tile.classList.remove("is-reflowing", "is-reflow-focus", "is-closing");
    ["--reflow-content-width", "left", "top", "width", "height"].forEach(
      (property) => tile.style.removeProperty(property),
    );
  });
}

// Measures every tile before and after the change, then runs each one between the two.
// Reading the start from the screen lets a click during a run continue from where it is.
function animateProfileTiles(grid, applyChange) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    clearProfileTileAnimation(grid);
    applyChange();
    return;
  }
  const tiles = [...grid.querySelectorAll(".profile-post-tile")];
  const measure = (tile) => {
    const tileBox = tile.getBoundingClientRect();
    const gridBox = grid.getBoundingClientRect();
    return {
      left: tileBox.left - gridBox.left,
      top: tileBox.top - gridBox.top,
      width: tileBox.width,
      height: tileBox.height,
    };
  };
  const detailsOf = (tile) => tile.querySelector(".profile-post-details");
  const startGridHeight = grid.getBoundingClientRect().height;
  const start = new Map(
    tiles.map((tile) => [
      tile,
      {
        box: measure(tile),
        opacity: getComputedStyle(detailsOf(tile)).opacity,
        wasExpanded: tile.classList.contains("is-expanded"),
      },
    ]),
  );
  clearProfileTileAnimation(grid);
  applyChange();

  const endGridHeight = grid.getBoundingClientRect().height;
  const contentWidth = grid.clientWidth - 2;
  const toPixels = ({ left, top, width, height }) => ({
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
  });
  // All measured first: taking a tile out of the flow moves the ones after it.
  const end = new Map(
    tiles.map((tile) => [
      tile,
      { box: measure(tile), opacity: getComputedStyle(detailsOf(tile)).opacity },
    ]),
  );
  const verticalTravel = Math.max(
    Math.abs(endGridHeight - startGridHeight),
    ...tiles.flatMap((tile) => {
      const from = start.get(tile).box;
      const to = end.get(tile).box;
      return [Math.abs(to.top - from.top), Math.abs(to.height - from.height)];
    }),
  );
  const timing = {
    duration: Math.min(
      PROFILE_TILE_MAX_MS,
      Math.max(
        PROFILE_TILE_MIN_MS,
        (verticalTravel / PROFILE_TILE_SPEED_PX_PER_SECOND) * 1000,
      ),
    ),
    easing: "linear",
    fill: "both",
  };
  const animations = [];
  tiles.forEach((tile) => {
    const from = start.get(tile);
    const to = end.get(tile);
    const isExpanded = tile.classList.contains("is-expanded");
    const details = detailsOf(tile);
    tile.classList.add("is-reflowing");
    tile.classList.toggle("is-closing", from.wasExpanded && !isExpanded);
    tile.classList.toggle("is-reflow-focus", from.wasExpanded || isExpanded);
    tile.style.setProperty("--reflow-content-width", `${contentWidth}px`);
    const resizes = from.wasExpanded || isExpanded;
    if (resizes) {
      animations.push(
        tile.animate([toPixels(from.box), toPixels(to.box)], timing),
      );
    } else {
      // Tiles that only move use a transform, which doesn't relayout on every frame.
      Object.assign(tile.style, toPixels(to.box));
      const offsetX = from.box.left - to.box.left;
      const offsetY = from.box.top - to.box.top;
      animations.push(
        tile.animate(
          [
            { transform: `translate(${offsetX}px, ${offsetY}px)` },
            { transform: "translate(0, 0)" },
          ],
          timing,
        ),
      );
    }
    animations.push(
      details.animate(
        [{ opacity: from.opacity }, { opacity: to.opacity }],
        timing,
      ),
    );
  });
  const gridAnimation = grid.animate(
    [{ height: `${startGridHeight}px` }, { height: `${endGridHeight}px` }],
    timing,
  );
  animations.push(gridAnimation);
  profileTileAnimations.set(grid, animations);
  gridAnimation.finished
    .then(() => {
      if (profileTileAnimations.get(grid) === animations) {
        clearProfileTileAnimation(grid);
      }
    })
    .catch(() => {}); // Cancelled: a newer run has taken over.
}

function toggleProfilePost(event, type) {
  const button = event.target.closest("[data-profile-post-type]");
  if (!button || button.dataset.profilePostType !== type) return;
  const postId = Number(button.dataset.profilePostId);
  const expandedId =
    type === "diary"
      ? expandedProfileDiaryId
      : expandedProfileFootprintId;
  if (type === "diary") {
    expandedProfileDiaryId = expandedId === postId ? null : postId;
  } else {
    expandedProfileFootprintId = expandedId === postId ? null : postId;
  }
  if (type === "footprint") flushPrivacyDrafts();
  const nextExpandedId =
    type === "diary"
      ? expandedProfileDiaryId
      : expandedProfileFootprintId;
  const grid =
    type === "diary" ? profileDiariesGrid : profileFootprintsGrid;
  animateProfileTiles(grid, () => {
    grid.querySelectorAll(".profile-post-tile").forEach((card) => {
      const cardButton = card.querySelector("[data-profile-post-id]");
      const isExpanded =
        Number(cardButton.dataset.profilePostId) === nextExpandedId;
      const details = card.querySelector(".profile-post-details");
      card.classList.toggle("is-expanded", isExpanded);
      cardButton.setAttribute("aria-expanded", String(isExpanded));
      cardButton.setAttribute(
        "aria-label",
        `${isExpanded ? "收合" : "展開"}${type === "footprint" ? "足跡" : "日記"}：${cardButton.dataset.profilePostTitle}`,
      );
      details.setAttribute("aria-hidden", String(!isExpanded));
      details.toggleAttribute("inert", !isExpanded);
    });
  });
  button.focus();
}

profileDiariesGrid.addEventListener("click", (event) =>
  toggleProfilePost(event, "diary"),
);
profileFootprintsGrid.addEventListener("click", (event) =>
  toggleProfilePost(event, "footprint"),
);

profileFootprintsGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-open-profile-footprint]");
  if (!button) return;
  selectedMapPointId = Number(button.dataset.openProfileFootprint);
  document.querySelector('.navigation [data-view="map"]').click();
});

const MAX_IMAGE_SOURCE_BYTES = 25 * 1024 * 1024;
const FOOTPRINT_COVER_WIDTH = 1600;
const FOOTPRINT_COVER_HEIGHT = 900;

// Redrawing crops to the target shape, shrinks the upload, and drops metadata such as GPS.
async function cropImageToJpeg(file, width, height, quality) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(
      image.naturalWidth / width,
      image.naturalHeight / height,
    );
    const sourceWidth = width * scale;
    const sourceHeight = height * scale;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(
      image,
      (image.naturalWidth - sourceWidth) / 2,
      (image.naturalHeight - sourceHeight) / 2,
      sourceWidth,
      sourceHeight,
      0,
      0,
      width,
      height,
    );
    return await new Promise((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", quality);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function landscapeFootprintCoverBlob(file) {
  if (file.size > MAX_IMAGE_SOURCE_BYTES) {
    throw new Error("圖片太大，請選擇 25 MB 以下的檔案。");
  }
  let blob;
  try {
    blob = await cropImageToJpeg(
      file,
      FOOTPRINT_COVER_WIDTH,
      FOOTPRINT_COVER_HEIGHT,
      0.88,
    );
  } catch {
    blob = null;
  }
  if (!blob) throw new Error("無法讀取這張圖片，請改用 JPG、PNG 或 WebP。");
  return blob;
}

// Redraws only this card, so the other cards and their photos stay as they are.
function applyFootprintCover(pointId, coverUrl, message) {
  const post = profilePosts.find(
    (item) => item.type === "footprint" && item.id === pointId,
  );
  const tile = profileFootprintsGrid
    .querySelector(`[data-profile-post-id="${pointId}"]`)
    ?.closest(".profile-post-tile");
  if (!post || !tile) return;
  post.cover_url = coverUrl;
  tile.outerHTML = renderProfilePostCard(
    post,
    "footprint",
    expandedProfileFootprintId,
  );
  profileFootprintsGrid.querySelector(
    `[data-footprint-cover-status="${pointId}"]`,
  ).textContent = message;
}

async function uploadFootprintCover(pointId, file) {
  const blob = await landscapeFootprintCoverBlob(file);
  const updatedPoint = await apiRequest(`/map-points/${pointId}/cover`, {
    method: "POST",
    headers: { "Content-Type": blob.type },
    body: blob,
  });
  return updatedPoint.cover_url;
}

profileFootprintsGrid.addEventListener("change", async (event) => {
  const input = event.target.closest("[data-footprint-cover-upload]");
  const [file] = input?.files || [];
  if (!input || !file) return;
  const pointId = Number(input.dataset.footprintCoverUpload);
  const status = profileFootprintsGrid.querySelector(
    `[data-footprint-cover-status="${pointId}"]`,
  );
  input.disabled = true;
  status.textContent = "正在處理照片…";
  try {
    const coverUrl = await uploadFootprintCover(pointId, file);
    applyFootprintCover(pointId, coverUrl, "背景照片已更新。");
  } catch (error) {
    status.textContent = error.message || "照片上傳失敗，請稍後再試。";
    input.disabled = false;
  }
});

profileFootprintsGrid.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-remove-footprint-cover]");
  if (!button) return;
  const pointId = Number(button.dataset.removeFootprintCover);
  const status = profileFootprintsGrid.querySelector(
    `[data-footprint-cover-status="${pointId}"]`,
  );
  button.disabled = true;
  status.textContent = "正在移除照片…";
  try {
    await apiRequest(`/map-points/${pointId}/cover`, { method: "DELETE" });
    applyFootprintCover(pointId, null, "背景照片已移除。");
  } catch (error) {
    status.textContent = error.message || "移除照片失敗，請稍後再試。";
    button.disabled = false;
  }
});

async function loadEntries() {
  entriesContainer.hidden = false;
  loadError.hidden = true;
  const load = beginListLoad(
    entriesContainer,
    sessionOwner(),
    '<div class="empty-state">正在整理你的生活片段…</div>',
  );
  if (load.isNewOwner) entryCount.textContent = "載入中…";

  try {
    const entries = await apiRequest("/entries");
    if (!load.isCurrent()) return;
    if (!Array.isArray(entries)) {
      throw new Error("伺服器回傳的資料格式不正確，請稍後重試。");
    }
    renderEntries(entries);
    setDiaryEntries(entries);
  } catch (error) {
    if (!load.isCurrent()) return;
    forgetListLoad(entriesContainer);
    entriesContainer.hidden = true;
    entryCount.textContent = "載入失敗";
    const errorMessage =
      error.status === 401
        ? "請先登入，登入後即可查看與新增生活記錄。"
        : error.status === 404
          ? "找不到日記 API（404）。請確認後端路由已啟動。"
          : error instanceof TypeError
            ? "目前連不上生活記錄服務，請確認後端已啟動，再重新整理。"
            : error.message || "發生未知錯誤，請重新整理再試一次。";
    loadErrorMessage.textContent = errorMessage;
    loadError.hidden = false;
  }
}
