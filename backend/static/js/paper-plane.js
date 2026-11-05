// The window folds into a paper plane and flies away, so the wait for the AI to read
// the route feels like the invitation being sent rather than the app being stuck.
const PLANE_SVG_NS = "http://www.w3.org/2000/svg";
const PLANE_FOLD_START_MS = 500;
const PLANE_FOLD_END_MS = 3100;
const PLANE_DURATION_MS = 5000;
const PLANE_WIDTH_PX = 110;
const PLANE_HEIGHT_PX = 154;

// Each piece of paper, in a 100 × 140 sheet, at each step of the fold: flat, corners
// to the middle, sides to the middle, wings out. Same point count throughout, so
// any step can blend into the next.
const PLANE_FOLD_STEPS = [
  {
    leftBody: [[50.5, 0], [0, 0], [0, 140], [50.5, 140]],
    leftFlap: [[50, 0], [0, 0], [0, 50], [0, 50]],
  },
  {
    leftBody: [[50.5, 0], [0, 50], [0, 140], [50.5, 140]],
    leftFlap: [[50, 0], [50, 50], [0, 50], [0, 50]],
  },
  {
    leftBody: [[50.5, 0], [22, 90], [30, 140], [50.5, 140]],
    leftFlap: [[50, 0], [50, 90], [30, 140], [22, 90]],
  },
  {
    leftBody: [[50.5, 0], [42, 112], [46, 124], [50.5, 124]],
    leftFlap: [[50, 0], [44, 108], [8, 126], [8, 126]],
  },
];

function mirrorPlanePiece(points) {
  return points.map(([x, y]) => [100 - x, y]);
}

function blendPlanePiece(from, to, amount) {
  return from.map(([x, y], index) => [
    x + (to[index][0] - x) * amount,
    y + (to[index][1] - y) * amount,
  ]);
}

function easePlane(amount) {
  return amount < 0.5 ? 2 * amount * amount : 1 - (-2 * amount + 2) ** 2 / 2;
}

// Smooth through the flight's waypoints, instead of turning sharply at each one.
function planeFlightAt(waypoints, progress) {
  const last = waypoints.length - 1;
  const position = Math.min(progress, 0.9999) * last;
  const index = Math.floor(position);
  const local = position - index;
  const point = (offset) => waypoints[Math.max(0, Math.min(last, index + offset))];
  return point(0).map((_, axis) => {
    const [a, b, c, d] = [-1, 0, 1, 2].map((offset) => point(offset)[axis]);
    return (
      0.5 *
      (2 * b +
        (c - a) * local +
        (2 * a - 5 * b + 4 * c - d) * local ** 2 +
        (3 * b - a - 3 * c + d) * local ** 3)
    );
  });
}

function createPlanePiece(svg, className) {
  const piece = document.createElementNS(PLANE_SVG_NS, "polygon");
  piece.setAttribute("class", className);
  piece.setAttribute("vector-effect", "non-scaling-stroke");
  svg.append(piece);
  return piece;
}

// Plays over everything from where `element` sits. `onTakeoff` runs when the folded
// plane leaves, so the window can close behind it.
function playPaperPlane(element, onTakeoff) {
  const rect = element.getBoundingClientRect();
  const layer = document.querySelector("#paper-plane");
  const svg = document.createElementNS(PLANE_SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 140");
  svg.setAttribute("preserveAspectRatio", "none");
  Object.assign(svg.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  const pieces = {
    leftBody: createPlanePiece(svg, "plane-sheet"),
    rightBody: createPlanePiece(svg, "plane-sheet"),
    leftFlap: createPlanePiece(svg, "plane-flap"),
    rightFlap: createPlanePiece(svg, "plane-flap"),
  };
  layer.replaceChildren(svg);
  layer.hidden = false;
  layer.showPopover();

  const { innerWidth: width, innerHeight: height } = window;
  // The window may not be centred, so folding also brings the paper to the screen's centre.
  const toCentreX = width / 2 - (rect.left + rect.width / 2);
  const toCentreY = height / 2 - (rect.top + rect.height / 2);
  // [x, y, turn in degrees, size], counted from the screen's centre.
  const flight = [
    [0, 0, 0, 1],
    [-0.03 * width, 0.06 * height, -18, 1],
    [0.16 * width, -0.1 * height, 58, 0.9],
    [0.34 * width, -0.34 * height, 28, 0.72],
    [0.55 * width, -0.56 * height, 52, 0.55],
    [0.95 * width, -0.95 * height, 58, 0.4],
  ];
  const foldedScaleX = PLANE_WIDTH_PX / rect.width;
  const foldedScaleY = PLANE_HEIGHT_PX / rect.height;
  const startedAt = performance.now();
  let tookOff = false;
  let finish;
  const finished = new Promise((resolve) => {
    finish = resolve;
  });

  function stop() {
    layer.hidePopover();
    layer.hidden = true;
    layer.replaceChildren();
    finish();
  }

  function draw(now) {
    if (layer.hidden) return;
    const elapsed = now - startedAt;
    const foldProgress = Math.min(
      Math.max(elapsed - PLANE_FOLD_START_MS, 0) /
        (PLANE_FOLD_END_MS - PLANE_FOLD_START_MS),
      1,
    );
    const stepCount = PLANE_FOLD_STEPS.length - 1;
    const step = Math.min(Math.floor(foldProgress * stepCount), stepCount - 1);
    const stepAmount = easePlane(foldProgress * stepCount - step);
    const left = (part) =>
      blendPlanePiece(PLANE_FOLD_STEPS[step][part], PLANE_FOLD_STEPS[step + 1][part], stepAmount);
    const drawPiece = (piece, points) =>
      piece.setAttribute("points", points.map((point) => point.join(",")).join(" "));
    drawPiece(pieces.leftBody, left("leftBody"));
    drawPiece(pieces.rightBody, mirrorPlanePiece(left("leftBody")));
    drawPiece(pieces.leftFlap, left("leftFlap"));
    drawPiece(pieces.rightFlap, mirrorPlanePiece(left("leftFlap")));

    // The blank sheet settles over the form first; its folded corners appear as it folds.
    svg.style.opacity = Math.min(elapsed / 350, 1);
    const flapOpacity = Math.min(foldProgress * stepCount * 3, 1);
    pieces.leftFlap.style.opacity = flapOpacity;
    pieces.rightFlap.style.opacity = flapOpacity;

    const shrink = easePlane(foldProgress);
    let [x, y, turn, size] = [0, 0, 0, 1];
    if (elapsed >= PLANE_FOLD_END_MS) {
      if (!tookOff) {
        tookOff = true;
        onTakeoff();
      }
      [x, y, turn, size] = planeFlightAt(
        flight,
        (elapsed - PLANE_FOLD_END_MS) / (PLANE_DURATION_MS - PLANE_FOLD_END_MS),
      );
    }
    const scaleX = (1 + (foldedScaleX - 1) * shrink) * size;
    const scaleY = (1 + (foldedScaleY - 1) * shrink) * size;
    x += toCentreX * shrink;
    y += toCentreY * shrink;
    svg.style.transform = `translate(${x}px, ${y}px) rotate(${turn}deg) scale(${scaleX}, ${scaleY})`;

    if (elapsed >= PLANE_DURATION_MS) stop();
    else requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
  // A hidden tab pauses drawing, but the form must not wait for it to come back.
  setTimeout(() => {
    if (layer.hidden) return;
    if (!tookOff) onTakeoff();
    stop();
  }, PLANE_DURATION_MS + 500);

  return { finished, cancel: stop };
}
