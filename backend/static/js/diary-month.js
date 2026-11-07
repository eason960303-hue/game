const diaryYearSelect = document.querySelector("#diary-year");
const diaryMonthSelect = document.querySelector("#diary-month");
const diaryMonthList = document.querySelector("#diary-month-list");
const diaryMonthCount = document.querySelector("#diary-month-count");
const diaryMonthPrev = document.querySelector("#diary-month-prev");
const diaryMonthNext = document.querySelector("#diary-month-next");
const DIARY_YEARS_BACK = 5;

const diaryMonthToday = new Date();
let diaryEntries = [];
let diaryYear = diaryMonthToday.getFullYear();
let diaryMonth = diaryMonthToday.getMonth() + 1;

diaryMonthSelect.innerHTML = Array.from(
  { length: 12 },
  (_, index) => `<option value="${index + 1}">${index + 1} 月</option>`,
).join("");

function setDiaryEntries(entries) {
  diaryEntries = entries.filter((entry) => entry.is_owner);
  renderWelcomeCard();
  const lastYear = diaryMonthToday.getFullYear();
  const firstYear = Math.min(
    lastYear - DIARY_YEARS_BACK,
    ...diaryEntries.map((entry) => serverDate(entry.created_at).getFullYear()),
  );
  diaryYearSelect.innerHTML = Array.from(
    { length: lastYear - firstYear + 1 },
    (_, index) => {
      const year = lastYear - index;
      return `<option value="${year}">${year} 年</option>`;
    },
  ).join("");
  renderDiaryMonth();
}

function renderDiaryMonth() {
  diaryYearSelect.value = String(diaryYear);
  diaryMonthSelect.value = String(diaryMonth);
  const lastOption = diaryYearSelect.options[0];
  const firstOption = diaryYearSelect.options[diaryYearSelect.options.length - 1];
  diaryMonthPrev.disabled = diaryMonth === 1 && diaryYear === Number(firstOption?.value);
  diaryMonthNext.disabled = diaryMonth === 12 && diaryYear === Number(lastOption?.value);

  if (!currentUser) {
    diaryMonthCount.textContent = "";
    diaryMonthList.innerHTML = '<p class="diary-month-empty">登入後即可查看你的日記。</p>';
    return;
  }
  const monthEntries = diaryEntries.filter((entry) => {
    const date = serverDate(entry.created_at);
    return date.getFullYear() === diaryYear && date.getMonth() + 1 === diaryMonth;
  });
  diaryMonthCount.textContent = `${monthEntries.length} 篇`;
  diaryMonthList.innerHTML = monthEntries.length
    ? monthEntries
        .map((entry) => {
          const date = serverDate(entry.created_at);
          return `
            <details class="diary-month-entry">
              <summary>
                <time class="diary-month-day" datetime="${escapeHtml(entry.created_at)}">${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}</time>
                <span class="diary-month-entry-title">${escapeHtml(entry.title)}</span>
              </summary>
              <p>${escapeHtml(entry.content)}</p>
              ${entryPhotoHtml(entry)}
              <div class="diary-month-entry-actions">
                <button class="small-action${entryCanBeEdited(entry.created_at) ? "" : " is-locked"}" type="button" data-edit-entry="${Number(entry.id)}" aria-disabled="${!entryCanBeEdited(entry.created_at)}" aria-label="編輯日記：${escapeHtml(entry.title)}" title="${entryCanBeEdited(entry.created_at) ? "編輯日記" : "發布已超過 24 小時，無法變更內容"}">編輯</button>
                <button class="small-action is-destructive" type="button" data-delete-entry="${Number(entry.id)}" aria-label="刪除日記：${escapeHtml(entry.title)}">刪除</button>
              </div>
            </details>
          `;
        })
        .join("")
    : '<p class="diary-month-empty">這個月還沒有日記。</p>';
  warmPhotos(diaryMonthList);
}

function showDiaryMonth(year, month) {
  diaryYear = year;
  diaryMonth = month;
  renderDiaryMonth();
}

function shiftDiaryMonth(offset) {
  const target = new Date(diaryYear, diaryMonth - 1 + offset, 1);
  showDiaryMonth(target.getFullYear(), target.getMonth() + 1);
}

diaryYearSelect.addEventListener("change", () => {
  showDiaryMonth(Number(diaryYearSelect.value), diaryMonth);
});
diaryMonthSelect.addEventListener("change", () => {
  showDiaryMonth(diaryYear, Number(diaryMonthSelect.value));
});
diaryMonthPrev.addEventListener("click", () => shiftDiaryMonth(-1));
diaryMonthNext.addEventListener("click", () => shiftDiaryMonth(1));

setDiaryEntries([]);

// <details> snaps open and shut by itself, so its height is animated here instead.
const DIARY_ENTRY_TOGGLE_MS = 260;
const diaryEntryAnimations = new WeakMap();

function toggleDiaryEntry(entry) {
  const running = diaryEntryAnimations.get(entry);
  // A second tap mid-way turns it around from wherever it has got to.
  const opening = running ? running.closing : !entry.open;
  const from = entry.getBoundingClientRect().height;
  running?.cancel();
  entry.open = true;
  const borders = entry.offsetHeight - entry.clientHeight;
  const to = opening
    ? entry.getBoundingClientRect().height
    : entry.querySelector("summary").offsetHeight + borders;
  entry.style.overflow = "hidden";
  const animation = entry.animate(
    { height: [`${from}px`, `${to}px`] },
    { duration: DIARY_ENTRY_TOGGLE_MS, easing: "cubic-bezier(0.2, 0.75, 0.3, 1)" },
  );
  animation.closing = !opening;
  diaryEntryAnimations.set(entry, animation);
  animation.onfinish = () => {
    diaryEntryAnimations.delete(entry);
    entry.open = opening;
    entry.style.overflow = "";
  };
}

// Whether the entry is open, or on its way to being open.
function diaryEntryIsOpen(entry) {
  const running = diaryEntryAnimations.get(entry);
  return running ? !running.closing : entry.open;
}

// Only one diary is open at a time: opening one folds away the one before.
function closeOtherDiaryEntries(keep, animate) {
  diaryMonthList.querySelectorAll(".diary-month-entry").forEach((other) => {
    if (other === keep) return;
    // One still waiting for its photo won't open after all.
    delete other.dataset.preparing;
    if (!diaryEntryIsOpen(other)) return;
    if (animate) toggleDiaryEntry(other);
    else other.open = false;
  });
}

diaryMonthList.addEventListener("click", async (event) => {
  const summary = event.target.closest("summary");
  if (!summary) return;
  const entry = summary.parentElement;
  const opening = !diaryEntryIsOpen(entry);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    if (opening) closeOtherDiaryEntries(entry, false);
    return;
  }
  event.preventDefault();
  if (opening) closeOtherDiaryEntries(entry, true);
  // Opening waits for the photo, so the entry grows to its full height in one go.
  if (opening && !entry.open && entry.querySelector("img")) {
    if (entry.dataset.preparing) return;
    const request = String(performance.now());
    entry.dataset.preparing = request;
    await photosReady(entry);
    // Another diary was opened meanwhile, or the list was redrawn.
    if (entry.dataset.preparing !== request || !entry.isConnected) return;
    delete entry.dataset.preparing;
    easeInLatePhotos(entry, () => entry.open && !diaryEntryAnimations.get(entry)?.closing);
  }
  toggleDiaryEntry(entry);
});
