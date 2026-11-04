const INSTALL_DISMISSED_KEY = "life-logger-install-dismissed";
const installBanner = document.querySelector("#install-banner");
const installBannerText = document.querySelector("#install-banner-text");
const installAcceptButton = document.querySelector("#install-accept");
const profileInstallButton = document.querySelector("#pwa-install");
const IOS_INSTALL_HINT = "點瀏覽器的分享按鈕，再選「加入主畫面」，就能像 App 一樣開啟。";

const isInstalledApp =
  window.matchMedia("(display-mode: standalone)").matches ||
  window.navigator.standalone === true;
// iPads report themselves as Macs; a touch screen gives them away.
const isIos =
  /iPhone|iPad|iPod/.test(window.navigator.userAgent) ||
  (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
let installPrompt = null;

function installDismissed() {
  try {
    return localStorage.getItem(INSTALL_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function showInstallOptions() {
  const canInstall = !isInstalledApp && (Boolean(installPrompt) || isIos);
  profileInstallButton.hidden = !canInstall;
  installBanner.hidden = !canInstall || installDismissed();
  installAcceptButton.hidden = !installPrompt;
  installBannerText.textContent = installPrompt
    ? "把 Life Logger 加到主畫面，開啟更快。"
    : IOS_INSTALL_HINT;
}

async function askToInstall() {
  if (!installPrompt) {
    showToast(IOS_INSTALL_HINT);
    return;
  }
  const prompt = installPrompt;
  // The browser allows each prompt to be used once.
  installPrompt = null;
  await prompt.prompt();
  showInstallOptions();
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  showInstallOptions();
});

window.addEventListener("appinstalled", () => {
  installPrompt = null;
  installBanner.hidden = true;
  profileInstallButton.hidden = true;
});

installAcceptButton.addEventListener("click", askToInstall);
profileInstallButton.addEventListener("click", askToInstall);
document.querySelector("#install-dismiss").addEventListener("click", () => {
  installBanner.hidden = true;
  try {
    localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
  } catch {}
});

// The installed app has no address bar or reload, so it has to notice this by itself.
window.addEventListener("online", refreshServerStatus);
window.addEventListener("offline", refreshServerStatus);

showInstallOptions();

// A preview server has no /sw.js of its own.
if ("serviceWorker" in navigator && !isFilePreview && !isLivePreview) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  });
}
