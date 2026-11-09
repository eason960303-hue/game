// 我的生活 zooms like a photo library: 大格 shows each post's card, 小格 fits three or more
// to a row, and 月份 shows one tile per month to jump into. Posts are grouped by month at
// every level. The bar stays under the top bar, and on a phone a pinch changes the level too.
const PROFILE_ZOOM_LEVELS = ["month", "small", "large"];
const PROFILE_ZOOM_KEY = "life-logger-profile-zoom";
const PROFILE_POST_UNITS = { diary: "篇", footprint: "趟" };
const profileZoomBar = document.querySelector("#profile-zoom");
const profilePostsHeading = profileZoomBar.closest(".profile-posts-heading");
const profilePostLists = [profileDiariesGrid, profileFootprintsGrid];
const profileTopbar = document.querySelector(".floating-topbar");

let profileZoom = readProfileZoom();

function readProfileZoom() {
  try {
    const saved = localStorage.getItem(PROFILE_ZOOM_KEY);
    return PROFILE_ZOOM_LEVELS.includes(saved) ? saved : "large";
  } catch {
    return "large";
  }
}

// 小格 tiles sit under a month heading, so month and day are enough: 11/8.
function profileShortDate(value) {
  const date = value ? serverDate(value) : new Date();
  return Number.isNaN(date.getTime()) ? "" : `${date.getMonth() + 1}/${date.getDate()}`;
}

function profilePostMonth(post) {
  const date = post.created_at ? serverDate(post.created_at) : new Date();
  const known = Number.isNaN(date.getTime()) ? new Date() : date;
  return { year: known.getFullYear(), month: known.getMonth() + 1 };
}

// Newest month first; posts keep their order inside a month.
function groupProfilePostsByMonth(posts) {
  const groups = new Map();
  posts.forEach((post) => {
    const { year, month } = profilePostMonth(post);
    const key = `${year}-${String(month).padStart(2, "0")}`;
    if (!groups.has(key)) groups.set(key, { key, year, month, posts: [] });
    groups.get(key).posts.push(post);
  });
  return [...groups.values()].sort((left, right) => right.key.localeCompare(left.key));
}

function profilePostListHtml(posts, type, expandedId) {
  const groups = groupProfilePostsByMonth(posts);
  return profileZoom === "month"
    ? profileMonthTilesHtml(groups, type)
    : groups
        .map(
          (group) => `
            <section class="profile-month" data-profile-month="${group.key}" aria-labelledby="profile-month-${type}-${group.key}">
              <h3 class="profile-month-heading" id="profile-month-${type}-${group.key}">
                ${group.year} 年 ${group.month} 月
                <span class="profile-month-count">${group.posts.length} ${PROFILE_POST_UNITS[type]}</span>
              </h3>
              <div class="profile-post-grid">
                ${group.posts.map((post) => renderProfilePostCard(post, type, expandedId)).join("")}
              </div>
            </section>
          `,
        )
        .join("");
}

// The mood a month's diaries name most often, or nothing when none name one.
function profileMonthMood(posts) {
  const counts = new Map();
  posts.forEach((post) =>
    String(post.mood || "")
      .split(/[、,，/\s]+/)
      .filter(Boolean)
      .forEach((mood) => counts.set(mood, (counts.get(mood) || 0) + 1)),
  );
  let top = "";
  counts.forEach((count, mood) => {
    if (!top || count > counts.get(top)) top = mood;
  });
  return top;
}

function profileMonthTilesHtml(groups, type) {
  const unit = PROFILE_POST_UNITS[type];
  const years = [];
  groups.forEach((group) => {
    const last = years[years.length - 1];
    if (last?.year === group.year) last.groups.push(group);
    else years.push({ year: group.year, groups: [group] });
  });
  return years
    .map(
      ({ year, groups: months }) => `
        <section class="profile-year">
          <h3 class="profile-month-heading">
            ${year} 年
            <span class="profile-month-count">${months.reduce((sum, group) => sum + group.posts.length, 0)} ${unit}</span>
          </h3>
          <div class="profile-month-grid">
            ${months
              .map((group) => {
                const cover =
                  type === "footprint"
                    ? group.posts.map((post) => mediaUrl(post.cover_url)).find(Boolean)
                    : null;
                const mood = type === "diary" ? profileMonthMood(group.posts) : "";
                return `
                  <button
                    class="profile-month-tile${cover ? " has-cover" : ""}"
                    type="button"
                    data-profile-month="${group.key}"
                    aria-label="${year} 年 ${group.month} 月，${group.posts.length} ${unit}${mood ? `，最常的心情是${escapeHtml(mood)}` : ""}"
                  >
                    ${cover ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy" decoding="async" />` : ""}
                    <span class="profile-month-tile-name">${group.month} 月</span>
                    <span class="profile-month-tile-count">${group.posts.length} ${unit}</span>
                    ${mood ? `<span class="profile-month-tile-mood">${escapeHtml(mood)}</span>` : ""}
                  </button>
                `;
              })
              .join("")}
          </div>
        </section>
      `,
    )
    .join("");
}

function syncProfileZoomBar() {
  profileZoomBar.querySelectorAll("[data-profile-zoom]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.profileZoom === profileZoom));
  });
  profilePostLists.forEach((list) => {
    list.dataset.zoom = profileZoom;
  });
}

// Where the bar ends: what scrolls under it is out of sight.
function profileStickyLine() {
  return profilePostsHeading.getBoundingClientRect().bottom;
}

// The month at the top of the screen, so the new level opens on the same month.
function profileZoomAnchor() {
  const line = profileStickyLine();
  for (const list of profilePostLists) {
    if (list.closest("[hidden]")) continue;
    const month = [...list.querySelectorAll("[data-profile-month]")].find(
      (item) => item.getBoundingClientRect().bottom > line + 1,
    );
    if (month) {
      // Not scrolled into the posts yet: the page stays where it is.
      if (list.getBoundingClientRect().top >= line) return null;
      return { list, key: month.dataset.profileMonth };
    }
  }
  return null;
}

// Puts the month just under the bar. Measured against the bar as it sits once stuck,
// since scrolling down to the month is what makes it stick.
function scrollProfileMonthIntoView({ list, key }) {
  const month = list.querySelector(`[data-profile-month="${key}"]`);
  if (!month) return;
  const stuckLine = (profileTopbar?.offsetHeight ?? 0) + profilePostsHeading.offsetHeight;
  window.scrollTo({
    top: window.scrollY + month.getBoundingClientRect().top - stuckLine - 8,
    behavior: "instant",
  });
}

// Draws the lists again from the posts on hand. A list that still shows a placeholder,
// a message or another profile's posts is left alone.
function redrawProfileLists() {
  flushPrivacyDrafts();
  const diaries = profilePosts.filter((post) => post.type === "entry");
  const footprints = profilePosts.filter((post) => post.type === "footprint");
  [
    [profileDiariesGrid, diaries, "diary", expandedProfileDiaryId],
    [profileFootprintsGrid, footprints, "footprint", expandedProfileFootprintId],
  ].forEach(([list, posts, type, expandedId]) => {
    if (!posts.length || !list.querySelector("[data-profile-month]")) return;
    list.innerHTML = profilePostListHtml(posts, type, expandedId);
  });
  warmPhotos(profileDiariesGrid);
}

function setProfileZoom(level, anchor) {
  const from = PROFILE_ZOOM_LEVELS.indexOf(profileZoom);
  const to = PROFILE_ZOOM_LEVELS.indexOf(level);
  if (to === -1 || to === from) return;
  anchor ??= profileZoomAnchor();
  // 小格 and 大格 share their markup and differ only in CSS, so only 月份 is drawn anew.
  const redraw = profileZoom === "month" || level === "month";
  profileZoom = level;
  try {
    localStorage.setItem(PROFILE_ZOOM_KEY, level);
  } catch {
    // Private browsing: the level just isn't remembered.
  }
  syncProfileZoomBar();
  if (redraw) {
    redrawProfileLists();
  } else {
    // Kept tiles drop any open or close still running from where they sat at the old size.
    profilePostLists.forEach((list) =>
      list.querySelectorAll(".profile-post-grid").forEach(clearProfileTileAnimation),
    );
  }
  if (anchor) scrollProfileMonthIntoView(anchor);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // Zooming in grows the new tiles from slightly smaller, zooming out shrinks them in.
  const scale = to > from ? 0.94 : 1.06;
  profilePostLists.forEach((list) => {
    if (list.closest("[hidden]") || !list.querySelector("[data-profile-month]")) return;
    list.animate(
      [
        { opacity: 0, transform: `scale(${scale})` },
        { opacity: 1, transform: "none" },
      ],
      // --ios-ease, written out: animate() can't read a custom property.
      { duration: 320, easing: "cubic-bezier(0.32, 0.72, 0, 1)" },
    );
  });
}

function stepProfileZoom(direction) {
  setProfileZoom(PROFILE_ZOOM_LEVELS[PROFILE_ZOOM_LEVELS.indexOf(profileZoom) + direction]);
}

profileZoomBar.addEventListener("click", (event) => {
  const button = event.target.closest("[data-profile-zoom]");
  if (button) setProfileZoom(button.dataset.profileZoom);
});

// A month tile opens that month at 小格.
profilePostLists.forEach((list) => {
  list.addEventListener("click", (event) => {
    const tile = event.target.closest(".profile-month-tile");
    if (!tile) return;
    setProfileZoom("small", { list, key: tile.dataset.profileMonth });
  });
});

// Two fingers apart zoom in, together zoom out: one level per pinch. Anywhere from the bar
// down counts, gaps between sections included; above it the page zooms as usual. While
// pinching, the list under the fingers follows them a little before the level switches.
const PROFILE_PINCH_STEP = 1.35;
const profilePinchArea = profilePostsHeading.parentElement;
let profilePinch = null;

function pinchDistance(touches) {
  return Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY,
  );
}

function releaseProfilePinch() {
  if (!profilePinch) return;
  const { list } = profilePinch;
  profilePinch = null;
  if (!list?.style.transform) return;
  list.style.transition = "transform 240ms var(--ios-ease)";
  list.style.transform = "";
  setTimeout(() => {
    list.style.transition = "";
    list.style.transformOrigin = "";
  }, 260);
}

profilePinchArea.addEventListener(
  "touchstart",
  (event) => {
    if (event.touches.length !== 2) return;
    const midX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
    const midY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
    if (midY < profilePostsHeading.getBoundingClientRect().top) return;
    const list = profilePostLists.find((candidate) => {
      const box = candidate.getBoundingClientRect();
      return box.height && midY >= box.top && midY <= box.bottom;
    });
    if (list) {
      const box = list.getBoundingClientRect();
      list.style.transformOrigin = `${midX - box.left}px ${midY - box.top}px`;
    }
    profilePinch = { list, start: pinchDistance(event.touches), done: false };
  },
  { passive: true },
);

profilePinchArea.addEventListener(
  "touchmove",
  (event) => {
    if (!profilePinch || event.touches.length !== 2) return;
    event.preventDefault(); // The page itself doesn't zoom.
    if (profilePinch.done) return;
    const { list } = profilePinch;
    const ratio = pinchDistance(event.touches) / profilePinch.start;
    if (ratio > PROFILE_PINCH_STEP || ratio < 1 / PROFILE_PINCH_STEP) {
      // One level per pinch; at the first or last level nothing changes.
      profilePinch.done = true;
      if (list) {
        list.style.transform = "";
        list.style.transformOrigin = "";
      }
      stepProfileZoom(ratio > 1 ? 1 : -1);
      return;
    }
    if (list) list.style.transform = `scale(${1 + (ratio - 1) * 0.35})`;
  },
  { passive: false },
);

profilePinchArea.addEventListener("touchend", (event) => {
  if (event.touches.length < 2) releaseProfilePinch();
});
profilePinchArea.addEventListener("touchcancel", releaseProfilePinch);
// Safari's own pinch event, which would otherwise zoom the page.
profilePinchArea.addEventListener("gesturestart", (event) => {
  if (profilePinch) event.preventDefault();
});

// A trackpad pinch arrives as a wheel event with ctrlKey.
let profileWheelZoom = 0;
let profileWheelResting = 0;
profilePinchArea.addEventListener(
  "wheel",
  (event) => {
    if (!event.ctrlKey || event.clientY < profilePostsHeading.getBoundingClientRect().top) return;
    event.preventDefault();
    if (event.timeStamp < profileWheelResting) return;
    profileWheelZoom += event.deltaY;
    if (Math.abs(profileWheelZoom) < 40) return;
    stepProfileZoom(profileWheelZoom > 0 ? -1 : 1);
    profileWheelZoom = 0;
    profileWheelResting = event.timeStamp + 450;
  },
  { passive: false },
);

// The bar sits right under the top bar, whatever height that has on this screen, and takes
// on the top bar's material once it is stuck there: when the line it started from has
// scrolled up under the top bar. An observer catches that however the page got there.
const profileStuckSentinel = document.querySelector(".profile-posts-sentinel");
let profileStuckObserver = null;
let profileTopbarHeight = -1;

// Runs when the top bar or the sentinel changes size. The sentinel does so when the
// profile is shown: while hidden it reported nothing useful, and a restored scroll can
// put it above the line without ever crossing it, so observing starts over.
function watchProfileHeadingStuck() {
  const height = profileTopbar.offsetHeight;
  if (height !== profileTopbarHeight) {
    profileTopbarHeight = height;
    document.documentElement.style.setProperty("--topbar-height", `${height}px`);
    profileStuckObserver?.disconnect();
    profileStuckObserver = new IntersectionObserver(
      ([entry]) => {
        // A hidden sentinel has no box; it is checked again once shown.
        if (entry.boundingClientRect.width === 0) return;
        const stuck =
          !entry.isIntersecting &&
          Boolean(entry.rootBounds) &&
          entry.boundingClientRect.top < entry.rootBounds.top;
        profilePostsHeading.classList.toggle("is-stuck", stuck);
      },
      { rootMargin: `-${height}px 0px 0px 0px` },
    );
  } else {
    profileStuckObserver.unobserve(profileStuckSentinel);
  }
  profileStuckObserver.observe(profileStuckSentinel);
}

if (profileTopbar && profileStuckSentinel && "ResizeObserver" in window && "IntersectionObserver" in window) {
  const profileStuckResize = new ResizeObserver(watchProfileHeadingStuck);
  profileStuckResize.observe(profileTopbar);
  profileStuckResize.observe(profileStuckSentinel);
}

syncProfileZoomBar();
