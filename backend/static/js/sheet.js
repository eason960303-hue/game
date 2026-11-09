// On a phone every form is a sheet (see ios.css); dragging its heading down closes it,
// the same way Escape does, so each dialog's own cancel handling still runs.
const SHEET_QUERY = window.matchMedia("(max-width: 760px)");
const SHEET_CLOSE_DISTANCE = 110;
const SHEET_CLOSE_SPEED = 0.6; // px per ms
const NOT_SHEETS = "#photo-viewer, #avatar-viewer, #logout-dialog"; // as in ios.css

function closeSheetLikeEscape(sheet) {
  // A handler that wants to tidy up first cancels the event and closes the dialog itself.
  if (sheet.dispatchEvent(new Event("cancel", { cancelable: true }))) sheet.close();
}

function settleSheet(sheet, transform, then) {
  sheet.style.transition = `transform ${transform === "" ? 300 : 220}ms var(--ios-ease)`;
  sheet.style.transform = transform;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    sheet.style.transition = "";
    then?.();
  };
  sheet.addEventListener("transitionend", finish, { once: true });
  setTimeout(finish, 340);
}

document.addEventListener("pointerdown", (event) => {
  const heading = event.target.closest?.("dialog .dialog-heading");
  if (!heading || !SHEET_QUERY.matches || event.button !== 0) return;
  const sheet = heading.closest("dialog");
  if (!sheet.open || sheet.matches(NOT_SHEETS)) return;
  if (event.target.closest("button, a, input, select, textarea, label")) return;

  const startY = event.clientY;
  let lastY = startY;
  let lastTime = event.timeStamp;
  let speed = 0;
  sheet.classList.add("is-dragging");
  heading.setPointerCapture(event.pointerId);

  const move = (moveEvent) => {
    const distance = Math.max(0, moveEvent.clientY - startY);
    const elapsed = moveEvent.timeStamp - lastTime;
    if (elapsed > 0) speed = (moveEvent.clientY - lastY) / elapsed;
    lastY = moveEvent.clientY;
    lastTime = moveEvent.timeStamp;
    sheet.style.transform = distance ? `translateY(${distance}px)` : "";
  };

  const end = () => {
    heading.removeEventListener("pointermove", move);
    heading.removeEventListener("pointerup", end);
    heading.removeEventListener("pointercancel", end);
    sheet.classList.remove("is-dragging");
    const distance = lastY - startY;
    if (distance > SHEET_CLOSE_DISTANCE || (distance > 20 && speed > SHEET_CLOSE_SPEED)) {
      settleSheet(sheet, "translateY(100%)", () => {
        closeSheetLikeEscape(sheet);
        // Kept open (say, a form that asks first): it slides back.
        if (sheet.open) settleSheet(sheet, "");
        else sheet.style.transform = "";
      });
    } else {
      settleSheet(sheet, "");
    }
  };

  heading.addEventListener("pointermove", move);
  heading.addEventListener("pointerup", end);
  heading.addEventListener("pointercancel", end);
});
