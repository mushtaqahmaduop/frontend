/* ─── DAMAM HMS — API CLIENT ─────────────────────────────────────────────────
   Central fetch() wrapper for all backend communication.
   Handles: JWT token injection, error normalization, token expiry redirect.

   All functions return the parsed JSON response or throw an Error.
   ─────────────────────────────────────────────────────────────────────────── */

'use strict';

// ── Token management ──────────────────────────────────────────────────────────
// We use sessionStorage (not localStorage) so the token is cleared on tab close.
// This matches the existing app's session behaviour.

function _getToken()       { return sessionStorage.getItem('jwt_token') || ''; }
function _setToken(tok)    { sessionStorage.setItem('jwt_token', tok); }
function _clearToken()     { sessionStorage.removeItem('jwt_token'); sessionStorage.removeItem('h_auth'); }

// ── Core fetch wrapper ────────────────────────────────────────────────────────
async function _apiFetch(path, options) {
  options = options || {};
  const url = API_BASE_URL + path;

  const headers = { 'Content-Type': 'application/json' };
  const token = _getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const config = {
    method:  options.method  || 'GET',
    headers: Object.assign(headers, options.headers || {}),
  };

  if (options.body !== undefined) {
    config.body = typeof options.body === 'string'
      ? options.body
      : JSON.stringify(options.body);
  }

  let res;
  try {
    res = await fetch(url, config);
  } catch (networkErr) {
    // Server is unreachable — show offline warning
    throw new Error('Cannot reach server. Check your internet connection.');
  }

  // Token expired or invalid — force logout
  if (res.status === 401) {
    _clearToken();
    if (typeof toast === 'function') toast('Session expired. Please log in again.', 'error');
    setTimeout(() => location.reload(), 1500);
    throw new Error('Unauthorized');
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.message || 'Server error ' + res.status);
  }

  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────────

// Returns { token, user } on success
async function apiLogin(role, password) {
  const data = await _apiFetch('/api/auth/login', {
    method: 'POST',
    body:   { role, password }
  });
  if (data.token) _setToken(data.token);
  return data;
}

// Returns { warden1: {...}, warden2: {...} }
async function apiGetWardens() {
  return _apiFetch('/api/auth/wardens');
}

async function apiUpdateWarden(role, updates) {
  return _apiFetch('/api/auth/wardens/' + role, { method: 'PUT', body: updates });
}

async function apiChangePassword(role, currentPass, newPass) {
  return _apiFetch('/api/auth/wardens/' + role + '/password', {
    method: 'PUT',
    body: { currentPass, newPass }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DB SYNC  (replaces loadDB / saveDB)
// ─────────────────────────────────────────────────────────────────────────────

// Loads the full DB from MongoDB into the in-memory DB variable
async function apiLoadDB() {
  const data = await _apiFetch('/api/sync');
  // Merge into the global DB object (keeps existing references alive)
  Object.assign(DB, data);
  if (typeof _initDBFields === 'function') Object.assign(DB, _initDBFields(DB));
  return DB;
}

// Saves the full in-memory DB to MongoDB
// Debounced by the storage.js wrapper so rapid saves don't flood the server
async function apiSaveDB() {
  try {
    await _apiFetch('/api/sync', { method: 'POST', body: DB });
    return true;
  } catch (err) {
    console.error('[API] saveDB failed:', err.message);
    if (typeof toast === 'function')
      toast('⚠️ Auto-save failed: ' + err.message, 'error');
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGO  (replaces localStorage hostel_logo_hostel_1)
// ─────────────────────────────────────────────────────────────────────────────

async function apiGetLogo() {
  const data = await _apiFetch('/api/sync/logo');
  return data.logo || '';
}

async function apiSaveLogo(base64DataUrl) {
  return _apiFetch('/api/sync/logo', { method: 'POST', body: { logo: base64DataUrl } });
}

// ─────────────────────────────────────────────────────────────────────────────
// ARCHIVE  (replaces localStorage dbh2_archive)
// ─────────────────────────────────────────────────────────────────────────────

async function apiGetArchive() {
  return _apiFetch('/api/sync/archive');
}

async function apiSaveArchive(archiveObj) {
  return _apiFetch('/api/sync/archive', { method: 'POST', body: archiveObj });
}

// ─────────────────────────────────────────────────────────────────────────────
// INDIVIDUAL COLLECTION ENDPOINTS  (optional — for future granular updates)
// ─────────────────────────────────────────────────────────────────────────────

async function apiAddStudent(student)          { return _apiFetch('/api/students',       { method: 'POST',   body: student }); }
async function apiUpdateStudent(id, updates)   { return _apiFetch('/api/students/'+id,   { method: 'PUT',    body: updates }); }
async function apiDeleteStudent(id)            { return _apiFetch('/api/students/'+id,   { method: 'DELETE' }); }

async function apiAddRoom(room)                { return _apiFetch('/api/rooms',          { method: 'POST',   body: room }); }
async function apiUpdateRoom(id, updates)      { return _apiFetch('/api/rooms/'+id,      { method: 'PUT',    body: updates }); }
async function apiDeleteRoom(id)               { return _apiFetch('/api/rooms/'+id,      { method: 'DELETE' }); }

async function apiAddPayment(payment)          { return _apiFetch('/api/payments',       { method: 'POST',   body: payment }); }
async function apiUpdatePayment(id, updates)   { return _apiFetch('/api/payments/'+id,   { method: 'PUT',    body: updates }); }
async function apiDeletePayment(id)            { return _apiFetch('/api/payments/'+id,   { method: 'DELETE' }); }

async function apiAddExpense(expense)          { return _apiFetch('/api/expenses',       { method: 'POST',   body: expense }); }
async function apiUpdateExpense(id, updates)   { return _apiFetch('/api/expenses/'+id,   { method: 'PUT',    body: updates }); }
async function apiDeleteExpense(id)            { return _apiFetch('/api/expenses/'+id,   { method: 'DELETE' }); }

async function apiUpdateSettings(settings)     { return _apiFetch('/api/settings',       { method: 'PUT',    body: settings }); }
