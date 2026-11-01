function renderEntries(entries) {
  loadError.hidden = true;
  entriesContainer.hidden = false;
  entryCount.textContent = `${entries.length} 筆記錄`;
  const cards = entries.length === 0
    ? '<div class="empty-state">還沒有生活記錄，透過 AI 聊天日記留下第一段回憶吧。</div>'
    : entries
        .map(
          (entry) => {
            const privacyControl = entry.is_owner
              ? `
                <label class="entry-privacy-field">日記隱私
                  <select class="privacy-select" data-entry-privacy="${entry.id}" aria-label="設定「${escapeHtml(entry.title)}」的隱私層級">
                    <option value="private" ${entry.privacy === "private" ? "selected" : ""}>私密</option>
                    <option value="friends" ${entry.privacy === "friends" ? "selected" : ""}>摯友</option>
                    <option value="public" ${entry.privacy === "public" ? "selected" : ""}>公開</option>
                  </select>
                </label>
              `
              : `<span class="mood">${privacyLabel(entry.privacy)}</span>`;
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
            <span class="entry-owner">${escapeHtml(entry.owner_name || "我的日記")}</span>
            ${privacyControl}
          </div>
        </article>
            `;
          },
        )
        .join("");
  entriesContainer.innerHTML = cards;
}

function renderProfile(profile) {
  currentProfile = profile;
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
  profileAvatarInitial.textContent =
    Array.from(profile.display_name || profile.username || "✦")[0] || "✦";
  profileAvatar.hidden = true;
  profileAvatar.removeAttribute("src");
  if (profile.avatar_url) {
    profileAvatar.onload = () => {
      profileAvatar.hidden = false;
      profileAvatarInitial.hidden = true;
    };
    profileAvatar.onerror = () => {
      profileAvatar.hidden = true;
      profileAvatarInitial.hidden = false;
      profileAvatar.removeAttribute("src");
    };
    profileAvatar.src = profile.avatar_url;
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
  const details = isFootprint
    ? `
        <p class="profile-post-content">${escapeHtml(post.content || "尚未新增旅程備註。")}</p>
        <ol class="profile-route-list">
          ${(Array.isArray(post.points) ? post.points : [])
            .slice()
            .sort((left, right) => left.order - right.order)
            .map(
              (point, index) => `
                <li>
                  <span class="profile-route-order">${Number(point.order) || index + 1}</span>
                  <span>
                    <span class="profile-route-name">${escapeHtml(point.name)}</span>
                    <span class="profile-route-coordinates">${Number(point.lat).toFixed(5)}, ${Number(point.lng).toFixed(5)}</span>
                  </span>
                </li>
              `,
            )
            .join("")}
        </ol>
      `
    : `
        <p class="profile-post-content">${escapeHtml(post.content || "這篇日記尚無內容。")}</p>
        ${post.location ? `<p>地點：${escapeHtml(post.location)}</p>` : ""}
        ${post.tags ? `<p>標籤：${escapeHtml(post.tags)}</p>` : ""}
      `;
  return `
    <article class="profile-post-tile${isExpanded ? " is-expanded" : ""}">
      <button
        class="profile-post-toggle"
        type="button"
        data-profile-post-type="${type}"
        data-profile-post-id="${post.id}"
        data-profile-post-title="${escapeHtml(post.title)}"
        aria-expanded="${isExpanded}"
        aria-controls="profile-post-details-${type}-${post.id}"
        aria-label="${isExpanded ? "收合" : "展開"}${isFootprint ? "足跡" : "日記"}：${escapeHtml(post.title)}"
      >
        <span class="profile-post-tile-top">
          <span class="profile-post-type">${icon} ${isFootprint ? "足跡" : "日記"}</span>
          <span class="profile-post-privacy">${privacyLabel(post.privacy)}</span>
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
          <div class="profile-post-details-content">${details}</div>
        </div>
      </div>
    </article>
  `;
}

function renderProfilePosts(posts) {
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
    : '<div class="profile-empty">還沒有日記，前往「AI 聊天日記」記下生活片段吧。</div>';
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
    : '<div class="profile-empty">還沒有足跡，前往「地圖足跡」新增一趟旅程吧。</div>';
}

async function loadProfile() {
  if (!currentUser) {
    profileDiariesGrid.innerHTML =
      '<div class="profile-empty">請先登入以查看個人日記。</div>';
    profileFootprintsGrid.innerHTML =
      '<div class="profile-empty">請先登入以查看個人足跡。</div>';
    return;
  }
  profileLoadError.hidden = true;
  profileDiariesGrid.innerHTML =
    '<div class="profile-empty">正在載入日記…</div>';
  profileFootprintsGrid.innerHTML =
    '<div class="profile-empty">正在載入足跡…</div>';
  try {
    const [profile, posts] = await Promise.all([
      apiRequest("/user/profile"),
      apiRequest("/user/posts"),
    ]);
    if (!Array.isArray(posts)) {
      throw new Error("伺服器回傳的貼文資料格式不正確。");
    }
    profilePosts = posts;
    expandedProfileDiaryId = null;
    expandedProfileFootprintId = null;
    renderProfile(profile);
    renderProfilePosts(posts);
  } catch (error) {
    currentProfile = null;
    profileDiariesGrid.innerHTML = "";
    profileFootprintsGrid.innerHTML = "";
    profileLoadErrorMessage.textContent =
      error.status === 401
        ? "登入已失效，請重新登入後查看個人檔案。"
        : error.message || "目前無法載入個人檔案。";
    profileLoadError.hidden = false;
  }
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
  const nextExpandedId =
    type === "diary"
      ? expandedProfileDiaryId
      : expandedProfileFootprintId;
  const grid =
    type === "diary" ? profileDiariesGrid : profileFootprintsGrid;
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
  button.focus();
}

profileDiariesGrid.addEventListener("click", (event) =>
  toggleProfilePost(event, "diary"),
);
profileFootprintsGrid.addEventListener("click", (event) =>
  toggleProfilePost(event, "footprint"),
);

async function loadEntries() {
  entriesContainer.hidden = false;
  loadError.hidden = true;
  entryCount.textContent = "載入中…";
  entriesContainer.innerHTML =
    '<div class="empty-state">正在整理你的生活片段…</div>';

  try {
    const entries = await apiRequest("/entries");
    if (!Array.isArray(entries)) {
      throw new Error("伺服器回傳的資料格式不正確，請稍後重試。");
    }
    renderEntries(entries);
  } catch (error) {
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
