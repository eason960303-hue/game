function checkedTripPointIds() {
  return Array.from(
    tripPointOptions.querySelectorAll("[data-trip-point]:checked"),
    (checkbox) => Number(checkbox.value),
  );
}

function setCheckedTripPoints(pointIds) {
  const selectedIds = new Set(pointIds);
  tripPointOptions.querySelectorAll("[data-trip-point]").forEach((checkbox) => {
    checkbox.checked = selectedIds.has(Number(checkbox.value));
  });
}

const TRIP_WHO = {
  friends: {
    label: "好友",
    matches: (trip) => !trip.is_owner && trip.is_following,
    empty: "追蹤的人還沒有分享行程。",
  },
  public: {
    label: "公開",
    matches: (trip) => !trip.is_owner && trip.privacy === "public",
    empty: "還沒有人公開分享行程。",
  },
  mine: {
    label: "我的",
    matches: (trip) => trip.is_owner,
    empty: "你還沒有行程。把幾趟足跡放在一起，就是一個行程。",
  },
  saved: {
    label: "收藏",
    matches: (trip) => trip.is_saved,
    empty: "還沒有收藏的行程。看到喜歡的玩法，按下收藏就會存到這裡。",
  },
};

// Trips already copied this visit, so the button doesn't invite a duplicate.
const copiedTripIds = new Set();

// Every stop of the trip, in the order you'd travel them.
function tripStops(trip) {
  return trip.points.flatMap((point) =>
    footprintRoutePoints(point)
      .map((stop) => (stop.name || "").trim())
      .filter(Boolean),
  );
}

function tripRegion(trip) {
  return trip.points.length > 0
    ? mapPointRegion(trip.points[0])
    : { city: UNFILED_REGION, district: "" };
}

function tripMatchesSearch(trip, words) {
  if (words.length === 0) return true;
  const text = [
    trip.title,
    trip.description,
    trip.owner_name,
    trip.owner_username,
    ...trip.points.map((point) => point.name),
    ...tripStops(trip),
    ...trip.points.flatMap((point) =>
      footprintRoutePoints(point).flatMap((stop) => [stop.city, stop.district]),
    ),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replaceAll("台", "臺");
  return words.every((word) => text.includes(word));
}

function tripSearchWords() {
  return tripSearchInput.value
    .toLowerCase()
    .replaceAll("台", "臺")
    .split(/\s+/)
    .filter(Boolean);
}

const tripSearchInput = document.querySelector("#trip-search");

const tripsFilter = createContentFilter({
  rootId: "trip-filter",
  label: "篩選行程",
  items: () => trips,
  regionOf: tripRegion,
  who: TRIP_WHO,
  onChange: renderTripList,
});

tripSearchInput.addEventListener("input", renderTripList);

function tripRouteHtml(trip) {
  if (trip.points.length === 0) return '<p class="privacy-note">尚未加入足跡</p>';
  return `
    <ol class="trip-points">
      ${trip.points
        .map((point) => {
          const stops = footprintRoutePoints(point);
          const { city, district } = mapPointRegion(point);
          const place = city === UNFILED_REGION ? "" : `${city}${district}`;
          const route = stops.length > 1 ? stops.map((stop) => stop.name).join(" → ") : "";
          return `
            <li>
              <span class="trip-point-name">${escapeHtml(point.name)}</span>
              ${place ? `<span class="trip-point-place">${escapeHtml(place)}</span>` : ""}
              ${route ? `<span class="trip-point-route">${escapeHtml(route)}</span>` : ""}
            </li>
          `;
        })
        .join("")}
    </ol>
  `;
}

// The same heart and bookmark as on footprints.
function tripReactionsHtml(trip) {
  const likes = Number(trip.like_count) || 0;
  return `
    <div class="footprint-reactions trip-reactions">
      <button class="footprint-reaction is-like" type="button" data-trip-reaction="like" data-trip-id="${trip.id}" aria-pressed="${Boolean(trip.is_liked)}" aria-label="按愛心，目前 ${likes} 個愛心">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5S3.5 15.4 3.5 9.2A4.7 4.7 0 0 1 12 6.5a4.7 4.7 0 0 1 8.5 2.7c0 6.2-8.5 11.3-8.5 11.3z"/></svg>
        <span>${likes}</span>
      </button>
      <button class="footprint-reaction is-save" type="button" data-trip-reaction="save" data-trip-id="${trip.id}" aria-pressed="${Boolean(trip.is_saved)}" aria-label="收藏這個行程">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4.5-6.5 4.5v-16a1 1 0 0 1 1-1z"/></svg>
        <span>${trip.is_saved ? "已收藏" : "收藏"}</span>
      </button>
    </div>
  `;
}

function tripCardHtml(trip) {
  const byline = trip.is_owner
    ? "我的行程"
    : `<a class="trip-owner" href="${escapeHtml(profileHref(trip.owner_username))}">${escapeHtml(trip.owner_name)}</a>`;
  const stopCount = tripStops(trip).length;
  const meetupButton =
    stopCount > 0
      ? `<button class="small-action" type="button" data-meetup-trip="${trip.id}">用這個行程揪團</button>`
      : "";
  const actions = trip.is_owner
    ? `
        <button class="small-action" type="button" data-edit-trip="${trip.id}">編輯</button>
        ${meetupButton}
        <button class="small-action is-destructive" type="button" data-delete-trip="${trip.id}">刪除</button>
      `
    : `
        ${meetupButton}
        ${
          trip.points.length > 0
            ? copiedTripIds.has(trip.id)
              ? '<button class="small-action" type="button" disabled>已新增至足跡</button>'
              : `<button class="small-action" type="button" data-copy-trip="${trip.id}">新增至足跡</button>`
            : ""
        }
        ${
          trip.points.length > 0
            ? `<button class="small-action" type="button" data-view-trip-point="${trip.points[0].id}">在足跡查看</button>`
            : ""
        }
      `;
  return `
    <article class="trip-card${trip.is_owner ? " is-mine" : ""}">
      <div class="trip-card-top">
        <div>
          <h3>${escapeHtml(trip.title)}</h3>
          <p class="trip-byline">${byline} · ${trip.points.length} 個足跡${stopCount > trip.points.length ? `、${stopCount} 站` : ""}</p>
        </div>
        ${trip.is_owner ? privacyChipHtml(trip.privacy) : ""}
      </div>
      ${trip.description ? `<p class="trip-description">${escapeHtml(trip.description)}</p>` : ""}
      ${tripRouteHtml(trip)}
      <div class="trip-actions">${tripReactionsHtml(trip)}${actions}</div>
      <p class="trip-use-count">${
        trip.use_count
          ? `此行程已被使用 ${trip.use_count} 次`
          : "此行程還沒有被使用過"
      }</p>
    </article>
  `;
}

function renderTripList() {
  const words = tripSearchWords();
  const shown = tripsFilter.visible().filter((trip) => tripMatchesSearch(trip, words));
  if (shown.length > 0) {
    tripList.innerHTML = shown.map(tripCardHtml).join("");
    return;
  }
  const message = words.length
    ? "找不到符合的行程，換個關鍵字試試。"
    : tripsFilter.emptyMessage() || "這裡還沒有行程。";
  tripList.innerHTML =
    tripsFilter.whoKey() === "mine" && !words.length
      ? emptyStateHtml("module-empty", message, "建立行程", "new-trip")
      : `<div class="module-empty">${escapeHtml(message)}</div>`;
}

function renderTrips() {
  tripFormOpenButton.hidden = !tripForm.hidden;
  if (trips.length === 0) {
    tripsFilter.refresh();
    tripSearchInput.closest(".trip-search").hidden = true;
    tripList.innerHTML = emptyStateHtml(
      "module-empty",
      "還沒有可以參考的行程。把幾趟足跡放在一起，就是你的第一個行程。",
      "建立行程",
      "new-trip",
    );
    return;
  }
  tripSearchInput.closest(".trip-search").hidden = false;
  tripsFilter.refresh();
  renderTripList();
}

async function loadTrips() {
  const load = beginListLoad(
    tripList,
    sessionOwner(),
    '<div class="module-empty">正在載入行程…</div>',
  );
  try {
    const loadedTrips = await apiRequest("/trips/feed");
    if (!load.isCurrent()) return;
    trips = loadedTrips;
    renderTrips();
  } catch (error) {
    if (!load.isCurrent()) return;
    forgetListLoad(tripList);
    tripList.innerHTML =
      `<div class="error-state">${escapeHtml(error.message)}<button class="retry-button" id="retry-trips" type="button">重新整理</button></div>`;
    document
      .querySelector("#retry-trips")
      .addEventListener("click", loadTrips);
  }
}
