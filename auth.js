/* ─── DAMAM HMS — AUTH (WEB VERSION) ─────────────────────────────────────────
   Replaces src/auth.js.
   - Login now calls apiLogin() → receives JWT from backend
   - Password hashing is done server-side (bcrypt) — no SHA-256 on client
   - Session stored in sessionStorage (same as before)
   - All UI code (selectWarden, updateRoleBadge, logout) stays identical
   ─────────────────────────────────────────────────────────────────────────── */

'use strict';

// ── Warden config (loaded from API on startup) ────────────────────────────────
// Matches the original WARDENS shape so all existing canDo() calls work.
var WARDENS = {
  warden1: { name: 'Warden 1', phone: '', canDelete: true,  canSettings: true,  canEdit: true },
  warden2: { name: 'Warden 2', phone: '', canDelete: true,  canSettings: false, canEdit: true }
};
var USERS    = WARDENS;       // backwards-compat alias
var CUR_ROLE = 'warden1';
var CUR_USER = WARDENS.warden1;

function canDo(p) { return CUR_USER ? CUR_USER[p] !== false : false; }

// ── Load warden names/photos for the login screen (public endpoint) ───────────
(async function _loadWardenProfiles() {
  try {
    const data = await apiGetWardens();
    if (data.warden1) WARDENS.warden1 = { ...WARDENS.warden1, ...data.warden1 };
    if (data.warden2) WARDENS.warden2 = { ...WARDENS.warden2, ...data.warden2 };
    USERS    = WARDENS;
    CUR_USER = WARDENS[CUR_ROLE];

    // Update login screen name labels
    const b1 = document.getElementById('wb1-name');
    const b2 = document.getElementById('wb2-name');
    if (b1) b1.textContent = WARDENS.warden1.name;
    if (b2) b2.textContent = WARDENS.warden2.name;

    // Update warden avatars if photos exist
    ['warden1', 'warden2'].forEach(function(k) {
      if (WARDENS[k] && WARDENS[k].photo) {
        var card    = document.getElementById('rb-' + k);
        if (card) {
          var emojiEl = card.querySelector('.warden-login-emoji');
          if (emojiEl) {
            emojiEl.innerHTML = '<img src="' + WARDENS[k].photo
              + '" style="width:40px;height:40px;border-radius:10px;object-fit:cover;border:2px solid rgba(200,168,75,0.5)">';
          }
        }
      }
    });
  } catch (e) {
    // Server might be offline on first load — names stay as defaults
    console.warn('[Auth] Could not load warden profiles:', e.message);
  }
})();

// ── Warden selector (unchanged from original) ─────────────────────────────────
function selectWarden(key) {
  CUR_ROLE = key;
  ['warden1', 'warden2'].forEach(function(x) {
    var el = document.getElementById('rb-' + x);
    if (!el) return;
    el.style.border     = x === key ? '2px solid #c8a84b' : '2px solid #1e3050';
    el.style.background = x === key ? 'rgba(200,168,75,0.12)' : 'transparent';
  });
  var w = WARDENS[key];
  var h = document.getElementById('login-hint');
  if (h) h.textContent = 'Logging in as: ' + w.name;
}

// ── Login handler — now calls the backend API ─────────────────────────────────
async function checkLogin() {
  var inputEl = document.getElementById('login-input');
  var errorEl = document.getElementById('login-error');
  var btnEl   = document.getElementById('login-btn');

  if (!inputEl) return;
  var password = inputEl.value.trim();
  if (!password) { inputEl.focus(); return; }

  // Disable button to prevent double-click
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Logging in…'; }

  try {
    // apiLogin() sends role + password to /api/auth/login and stores the JWT
    var result = await apiLogin(CUR_ROLE, password);

    // Merge returned user profile into WARDENS
    WARDENS[CUR_ROLE] = Object.assign(WARDENS[CUR_ROLE], result.user || {});
    CUR_USER = WARDENS[CUR_ROLE];

    // Mark session as authenticated
    sessionStorage.setItem('h_auth', '1');
    sessionStorage.setItem('h_role', CUR_ROLE);

    document.getElementById('login-screen').style.display = 'none';
    updateRoleBadge();

    if (typeof showSplashScreen === 'function') showSplashScreen();

  } catch (err) {
    // Show wrong-password error
    if (errorEl) {
      errorEl.textContent = err.message === 'Wrong password.'
        ? 'Wrong password. Try again.'
        : (err.message || 'Login failed.');
      errorEl.style.display = 'block';
    }
    inputEl.value = '';
    inputEl.focus();
    setTimeout(function() { if (errorEl) errorEl.style.display = 'none'; }, 2500);
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = '&#x1F513; Login'; }
  }
}

// ── Attach login button + Enter-key ──────────────────────────────────────────
(function attachLoginHandlers() {
  function _doAttach() {
    var btn = document.getElementById('login-btn');
    var inp = document.getElementById('login-input');
    if (btn) btn.addEventListener('click', checkLogin);
    if (inp) inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') checkLogin(); });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _doAttach);
  } else {
    _doAttach();
  }
})();

// ── Role badge (header) — unchanged ──────────────────────────────────────────
function updateRoleBadge() {
  var b = document.getElementById('role-badge');
  if (!b) return;
  var photoHtml = (CUR_USER && CUR_USER.photo)
    ? '<img src="' + CUR_USER.photo + '" style="width:22px;height:22px;border-radius:6px;object-fit:cover;border:1.5px solid rgba(200,168,75,0.5);flex-shrink:0">'
    : '<span style="font-size:14px">&#x1F9D1;&#x200D;&#x1F4BC;</span>';
  b.innerHTML       = photoHtml + '&nbsp;' + escHtml(CUR_USER ? CUR_USER.name : '');
  b.style.display   = 'flex';
  b.style.alignItems = 'center';
  b.style.gap       = '6px';
}

// ── Logout ────────────────────────────────────────────────────────────────────
function logout() {
  sessionStorage.removeItem('h_auth');
  sessionStorage.removeItem('h_role');
  sessionStorage.removeItem('jwt_token');
  location.reload();
}

// ── Restore session on page reload ───────────────────────────────────────────
var _sr = sessionStorage.getItem('h_role') || 'warden1';
if (!WARDENS[_sr]) _sr = 'warden1';
CUR_ROLE = _sr;
CUR_USER = WARDENS[_sr];

if (sessionStorage.getItem('h_auth') === '1') {
  document.getElementById('login-screen').style.display = 'none';
  selectWarden(_sr);
  setTimeout(updateRoleBadge, 300);
} else {
  selectWarden('warden1');
}

// ── Change warden password (called from Settings page) ────────────────────────
// Replaces the old hashNewPassword() function
async function hashNewPassword(plain) {
  // Validation only — actual hashing is done on the server
  if (!plain || plain.length < 4) throw new Error('Password must be at least 4 characters.');
  if (plain.length > 100) throw new Error('Password too long (max 100 characters).');
  return plain; // return plain — apiChangePassword() sends it to backend
}

// ── updateLoginAvatar (called from settings warden save) ─────────────────────
function updateLoginAvatar(role) {
  var w    = WARDENS[role];
  var card = document.getElementById('rb-' + role);
  if (!card || !w) return;
  var emojiEl = card.querySelector('.warden-login-emoji');
  if (!emojiEl) return;
  if (w.photo) {
    emojiEl.innerHTML = '<img src="' + w.photo
      + '" style="width:40px;height:40px;border-radius:10px;object-fit:cover;border:2px solid rgba(200,168,75,0.5)">';
  } else {
    emojiEl.innerHTML = '&#x1F9D1;&#x200D;&#x1F4BC;';
  }
}

// ── saveWardenConfig — now calls the API instead of localStorage ──────────────
function saveWardenConfig() {
  // Non-blocking — just sync to backend in background
  apiUpdateWarden('warden1', {
    name:        WARDENS.warden1.name,
    phone:       WARDENS.warden1.phone,
    photo:       WARDENS.warden1.photo,
    canDelete:   WARDENS.warden1.canDelete,
    canSettings: WARDENS.warden1.canSettings,
    canEdit:     WARDENS.warden1.canEdit
  }).catch(console.error);
  apiUpdateWarden('warden2', {
    name:        WARDENS.warden2.name,
    phone:       WARDENS.warden2.phone,
    photo:       WARDENS.warden2.photo,
    canDelete:   WARDENS.warden2.canDelete,
    canSettings: WARDENS.warden2.canSettings,
    canEdit:     WARDENS.warden2.canEdit
  }).catch(console.error);
}
