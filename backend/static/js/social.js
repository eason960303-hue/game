async function refreshServerStatus() {
  serverStatusLabel.textContent = "正在檢查伺服器…";
  serverStatusDetail.textContent = "正在檢查後端服務連線。";
  serverStatusDot.classList.remove("is-offline");
  try {
    const health = await apiRequest("/health");
    if (health.status !== "ok") {
      throw new Error("後端服務目前尚未就緒。");
    }
    serverStatusLabel.textContent = "已連線至 Mac mini 伺服器";
    serverStatusDetail.textContent = "連線正常，生活記錄服務已就緒。";
  } catch (error) {
    serverStatusDot.classList.add("is-offline");
    serverStatusLabel.textContent = "伺服器未連線";
    serverStatusDetail.textContent =
      error instanceof TypeError
        ? "目前連不上後端，請確認 FastAPI 伺服器已啟動。"
        : error.message;
  }
}

function appendAiChatMessage(message, type = "assistant") {
  const element = document.createElement("div");
  element.className = `ai-chat-message is-${type}`;
  element.textContent = message;
  aiChatMessages.append(element);
  aiChatMessages.scrollTop = aiChatMessages.scrollHeight;
  return element;
}

async function loadAiDiaryStatus() {
  aiProviderStatus.textContent = "正在檢查 AI 服務設定…";
  try {
    const result = await apiRequest("/ai/status");
    aiProviderStatus.textContent = result.configured
      ? `AI 日記已就緒${result.model ? ` · ${result.model}` : ""}。提交內容會傳送至已設定的 AI 服務。`
      : "AI 服務尚未設定。請在後端設定 AI_API_KEY，並重啟服務後使用。";
  } catch (error) {
    aiProviderStatus.textContent = `無法檢查 AI 服務：${error.message}`;
  }
}

function closeFriendToggle(person) {
  return `
    <label class="friend-close-toggle">
      <input type="checkbox" data-close-friend="${Number(person.id)}" ${person.is_close_friend ? "checked" : ""} aria-label="將 ${escapeHtml(person.display_name)} 設為摯友" />
      <span aria-hidden="true">★</span><span>摯友</span>
    </label>
  `;
}

let accountSearchTimer = null;
let accountSearchRequest = 0;
let accountSearchUsers = [];

function showAccountSearchResults(message, isError = false) {
  accountSearchResults.innerHTML = `<div class="${isError ? "error-state" : "account-search-empty"}">${escapeHtml(message)}</div>`;
  accountSearchResults.hidden = false;
  accountSearchInput.setAttribute("aria-expanded", "true");
}

function renderAccountSearchResults(users) {
  accountSearchUsers = users;
  accountSearchResults.innerHTML = users.length
    ? users
        .map((person) => {
          const initial = Array.from(person.display_name || "✦")[0];
          return `
            <article class="account-search-result" role="listitem">
              <button class="friend-profile-link" type="button" data-search-profile="${Number(person.id)}" aria-label="查看 ${escapeHtml(person.display_name)} 的個人檔案">
                ${
                  person.avatar_url
                    ? `<img class="social-avatar" src="${escapeHtml(person.avatar_url)}" alt="" />`
                    : `<span class="social-avatar social-avatar-fallback">${escapeHtml(initial)}</span>`
                }
                <span class="friend-card-info">
                  <strong>${escapeHtml(person.display_name)}</strong>
                  <span>@${escapeHtml(person.username)}${person.is_private ? " · 私人帳號" : ""}</span>
                </span>
              </button>
              <button class="account-search-follow ${person.is_following ? "is-following" : ""}" type="button" data-search-follow="${Number(person.id)}" aria-pressed="${person.is_following}">
                ${person.is_following ? "已追蹤" : "追蹤"}
              </button>
            </article>
          `;
        })
        .join("")
    : '<div class="account-search-empty">找不到符合的帳號，試試顯示名稱或 @ 使用者名稱。</div>';
  accountSearchResults.hidden = false;
  accountSearchInput.setAttribute("aria-expanded", "true");
}

function closeAccountSearchResults() {
  accountSearchResults.hidden = true;
  accountSearchInput.setAttribute("aria-expanded", "false");
}

async function searchAccounts() {
  const term = accountSearchInput.value.trim();
  const requestId = ++accountSearchRequest;
  if (!term) {
    closeAccountSearchResults();
    return;
  }
  if (term.replace(/^@/, "").trim().length < 2) {
    showAccountSearchResults("請輸入至少 2 個字元。");
    return;
  }
  if (!currentUser) {
    showAccountSearchResults("請先登入，再搜尋其他帳號。");
    return;
  }
  showAccountSearchResults("正在搜尋帳號…");
  try {
    const users = await apiRequest(`/users/search?q=${encodeURIComponent(term)}`);
    if (requestId !== accountSearchRequest) return;
    if (!Array.isArray(users)) throw new Error("搜尋結果格式不正確。");
    renderAccountSearchResults(users);
  } catch (error) {
    if (requestId === accountSearchRequest) {
      showAccountSearchResults(error.message, true);
    }
  }
}

accountSearchInput.addEventListener("input", () => {
  window.clearTimeout(accountSearchTimer);
  accountSearchTimer = window.setTimeout(searchAccounts, 260);
});

accountSearchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  window.clearTimeout(accountSearchTimer);
  searchAccounts();
});

accountSearchResults.addEventListener("click", async (event) => {
  const profileButton = event.target.closest("[data-search-profile]");
  if (profileButton) {
    closeAccountSearchResults();
    await openSocialMemberProfile(Number(profileButton.dataset.searchProfile));
    return;
  }
  const followButton = event.target.closest("[data-search-follow]");
  if (!followButton) return;
  const userId = Number(followButton.dataset.searchFollow);
  const person = accountSearchUsers.find((candidate) => candidate.id === userId);
  if (!person) return;
  followButton.disabled = true;
  try {
    if (person.is_following) {
      await apiRequest(`/friends/${userId}`, { method: "DELETE" });
      person.is_following = false;
    } else {
      await apiRequest(`/users/${userId}/follow`, { method: "POST" });
      person.is_following = true;
    }
    renderAccountSearchResults(accountSearchUsers);
  } catch (error) {
    followButton.disabled = false;
    showAccountSearchResults(error.message, true);
  }
});

document.addEventListener("click", (event) => {
  if (!event.target.closest("#account-search")) closeAccountSearchResults();
});

function socialUserButton(person, showCloseFriend = false) {
  const username = person.username || `user${person.id}`;
  return `
    <article class="social-user-row">
      <button class="friend-profile-link" type="button" data-social-profile="${Number(person.id)}">
        ${person.avatar_url ? `<img class="social-avatar" src="${escapeHtml(person.avatar_url)}" alt="" />` : `<span class="social-avatar social-avatar-fallback">${escapeHtml(Array.from(person.display_name || "✦")[0])}</span>`}
        <span class="friend-card-info">
          <strong>${escapeHtml(person.display_name)}</strong>
          <span>@${escapeHtml(username)}</span>
        </span>
      </button>
      ${showCloseFriend ? closeFriendToggle(person) : ""}
    </article>
  `;
}

async function openProfileRelations(kind) {
  currentSocialRelation = kind;
  profileSocialTitle.textContent = kind === "followers" ? "粉絲" : "追蹤中";
  profileSocialDescription.textContent =
    kind === "followers"
      ? "點選帳號查看公開檔案，或將追蹤你的粉絲加入摯友名單。"
      : "點選帳號查看公開檔案。只有也追蹤你的人可以設為摯友。";
  profileSocialBackButton.hidden = true;
  profileSocialList.innerHTML = '<div class="module-empty">正在載入名單…</div>';
  if (!profileSocialDialog.open) profileSocialDialog.showModal();
  try {
    const users = await apiRequest(`/user/relations/${kind}`);
    if (!Array.isArray(users)) throw new Error("社群名單資料格式不正確。");
    profileSocialList.innerHTML = users.length
      ? users
          .map((person) => socialUserButton(person, person.follows_you))
          .join("")
      : `<div class="module-empty">目前沒有${kind === "followers" ? "粉絲" : "追蹤中的帳號"}。</div>`;
  } catch (error) {
    profileSocialList.innerHTML = `<div class="error-state">${escapeHtml(error.message)}</div>`;
  }
}

async function openSocialMemberProfile(userId) {
  if (!profileSocialDialog.open) profileSocialDialog.showModal();
  profileSocialList.innerHTML = '<div class="module-empty">正在載入公開檔案…</div>';
  profileSocialBackButton.hidden = false;
  try {
    const result = await apiRequest(`/users/${userId}/profile`);
    const profile = result.profile;
    const avatar = profile.avatar_url
      ? `<img class="social-avatar social-avatar-large" src="${escapeHtml(profile.avatar_url)}" alt="" />`
      : `<span class="social-avatar social-avatar-large social-avatar-fallback">${escapeHtml(Array.from(profile.display_name || "✦")[0])}</span>`;
    const posts = result.posts
      .map(
        (post) => `
          <article class="public-profile-post">
            <div class="public-profile-post-meta">
              <span>${post.type === "footprint" ? "足跡" : "日記"}</span>
              <time>${escapeHtml(formatDate(post.created_at))}</time>
            </div>
            <h3>${escapeHtml(post.title)}</h3>
            <p>${escapeHtml(post.content || (post.type === "footprint" ? "足跡記錄" : ""))}</p>
            ${
              post.type === "footprint" && Array.isArray(post.points)
                ? `<p class="public-profile-stops">${post.points
                    .map((point) => escapeHtml(point.name))
                    .join(" ・ ")}</p>`
                : ""
            }
          </article>
        `,
      )
      .join("");
    profileSocialTitle.textContent = `@${profile.username}`;
    profileSocialDescription.textContent = "公開檔案與你有權查看的貼文";
    profileSocialList.innerHTML = `
      <section class="social-profile-summary">
        ${avatar}
        <div>
          <strong>${escapeHtml(profile.display_name)}</strong>
          <span>${escapeHtml(profile.bio || "尚未新增個人簡介。")}</span>
          <small>${profile.is_private ? "私人帳號 · " : ""}${Number(profile.posts_count)} 貼文 · ${Number(profile.followers_count)} 粉絲 · ${Number(profile.following_count)} 追蹤中</small>
        </div>
      </section>
      <div class="public-profile-posts">${posts || `<div class="module-empty">${profile.is_private ? "這是私人帳號，只有粉絲能看見公開貼文。" : "目前沒有你可查看的公開貼文。"}</div>`}</div>
    `;
  } catch (error) {
    profileSocialList.innerHTML = `<div class="error-state">${escapeHtml(error.message)}</div>`;
  }
}

async function updateCloseFriend(event) {
  const checkbox = event.target.closest("[data-close-friend]");
  if (!checkbox) return;
  checkbox.disabled = true;
  try {
    await apiRequest(
      `/friends/${checkbox.dataset.closeFriend}`,
      jsonOptions("PATCH", { is_close_friend: checkbox.checked }),
    );
    await Promise.all([loadEntries(), loadMapPoints()]);
    if (profileSocialDialog.open) {
      await openProfileRelations(currentSocialRelation);
    }
  } catch (error) {
    window.alert(`更新摯友名單失敗：${error.message}`);
    if (profileSocialDialog.open) {
      await openProfileRelations(currentSocialRelation);
    }
  }
}

profileSocialList.addEventListener("change", updateCloseFriend);
profileSocialList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-social-profile]");
  if (button) openSocialMemberProfile(Number(button.dataset.socialProfile));
});

document.querySelectorAll("[data-profile-relations]").forEach((button) => {
  button.addEventListener("click", () =>
    openProfileRelations(button.dataset.profileRelations),
  );
});
document.querySelector("#profile-social-close").addEventListener("click", () => {
  profileSocialDialog.close();
});
profileSocialBackButton.addEventListener("click", () => {
  openProfileRelations(currentSocialRelation);
});

async function updateEntryPrivacy(event) {
  const select = event.target.closest("[data-entry-privacy]");
  if (!select) return;
  try {
    await apiRequest(
      `/entries/${select.dataset.entryPrivacy}/privacy`,
      jsonOptions("PATCH", { privacy: select.value }),
    );
    await loadEntries();
  } catch (error) {
    window.alert(`更新日記隱私設定失敗：${error.message}`);
    await loadEntries();
  }
}

function privacyLabel(value) {
  return { private: "私密", friends: "摯友", public: "公開" }[value] || "私密";
}
