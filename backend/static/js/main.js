document.querySelector("#hero-date").textContent = new Date().toLocaleDateString("zh-TW", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
});
restoreLastPage();
applyViewFromUrl();
handleEmailVerificationLink();
initializeSession();
refreshServerStatus();
