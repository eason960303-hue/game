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

async function loadFriends() {
  friendCount.textContent = "載入中…";
  friendList.innerHTML = '<div class="module-empty">正在載入追蹤名單…</div>';
  try {
    const friends = await apiRequest("/friends");
    if (!Array.isArray(friends)) {
      throw new Error("伺服器回傳的好友資料格式不正確。");
    }
    friendCount.textContent = `${friends.length} 位`;
    if (friends.length === 0) {
      friendList.innerHTML =
        '<div class="module-empty">尚未追蹤任何帳號。輸入好友電子郵件即可開始。</div>';
      return;
    }
    friendList.innerHTML = friends
      .map(
        (friend) => `
          <article class="friend-card">
            <div class="friend-card-info">
              <strong>${escapeHtml(friend.display_name)}</strong>
              <span>${escapeHtml(friend.email)}</span>
            </div>
            <div class="friend-card-controls">
              <label class="friend-close-toggle">
                <input type="checkbox" data-close-friend="${friend.id}" ${friend.is_close_friend ? "checked" : ""} />
                摯友名單
              </label>
              <button class="friend-remove" type="button" data-unfollow-friend="${friend.id}">取消追蹤</button>
            </div>
          </article>
        `,
      )
      .join("");
  } catch (error) {
    friendCount.textContent = "載入失敗";
    friendList.innerHTML = `<div class="error-state">${escapeHtml(error.message)}<button class="retry-button" id="retry-friends" type="button">重新整理</button></div>`;
    document
      .querySelector("#retry-friends")
      .addEventListener("click", loadFriends);
  }
}

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
