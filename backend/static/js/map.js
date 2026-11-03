function renumberRoutePoints() {
  const rows = Array.from(routePointList.querySelectorAll(".route-point-row"));
  rows.forEach((row, index) => {
    const stationNumber = index + 1;
    row.dataset.routeOrder = String(stationNumber);
    row.querySelector("[data-route-point-label]").textContent =
      `第 ${stationNumber} 站`;
    const nameInput = row.querySelector("[data-route-name]");
    nameInput.setAttribute("aria-label", `第 ${stationNumber} 站地點名稱或地址`);
    row.querySelector("[data-route-remove]").disabled = rows.length <= 1;
    row.querySelector('[data-route-move="up"]').disabled = index === 0;
    row.querySelector('[data-route-move="down"]').disabled =
      index === rows.length - 1;
    // Google's embedded map cannot report where it was clicked.
    row.querySelector("[data-route-pick]").hidden = !map;
  });
  document.querySelector("#route-point-add").disabled = rows.length >= 50;
}

function hasCoordinates(routePoint) {
  return (
    routePoint.lat !== null &&
    routePoint.lat !== undefined &&
    routePoint.lat !== "" &&
    Number.isFinite(Number(routePoint.lat)) &&
    routePoint.lng !== null &&
    routePoint.lng !== undefined &&
    routePoint.lng !== "" &&
    Number.isFinite(Number(routePoint.lng))
  );
}

// What Google is asked to find: exact coordinates when known, otherwise the text.
function routePointQuery(routePoint) {
  return hasCoordinates(routePoint)
    ? `${routePoint.lat},${routePoint.lng}`
    : routePoint.name;
}

function setRowCoordinates(row, coordinates) {
  row.dataset.lat = String(coordinates.lat);
  row.dataset.lng = String(coordinates.lng);
  row.querySelector("[data-route-located]").hidden = false;
}

function clearRowCoordinates(row) {
  delete row.dataset.lat;
  delete row.dataset.lng;
  row.querySelector("[data-route-located]").hidden = true;
}

function addRoutePoint(values = {}) {
  if (routePointList.children.length >= 50) return null;
  const row = document.createElement("div");
  row.className = "route-point-row";
  row.innerHTML = `
    <div class="route-point-row-heading">
      <span data-route-point-label></span>
      <span class="route-point-move">
        <button class="secondary-button" type="button" data-route-move="up" aria-label="往前移一站" title="往前移一站">↑</button>
        <button class="secondary-button" type="button" data-route-move="down" aria-label="往後移一站" title="往後移一站">↓</button>
      </span>
    </div>
    <label class="compact-field">地點名稱或地址
      <input data-route-name maxlength="160" required placeholder="例如：旗津海岸公園、高雄市旗津區旗津三路" />
    </label>
    <p class="privacy-note route-point-located" data-route-located hidden>已定位，修改名稱後會改用名稱搜尋地點。</p>
    <div class="route-point-row-actions">
      <button class="secondary-button" type="button" data-route-locate>使用目前位置</button>
      <button class="secondary-button" type="button" data-route-pick>在地圖選點</button>
      <button class="route-point-remove" type="button" data-route-remove>移除此站</button>
    </div>
  `;
  row.querySelector("[data-route-name]").value = values.name || "";
  if (hasCoordinates(values)) setRowCoordinates(row, values);
  routePointList.append(row);
  renumberRoutePoints();
  return row;
}

function resetRoutePoints() {
  routePointList.replaceChildren();
  addRoutePoint();
}

function placePendingRoutePoint(latlng, placeName = "") {
  if (!pickingMapPoint || !pendingMapPickRow) return;
  setRowCoordinates(pendingMapPickRow, {
    lat: latlng.lat.toFixed(6),
    lng: latlng.lng.toFixed(6),
  });
  const nameInput = pendingMapPickRow.querySelector("[data-route-name]");
  if (!nameInput.value.trim()) nameInput.value = placeName || "地圖途經點";
  resumeMapPointForm();
  nameInput.focus();
  document.querySelector("#map-form-status").textContent =
    "已將地圖座標加入所選途經點。";
}

resetRoutePoints();

document.querySelector("#route-point-add").addEventListener("click", () => {
  const row = addRoutePoint();
  row?.querySelector("[data-route-name]").focus();
});

async function fillRowWithCurrentLocation(button) {
  const row = button.closest(".route-point-row");
  const status = document.querySelector("#map-form-status");
  button.disabled = true;
  status.textContent = "正在取得目前位置…";
  try {
    const { lat, lng } = await currentCoordinates();
    setRowCoordinates(row, { lat: lat.toFixed(6), lng: lng.toFixed(6) });
    const nameInput = row.querySelector("[data-route-name]");
    if (!nameInput.value.trim()) nameInput.value = "目前位置";
    status.textContent = "";
    nameInput.focus();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function moveRoutePoint(button) {
  const row = button.closest(".route-point-row");
  const direction = button.dataset.routeMove;
  if (direction === "up") {
    row.previousElementSibling?.before(row);
  } else {
    row.nextElementSibling?.after(row);
  }
  renumberRoutePoints();
  // The pressed button is disabled at either end, which would drop keyboard focus.
  const focusTarget = button.disabled
    ? row.querySelector("[data-route-move]:not(:disabled)")
    : button;
  focusTarget?.focus();
}

routePointList.addEventListener("input", (event) => {
  if (event.target.matches("[data-route-name]")) {
    clearRowCoordinates(event.target.closest(".route-point-row"));
  }
});

routePointList.addEventListener("click", (event) => {
  const moveButton = event.target.closest("[data-route-move]");
  if (moveButton) {
    moveRoutePoint(moveButton);
    return;
  }
  const locateButton = event.target.closest("[data-route-locate]");
  if (locateButton) {
    fillRowWithCurrentLocation(locateButton);
    return;
  }
  const pickButton = event.target.closest("[data-route-pick]");
  if (pickButton) {
    startMapPick(pickButton.closest(".route-point-row"));
    return;
  }

  const removeButton = event.target.closest("[data-route-remove]");
  if (!removeButton || routePointList.children.length <= 1) return;
  removeButton.closest(".route-point-row").remove();
  renumberRoutePoints();
});

function embeddedMapUrl(selectedPoint) {
  const routePoints = selectedPoint ? footprintRoutePoints(selectedPoint) : [];
  const params = new URLSearchParams({ hl: "zh-TW", output: "embed" });
  if (routePoints.length > 1) {
    params.set("saddr", routePointQuery(routePoints[0]));
    params.set("daddr", routePoints.slice(1).map(routePointQuery).join(" to:"));
  } else if (routePoints.length === 1) {
    params.set("q", routePointQuery(routePoints[0]));
    params.set("z", "15");
  } else {
    params.set("ll", "23.7,120.95");
    params.set("z", "7");
  }
  return `https://www.google.com/maps?${params}`;
}

const MAP_FRAME_DRAW_MS = 700;
const MAP_FRAME_FADE_MS = 200;

function createEmbeddedMapFrame() {
  const frame = document.createElement("iframe");
  frame.title = "Google 地圖";
  frame.loading = "lazy";
  frame.referrerPolicy = "strict-origin";
  return frame;
}

// A cross-origin map can't move without reloading, so the new one loads behind
// the current one and only takes over once it has had time to draw.
function updateEmbeddedMap() {
  const canvas = document.querySelector("#map-canvas");
  // The last settled frame is the live one; an older one may still be fading out.
  const shown = [...canvas.querySelectorAll("iframe:not(.is-loading)")].pop();
  if (!shown) return;
  const url = embeddedMapUrl(
    mapPoints.find((point) => point.id === selectedMapPointId),
  );
  const loading = canvas.querySelector("iframe.is-loading");
  if (loading?.getAttribute("src") === url) return;
  loading?.remove();
  if (shown.getAttribute("src") === url) return;
  // Nothing is on screen to protect while the map is hidden or opening for the first time.
  if (mapView.hidden || !shown.hasAttribute("src")) {
    shown.setAttribute("src", url);
    return;
  }
  const next = createEmbeddedMapFrame();
  next.className = "is-loading";
  next.setAttribute("src", url);
  next.addEventListener("load", () => {
    window.setTimeout(() => {
      if (!next.isConnected) return;
      next.classList.remove("is-loading");
      window.setTimeout(() => shown.remove(), MAP_FRAME_FADE_MS);
    }, MAP_FRAME_DRAW_MS);
  });
  canvas.append(next);
}

// Google's iframe map needs no key, so the page still shows a real map without one.
function showMapUnavailable() {
  map = null;
  document.querySelector("#map-canvas").replaceChildren(createEmbeddedMapFrame());
  updateEmbeddedMap();
  mapPanel.classList.remove("map-ready");
  mapPanel.classList.add("map-unavailable");
}

function loadGoogleMaps() {
  googleMapsLoad ??= apiRequest("/maps/config").then(
    (config) =>
      new Promise((resolve, reject) => {
        if (!config.api_key) {
          reject(new Error("地圖尚未設定 GOOGLE_MAPS_API_KEY。"));
          return;
        }
        window.onGoogleMapsReady = () => resolve(config);
        window.gm_authFailure = () => showMapUnavailable();
        const params = new URLSearchParams({
          key: config.api_key,
          v: "weekly",
          loading: "async",
          language: "zh-TW",
          region: "TW",
          callback: "onGoogleMapsReady",
        });
        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
        script.async = true;
        script.onerror = () => reject(new Error("地圖服務目前無法載入。"));
        document.head.append(script);
      }),
  );
  return googleMapsLoad;
}

async function initMap() {
  if (map || document.querySelector("#map-canvas iframe")) return;
  try {
    const config = await loadGoogleMaps();
    if (map) return;
    const { Map: GoogleMap, InfoWindow } =
      await google.maps.importLibrary("maps");
    await google.maps.importLibrary("marker");
    map = new GoogleMap(document.querySelector("#map-canvas"), {
      center: { lat: 23.7, lng: 120.95 },
      zoom: 7,
      mapId: config.map_id,
      gestureHandling: "greedy",
      streetViewControl: true,
      scaleControl: true,
      rotateControl: true,
      // The panel's own buttons replace these so the tools stay visible.
      mapTypeControl: false,
      fullscreenControl: false,
    });
    mapInfoWindow = new InfoWindow();
    map.addListener("click", handleMapClick);
    map.addListener("contextmenu", handleMapContextMenu);
    initMapTools();
    renderMapMarkers();
  } catch {
    googleMapsLoad = null;
    showMapUnavailable();
  }
}

function footprintRoutePoints(point) {
  if (Array.isArray(point.points) && point.points.length > 0) {
    return point.points
      .map((routePoint, index) => ({
        lat: hasCoordinates(routePoint) ? Number(routePoint.lat) : null,
        lng: hasCoordinates(routePoint) ? Number(routePoint.lng) : null,
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

function mapMarkerContent(isSelected, order) {
  const shell = document.createElement("div");
  shell.className = "footprint-marker-shell";
  const dot = document.createElement("div");
  dot.className = `footprint-marker${isSelected ? " is-numbered" : ""}`;
  if (isSelected) dot.textContent = String(order);
  shell.append(dot);
  return shell;
}

function updateMapRoute(selectedPoint) {
  if (mapRoute) {
    mapRoute.setMap(null);
    mapRoute = null;
  }
  if (!map || !selectedPoint) return;

  const coordinates = footprintRoutePoints(selectedPoint)
    .filter(hasCoordinates)
    .map((routePoint) => ({
      lat: routePoint.lat,
      lng: routePoint.lng,
    }));
  if (coordinates.length > 1) {
    mapRoute = new google.maps.Polyline({
      map,
      path: coordinates,
      strokeOpacity: 0,
      icons: [
        {
          icon: {
            path: "M 0,-1 0,1",
            strokeColor: "#4386d5",
            strokeOpacity: 0.82,
            scale: 3,
          },
          offset: "0",
          repeat: "16px",
        },
      ],
    });
    const bounds = new google.maps.LatLngBounds();
    coordinates.forEach((coordinate) => bounds.extend(coordinate));
    map.fitBounds(bounds, { top: 72, right: 48, bottom: 48, left: 48 });
  } else if (coordinates.length === 1) {
    map.panTo(coordinates[0]);
    map.setZoom(15);
  }
}

function startMapPick(row) {
  pendingMapPickRow = row;
  mapPickReturnScrollY = window.scrollY;
  mapPointDialog.close();
  pickingMapPoint = true;
  mapPickBanner.hidden = false;
  // The form can also open from the trips view, where the map is hidden.
  if (mapView.hidden) {
    applyView("map");
    window.scrollTo(0, 0);
  }
}

function stopMapPick() {
  pickingMapPoint = false;
  pendingMapPickRow = null;
  mapPickBanner.hidden = true;
}

function resumeMapPointForm() {
  stopMapPick();
  // Picking never changes the URL, so it still names the view the form came from.
  applyViewFromUrl();
  window.scrollTo(0, mapPickReturnScrollY);
  mapPointDialog.showModal();
}

function setMapCardExpanded(pointId, isExpanded) {
  const button = mapPointsContainer.querySelector(`[data-map-point="${pointId}"]`);
  if (!button) return;
  const card = button.closest(".map-point-card");
  const details = card.querySelector(".map-point-details");
  card.classList.toggle("is-selected", isExpanded);
  card.classList.toggle("is-expanded", isExpanded);
  button.setAttribute("aria-expanded", String(isExpanded));
  const previous = mapPointDetailAnimations.get(details);
  if (previous) {
    details.removeEventListener("transitionend", previous.onTransitionEnd);
    window.clearTimeout(previous.timeoutId);
  }

  const startHeight = details.hidden
    ? 0
    : details.getBoundingClientRect().height;
  const startOpacity = details.hidden
    ? 0
    : Number.parseFloat(window.getComputedStyle(details).opacity);
  if (isExpanded) details.hidden = false;
  details.style.height = `${startHeight}px`;
  details.style.opacity = String(startOpacity);
  details.style.overflow = "hidden";
  details.getBoundingClientRect();

  const finish = () => {
    const animation = mapPointDetailAnimations.get(details);
    if (!animation || animation.isExpanded !== isExpanded) return;
    details.removeEventListener("transitionend", animation.onTransitionEnd);
    window.clearTimeout(animation.timeoutId);
    mapPointDetailAnimations.delete(details);
    if (!isExpanded) details.hidden = true;
    details.style.removeProperty("height");
    details.style.removeProperty("opacity");
    details.style.removeProperty("overflow");
  };
  const onTransitionEnd = (event) => {
    if (event.propertyName === "height") finish();
  };
  const timeoutId = window.setTimeout(finish, 700);
  mapPointDetailAnimations.set(details, {
    isExpanded,
    onTransitionEnd,
    timeoutId,
  });
  details.addEventListener("transitionend", onTransitionEnd);
  window.requestAnimationFrame(() => {
    if (card.classList.contains("is-expanded") !== isExpanded) return;
    const borderHeight =
      Number.parseFloat(window.getComputedStyle(details).borderTopWidth) || 0;
    details.style.height = isExpanded
      ? `${details.scrollHeight + borderHeight}px`
      : "0px";
    details.style.opacity = isExpanded ? "1" : "0";
  });
}

function selectMapPoint(pointId) {
  const point = mapPoints.find((item) => item.id === pointId);
  if (!point) return;
  if (point.id !== selectedMapPointId) {
    flushPrivacyDrafts();
    setMapCardExpanded(selectedMapPointId, false);
  }
  selectedMapPointId = point.id;
  if (map) clearMapSheet();
  setMapCardExpanded(point.id, true);
  renderMapMarkers();
  mapPointsContainer
    .querySelector(`[data-map-point="${point.id}"]`)
    ?.focus();
}

function setMapPointDialogMode(isEditing) {
  mapPointDialogTitle.textContent = isEditing ? "編輯足跡行程" : "新增足跡行程";
  document.querySelector("#map-point-dialog-description").textContent = isEditing
    ? "修改內容、調整站點順序，或刪除這趟足跡。"
    : "新增多個途經點，並依照站序記錄旅遊動線。";
  mapPointSaveButton.textContent = isEditing ? "儲存變更" : "儲存足跡";
  document.querySelector("#map-point-delete").hidden = !isEditing;
}

function mapPointFormSnapshot() {
  return JSON.stringify([
    mapPointForm.elements.name.value,
    mapPointForm.elements.note.value,
    mapPointForm.elements.privacy.value,
    Array.from(
      routePointList.querySelectorAll(".route-point-row"),
      (row) => [row.querySelector("[data-route-name]").value, row.dataset.lat],
    ),
  ]);
}

function closeMapPointDialog() {
  if (
    mapPointFormSnapshot() !== savedMapPointForm &&
    !window.confirm("要放棄尚未儲存的修改嗎？")
  ) {
    return;
  }
  stopMapPick();
  editingMapPointId = null;
  addingFootprintToTripForm = false;
  mapPointDialog.close();
}

function showMapPointDialog() {
  document.querySelector("#map-form-status").textContent = "";
  savedMapPointForm = mapPointFormSnapshot();
  mapPointDialog.showModal();
  mapPointForm.elements.name.focus();
}

function openNewMapPointDialog(addToTripForm = false) {
  if (!currentUser) {
    openLoginDialog();
    return;
  }
  addingFootprintToTripForm = addToTripForm;
  mapPointForm.reset();
  resetRoutePoints();
  editingMapPointId = null;
  setMapPointDialogMode(false);
  stopMapPick();
  showMapPointDialog();
}

function openMapPointEditor(pointId) {
  const point = mapPoints.find(
    (item) => item.id === pointId && item.is_owner,
  );
  if (!point) return;
  addingFootprintToTripForm = false;
  editingMapPointId = point.id;
  mapPointForm.reset();
  mapPointForm.elements.name.value = point.name;
  mapPointForm.elements.note.value = point.note || "";
  mapPointForm.elements.privacy.value = point.privacy;
  routePointList.replaceChildren();
  footprintRoutePoints(point).forEach((routePoint) => {
    addRoutePoint(routePoint);
  });
  setMapPointDialogMode(true);
  showMapPointDialog();
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
    flushPrivacyDrafts();
    selectedMapPointId = null;
    setMapCardExpanded(pointId, false);
    renderMapMarkers();
    mapInfoWindow?.close();
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
                        ${hasCoordinates(routePoint) ? `<span> · ${routePoint.lat.toFixed(5)}, ${routePoint.lng.toFixed(5)}</span>` : ""}
                      </li>
                    `,
                  )
                  .join("")}
              </ol>
              <button class="secondary-button map-point-directions" type="button" data-google-route-navigation="${Number(point.id)}">前往 Google 導航</button>
              <div class="map-point-top">
                <span class="mood" data-privacy-badge="point:${Number(point.id)}">${privacyLabel(point.privacy)}</span>
                ${ownerLink(point, "我的足跡")}
              </div>
              ${
                point.is_owner
                  ? `<div class="map-point-actions">
                      <button class="secondary-button" type="button" data-edit-map-point="${point.id}">編輯這趟足跡</button>
                      <label class="compact-field">隱私層級
                        ${privacySelectHtml("data-privacy-point", point.id, point.name, point.privacy)}
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
    const checkedPointIds = checkedTripPointIds();
    tripPointOptions.innerHTML = ownPoints.length
      ? ownPoints
          .map(
            (point) => `
          <label>
            <input type="checkbox" value="${point.id}" data-trip-point>
            ${escapeHtml(point.name)}
            <span class="mood" data-privacy-badge="point:${Number(point.id)}">${privacyLabel(point.privacy)}</span>
          </label>
        `,
          )
          .join("")
      : '<span class="privacy-note">新增自己的足跡後即可加入行程包。</span>';
    setCheckedTripPoints(checkedPointIds);
  }

  renderMapMarkers();
}

function renderMapMarkers() {
  if (!map) {
    updateEmbeddedMap();
    return;
  }
  const selectedPoint = mapPoints.find(
    (point) => point.id === selectedMapPointId,
  );
  const activeMarkerKeys = new Set();
  mapPoints.forEach((point) => {
    footprintRoutePoints(point).filter(hasCoordinates).forEach((routePoint) => {
      const markerKey = `${point.id}:${routePoint.order}`;
      activeMarkerKeys.add(markerKey);
      let marker = mapMarkers.get(markerKey);
      const position = { lat: routePoint.lat, lng: routePoint.lng };
      if (!marker) {
        marker = new google.maps.marker.AdvancedMarkerElement({
          map,
          gmpClickable: true,
        });
        marker.addEventListener("gmp-click", () => {
          const { point, routePoint } = marker.footprint;
          if (pickingMapPoint) {
            placePendingRoutePoint({ lat: routePoint.lat, lng: routePoint.lng });
            return;
          }
          selectMapPoint(point.id);
          mapInfoWindow.setContent(`
            <div class="footprint-popup">
              <strong>${escapeHtml(point.name)}</strong><br>
              第 ${routePoint.order} 站：${escapeHtml(routePoint.name)}<br>
              <small>${privacyLabel(point.privacy)}</small>
              <button class="map-google-navigation" type="button" data-google-navigation data-navigation-lat="${routePoint.lat}" data-navigation-lng="${routePoint.lng}">前往 Google 導航</button>
            </div>
          `);
          mapInfoWindow.open({ map, anchor: marker });
        });
        mapMarkers.set(markerKey, marker);
      }
      marker.footprint = { point, routePoint };
      marker.position = position;
      marker.title = `${point.name}：${routePoint.name}`;
      marker.content = mapMarkerContent(point.id === selectedMapPointId, routePoint.order);
    });
  });
  mapMarkers.forEach((marker, markerKey) => {
    if (activeMarkerKeys.has(markerKey)) return;
    marker.map = null;
    mapMarkers.delete(markerKey);
  });
  updateMapRoute(selectedPoint);
}

async function loadMapPoints() {
  const load = beginListLoad(
    mapPointsContainer,
    sessionOwner(),
    '<div class="module-empty">正在載入足跡…</div>',
  );
  try {
    await privacySavesFinished();
    const points = await apiRequest("/map-points");
    if (!load.isCurrent()) return;
    if (!Array.isArray(points)) {
      throw new Error("伺服器回傳的足跡資料格式不正確。");
    }
    mapPoints = withPrivacyDrafts(points);
    if (!mapPoints.some((point) => point.id === selectedMapPointId)) {
      selectedMapPointId = null;
    }
    renderTimelineFootprints(mapPoints);
    renderMapPoints();
  } catch (error) {
    if (!load.isCurrent()) return;
    forgetListLoad(mapPointsContainer);
    mapPointCount.textContent = "載入失敗";
    timelineFootprints.innerHTML = `<div class="error-state">${escapeHtml(error.message)}<button class="retry-button" type="button" data-retry-timeline-footprints>重新整理</button></div>`;
    mapPointsContainer.innerHTML =
      `<div class="error-state">${escapeHtml(error.message)}<button class="retry-button" id="retry-map-points" type="button">重新整理</button></div>`;
    document
      .querySelector("#retry-map-points")
      .addEventListener("click", loadMapPoints);
    tripPointOptions.textContent =
      error.status === 401 ? "請先登入以管理足跡。" : "足跡載入失敗。";
  }
}

timelineFootprints.addEventListener("click", (event) => {
  const button = event.target.closest("[data-timeline-map-point]");
  if (button) {
    selectedMapPointId = Number(button.dataset.timelineMapPoint);
    document.querySelector('[data-view="map"]').click();
    clearMapSheet();
    return;
  }
  if (event.target.closest("[data-retry-timeline-footprints]")) {
    loadMapPoints();
  }
});
