// What a first-time visitor sees: an introduction when signed out, then a short
// checklist that finishes itself as they use the app.
const GUIDE_DISMISSED_KEY = "life-logger-guide-dismissed";
const welcomeCard = document.querySelector("#welcome-card");
let guideDismissed = false;
let guideRequested = false;

try {
  guideDismissed = localStorage.getItem(GUIDE_DISMISSED_KEY) === "1";
} catch {}

function rememberGuideDismissed(dismissed) {
  guideDismissed = dismissed;
  try {
    if (dismissed) localStorage.setItem(GUIDE_DISMISSED_KEY, "1");
    else localStorage.removeItem(GUIDE_DISMISSED_KEY);
  } catch {}
}

function guideSteps() {
  return [
    {
      title: "寫第一篇日記",
      hint: "打字或用 AI 聊天都可以，只有你看得到。",
      action: "write-diary",
      label: "寫日記",
      done: diaryEntries.length > 0,
    },
    {
      title: "記錄第一趟足跡",
      hint: "記下去過的地方，會顯示在地圖上。",
      action: "new-footprint",
      label: "新增足跡",
      done: mapPoints.some((point) => point.is_owner),
    },
    {
      title: "揪朋友一起出門",
      hint: "發起揪團，或參加別人的邀請。",
      action: "new-meetup",
      label: "發起揪團",
      done: meetups.some((meetup) => meetup.is_owner || meetup.is_participating),
    },
  ];
}

function signedOutWelcomeHtml() {
  return `
    <h2 id="welcome-title">歡迎使用 Life Logger</h2>
    <p>記錄每天的生活和走過的地方，也能揪朋友一起出門。</p>
    <ul class="welcome-features">
      <li><strong>日記</strong>：打字或跟 AI 聊天，就能存成日記</li>
      <li><strong>足跡</strong>：把去過的地方記在地圖上</li>
      <li><strong>揪團</strong>：發起活動，邀大家一起去</li>
    </ul>
    <div class="welcome-actions">
      <button class="primary-button" type="button" data-empty-action="sign-up">免費註冊</button>
      <button class="secondary-button" type="button" data-empty-action="log-in">我有帳號，登入</button>
    </div>`;
}

function guideHtml(steps) {
  const doneCount = steps.filter((step) => step.done).length;
  return `
    <div class="welcome-heading">
      <h2 id="welcome-title">三步開始使用</h2>
      <span class="entry-count">完成 ${doneCount} / ${steps.length}</span>
      <button class="icon-button" type="button" data-guide-dismiss aria-label="關閉新手指引">×</button>
    </div>
    <ol class="welcome-steps">
      ${steps
        .map(
          (step) => `
            <li class="welcome-step${step.done ? " is-done" : ""}">
              <span class="welcome-step-mark" aria-hidden="true">${step.done ? "✓" : ""}</span>
              <div>
                <strong>${step.title}${step.done ? '<span class="sr-only">（已完成）</span>' : ""}</strong>
                <p>${step.hint}</p>
              </div>
              ${step.done ? "" : `<button class="secondary-button" type="button" data-empty-action="${step.action}">${step.label}</button>`}
            </li>`,
        )
        .join("")}
    </ol>`;
}

function renderWelcomeCard() {
  // Someone signed in must not glimpse the introduction while the page finds that out.
  if (!accountChecked) return;
  if (!currentUser) {
    welcomeCard.innerHTML = signedOutWelcomeHtml();
    welcomeCard.hidden = false;
    return;
  }
  // Until the account's data arrives, every step would wrongly look unfinished.
  if (!sessionDataLoaded || (guideDismissed && !guideRequested)) {
    welcomeCard.hidden = true;
    return;
  }
  const steps = guideSteps();
  if (steps.every((step) => step.done) && !guideRequested) {
    welcomeCard.hidden = true;
    return;
  }
  welcomeCard.innerHTML = guideHtml(steps);
  welcomeCard.hidden = false;
}

function openAuthDialog(signingUp) {
  if (registering !== signingUp) loginModeToggle.click();
  openLoginDialog();
}

function goToTab(view) {
  document.querySelector(`.nav-link[data-view="${view}"]`).click();
}

const EMPTY_STATE_ACTIONS = {
  "write-diary": () => document.querySelector("#open-entry").click(),
  "new-footprint": () => {
    goToTab("map");
    document.querySelector("#map-add-open").click();
  },
  "new-trip": () => openTripForm(),
  "new-meetup": () => document.querySelector("#meetup-open").click(),
  "sign-up": () => openAuthDialog(true),
  "log-in": () => openAuthDialog(false),
};

document.addEventListener("click", (event) => {
  const action = event.target.closest("[data-empty-action]")?.dataset.emptyAction;
  if (action) EMPTY_STATE_ACTIONS[action]();
  if (event.target.closest("[data-guide-dismiss]")) {
    rememberGuideDismissed(true);
    guideRequested = false;
    renderWelcomeCard();
  }
});

document.querySelector("#settings-show-guide").addEventListener("click", () => {
  rememberGuideDismissed(false);
  guideRequested = true;
  settingsDialog.close();
  goToTab("home");
  renderWelcomeCard();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
