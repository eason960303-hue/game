function renderTrips() {
  if (trips.length === 0) {
    tripList.innerHTML =
      '<div class="module-empty">尚未建立行程包，從左側表單開始規劃。</div>';
    return;
  }
  tripList.innerHTML = trips
    .map(
      (trip) => `
        <article class="trip-card">
          <div class="trip-card-top">
            <div>
              <h3>${escapeHtml(trip.title)}</h3>
              <p>${escapeHtml(trip.description || "尚未新增行程簡介")} · ${trip.points.length} 個足跡</p>
            </div>
            <span class="mood">${trip.is_public ? "公開分享" : "私人行程"}</span>
          </div>
          <ol class="trip-points">
            ${trip.points.map((point) => `<li>${escapeHtml(point.name)} · ${privacyLabel(point.privacy)}</li>`).join("") || "<li>尚未加入足跡</li>"}
          </ol>
          ${
            trip.is_public
              ? `<div class="trip-actions"><button class="small-action" type="button" data-share-trip="${trip.id}">複製公開分享連結</button></div>`
              : ""
          }
        </article>
      `,
    )
    .join("");
}

async function loadTrips() {
  tripList.innerHTML = '<div class="module-empty">正在載入行程…</div>';
  try {
    trips = await apiRequest("/trips");
    renderTrips();
  } catch (error) {
    tripList.innerHTML =
      `<div class="error-state">${escapeHtml(error.message)}<button class="retry-button" id="retry-trips" type="button">重新整理</button></div>`;
    document
      .querySelector("#retry-trips")
      .addEventListener("click", loadTrips);
  }
}
