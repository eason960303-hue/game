// Only a static preview needs a separate API; a backend on any other PORT serves its own.
const localHosts = new Set(["localhost", "127.0.0.1"]);
const livePreviewPorts = new Set(["5500", "5501"]);
const isFilePreview = window.location.protocol === "file:";
const isLivePreview =
  localHosts.has(window.location.hostname) &&
  livePreviewPorts.has(window.location.port);
const apiBaseUrl =
  isFilePreview || isLivePreview ? "http://127.0.0.1:8000/api" : "/api";

function apiUrl(path) {
  return `${apiBaseUrl}${path}`;
}

// Uploaded files live on the API server, which may not be the page's own origin.
function mediaUrl(url) {
  return url?.startsWith("/api/") ? apiUrl(url.slice(4)) : url;
}

function getFormText(formData, name) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  let response;
  try {
    response = await fetch(apiUrl(path), {
      ...options,
      headers,
      credentials: "include",
    });
  } catch {
    // Stays a TypeError, which is how callers recognise a lost connection.
    throw new TypeError("目前連不上伺服器，請確認網路後再試一次。");
  }
  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") || "";
  const result = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    let message =
      typeof result?.detail === "string"
        ? result.detail
        : `伺服器回應 HTTP ${response.status}`;
    if (Array.isArray(result?.detail)) {
      message = result.detail
        .map((issue) => {
          const field = Array.isArray(issue.loc)
            ? issue.loc.slice(1).join(".")
            : "";
          return `${field ? `${field}：` : ""}${issue.msg}`;
        })
        .join("；");
    }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return result;
}

function jsonOptions(method, payload) {
  return { method, body: JSON.stringify(payload) };
}

function blobOptions(blob) {
  return { method: "POST", headers: { "Content-Type": blob.type }, body: blob };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

// The database stores UTC without saying so.
function serverDate(value) {
  return new Date(`${value.replace(" ", "T")}Z`);
}

const DATE_FORMAT = new Intl.DateTimeFormat("zh-TW", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function formatDate(value) {
  if (!value) return "剛剛";
  const date = serverDate(value);
  return Number.isNaN(date.getTime()) ? value : DATE_FORMAT.format(date);
}

// Recent things read as "5 分鐘前"; older ones as their date and time.
function timeAgo(value) {
  const date = serverDate(value || "");
  const seconds = (Date.now() - date.getTime()) / 1000;
  if (Number.isNaN(seconds)) return value || "";
  if (seconds < 60) return "剛剛";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分鐘前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小時前`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)} 天前`;
  return formatDateTime(value);
}

// Diaries show when in the day they were written, not just the date.
function formatDateTime(value) {
  if (!value) return "剛剛";
  const date = serverDate(value);
  if (Number.isNaN(date.getTime())) return value;
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${formatDate(value)} ${time}`;
}
