const mapSearchForm = document.querySelector("#map-search-form");
const mapSearchInput = document.querySelector("#map-search-input");
const mapSuggestions = document.querySelector("#map-suggestions");
const mapSearchArea = document.querySelector("#map-search-area");
const mapResults = document.querySelector("#map-results");
const mapPlaceCard = document.querySelector("#map-place");
const mapDirectionsForm = document.querySelector("#map-directions-form");
const mapDirectionStops = document.querySelector("#map-direction-stops");
const mapDirectionSuggestions = document.querySelector(
  "#map-direction-suggestions",
);
const mapDirectionsStatus = document.querySelector("#map-directions-status");
const mapRouteList = document.querySelector("#map-route-list");
const mapContextMenu = document.querySelector("#map-context-menu");
const mapMeasure = document.querySelector("#map-measure");
const mapMeasureText = document.querySelector("#map-measure-text");
const mapLayersMenu = document.querySelector("#map-layers-menu");
const mapLayersToggle = document.querySelector("#map-layers-toggle");

const PLACE_DETAIL_FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "viewport",
  "rating",
  "userRatingCount",
  "photos",
  "reviews",
  "regularOpeningHours",
  "businessStatus",
  "utcOffsetMinutes",
  "nationalPhoneNumber",
  "websiteURI",
  "googleMapsURI",
  "editorialSummary",
];
const ROUTE_FIELDS = [
  "path",
  "legs",
  "description",
  "distanceMeters",
  "durationMillis",
];
const SEARCH_DEBOUNCE_MS = 250;
const RECENT_SEARCHES_KEY = "life-logger-recent-map-searches";
const MAX_RECENT_SEARCHES = 6;
const MAX_PLACE_PHOTOS = 6;
// Google allows nine stops in a Maps URL, so the in-app limit matches it.
const MAX_INTERMEDIATE_STOPS = 9;
const EARTH_RADIUS_METERS = 6371008.8;

const mapLayers = {};
let placesLibrary = null;
let autocompleteToken = null;
let searchDebounce = null;
let latestSuggestionRequest = 0;
let latestPlaceRequest = 0;
let currentPlace = null;
let lastSearchQuery = "";
let cameFromResults = false;
let placeMarkers = [];
let myLocationMarker = null;
let shownRoutes = [];
let routeLines = [];
let routeStopMarkers = [];
let selectedRouteIndex = 0;
let routeRequest = null;
let measureMarkers = [];
let measureLine = null;
let isMeasuring = false;

function toLatLngLiteral(position) {
  return typeof position.lat === "function"
    ? { lat: position.lat(), lng: position.lng() }
    : { lat: Number(position.lat), lng: Number(position.lng) };
}

function coordinateText({ lat, lng }) {
  return `${lat.toFixed(6)},${lng.toFixed(6)}`;
}

function googleNavigationUrl(destination) {
  let query = "";
  if (typeof destination === "string") {
    query = destination.trim();
  } else if (destination && typeof destination === "object") {
    const coordinates = toLatLngLiteral(destination);
    if (
      Number.isFinite(coordinates.lat) &&
      Number.isFinite(coordinates.lng)
    ) {
      query = `${coordinates.lat},${coordinates.lng}`;
    }
  }
  if (!query) return null;
  const params = new URLSearchParams({
    api: "1",
    destination: query,
    travelmode: "driving",
    dir_action: "navigate",
  });
  return `https://www.google.com/maps/dir/?${params}`;
}

function openGoogleNavigation(destination) {
  const url = googleNavigationUrl(destination);
  if (!url) return false;
  const opened = window.open(url, "_blank");
  if (!opened) return false;
  opened.opener = null;
  return true;
}

function safeWebUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function footprintDirectionsUrl(routePoints) {
  if (routePoints.length === 1) {
    return googleNavigationUrl(routePointQuery(routePoints[0]));
  }
  const params = new URLSearchParams({
    api: "1",
    origin: routePointQuery(routePoints[0]),
    destination: routePointQuery(routePoints[routePoints.length - 1]),
    travelmode: "driving",
    dir_action: "navigate",
  });
  const waypoints = routePoints.slice(1, -1).slice(0, MAX_INTERMEDIATE_STOPS);
  if (waypoints.length > 0) {
    params.set("waypoints", waypoints.map(routePointQuery).join("|"));
  }
  return `https://www.google.com/maps/dir/?${params}`;
}

function initMapTools() {
  mapPanel.classList.add("map-ready");
  mapPanel.classList.remove("map-unavailable");
  resetDirectionStops();
  map.addListener("dragend", offerSearchArea);
  map.addListener("zoom_changed", offerSearchArea);
}

function closeSheetPanels() {
  mapResults.hidden = true;
  mapPlaceCard.hidden = true;
  mapDirectionsForm.hidden = true;
  mapSearchArea.hidden = true;
  latestPlaceRequest += 1;
}

// Focusing a footprint hands the map over from any open search or route.
function clearMapSheet() {
  closeDirections();
  clearPlaceMarkers();
}

function clearPlaceMarkers() {
  placeMarkers.forEach((marker) => {
    marker.map = null;
  });
  placeMarkers = [];
}

function addPlaceMarker(position, title, onClick) {
  const marker = new google.maps.marker.AdvancedMarkerElement({
    map,
    position,
    title,
    gmpClickable: true,
  });
  if (onClick) marker.addEventListener("gmp-click", onClick);
  placeMarkers.push(marker);
  return marker;
}

function hideSuggestions() {
  mapSuggestions.hidden = true;
  mapSuggestions.replaceChildren();
}

async function getPlacesLibrary() {
  placesLibrary ??= await google.maps.importLibrary("places");
  return placesLibrary;
}

// --- Search ---

function readRecentSearches() {
  try {
    const saved = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY));
    return Array.isArray(saved) ? saved.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function rememberSearch(query) {
  const recent = [query, ...readRecentSearches().filter((item) => item !== query)];
  try {
    localStorage.setItem(
      RECENT_SEARCHES_KEY,
      JSON.stringify(recent.slice(0, MAX_RECENT_SEARCHES)),
    );
  } catch {
    // Recent searches are a convenience; private windows may block storage.
  }
}

function suggestionItem(label, onSelect, className = "") {
  const item = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onSelect);
  item.append(button);
  return item;
}

function showRecentSearches() {
  mapSuggestions.replaceChildren(
    ...readRecentSearches().map((query) =>
      suggestionItem(
        query,
        () => {
          mapSearchInput.value = query;
          searchPlaces(query);
        },
        "is-recent",
      ),
    ),
  );
  mapSuggestions.hidden = mapSuggestions.children.length === 0;
}

async function fetchPlaceSuggestions(input) {
  const { AutocompleteSessionToken, AutocompleteSuggestion } =
    await getPlacesLibrary();
  autocompleteToken ??= new AutocompleteSessionToken();
  const { suggestions } =
    await AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input,
      sessionToken: autocompleteToken,
      locationBias: map.getBounds(),
      language: "zh-TW",
      region: "tw",
    });
  return suggestions
    .map((suggestion) => suggestion.placePrediction)
    .filter(Boolean);
}

async function updateSuggestions() {
  const input = mapSearchInput.value.trim();
  const requestId = ++latestSuggestionRequest;
  if (!input) {
    showRecentSearches();
    return;
  }
  try {
    const predictions = await fetchPlaceSuggestions(input);
    if (requestId !== latestSuggestionRequest) return;
    mapSuggestions.replaceChildren(
      ...predictions.map((prediction) =>
        suggestionItem(prediction.text.toString(), () =>
          openSuggestion(prediction),
        ),
      ),
    );
    mapSuggestions.hidden = mapSuggestions.children.length === 0;
  } catch (error) {
    console.warn("Place suggestions failed", error);
    hideSuggestions();
  }
}

function openSuggestion(placePrediction) {
  const text = placePrediction.text.toString();
  mapSearchInput.value = text;
  rememberSearch(text);
  latestSuggestionRequest += 1;
  hideSuggestions();
  // Fetching the details ends the billing session the token belongs to.
  autocompleteToken = null;
  clearPlaceMarkers();
  cameFromResults = false;
  showPlaceDetails(placePrediction.toPlace(), { fit: true });
}

async function searchPlaces(textQuery, { inView = false } = {}) {
  latestSuggestionRequest += 1;
  hideSuggestions();
  closeSheetPanels();
  clearPlaceMarkers();
  rememberSearch(textQuery);
  lastSearchQuery = textQuery;
  mapResults.hidden = false;
  mapResults.textContent = "搜尋中…";
  try {
    const { Place } = await getPlacesLibrary();
    const { places } = await Place.searchByText({
      textQuery,
      fields: [
        "id",
        "displayName",
        "formattedAddress",
        "location",
        "rating",
        "userRatingCount",
      ],
      locationBias: map.getBounds(),
      maxResultCount: 20,
      language: "zh-TW",
      region: "tw",
    });
    renderSearchResults(places, inView);
  } catch (error) {
    console.warn("Place search failed", error);
    mapResults.textContent = "搜尋失敗，請確認 Places API (New) 已啟用。";
  }
}

function offerSearchArea() {
  if (mapResults.hidden || !lastSearchQuery) return;
  mapSearchArea.hidden = false;
}

function placeRatingText(place) {
  return place.rating
    ? `★ ${place.rating.toFixed(1)}（${place.userRatingCount ?? 0}）`
    : "";
}

function renderSearchResults(places, inView) {
  if (places.length === 0) {
    mapResults.textContent = "找不到符合的地點。";
    return;
  }
  const bounds = new google.maps.LatLngBounds();
  const list = document.createElement("ul");
  places.forEach((place) => {
    const open = () => {
      cameFromResults = places.length > 1;
      showPlaceDetails(place);
    };
    const name = String(place.displayName ?? "");
    addPlaceMarker(place.location, name, open);
    bounds.extend(place.location);

    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `
      <strong>${escapeHtml(name)}</strong>
      <small>${escapeHtml(placeRatingText(place))}</small>
      <span>${escapeHtml(place.formattedAddress ?? "")}</span>
    `;
    button.addEventListener("click", open);
    item.append(button);
    list.append(item);
  });
  mapResults.replaceChildren(list);
  if (places.length === 1) {
    cameFromResults = false;
    showPlaceDetails(places[0], { fit: true });
  } else if (!inView) {
    map.fitBounds(bounds, 48);
  }
}

// --- Place details ---

async function showPlaceDetails(place, { fit = false } = {}) {
  closeSheetPanels();
  const requestId = latestPlaceRequest;
  mapPlaceCard.hidden = false;
  mapPlaceCard.textContent = "正在載入地點資訊…";
  try {
    await place.fetchFields({ fields: PLACE_DETAIL_FIELDS });
    if (requestId !== latestPlaceRequest) return;
    let isOpen = null;
    try {
      isOpen = (await place.isOpen()) ?? null;
    } catch {
      // Places without opening hours cannot answer; the card omits the badge.
    }
    if (requestId !== latestPlaceRequest) return;
    const location = toLatLngLiteral(place.location);
    if (!cameFromResults) {
      clearPlaceMarkers();
      addPlaceMarker(location, String(place.displayName ?? ""));
    }
    if (fit) {
      if (place.viewport) map.fitBounds(place.viewport);
      else map.panTo(location);
    } else {
      map.panTo(location);
    }
    renderPlaceCard({
      name: String(place.displayName ?? ""),
      address: place.formattedAddress,
      location,
      summary: place.editorialSummary,
      rating: placeRatingText(place),
      isOpen,
      hours: place.regularOpeningHours?.weekdayDescriptions ?? [],
      phone: place.nationalPhoneNumber,
      website: place.websiteURI,
      googleMapsUrl: place.googleMapsURI,
      photos: (place.photos ?? []).slice(0, MAX_PLACE_PHOTOS),
      reviews: place.reviews ?? [],
    });
  } catch (error) {
    console.warn("Place details failed", error);
    if (requestId === latestPlaceRequest) {
      mapPlaceCard.textContent = "無法載入地點資訊。";
    }
  }
}

function attributionLink(author) {
  const authorUrl = safeWebUrl(author?.uri);
  const name = escapeHtml(author?.displayName ?? "");
  return authorUrl
    ? `<a href="${escapeHtml(authorUrl)}" target="_blank" rel="noopener">${name}</a>`
    : name;
}

function placePhotosHtml(place) {
  if (place.photos.length === 0) return "";
  return `
    <div class="map-place-photos">
      ${place.photos
        .map(
          (photo) => `
            <figure>
              <img src="${escapeHtml(photo.getURI({ maxWidth: 640 }))}" alt="${escapeHtml(place.name)}的照片" loading="lazy" />
              <figcaption>${(photo.authorAttributions ?? []).map(attributionLink).join("、")}</figcaption>
            </figure>
          `,
        )
        .join("")}
    </div>
  `;
}

function placeReviewsHtml(place) {
  if (place.reviews.length === 0) return "";
  return `
    <section class="map-place-reviews">
      <h4>評論</h4>
      ${place.reviews
        .map(
          (review) => `
            <blockquote>
              <header>
                ${attributionLink(review.authorAttribution)}
                <small>${review.rating ? `★ ${escapeHtml(review.rating)}` : ""} ${escapeHtml(review.relativePublishTimeDescription ?? "")}</small>
              </header>
              <p>${escapeHtml(review.text ?? "")}</p>
            </blockquote>
          `,
        )
        .join("")}
    </section>
  `;
}

function renderPlaceCard(place) {
  currentPlace = place;
  const websiteUrl = place.website && safeWebUrl(place.website);
  const openBadge =
    place.isOpen === null
      ? ""
      : `<span class="${place.isOpen ? "is-open" : "is-closed"}">${place.isOpen ? "營業中" : "休息中"}</span>`;
  mapPlaceCard.innerHTML = `
    ${placePhotosHtml(place)}
    <div class="map-place-heading">
      ${cameFromResults ? '<button class="map-tool-icon" type="button" data-place-back aria-label="返回搜尋結果">←</button>' : ""}
      <h3>${escapeHtml(place.name)}</h3>
      <button class="map-tool-icon" type="button" data-place-close aria-label="關閉地點資訊">×</button>
    </div>
    ${place.rating || openBadge ? `<p class="map-place-meta">${escapeHtml(place.rating)} ${openBadge}</p>` : ""}
    <div class="map-place-actions">
      <button class="is-primary" type="button" data-place-directions><span>↱</span>路線</button>
      <button type="button" data-place-footprint><span>＋</span>加入足跡</button>
      <button type="button" data-place-nearby><span>◎</span>附近</button>
      <button type="button" data-place-street-view><span>◉</span>街景</button>
      <button type="button" data-place-share><span>⤴</span>分享</button>
    </div>
    <button class="map-google-navigation map-place-navigation-cta" type="button" data-place-google-navigation>
      <span aria-hidden="true">➤</span> 前往 Google 導航
    </button>
    <p class="map-tool-status" data-place-status role="status"></p>
    ${place.summary ? `<p>${escapeHtml(place.summary)}</p>` : ""}
    ${place.address ? `<p class="map-place-line">${escapeHtml(place.address)}</p>` : ""}
    ${place.phone ? `<p class="map-place-line"><a href="tel:${escapeHtml(place.phone.replace(/[^\d+]/g, ""))}">${escapeHtml(place.phone)}</a></p>` : ""}
    ${websiteUrl ? `<p class="map-place-line"><a href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener">網站</a></p>` : ""}
    ${
      place.hours.length
        ? `<details class="map-place-hours"><summary>營業時間</summary><ul>${place.hours
            .map((line) => `<li>${escapeHtml(line)}</li>`)
            .join("")}</ul></details>`
        : ""
    }
    ${placeReviewsHtml(place)}
  `;
  mapPlaceCard.hidden = false;
}

async function showLocationDetails(location) {
  closeSheetPanels();
  const requestId = latestPlaceRequest;
  mapPlaceCard.hidden = false;
  mapPlaceCard.textContent = "正在查詢這個位置…";
  clearPlaceMarkers();
  cameFromResults = false;
  addPlaceMarker(location, "選取的位置");
  let address = null;
  try {
    const { Geocoder } = await google.maps.importLibrary("geocoding");
    const { results } = await new Geocoder().geocode({ location });
    address = results[0]?.formatted_address ?? null;
  } catch (error) {
    console.warn("Reverse geocoding failed", error);
  }
  if (requestId !== latestPlaceRequest) return;
  renderPlaceCard({
    name: address || "選取的位置",
    address: coordinateText(location),
    location,
    directionsTarget: coordinateText(location),
    rating: "",
    isOpen: null,
    hours: [],
    photos: [],
    reviews: [],
  });
}

async function showStreetView(location, statusElement) {
  try {
    const { StreetViewService } = await google.maps.importLibrary("streetView");
    const { data } = await new StreetViewService().getPanorama({
      location,
      radius: 200,
    });
    const panorama = map.getStreetView();
    panorama.setPano(data.location.pano);
    panorama.setVisible(true);
  } catch {
    statusElement.textContent = "這個位置附近沒有街景。";
  }
}

function addCurrentPlaceToFootprint(place) {
  if (pickingMapPoint) {
    placePendingRoutePoint(place.location, place.name);
    return;
  }
  document.querySelector("#map-add-open").click();
  if (!currentUser) return;
  const row = routePointList.querySelector(".route-point-row");
  row.querySelector("[data-route-name]").value = place.name;
  setRowCoordinates(row, {
    lat: place.location.lat.toFixed(6),
    lng: place.location.lng.toFixed(6),
  });
}

async function sharePlace(place, statusElement) {
  const url =
    (place.googleMapsUrl && safeWebUrl(place.googleMapsUrl)) ||
    footprintDirectionsUrl([place.location]);
  try {
    await navigator.clipboard.writeText(url);
    statusElement.textContent = "已複製地點連結。";
  } catch {
    statusElement.textContent = url;
  }
}

// --- Map clicks ---

// Called by the map itself; see initMap in map.js.
async function handleMapClick(event) {
  hideSuggestions();
  hideMapMenus();
  const location = toLatLngLiteral(event.latLng);
  if (isMeasuring) {
    event.stop?.();
    addMeasurePoint(location);
    return;
  }
  if (event.placeId) {
    // Replace Google's default bubble with the place card.
    event.stop();
    const { Place } = await getPlacesLibrary();
    const place = new Place({ id: event.placeId });
    if (pickingMapPoint) {
      let name = "";
      try {
        await place.fetchFields({ fields: ["displayName"] });
        name = String(place.displayName ?? "");
      } catch (error) {
        console.warn("Place name lookup failed", error);
      }
      placePendingRoutePoint(location, name);
      return;
    }
    clearPlaceMarkers();
    cameFromResults = false;
    showPlaceDetails(place);
    return;
  }
  if (pickingMapPoint) {
    placePendingRoutePoint(location);
    return;
  }
  // A click on the bare map dismisses a card, or asks what is here when none is open.
  if (!mapPlaceCard.hidden && !cameFromResults) {
    closeSheetPanels();
    clearPlaceMarkers();
  } else if (mapResults.hidden && mapDirectionsForm.hidden) {
    showLocationDetails(location);
  }
}

function handleMapContextMenu(event) {
  const location = toLatLngLiteral(event.latLng);
  if (pickingMapPoint) {
    placePendingRoutePoint(location);
    return;
  }
  const menuItems = [
    ["這裡是哪裡？", () => showLocationDetails(location)],
    ["從這裡出發", () => openDirections({ origin: coordinateText(location) })],
    ["前往這裡", () => openDirections({ destination: coordinateText(location) })],
    [
      "搜尋附近",
      () => {
        map.panTo(location);
        mapSearchInput.value = "";
        mapSearchInput.placeholder = "搜尋這附近";
        mapSearchInput.focus();
      },
    ],
    [
      "加入足跡",
      () =>
        addCurrentPlaceToFootprint({ name: "地圖途經點", location }),
    ],
    [
      "測量距離",
      () => {
        startMeasuring();
        addMeasurePoint(location);
      },
    ],
    [
      coordinateText(location),
      async () => {
        try {
          await navigator.clipboard.writeText(coordinateText(location));
        } catch (error) {
          console.warn("Copy failed", error);
        }
      },
    ],
  ];
  mapContextMenu.replaceChildren(
    ...menuItems.map(([label, action]) => {
      const item = suggestionItem(label, () => {
        hideMapMenus();
        action();
      });
      item.setAttribute("role", "none");
      item.firstChild.setAttribute("role", "menuitem");
      return item;
    }),
  );
  mapContextMenu.hidden = false;
  const panelBox = mapPanel.getBoundingClientRect();
  const menuBox = mapContextMenu.getBoundingClientRect();
  const domEvent = event.domEvent;
  const x = (domEvent?.clientX ?? panelBox.left + panelBox.width / 2) - panelBox.left;
  const y = (domEvent?.clientY ?? panelBox.top + panelBox.height / 2) - panelBox.top;
  mapContextMenu.style.left = `${Math.max(0, Math.min(x, panelBox.width - menuBox.width))}px`;
  mapContextMenu.style.top = `${Math.max(0, Math.min(y, panelBox.height - menuBox.height))}px`;
  mapContextMenu.querySelector("button").focus();
}

function hideMapMenus() {
  mapContextMenu.hidden = true;
  mapLayersMenu.hidden = true;
  mapLayersToggle.setAttribute("aria-expanded", "false");
}

// --- Distance measuring ---

function distanceBetween(from, to) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(to.lat - from.lat);
  const longitudeDelta = toRadians(to.lng - from.lng);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(from.lat)) *
      Math.cos(toRadians(to.lat)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine));
}

function pathLength(path) {
  return path.reduce(
    (total, point, index) =>
      index === 0 ? 0 : total + distanceBetween(path[index - 1], point),
    0,
  );
}

function startMeasuring() {
  stopMeasuring();
  isMeasuring = true;
  mapMeasure.hidden = false;
  mapMeasureText.textContent = "點選地圖開始測量";
  measureLine = new google.maps.Polyline({
    map,
    path: [],
    strokeColor: "#1f6b57",
    strokeWeight: 3,
  });
}

function addMeasurePoint(location) {
  const dot = document.createElement("div");
  dot.className = "map-measure-dot";
  measureMarkers.push(
    new google.maps.marker.AdvancedMarkerElement({
      map,
      position: location,
      content: dot,
    }),
  );
  const path = [...measureLine.getPath().getArray().map(toLatLngLiteral), location];
  measureLine.setPath(path);
  mapMeasureText.textContent = `總距離：${formatDistance(pathLength(path))}`;
}

function stopMeasuring() {
  isMeasuring = false;
  mapMeasure.hidden = true;
  measureMarkers.forEach((marker) => {
    marker.map = null;
  });
  measureMarkers = [];
  measureLine?.setMap(null);
  measureLine = null;
}

// --- Directions ---

function directionStopRows() {
  return Array.from(mapDirectionStops.querySelectorAll(".map-direction-stop"));
}

function renumberDirectionStops() {
  const rows = directionStopRows();
  rows.forEach((row, index) => {
    const isOrigin = index === 0;
    const isDestination = index === rows.length - 1;
    row.querySelector(".map-stop-badge").textContent = String.fromCharCode(
      65 + index,
    );
    const input = row.querySelector("input");
    input.placeholder = isOrigin
      ? "起點（留空使用目前位置）"
      : isDestination
        ? "目的地"
        : "停靠站";
    input.setAttribute("aria-label", input.placeholder);
    input.required = !isOrigin;
    row.querySelector("[data-stop-remove]").hidden = rows.length <= 2;
  });
  document.querySelector("#map-stop-add").disabled =
    rows.length >= MAX_INTERMEDIATE_STOPS + 2 ||
    new FormData(mapDirectionsForm).get("travel-mode") === "TRANSIT";
}

function addDirectionStop(value = "", beforeRow = null) {
  const row = document.createElement("div");
  row.className = "map-direction-stop";
  row.innerHTML = `
    <span class="map-stop-badge" aria-hidden="true"></span>
    <input maxlength="200" />
    <button class="map-tool-icon" type="button" data-stop-remove aria-label="移除這一站">×</button>
  `;
  row.querySelector("input").value = value;
  mapDirectionStops.insertBefore(row, beforeRow);
  renumberDirectionStops();
  return row;
}

function resetDirectionStops() {
  mapDirectionStops.replaceChildren();
  addDirectionStop();
  addDirectionStop();
}

function openDirections({ origin, destination } = {}) {
  closeSheetPanels();
  hideSuggestions();
  mapDirectionsForm.hidden = false;
  const rows = directionStopRows();
  const originInput = rows[0].querySelector("input");
  const destinationInput = rows[rows.length - 1].querySelector("input");
  if (origin !== undefined) originInput.value = origin;
  if (destination !== undefined) destinationInput.value = destination;
  (destinationInput.value ? originInput : destinationInput).focus();
}

function clearRouteDrawing() {
  routeLines.forEach((line) => line.setMap(null));
  routeLines = [];
  routeStopMarkers.forEach((marker) => {
    marker.map = null;
  });
  routeStopMarkers = [];
}

function closeDirections() {
  closeSheetPanels();
  clearRouteDrawing();
  shownRoutes = [];
  mapRouteList.replaceChildren();
  mapDirectionsStatus.textContent = "";
  mapDirectionSuggestions.hidden = true;
}

function currentCoordinates() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("此瀏覽器不支援定位。"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
      () => reject(new Error("無法取得目前位置，請允許定位權限或手動輸入起點。")),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  });
}

function formatDuration(milliseconds) {
  const totalMinutes = Math.max(1, Math.round(milliseconds / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} 分鐘`;
  return minutes === 0 ? `${hours} 小時` : `${hours} 小時 ${minutes} 分鐘`;
}

function formatDistance(meters) {
  return meters >= 1000
    ? `${(meters / 1000).toFixed(1)} 公里`
    : `${Math.round(meters)} 公尺`;
}

function directionsLink({ origin, destination, intermediates, travelMode }) {
  const placeText = (place) =>
    typeof place === "string" ? place : `${place.lat},${place.lng}`;
  const params = new URLSearchParams({
    api: "1",
    origin: placeText(origin),
    destination: placeText(destination),
    travelmode: travelMode.toLowerCase(),
    dir_action: "navigate",
  });
  if (intermediates.length > 0) {
    params.set("waypoints", intermediates.join("|"));
  }
  return `https://www.google.com/maps/dir/?${params}`;
}

function drawRoutes() {
  routeLines.forEach((line) => line.setMap(null));
  routeLines = [];
  shownRoutes.forEach((route, index) => {
    const isSelected = index === selectedRouteIndex;
    const line = new google.maps.Polyline({
      map,
      path: route.path.map(toLatLngLiteral),
      strokeColor: isSelected ? "#1f6b57" : "#9c9c8e",
      strokeOpacity: isSelected ? 0.95 : 0.8,
      strokeWeight: isSelected ? 6 : 5,
      zIndex: isSelected ? 2 : 1,
    });
    line.addListener("click", () => {
      selectedRouteIndex = index;
      renderRoutes();
    });
    routeLines.push(line);
  });
}

function drawRouteStops(route) {
  const legs = route.legs ?? [];
  const positions = [
    legs[0]?.startLocation,
    ...legs.map((leg) => leg.endLocation),
  ].filter(Boolean);
  positions.forEach((position, index) => {
    const badge = document.createElement("div");
    badge.className = "map-route-pin";
    badge.textContent = String.fromCharCode(65 + index);
    routeStopMarkers.push(
      new google.maps.marker.AdvancedMarkerElement({
        map,
        position: toLatLngLiteral(position),
        content: badge,
      }),
    );
  });
}

function routeStepHtml(step) {
  const line = step.transitDetails?.transitLine;
  const lineName = line?.shortName || line?.name;
  const headsign = step.transitDetails?.headsign;
  return `
    <li>
      ${lineName ? `<strong>${escapeHtml(lineName)}</strong>${headsign ? ` 往 ${escapeHtml(headsign)}` : ""}<br>` : ""}
      ${escapeHtml(step.instructions ?? "繼續前進")}
      <small>${escapeHtml(formatDistance(step.distanceMeters ?? 0))}</small>
    </li>
  `;
}

function renderRoutes() {
  drawRoutes();
  mapRouteList.innerHTML = shownRoutes
    .map((route, index) => {
      const isSelected = index === selectedRouteIndex;
      const steps = (route.legs ?? []).flatMap((leg) => leg.steps ?? []);
      return `
        <article class="map-route${isSelected ? " is-selected" : ""}">
          <button type="button" data-route-index="${index}" aria-pressed="${isSelected}">
            <strong>${escapeHtml(formatDuration(route.durationMillis ?? 0))}</strong>
            <span>${escapeHtml(formatDistance(route.distanceMeters ?? 0))}</span>
            <small>${escapeHtml(route.description ?? "")}</small>
          </button>
          ${
            isSelected
              ? `<a class="map-route-submit" href="${escapeHtml(directionsLink(routeRequest))}" target="_blank" rel="noopener">開始導航</a>
                 <details>
                   <summary>路線步驟（${steps.length}）</summary>
                   <ol>${steps.map(routeStepHtml).join("")}</ol>
                 </details>`
              : ""
          }
        </article>
      `;
    })
    .join("");
}

async function submitDirections(event) {
  event.preventDefault();
  mapDirectionsStatus.textContent = "正在查詢路線…";
  mapDirectionSuggestions.hidden = true;
  mapRouteList.replaceChildren();
  clearRouteDrawing();
  const travelMode = new FormData(mapDirectionsForm).get("travel-mode");
  const values = directionStopRows().map((row) =>
    row.querySelector("input").value.trim(),
  );
  const destination = values[values.length - 1];
  const intermediates = values.slice(1, -1).filter(Boolean);
  try {
    const origin = values[0] || (await currentCoordinates());
    const { Route } = await google.maps.importLibrary("routes");
    const request = {
      origin,
      destination,
      travelMode,
      language: "zh-TW",
      region: "tw",
      fields: ROUTE_FIELDS,
    };
    if (intermediates.length > 0) {
      request.intermediates = intermediates.map((location) => ({ location }));
    } else {
      // Google returns no alternatives for requests with intermediate stops.
      request.computeAlternativeRoutes = true;
    }
    const departure = document.querySelector("#map-departure-time").value;
    if (departure) request.departureTime = new Date(departure);
    if (travelMode === "DRIVING") {
      // A traffic-aware preference only works for a departure that has not passed.
      request.routingPreference = "TRAFFIC_AWARE";
      request.routeModifiers = {
        avoidTolls: document.querySelector("#map-avoid-tolls").checked,
        avoidHighways: document.querySelector("#map-avoid-highways").checked,
        avoidFerries: document.querySelector("#map-avoid-ferries").checked,
      };
    }
    const { routes } = await Route.computeRoutes(request);
    if (!routes?.length) {
      mapDirectionsStatus.textContent = "找不到可用的路線。";
      return;
    }
    shownRoutes = routes;
    selectedRouteIndex = 0;
    routeRequest = { origin, destination, intermediates, travelMode };
    mapDirectionsStatus.textContent = "";
    clearPlaceMarkers();
    renderRoutes();
    drawRouteStops(routes[0]);
    const bounds = new google.maps.LatLngBounds();
    routes[0].path.forEach((position) => bounds.extend(toLatLngLiteral(position)));
    map.fitBounds(bounds, 56);
  } catch (error) {
    console.warn("Route lookup failed", error);
    mapDirectionsStatus.textContent =
      error.message && !error.code
        ? error.message
        : "路線查詢失敗，請確認地點正確且 Routes API 已啟用。";
  }
}

async function updateDirectionSuggestions(input) {
  const query = input.value.trim();
  const requestId = ++latestSuggestionRequest;
  if (!query) {
    mapDirectionSuggestions.hidden = true;
    return;
  }
  try {
    const predictions = await fetchPlaceSuggestions(query);
    if (requestId !== latestSuggestionRequest) return;
    mapDirectionSuggestions.replaceChildren(
      ...predictions.map((prediction) =>
        suggestionItem(prediction.text.toString(), () => {
          input.value = prediction.text.toString();
          autocompleteToken = null;
          mapDirectionSuggestions.hidden = true;
        }),
      ),
    );
    mapDirectionSuggestions.hidden = predictions.length === 0;
  } catch (error) {
    console.warn("Place suggestions failed", error);
    mapDirectionSuggestions.hidden = true;
  }
}

// --- Events ---

mapSearchInput.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(updateSuggestions, SEARCH_DEBOUNCE_MS);
});

mapSearchInput.addEventListener("focus", () => {
  if (!mapSearchInput.value.trim()) showRecentSearches();
});

mapSearchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  clearTimeout(searchDebounce);
  const query = mapSearchInput.value.trim();
  if (query) searchPlaces(query);
});

mapSearchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hideSuggestions();
});

document.querySelector(".map-chips").addEventListener("click", (event) => {
  const chip = event.target.closest("[data-map-chip]");
  if (!chip) return;
  mapSearchInput.value = chip.dataset.mapChip;
  searchPlaces(chip.dataset.mapChip, { inView: true });
});

mapSearchArea.addEventListener("click", () => {
  searchPlaces(lastSearchQuery, { inView: true });
});

document
  .querySelector("#map-directions-open")
  .addEventListener("click", () => openDirections());
document
  .querySelector("#map-directions-close")
  .addEventListener("click", closeDirections);
document.querySelector("#map-directions-swap").addEventListener("click", () => {
  const inputs = directionStopRows().map((row) => row.querySelector("input"));
  const values = inputs.map((input) => input.value).reverse();
  inputs.forEach((input, index) => {
    input.value = values[index];
  });
});
document.querySelector("#map-stop-add").addEventListener("click", () => {
  const rows = directionStopRows();
  addDirectionStop("", rows[rows.length - 1]).querySelector("input").focus();
});
mapDirectionStops.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-stop-remove]");
  if (!removeButton) return;
  removeButton.closest(".map-direction-stop").remove();
  renumberDirectionStops();
});
mapDirectionStops.addEventListener("input", (event) => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(
    () => updateDirectionSuggestions(event.target),
    SEARCH_DEBOUNCE_MS,
  );
});
mapDirectionsForm.addEventListener("change", (event) => {
  if (event.target.name !== "travel-mode") return;
  // Transit routes cannot include intermediate stops.
  if (event.target.value === "TRANSIT") {
    directionStopRows()
      .slice(1, -1)
      .forEach((row) => row.remove());
  }
  renumberDirectionStops();
});
mapDirectionsForm.addEventListener("submit", submitDirections);

mapRouteList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-route-index]");
  if (!button) return;
  selectedRouteIndex = Number(button.dataset.routeIndex);
  renderRoutes();
});

mapPlaceCard.addEventListener("click", (event) => {
  if (event.target.closest("[data-place-back]")) {
    closeSheetPanels();
    mapResults.hidden = false;
    return;
  }
  if (event.target.closest("[data-place-close]")) {
    closeSheetPanels();
    clearPlaceMarkers();
    return;
  }
  if (!currentPlace) return;
  const status = mapPlaceCard.querySelector("[data-place-status]");
  if (event.target.closest("[data-place-google-navigation]")) {
    const destination =
      currentPlace.location ||
      currentPlace.directionsTarget ||
      currentPlace.address ||
      currentPlace.name;
    if (!openGoogleNavigation(destination)) {
      status.textContent = "無法開啟新分頁，請允許彈出視窗後重試。";
    }
  } else if (event.target.closest("[data-place-directions]")) {
    openDirections({
      destination:
        currentPlace.directionsTarget || currentPlace.address || currentPlace.name,
    });
  } else if (event.target.closest("[data-place-street-view]")) {
    showStreetView(currentPlace.location, status);
  } else if (event.target.closest("[data-place-footprint]")) {
    addCurrentPlaceToFootprint(currentPlace);
  } else if (event.target.closest("[data-place-share]")) {
    sharePlace(currentPlace, status);
  } else if (event.target.closest("[data-place-nearby]")) {
    map.panTo(currentPlace.location);
    mapSearchInput.value = "";
    mapSearchInput.placeholder = `搜尋「${currentPlace.name}」附近`;
    mapSearchInput.focus();
  }
});

document.addEventListener("click", (event) => {
  const pointButton = event.target.closest("[data-google-navigation]");
  if (pointButton) {
    const lat = Number(pointButton.dataset.navigationLat);
    const lng = Number(pointButton.dataset.navigationLng);
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      !openGoogleNavigation({ lat, lng })
    ) {
      window.alert("無法開啟新分頁，請允許彈出視窗後重試。");
    }
    return;
  }
  const routeButton = event.target.closest("[data-google-route-navigation]");
  if (!routeButton) return;
  const route = mapPoints.find(
    (point) => point.id === Number(routeButton.dataset.googleRouteNavigation),
  );
  if (!route) {
    window.alert("找不到這趟足跡的途經點，請重新載入地圖後重試。");
    return;
  }
  const url = footprintDirectionsUrl(footprintRoutePoints(route));
  const opened = url && window.open(url, "_blank");
  if (!opened) {
    window.alert("無法開啟新分頁，請允許彈出視窗後重試。");
    return;
  }
  opened.opener = null;
});

mapLayersToggle.addEventListener("click", () => {
  const isOpening = mapLayersMenu.hidden;
  mapLayersMenu.hidden = !isOpening;
  mapLayersToggle.setAttribute("aria-expanded", String(isOpening));
});

mapLayersMenu.addEventListener("click", (event) => {
  const typeButton = event.target.closest("[data-map-type]");
  if (typeButton) {
    map.setMapTypeId(typeButton.dataset.mapType);
    mapLayersMenu.querySelectorAll("[data-map-type]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button === typeButton));
    });
    return;
  }
  const button = event.target.closest("[data-map-layer]");
  if (!button) return;
  const name = button.dataset.mapLayer;
  const LayerClass = {
    traffic: google.maps.TrafficLayer,
    transit: google.maps.TransitLayer,
    bicycling: google.maps.BicyclingLayer,
    streetView: google.maps.StreetViewCoverageLayer,
  }[name];
  mapLayers[name] ??= new LayerClass();
  const isOn = button.getAttribute("aria-pressed") !== "true";
  mapLayers[name].setMap(isOn ? map : null);
  button.setAttribute("aria-pressed", String(isOn));
});

document.querySelector("#map-measure-close").addEventListener("click", stopMeasuring);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hideMapMenus();
});

document.querySelector("#map-my-location").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const position = await currentCoordinates();
    if (!myLocationMarker) {
      const dot = document.createElement("div");
      dot.className = "my-location-dot";
      myLocationMarker = new google.maps.marker.AdvancedMarkerElement({
        map,
        content: dot,
        title: "我的位置",
      });
    }
    myLocationMarker.position = position;
    map.panTo(position);
    map.setZoom(16);
  } catch (error) {
    window.alert(error.message);
  } finally {
    button.disabled = false;
  }
});

const mapFullscreenButton = document.querySelector("#map-fullscreen");
mapFullscreenButton.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await mapPanel.requestFullscreen();
  } catch (error) {
    console.warn("Fullscreen failed", error);
  }
});
document.addEventListener("fullscreenchange", () => {
  mapFullscreenButton.setAttribute(
    "aria-pressed",
    String(document.fullscreenElement === mapPanel),
  );
});
