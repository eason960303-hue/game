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
                <time class="diary-month-day" datetime="${escapeHtml(entry.created_at)}">${date.getMonth() + 1}/${date.getDate()}</time>
                <span class="diary-month-entry-title">${escapeHtml(entry.title)}</span>
              </summary>
              <p>${escapeHtml(entry.content)}</p>
            </details>
          `;
        })
        .join("")
    : '<p class="diary-month-empty">這個月還沒有日記。</p>';
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
