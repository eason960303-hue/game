const HOME_ENTRY_LIMIT = 3;
const MAX_FOOTPRINT_PHOTOS = 9;
const TOAST_MIN_MS = 3200;
const TOAST_MS_PER_CHARACTER = 120;
// Phones show one column, so fewer footprints at a time keeps home short.
const FOOTPRINT_PAGE_SIZE = window.matchMedia("(max-width: 760px)").matches ? 3 : 6;
let toastTimer = null;
let timelineFootprintsShown = FOOTPRINT_PAGE_SIZE;

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.hidden = false;
  // A popover is the only way to appear above a dialog that is open. Reopening puts it on top.
  if (toast.matches(":popover-open")) toast.hidePopover();
  toast.showPopover();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidePopover();
    toast.hidden = true;
  }, Math.max(TOAST_MIN_MS, message.length * TOAST_MS_PER_CHARACTER));
}

// An empty page says what to do next and offers the button for it (see onboarding.js).
function emptyStateHtml(className, message, actionLabel, action) {
  return `
    <div class="${className} empty-with-action">
      <p>${escapeHtml(message)}</p>
      <button class="primary-button" type="button" data-empty-action="${action}">${escapeHtml(actionLabel)}</button>
    </div>`;
}

// Home is an overview of the newest few. Editing and deleting live under AI 日記.
function renderEntries(entries) {
  loadError.hidden = true;
  entriesContainer.hidden = false;
  entryCount.textContent = `${entries.length} 篇日記`;
  const cards = entries.length === 0
    ? emptyStateHtml("empty-state", "還沒有日記，寫下今天的第一篇吧。", "寫日記", "write-diary")
    : entries
        .slice(0, HOME_ENTRY_LIMIT)
        .map(
          (entry) => `
        <article class="entry-card">
          ${entryPhotoHtml(entry)}
          <div class="entry-meta">
            <span class="mood" data-tone="${moodTone(entry.mood)}">${escapeHtml(entry.mood || "生活")}</span>
            <time datetime="${escapeHtml(entry.created_at || "")}">${escapeHtml(formatDateTime(entry.created_at))}</time>
          </div>
          <h3>${escapeHtml(entry.title)}</h3>
          <p>${escapeHtml(entry.content)}</p>
          ${entry.location ? `<div class="entry-card-footer"><span class="entry-location">${escapeHtml(entry.location)}</span></div>` : ""}
        </article>
            `,
        )
        .join("");
  entriesContainer.innerHTML = cards;
}

// Each mood chip gets a colour from its first feeling, so a page of diaries reads at a glance.
const MOOD_TONES = [
  ["sun", /開心|快樂|興奮|期待|幸福|滿足|好玩|驚喜|happy/i],
  ["coral", /生氣|憤怒|煩|不爽|火大/],
  ["sky", /難過|傷心|孤單|失望|寂寞|沮喪|想念|懷念/],
  ["violet", /累|疲|無奈|困惑|焦慮|擔心|緊張|尷尬|壓力/],
  ["teal", /平靜|放鬆|輕鬆|鬆一口氣|感動|感謝|溫暖|安心|療癒/],
];

function moodTone(mood) {
  const first = String(mood || "").split(/[、,，]/)[0];
  return (MOOD_TONES.find(([, pattern]) => pattern.test(first)) || ["pink"])[0];
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
  // Home's 公開 is for discovering other people; your own are under 我的.
  who: {
    ...FOOTPRINT_WHO,
    public: {
      ...FOOTPRINT_WHO.public,
      matches: (point) => point.privacy === "public" && !point.is_owner,
      empty: "還沒有其他人的公開足跡。",
    },
  },
  onChange() {
    timelineFootprintsShown = FOOTPRINT_PAGE_SIZE;
    renderTimelineFootprints();
  },
});

// The heart and bookmark of footprints and trips.
const LIKE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5S3.5 15.4 3.5 9.2A4.7 4.7 0 0 1 12 6.5a4.7 4.7 0 0 1 8.5 2.7c0 6.2-8.5 11.3-8.5 11.3z"/></svg>`;
const SAVE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4.5-6.5 4.5v-16a1 1 0 0 1 1-1z"/></svg>`;

function footprintReactionsHtml(point) {
  const id = Number(point.id);
  const likes = Number(point.like_count) || 0;
  return `
    <div class="footprint-reactions">
      <button class="footprint-reaction is-like" type="button" data-footprint-reaction="like" data-point-id="${id}" aria-pressed="${Boolean(point.is_liked)}" aria-label="按讚，目前 ${likes} 個讚">
        ${LIKE_ICON}
        <span data-like-count>${likes}</span>
      </button>
      <button class="footprint-reaction is-save" type="button" data-footprint-reaction="save" data-point-id="${id}" aria-pressed="${Boolean(point.is_saved)}" aria-label="收藏這趟足跡">
        ${SAVE_ICON}
        <span>收藏</span>
      </button>
    </div>
  `;
}

function renderTimelineFootprints() {
  timelineFilter.refresh();
  if (!currentUser) {
    timelineFootprints.innerHTML =
      '<div class="module-empty">登入後載入你與好友分享的足跡。</div>';
    return;
  }
  if (mapPoints.length === 0) {
    timelineFootprints.innerHTML = emptyStateHtml(
      "module-empty",
      "還沒有足跡。記下一趟出遊，或追蹤朋友後，就會出現在這裡。",
      "新增足跡",
      "new-footprint",
    );
    return;
  }
  const visible = timelineFilter.visible();
  if (visible.length === 0) {
    timelineFootprints.innerHTML = `<div class="module-empty">${timelineFilter.emptyMessage()}</div>`;
    return;
  }
  const hiddenCount = visible.length - timelineFootprintsShown;
  const showMore = hiddenCount > 0
    ? `<button class="secondary-button timeline-show-more" type="button" data-timeline-show-more>再顯示 ${Math.min(hiddenCount, FOOTPRINT_PAGE_SIZE)} 趟（還有 ${hiddenCount} 趟）</button>`
    : "";
  timelineFootprints.innerHTML = visible
    .slice(0, timelineFootprintsShown)
    .map((point) => {
      const stops = Array.isArray(point.points) ? point.points : [];
      const stopSummary = stops
        .slice(0, 3)
        .map((stop) => escapeHtml(stop.name))
        .join(" ・ ");
      const remainingStops = stops.length > 3 ? ` 等 ${stops.length} 個地點` : "";
      return `
        <article class="timeline-footprint-card">
          <div class="timeline-footprint-content">
            <div class="timeline-footprint-meta">
              <time datetime="${escapeHtml(point.created_at || "")}">${escapeHtml(formatDate(point.created_at))}</time>
              ${
                point.is_owner
                  ? privacySelectHtml(point.id, point.name, point.privacy)
                  : privacyChipHtml(point.privacy)
              }
            </div>
            <h3>${escapeHtml(point.name)}</h3>
            <p class="timeline-footprint-owner">${ownerLink(point, "我的足跡")} · ${stops.length} 站</p>
            <p class="timeline-footprint-stops">${stopSummary || "尚未新增一站"}${remainingStops}</p>
            ${point.note ? `<p class="timeline-footprint-note">${escapeHtml(point.note)}</p>` : ""}
          </div>
          <div class="timeline-footprint-actions">
            ${footprintReactionsHtml(point)}
            <button class="small-action" type="button" data-timeline-map-point="${Number(point.id)}">在地圖查看</button>
          </div>
        </article>
      `;
    })
    .join("") + showMore;
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

// The home composer shows who is writing (串文 only, see css/thread.css).
const heroAvatar = document.querySelector("#hero-avatar");

function setHeroAvatar(person) {
  heroAvatar.innerHTML = avatarHtml(person?.avatar_url, person?.display_name || person?.username);
}

function ownerLink(item, fallback) {
  const name = item.owner_name || fallback;
  if (!item.owner_username) {
    return `<span class="entry-owner">${escapeHtml(name)}</span>`;
  }
  return `<a class="entry-owner owner-link" href="${escapeHtml(profileHref(item.owner_username))}">${avatarHtml(item.owner_avatar_url, name, "social-avatar-small")}<span>${escapeHtml(name)}</span></a>`;
}

// A footprint's chip is marked so a privacy change can relabel every copy of it in place.
function privacyChipHtml(privacy, pointId) {
  const badge = pointId === undefined ? "" : ` data-privacy-badge="point:${Number(pointId)}"`;
  return `<span class="mood is-${escapeHtml(privacy)}"${badge}>${privacyLabel(privacy)}</span>`;
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

// The request badge and the composer's avatar, from the account's profile in one request.
// Opening your own profile loads the same profile and sets both itself.
async function refreshOwnProfileSummary() {
  try {
    const profile = await apiRequest("/user/profile");
    setFollowRequestCount(profile.follow_requests_count);
    setHeroAvatar(profile);
  } catch (error) {
    console.warn("Profile summary failed", error);
  }
}

function renderProfile(profile) {
  profilePageTitle.textContent = `@${profile.username}`;
  profileDisplayName.textContent = profile.display_name;
  profileBio.textContent = profile.bio || "";
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
// A footprint with a draft here is being edited. Its changes wait until the owner saves them.
const footprintPhotoDrafts = new Map();

function footprintPhotoDraft(pointId) {
  if (!footprintPhotoDrafts.has(pointId)) {
    footprintPhotoDrafts.set(pointId, {
      added: [],
      removedIds: new Set(),
      busy: false,
    });
  }
  return footprintPhotoDrafts.get(pointId);
}

function discardFootprintPhotoDraft(pointId) {
  footprintPhotoDrafts
    .get(pointId)
    ?.added.forEach((photo) => URL.revokeObjectURL(photo.url));
  footprintPhotoDrafts.delete(pointId);
}

function discardFootprintPhotoDrafts() {
  [...footprintPhotoDrafts.keys()].forEach(discardFootprintPhotoDraft);
}

function footprintPhotoDraftHasChanges(draft) {
  return Boolean(draft && (draft.added.length || draft.removedIds.size));
}

// A footprint's photos are edited as a draft, on the profile and in the footprint form alike:
// saved photos marked for removal, and new ones prepared but not yet uploaded.
function photosWithDraft(saved, draft) {
  return [...saved.filter((photo) => !draft.removedIds.has(photo.id)), ...draft.added];
}

let nextPhotoDraftId = 1;

// Prepares picked photos, as many as there is room for, and returns what to tell the owner.
async function addPhotosToDraft(draft, files, room) {
  const chosen = files.slice(0, room);
  const notes = [];
  for (const file of chosen) {
    try {
      const blob = await entryPhotoBlob(file);
      draft.added.push({ draftId: nextPhotoDraftId++, blob, url: URL.createObjectURL(blob) });
    } catch (error) {
      notes.push(`${file.name}：${error.message}`);
    }
  }
  const skipped = files.length - chosen.length;
  if (skipped) notes.push(`超過 ${MAX_FOOTPRINT_PHOTOS} 張上限，略過 ${skipped} 張。`);
  return notes.join(" ");
}

async function deleteFootprintPhoto(pointId, photoId) {
  try {
    await apiRequest(`/map-points/${pointId}/photos/${photoId}`, { method: "DELETE" });
  } catch (error) {
    // Already gone, for example deleted in another window: the goal is met.
    if (error.status !== 404) throw error;
  }
}

// What the grid and the enlarged view show: saved photos with the unsaved changes applied.
function shownFootprintPhotos(post) {
  const saved = post.photos || [];
  const draft = post.is_owner ? footprintPhotoDrafts.get(post.id) : null;
  return draft ? photosWithDraft(saved, draft) : saved;
}

// What the enlarged view pages through: the cover first, as on 足跡 and 行程, then the photos.
function footprintViewerPhotos(post) {
  const photos = shownFootprintPhotos(post);
  return post.cover_url ? [{ url: post.cover_url }, ...photos] : photos;
}

function footprintPhotosHtml(post) {
  const photos = shownFootprintPhotos(post);
  const firstPhotoIndex = post.cover_url ? 1 : 0;
  const draft = footprintPhotoDrafts.get(post.id);
  const editing = post.is_owner && Boolean(draft);
  if (!photos.length && !post.is_owner) return "";
  const pointId = Number(post.id);
  const busy = editing && draft.busy;
  const tiles = photos.map(
    (photo, index) => `
      <div class="footprint-photo${photo.draftId ? " is-unsaved" : ""}">
        <button type="button" data-view-footprint-photo="${pointId}" data-photo-index="${firstPhotoIndex + index}" aria-label="放大第 ${index + 1} 張照片">
          <img src="${escapeHtml(mediaUrl(photo.url))}" alt="${escapeHtml(post.title)}的照片" loading="lazy" decoding="async" />
        </button>
        ${
          editing
            ? `<button class="footprint-photo-delete" type="button" data-delete-footprint-photo="${pointId}" ${photo.draftId ? `data-draft-id="${Number(photo.draftId)}"` : `data-photo-id="${Number(photo.id)}"`} aria-label="移除第 ${index + 1} 張照片"${busy ? " disabled" : ""}>×</button>`
            : ""
        }
        ${photo.draftId ? '<span class="footprint-photo-tag">未儲存</span>' : ""}
      </div>
    `,
  );
  const canAdd = editing && photos.length < MAX_FOOTPRINT_PHOTOS;
  const note = !editing
    ? photos.length
      ? "誰能看照片跟著足跡隱私設定。"
      : "還沒有旅程照片。"
    : footprintPhotoDraftHasChanges(draft)
      ? "有未儲存的變更，按「儲存照片」後才會生效。"
      : `最多 ${MAX_FOOTPRINT_PHOTOS} 張，可以新增照片或按 × 移除。`;
  return `
    <section class="footprint-photos" data-footprint-photos="${pointId}" aria-label="旅程照片">
      <div class="footprint-photo-grid">
        ${tiles.join("")}
        ${
          canAdd
            ? `<label class="footprint-photo-add">
                <span aria-hidden="true">＋</span>
                <span>新增照片</span>
                <input class="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple data-footprint-photo-upload="${pointId}"${busy ? " disabled" : ""} />
              </label>`
            : ""
        }
      </div>
      ${
        post.is_owner
          ? `<p class="privacy-note" data-footprint-photo-status="${pointId}" role="status">${note}</p>
            <div class="footprint-photo-actions">
              ${
                editing
                  ? `<button class="primary-button" type="button" data-save-footprint-photos="${pointId}"${busy ? " disabled" : ""}>儲存照片</button>
                    <button class="small-action" type="button" data-cancel-footprint-photos="${pointId}"${busy ? " disabled" : ""}>取消</button>`
                  : `<button class="small-action" type="button" data-edit-footprint-photos="${pointId}">編輯照片</button>`
              }
            </div>`
          : ""
      }
    </section>
  `;
}

function renderProfilePostCard(post, type, expandedId) {
  const isFootprint = type === "footprint";
  const icon = isFootprint ? "⌖" : "✦";
  const caption = isFootprint
    ? `${Array.isArray(post.points) ? post.points.length : 1} 站`
    : post.mood || "生活日記";
  const isExpanded = expandedId === post.id;
  const routePoints = (Array.isArray(post.points) ? post.points : [])
    .slice()
    .sort((left, right) => left.order - right.order);
  const details = isFootprint
    ? `
        ${
          post.content || post.is_owner
            ? `<p class="profile-post-content">${escapeHtml(post.content || "尚未新增旅程備註。")}</p>`
            : ""
        }
        <ol class="profile-route-list">
          ${routePoints
            .map(
              (point, index) => `
                <li>
                  <span class="profile-route-order">${Number(point.order) || index + 1}</span>
                  <span>
                    <span class="profile-route-name">${escapeHtml(point.name)}</span>
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
        ${entryPhotoHtml(post)}
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
            ${post.cover_url ? "更換封面" : "新增封面"}
            <input class="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" data-footprint-cover-upload="${Number(post.id)}" />
          </label>
          ${
            post.cover_url
              ? `<button class="small-action is-destructive" type="button" data-remove-footprint-cover="${Number(post.id)}">移除封面</button>`
              : ""
          }
          <span class="privacy-note" data-footprint-cover-status="${Number(post.id)}" role="status">封面會顯示在足跡卡片背景，最大 25 MB。</span>
        </div>
      `
      : "";
  const photos = isFootprint ? footprintPhotosHtml(post) : "";
  return `
    <article class="profile-post-tile${isFootprint ? "" : " is-diary"}${isExpanded ? " is-expanded" : ""}">
      <div class="profile-post-head">
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
          ${isFootprint ? `<span class="profile-post-privacy" data-privacy-badge="point:${Number(post.id)}">${privacyLabel(post.privacy)}</span>` : ""}
        </span>
        <span class="profile-post-art" aria-hidden="true">${icon}</span>
        <span class="profile-post-tile-bottom">
          <span class="profile-post-title-block">
            <strong class="profile-post-tile-title">${escapeHtml(post.title)}</strong>
            <span class="profile-post-date">${escapeHtml(caption)}</span>
          </span>
          <time class="profile-post-date" datetime="${escapeHtml(post.created_at || "")}">${escapeHtml(formatDate(post.created_at))}</time>
          <span class="profile-post-brief" aria-hidden="true">${escapeHtml(profileShortDate(post.created_at))} · ${escapeHtml(caption)}</span>
        </span>
      </button>
      ${
        coverUrl
          ? `<button class="profile-cover-zoom" type="button" data-view-footprint-photo="${Number(post.id)}" data-photo-index="0" aria-label="放大「${escapeHtml(post.title)}」的封面">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>
              放大封面
            </button>`
          : ""
      }
      </div>
      <div
        class="profile-post-details"
        id="profile-post-details-${type}-${post.id}"
        aria-hidden="${!isExpanded}"${isExpanded ? "" : " inert"}
      >
        <div class="profile-post-details-inner">
          <div class="profile-post-details-content">
            ${
              photos
                ? `<div class="footprint-post"><div class="footprint-post-main">${details}${coverActions}${privacyControl}</div>${photos}</div>`
                : `${details}${coverActions}${privacyControl}`
            }${entryActions}
          </div>
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
  emptyDiaries = "還沒有日記，寫下今天的第一篇吧。",
  emptyFootprints = "還沒有足跡，記下你的第一趟出遊吧。",
) {
  const diaries = posts.filter((post) => post.type === "entry");
  const footprints = posts.filter((post) => post.type === "footprint");
  profileDiariesCount.textContent = `${diaries.length} 篇`;
  profileFootprintsCount.textContent = `${footprints.length} 趟`;

  profileDiariesGrid.innerHTML = diaries.length
    ? profilePostListHtml(diaries, "diary", expandedProfileDiaryId)
    : viewedProfile
      ? `<div class="profile-empty">${escapeHtml(emptyDiaries)}</div>`
      : emptyStateHtml("profile-empty", emptyDiaries, "寫日記", "write-diary");
  warmPhotos(profileDiariesGrid);
  profileFootprintsGrid.innerHTML = footprints.length
    ? profilePostListHtml(footprints, "footprint", expandedProfileFootprintId)
    : viewedProfile
      ? `<div class="profile-empty">${escapeHtml(emptyFootprints)}</div>`
      : emptyStateHtml("profile-empty", emptyFootprints, "新增足跡", "new-footprint");
}

function setProfileOwner(person) {
  const isOwnProfile = person === null;
  viewedProfile = person;
  profileEditOpen.hidden = !isOwnProfile;
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
    clearProfileHeader();
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
    setHeroAvatar(profile);
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
// Posts are grouped by month, so closing one month's tile and opening another's moves two grids.
function animateProfileTiles(gridList, applyChange) {
  const grids = [...new Set(gridList.filter(Boolean))];
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    grids.forEach(clearProfileTileAnimation);
    applyChange();
    return;
  }
  const detailsOf = (tile) => tile.querySelector(".profile-post-details");
  const measure = (tile, grid) => {
    const tileBox = tile.getBoundingClientRect();
    const gridBox = grid.getBoundingClientRect();
    return {
      left: tileBox.left - gridBox.left,
      top: tileBox.top - gridBox.top,
      width: tileBox.width,
      height: tileBox.height,
    };
  };
  const runs = grids.map((grid) => {
    const tiles = [...grid.querySelectorAll(".profile-post-tile")];
    return {
      grid,
      tiles,
      startGridHeight: grid.getBoundingClientRect().height,
      start: new Map(
        tiles.map((tile) => [
          tile,
          {
            box: measure(tile, grid),
            opacity: getComputedStyle(detailsOf(tile)).opacity,
            wasExpanded: tile.classList.contains("is-expanded"),
          },
        ]),
      ),
    };
  });
  grids.forEach(clearProfileTileAnimation);
  applyChange();

  // All measured first: taking a tile out of the flow moves the ones after it.
  runs.forEach((run) => {
    run.endGridHeight = run.grid.getBoundingClientRect().height;
    run.contentWidth = run.grid.clientWidth - 2;
    run.end = new Map(
      run.tiles.map((tile) => [
        tile,
        {
          box: measure(tile, run.grid),
          opacity: getComputedStyle(detailsOf(tile)).opacity,
        },
      ]),
    );
  });
  const toPixels = ({ left, top, width, height }) => ({
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
  });
  const verticalTravel = Math.max(
    0,
    ...runs.flatMap((run) => [
      Math.abs(run.endGridHeight - run.startGridHeight),
      ...run.tiles.flatMap((tile) => {
        const from = run.start.get(tile).box;
        const to = run.end.get(tile).box;
        return [Math.abs(to.top - from.top), Math.abs(to.height - from.height)];
      }),
    ]),
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
  runs.forEach(({ grid, tiles, start, end, startGridHeight, endGridHeight, contentWidth }) => {
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
  });
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
  const list =
    type === "diary" ? profileDiariesGrid : profileFootprintsGrid;
  const gridOf = (id) =>
    list
      .querySelector(`[data-profile-post-id="${id}"]`)
      ?.closest(".profile-post-grid");
  animateProfileTiles([gridOf(postId), gridOf(expandedId)], () => {
    list.querySelectorAll(".profile-post-tile").forEach((card) => {
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
  // A tap already focuses the button; scrolling to it here would jerk the page mid-animation.
  button.focus({ preventScroll: true });
}

// Opening waits for the post's photos, so the tile grows to its full height in one go.
async function openProfilePost(event, type) {
  const button = event.target.closest("[data-profile-post-type]");
  if (!button || button.dataset.profilePostType !== type) return;
  const card = button.closest(".profile-post-tile");
  const details = card?.querySelector(".profile-post-details");
  if (details && !card.classList.contains("is-expanded") && details.querySelector("img")) {
    if (card.dataset.preparing) return;
    card.dataset.preparing = "true";
    await photosReady(details);
    delete card.dataset.preparing;
    if (!card.isConnected) return;
    easeInLatePhotos(card, () => card.classList.contains("is-expanded"));
  }
  toggleProfilePost(event, type);
}

profileDiariesGrid.addEventListener("click", (event) => openProfilePost(event, "diary"));
profileFootprintsGrid.addEventListener("click", (event) =>
  openProfilePost(event, "footprint"),
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
// The size is { width, height }, or a function of the picture's own width and height.
async function cropImageToJpeg(file, size, quality) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const { width, height } =
      typeof size === "function" ? size(image.naturalWidth, image.naturalHeight) : size;
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

const ENTRY_PHOTO_MAX_EDGE = 1600;

// Every picture upload: too large, or one the browser can't read, gets the same message.
async function imageUploadBlob(file, size, quality) {
  if (file.size > MAX_IMAGE_SOURCE_BYTES) {
    throw new Error("圖片太大，請選擇 25 MB 以下的檔案。");
  }
  const blob = await cropImageToJpeg(file, size, quality).catch(() => null);
  if (!blob) throw new Error("無法讀取這張圖片，請改用 JPG、PNG 或 WebP。");
  return blob;
}

// Keeps the photo's shape; phones shoot far more pixels, and bytes, than a diary shows.
function entryPhotoBlob(file) {
  return imageUploadBlob(
    file,
    (width, height) => {
      const scale = Math.min(1, ENTRY_PHOTO_MAX_EDGE / Math.max(width, height));
      return { width: Math.round(width * scale), height: Math.round(height * scale) };
    },
    0.85,
  );
}

// A photo inside a closed section is lazy, so it hasn't loaded. Opening the section then
// measures it as nothing, and the photo pops in once the animation has ended.
const PHOTO_WAIT_MS = 350;

// Fetches the photos of a freshly drawn list while the browser is idle, before anyone opens one.
function warmPhotos(root) {
  const warm = () =>
    root.querySelectorAll('img[loading="lazy"]').forEach((img) => {
      img.loading = "eager";
    });
  if ("requestIdleCallback" in window) requestIdleCallback(warm, { timeout: 2000 });
  else setTimeout(warm, 300);
}

// Resolves once the section's photos are loaded and decoded, or after a short wait at most,
// so it can be measured with them in place.
function photosReady(root) {
  const images = Array.from(root.querySelectorAll("img"));
  if (images.length === 0) return Promise.resolve();
  images.forEach((img) => {
    img.loading = "eager";
  });
  return Promise.race([
    Promise.all(images.map((img) => img.decode().catch(() => {}))),
    new Promise((resolve) => setTimeout(resolve, PHOTO_WAIT_MS)),
  ]);
}

const LATE_PHOTO_MS = 260;

// A photo that still arrives after its section has opened (a slow connection) would shove
// everything down at once. It stays out of the layout until it has loaded, so the opening
// measures the section without it; then the section grows from wherever it is to fit it,
// and the photo fades in.
function easeInLatePhotos(container, isOpen) {
  container.querySelectorAll("img").forEach((img) => {
    if (img.complete && img.naturalWidth > 0) return;
    img.style.display = "none";
    const arrive = () => {
      const from = container.getBoundingClientRect().height;
      img.style.removeProperty("display");
      if (!container.isConnected || !isOpen()) return;
      // scrollHeight is the full content even while an opening animation holds the height.
      const to = container.scrollHeight + container.offsetHeight - container.clientHeight;
      if (to - from < 1) return;
      const timing = { duration: LATE_PHOTO_MS, easing: "cubic-bezier(0.2, 0.75, 0.3, 1)" };
      container.animate(
        { height: [`${from}px`, `${to}px`], overflow: ["hidden", "hidden"] },
        timing,
      );
      img.animate({ opacity: [0, 1] }, timing);
    };
    img.addEventListener("load", arrive, { once: true });
    img.addEventListener("error", () => img.style.removeProperty("display"), { once: true });
  });
}

function entryPhotoHtml(entry) {
  return entry.photo_url
    ? `<img class="entry-photo" src="${escapeHtml(mediaUrl(entry.photo_url))}" alt="${escapeHtml(entry.title)}的照片，點一下放大" role="button" tabindex="0" data-view-entry-photo="${escapeHtml(entry.photo_url)}" data-photo-title="${escapeHtml(entry.title)}" loading="lazy" decoding="async" />`
    : "";
}

function landscapeFootprintCoverBlob(file) {
  return imageUploadBlob(
    file,
    { width: FOOTPRINT_COVER_WIDTH, height: FOOTPRINT_COVER_HEIGHT },
    0.88,
  );
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
  const updatedPoint = await apiRequest(`/map-points/${pointId}/cover`, blobOptions(blob));
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
    applyFootprintCover(pointId, coverUrl, "封面已更新。");
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
    applyFootprintCover(pointId, null, "封面已移除。");
  } catch (error) {
    status.textContent = error.message || "移除照片失敗，請稍後再試。";
    button.disabled = false;
  }
});

function profileFootprintPost(pointId) {
  return profilePosts.find(
    (item) => item.type === "footprint" && item.id === pointId,
  );
}

// Redraws only the photos, so an unsaved privacy choice on the same card stays as it is.
function showFootprintPhotos(post, message) {
  const section = profileFootprintsGrid.querySelector(
    `[data-footprint-photos="${post.id}"]`,
  );
  if (!section) return;
  section.outerHTML = footprintPhotosHtml(post);
  if (message) {
    profileFootprintsGrid.querySelector(
      `[data-footprint-photo-status="${post.id}"]`,
    ).textContent = message;
  }
}

// Only prepares the photos. Nothing reaches the server until "儲存照片".
async function addFootprintPhotosToDraft(post, files) {
  const draft = footprintPhotoDraft(post.id);
  const room = MAX_FOOTPRINT_PHOTOS - shownFootprintPhotos(post).length;
  draft.busy = true;
  showFootprintPhotos(post, "正在處理照片…");
  const notes = await addPhotosToDraft(draft, files, room);
  draft.busy = false;
  showFootprintPhotos(post, notes);
}

// Deletes come first, which frees room for the new photos. What fails stays in the draft to retry.
async function saveFootprintPhotos(post) {
  const draft = footprintPhotoDrafts.get(post.id);
  if (!draft || draft.busy) return;
  draft.busy = true;
  showFootprintPhotos(post, "正在儲存照片…");
  try {
    for (const photoId of [...draft.removedIds]) {
      await deleteFootprintPhoto(post.id, photoId);
      post.photos = post.photos.filter((photo) => photo.id !== photoId);
      draft.removedIds.delete(photoId);
    }
    for (const pending of [...draft.added]) {
      const photo = await apiRequest(
        `/map-points/${post.id}/photos`,
        blobOptions(pending.blob),
      );
      post.photos = [...(post.photos || []), photo];
      draft.added.shift();
      URL.revokeObjectURL(pending.url);
    }
    footprintPhotoDrafts.delete(post.id);
    showFootprintPhotos(post, "照片已儲存。");
  } catch (error) {
    draft.busy = false;
    showFootprintPhotos(
      post,
      `${error.message || "儲存失敗"}。還沒完成的變更都保留著，可以再按一次儲存。`,
    );
  }
}

profileFootprintsGrid.addEventListener("change", (event) => {
  const input = event.target.closest("[data-footprint-photo-upload]");
  const post = input && profileFootprintPost(Number(input.dataset.footprintPhotoUpload));
  if (!post || !input.files.length) return;
  addFootprintPhotosToDraft(post, [...input.files]);
});

profileFootprintsGrid.addEventListener("click", (event) => {
  const edit = event.target.closest("[data-edit-footprint-photos]");
  if (edit) {
    const post = profileFootprintPost(Number(edit.dataset.editFootprintPhotos));
    if (!post) return;
    footprintPhotoDraft(post.id);
    showFootprintPhotos(post);
    return;
  }
  const remove = event.target.closest("[data-delete-footprint-photo]");
  if (remove) {
    const post = profileFootprintPost(Number(remove.dataset.deleteFootprintPhoto));
    if (!post) return;
    const draft = footprintPhotoDraft(post.id);
    if (remove.dataset.draftId) {
      const draftId = Number(remove.dataset.draftId);
      const pending = draft.added.find((photo) => photo.draftId === draftId);
      if (pending) URL.revokeObjectURL(pending.url);
      draft.added = draft.added.filter((photo) => photo.draftId !== draftId);
    } else {
      draft.removedIds.add(Number(remove.dataset.photoId));
    }
    showFootprintPhotos(post);
    return;
  }
  const save = event.target.closest("[data-save-footprint-photos]");
  if (save) {
    const post = profileFootprintPost(Number(save.dataset.saveFootprintPhotos));
    if (post) saveFootprintPhotos(post);
    return;
  }
  const cancel = event.target.closest("[data-cancel-footprint-photos]");
  if (cancel) {
    const post = profileFootprintPost(Number(cancel.dataset.cancelFootprintPhotos));
    if (!post) return;
    discardFootprintPhotoDraft(post.id);
    showFootprintPhotos(post, "已取消變更。");
  }
});

const photoViewer = document.querySelector("#photo-viewer");
const photoViewerImage = document.querySelector("#photo-viewer-image");
const photoViewerCount = document.querySelector("#photo-viewer-count");
const photoViewerPrev = document.querySelector("#photo-viewer-prev");
const photoViewerNext = document.querySelector("#photo-viewer-next");
let photoViewerPost = null;
let photoViewerPhotos = [];
let photoViewerIndex = 0;

function showViewerPhoto(index) {
  const { title } = photoViewerPost;
  const photos = photoViewerPhotos;
  photoViewerIndex = (index + photos.length) % photos.length;
  // A trip's photos come from several footprints, so each names the one it is from.
  const { caption } = photos[photoViewerIndex];
  photoViewerImage.src = mediaUrl(photos[photoViewerIndex].url);
  photoViewerImage.alt = `${caption || title}的照片`;
  const count = photos.length > 1 ? `${photoViewerIndex + 1} / ${photos.length}` : "";
  photoViewerCount.textContent = [caption, count].filter(Boolean).join("　");
  photoViewerCount.hidden = !photoViewerCount.textContent;
  photoViewerPrev.hidden = photoViewerNext.hidden = photos.length < 2;
}

profileFootprintsGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-view-footprint-photo]");
  if (!button) return;
  photoViewerPost = profileFootprintPost(Number(button.dataset.viewFootprintPhoto));
  if (!photoViewerPost) return;
  photoViewerPhotos = footprintViewerPhotos(photoViewerPost);
  showViewerPhoto(Number(button.dataset.photoIndex));
  photoViewer.showModal();
});

tripList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-view-trip-photo]");
  if (!button) return;
  const trip = trips.find((item) => item.id === Number(button.dataset.viewTripPhoto));
  if (!trip) return;
  photoViewerPost = { title: trip.title };
  photoViewerPhotos = tripPhotos(trip);
  showViewerPhoto(Number(button.dataset.photoIndex));
  photoViewer.showModal();
});

mapPointsContainer.addEventListener("click", (event) => {
  const button = event.target.closest("[data-view-map-photo]");
  if (!button) return;
  const point = mapPoints.find((item) => item.id === Number(button.dataset.viewMapPhoto));
  if (!point) return;
  photoViewerPost = { title: point.name };
  photoViewerPhotos = mapPointPhotos(point);
  showViewerPhoto(Number(button.dataset.photoIndex));
  photoViewer.showModal();
});

function openEntryPhoto(photo) {
  photoViewerPost = { title: photo.dataset.photoTitle };
  photoViewerPhotos = [{ url: photo.dataset.viewEntryPhoto }];
  showViewerPhoto(0);
  photoViewer.showModal();
}

// Capturing, so opening a photo doesn't also fold up the diary card it sits in.
document.addEventListener(
  "click",
  (event) => {
    const photo = event.target.closest?.("[data-view-entry-photo]");
    if (!photo) return;
    event.stopPropagation();
    openEntryPhoto(photo);
  },
  true,
);
document.addEventListener("keydown", (event) => {
  const photo = event.target.closest?.("[data-view-entry-photo]");
  if (!photo || (event.key !== "Enter" && event.key !== " ")) return;
  event.preventDefault();
  openEntryPhoto(photo);
});

photoViewerPrev.addEventListener("click", () => showViewerPhoto(photoViewerIndex - 1));
photoViewerNext.addEventListener("click", () => showViewerPhoto(photoViewerIndex + 1));
document
  .querySelector("#photo-viewer-close")
  .addEventListener("click", () => photoViewer.close());
// A click on the dimmed area around the photo closes it.
photoViewer.addEventListener("click", (event) => {
  if (event.target === photoViewer) photoViewer.close();
});
photoViewer.addEventListener("keydown", (event) => {
  if (photoViewerPrev.hidden) return;
  if (event.key === "ArrowLeft") showViewerPhoto(photoViewerIndex - 1);
  if (event.key === "ArrowRight") showViewerPhoto(photoViewerIndex + 1);
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
          ? "目前無法載入日記，請稍後再試。"
          : error instanceof TypeError
            ? "目前連不上伺服器，請確認網路後再試一次。"
            : error.message || "發生未知錯誤，請重新整理再試一次。";
    loadErrorMessage.textContent = errorMessage;
    loadError.hidden = false;
  }
}
