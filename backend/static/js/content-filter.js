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
    label: "我的",
    matches: (point) => point.is_owner,
    empty: "你還沒有足跡，按下「新增足跡」開始記錄。",
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
    <button class="content-filter-region-toggle" type="button" aria-expanded="false" aria-controls="${rootId}-region">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>
      <span data-filter-region-label>地區</span>
    </button>
    <div class="content-filter-region" id="${rootId}-region" hidden>
      <select data-filter-city aria-label="${label}：縣市"></select>
      <select data-filter-district aria-label="${label}：區"></select>
    </div>
  `;
  const whoGroup = root.querySelector(".content-filter-who");
  const regionToggle = root.querySelector(".content-filter-region-toggle");
  const regionLabel = root.querySelector("[data-filter-region-label]");
  const regionMenus = root.querySelector(".content-filter-region");
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
    // The menus stay folded away until wanted; the button names the place chosen.
    regionLabel.textContent = city ? (district ? `${city}・${district}` : city) : "地區";
    regionToggle.classList.toggle("is-active", Boolean(city));
  }

  regionToggle.addEventListener("click", () => {
    const open = regionMenus.hidden;
    regionMenus.hidden = !open;
    regionToggle.setAttribute("aria-expanded", String(open));
    if (open) citySelect.focus();
  });

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
