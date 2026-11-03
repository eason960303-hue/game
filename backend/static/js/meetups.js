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

function meetupDirectionsUrl(meetup) {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set(
    "origin",
    `${meetup.departure_city}${meetup.departure_district}`,
  );
  url.searchParams.set(
    "destination",
    meetup.destinations[meetup.destinations.length - 1],
  );
  if (meetup.destinations.length > 1) {
    url.searchParams.set(
      "waypoints",
      meetup.destinations.slice(0, -1).join("|"),
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
    label: "個人",
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
    district: meetup.departure_district,
  }),
  who: MEETUP_WHO,
  onChange: renderMeetups,
});

function renderMeetups() {
  meetupFilter.refresh();
  const visible = meetupFilter.visible();
  meetupCount.textContent = `${visible.length} 個公開邀請`;
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
      const destinations = meetup.destinations
        .map(
          (destination, index) => `
            <li><span>${index + 1}</span>${escapeHtml(destination)}</li>
          `,
        )
        .join("");
      const action = meetup.is_owner
        ? `
          <div class="meetup-card-actions">
            <span class="meetup-host-badge">你是揪團者</span>
            <button class="small-action" type="button" data-edit-meetup="${meetup.id}">編輯邀請</button>
            <button class="small-action is-destructive" type="button" data-delete-meetup="${meetup.id}">取消揪團</button>
          </div>
        `
        : currentUser
          ? meetup.is_participating
            ? `<button class="secondary-button" type="button" data-leave-meetup="${meetup.id}">退出揪團</button>`
            : `<button class="primary-button" type="button" data-join-meetup="${meetup.id}"${full ? " disabled" : ""}>${full ? "已滿團" : "我要參加"}</button>`
          : '<button class="secondary-button" type="button" data-meetup-login>登入後參加</button>';
      return `
        <article class="meetup-card">
          <div class="meetup-card-heading">
            <div>
              <span class="meetup-public-label">公開邀請</span>
              <h3>${escapeHtml(meetup.title)}</h3>
            </div>
            <span class="meetup-participants">${meetup.participant_count} / ${meetup.participant_limit} 人</span>
          </div>
          <div class="meetup-start-row">
            <p class="meetup-starts-at">${escapeHtml(meetupDateLabel(meetup.starts_at))} 出發</p>
            <a class="small-action meetup-route-link" href="${escapeHtml(meetupDirectionsUrl(meetup))}" target="_blank" rel="noopener noreferrer">查看 Google 地圖路線</a>
          </div>
          <div class="meetup-route">
            <strong>預計路線</strong>
            <ol>${destinations}</ol>
          </div>
          <div class="meetup-card-footer">
            <span class="meetup-inviter">邀請者：${escapeHtml(meetup.host_name)}</span>
            <span class="meetup-departure">${escapeHtml(meetup.departure_city)}${escapeHtml(meetup.departure_district)}</span>
          </div>
          <div class="meetup-card-actions">${action}</div>
        </article>
      `;
    })
    .join("");
}

async function loadMeetups() {
  meetupLoadError.hidden = true;
  try {
    const loadedMeetups = await apiRequest("/meetups");
    if (!Array.isArray(loadedMeetups)) {
      throw new Error("伺服器回傳的揪團資料格式不正確。");
    }
    meetups = loadedMeetups;
    renderMeetups();
  } catch (error) {
    meetupLoadErrorMessage.textContent = error.message;
    meetupLoadError.hidden = false;
  }
}
