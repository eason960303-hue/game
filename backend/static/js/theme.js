// Runs from <head>, right after the stylesheets, so a saved theme applies before the first paint.
const THEME_STORAGE_KEY = "life-logger-theme";
const systemDarkTheme = window.matchMedia("(prefers-color-scheme: dark)");
const THEME_BAR_COLORS = { light: "#f5f5f7", dark: "#101114" };

// Dark styles live in media queries, so a manual choice retargets those queries
// instead of keeping a second copy of every dark rule.
const darkThemeRules = Array.from(document.styleSheets).flatMap((sheet) =>
  Array.from(sheet.cssRules).filter(
    (rule) =>
      rule instanceof CSSMediaRule &&
      rule.media.mediaText.includes("prefers-color-scheme: dark"),
  ),
);

let chosenTheme = null;

try {
  chosenTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
} catch {
  // Blocked storage only means the choice won't outlive this page.
}

function activeTheme() {
  return chosenTheme || (systemDarkTheme.matches ? "dark" : "light");
}

function applyTheme() {
  const theme = activeTheme();
  darkThemeRules.forEach((rule) => {
    rule.media.mediaText = theme === "dark" ? "all" : "not all";
  });
  document.documentElement.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    .setAttribute("content", THEME_BAR_COLORS[theme]);
  const toggle = document.querySelector("#theme-toggle");
  if (toggle) toggle.textContent = theme === "dark" ? "淺色模式" : "深色模式";
}

function toggleTheme() {
  chosenTheme = activeTheme() === "dark" ? "light" : "dark";
  applyTheme();
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, chosenTheme);
  } catch {
    // Blocked storage only means the choice won't outlive this page.
  }
}

systemDarkTheme.addEventListener("change", applyTheme);
applyTheme();
document.addEventListener("DOMContentLoaded", () => {
  applyTheme();
  document.querySelector("#theme-toggle").addEventListener("click", toggleTheme);
});
