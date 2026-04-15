
/* ─── DAMAM HMS — STORAGE (WEB VERSION) ──────────────────────────────────────
   Replaces src/storage.js.
   All localStorage read/write is replaced with API calls via api.js.
   The in-memory DB variable is still used identically by all UI code.

   Key changes:
   - loadDB()    → fetches from /api/sync (GET)
   - saveDB()    → posts  to  /api/sync (POST) — debounced to avoid flood
   - logActivity → still works in-memory, saved on next saveDB()
   - Cross-tab sync → replaced with a polling approach (optional)
   ─────────────────────────────────────────────────────────────────────────── */

'use strict';

// ── Save debounce — batches rapid saves into one request every 1.5 seconds ───
let _saveTimer = null;
const SAVE_DEBOUNCE_MS = 1500;

// ── loadDB — fetch full DB from backend ───────────────────────────────────────
async function loadDB() {
  // ✅ FIX: Don't load if user is not logged in yet
  if (!sessionStorage.getItem('jwt_token')) return;

  try {
    await apiLoadDB();         // fills global DB via api.js
  } catch (err) {
    console.error('[DAMAM] loadDB failed:', err.message);
    setTimeout(function() {
      if (typeof toast === 'function')
        toast('⚠️ Could not load data from server: ' + err.message, 'error', 6000);
    }, 800);
  }

  if (typeof _initDBFields === 'function') Object.assign(DB, _initDBFields(DB));
  _checkBackupReminder();
}

// ── saveDB — persist in-memory DB to backend (debounced) ─────────────────────
function saveDB() {
  // ✅ FIX: Don't save if user is not logged in yet
  if (!sessionStorage.getItem('jwt_token')) return true;

  if (typeof enforceDataRetention === 'function') enforceDataRetention().catch(console.error);

  // Debounce: cancel pending save and schedule a new one
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async function() {
    const ok = await apiSaveDB();

    if (ok) {
      if (typeof updateSidebar         === 'function') updateSidebar();
      if (typeof renderSidebarCalendar === 'function') renderSidebarCalendar();
    }
  }, SAVE_DEBOUNCE_MS);

  return true; // return true immediately so callers don't block
}

// ── Activity log — unchanged, stays in-memory ─────────────────────────────────
function logActivity(action, details, category) {
  details  = details  || '';
  category = category || 'General';
  if (!DB.activityLog) DB.activityLog = [];
  var byName  = (typeof CUR_USER !== 'undefined' && CUR_USER && CUR_USER.name) ? CUR_USER.name : '';
  var _logNow = new Date();
  DB.activityLog.unshift({
    id: 'al_' + uid(), action, details, category, by: byName,
    date: _logNow.toISOString().split('T')[0],
    time: _logNow.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })
  });

  if (DB.activityLog.length >= 180 && DB.activityLog.length < 200) {
    setTimeout(function() {
      if (typeof toast === 'function')
        toast('📋 Activity log is almost full (' + DB.activityLog.length + '/200). Consider exporting it.', 'warning', 5000);
    }, 500);
  }
  if (DB.activityLog.length > 200) DB.activityLog = DB.activityLog.slice(0, 200);
}

// ── Backup reminder (7-day nudge) ─────────────────────────────────────────────
function _checkBackupReminder() {
  try {
    var last = DB.settings && DB.settings.lastBackupReminder
      ? new Date(DB.settings.lastBackupReminder) : null;
    var now = new Date();
    var daysSince = last ? (now - last) / 86400000 : 999;
    if (daysSince < 7) return;
    setTimeout(function() {
      if (typeof toast === 'function')
        toast('💾 It\'s been over a week since your last backup. Export one from Backup & Restore.', 'warning', 7000);
    }, 4000);
  } catch (e) {}
}

function markBackupDone() {
  if (DB.settings) DB.settings.lastBackupReminder = new Date().toISOString();
  saveDB();
}

// ── Import backup (from JSON file) ────────────────────────────────────────────
// Replaces the Electron onImportBackup handler
function restoreFromFile(jsonString) {
  try {
    if (typeof jsonString !== 'string' || jsonString.length > 50 * 1024 * 1024) {
      if (typeof toast === 'function') toast('❌ Backup file is too large or invalid', 'error');
      return;
    }

    var data   = JSON.parse(jsonString);
    var dbData = data.db || data;

    if (!Array.isArray(dbData.rooms) && !Array.isArray(dbData.students)) {
      if (typeof toast === 'function') toast('❌ Invalid backup file — missing required data', 'error');
      return;
    }

    if (Array.isArray(dbData.students) && dbData.students.length > 10000) {
      if (typeof toast === 'function') toast('❌ Backup contains too many student records', 'error');
      return;
    }

    // Restore in-memory DB
    Object.assign(DB, typeof _initDBFields === 'function' ? _initDBFields(dbData) : dbData);

    // Restore archive if present
    if (data.archive) {
      apiSaveArchive(data.archive).catch(console.error);
    }

    saveDB();   // push restored data to server

    if (typeof updateSidebar === 'function') updateSidebar();
    if (typeof renderPage    === 'function') renderPage('dashboard');
    if (typeof toast         === 'function') toast('✅ Backup imported successfully!', 'success');
    markBackupDone();
  } catch (e) {
    console.error('[DAMAM] Import failed:', e);
    if (typeof toast === 'function') toast('❌ Import failed: file is corrupt or invalid JSON', 'error');
  }
}

// ── Export backup (download JSON file) ───────────────────────────────────────
async function exportBackupToFile() {
  try {
    var archive = await apiGetArchive().catch(() => ({ payments: [], expenses: [] }));
    var exportData = {
      db:         DB,
      archive:    archive,
      exportedAt: new Date().toISOString(),
      version:    '4.0-web'
    };
    var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href     = url;
    a.download = (DB.settings.hostelName || 'DAMAM') + '-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function() { URL.revokeObjectURL(url); document.body.removeChild(a); }, 1000);
    markBackupDone();
    if (typeof toast === 'function') toast('✅ Backup downloaded!', 'success');
  } catch (e) {
    if (typeof toast === 'function') toast('❌ Export failed: ' + e.message, 'error');
  }
}
