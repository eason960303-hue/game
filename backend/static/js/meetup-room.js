// A meetup's own corner for the people going: who they are, and a board to sort out
// where to meet and what to bring. The server only lets members read or write it.
const meetupRoomDialog = document.querySelector("#meetup-room-dialog");
const meetupRoomTitle = document.querySelector("#meetup-room-title");
const meetupRoomWhen = document.querySelector("#meetup-room-when");
const meetupRoomMembers = document.querySelector("#meetup-room-members");
const meetupRoomMembersTitle = document.querySelector("#meetup-room-members-title");
const meetupRoomComments = document.querySelector("#meetup-room-comments");
const meetupRoomStatus = document.querySelector("#meetup-room-status");
const meetupCommentForm = document.querySelector("#meetup-comment-form");
const meetupCommentInput = document.querySelector("#meetup-comment-input");
const meetupCommentSend = document.querySelector("#meetup-comment-send");
const MEETUP_ROOM_REFRESH_MS = 15000;
let meetupRoomId = null;
let meetupRoomBoard = [];
let meetupRoomTimer = null;
let meetupRoomLoaded = false;

function meetupHostTag(isHost) {
  return isHost ? '<span class="meetup-host-tag">發起人</span>' : "";
}

function renderMeetupRoomMembers(meetup) {
  meetupRoomMembersTitle.textContent = `成員 ${meetup.members.length} / ${meetup.participant_limit} 人`;
  meetupRoomMembers.innerHTML = meetup.members
    .map(
      (member) => `
        <li>
          <a class="meetup-room-member" href="${escapeHtml(profileHref(member.username))}">
            ${avatarHtml(member.avatar_url, member.display_name)}
            <span>${escapeHtml(member.display_name)}</span>
            ${meetupHostTag(member.is_host)}
          </a>
        </li>
      `,
    )
    .join("");
}

function renderMeetupRoomBoard() {
  if (meetupRoomBoard.length === 0) {
    meetupRoomComments.innerHTML =
      '<li class="meetup-comments-empty">還沒有留言。打聲招呼，約一下集合的時間和地點吧。</li>';
    return;
  }
  meetupRoomComments.innerHTML = meetupRoomBoard
    .map(
      (comment) => `
        <li class="meetup-comment${comment.is_mine ? " is-mine" : ""}">
          ${avatarHtml(comment.author.avatar_url, comment.author.display_name, "social-avatar-small")}
          <div class="meetup-comment-main">
            <div class="meetup-comment-meta">
              <strong>${escapeHtml(comment.is_mine ? "我" : comment.author.display_name)}</strong>
              ${meetupHostTag(comment.author.is_host)}
              <time datetime="${escapeHtml(comment.created_at)}">${escapeHtml(timeAgo(comment.created_at))}</time>
              ${
                comment.can_delete
                  ? `<button class="meetup-comment-delete" type="button" data-delete-meetup-comment="${Number(comment.id)}" aria-label="刪除這則留言">刪除</button>`
                  : ""
              }
            </div>
            <p>${escapeHtml(comment.body)}</p>
          </div>
        </li>
      `,
    )
    .join("");
  meetupRoomComments.scrollTop = meetupRoomComments.scrollHeight;
}

async function loadMeetupRoomBoard({ quiet = false } = {}) {
  const meetupId = meetupRoomId;
  try {
    const board = await apiRequest(`/meetups/${meetupId}/comments`);
    if (meetupId !== meetupRoomId) return;
    const changed = JSON.stringify(board) !== JSON.stringify(meetupRoomBoard);
    meetupRoomBoard = board;
    meetupRoomLoaded = true;
    if (changed || !quiet) renderMeetupRoomBoard();
    if (!quiet) meetupRoomStatus.textContent = "";
  } catch (error) {
    if (meetupId !== meetupRoomId) return;
    if (!quiet) {
      meetupRoomComments.innerHTML = "";
      meetupRoomStatus.textContent = `留言載入失敗：${error.message}`;
    }
  }
}

async function openMeetupRoom(meetupId) {
  let meetup = meetups.find((item) => item.id === meetupId);
  if (!meetup) {
    await loadMeetups();
    meetup = meetups.find((item) => item.id === meetupId);
  }
  if (!meetup) {
    showToast("找不到這個揪團，可能已經出發或取消了。");
    return;
  }
  if (!meetup.members?.length) {
    showToast("參加這個揪團後，才看得到成員和留言。");
    return;
  }
  meetupRoomId = meetupId;
  meetupRoomBoard = [];
  meetupRoomLoaded = false;
  meetupRoomTitle.textContent = meetup.title;
  meetupRoomWhen.textContent = `${meetupDateLabel(meetup.starts_at)}${meetupDepartureText(meetup)}`;
  renderMeetupRoomMembers(meetup);
  meetupRoomComments.innerHTML = '<li class="meetup-comments-empty">載入留言中…</li>';
  meetupRoomStatus.textContent = "";
  meetupCommentInput.value = "";
  meetupRoomDialog.showModal();
  loadMeetupRoomBoard();
  clearInterval(meetupRoomTimer);
  meetupRoomTimer = setInterval(() => {
    if (!document.hidden) loadMeetupRoomBoard({ quiet: true });
  }, MEETUP_ROOM_REFRESH_MS);
}

// Closing puts the latest count on the card, so it matches what was just read.
meetupRoomDialog.addEventListener("close", () => {
  clearInterval(meetupRoomTimer);
  const meetup = meetups.find((item) => item.id === meetupRoomId);
  if (meetupRoomLoaded && meetup && meetup.comment_count !== meetupRoomBoard.length) {
    meetup.comment_count = meetupRoomBoard.length;
    renderMeetups();
  }
  meetupRoomId = null;
});

document.addEventListener("click", (event) => {
  const opener = event.target.closest("[data-open-meetup-room]");
  if (opener) openMeetupRoom(Number(opener.dataset.openMeetupRoom));
});

document.querySelector("#meetup-room-dismiss").addEventListener("click", () => meetupRoomDialog.close());

// A member's name leads to their profile, which is behind this dialog.
meetupRoomMembers.addEventListener("click", (event) => {
  if (event.target.closest('a[href^="#user/"]')) meetupRoomDialog.close();
});

meetupCommentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = meetupCommentInput.value.trim();
  if (!body || meetupRoomId === null) return;
  const meetupId = meetupRoomId;
  meetupCommentSend.disabled = true;
  meetupRoomStatus.textContent = "";
  try {
    const comment = await apiRequest(`/meetups/${meetupId}/comments`, jsonOptions("POST", { body }));
    if (meetupId !== meetupRoomId) return;
    meetupRoomBoard = [...meetupRoomBoard, comment];
    meetupCommentInput.value = "";
    autoSizeMeetupComment();
    renderMeetupRoomBoard();
  } catch (error) {
    meetupRoomStatus.textContent = `留言沒有送出：${error.message}`;
  } finally {
    meetupCommentSend.disabled = false;
  }
});

// Enter sends on a computer; on a phone the keyboard's own key adds a line.
meetupCommentInput.addEventListener("keydown", (event) => {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !coarse) {
    event.preventDefault();
    meetupCommentForm.requestSubmit();
  }
});

function autoSizeMeetupComment() {
  meetupCommentInput.style.height = "auto";
  meetupCommentInput.style.height = `${Math.min(meetupCommentInput.scrollHeight, 140)}px`;
}
meetupCommentInput.addEventListener("input", autoSizeMeetupComment);

meetupRoomComments.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete-meetup-comment]");
  if (!button || meetupRoomId === null) return;
  const commentId = Number(button.dataset.deleteMeetupComment);
  button.disabled = true;
  try {
    await apiRequest(`/meetups/${meetupRoomId}/comments/${commentId}`, { method: "DELETE" });
    meetupRoomBoard = meetupRoomBoard.filter((comment) => comment.id !== commentId);
    renderMeetupRoomBoard();
  } catch (error) {
    button.disabled = false;
    meetupRoomStatus.textContent = `刪除失敗：${error.message}`;
  }
});
