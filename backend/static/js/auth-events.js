document.querySelector("#login-open").addEventListener("click", openLoginDialog);
document.querySelector("#login-dismiss").addEventListener("click", () => {
  loginDialog.close();
});
document.querySelector("#login-cancel").addEventListener("click", () => {
  loginDialog.close();
});

loginModeToggle.addEventListener("click", () => {
  registering = !registering;
  showVerificationPrompt(null);
  displayNameField.hidden = !registering;
  loginForm.elements.display_name.required = registering;
  loginForm.elements.password.autocomplete = registering
    ? "new-password"
    : "current-password";
  loginForm.elements.password.minLength = registering ? 8 : 1;
  loginForm.elements.password.placeholder = registering
    ? "至少 8 個字元"
    : "請輸入密碼";
  document.querySelector("#login-title").textContent = registering
    ? "建立生活記錄帳號"
    : "登入生活記錄";
  document.querySelector("#login-description").textContent = registering
    ? "註冊後即可開始記錄你的日記與足跡。"
    : "登入後即可管理你的日記、足跡與行程。";
  loginSubmitButton.textContent = registering ? "註冊並登入" : "登入";
  loginModeToggle.textContent = registering
    ? "已經有帳號？登入"
    : "還沒有帳號？註冊";
  loginStatus.textContent = "";
});

document.querySelector("#google-login").addEventListener("click", () => {
  window.location.assign(apiUrl("/auth/google"));
});
document.querySelector("#apple-login").addEventListener("click", () => {
  window.location.assign(apiUrl("/auth/apple"));
});

resendVerificationButton.addEventListener("click", async () => {
  resendVerificationButton.disabled = true;
  try {
    await apiRequest(
      "/auth/resend-verification",
      jsonOptions("POST", { email: pendingVerificationEmail }),
    );
    loginStatus.textContent = "如果這個帳號尚未驗證，新的驗證信已寄出，請到信箱查看。";
  } catch (error) {
    loginStatus.textContent = error.message;
  } finally {
    resendVerificationButton.disabled = false;
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginStatus.textContent = "";
  loginSubmitButton.disabled = true;
  loginSubmitButton.textContent = registering ? "建立帳號中…" : "登入中…";
  const formData = new FormData(loginForm);
  const payload = {
    email: getFormText(formData, "email"),
    password: getFormText(formData, "password"),
  };
  if (registering) {
    payload.display_name = getFormText(formData, "display_name");
  }
  showVerificationPrompt(null);
  try {
    const result = await apiRequest(
      registering ? "/auth/register" : "/auth/login",
      jsonOptions("POST", payload),
    );
    if (result.verification_required) {
      showVerificationPrompt(payload.email);
      loginStatus.textContent = `驗證信已寄到 ${payload.email}，請開啟信中的連結後再登入。`;
      return;
    }
    currentUser = result.user;
    updateAccountUi();
    loginDialog.close();
    loginForm.reset();
    await Promise.all([loadEntries(), loadTravelData()]);
    const activeView = document.querySelector(
      '[data-view][aria-current="page"]',
    )?.dataset.view;
    if (activeView === "profile") await loadProfile();
    if (activeView === "map") await loadFriends();
    if (activeView === "ai-diary") await loadAiDiaryStatus();
  } catch (error) {
    loginStatus.textContent = error.message;
    if (error.status === 403) showVerificationPrompt(payload.email);
  } finally {
    loginSubmitButton.disabled = false;
    loginSubmitButton.textContent = registering ? "註冊並登入" : "登入";
  }
});

logoutButton.addEventListener("click", async () => {
  try {
    await apiRequest("/auth/logout", { method: "POST" });
  } catch (error) {
    serverStatusDetail.textContent = `登出失敗：${error.message}`;
    return;
  }
  currentUser = null;
  currentProfile = null;
  updateAccountUi();
  form.reset();
  mapPointForm.reset();
  aiChatForm.reset();
  if (dialog.open) dialog.close();
  if (mapPointDialog.open) mapPointDialog.close();
  pickingMapPoint = false;
  mapPickBanner.hidden = true;
  await loadEntries();
  mapPoints = [];
  trips = [];
  friendList.innerHTML = '<div class="module-empty">登入後載入好友名單。</div>';
  friendCount.textContent = "登入後載入";
  friendForm.reset();
  document.querySelector("#friend-form-status").textContent = "";
  aiChatMessages.innerHTML =
    '<div class="ai-chat-message is-assistant">嗨！告訴我今天發生了什麼，我會幫你整理成一篇日記。</div>';
  aiProviderStatus.textContent = "登入後檢查 AI 服務設定。";
  profilePageTitle.textContent = "個人檔案";
  profileDisplayName.textContent = "";
  profileBio.textContent = "請登入以查看個人簡介。";
  profileAvatar.hidden = true;
  profileAvatar.removeAttribute("src");
  profileAvatarInitial.textContent = "✦";
  profileAvatarInitial.hidden = false;
  profilePostsCount.textContent = "—";
  profileFollowersCount.textContent = "—";
  profileFollowingCount.textContent = "—";
  profilePosts = [];
  currentProfile = null;
  expandedProfileDiaryId = null;
  expandedProfileFootprintId = null;
  profileDiariesCount.textContent = "0 篇";
  profileFootprintsCount.textContent = "0 趟";
  profileDiariesGrid.innerHTML =
    '<div class="profile-empty">請先登入以查看個人日記。</div>';
  profileFootprintsGrid.innerHTML =
    '<div class="profile-empty">請先登入以查看個人足跡。</div>';
  renderMapPoints();
  renderTrips();
});
