document.querySelector("#login-open").addEventListener("click", openLoginDialog);
document.querySelector("#login-dismiss").addEventListener("click", () => {
  loginDialog.close();
});
document.querySelector("#login-cancel").addEventListener("click", () => {
  loginDialog.close();
});

document.querySelector("#forgot-password-dismiss").addEventListener("click", () => {
  forgotPasswordDialog.close();
});
document.querySelector("#forgot-password-cancel").addEventListener("click", () => {
  forgotPasswordDialog.close();
});
forgotPasswordOpenButton.addEventListener("click", () => {
  forgotPasswordEmail.value = loginForm.elements.email.value.trim();
  forgotPasswordStatus.textContent = "";
  loginDialog.close();
  forgotPasswordDialog.showModal();
});

document.querySelector("#reset-password-dismiss").addEventListener("click", () => {
  resetPasswordDialog.close();
});
document.querySelector("#reset-password-cancel").addEventListener("click", () => {
  resetPasswordDialog.close();
});

loginModeToggle.addEventListener("click", () => {
  registering = !registering;
  showVerificationPrompt(null);
  forgotPasswordOpenButton.hidden = registering;
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

forgotPasswordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = document.querySelector("#forgot-password-submit");
  submitButton.disabled = true;
  forgotPasswordStatus.textContent = "正在處理請求…";
  try {
    const result = await apiRequest(
      "/auth/forgot-password",
      jsonOptions("POST", { email: getFormText(new FormData(forgotPasswordForm), "email") }),
    );
    forgotPasswordStatus.textContent = result.message;
  } catch (error) {
    forgotPasswordStatus.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

resetPasswordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(resetPasswordForm);
  const password = getFormText(formData, "password");
  const confirmPassword = getFormText(formData, "confirm_password");
  const submitButton = document.querySelector("#reset-password-submit");
  if (password !== confirmPassword) {
    resetPasswordStatus.textContent = "兩次輸入的密碼不一致。";
    return;
  }
  if (!pendingPasswordResetToken) {
    resetPasswordStatus.textContent = "重設連結無效或已過期，請重新申請。";
    return;
  }
  submitButton.disabled = true;
  resetPasswordStatus.textContent = "正在更新密碼…";
  try {
    await apiRequest(
      "/auth/reset-password",
      jsonOptions("POST", {
        token: pendingPasswordResetToken,
        password,
      }),
    );
    pendingPasswordResetToken = null;
    resetPasswordDialog.close();
    resetPasswordForm.reset();
    registering = false;
    forgotPasswordOpenButton.hidden = false;
    loginModeToggle.textContent = "還沒有帳號？註冊";
    openLoginDialog();
    loginStatus.textContent = "密碼已更新。請使用新密碼登入；其他裝置已登出。";
  } catch (error) {
    resetPasswordStatus.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
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
    await loadSessionData();
  } catch (error) {
    loginStatus.textContent = error.message;
    if (error.status === 403) showVerificationPrompt(payload.email);
  } finally {
    loginSubmitButton.disabled = false;
    loginSubmitButton.textContent = registering ? "註冊並登入" : "登入";
  }
});

logoutButton.addEventListener("click", async () => {
  await flushPrivacyDrafts();
  try {
    await apiRequest("/auth/logout", { method: "POST" });
  } catch (error) {
    showToast(`登出失敗：${error.message}`);
    return;
  }
  await showSignedOutState();
});

const accountDeleteDialog = document.querySelector("#account-delete-dialog");
const accountDeleteForm = document.querySelector("#account-delete-form");
const accountDeleteInput = document.querySelector("#account-delete-input");
const accountDeleteStatus = document.querySelector("#account-delete-status");
const accountDeleteSubmit = document.querySelector("#account-delete-submit");

let accountHasPassword = false;

document.querySelector("#account-delete-open").addEventListener("click", async () => {
  // Asked fresh: the page's profile is empty if it failed to load, and the wrong
  // form would leave someone with no way to confirm.
  try {
    accountHasPassword = (await apiRequest("/user/profile")).has_password;
  } catch (error) {
    profileEditStatus.textContent = error.message;
    return;
  }
  document.querySelector("#account-delete-email-note").hidden = accountHasPassword;
  document.querySelector("#account-delete-password").hidden = !accountHasPassword;
  accountDeleteInput.required = accountHasPassword;
  accountDeleteSubmit.textContent = accountHasPassword ? "永久刪除帳號" : "寄確認信";
  accountDeleteForm.reset();
  accountDeleteStatus.textContent = "";
  accountDeleteDialog.showModal();
  if (accountHasPassword) accountDeleteInput.focus();
});

for (const id of ["#account-delete-dismiss", "#account-delete-cancel"]) {
  document
    .querySelector(id)
    .addEventListener("click", () => accountDeleteDialog.close());
}

async function deleteAccountWithPassword() {
  await flushPrivacyDrafts();
  await apiRequest(
    "/user/delete",
    jsonOptions("POST", { password: accountDeleteInput.value }),
  );
  accountDeleteDialog.close();
  profileEditDialog.close();
  await showSignedOutState();
  showToast("帳號已刪除");
}

async function sendAccountDeletionEmail() {
  const { email } = await apiRequest("/user/delete/request", { method: "POST" });
  accountDeleteDialog.close();
  showToast(`確認信已寄到 ${email}，請在 30 分鐘內開啟信中的連結。`);
}

accountDeleteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  accountDeleteStatus.textContent = "";
  accountDeleteSubmit.disabled = true;
  try {
    await (accountHasPassword ? deleteAccountWithPassword() : sendAccountDeletionEmail());
  } catch (error) {
    accountDeleteStatus.textContent = error.message;
  } finally {
    accountDeleteSubmit.disabled = false;
  }
});

const accountDeleteLinkDialog = document.querySelector("#account-delete-link-dialog");
const accountDeleteLinkStatus = document.querySelector("#account-delete-link-status");
const accountDeleteLinkSubmit = document.querySelector("#account-delete-link-submit");
let pendingAccountDeletionToken = null;

// Opening the link never deletes anything: mail scanners open links too.
function openAccountDeletionLinkDialog(token) {
  pendingAccountDeletionToken = token;
  accountDeleteLinkStatus.textContent = "";
  accountDeleteLinkDialog.showModal();
}

document
  .querySelector("#account-delete-link-cancel")
  .addEventListener("click", () => accountDeleteLinkDialog.close());

document
  .querySelector("#account-delete-link-form")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    accountDeleteLinkStatus.textContent = "";
    accountDeleteLinkSubmit.disabled = true;
    try {
      await apiRequest(
        "/user/delete/confirm",
        jsonOptions("POST", { token: pendingAccountDeletionToken }),
      );
    } catch (error) {
      accountDeleteLinkStatus.textContent = error.message;
      return;
    } finally {
      accountDeleteLinkSubmit.disabled = false;
    }
    accountDeleteLinkDialog.close();
    // This browser may be signed in to a different account, which stays signed in.
    try {
      await apiRequest("/auth/me");
    } catch {
      await showSignedOutState();
    }
    showToast("帳號已刪除");
  });

async function showSignedOutState() {
  forgetPage();
  currentUser = null;
  sessionDataLoaded = false;
  currentProfile = null;
  resetListLoads();
  mapPoints = [];
  trips = [];
  profilePosts = [];
  discardFootprintPhotoDrafts();
  renderMeetups();
  setDiaryEntries([]);
  expandedProfileDiaryId = null;
  expandedProfileFootprintId = null;
  renderTimelineFootprints();
  setProfileOwner(null);
  clearProfileHeader();
  setFollowRequestCount(0);
  updateAccountUi();
  form.reset();
  mapPointForm.reset();
  aiChatForm.reset();
  if (dialog.open) dialog.close();
  if (mapPointDialog.open) mapPointDialog.close();
  if (meetupDialog.open) meetupDialog.close();
  resetMeetupForm();
  stopMapPick();
  aiChatMessages.innerHTML =
    '<div class="ai-chat-message is-assistant">嗨！今天發生了什麼？打給我，我會幫你整理成日記。</div>';
  aiProviderStatus.textContent = "";
  profileBio.textContent = "請登入以查看個人簡介。";
  profileDiariesCount.textContent = "0 篇";
  profileFootprintsCount.textContent = "0 趟";
  profileDiariesGrid.innerHTML =
    '<div class="profile-empty">請先登入以查看個人日記。</div>';
  profileFootprintsGrid.innerHTML =
    '<div class="profile-empty">請先登入以查看個人足跡。</div>';
  renderMapPoints();
  renderTrips();
  await loadEntries();
}
