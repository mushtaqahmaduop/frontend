/* ─── DAMAM HMS — CONFIG (WEB VERSION) ──────────────────────────────────────
   Replaces the old Electron config.js.
   - Removes LS_KEY / localStorage references
   - Adds API_BASE_URL used by api.js for all fetch() calls
   - Keeps the DB schema default (_initDBFields is in app.js)
   ─────────────────────────────────────────────────────────────────────────── */

'use strict';

// ── API base URL ──────────────────────────────────────────────────────────────
// During local development this points to your Express server.
// For production (Render), replace with your actual Render URL.
// This value is read by api.js — do NOT hardcode it elsewhere.
const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:5000'
  : 'https://damam-hms-backend-production.up.railway.app';   // ← REPLACE with your Render URL before deploying

// ── Kept for backwards compatibility with existing code ───────────────────────
// Old code used _ACTIVE_HOSTEL in a few places (logo fetch, etc.)
// We keep it as a constant so nothing breaks.
const _ACTIVE_HOSTEL = 'hostel_1';

// ── In-memory DB (was persisted to localStorage, now synced via API) ──────────
// This is still used by all existing UI code as-is.
// api.js loads it from the server on startup and saves it back on changes.
var DB = {
  students:      [],
  rooms:         [],
  payments:      [],
  expenses:      [],
  cancellations: [],
  maintenance:   [],
  complaints:    [],
  checkinlog:    [],
  notices:       [],
  fines:         [],
  activityLog:   [],
  inspections:   [],
  billSplits:    [],
  transfers:     [],
  roomShifts:    [],
  settings:      {}
};
