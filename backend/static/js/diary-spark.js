// A saved AI diary gathers into a point of light and travels to 我的日記, where it then appears.
const SPARK_GATHER_MS = 900;
const SPARK_FLIGHT_MS = 4000;
const SPARK_MIN_FLIGHT_MS = 1800;
const SPARK_PX_PER_MS = 0.2;
const SPARK_SIZE_PX = 16;

function diarySparkTarget() {
  const inView = (element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight;
  };
  // On a phone the list is far down the page, so its button at the top stands in for it.
  return [
    document.querySelector("#diary-month-title"),
    document.querySelector('[data-empty-action="diary-list"]'),
  ].find(inView);
}

function elementCentre(element) {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

// Carries the spark to the target along an arc. It can be picked up on the way and dragged
// anywhere; let go, it sets off again from there. Resolves once it has arrived.
function carrySparkTo(spark, target, start) {
  return new Promise((resolve) => {
    const position = { ...start };
    let from = position;
    let bend = { x: 0, y: 0 };
    let duration = SPARK_FLIGHT_MS;
    let startedAt = 0;
    let held = false;
    let grabOffset = { x: 0, y: 0 };

    const place = (scale) => {
      const half = SPARK_SIZE_PX / 2;
      spark.style.transform = `translate(${position.x - half}px, ${position.y - half}px) scale(${scale})`;
    };

    const setOff = () => {
      from = { ...position };
      const end = elementCentre(target);
      const distance = Math.hypot(end.x - from.x, end.y - from.y);
      duration = Math.min(
        Math.max(distance / SPARK_PX_PER_MS, SPARK_MIN_FLIGHT_MS),
        SPARK_FLIGHT_MS,
      );
      bend = {
        x: (from.x + end.x) / 2,
        y: (from.y + end.y) / 2 - Math.min(70, distance * 0.25),
      };
      startedAt = performance.now();
      requestAnimationFrame(fly);
    };

    function fly(now) {
      if (held) return;
      // The tab was changed, so there's nowhere left to land.
      if (target.getBoundingClientRect().width === 0) {
        resolve();
        return;
      }
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased =
        progress < 0.5 ? 2 * progress ** 2 : 1 - (-2 * progress + 2) ** 2 / 2;
      const end = elementCentre(target);
      const rest = 1 - eased;
      position.x = rest ** 2 * from.x + 2 * rest * eased * bend.x + eased ** 2 * end.x;
      position.y = rest ** 2 * from.y + 2 * rest * eased * bend.y + eased ** 2 * end.y;
      place(progress < 0.6 ? 1.15 : 1.15 - ((progress - 0.6) / 0.4) * 0.65);
      if (progress === 1) resolve();
      else requestAnimationFrame(fly);
    }

    spark.addEventListener("pointerdown", (event) => {
      held = true;
      spark.setPointerCapture(event.pointerId);
      spark.classList.add("is-held");
      grabOffset = { x: position.x - event.clientX, y: position.y - event.clientY };
      place(1.4);
    });
    spark.addEventListener("pointermove", (event) => {
      if (!held) return;
      position.x = Math.min(Math.max(event.clientX + grabOffset.x, 0), window.innerWidth);
      position.y = Math.min(Math.max(event.clientY + grabOffset.y, 0), window.innerHeight);
      place(1.4);
    });
    const letGo = () => {
      if (!held) return;
      held = false;
      spark.classList.remove("is-held");
      setOff();
    };
    spark.addEventListener("pointerup", letGo);
    spark.addEventListener("pointercancel", letGo);

    place(1);
    setOff();
  });
}

async function flyDiaryToList(bubble) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const target = diarySparkTarget();
  const from = bubble.getBoundingClientRect();
  if (!target || from.width === 0) return;

  const centre = { x: from.left + from.width / 2, y: from.top + from.height / 2 };
  const spark = document.createElement("div");
  spark.className = "diary-spark";
  spark.setAttribute("aria-hidden", "true");
  const words = document.createElement("span");
  words.textContent = bubble.firstChild?.textContent || "";
  spark.append(words);
  document.body.append(spark);

  words.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: SPARK_GATHER_MS * 0.6,
    fill: "forwards",
  });
  const gather = spark.animate(
    [
      {
        left: `${from.left}px`,
        top: `${from.top}px`,
        width: `${from.width}px`,
        height: `${from.height}px`,
        borderRadius: "16px",
        boxShadow: "0 0 0 0 var(--accent)",
      },
      {
        left: `${centre.x - SPARK_SIZE_PX / 2}px`,
        top: `${centre.y - SPARK_SIZE_PX / 2}px`,
        width: `${SPARK_SIZE_PX}px`,
        height: `${SPARK_SIZE_PX}px`,
        borderRadius: "50%",
        backgroundColor: "var(--accent)",
        boxShadow: "0 0 18px 7px var(--accent)",
      },
    ],
    { duration: SPARK_GATHER_MS, easing: "cubic-bezier(0.55, 0, 0.3, 1)", fill: "forwards" },
  );
  await gather.finished;
  words.remove();
  spark.classList.add("is-flying");
  gather.cancel();

  await carrySparkTo(spark, target, centre);
  spark.remove();

  if (target.getBoundingClientRect().width === 0) return;
  target.animate(
    [{ transform: "scale(1)" }, { transform: "scale(1.12)" }, { transform: "scale(1)" }],
    { duration: 320, easing: "ease-out" },
  );
}

// Shows the month the diary went into, and marks it so the eye lands on it.
function revealNewDiary(entry) {
  const button = diaryMonthList.querySelector(`[data-delete-entry="${Number(entry.id)}"]`);
  const item = button?.closest(".diary-month-entry");
  if (!item) return;
  diaryMonthList.scrollTop = 0;
  item.classList.add("is-new");
  item.addEventListener("animationend", () => item.classList.remove("is-new"), { once: true });
}
