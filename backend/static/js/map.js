const ROUTE_SUGGEST_DELAY_MS = 400;

function routeRows() {
  return Array.from(routePointList.querySelectorAll(".route-point-row"));
}

function renumberRoutePoints() {
  const rows = routeRows();
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
  if (coordinates.city) row.dataset.city = coordinates.city;
  if (coordinates.district) row.dataset.district = coordinates.district;
  row.querySelector("[data-route-located]").hidden = false;
}

function rowRoutePoint(row) {
  return {
    name: row.querySelector("[data-route-name]").value.trim(),
    lat: row.dataset.lat ?? null,
    lng: row.dataset.lng ?? null,
  };
}

function clearRowCheck(row) {
  delete row.dataset.checkedName;
  const check = row.querySelector("[data-route-check]");
  check.hidden = true;
  check.replaceChildren();
}

function routeCheckHint(text) {
  const hint = document.createElement("p");
  hint.className = "privacy-note";
  hint.textContent = text;
  return hint;
}

function routeMapFrame(row) {
  const frame = createEmbeddedMapFrame();
  frame.src = embeddedPlaceUrl(routePointQuery(rowRoutePoint(row)));
  return frame;
}

function routeCheckButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "map-text-button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function showRowCheck(row, ...children) {
  const check = row.querySelector("[data-route-check]");
  check.replaceChildren(...children);
  check.hidden = false;
}

// A stop without coordinates can't be verified here, so the person checks it by eye.
function showRowPreview(row, message = "") {
  const located = hasCoordinates(rowRoutePoint(row));
  showRowCheck(
    row,
    routeMapFrame(row),
    routeCheckHint(
      located
        ? "這一站已鎖定座標。"
        : `${message}請確認地圖上有紅色標記，而且位置正確。如果只看到海面或山區、沒有標記，就是 Google 沒找到，請加上縣市或路名再確認一次。`,
    ),
  );
}

function placeLabel(place) {
  return (place.address ? `${place.name}（${place.address}）` : place.name).slice(
    0,
    160,
  );
}

function osmCredit(lookup) {
  return lookup.source === "photon"
    ? [routeCheckHint("地點資料 © OpenStreetMap 貢獻者")]
    : [];
}

function showRowCandidates(row, lookup, query, message) {
  const list = document.createElement("div");
  list.className = "route-point-candidates";
  lookup.places.forEach((place) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "route-point-candidate";
    const name = document.createElement("strong");
    name.textContent = place.name;
    const address = document.createElement("span");
    address.textContent = place.address || "";
    option.append(name, address);
    option.addEventListener("click", () => {
      choosePlace(row, place, lookup, query);
    });
    list.append(option);
  });
  const actions = document.createElement("div");
  actions.className = "route-point-check-actions";
  actions.append(
    routeCheckButton("都不是，保留我打的文字", () => keepTypedText(row, query)),
  );
  showRowCheck(row, routeCheckHint(message), list, actions, ...osmCredit(lookup));
}

function keepTypedText(row, query) {
  row.querySelector("[data-route-name]").value = query;
  clearRowCoordinates(row);
  row.dataset.checkedName = query;
  showRowPreview(row);
}

function choosePlace(row, place, lookup, query) {
  row.querySelector("[data-route-name]").value = placeLabel(place);
  clearRowCoordinates(row);
  setRowCoordinates(row, {
    lat: place.latitude,
    lng: place.longitude,
    city: place.city,
    district: place.district,
  });
  const actions = document.createElement("div");
  actions.className = "route-point-check-actions";
  if (lookup.places.length > 1) {
    actions.append(
      routeCheckButton("改選其他地點", () => {
        showRowCandidates(row, lookup, query, "選一個正確的地點。");
      }),
    );
  }
  actions.append(
    routeCheckButton("保留我打的文字", () => keepTypedText(row, query)),
  );
  showRowCheck(
    row,
    routeCheckHint(`已選擇「${place.name}」。`),
    routeMapFrame(row),
    actions,
    ...osmCredit(lookup),
  );
}

// Other stops on this trip are the best clue to which same-named place is meant.
function routeSearchCenter(row) {
  const rows = routeRows();
  const index = rows.indexOf(row);
  const neighbours = [
    ...rows.slice(0, index).reverse(),
    ...rows.slice(index + 1),
  ].map(rowRoutePoint);
  const saved = mapPoints.flatMap(footprintRoutePoints);
  const known = [...neighbours, ...saved].find(hasCoordinates);
  return known
    ? { latitude: Number(known.lat), longitude: Number(known.lng) }
    : null;
}

function lookupPlaces(row, query) {
  const previous = rowLookups.get(row);
  if (previous?.query === query) return previous.result;
  const result = apiRequest(
    "/maps/lookup",
    jsonOptions("POST", { query, center: routeSearchCenter(row) }),
  );
  rowLookups.set(row, { query, result });
  result.catch(() => rowLookups.delete(row));
  return result;
}

function rowIsUnchecked(row) {
  const routePoint = rowRoutePoint(row);
  return (
    !hasCoordinates(routePoint) && row.dataset.checkedName !== routePoint.name
  );
}

function rowNeedsPlace(row) {
  return rowRoutePoint(row).name && rowIsUnchecked(row);
}

// Lists the addresses a typed keyword could mean. Returns whether there were any.
// While typing (quiet), a failed search is left for leaving the field to report.
async function offerRowPlaces(row, { quiet = false } = {}) {
  if (!rowNeedsPlace(row)) return true;
  const query = rowRoutePoint(row).name;
  let lookup;
  try {
    lookup = await lookupPlaces(row, query);
  } catch {
    if (!quiet && rowRoutePoint(row).name === query) {
      showRowPreview(row, "地點搜尋暫時無法使用。");
    }
    return false;
  }
  // The person may have typed on, or picked an address, while this was running.
  if (!rowNeedsPlace(row) || rowRoutePoint(row).name !== query) return true;
  if (lookup.places.length) {
    showRowCandidates(
      row,
      lookup,
      query,
      lookup.places[0].matched
        ? "請點選正確的地址。"
        : "沒有完全相符的地點，請看看有沒有正確的選項，或把名稱寫得更完整。",
    );
    return true;
  }
  if (!quiet) showRowPreview(row, "沒有找到相符的地點。");
  return false;
}

async function checkRowLocation(button) {
  const row = button.closest(".route-point-row");
  const nameInput = row.querySelector("[data-route-name]");
  const query = nameInput.value.trim();
  if (!query) {
    nameInput.focus();
    return;
  }
  if (!rowNeedsPlace(row)) {
    showRowPreview(row);
    return;
  }
  button.disabled = true;
  const found = await offerRowPlaces(row);
  button.disabled = false;
  // Nothing to choose from, so the map they just looked at is the check.
  if (!found && rowRoutePoint(row).name === query) row.dataset.checkedName = query;
}

function clearRowCoordinates(row) {
  delete row.dataset.lat;
  delete row.dataset.lng;
  delete row.dataset.city;
  delete row.dataset.district;
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
      <input data-route-name maxlength="160" required placeholder="例如：旗津海岸公園、信義區鼎泰豐" />
    </label>
    <p class="privacy-note route-point-located" data-route-located hidden>已鎖定座標，修改名稱後要重新選擇地址。</p>
    <div class="route-point-check" data-route-check hidden></div>
    <div class="route-point-row-actions">
      <button class="secondary-button" type="button" data-route-confirm>確認位置</button>
      <button class="secondary-button" type="button" data-route-locate>使用目前位置</button>
      <button class="secondary-button" type="button" data-route-pick>在地圖選點</button>
      <button class="route-point-remove" type="button" data-route-remove>移除此站</button>
    </div>
  `;
  row.querySelector("[data-route-name]").value = values.name || "";
  if (hasCoordinates(values)) setRowCoordinates(row, values);
  // Stops that were already saved don't need checking again unless they change.
  if (values.name) row.dataset.checkedName = values.name;
  routePointList.append(row);
  renumberRoutePoints();
  return row;
}

function resetRoutePoints() {
  uncheckedRouteWarning = "";
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
  if (!nameInput.value.trim()) nameInput.value = placeName || "地圖上的地點";
  resumeMapPointForm();
  nameInput.focus();
  document.querySelector("#map-form-status").textContent =
    "已將地圖座標加入這一站。";
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

routePointList.addEventListener("focusout", (event) => {
  if (!event.target.matches("[data-route-name]")) return;
  window.clearTimeout(routeSuggestTimer);
  offerRowPlaces(event.target.closest(".route-point-row"));
});

// Keeps the field focused: leaving it redraws the options under the tap.
routePointList.addEventListener("mousedown", (event) => {
  if (event.target.closest("[data-route-check] button")) event.preventDefault();
});

routePointList.addEventListener("input", (event) => {
  if (event.target.matches("[data-route-name]")) {
    const row = event.target.closest(".route-point-row");
    clearRowCoordinates(row);
    window.clearTimeout(routeSuggestTimer);
    const typing = event.target.value.trim().length >= 2;
    // Options stay up until the new ones arrive, so the form doesn't jump per keystroke.
    if (typing && row.querySelector(".route-point-candidates")) {
      delete row.dataset.checkedName;
    } else {
      clearRowCheck(row);
    }
    if (typing) {
      routeSuggestTimer = window.setTimeout(
        () => offerRowPlaces(row, { quiet: true }),
        ROUTE_SUGGEST_DELAY_MS,
      );
    }
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
  const confirmButton = event.target.closest("[data-route-confirm]");
  if (confirmButton) {
    checkRowLocation(confirmButton);
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

function embeddedPlaceUrl(query) {
  const params = new URLSearchParams({
    hl: "zh-TW",
    output: "embed",
    q: query,
    z: "15",
  });
  return `https://www.google.com/maps?${params}`;
}

function embeddedMapUrl(selectedPoint) {
  const routePoints = selectedPoint ? footprintRoutePoints(selectedPoint) : [];
  const params = new URLSearchParams({ hl: "zh-TW", output: "embed" });
  if (routePoints.length > 1) {
    params.set("saddr", routePointQuery(routePoints[0]));
    params.set("daddr", routePoints.slice(1).map(routePointQuery).join(" to:"));
  } else if (routePoints.length === 1) {
    return embeddedPlaceUrl(routePointQuery(routePoints[0]));
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
          reject(new Error("地圖暫時無法使用。"));
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
        city: routePoint.city || null,
        district: routePoint.district || null,
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
            strokeColor: "#af4526",
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
    mapPointDetailAnimations.delete(details);
  }
  if (!isExpanded && details.hidden) return;

  // Padding and the border animate with the height. A border-box element can't get
  // shorter than them, so otherwise it stalls short of 0 and then jumps when hidden.
  const styles = window.getComputedStyle(details);
  const start = details.hidden
    ? { height: 0, opacity: 0, paddingBottom: 0, borderTopWidth: 0 }
    : {
        height: details.getBoundingClientRect().height,
        opacity: Number.parseFloat(styles.opacity),
        paddingBottom: Number.parseFloat(styles.paddingBottom),
        borderTopWidth: Number.parseFloat(styles.borderTopWidth),
      };
  const clearInlineStyles = () => {
    ["height", "opacity", "overflow", "padding-bottom", "border-top-width"].forEach(
      (property) => details.style.removeProperty(property),
    );
  };

  details.style.transition = "none";
  if (isExpanded) {
    details.hidden = false;
    clearInlineStyles();
  }
  const endHeight = isExpanded ? details.getBoundingClientRect().height : 0;
  details.style.height = `${start.height}px`;
  details.style.opacity = String(start.opacity);
  details.style.paddingBottom = `${start.paddingBottom}px`;
  details.style.borderTopWidth = `${start.borderTopWidth}px`;
  details.style.overflow = "hidden";
  details.getBoundingClientRect();
  details.style.removeProperty("transition");

  const finish = () => {
    const animation = mapPointDetailAnimations.get(details);
    if (!animation || animation.isExpanded !== isExpanded) return;
    details.removeEventListener("transitionend", animation.onTransitionEnd);
    window.clearTimeout(animation.timeoutId);
    mapPointDetailAnimations.delete(details);
    if (!isExpanded) details.hidden = true;
    clearInlineStyles();
    if (embeddedMapUpdatePending && mapPointDetailAnimations.size === 0) {
      embeddedMapUpdatePending = false;
      updateEmbeddedMap();
    }
  };
  const onTransitionEnd = (event) => {
    if (event.target === details && event.propertyName === "height") finish();
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
    details.style.height = `${endHeight}px`;
    details.style.opacity = isExpanded ? "1" : "0";
    if (isExpanded) {
      details.style.removeProperty("padding-bottom");
      details.style.removeProperty("border-top-width");
    } else {
      details.style.paddingBottom = "0px";
      details.style.borderTopWidth = "0px";
    }
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
  mapPointDialogTitle.textContent = isEditing ? "編輯足跡" : "新增足跡";
  document.querySelector("#map-point-dialog-description").textContent = isEditing
    ? "修改內容、調整站點順序，或刪除這趟足跡。"
    : "照順序記下這趟走過的地方，一站也可以。";
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
  mapPointForm.elements.privacy.value = appSetting("footprintPrivacy");
  resetRoutePoints();
  editingMapPointId = null;
  setMapPointDialogMode(false);
  stopMapPick();
  showMapPointDialog();
}

// Deletes straight from the card, without opening the editor first.
async function deleteFootprint(pointId) {
  const point = mapPoints.find(
    (item) => item.id === pointId && item.is_owner,
  );
  if (!point) return;
  if (
    !window.confirm(
      `確定要刪除「${point.name}」嗎？也會從行程中移除，刪除後無法復原。`,
    )
  ) {
    return;
  }
  try {
    await apiRequest(`/map-points/${pointId}`, { method: "DELETE" });
    privacyDrafts.delete(pointId);
    if (selectedMapPointId === pointId) selectedMapPointId = null;
    if (editingMapPointId === pointId) {
      editingMapPointId = null;
      mapPointDialog.close();
    }
    await loadMapPoints();
  } catch (error) {
    showToast(`刪除足跡失敗：${error.message}`);
  }
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

async function removeMapPointCover(button) {
  const pointId = Number(button.dataset.removeMapCover);
  const status = mapPointsContainer.querySelector(
    `[data-map-cover-status="${pointId}"]`,
  );
  button.disabled = true;
  status.textContent = "正在移除圖片…";
  try {
    await apiRequest(`/map-points/${pointId}/cover`, { method: "DELETE" });
    applyMapPointCover(pointId, null, "圖片已移除。");
  } catch (error) {
    status.textContent = error.message || "移除圖片失敗，請稍後再試。";
    button.disabled = false;
  }
}

mapPointsContainer.addEventListener("click", (event) => {
  const editButton = event.target.closest("[data-edit-map-point]");
  if (editButton) {
    openMapPointEditor(Number(editButton.dataset.editMapPoint));
    return;
  }
  const deleteButton = event.target.closest("[data-delete-map-point]");
  if (deleteButton) {
    deleteFootprint(Number(deleteButton.dataset.deleteMapPoint));
    return;
  }
  const removeCoverButton = event.target.closest("[data-remove-map-cover]");
  if (removeCoverButton) {
    removeMapPointCover(removeCoverButton);
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

function mapPointCoverHtml(point) {
  const coverUrl = mediaUrl(point.cover_url);
  const media = coverUrl
    ? `<img class="map-point-cover" src="${escapeHtml(coverUrl)}" alt="${escapeHtml(point.name)}的圖片" loading="lazy" decoding="async" />`
    : "";
  if (!point.is_owner) return media;
  return `
    ${media || '<div class="map-point-photo-placeholder"><span aria-hidden="true">▧</span><span>還沒有圖片</span></div>'}
    <div class="profile-footprint-cover-actions">
      <label class="small-action profile-cover-upload">
        ${coverUrl ? "更換圖片" : "新增圖片"}
        <input class="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" data-map-cover-upload="${Number(point.id)}" />
      </label>
      ${coverUrl ? `<button class="small-action is-destructive" type="button" data-remove-map-cover="${Number(point.id)}">移除圖片</button>` : ""}
      <span class="privacy-note" data-map-cover-status="${Number(point.id)}" role="status">圖片會顯示在足跡列表與個人檔案，最大 25 MB。</span>
    </div>
  `;
}

function mapPointCardHtml(point) {
  const isSelected = point.id === selectedMapPointId;
  const coverUrl = mediaUrl(point.cover_url);
  const routePoints = footprintRoutePoints(point);
  return `
  <article class="map-point-card${isSelected ? " is-selected is-expanded" : ""}">
    <button class="map-point-select" type="button" data-map-point="${point.id}" aria-expanded="${isSelected}" aria-controls="map-point-details-${point.id}">
      <span class="map-point-thumb" aria-hidden="true">${coverUrl ? `<img src="${escapeHtml(coverUrl)}" alt="" loading="lazy" decoding="async" />` : "⌖"}</span>
      <span class="map-point-summary">
        <time datetime="${escapeHtml(point.created_at || "")}">${escapeHtml(formatDate(point.created_at))}</time>
        <h3>${escapeHtml(point.name)}</h3>
        <p>${routePoints.length} 站</p>
      </span>
      <span class="map-point-chevron" aria-hidden="true">⌄</span>
    </button>
    <div class="map-point-author">${ownerLink(point, "其他使用者")}</div>
    <div class="map-point-details" id="map-point-details-${point.id}"${isSelected ? "" : " hidden"}>
      ${mapPointCoverHtml(point)}
              <p>${escapeHtml(point.note || "尚未新增小記")}</p>
      <ol class="route-stops">
        ${routePoints
          .map(
            (routePoint) => `
              <li>
                <strong>第 ${routePoint.order} 站：${escapeHtml(routePoint.name)}</strong>
              </li>
            `,
          )
          .join("")}
      </ol>
      <button class="secondary-button map-point-directions" type="button" data-google-route-navigation="${Number(point.id)}">前往 Google 導航</button>
      <div class="map-point-top">
        <span class="mood is-${escapeHtml(point.privacy)}" data-privacy-badge="point:${Number(point.id)}">${privacyLabel(point.privacy)}</span>
      </div>
      ${footprintReactionsHtml(point)}
      ${
        point.is_owner
          ? `<div class="map-point-actions">
              <button class="secondary-button" type="button" data-edit-map-point="${point.id}">編輯這趟足跡</button>
              <button class="small-action is-destructive" type="button" data-delete-map-point="${point.id}">刪除</button>
              <label class="compact-field">隱私層級
                ${privacySelectHtml(point.id, point.name, point.privacy)}
              </label>
            </div>`
          : ""
      }
    </div>
  </article>
  `;
}

// Redraws only this card, so the other cards and their photos stay as they are.
function applyMapPointCover(pointId, coverUrl, message) {
  const point = mapPoints.find((item) => item.id === pointId);
  const card = mapPointsContainer
    .querySelector(`[data-map-point="${pointId}"]`)
    ?.closest(".map-point-card");
  if (!point || !card) return;
  point.cover_url = coverUrl;
  card.outerHTML = mapPointCardHtml(point);
  mapPointsContainer.querySelector(
    `[data-map-cover-status="${pointId}"]`,
  ).textContent = message;
}

mapPointsContainer.addEventListener("change", async (event) => {
  const input = event.target.closest("[data-map-cover-upload]");
  const [file] = input?.files || [];
  if (!input || !file) return;
  const pointId = Number(input.dataset.mapCoverUpload);
  const status = mapPointsContainer.querySelector(
    `[data-map-cover-status="${pointId}"]`,
  );
  input.disabled = true;
  status.textContent = "正在處理圖片…";
  try {
    const coverUrl = await uploadFootprintCover(pointId, file);
    applyMapPointCover(pointId, coverUrl, "圖片已更新。");
  } catch (error) {
    status.textContent = error.message || "圖片上傳失敗，請稍後再試。";
    input.disabled = false;
    input.value = "";
  }
});

const mapPointsFilter = createContentFilter({
  rootId: "map-point-filter",
  label: "篩選足跡",
  items: () => mapPoints,
  regionOf: mapPointRegion,
  who: FOOTPRINT_WHO,
  onChange() {
    // The map shouldn't keep showing a footprint that just left the list.
    if (
      !mapPointsFilter.visible().some((point) => point.id === selectedMapPointId)
    ) {
      selectedMapPointId = null;
    }
    renderMapPoints();
  },
});

function mapPointRegion(point) {
  // A trip is filed under where it starts, wherever its later stops are.
  const [start] = footprintRoutePoints(point);
  return {
    city: start?.city || UNFILED_REGION,
    district: start?.district || "",
  };
}

function mapPointGroupsHtml() {
  const cities = groupBy(
    mapPointsFilter.visible(),
    (point) => mapPointRegion(point).city,
  );
  const names = [...cities.keys()].sort(
    (a, b) => (a === UNFILED_REGION) - (b === UNFILED_REGION),
  );
  return names
    .map((city) => {
      const points = cities.get(city);
      const districts = groupBy(points, (point) => mapPointRegion(point).district);
      const isOpen =
        mapPointsFilter.city() ||
        !closedMapRegions.has(city) ||
        points.some((point) => point.id === selectedMapPointId);
      const named = [...districts.keys()].some(Boolean);
      const groups = [...districts.entries()]
        .sort(([a], [b]) => (a === "") - (b === ""))
        .map(
          ([district, districtPoints]) => `
            <div class="map-district">
              ${named ? `<p class="map-district-name">${escapeHtml(district || OTHER_DISTRICT)}<span>${districtPoints.length}</span></p>` : ""}
              ${districtPoints.map(mapPointCardHtml).join("")}
            </div>
          `,
        )
        .join("");
      const unfiledHint =
        city === UNFILED_REGION
          ? '<p class="privacy-note">這些足跡的起點還沒有地區。編輯足跡並點選起點的地址後，就會歸到縣市和區。</p>'
          : "";
      return `
        <details class="map-region" data-map-region="${escapeHtml(city)}"${isOpen ? " open" : ""}>
          <summary><span>${escapeHtml(city)}</span><span class="map-region-count">${points.length}</span></summary>
          ${unfiledHint}${groups}
        </details>
      `;
    })
    .join("");
}

// toggle doesn't bubble, so it has to be caught on the way down.
mapPointsContainer.addEventListener(
  "toggle",
  (event) => {
    const city = event.target.dataset?.mapRegion;
    if (!city) return;
    if (event.target.open) closedMapRegions.delete(city);
    else closedMapRegions.add(city);
  },
  true,
);

function renderMapPoints() {
  renderWelcomeCard();
  mapPointsFilter.refresh();
  mapPointCount.textContent = `${mapPointsFilter.visible().length} 趟足跡`;
  if (mapPoints.length === 0) {
    selectedMapPointId = null;
    mapPointsContainer.innerHTML = emptyStateHtml(
      "module-empty",
      "還沒有足跡，記下你的第一趟出遊吧。",
      "新增足跡",
      "new-footprint",
    );
    tripPointOptions.innerHTML =
      '<span class="privacy-note">新增足跡後即可加入行程。</span>';
  } else {
    mapPointsContainer.innerHTML =
      mapPointGroupsHtml() ||
      `<div class="module-empty">${mapPointsFilter.emptyMessage()}</div>`;
    const ownPoints = mapPoints.filter((point) => point.is_owner);
    const checkedPointIds = checkedTripPointIds();
    tripPointOptions.innerHTML = ownPoints.length
      ? ownPoints
          .map(
            (point) => `
          <label>
            <input type="checkbox" value="${point.id}" data-trip-point>
            ${escapeHtml(point.name)}
            <span class="mood is-${escapeHtml(point.privacy)}" data-privacy-badge="point:${Number(point.id)}">${privacyLabel(point.privacy)}</span>
          </label>
        `,
          )
          .join("")
      : '<span class="privacy-note">新增自己的足跡後即可加入行程。</span>';
    setCheckedTripPoints(checkedPointIds);
  }

  renderMapMarkers();
}

function renderMapMarkers() {
  if (!map) {
    // Changing the iframe reloads Google's whole map, which makes a running card
    // animation stutter, so it waits until the card has settled.
    if (mapPointDetailAnimations.size > 0) embeddedMapUpdatePending = true;
    else updateEmbeddedMap();
    return;
  }
  const selectedPoint = mapPoints.find(
    (point) => point.id === selectedMapPointId,
  );
  const activeMarkerKeys = new Set();
  mapPointsFilter.visible().forEach((point) => {
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
    renderTimelineFootprints();
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
  if (event.target.closest("[data-timeline-show-more]")) {
    timelineFootprintsShown += FOOTPRINT_PAGE_SIZE;
    renderTimelineFootprints();
    return;
  }
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

