const settingsDialog = document.querySelector("#settings-dialog");
const settingsForm = document.querySelector("#settings-form");
const paletteOptions = document.querySelector("#settings-palettes");
const SERVER_SETTING_PREFIX = "web.";

const MODE_NAMES = { light: "淺色", dark: "深色" };

// In 串文 the default theme is black and white, so it is named and shown that way.
const THREAD_DEFAULT_PALETTE = {
  name: "黑白簡約",
  swatches: ["#ffffff", "#f5f5f5", "#d4d4d4", "#737373", "#101010", "#000000"],
};

function shownPalette(palette) {
  return palette.id === "default" && appSetting("look") === "thread"
    ? { ...palette, ...THREAD_DEFAULT_PALETTE }
    : palette;
}

function paletteOptionHtml(palette) {
  return `
    <label class="palette-option">
      <input type="radio" name="palette" value="${palette.id}" />
      <span class="palette-swatches" aria-hidden="true">
        ${palette.swatches.map((color) => `<i style="background:${color}"></i>`).join("")}
      </span>
      <span class="palette-name">${palette.name}${palette.mode ? "" : "<small>預設</small>"}</span>
    </label>`;
}

// The default follows the light/dark choice, so it leads the light group, where it starts out.
// Drawn again only when the look changes its name, so a click keeps its focus.
let paletteOptionsLook = null;

function renderPaletteOptions() {
  if (paletteOptionsLook === appSetting("look")) return;
  paletteOptionsLook = appSetting("look");
  paletteOptions.innerHTML = [
    ["淺色", PALETTES.filter((palette) => palette.mode !== "dark")],
    ["深色", PALETTES.filter((palette) => palette.mode === "dark")],
  ]
    .map(
      ([title, palettes]) => `
        <div class="palette-group">
          <span class="palette-group-title">${title}</span>
          <div class="palette-options">${palettes.map(shownPalette).map(paletteOptionHtml).join("")}</div>
        </div>`,
    )
    .join("");
}

function showSettings() {
  renderPaletteOptions();
  const { elements } = settingsForm;
  const palette = shownPalette(
    PALETTES.find((item) => item.id === appSetting("palette")) || PALETTES[0],
  );
  elements.look.value = appSetting("look");
  elements.layout.value = appSetting("layout");
  elements.palette.value = palette.id;
  elements.footprintPrivacy.value = appSetting("footprintPrivacy");
  elements.startPage.value = appSetting("startPage");
  elements.homeDiaries.value = appSetting("homeDiaries");
  elements.homeMeetups.checked = appSetting("homeMeetups") === "on";
  elements.homeFootprints.checked = appSetting("homeFootprints") === "on";
  elements.aiFollowUp.checked = appSetting("aiFollowUp") === "on";
  document.querySelector("#settings-palette-current").textContent = `目前：${palette.name}`;
  // A colour theme already decides light or dark, so the choice shows it and is locked
  // until the default is picked again; the saved choice is kept for then.
  elements.mode.value = palette.mode || appSetting("mode");
  for (const input of elements.mode) input.disabled = Boolean(palette.mode);
  document.querySelector("#settings-mode").classList.toggle("is-locked", Boolean(palette.mode));
  document.querySelector("#settings-mode-note").textContent = palette.mode
    ? `「${palette.name}」主題固定是${MODE_NAMES[palette.mode]}，換回「${shownPalette(PALETTES[0]).name}」才能切換。`
    : "";
}

async function changeSetting(key, value) {
  saveSettingsLocally({ [key]: value });
  showSettings();
  if (!currentUser) return;
  try {
    await apiRequest(
      "/settings",
      jsonOptions("PUT", { key: `${SERVER_SETTING_PREFIX}${key}`, value }),
    );
  } catch {
    showToast("設定只存在這台裝置，沒有同步到帳號。");
  }
}

// Another device's choices win, so an account looks the same everywhere it signs in.
async function loadSettingsFromAccount() {
  try {
    const rows = await apiRequest("/settings");
    saveSettingsLocally(
      Object.fromEntries(
        rows
          .filter((row) => row.key.startsWith(SERVER_SETTING_PREFIX))
          .map((row) => [row.key.slice(SERVER_SETTING_PREFIX.length), row.value]),
      ),
    );
    showSettings();
  } catch {
    // The choices saved on this device still apply.
  }
}

settingsForm.addEventListener("submit", (event) => event.preventDefault());
settingsForm.addEventListener("change", (event) => {
  const { name, type, checked, value } = event.target;
  if (!(name in SETTING_CHOICES)) return;
  changeSetting(name, type === "checkbox" ? (checked ? "on" : "off") : value);
});

const settingsOpenButton = document.querySelector("#settings-open");

// Started from script so every click spins again, even one made mid-spin.
function spinSettingsIcon() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  settingsOpenButton
    .querySelector("svg")
    .animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], {
      duration: 700,
      easing: "cubic-bezier(0.34, 1.2, 0.64, 1)",
    });
}

settingsOpenButton.addEventListener("click", () => {
  spinSettingsIcon();
  showSettings();
  settingsDialog.showModal();
});
document
  .querySelector("#settings-dismiss")
  .addEventListener("click", () => settingsDialog.close());
