const UNFILED_REGION = "未分類";
const OTHER_DISTRICT = "其他地區";

const FOOTPRINT_WHO = {
  friends: {
    label: "好友",
    matches: (point) => !point.is_owner && point.is_following,
    empty: "還沒有好友的足跡。追蹤朋友後，他們分享的足跡會顯示在這裡。",
  },
  public: {
    label: "公開",
    matches: (point) => point.privacy === "public",
    empty: "還沒有公開的足跡。",
  },
  mine: {
    label: "個人",
    matches: (point) => point.is_owner,
    empty: "你還沒有足跡，按下「＋」開始新增。",
  },
  saved: {
    label: "收藏",
    matches: (point) => point.is_saved,
    empty: "還沒有收藏的足跡。在足跡卡片按下書籤就會存到這裡。",
  },
};

function groupBy(items, keyOf) {
  const groups = new Map();
  items.forEach((item) => {
    const key = keyOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  return groups;
}

function regionOptionsHtml(allLabel, groups, selected) {
  const options = [...groups.entries()]
    .sort(
      ([a], [b]) =>
        (a === UNFILED_REGION) - (b === UNFILED_REGION) ||
        (a === OTHER_DISTRICT) - (b === OTHER_DISTRICT) ||
        a.localeCompare(b, "zh-Hant"),
    )
    .map(
      ([name, group]) =>
        `<option value="${escapeHtml(name)}"${name === selected ? " selected" : ""}>${escapeHtml(name)}（${group.length}）</option>`,
    );
  return [`<option value="">${allLabel}</option>`, ...options].join("");
}

// The 全部/好友/公開/個人 buttons and county/district menus over one list of items.
function createContentFilter({ rootId, label, items, regionOf, who, onChange }) {
  const root = document.querySelector(`#${rootId}`);
  root.innerHTML = `
    <div class="content-filter-who" role="group" aria-label="${label}">
      <button type="button" data-filter-who="all" aria-pressed="true">全部</button>
      ${Object.entries(who)
        .map(
          ([key, option]) =>
            `<button type="button" data-filter-who="${key}" aria-pressed="false">${option.label}</button>`,
        )
        .join("")}
    </div>
    <div class="content-filter-region">
      <select data-filter-city aria-label="${label}：縣市"></select>
      <select data-filter-district aria-label="${label}：區"></select>
    </div>
  `;
  const whoGroup = root.querySelector(".content-filter-who");
  const citySelect = root.querySelector("[data-filter-city]");
  const districtSelect = root.querySelector("[data-filter-district]");
  let whoKey = "all";
  let city = "";
  let district = "";

  const cityOf = (item) => regionOf(item).city || UNFILED_REGION;
  const districtOf = (item) => regionOf(item).district || OTHER_DISTRICT;
  const matchingWho = () =>
    whoKey === "all" ? items() : items().filter(who[whoKey].matches);

  function pressWho() {
    whoGroup.querySelectorAll("[data-filter-who]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.filterWho === whoKey));
    });
  }

  // The choices follow the buttons, so none of them leads to an empty list.
  function refresh() {
    // 好友 and 個人 only mean something to someone who is signed in.
    whoGroup.hidden = !currentUser;
    if (!currentUser && whoKey !== "all") {
      whoKey = "all";
      pressWho();
    }
    root.hidden = items().length === 0;
    const cities = groupBy(matchingWho(), cityOf);
    if (!cities.has(city)) city = "";
    const districts = city ? groupBy(cities.get(city), districtOf) : new Map();
    if (!districts.has(district)) district = "";
    citySelect.innerHTML = regionOptionsHtml("全部縣市", cities, city);
    districtSelect.innerHTML = regionOptionsHtml("全部區", districts, district);
    districtSelect.disabled = !city;
  }

  function setWho(key) {
    whoKey = key;
    pressWho();
    refresh();
    onChange();
  }

  whoGroup.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter-who]");
    if (button) setWho(button.dataset.filterWho);
  });
  citySelect.addEventListener("change", () => {
    city = citySelect.value;
    district = "";
    refresh();
    onChange();
  });
  districtSelect.addEventListener("change", () => {
    district = districtSelect.value;
    refresh();
    onChange();
  });

  return {
    refresh,
    setWho,
    clearRegion() {
      city = "";
      district = "";
    },
    whoKey: () => whoKey,
    city: () => city,
    emptyMessage: () => (whoKey === "all" ? "" : who[whoKey].empty),
    visible: () =>
      matchingWho().filter(
        (item) =>
          (!city || cityOf(item) === city) &&
          (!district || districtOf(item) === district),
      ),
  };
}
