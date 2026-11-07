const INSTALL_DISMISSED_KEY = "life-logger-install-dismissed";
const installBanner = document.querySelector("#install-banner");
const installBannerText = document.querySelector("#install-banner-text");
const installAcceptButton = document.querySelector("#install-accept");
const settingsInstallSection = document.querySelector("#settings-install");
// Also on your own profile page, beside 編輯個人檔案, where it first lived.
const profileInstallButton = document.querySelector("#profile-install");
const isInstalledApp =
  window.matchMedia("(display-mode: standalone)").matches ||
  window.navigator.standalone === true;
// iPads report themselves as Macs; a touch screen gives them away.
const isIos =
  /iPhone|iPad|iPod/.test(window.navigator.userAgent) ||
  (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(window.navigator.userAgent);
let installPrompt = null;

// Phones can always add the site to the home screen, even when the browser has not
// offered its own install window (yet), so the steps for that browser are shown instead.
function installHint() {
  const agent = window.navigator.userAgent;
  if (/\bLine\/|FBAN|FBAV|Instagram|MicroMessenger/i.test(agent)) {
    return isIos
      ? "這是 App 內建的瀏覽器，無法加入主畫面。請點右下角或右上角選單，選「用 Safari 開啟」後再安裝。"
      : "這是 App 內建的瀏覽器，無法加入主畫面。請點右上角選單，選「用 Chrome 開啟」或「以瀏覽器開啟」後再安裝。";
  }
  if (isIos) return "點瀏覽器的分享按鈕，再選「加入主畫面」，就能像 App 一樣開啟。";
  if (/SamsungBrowser/i.test(agent)) {
    return "點右下角選單「≡」，選「新增頁面至」→「主畫面」。也可以改用 Chrome 開啟再安裝。";
  }
  if (isAndroid) return "點右上角選單「⋮」，選「安裝應用程式」或「加到主畫面」。";
  return "在瀏覽器網址列右側點「安裝」圖示，或從選單選「安裝 Life Logger」。";
}

function installDismissed() {
  try {
    return localStorage.getItem(INSTALL_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function showInstallOptions() {
  const canInstall = !isInstalledApp && (Boolean(installPrompt) || isIos || isAndroid);
  settingsInstallSection.hidden = !canInstall;
  profileInstallButton.hidden = !canInstall;
  installBanner.hidden = !canInstall || installDismissed();
  installAcceptButton.hidden = !canInstall;
  installBannerText.textContent = "把 Life Logger 加到主畫面，像 App 一樣開啟。";
}

async function askToInstall() {
  if (!installPrompt) {
    showToast(installHint());
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
  settingsInstallSection.hidden = true;
  profileInstallButton.hidden = true;
});

installAcceptButton.addEventListener("click", askToInstall);
document.querySelector("#pwa-install").addEventListener("click", askToInstall);
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
