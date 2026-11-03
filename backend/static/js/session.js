async function loadTravelData() {
  await Promise.all([loadMapPoints(), loadTrips()]);
}

// Loads the home feed and the open view once each, instead of one after the other.
async function loadSessionData() {
  const view = viewFromUrl();
  const loads = [loadEntries(), loadMeetups()];
  const viewLoadsMapPoints = view === "map" || view === "trips";
  if (currentUser && !viewLoadsMapPoints) loads.push(loadMapPoints());
  const viewLoadsRequestCount = view === "profile" && !viewedUsername;
  if (currentUser && !viewLoadsRequestCount) refreshFollowRequestCount();
  loadViewData(view);
  await Promise.all(loads);
}

function updateAccountUi() {
  accountName.textContent = currentUser
    ? currentUser.display_name || currentUser.email
    : "尚未登入";
  loginOpenButton.textContent = currentUser ? "帳號" : "登入 / 註冊";
  logoutButton.hidden = !currentUser;
}

async function loadOAuthProviders() {
  try {
    const providers = await apiRequest("/auth/providers");
    document.querySelector("#google-login").disabled = !providers.google;
    document.querySelector("#apple-login").disabled = !providers.apple;
    oauthSetupNote.hidden = Boolean(providers.google && providers.apple);
  } catch {
    document.querySelector("#google-login").disabled = true;
    document.querySelector("#apple-login").disabled = true;
    oauthSetupNote.hidden = false;
  }
}

async function initializeSession() {
  try {
    const result = await apiRequest("/auth/me");
    currentUser = result.user;
  } catch {
    currentUser = null;
  }
  updateAccountUi();
  await Promise.all([loadSessionData(), loadOAuthProviders()]);
}

function showVerificationPrompt(email) {
  pendingVerificationEmail = email;
  resendVerificationButton.hidden = !email;
}

async function handleEmailVerificationLink() {
  const url = new URL(window.location.href);
  const resetToken = url.searchParams.get("reset_password");
  if (resetToken) {
    url.searchParams.delete("reset_password");
    window.history.replaceState(null, "", url);
    pendingPasswordResetToken = resetToken;
    resetPasswordForm.reset();
    resetPasswordStatus.textContent = "";
    resetPasswordDialog.showModal();
    return;
  }
  const token = url.searchParams.get("verify_email");
  if (!token) return;
  // Drop the token from the address bar and history before anything else runs.
  url.searchParams.delete("verify_email");
  window.history.replaceState(null, "", url);
  let message;
  try {
    await apiRequest("/auth/verify-email", jsonOptions("POST", { token }));
    message = "電子郵件驗證完成，請登入。";
  } catch (error) {
    message = error.message;
  }
  openLoginDialog();
  loginStatus.textContent = message;
}

function openLoginDialog() {
  loginStatus.textContent = "";
  loginDialog.showModal();
}
