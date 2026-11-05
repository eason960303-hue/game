function meetupDateLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-TW", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(date);
}

// Stops may be legacy name strings or located {name, lat, lng, …} objects.
function meetupStopName(stop) {
  if (!stop) return "";
  return typeof stop === "string" ? stop : stop.name || "";
}

// A located stop routes by exact coordinates; otherwise fall back to its name.
function meetupStopQuery(stop) {
  return stop && stop.lat != null && stop.lng != null
    ? `${stop.lat},${stop.lng}`
    : meetupStopName(stop);
}

// Older responses have no typed origin; fall back to the departure city.
function meetupOrigin(meetup) {
  return meetup.origin || meetup.departure_city;
}

// The district is shown only when it's in the county on the card: older meetups could
// name a county by hand and start somewhere else.
function meetupDepartureText(meetup) {
  const city = meetup.departure_city;
  if (!city) return "";
  const sameCity =
    (meetup.origin?.city || "").replace("臺", "台") === city.replace("臺", "台");
  const district = sameCity ? meetup.origin?.district || "" : "";
  return ` 從${escapeHtml(city)}${escapeHtml(district)}出發`;
}

function meetupDirectionsUrl(meetup) {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  // A single place has no route of its own, so Maps starts from where the viewer is.
  if (meetup.destinations.length === 0) {
    url.searchParams.set("destination", meetupStopQuery(meetupOrigin(meetup)));
    return url.toString();
  }
  url.searchParams.set("origin", meetupStopQuery(meetupOrigin(meetup)));
  url.searchParams.set(
    "destination",
    meetupStopQuery(meetup.destinations[meetup.destinations.length - 1]),
  );
  if (meetup.destinations.length > 1) {
    url.searchParams.set(
      "waypoints",
      meetup.destinations.slice(0, -1).map(meetupStopQuery).join("|"),
    );
  }
  return url.toString();
}

// Every meetup is a public invitation, so 公開 is the whole list.
const MEETUP_WHO = {
  friends: {
    label: "好友",
    matches: (meetup) => !meetup.is_owner && meetup.is_following,
    empty: "目前沒有好友發起的揪團。",
  },
  public: {
    label: "公開",
    matches: () => true,
    empty: "",
  },
  mine: {
    label: "我的",
    matches: (meetup) => meetup.is_owner || meetup.is_participating,
    empty: "你還沒有發起或參加揪團。",
  },
};

const meetupFilter = createContentFilter({
  rootId: "meetup-filter",
  label: "篩選揪團",
  items: () => meetups,
  regionOf: (meetup) => ({
    city: meetup.departure_city.replace("臺", "台"),
    district: meetup.origin && meetup.origin.district ? meetup.origin.district : "",
  }),
  who: MEETUP_WHO,
  onChange: renderMeetups,
});

function renderMeetups() {
  renderWelcomeCard();
  meetupFilter.refresh();
  const visible = meetupFilter.visible();
  meetupCount.textContent = `${visible.length} 個揪團`;
  if (visible.length === 0) {
    const message = meetupFilter.emptyMessage();
    meetupList.innerHTML = message
      ? `<div class="module-empty">${message}</div>`
      : "";
    return;
  }
  meetupList.innerHTML = visible
    .map((meetup) => {
      const full = meetup.participant_count >= meetup.participant_limit;
      const route = [meetupOrigin(meetup), ...meetup.destinations]
        .map((stop) => `<li>${escapeHtml(meetupStopName(stop))}</li>`)
        .join("");
      const action = meetup.is_owner
        ? `
          <button class="small-action" type="button" data-edit-meetup="${meetup.id}">編輯</button>
          <button class="small-action is-destructive" type="button" data-delete-meetup="${meetup.id}">取消揪團</button>
        `
        : currentUser
          ? meetup.is_participating
            ? `<button class="secondary-button" type="button" data-leave-meetup="${meetup.id}">退出揪團</button>`
            : `<button class="primary-button" type="button" data-join-meetup="${meetup.id}"${full ? " disabled" : ""}>${full ? "已滿團" : "我要參加"}</button>`
          : '<button class="secondary-button" type="button" data-meetup-login>登入後參加</button>';
      return `
        <article class="meetup-card">
          <div class="meetup-card-heading">
            <h3>${escapeHtml(meetup.title)}</h3>
            <span class="meetup-participants">${meetup.participant_count} / ${meetup.participant_limit} 人</span>
          </div>
          <p class="meetup-starts-at">${escapeHtml(meetupDateLabel(meetup.starts_at))}${meetupDepartureText(meetup)}</p>
          <ol class="meetup-route" aria-label="預計路線">${route}</ol>
          <div class="meetup-card-footer">
            <span class="meetup-inviter">${meetup.is_owner ? "你發起的" : `${escapeHtml(meetup.host_name)} 發起`}</span>
            <a class="meetup-route-link" href="${escapeHtml(meetupDirectionsUrl(meetup))}" target="_blank" rel="noopener noreferrer">在 Google 地圖看路線</a>
          </div>
          <div class="meetup-card-actions">${action}</div>
        </article>
      `;
    })
    .join("");
}

async function loadMeetups({ background = false } = {}) {
  meetupLoadError.hidden = true;
  try {
    const loadedMeetups = await apiRequest("/meetups");
    if (!Array.isArray(loadedMeetups)) {
      throw new Error("伺服器回傳的揪團資料格式不正確。");
    }
    // A background refresh that found nothing new must not disturb the open list.
    if (background && JSON.stringify(loadedMeetups) === JSON.stringify(meetups)) return;
    meetups = loadedMeetups;
    renderMeetups();
  } catch (error) {
    meetupCount.textContent = "載入失敗";
    meetupLoadErrorMessage.textContent = error.message;
    meetupLoadError.hidden = false;
  }
}

const MEETUP_REFRESH_MS = 30000;

// Keeps head counts current, and lets a dropped connection recover by itself.
function refreshHomeInBackground() {
  if (document.hidden) return;
  if (serverOffline) refreshServerStatus();
  if (homeView.hidden || document.querySelector("dialog[open]")) return;
  loadMeetups({ background: true });
}

setInterval(refreshHomeInBackground, MEETUP_REFRESH_MS);
document.addEventListener("visibilitychange", refreshHomeInBackground);
