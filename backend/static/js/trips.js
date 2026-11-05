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

function renderTrips() {
  tripFormOpenButton.hidden = trips.length === 0 || !tripForm.hidden;
  if (trips.length === 0) {
    tripFormOpenButton.hidden = true;
    tripList.innerHTML = emptyStateHtml(
      "module-empty",
      "還沒有行程。把幾趟足跡放在一起，就是一個行程。",
      "建立行程",
      "new-trip",
    );
    return;
  }
  tripList.innerHTML = trips
    .map(
      (trip) => `
        <article class="trip-card">
          <div class="trip-card-top">
            <div>
              <h3>${escapeHtml(trip.title)}</h3>
              <p>${trip.description ? `${escapeHtml(trip.description)} · ` : ""}${trip.points.length} 個足跡</p>
            </div>
            ${trip.is_public ? privacyChipHtml("public", "公開分享") : privacyChipHtml("private", "私人行程")}
          </div>
          <ol class="trip-points">
            ${trip.points.map((point) => `<li>${escapeHtml(point.name)} · ${privacyLabel(point.privacy)}</li>`).join("") || "<li>尚未加入足跡</li>"}
          </ol>
          <div class="trip-actions">
            <button class="small-action" type="button" data-edit-trip="${trip.id}">編輯</button>
            ${
              trip.is_public
                ? `<button class="small-action" type="button" data-share-trip="${trip.id}">複製公開分享連結</button>`
                : ""
            }
            <button class="small-action is-destructive" type="button" data-delete-trip="${trip.id}">刪除</button>
          </div>
        </article>
      `,
    )
    .join("");
}

async function loadTrips() {
  const load = beginListLoad(
    tripList,
    sessionOwner(),
    '<div class="module-empty">正在載入行程…</div>',
  );
  try {
    const loadedTrips = await apiRequest("/trips");
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
