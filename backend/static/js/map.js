function renumberRoutePoints() {
  const rows = Array.from(routePointList.querySelectorAll(".route-point-row"));
  rows.forEach((row, index) => {
    const stationNumber = index + 1;
    row.dataset.routeOrder = String(stationNumber);
    row.querySelector("[data-route-point-label]").textContent =
      `第 ${stationNumber} 站`;
    const nameInput = row.querySelector("[data-route-name]");
    const latitudeInput = row.querySelector("[data-route-lat]");
    const longitudeInput = row.querySelector("[data-route-lng]");
    nameInput.setAttribute("aria-label", `第 ${stationNumber} 站地點名稱`);
    latitudeInput.setAttribute("aria-label", `第 ${stationNumber} 站緯度`);
    longitudeInput.setAttribute("aria-label", `第 ${stationNumber} 站經度`);
    row.querySelector("[data-route-remove]").disabled = rows.length <= 1;
  });
  document.querySelector("#route-point-add").disabled = rows.length >= 50;
}

function addRoutePoint(values = {}) {
  if (routePointList.children.length >= 50) return null;
  const row = document.createElement("div");
  row.className = "route-point-row";
  row.innerHTML = `
    <div class="route-point-row-heading">
      <span data-route-point-label></span>
    </div>
    <label class="compact-field">地點名稱
      <input data-route-name maxlength="160" required placeholder="例如：旗津海岸" />
    </label>
    <label class="compact-field">緯度
      <input data-route-lat type="number" step="any" min="-90" max="90" required placeholder="地圖選點或輸入座標" />
    </label>
    <label class="compact-field">經度
      <input data-route-lng type="number" step="any" min="-180" max="180" required placeholder="地圖選點或輸入座標" />
    </label>
    <div class="route-point-row-actions">
      <button class="secondary-button" type="button" data-route-pick>在地圖選點</button>
      <button class="route-point-remove" type="button" data-route-remove>移除此站</button>
    </div>
  `;
  row.querySelector("[data-route-name]").value = values.name || "";
  row.querySelector("[data-route-lat]").value = values.lat ?? "";
  row.querySelector("[data-route-lng]").value = values.lng ?? "";
  routePointList.append(row);
  renumberRoutePoints();
  return row;
}

function resetRoutePoints() {
  routePointList.replaceChildren();
  addRoutePoint();
}

function placePendingRoutePoint(latlng) {
  if (!pickingMapPoint || !pendingMapPickRow) return;
  const latitudeInput = pendingMapPickRow.querySelector("[data-route-lat]");
  const longitudeInput = pendingMapPickRow.querySelector("[data-route-lng]");
  latitudeInput.value = latlng.lat.toFixed(6);
  longitudeInput.value = latlng.lng.toFixed(6);
  const nameInput = pendingMapPickRow.querySelector("[data-route-name]");
  if (!nameInput.value.trim()) nameInput.value = "地圖途經點";
  pickingMapPoint = false;
  pendingMapPickRow = null;
  mapPickBanner.hidden = true;
  mapPointDialog.showModal();
  nameInput.focus();
  document.querySelector("#map-form-status").textContent =
    "已將地圖座標加入所選途經點。";
}

resetRoutePoints();

document.querySelector("#route-point-add").addEventListener("click", () => {
  const row = addRoutePoint();
  row?.querySelector("[data-route-name]").focus();
});

routePointList.addEventListener("click", (event) => {
  const pickButton = event.target.closest("[data-route-pick]");
  if (pickButton) {
    pendingMapPickRow = pickButton.closest(".route-point-row");
    mapPointDialog.close();
    pickingMapPoint = true;
    mapPickBanner.hidden = false;
    return;
  }

  const removeButton = event.target.closest("[data-route-remove]");
  if (!removeButton || routePointList.children.length <= 1) return;
  removeButton.closest(".route-point-row").remove();
  renumberRoutePoints();
});

function initMap() {
  if (map) {
    setTimeout(() => map.invalidateSize(), 100);
    return;
  }
  if (!window.L) {
    document.querySelector("#map-canvas").textContent =
      "地圖服務目前無法載入。你仍可手動輸入座標新增足跡。";
    return;
  }
  map = L.map("map-canvas").setView([23.7, 120.95], 7);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  map.on("click", (event) => {
    placePendingRoutePoint(event.latlng);
  });
}

function footprintRoutePoints(point) {
  if (Array.isArray(point.points) && point.points.length > 0) {
    return point.points
      .filter(
        (routePoint) =>
          Number.isFinite(Number(routePoint.lat)) &&
          Number.isFinite(Number(routePoint.lng)),
      )
      .map((routePoint, index) => ({
        lat: Number(routePoint.lat),
        lng: Number(routePoint.lng),
        name: routePoint.name || point.name,
        order: Number(routePoint.order) || index + 1,
      }))
      .sort((left, right) => left.order - right.order);
  }
  return [
    {
      lat: Number(point.latitude),
      lng: Number(point.longitude),
      name: point.name,
      order: 1,
    },
  ];
}

function mapMarkerIcon(isSelected) {
  return L.divIcon({
    className: "footprint-marker-shell",
    html: `<span class="footprint-marker${isSelected ? " is-selected" : ""}"></span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function updateMapRoute(selectedPoint) {
  if (mapRoute) {
    mapRoute.remove();
    mapRoute = null;
  }
  if (!map || !selectedPoint) return;

  const routePoints = footprintRoutePoints(selectedPoint);
  const coordinates = routePoints.map((routePoint) => [
    routePoint.lat,
    routePoint.lng,
  ]);
  if (coordinates.length > 1) {
    mapRoute = L.polyline(coordinates, {
      color: "#4386d5",
      weight: 4,
      opacity: 0.82,
      dashArray: "8 8",
    }).addTo(map);
  }
  if (coordinates.length > 0) {
    map.fitBounds(L.latLngBounds(coordinates), {
      padding: [36, 36],
      maxZoom: 15,
      animate: true,
    });
  }
}

function selectMapPoint(pointId) {
  const point = mapPoints.find((item) => item.id === pointId);
  if (!point) return;
  selectedMapPointId = point.id;
  renderMapPoints();
  mapPointsContainer
    .querySelector(`[data-map-point="${point.id}"]`)
    ?.focus();
}

function openMapPointEditor(pointId) {
  const point = mapPoints.find(
    (item) => item.id === pointId && item.is_owner,
  );
  if (!point) return;
  editingMapPointId = point.id;
  mapPointForm.reset();
  mapPointForm.elements.name.value = point.name;
  mapPointForm.elements.note.value = point.note || "";
  mapPointForm.elements.privacy.value = point.privacy;
  routePointList.replaceChildren();
  footprintRoutePoints(point).forEach((routePoint) => {
    addRoutePoint(routePoint);
  });
  mapPointDialogTitle.textContent = "編輯足跡行程";
  mapPointSaveButton.textContent = "儲存變更";
  document.querySelector("#map-form-status").textContent = "";
  mapPointDialog.showModal();
  mapPointForm.elements.name.focus();
}

mapPointsContainer.addEventListener("click", (event) => {
  const editButton = event.target.closest("[data-edit-map-point]");
  if (editButton) {
    openMapPointEditor(Number(editButton.dataset.editMapPoint));
    return;
  }
  const button = event.target.closest("[data-map-point]");
  if (!button) return;
  const pointId = Number(button.dataset.mapPoint);
  const isAlreadyExpanded = selectedMapPointId === pointId;
  if (isAlreadyExpanded) {
    selectedMapPointId = null;
    renderMapPoints();
    mapMarkers.get(`${pointId}:1`)?.closePopup();
    mapPointsContainer
      .querySelector(`[data-map-point="${pointId}"]`)
      ?.focus();
    return;
  }
  selectMapPoint(pointId);
});

function renderMapPoints() {
  mapPointCount.textContent = `${mapPoints.length} 趟足跡`;
  if (mapPoints.length === 0) {
    selectedMapPointId = null;
    mapPointsContainer.innerHTML =
      '<div class="module-empty">還沒有足跡行程，按下「＋」開始新增並加入途經點。</div>';
    tripPointOptions.innerHTML =
      '<span class="privacy-note">新增足跡後即可加入行程包。</span>';
  } else {
    mapPointsContainer.innerHTML = mapPoints
      .map(
        (point) => {
          const isSelected = point.id === selectedMapPointId;
          const routePoints = footprintRoutePoints(point);
          return `
          <article class="map-point-card${isSelected ? " is-selected is-expanded" : ""}">
            <button class="map-point-select" type="button" data-map-point="${point.id}" aria-expanded="${isSelected}" aria-controls="map-point-details-${point.id}">
              <span class="map-point-thumb" aria-hidden="true">⌖</span>
              <span class="map-point-summary">
                <time datetime="${escapeHtml(point.created_at || "")}">${escapeHtml(formatDate(point.created_at))}</time>
                <h3>${escapeHtml(point.name)}</h3>
                <p>${escapeHtml(point.owner_name || "我的足跡")} · ${routePoints.length} 個途經點</p>
              </span>
              <span class="map-point-chevron" aria-hidden="true">⌄</span>
            </button>
            <div class="map-point-details" id="map-point-details-${point.id}"${isSelected ? "" : " hidden"}>
              <div class="map-point-photo-placeholder" role="img" aria-label="此足跡沒有已儲存的照片">
                <span aria-hidden="true">▧</span>
                <span>此足跡尚無已儲存的照片</span>
              </div>
              <p>${escapeHtml(point.note || "尚未新增小記。")}</p>
              <ol class="route-stops">
                ${routePoints
                  .map(
                    (routePoint) => `
                      <li>
                        <strong>第 ${routePoint.order} 站：${escapeHtml(routePoint.name)}</strong>
                        <span> · ${routePoint.lat.toFixed(5)}, ${routePoint.lng.toFixed(5)}</span>
                      </li>
                    `,
                  )
                  .join("")}
              </ol>
              <div class="map-point-top">
                <span class="mood">${privacyLabel(point.privacy)}</span>
                <span class="entry-owner">${escapeHtml(point.owner_name || "我的足跡")}</span>
              </div>
              ${
                point.is_owner
                  ? `<div class="map-point-actions">
                      <button class="secondary-button" type="button" data-edit-map-point="${point.id}">編輯這趟足跡</button>
                      <label class="compact-field">隱私層級
                        <select class="privacy-select" data-privacy-point="${point.id}" aria-label="設定 ${escapeHtml(point.name)} 的隱私層級">
                          <option value="private" ${point.privacy === "private" ? "selected" : ""}>私密</option>
                          <option value="friends" ${point.privacy === "friends" ? "selected" : ""}>摯友</option>
                          <option value="public" ${point.privacy === "public" ? "selected" : ""}>公開</option>
                        </select>
                      </label>
                    </div>`
                  : ""
              }
            </div>
          </article>
          `;
        },
      )
      .join("");
    const ownPoints = mapPoints.filter((point) => point.is_owner);
    tripPointOptions.innerHTML = ownPoints.length
      ? ownPoints
          .map(
            (point) => `
          <label>
            <input type="checkbox" value="${point.id}" data-trip-point>
            ${escapeHtml(point.name)}
            <span class="mood">${privacyLabel(point.privacy)}</span>
          </label>
        `,
          )
          .join("")
      : '<span class="privacy-note">新增自己的足跡後即可加入行程包。</span>';
  }

  if (!map || !window.L) return;
  const selectedPoint = mapPoints.find(
    (point) => point.id === selectedMapPointId,
  );
  const activeMarkerKeys = new Set();
  mapPoints.forEach((point) => {
    footprintRoutePoints(point).forEach((routePoint) => {
      const markerKey = `${point.id}:${routePoint.order}`;
      activeMarkerKeys.add(markerKey);
      let marker = mapMarkers.get(markerKey);
      const popupContent = `
        <strong>${escapeHtml(point.name)}</strong><br>
        第 ${routePoint.order} 站：${escapeHtml(routePoint.name)}<br>
        <small>${privacyLabel(point.privacy)}</small>
      `;
      if (!marker) {
        marker = L.marker([routePoint.lat, routePoint.lng], {
          icon: mapMarkerIcon(point.id === selectedMapPointId),
        })
          .addTo(map)
          .bindPopup(popupContent)
          .on("click", (event) => {
            if (pickingMapPoint) {
              placePendingRoutePoint(event.latlng);
            } else {
              selectMapPoint(point.id);
            }
          });
        mapMarkers.set(markerKey, marker);
      } else {
        marker.setLatLng([routePoint.lat, routePoint.lng]);
        marker.setIcon(mapMarkerIcon(point.id === selectedMapPointId));
        marker.setPopupContent(popupContent);
      }
    });
  });
  mapMarkers.forEach((marker, markerKey) => {
    if (activeMarkerKeys.has(markerKey)) return;
    marker.remove();
    mapMarkers.delete(markerKey);
  });
  updateMapRoute(selectedPoint);
}

async function loadMapPoints() {
  mapPointsContainer.innerHTML =
    '<div class="module-empty">正在載入足跡…</div>';
  try {
    mapPoints = await apiRequest("/map-points");
    if (!Array.isArray(mapPoints)) {
      throw new Error("伺服器回傳的足跡資料格式不正確。");
    }
    if (!mapPoints.some((point) => point.id === selectedMapPointId)) {
      selectedMapPointId = null;
    }
    renderMapPoints();
  } catch (error) {
    mapPointCount.textContent = "載入失敗";
    mapPointsContainer.innerHTML =
      `<div class="error-state">${escapeHtml(error.message)}<button class="retry-button" id="retry-map-points" type="button">重新整理</button></div>`;
    document
      .querySelector("#retry-map-points")
      .addEventListener("click", loadMapPoints);
    tripPointOptions.textContent =
      error.status === 401 ? "請先登入以管理足跡。" : "足跡載入失敗。";
  }
}
