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

function followLabel(person) {
  if (person.is_following) return "追蹤中";
  return person.is_requested ? "已送出請求" : "追蹤";
}

// Moves one step: not following -> following or requested -> back to not following.
async function toggleFollow(person) {
  if (person.is_requested) {
    await apiRequest(`/users/${person.id}/follow-request`, { method: "DELETE" });
    person.is_requested = false;
  } else if (person.is_following) {
    if (
      person.is_private &&
      !window.confirm("這是私人帳號，取消追蹤後要再次經對方同意才能看見貼文。確定要取消嗎？")
    ) {
      return;
    }
    await apiRequest(`/friends/${person.id}`, { method: "DELETE" });
    person.is_following = false;
  } else {
    const result = await apiRequest(`/users/${person.id}/follow`, { method: "POST" });
    person.is_following = result.is_following;
    person.is_requested = result.is_requested;
  }
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
          return `
            <article class="account-search-result" role="listitem">
              <a class="friend-profile-link" href="${escapeHtml(profileHref(person.username))}" aria-label="查看 ${escapeHtml(person.display_name)} 的個人檔案">
                ${avatarHtml(person.avatar_url, person.display_name)}
                <span class="friend-card-info">
                  <strong>${escapeHtml(person.display_name)}</strong>
                  <span>@${escapeHtml(person.username)}${person.is_private ? " · 私人帳號" : ""}</span>
                </span>
              </a>
              <button class="account-search-follow ${person.is_following || person.is_requested ? "is-following" : ""}" type="button" data-search-follow="${Number(person.id)}" aria-pressed="${person.is_following}">
                ${followLabel(person)}
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
  const followButton = event.target.closest("[data-search-follow]");
  if (!followButton) return;
  const userId = Number(followButton.dataset.searchFollow);
  const person = accountSearchUsers.find((candidate) => candidate.id === userId);
  if (!person) return;
  followButton.disabled = true;
  try {
    await toggleFollow(person);
    renderAccountSearchResults(accountSearchUsers);
  } catch (error) {
    followButton.disabled = false;
    showAccountSearchResults(error.message, true);
  }
});

document.addEventListener("click", (event) => {
  if (!event.target.closest("#account-search")) closeAccountSearchResults();
});

function socialUserControls(person, kind) {
  if (kind === "requests") {
    return `
      <button class="small-action" type="button" data-accept-request="${Number(person.id)}">確認</button>
      <button class="small-action is-destructive" type="button" data-decline-request="${Number(person.id)}">刪除</button>
    `;
  }
  const closeFriend = person.follows_you ? closeFriendToggle(person) : "";
  const remove =
    kind === "followers"
      ? `<button class="small-action" type="button" data-remove-follower="${Number(person.id)}">移除</button>`
      : "";
  return closeFriend + remove;
}

function socialUserButton(person, kind) {
  const controls = socialUserControls(person, kind);
  return `
    <article class="social-user-row">
      <a class="friend-profile-link" href="${escapeHtml(profileHref(person.username))}">
        ${avatarHtml(person.avatar_url, person.display_name)}
        <span class="friend-card-info">
          <strong>${escapeHtml(person.display_name)}</strong>
          <span>@${escapeHtml(person.username)}</span>
        </span>
      </a>
      <div class="social-user-actions">${controls}</div>
    </article>
  `;
}

async function openProfileRelations(kind) {
  currentSocialRelation = kind;
  const { title, description, empty } = {
    followers: {
      title: "粉絲",
      description: "點選帳號前往對方主頁，或將追蹤你的粉絲加入摯友名單。移除粉絲不會通知對方。",
      empty: "目前沒有粉絲。",
    },
    following: {
      title: "追蹤中",
      description: "點選帳號前往對方主頁。只有也追蹤你的人可以設為摯友。",
      empty: "目前沒有追蹤中的帳號。",
    },
    requests: {
      title: "追蹤請求",
      description: "確認後對方會成為粉絲，可以看見你的公開貼文。",
      empty: "目前沒有等待中的追蹤請求。",
    },
  }[kind];
  profileSocialTitle.textContent = title;
  profileSocialDescription.textContent = description;
  const load = beginListLoad(
    profileSocialList,
    kind,
    '<div class="module-empty">正在載入名單…</div>',
  );
  if (!profileSocialDialog.open) profileSocialDialog.showModal();
  try {
    const users = await apiRequest(
      kind === "requests" ? "/user/follow-requests" : `/user/relations/${kind}`,
    );
    if (!load.isCurrent()) return;
    if (!Array.isArray(users)) throw new Error("社群名單資料格式不正確。");
    profileSocialList.innerHTML = users.length
      ? users
          .map((person) => socialUserButton(person, kind))
          .join("")
      : `<div class="module-empty">${empty}</div>`;
  } catch (error) {
    if (!load.isCurrent()) return;
    forgetListLoad(profileSocialList);
    profileSocialList.innerHTML = `<div class="error-state">${escapeHtml(error.message)}</div>`;
  }
}

async function updateCloseFriend(event) {
  const checkbox = event.target.closest("[data-close-friend]");
  if (!checkbox) return;
  try {
    await apiRequest(
      `/friends/${checkbox.dataset.closeFriend}`,
      jsonOptions("PATCH", { is_close_friend: checkbox.checked }),
    );
  } catch (error) {
    checkbox.checked = !checkbox.checked;
    window.alert(`更新摯友名單失敗：${error.message}`);
  }
}

async function handleSocialAction(event) {
  const accept = event.target.closest("[data-accept-request]");
  const decline = event.target.closest("[data-decline-request]");
  const remove = event.target.closest("[data-remove-follower]");
  const button = accept || decline || remove;
  if (!button) return;
  if (remove && !window.confirm("要移除這位粉絲嗎？對方也會失去摯友權限。")) return;
  button.disabled = true;
  try {
    if (accept) {
      await apiRequest(`/user/follow-requests/${accept.dataset.acceptRequest}/accept`, {
        method: "POST",
      });
    } else if (decline) {
      await apiRequest(`/user/follow-requests/${decline.dataset.declineRequest}`, {
        method: "DELETE",
      });
    } else {
      await apiRequest(`/user/followers/${remove.dataset.removeFollower}`, {
        method: "DELETE",
      });
    }
  } catch (error) {
    window.alert(error.message);
  }
  await Promise.all([openProfileRelations(currentSocialRelation), loadProfile()]);
}

profileSocialList.addEventListener("click", handleSocialAction);
profileSocialList.addEventListener("change", updateCloseFriend);

document.querySelectorAll("[data-profile-relations]").forEach((button) => {
  button.addEventListener("click", () =>
    openProfileRelations(button.dataset.profileRelations),
  );
});
document.querySelector("#profile-social-close").addEventListener("click", () => {
  profileSocialDialog.close();
});

function rememberProfilePostPrivacy(type, id, privacy) {
  const post = profilePosts.find((item) => item.type === type && item.id === id);
  if (post) post.privacy = privacy;
}

const PRIVACY_KINDS = {
  "data-entry-privacy": {
    badge: "entry",
    path: (id) => `/entries/${id}/privacy`,
    failure: "更新日記隱私設定失敗",
    remember: (id, privacy) => rememberProfilePostPrivacy("entry", id, privacy),
  },
  "data-privacy-point": {
    badge: "point",
    path: (id) => `/map-points/${id}/privacy`,
    failure: "更新隱私設定失敗",
    remember: (id, privacy) => {
      const point = mapPoints.find((item) => item.id === id);
      if (point) point.privacy = privacy;
      rememberProfilePostPrivacy("footprint", id, privacy);
    },
  },
};

// Shows a privacy value everywhere the same post appears, without redrawing any list.
function showPrivacy(attribute, id, privacy) {
  document.querySelectorAll(`[${attribute}="${id}"]`).forEach((select) => {
    select.value = privacy;
    select.dataset.saved = privacy;
  });
  const { badge, remember } = PRIVACY_KINDS[attribute];
  document
    .querySelectorAll(`[data-privacy-badge="${badge}:${id}"]`)
    .forEach((element) => {
      element.textContent = privacyLabel(privacy);
    });
  remember(Number(id), privacy);
}

const privacySaves = new Map();
// A footprint's choice made inside its open card waits here until that card closes.
const privacyDrafts = new Map();

// Saves for one post run one at a time, so a quick change of mind cannot arrive out
// of order and leave the wrong privacy on the server.
function savePrivacy(attribute, id, wanted, confirmed) {
  const key = `${attribute}:${id}`;
  const running = privacySaves.get(key);
  if (running) {
    running.wanted = wanted;
    return running.finished;
  }
  const save = { confirmed, wanted };
  privacySaves.set(key, save);
  save.finished = runPrivacySave(attribute, id, save);
  return save.finished;
}

async function runPrivacySave(attribute, id, save) {
  const { path, failure } = PRIVACY_KINDS[attribute];
  try {
    while (save.confirmed !== save.wanted) {
      const privacy = save.wanted;
      // keepalive lets the save finish when leaving the page is what started it.
      await apiRequest(path(id), {
        ...jsonOptions("PATCH", { privacy }),
        keepalive: true,
      });
      save.confirmed = privacy;
    }
    document.querySelectorAll(`[${attribute}="${id}"]`).forEach((select) => {
      select.classList.add("is-saved");
      window.setTimeout(() => select.classList.remove("is-saved"), 900);
    });
  } catch (error) {
    showPrivacy(attribute, id, save.confirmed);
    window.alert(`${failure}：${error.message}`);
  } finally {
    privacySaves.delete(`${attribute}:${id}`);
  }
}

function updatePrivacy(event) {
  const attribute = Object.keys(PRIVACY_KINDS).find((name) =>
    event.target.hasAttribute(name),
  );
  if (!attribute) return;
  const select = event.target;
  const id = Number(select.getAttribute(attribute));
  const isDraft =
    attribute === "data-privacy-point" &&
    select.closest(".map-point-card, .profile-post-tile");
  const confirmed =
    (isDraft && privacyDrafts.get(id)?.confirmed) || select.dataset.saved;
  showPrivacy(attribute, id, select.value);
  if (!isDraft) savePrivacy(attribute, id, select.value, confirmed);
  else if (select.value === confirmed) privacyDrafts.delete(id);
  else privacyDrafts.set(id, { confirmed, wanted: select.value });
}

function flushPrivacyDrafts() {
  const saves = Array.from(privacyDrafts, ([id, { confirmed, wanted }]) =>
    savePrivacy("data-privacy-point", id, wanted, confirmed),
  );
  privacyDrafts.clear();
  return Promise.all(saves);
}

function privacySavesFinished() {
  return Promise.all(
    Array.from(privacySaves.values(), (save) => save.finished),
  );
}

// Freshly loaded footprints must not undo a choice that has not been saved yet.
function withPrivacyDrafts(posts) {
  return posts.map((post) =>
    post.type !== "entry" && privacyDrafts.has(post.id)
      ? { ...post, privacy: privacyDrafts.get(post.id).wanted }
      : post,
  );
}

function privacyLabel(value) {
  return PRIVACY_LABELS[value] || PRIVACY_LABELS.private;
}
