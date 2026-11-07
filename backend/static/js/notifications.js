// The bell: news about the meetups you host or joined, checked every half minute.
const notificationsOpenButton = document.querySelector("#notifications-open");
const notificationsBadge = document.querySelector("#notifications-badge");
const notificationsDialog = document.querySelector("#notifications-dialog");
const notificationsList = document.querySelector("#notifications-list");
const NOTIFICATIONS_REFRESH_MS = 30000;
let notificationFeed = { unread: 0, items: [] };

const NOTIFICATION_ICONS = {
  meetup_joined: "＋",
  meetup_left: "－",
  meetup_cancelled: "×",
  meetup_updated: "✎",
  meetup_comment: "“",
};

function notificationText(item) {
  const actor = item.actor_name || "發起人";
  const title = `「${item.meetup_title}」`;
  switch (item.kind) {
    case "meetup_joined":
      return `${actor} 參加了你的揪團${title}`;
    case "meetup_left":
      return `${actor} 退出了你的揪團${title}`;
    case "meetup_cancelled":
      return `${actor} 取消了揪團${title}`;
    case "meetup_updated":
      return `${actor} 改了揪團${title}的${item.body || "內容"}`;
    case "meetup_comment":
      return `${actor} 在${title}留言`;
    default:
      return `揪團${title}有新消息`;
  }
}

function notificationHtml(item) {
  // A cancelled meetup has nothing left to open.
  const opens = item.meetup_exists && item.kind !== "meetup_cancelled";
  const quote =
    item.kind === "meetup_comment" && item.body
      ? `<span class="notification-quote">${escapeHtml(item.body)}</span>`
      : "";
  const inner = `
    <span class="notification-icon" data-kind="${escapeHtml(item.kind)}" aria-hidden="true">${NOTIFICATION_ICONS[item.kind] || "•"}</span>
    <span class="notification-text">
      <span>${escapeHtml(notificationText(item))}</span>
      ${quote}
      <time datetime="${escapeHtml(item.created_at)}">${escapeHtml(timeAgo(item.created_at))}</time>
    </span>
    ${item.is_read ? "" : '<span class="notification-dot" role="img" aria-label="未讀"></span>'}
  `;
  const classes = `notification-item${item.is_read ? "" : " is-unread"}`;
  return opens
    ? `<li><button class="${classes}" type="button" data-notification-meetup="${Number(item.meetup_id)}">${inner}</button></li>`
    : `<li><div class="${classes}">${inner}</div></li>`;
}

function renderNotifications() {
  notificationsList.innerHTML = notificationFeed.items.length
    ? notificationFeed.items.map(notificationHtml).join("")
    : '<li class="notifications-empty">還沒有通知。有人參加你的揪團，或你參加的揪團有新留言時，會在這裡告訴你。</li>';
}

function showNotificationBadge() {
  const unread = notificationFeed.unread;
  notificationsBadge.hidden = unread === 0;
  notificationsBadge.textContent = unread > 9 ? "9+" : String(unread);
  notificationsOpenButton.setAttribute("aria-label", unread ? `通知，${unread} 則未讀` : "通知");
}

async function refreshNotifications() {
  if (!currentUser) return;
  try {
    const feed = await apiRequest("/notifications");
    if (!currentUser) return;
    const hadNews = feed.unread > notificationFeed.unread;
    notificationFeed = feed;
    showNotificationBadge();
    if (notificationsDialog.open) renderNotifications();
    // Someone joining or leaving changes the head count on the cards too.
    if (hadNews && !homeView.hidden) loadMeetups({ background: true });
  } catch {
    // The bell keeps what it last showed; the next check tries again.
  }
}

function resetNotifications() {
  notificationFeed = { unread: 0, items: [] };
  showNotificationBadge();
  notificationsOpenButton.hidden = !currentUser;
}

notificationsOpenButton.addEventListener("click", async () => {
  renderNotifications();
  notificationsDialog.showModal();
  await refreshNotifications();
  // They've been seen once the list is open; the dots stay until it's opened again.
  if (notificationFeed.unread > 0) {
    try {
      await apiRequest("/notifications/read", { method: "POST" });
      notificationFeed.unread = 0;
      showNotificationBadge();
    } catch {
      // Still unread on the server, so the badge stays.
    }
  }
});

document.querySelector("#notifications-dismiss").addEventListener("click", () => notificationsDialog.close());

notificationsDialog.addEventListener("close", () => {
  notificationFeed.items = notificationFeed.items.map((item) => ({ ...item, is_read: true }));
});

notificationsList.addEventListener("click", (event) => {
  const item = event.target.closest("[data-notification-meetup]");
  if (!item) return;
  notificationsDialog.close();
  openMeetupRoom(Number(item.dataset.notificationMeetup));
});

setInterval(() => {
  if (!document.hidden) refreshNotifications();
}, NOTIFICATIONS_REFRESH_MS);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshNotifications();
});
