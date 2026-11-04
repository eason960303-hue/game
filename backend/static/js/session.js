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
  // Signed in, the account area is just the logout button.
  accountName.hidden = Boolean(currentUser);
  loginOpenButton.hidden = Boolean(currentUser);
  logoutButton.hidden = !currentUser;
  document.querySelector("#recent-entries-section").hidden = !currentUser;
}

// A sign-in option that can't work isn't offered at all.
function showOAuthProviders(providers) {
  document.querySelector("#google-login").hidden = !providers.google;
  document.querySelector("#apple-login").hidden = !providers.apple;
  const anyProvider = Boolean(providers.google || providers.apple);
  document.querySelector(".provider-buttons").hidden = !anyProvider;
  document.querySelector(".auth-divider").hidden = !anyProvider;
}

async function loadOAuthProviders() {
  try {
    showOAuthProviders(await apiRequest("/auth/providers"));
  } catch {
    showOAuthProviders({});
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
