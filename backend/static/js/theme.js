// Runs from <head>, right after the stylesheets, so saved colours apply before the first paint.
const SETTINGS_STORAGE_KEY = "life-logger-settings";
const OLD_THEME_STORAGE_KEY = "life-logger-theme";
const systemDarkTheme = window.matchMedia("(prefers-color-scheme: dark)");

// Colours are in tokens.css; these are the swatches shown when choosing and each theme's base.
const PALETTES = [
  { id: "default", name: "預設", mode: null, swatches: ["#f3f0e8", "#fffefa", "#1f6b57", "#a9cdbd", "#af4526", "#23261f"] },
  { id: "1", name: "莓果", mode: "light", swatches: ["#800021", "#881144", "#243A66", "#C24366", "#FF69B4", "#FFE4D8"] },
  { id: "3", name: "深海", mode: "dark", swatches: ["#05161A", "#072E33", "#0C7075", "#0F969C", "#6DA5C0", "#294D61"] },
  { id: "4", name: "森林", mode: "dark", swatches: ["#0F1F17", "#1E3A2E", "#3E5A3F", "#6B7F67", "#C7CBB8", "#3D4337"] },
  { id: "5", name: "咖啡", mode: "dark", swatches: ["#1A120E", "#3A2418", "#6B4A2E", "#A88462", "#D5C4AE", "#4A4A46"] },
  { id: "7", name: "粉霧", mode: "light", swatches: ["#F7CBCA", "#DDD3D3", "#F1F7F7", "#D5E5E5", "#B0D7D8", "#5D6B6B"] },
  { id: "8", name: "石板", mode: "dark", swatches: ["#06141B", "#11212D", "#253745", "#4A5C6A", "#9BA8AB", "#CCD0CF"] },
  { id: "9", name: "黑白", mode: "dark", swatches: ["#0B0B0B", "#1A1A1A", "#333333", "#6B6B6B", "#D9D9D9", "#FFFFFF"] },
  { id: "10", name: "松綠", mode: "dark", swatches: ["#051F20", "#0B2B26", "#163832", "#235347", "#8EB69B", "#DAF1DE"] },
  { id: "11", name: "日落", mode: "dark", swatches: ["#1F0F12", "#2B1418", "#8A4632", "#FF8A4C", "#FFC65C", "#FFF1E6"] },
  { id: "12", name: "海洋", mode: "light", swatches: ["#EAF4FB", "#D8EAF6", "#9CC3E0", "#14548C", "#B4472B", "#12304A"] },
  { id: "13", name: "薄荷", mode: "light", swatches: ["#EAF7F1", "#D6EFE3", "#8FCDB3", "#0E6E55", "#A8502A", "#12382D"] },
  { id: "14", name: "奶茶", mode: "light", swatches: ["#F5ECE0", "#EBDDCB", "#C9AE8F", "#7A5230", "#A2472A", "#3A2A1C"] },
  { id: "15", name: "薰衣草", mode: "light", swatches: ["#F2EEFA", "#E5DEF5", "#B7A6E3", "#5B3FA8", "#A23A78", "#2A1F4D"] },
  { id: "16", name: "櫻花", mode: "light", swatches: ["#FDF0F3", "#F9DFE6", "#E8A5BA", "#A8325C", "#9A4A1F", "#4A1D2E"] },
  { id: "17", name: "午夜藍", mode: "dark", swatches: ["#0A1128", "#101931", "#3E5490", "#6E9BFF", "#FFC56B", "#EAF0FF"] },
  { id: "18", name: "酒紅", mode: "dark", swatches: ["#1E0A12", "#2B0E19", "#8A3552", "#E56B93", "#F2C27A", "#FBEAF0"] },
  { id: "20", name: "珊瑚", mode: "light", swatches: ["#FFF1EC", "#FFE1D8", "#F2A796", "#B8422C", "#1F6B78", "#40201A"] },
];

// The first choice of each setting is its default. Saved values are checked against these.
const SETTING_CHOICES = {
  palette: PALETTES.map((palette) => palette.id),
  mode: ["system", "light", "dark"],
  footprintPrivacy: ["private", "friends", "public"],
  aiFollowUp: ["on", "off"],
  startPage: ["last", "home"],
  homeDiaries: ["full", "no-photo", "compact"],
};

function validSettings(saved) {
  return Object.fromEntries(
    Object.keys(SETTING_CHOICES)
      .filter((key) => SETTING_CHOICES[key].includes(saved?.[key]))
      .map((key) => [key, saved[key]]),
  );
}

// Blocked storage only means the choices won't outlive this page.
function loadSavedSettings() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY));
    // Before settings existed, the only choice saved was light or dark.
    const oldMode = window.localStorage.getItem(OLD_THEME_STORAGE_KEY);
    return validSettings({ mode: oldMode, ...saved });
  } catch {
    return {};
  }
}

let savedSettings = loadSavedSettings();

function appSetting(key) {
  return savedSettings[key] ?? SETTING_CHOICES[key][0];
}

function saveSettingsLocally(changes) {
  savedSettings = { ...savedSettings, ...validSettings(changes) };
  applyTheme();
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(savedSettings));
    window.localStorage.removeItem(OLD_THEME_STORAGE_KEY);
  } catch {}
}

// Dark styles live in media queries, so a manual choice retargets those queries
// instead of keeping a second copy of every dark rule.
const darkThemeRules = Array.from(document.styleSheets).flatMap((sheet) =>
  Array.from(sheet.cssRules).filter(
    (rule) =>
      rule instanceof CSSMediaRule &&
      rule.media.mediaText.includes("prefers-color-scheme: dark"),
  ),
);

// Added only after the scan above: reading a cross-origin sheet's rules would throw.
// Inserted from script so a slow or blocked font service never delays the first paint.
const displayFont = document.createElement("link");
displayFont.rel = "stylesheet";
displayFont.href =
  "https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@600;700&display=swap";
document.head.append(displayFont);

function activeTheme() {
  const palette = PALETTES.find((item) => item.id === appSetting("palette"));
  if (palette.mode) return palette.mode;
  const mode = appSetting("mode");
  if (mode !== "system") return mode;
  return systemDarkTheme.matches ? "dark" : "light";
}

function applyTheme() {
  const theme = activeTheme();
  const root = document.documentElement;
  darkThemeRules.forEach((rule) => {
    rule.media.mediaText = theme === "dark" ? "all" : "not all";
  });
  if (appSetting("palette") === "default") delete root.dataset.palette;
  else root.dataset.palette = appSetting("palette");
  root.dataset.homeDiaries = appSetting("homeDiaries");
  root.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    .setAttribute("content", getComputedStyle(root).getPropertyValue("--bg").trim());
}

systemDarkTheme.addEventListener("change", applyTheme);
applyTheme();
