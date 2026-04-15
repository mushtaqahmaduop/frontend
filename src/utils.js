/* ─── DAMAM HOSTEL — UTILITY FUNCTIONS ──────────────────────────────────────
   Loaded after config.js. No dependencies on auth or storage.
   Contains: formatting helpers, DOM utilities, course autocomplete.
   ─────────────────────────────────────────────────────────────────────────── */

'use strict';

// ── Electron external link helper ─────────────────────────────────────────────
function openExternalLink(url) {
  try {
    if (window.electronAPI && window.electronAPI.openExternal) {
      window.electronAPI.openExternal(url);
    } else {
      var a = document.createElement('a');
      a.href = url;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { document.body.removeChild(a); }, 500);
    }
  } catch (e) {
    console.error('openExternalLink error:', e);
  }
}

// ── ID & date helpers ─────────────────────────────────────────────────────────
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function nextStudentId() {
  var maxNum = 0;
  DB.students.forEach(function (s) {
    var n = parseInt(String(s.id), 10);
    if (!isNaN(n) && n > maxNum) maxNum = n;
  });
  return String(maxNum + 1).padStart(3, '0');
}

function migrateStudentIdsToNumeric() {
  var needsMigration = DB.students.some(function (s) {
    var sid = String(s.id);
    var n   = parseInt(sid, 10);
    return isNaN(n) || sid !== String(n).padStart(3, '0');
  });
  if (!needsMigration) return;

  var idMap = {};
  DB.students.forEach(function (s, i) { idMap[s.id] = String(i + 1).padStart(3, '0'); });
  DB.students.forEach(function (s) { s.id = idMap[s.id]; });

  ['payments', 'cancellations', 'roomShifts', 'checkinlog', 'fines'].forEach(function (col) {
    (DB[col] || []).forEach(function (r) {
      if (r.studentId && idMap[r.studentId]) r.studentId = idMap[r.studentId];
    });
  });

  (DB.rooms || []).forEach(function (room) {
    if (Array.isArray(room.studentIds)) {
      room.studentIds = room.studentIds.map(function (sid) { return idMap[sid] || sid; });
    }
  });

  saveDB();
}

// ── DOM helpers ───────────────────────────────────────────────────────────────
function toggleClearBtn(inputId, btnId) {
  const inp = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (!inp || !btn) return;
  btn.classList.toggle('visible', inp.value.length > 0);
}

// Safe window.open() wrapper — handles popup blocker gracefully
function safeOpenWindow(width, height) {
  width  = width  || 1000;
  height = height || 720;
  var w = window.open('', '_blank', 'width=' + width + ',height=' + height);
  if (!w) {
    if (typeof toast === 'function')
      toast('⚠️ Popup blocked — allow popups for this page and try again.', 'error');
    return null;
  }
  return w;
}

// ── Date & money formatters ───────────────────────────────────────────────────
function today() { return new Date().toISOString().split('T')[0]; }
function fmtPKR(n) { return 'PKR ' + Number(n || 0).toLocaleString('en-PK'); }

// BUG FIX: new Date('YYYY-MM-DD') parses as UTC midnight → wrong day in PKT (UTC+5)
// Appending 'T00:00:00' forces local-time parsing.
function fmtDate(d) {
  if (!d) return '—';
  try {
    const dt = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T00:00:00') : new Date(d);
    return dt.toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch (e) { return d; }
}

// Dashboard month selector (null = real current month, 'YYYY-MM' = selected)
let _dashboardMonth = null;
function thisMonth() {
  return _dashboardMonth || new Date().toISOString().slice(0, 7);
}
function thisMonthLabel() {
  const [y, m] = thisMonth().split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
}
function thisYear() { return new Date().getFullYear().toString(); }

// ── String helpers ────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function csvEsc(s) {
  const v = String(s == null ? '' : s);
  return '"' + v.replace(/"/g, '""') + '"';
}

// ── Input formatters ──────────────────────────────────────────────────────────
function formatRoomNumber(inp) {
  let v = inp.value;
  if (v.length > 0) v = v[0].toUpperCase() + v.slice(1);
  inp.value = v;
}
function capFirstChar(inp) {
  if (inp.value.length === 1) inp.value = inp.value.toUpperCase();
}
function formScrollNext(inp) {
  const field = inp.closest ? inp.closest('.field') : null;
  if (!field) return;
  const next = field.nextElementSibling;
  if (next) next.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
// Capitalize ASCII only — protects Urdu/Arabic names
function autoCapName(inp) {
  const v   = inp.value;
  const pos = inp.selectionStart;
  // Title-case: capitalize first letter of each word only, preserve rest
  inp.value = v.replace(/\b([a-zA-Z])/g, c => c.toUpperCase());
  inp.setSelectionRange(pos, pos);
}

// ── Debounce ──────────────────────────────────────────────────────────────────
function debounce(fn, delay) {
  delay = delay || 220;
  let t;
  return function () {
    var args = arguments;
    clearTimeout(t);
    t = setTimeout(function () { fn.apply(null, args); }, delay);
  };
}

// ── Course autocomplete ───────────────────────────────────────────────────────
const COURSE_LIST = [
  // Medical
  'MBBS', 'BDS', 'Pharm-D', 'DPT (Physiotherapy)', 'B.Sc Nursing', 'BS Nursing',
  'BS Health Sciences', 'BS Biomedical Sciences', 'BS Microbiology', 'BS Biochemistry',
  'BS Biotechnology', 'BS Zoology', 'BS Botany', 'MDCAT Preparation', 'Post-MBBS Internship',
  // Engineering
  'BS Civil Engineering', 'BS Electrical Engineering', 'BS Mechanical Engineering',
  'BS Software Engineering', 'BS Computer Engineering', 'BS Electronics Engineering',
  'BS Chemical Engineering', 'BS Environmental Engineering', 'BS Industrial Engineering',
  // Computer & IT
  'BS Computer Science', 'BS Information Technology', 'BS Artificial Intelligence',
  'BS Data Science', 'BS Cyber Security', 'BS Networking', 'BS Game Development',
  'Diploma in IT', 'Web Development Course', 'Android Development Course',
  // Business & Finance
  'BBA', 'MBA', 'BS Commerce', 'B.Com', 'ACCA', 'CA Foundation', 'CMA', 'CFA',
  'BS Accounting & Finance', 'BS Economics', 'BS Banking & Finance',
  // Arts & Humanities
  'BS English Literature', 'BS Urdu', 'BS Islamic Studies', 'BS Psychology',
  'BS Sociology', 'BS Political Science', 'BS International Relations',
  'BS Mass Communication', 'BS Journalism', 'BS Fine Arts', 'BS Architecture',
  // Education
  'BS Education', 'B.Ed', 'ADE', 'M.Ed', 'BS Special Education',
  // Law
  'LLB', 'BS Law', 'Bar-at-Law',
  // Intermediate & Matric
  'FSc Pre-Medical', 'FSc Pre-Engineering', 'ICS', 'I.Com', 'FA', 'Matric (Science)',
  'Matric (Arts)', 'A-Levels', 'O-Levels',
  // Diploma & Short Courses
  'DAE Electrical', 'DAE Civil', 'DAE Mechanical', 'DAE Computer', 'DIT',
  'Diploma in English', 'IELTS Preparation', 'NTS Preparation', 'CSS Preparation',
  'Soft Skills Course', 'English Language Course', 'Graphic Design Course',
  'Digital Marketing Course', 'Content Writing Course'
];

function toggleOccField(val) {
  const custom = document.getElementById('f-tocccustom');
  const wrap   = document.getElementById('f-tocc-wrap');
  const main   = document.getElementById('f-tocc');
  if (val === 'other') {
    if (wrap)   wrap.style.display   = 'none';
    if (custom) { custom.style.display = 'block'; custom.style.marginTop = '0'; }
  } else {
    if (wrap)   wrap.style.display   = 'block';
    if (custom) custom.style.display = 'none';
    if (main)   main.placeholder = val === 'Student'
      ? 'Type course e.g. BS Computer Science…'
      : val === 'Job'      ? 'e.g. Software Engineer, Govt. Teacher…'
      : val === 'Business' ? 'e.g. Shop Owner, Contractor…'
      : 'Describe…';
  }
}

function courseAutocomplete(inp) {
  const val = inp.value.trim().toLowerCase();
  const box = document.getElementById('course-suggestions');
  if (!box) return;
  const matches = val.length === 0
    ? COURSE_LIST
    : COURSE_LIST.filter(c => c.toLowerCase().includes(val));
  if (!matches.length) { box.style.display = 'none'; return; }
  _renderCourseSuggestions(matches, val, -1);
  box.style.display = 'block';
}

function _renderCourseSuggestions(matches, val, activeIdx) {
  const box = document.getElementById('course-suggestions');
  if (!box) return;
  box.innerHTML = matches.slice(0, 12).map((c, i) => {
    const lo = val.toLowerCase();
    const hi = lo ? c.replace(
      new RegExp('(' + lo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'),
      '<b style="color:var(--gold2)">$1</b>'
    ) : escHtml(c);
    const active = i === activeIdx;
    return `<div class="cs-item${active ? ' cs-active' : ''}" data-idx="${i}" data-val="${c.replace(/"/g, '&quot;')}"
      onclick="pickCourse('${c.replace(/'/g, "\\'")}',this)"
      style="padding:8px 12px;cursor:pointer;font-size:13px;color:var(--text);border-bottom:1px solid var(--border);${active ? 'background:var(--bg3);' : ''}"
      onmouseover="this.style.background='var(--bg3)'"
      onmouseout="this.style.background='${active ? 'var(--bg3)' : ''}'">${hi}</div>`;
  }).join('');
}

function pickCourse(val) {
  const inp = document.getElementById('f-tocc');
  if (inp) { inp.value = val; inp.focus(); }
  const box = document.getElementById('course-suggestions');
  if (box) box.style.display = 'none';
  setTimeout(() => {
    const wrap = document.getElementById('f-tocc-wrap');
    if (wrap) {
      const next = wrap.closest('.field') && wrap.closest('.field').nextElementSibling;
      if (next) next.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, 80);
}

function courseKeyNav(e) {
  const box = document.getElementById('course-suggestions');
  if (!box || box.style.display === 'none') return;
  const items = box.querySelectorAll('.cs-item');
  if (!items.length) return;
  let cur = Array.from(items).findIndex(el => el.classList.contains('cs-active'));
  if (e.key === 'ArrowDown') {
    e.preventDefault(); cur = (cur + 1) % items.length;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault(); cur = cur <= 0 ? items.length - 1 : cur - 1;
  } else if (e.key === 'Enter' && cur >= 0) {
    e.preventDefault(); pickCourse(items[cur].dataset.val); return;
  } else if (e.key === 'Escape') {
    box.style.display = 'none'; return;
  } else { return; }
  items.forEach((el, i) => {
    el.classList.toggle('cs-active', i === cur);
    el.style.background = i === cur ? 'var(--bg3)' : '';
  });
  if (items[cur]) items[cur].scrollIntoView({ block: 'nearest' });
}