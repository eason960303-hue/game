const resendVerificationButton = document.querySelector("#resend-verification");
const entriesContainer = document.querySelector("#entries");
const entryCount = document.querySelector("#entry-count");
const meetupDialog = document.querySelector("#meetup-dialog");
const meetupForm = document.querySelector("#meetup-form");
const meetupFormTitle = document.querySelector("#meetup-form-title");
const meetupSubmitButton = document.querySelector("#meetup-submit");
const meetupCount = document.querySelector("#meetup-count");
const meetupList = document.querySelector("#meetup-list");
const meetupLoadError = document.querySelector("#meetup-load-error");
const meetupLoadErrorMessage = document.querySelector("#meetup-load-error-message");
const timelineFootprints = document.querySelector("#timeline-footprints");
const dialog = document.querySelector("#entry-dialog");
const form = document.querySelector("#entry-form");
const statusMessage = document.querySelector("#form-status");
const saveButton = document.querySelector("#save-entry");
const loadError = document.querySelector("#load-error");
const loadErrorMessage = document.querySelector("#load-error-message");
const homeView = document.querySelector("#home-view");
const profileView = document.querySelector("#profile-view");
const profilePageTitle = document.querySelector("#profile-page-title");
const profileAvatar = document.querySelector("#profile-avatar");
const profileAvatarOpen = document.querySelector("#profile-avatar-open");
const avatarViewer = document.querySelector("#avatar-viewer");
const profileAvatarInitial = document.querySelector("#profile-avatar-initial");
const profileDisplayName = document.querySelector("#profile-display-name");
const profileBio = document.querySelector("#profile-bio");
const profilePostsCount = document.querySelector("#profile-posts-count");
const profileFollowersCount = document.querySelector("#profile-followers-count");
const profileFollowingCount = document.querySelector("#profile-following-count");
const profileDiariesGrid = document.querySelector("#profile-diaries-grid");
const profileFootprintsGrid = document.querySelector("#profile-footprints-grid");
const profileDiariesCount = document.querySelector("#profile-diaries-count");
const profileFootprintsCount = document.querySelector("#profile-footprints-count");
const profileLoadError = document.querySelector("#profile-load-error");
const profileLoadErrorMessage = document.querySelector("#profile-load-error-message");
const profileEditDialog = document.querySelector("#profile-edit-dialog");
const profileEditForm = document.querySelector("#profile-edit-form");
const profileEditStatus = document.querySelector("#profile-edit-status");
const profileEditSaveButton = document.querySelector("#profile-edit-save");
const profileSocialDialog = document.querySelector("#profile-social-dialog");
const profileSocialList = document.querySelector("#profile-social-list");
const profileSocialTitle = document.querySelector("#profile-social-title");
const profileSocialDescription = document.querySelector("#profile-social-description");
const aiDiaryView = document.querySelector("#ai-diary-view");
const aiChatForm = document.querySelector("#ai-chat-form");
const aiChatInput = document.querySelector("#ai-chat-input");
const aiChatMessages = document.querySelector("#ai-chat-messages");
const aiChatSendButton = document.querySelector("#ai-chat-send");
const aiProviderStatus = document.querySelector("#ai-provider-status");
const mapView = document.querySelector("#map-view");
const tripsView = document.querySelector("#trips-view");
const serverStatusDot = document.querySelector("#server-status-dot");
const serverStatusLabel = document.querySelector("#server-status-label");
const serverStatusDetail = document.querySelector("#server-status-detail");
const accountSearchForm = document.querySelector("#account-search-form");
const accountSearchInput = document.querySelector("#account-search-input");
const accountSearchResults = document.querySelector("#account-search-results");
const photoInput = document.querySelector("#entry-photo");
const photoPreview = document.querySelector("#photo-preview");
const photoPreviewImage = document.querySelector("#photo-preview-image");
const photoFileName = document.querySelector("#photo-file-name");
const selectedMood = document.querySelector("#selected-mood");
const mapPointsContainer = document.querySelector("#map-points");
const mapPointCount = document.querySelector("#map-point-count");
const mapPickBanner = document.querySelector("#map-pick-banner");
const mapPanel = document.querySelector(".map-panel");
const routePointList = document.querySelector("#route-point-list");
const mapPointDialogTitle = document.querySelector("#map-point-dialog-title");
const mapPointSaveButton = document.querySelector("#map-point-save");
const tripPointOptions = document.querySelector("#trip-point-options");
const tripList = document.querySelector("#trip-list");
const tripFormTitle = document.querySelector("#trip-form-title");
const tripSubmitButton = document.querySelector("#trip-submit");
const tripCancelEditButton = document.querySelector("#trip-cancel-edit");
const tripAddFootprintButton = document.querySelector("#trip-add-footprint");
const mapPointForm = document.querySelector("#map-point-form");
const mapPointDialog = document.querySelector("#map-point-dialog");
const tripForm = document.querySelector("#trip-form");
const loginDialog = document.querySelector("#login-dialog");
const loginForm = document.querySelector("#login-form");
const loginStatus = document.querySelector("#login-status");
const loginOpenButton = document.querySelector("#login-open");
const accountName = document.querySelector("#account-name");
const logoutButton = document.querySelector("#logout-button");
const loginModeToggle = document.querySelector("#auth-mode-toggle");
const loginSubmitButton = document.querySelector("#login-submit");
const displayNameField = document.querySelector("#display-name-field");
const oauthSetupNote = document.querySelector("#oauth-setup-note");
const forgotPasswordOpenButton = document.querySelector("#forgot-password-open");
const forgotPasswordDialog = document.querySelector("#forgot-password-dialog");
const forgotPasswordForm = document.querySelector("#forgot-password-form");
const forgotPasswordEmail = document.querySelector("#forgot-password-email");
const forgotPasswordStatus = document.querySelector("#forgot-password-status");
const resetPasswordDialog = document.querySelector("#reset-password-dialog");
const resetPasswordForm = document.querySelector("#reset-password-form");
const resetPasswordStatus = document.querySelector("#reset-password-status");
let currentUser = null;
let currentProfile = null;
let viewedProfile = null;
let viewedUsername = null;
const profileEditOpen = document.querySelector("#profile-edit-open");
const themeToggle = document.querySelector("#theme-toggle");
const profileFollowButton = document.querySelector("#profile-follow");
const profileRequestsOpen = document.querySelector("#profile-requests-open");
const profileRequestsCount = document.querySelector("#profile-requests-count");
const profilePostsTitle = document.querySelector("#profile-posts-title");
const navRequestsBadge = document.querySelector("#nav-requests-badge");
const avatarViewerImage = document.querySelector("#avatar-viewer-image");
const PRIVACY_LABELS = { private: "私密", public: "公開", friends: "摯友", followers: "追蹤者" };

let listLoads = new WeakMap();

// A placeholder only appears when a list would otherwise show someone else's data.
// A refresh of the same data keeps what is on screen, and the newest request wins.
function beginListLoad(container, owner, placeholder) {
  const isNewOwner = listLoads.get(container)?.owner !== owner;
  if (isNewOwner) container.innerHTML = placeholder;
  const load = { owner };
  listLoads.set(container, load);
  return { isNewOwner, isCurrent: () => listLoads.get(container) === load };
}

// After an error the list shows a message, so the next load starts from a placeholder.
function forgetListLoad(...containers) {
  containers.forEach((container) => listLoads.delete(container));
}

// Signing out cancels every load in flight and forces the next user to start clean.
function resetListLoads() {
  listLoads = new WeakMap();
}

function sessionOwner() {
  return currentUser?.id ?? "anonymous";
}
let profilePosts = [];
let currentSocialRelation = null;
let editingEntryId = null;
let expandedProfileDiaryId = null;
let expandedProfileFootprintId = null;
let registering = false;
let pendingVerificationEmail = null;
let pendingPasswordResetToken = null;
let photoPreviewUrl = null;
let map = null;
let mapMarkers = new Map();
let mapRoute = null;
let mapInfoWindow = null;
let googleMapsLoad = null;
let mapPoints = [];
let selectedMapPointId = null;
const mapPointDetailAnimations = new Map();
let embeddedMapUpdatePending = false;
const rowLookups = new WeakMap();
const closedMapRegions = new Set();
let routeSuggestTimer = null;
let uncheckedRouteWarning = "";
let pickingMapPoint = false;
let savedMapPointForm = "";
let pendingMapPickRow = null;
let mapPickReturnScrollY = 0;
let editingMapPointId = null;
let editingTripId = null;
let addingFootprintToTripForm = false;
let trips = [];
let meetups = [];
let savedMeetupForm = "";
let editingMeetupId = null;
