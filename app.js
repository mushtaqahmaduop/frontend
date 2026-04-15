/* ─── DAMAM BOYS HOSTEL — MAIN APPLICATION LOGIC ────────────────────────────
   Modular structure (Phase 1 refactor):
   ┌─ src/config.js   ─ constants, DB schema default
   ├─ src/utils.js    ─ uid, escHtml, fmtDate, fmtPKR, debounce …
   ├─ src/auth.js     ─ warden login, roles, session
   ├─ src/storage.js  ─ loadDB, saveDB, logActivity, backups
   ├─ src/license.js  ─ license stubs (Phase 3)
   └─ app.js          ─ YOU ARE HERE — UI, pages, modals, reports
   ─────────────────────────────────────────────────────────────────────────── */


// ── COURSE AUTOCOMPLETE — defined in src/utils.js (do not redeclare here)
function getTypeById(id) { const rt=(DB.settings&&DB.settings.roomTypes)||[]; return rt.find(t=>t.id===id)||rt[0]; }
function getRoomType(room) { return getTypeById(room.typeId); }
// getRoomOccupancy includes ALL active students (regular + force-added) — used for physical seat display
function getRoomOccupancy(room) { return (DB.students||[]).filter(t=>t.roomId===room.id && t.status==='Active').length; }

// ── SAFE WINDOW HELPER ───────────────────────────────────────────────────────
// Opens a popup; shows a toast and returns null if blocked.
function safeOpenWindow(w, h) {
  const win = window.open('', '_blank', 'width='+w+',height='+h+',scrollbars=yes,resizable=yes');
  if (!win) {
    if (typeof toast === 'function') toast('⚠️ Popup blocked — please allow popups for this page.', 'error');
    return null;
  }
  return win;
}

// ── ELECTRON PDF HELPER (Issue 1) ────────────────────────────────────────────
// Unified PDF function: uses Electron native printToPDF when available (saves
// to a file the user picks), falls back to popup + browser print dialog.
// opts: { landscape: bool, pageSize: 'A4'|'Letter' }
function _electronPDF(html, suggestedName, opts) {
  // Open a print-ready popup window — works in both Electron and browser.
  // User presses Ctrl+P (or the Print button) and selects "Save as PDF".
  // This avoids the native OS Save dialog that blocks the Electron renderer.
  opts = opts || {};
  var isLandscape = !!(opts && opts.landscape);
  var pageCSS = isLandscape
    ? '@page { size: A4 landscape; margin: 10mm; }'
    : '@page { size: A4; margin: 18mm; }';
  // Inject print CSS + a visible Print/Save button into the HTML
  var injected = html.replace('</head>',
    '<style>' + pageCSS +
    '@media print { .no-print { display:none!important; } body { background:#fff!important; } }' +
    '.pdf-print-btn { display:block; margin:16px auto; padding:10px 40px; background:#1e5fd4; color:#fff; border:none; border-radius:6px; font-size:14px; font-weight:700; cursor:pointer; font-family:sans-serif; letter-spacing:0.5px; }' +
    '</style></head>');
  // Insert a prominent Save PDF button before </body>
  var btnHtml = '<div class="no-print" style="text-align:center;padding:16px 0 8px">'
    + '<button class="pdf-print-btn" onclick="window.print()">🖨️ Print / Save as PDF</button>'
    + '<div style="font-size:11px;color:#888;margin-top:6px;font-family:sans-serif">In the print dialog: set Destination → Save as PDF</div>'
    + '</div>';
  // FIX-PRINT: Auto-print removed — calling window.print() automatically in a child
  // window.open() window hangs the Electron renderer on Windows. User presses the button.
  injected = injected.replace('</body>', btnHtml + '</body>');
  var w = window.open('', '_blank', 'width=900,height=800,scrollbars=yes,resizable=yes');
  if (!w) { if (typeof toast === 'function') toast('⚠️ Allow popups for this app to open PDFs.', 'error'); return; }
  w.document.open();
  w.document.write(injected);
  w.document.close();
}
// ─────────────────────────────────────────────────────────────────────────────
// Cancelling students do NOT count toward occupancy — their seat is immediately freed

// ══ SINGLE SOURCE OF TRUTH FOR REVENUE ══════════════════════════════════════
// Revenue = Paid payments + partial Pending payments (where amount>0 & unpaid is explicitly set)
// This is used by dashboard, reports, CSVs, PDFs, WhatsApp/email share — everywhere.
function calcRevenue(datePrefix) {
  // Use _payMatchesMonth to handle both YYYY-MM-DD date fields AND "April 2026" month labels
  const paid    = DB.payments
    .filter(p => p.status==='Paid' && _payMatchesMonth(p, datePrefix))
    .reduce((s,p) => s + Number(p.amount||0), 0);
  const partial = DB.payments
    .filter(p => p.status==='Pending' && Number(p.amount||0)>0 && p.unpaid!=null
      && _payMatchesMonth(p, datePrefix))
    .reduce((s,p) => s + Number(p.amount||0), 0);
  return paid + partial;
}
// ════════════════════════════════════════════════════════════════════════════

// ── PAYMENT MONTH MATCHER ────────────────────────────────────────────────────
// Single source of truth for "does payment p belong to monthKey (YYYY-MM)?".
// Fixes the core data-mixing bug: p.month stores "April 2026" while thisMonth()
// returns "2026-04" — .startsWith() never matched, hiding all month-label payments.
function _payMatchesMonth(p, mk) {
  if (!mk) return false;
  // Fast path: date fields are YYYY-MM-DD
  if ((p.date||'').startsWith(mk))     return true;
  if ((p.paidDate||'').startsWith(mk)) return true;
  if ((p.dueDate||'').startsWith(mk))  return true;
  // FIX-B3: Slow path — parse ANY date/month field that is not already YYYY-MM-DD.
  // Fixes silent failure when dueDate/date/paidDate is stored as "April 2026" or
  // "Apr 2026" instead of "2026-04-xx", causing payments to vanish from reports.
  function _toYM(str) {
    if (!str || typeof str !== 'string') return null;
    if (/^\d{4}-\d{2}/.test(str)) return null; // fast-path already handled these
    try {
      var d = new Date(str.trim() + ' 1');
      if (!isNaN(d.getTime()))
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    } catch (e) {}
    return null;
  }
  var fields = [p.month, p.dueDate, p.date, p.paidDate];
  for (var i = 0; i < fields.length; i++) {
    if (_toYM(fields[i]) === mk) return true;
  }
  return false;
}
// ─────────────────────────────────────────────────────────────────────────────

function generateRooms(roomTypes) {
  // roomTypes can be passed explicitly (from _initDBFields) to avoid reading stale DB.settings
  const rtypes = roomTypes || (DB.settings && DB.settings.roomTypes) || [];
  const rooms = [];
  // 42 rooms numbered 1–42, distributed across 4 floors
  const floors = [
    {name:'Ground', rooms:[1,2,3,4,5,6,7,8,9,10]},
    {name:'1st',    rooms:[11,12,13,14,15,16,17,18,19,20,21]},
    {name:'2nd',    rooms:[22,23,24,25,26,27,28,29,30,31]},
    {name:'3rd',    rooms:[32,33,34,35,36,37,38,39,40,41,42]}
  ];
  const typeIds = ['1s','2s','3s','4s','5s'];
  let idx=0;
  floors.forEach(f=>{
    f.rooms.forEach(num=>{
      const typeId = typeIds[idx%5];
      const type = rtypes.find(t=>t.id===typeId);
      rooms.push({
        id:'room_'+uid(), number:num, floor:f.name, typeId,
        rent:type?.defaultRent||16000, studentIds:[], amenities:['Fan','Bed','Wardrobe'], notes:''
      });
      idx++;
    });
  });
  return rooms;
}
// ── MOBILE SIDEBAR TOGGLE (FIX #13) ─────────────────────────────────────────
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebar-overlay');
  if (!sb) return;
  const isOpen = sb.classList.contains('open');
  sb.classList.toggle('open', !isOpen);
  ov.classList.toggle('active', !isOpen);
}
function closeSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebar-overlay');
  if (sb) sb.classList.remove('open');
  if (ov) ov.classList.remove('active');
}
// Auto-close sidebar on navigation (mobile UX)
// ─────────────────────────────────────────────────────────────────────────────

let currentPage = 'dashboard';
let pageHistory = ['dashboard'];
function goBack(){if(pageHistory.length>1){pageHistory.pop();navigate(pageHistory[pageHistory.length-1],true);}}
const pageConfig = {
  dashboard:     { title:'Dashboard', sub:'Overview of your hostel', action:'Add Student' },
  rooms:         { title:'Rooms', sub:'Manage all rooms', action:'Add Room' },
  students:      { title:'Students', sub:'Resident management', action:'Add Student' },
  payments:      { title:'Finance', sub:'Rent & payment tracking', action:'Add Payment' },
  expenses:      { title:'Expenses', sub:'Operational cost tracking', action:'Add Expense' },
  cancellations: { title:'Cancellation List', sub:'Seat cancellation requests', action:'Add Cancellation' },
  reports:       { title:'Reports', sub:'Financial analytics', action:null },
  issues:        { title:'Complaints & Maintenance', sub:'Complaints and repair requests', action:'Add Issue' },
  activitylog:   { title:'Activity Log', sub:'Full system audit trail', action:null },
  settings:      { title:'Settings', sub:'Configure your system', action:null },
  archive: { title:'Annual Archive', sub:'Full year data breakdown', action:null },
  maintenance:   { title:'Complaints & Maintenance', sub:'Repair requests', action:'Add Issue' },
  complaints:    { title:'Complaints & Maintenance', sub:'Complaints', action:'Add Issue' }
};

function navigate(page, isBack=false) {
  // Auto-close sidebar on navigation (mobile)
  closeSidebar();
  // Auto-clear all search bars when navigating away from a section
  if (page !== currentPage) {
    studentFilter.search = '';
    payFilter.search     = '';
    payFilter.showAll    = false;
    roomFilter.search    = '';
    expFilter.search     = '';
    expFilter.showAll    = false;
  }
  if(!isBack) {
    pageHistory.push(page);
    // FIX #9: Cap pageHistory to prevent unbounded memory growth across long sessions
    if (pageHistory.length > 50) pageHistory.shift();
  }
  currentPage = page;
  // BUG FIX: Reset reportDetail on every fresh navigation to reports so the
  // overview badges always show first instead of the last opened detail panel.
  if (page === 'reports') reportDetail = null;
  const bb=document.getElementById('hdr-back-btn');
  if(bb) bb.style.display = page!=='dashboard' ? 'flex' : 'none';
  document.querySelectorAll('.nav-item').forEach(el=>{
    el.classList.toggle('active', el.dataset.page===page);
  });
  const cfg = pageConfig[page] || { title: page, sub: '', action: null };
  const _t=document.getElementById('hdr-title'); if(_t) _t.textContent=cfg?.title||'';
  const _s=document.getElementById('hdr-sub'); if(_s) _s.textContent=cfg?.sub||'';
  const actionBtn = document.getElementById('hdr-action');
  if(actionBtn) {
    if(cfg && cfg.action) { actionBtn.style.display='flex'; document.getElementById('hdr-action-text').textContent=cfg.action; }
    else { actionBtn.style.display='none'; }
  }
  // Show "Add Payment" button on Dashboard and Students pages
  const action2Btn = document.getElementById('hdr-action2');
  if(action2Btn) action2Btn.style.display = (page === 'students' || page === 'dashboard') ? 'flex' : 'none';
  renderPage(page, true); // reset scroll on real navigation
}

function headerAction() {
  if(currentPage==='dashboard') showAddStudentModal();
  else if(currentPage==='rooms') showAddRoomModal();
  else if(currentPage==='students') showAddStudentModal();
  else if(currentPage==='payments') showAddPaymentModal();
  else if(currentPage==='expenses') showAddExpenseModal();
  else if(currentPage==='cancellations') showAddCancellationModal();
  else if(currentPage==='issues') showAddIssueModal();
}
function headerAction2() {
  // "Add Payment" button shown on Dashboard and Students page
  if(currentPage==='students' || currentPage==='dashboard') showAddPaymentModal();
}

// debounce() — defined in src/utils.js

// Smart re-render for search bars - preserves cursor focus
function searchRenderPage(page, inputId, caretPos) {
  const el = document.getElementById('content');
  const focusId = inputId;
  const val = document.getElementById(focusId)?.value || '';
  
  if(page==='rooms') el.innerHTML = renderRooms();
  else if(page==='students') el.innerHTML = renderStudents();
  else if(page==='payments') el.innerHTML = renderPayments();
  else if(page==='expenses') el.innerHTML = renderExpenses();
  
  // Restore focus + caret position
  requestAnimationFrame(()=>{
    const inp = document.getElementById(focusId);
    if(inp){ inp.focus(); try{ inp.setSelectionRange(val.length, val.length); }catch(e){} }
  });
}

// Debounced search handlers (one per page)
const _dRooms    = debounce(()=>searchRenderPage('rooms','search-rooms'));
const _dStudents = debounce(()=>searchRenderPage('students','search-students'));
const _dPayments = debounce(()=>searchRenderPage('payments','search-payments'));
const _dExpenses = debounce(()=>searchRenderPage('expenses','search-expenses'));

function renderPage(p, resetScroll=false) {
  const el = document.getElementById('content');
  // Save scroll position before re-render so it can be restored
  const savedScroll = el.scrollTop || document.getElementById('main')?.scrollTop || 0;
  el.style.transition='opacity 0.2s ease';
  el.style.opacity='0';
  // Handle cancellations sub-filter pages
  let cancFilter = 'All';
  let basePage = p;
  if(p.startsWith('cancellations_')) {
    cancFilter = p.replace('cancellations_','');
    basePage = 'cancellations';
    currentPage = 'cancellations';
    document.querySelectorAll('.nav-item').forEach(el=>{ el.classList.toggle('active', el.dataset.page==='cancellations'); });
    const cfg=pageConfig['cancellations'];
    const _t=document.getElementById('hdr-title'); if(_t) _t.textContent=cfg?.title||'';
    const _s=document.getElementById('hdr-sub'); if(_s) _s.textContent=cfg?.sub||'';
    const actionBtn=document.getElementById('hdr-action');
    if(cfg&&cfg.action){actionBtn.style.display='flex';document.getElementById('hdr-action-text').textContent=cfg.action;}
    else{actionBtn.style.display='none';}
    const action2Btn=document.getElementById('hdr-action2');
    if(action2Btn) action2Btn.style.display='none';
  }
  setTimeout(()=>{
    try {
      if(basePage==='dashboard') el.innerHTML = renderDashboard();
      else if(basePage==='rooms') el.innerHTML = renderRooms();
      else if(basePage==='students') el.innerHTML = renderStudents();
      else if(basePage==='payments') el.innerHTML = renderPayments();
      else if(basePage==='expenses') el.innerHTML = renderExpenses();
      else if(basePage==='cancellations') el.innerHTML = renderCancellations(cancFilter);
      else if(basePage==='reports') el.innerHTML = renderReports();
      else if(basePage==='maintenance') { issuesTab='maintenance'; el.innerHTML = renderIssues(); }
      else if(basePage==='complaints') { issuesTab='complaints'; el.innerHTML = renderIssues(); }
      else if(basePage==='issues') el.innerHTML = renderIssues();
      else if(basePage==='activitylog') el.innerHTML = renderActivityLog();
      else if(basePage==='settings') el.innerHTML = renderSettings();
      else if(basePage==='archive') el.innerHTML = renderArchive();
    } catch(e) {
      el.innerHTML = '<div style="padding:40px;color:#e05252;font-family:monospace;background:#1a0a0a;border-radius:12px;margin:20px"><div style="font-size:18px;font-weight:900;margin-bottom:12px">⚠️ Render Error on: '+basePage+'</div><div style="font-size:13px;line-height:1.7;white-space:pre-wrap">'+e.message+'</div><div style="margin-top:12px;font-size:11px;opacity:0.6">'+e.stack+'</div></div>';
      console.error('renderPage error:', e);
    }
    el.style.opacity='1';
    // Only reset scroll when explicitly navigating to a new page; preserve on data saves/edits
    if (resetScroll) {
      el.scrollTop = 0;
      const main = document.getElementById('main'); if(main) main.scrollTop = 0;
      window.scrollTo(0, 0);
    } else {
      el.scrollTop = savedScroll;
      const main = document.getElementById('main'); if(main) main.scrollTop = savedScroll;
    }
    if(basePage==='reports') drawCharts();
    if(basePage==='settings') bindSettingsEvents();
    if(basePage==='dashboard') setTimeout(drawTrendChart, 50);
  },80);
}

function updateSidebar() {
  const setEl = (id, val) => { const el=document.getElementById(id); if(el) el.textContent=val; };
  setEl('sb-hostel-name', DB.settings.hostelName);
  // Apply saved font
  const nameEl2 = document.getElementById('sb-hostel-name');
  if(nameEl2 && DB.settings.hostelNameFont) nameEl2.style.fontFamily = `'${DB.settings.hostelNameFont}', serif`;
  // BUG FIX: sync tagline to sidebar sub-label
  setEl('sb-location-sub', DB.settings.tagline || 'Boys Residence');
  setEl('sb-location', DB.settings.location);
  // Show appName (HOSTIX / custom) as the system brand label
  setEl('sb-version', (DB.settings.appName || 'HOSTIX') + ' · ' + DB.settings.version);
  // Update cancellation badge
  const cancelBadge = document.getElementById('cancel-badge');
  const pendingCancels = (DB.cancellations||[]).filter(c=>c.status==='Pending').length;
  if(cancelBadge) { cancelBadge.textContent = pendingCancels; cancelBadge.style.display = pendingCancels>0?'flex':'none'; }
  const issuesBadge = document.getElementById('issues-badge');
  const openIssues = (DB.maintenance||[]).filter(m=>m.status==='Open').length + (DB.complaints||[]).filter(c=>c.status==='Open').length;
  if(issuesBadge) { issuesBadge.textContent = openIssues; issuesBadge.style.display = openIssues>0?'flex':'none'; }
  // Fix #5: Render Contact & Support section at bottom of sidebar
  const contactEl = document.getElementById('sb-contact-section');
  if(contactEl) {
    const phone = DB.settings.phone || '';
    const email = DB.settings.email || '';
    const dev = 'Mushtaq Ahmad';
    const devPhone = '03189981202';
    const devEmail = 'mushhtaqahmadicp@gmail.com';
    contactEl.innerHTML = `
      <div style="margin:0 8px 10px;border-top:1px solid rgba(255,255,255,0.07);padding-top:12px">
        <div style="font-size:9px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,0.3);margin-bottom:8px;padding:0 8px">📞 Contact & Support</div>
        ${phone?`<a href="tel:${phone}" style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;text-decoration:none;transition:background 0.15s;cursor:pointer" onmouseover="this.style.background='rgba(255,255,255,0.06)'" onmouseout="this.style.background=''">
          <span style="font-size:13px">📱</span><span style="font-size:11px;color:rgba(255,255,255,0.55)">${phone}</span>
        </a>`:''}
        ${email?`<a href="mailto:${email}" style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;text-decoration:none;transition:background 0.15s;cursor:pointer" onmouseover="this.style.background='rgba(255,255,255,0.06)'" onmouseout="this.style.background=''">
          <span style="font-size:13px">✉️</span><span style="font-size:11px;color:rgba(255,255,255,0.55)">${email}</span>
        </a>`:''}
        <div style="margin-top:8px;padding:8px 10px;border-radius:8px;background:rgba(200,168,75,0.07);border:1px solid rgba(200,168,75,0.15)">
          <div style="font-size:9px;color:var(--gold2);font-weight:700;margin-bottom:4px;text-transform:uppercase;letter-spacing:1px">Developer</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.6);font-weight:600">${dev}</div>
          <a href="#" onclick="openExternalLink('https://wa.me/92${devPhone.replace(/^0/,'')}');return false;" style="display:flex;align-items:center;gap:6px;font-size:10px;color:rgba(255,255,255,0.55);text-decoration:none;margin-top:5px;padding:4px 6px;border-radius:6px;background:rgba(37,211,102,0.08);border:1px solid rgba(37,211,102,0.2)" onmouseover="this.style.background='rgba(37,211,102,0.18)'" onmouseout="this.style.background='rgba(37,211,102,0.08)'">
            <svg width="14" height="14" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="16" fill="#25D366"/><path d="M23.5 8.5A10.4 10.4 0 0 0 16 5.5C10.2 5.5 5.5 10.2 5.5 16c0 1.85.48 3.66 1.4 5.26L5.5 26.5l5.36-1.4A10.44 10.44 0 0 0 16 26.5c5.8 0 10.5-4.7 10.5-10.5 0-2.8-1.09-5.43-3-7.5zm-7.5 16.1c-1.56 0-3.1-.42-4.44-1.2l-.32-.19-3.18.83.85-3.1-.21-.33A8.65 8.65 0 0 1 7.35 16c0-4.77 3.88-8.65 8.65-8.65 2.31 0 4.48.9 6.11 2.53A8.6 8.6 0 0 1 24.65 16c0 4.77-3.88 8.6-8.65 8.6zm4.74-6.48c-.26-.13-1.53-.75-1.77-.84-.23-.09-.4-.13-.57.13-.17.26-.65.84-.8 1.01-.15.17-.29.19-.55.06-.26-.13-1.1-.4-2.1-1.28-.77-.69-1.3-1.54-1.45-1.8-.15-.26-.02-.4.11-.53.12-.11.26-.29.39-.44.13-.14.17-.26.26-.43.09-.17.04-.32-.02-.45-.06-.13-.57-1.37-.78-1.87-.2-.49-.42-.42-.57-.43h-.49c-.17 0-.44.06-.67.32-.23.26-.87.85-.87 2.07 0 1.22.89 2.4 1.01 2.57.13.17 1.75 2.67 4.24 3.74.59.26 1.06.41 1.42.52.6.19 1.14.16 1.57.1.48-.07 1.47-.6 1.68-1.18.2-.57.2-1.07.14-1.17-.07-.1-.24-.16-.5-.29z" fill="#fff"/></svg>
            ${devPhone}
          </a>
          <a href="#" onclick="openExternalLink('https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(devEmail)}&su=Support+Request+—+DAMAM+Hostel+Management');return false;" style="display:flex;align-items:center;gap:6px;font-size:10px;color:rgba(255,255,255,0.55);text-decoration:none;margin-top:4px;padding:4px 6px;border-radius:6px;background:rgba(234,67,53,0.08);border:1px solid rgba(234,67,53,0.2);word-break:break-all" onmouseover="this.style.background='rgba(234,67,53,0.18)'" onmouseout="this.style.background='rgba(234,67,53,0.08)'">
            <svg width="14" height="14" viewBox="0 0 32 32" fill="none" style="flex-shrink:0"><rect width="32" height="32" rx="4" fill="#fff"/><path d="M5 10l11 8 11-8" stroke="#EA4335" stroke-width="2" fill="none"/><rect x="5" y="10" width="22" height="14" rx="1" stroke="#4285F4" stroke-width="1.5" fill="none"/><path d="M5 10l7 7M27 10l-7 7" stroke="#34A853" stroke-width="1.5"/></svg>
            ${devEmail}
          </a>
        </div>
      </div>`;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════════════════════════
function renderDashboard() {
  // ✅ Safety: ensure DB arrays exist (in case server returned empty data)
  DB.rooms     = DB.rooms     || [];
  DB.students  = DB.students  || [];
  DB.payments  = DB.payments  || [];
  DB.expenses  = DB.expenses  || [];
  DB.transfers = DB.transfers || [];
  if (!DB.settings)                  DB.settings = {};
  DB.settings.roomTypes = DB.settings.roomTypes || [];

  // Alert system
  const overduePayments = DB.payments.filter(p=>p.status==='Pending');
  const openMaint = (DB.maintenance||[]).filter(m=>m.status==='Open').length;
  const openComp = (DB.complaints||[]).filter(c=>c.status==='Open').length;
  const totalOccupied = DB.students.filter(s=>s.status==='Active').length;
  const totalBeds = DB.rooms.reduce((sum,r)=>{const rt=getRoomType(r);return sum+(rt?rt.capacity:0);},0);
  const occRate = totalBeds>0?Math.round(totalOccupied/totalBeds*100):0;
  const alerts = [];
  if(overduePayments.length>0) alerts.push({type:'warning',icon:'💰',msg:`${overduePayments.length} pending payment${overduePayments.length>1?'s':''} — ${fmtPKR(overduePayments.reduce((s,p)=>s+Number(p.amount||0),0))} uncollected`,action:"navigate('payments')"});
  if(openMaint>0) alerts.push({type:'info',icon:'🔧',msg:`${openMaint} open maintenance request${openMaint>1?'s':''}`,action:"navigate('maintenance')"});
  if(openComp>0) alerts.push({type:'danger',icon:'💬',msg:`${openComp} unresolved complaint${openComp>1?'s':''}`,action:"navigate('complaints')"});
  if(occRate < 60) alerts.push({type:'warning',icon:'🏠',msg:`Low occupancy: ${occRate}% — ${totalBeds-totalOccupied} beds vacant`,action:"navigate('rooms')"});
  const alertColors = {warning:'var(--amber)',info:'var(--blue)',danger:'var(--red)'};
  const alertBg = {warning:'var(--amber-dim)',info:'var(--blue-dim)',danger:'var(--red-dim)'};
  const alertHtml = alerts.length>0?`<div style="display:grid;gap:8px;margin-bottom:20px">${alerts.map(a=>`
    <div onclick="${a.action}" style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:${alertBg[a.type]};border:1px solid ${alertColors[a.type]}55;border-radius:10px;cursor:pointer;transition:var(--transition)" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">
      <span style="font-size:18px">${a.icon}</span>
      <span style="font-size:13px;font-weight:600;color:${alertColors[a.type]}">${a.msg}</span>
      <span style="margin-left:auto;font-size:12px;color:${alertColors[a.type]}">View →</span>
    </div>`).join('')}</div>`:'';

  const occ = DB.rooms.filter(r=>getRoomOccupancy(r)>0).length;
  const vac = DB.rooms.length - occ;
  const seatsRemainingInOccupiedRooms = DB.rooms.filter(r=>getRoomOccupancy(r)>0).reduce((s,r)=>{const cap=getRoomType(r)?.capacity||1;return s+(cap-getRoomOccupancy(r));},0);
  const activeStudents = DB.students.filter(t=>t.status==='Active').length;
  const mo = thisMonth();
  const moTransferDeduct = (DB.transfers||[]).filter(t=>t.date?.startsWith(mo)).reduce((s,t)=>s+Number(t.amount),0);
  const collected = calcRevenue(mo);   // Revenue — transfers do NOT reduce revenue
  // Pending — only for the selected month
  const pending = DB.payments.filter(p=>p.status==='Pending'&&_payMatchesMonth(p,mo)).reduce((s,p)=>s+(p.unpaid!=null?Number(p.unpaid):Number(p.amount)),0);
  const pendingCount = DB.payments.filter(p=>p.status==='Pending'&&_payMatchesMonth(p,mo)).length;
  const paidCount = DB.payments.filter(p=>p.status==='Paid'&&_payMatchesMonth(p,mo)).length;
  const overdue = 0; // overdue feature removed
  const moExp = DB.expenses.filter(e=>e.date?.startsWith(mo)).reduce((s,e)=>s+Number(e.amount),0);
  const totalExpected = collected + pending;
  // Transfer to owner is also an outgoing expense — include in net calculation
  const netProfit = collected - moExp - moTransferDeduct;

  // Seat calculations
  const totalSeats = DB.rooms.reduce((s,r)=>{ const t=DB.settings.roomTypes.find(x=>x.id===r.typeId); return s+(t?t.capacity:1); }, 0);
  const allActiveSeats = DB.students.filter(t=>t.status==='Active').length; // badge: counts ALL active including force-added
  const filledSeats = DB.students.filter(t=>t.status==='Active' && !t.isForced).length; // for available seat math only
  const availSeats = totalSeats - filledSeats;
  const seatPct = totalSeats>0 ? Math.round(filledSeats/totalSeats*100) : 0;

  // Per-room-type seat breakdown
  let seatBreakdown = '';
  DB.settings.roomTypes.forEach(type => {
    const tRooms = DB.rooms.filter(r=>r.typeId===type.id);
    const typeTotalSeats = tRooms.length * type.capacity;
    const typeFilledSeats = DB.students.filter(t=>t.status==='Active'&&!t.isForced&&tRooms.some(r=>r.id===t.roomId)).length;
    const typeAvail = typeTotalSeats - typeFilledSeats;
    const typePct = typeTotalSeats>0?Math.round(typeFilledSeats/typeTotalSeats*100):0;
    seatBreakdown += `
      <div style="display:flex;align-items:center;gap:14px;padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="width:10px;height:10px;border-radius:3px;background:${type.color};flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
            <span style="font-size:13px;font-weight:600;color:var(--text)">${escHtml(type.name)}</span>
            <span style="font-size:12px;font-weight:700;color:var(--text2);font-family:var(--font-mono)">${typeFilledSeats}/${typeTotalSeats}</span>
          </div>
          <div style="height:5px;background:var(--bg4);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${typePct}%;background:${type.color};border-radius:3px;transition:width 0.5s"></div>
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:11px;color:var(--green);font-weight:600">${typeAvail} free</div>
          <div style="font-size:10px;color:var(--text3)">${typePct}% full</div>
        </div>
      </div>`;
  });

  const recentPay = [...DB.payments].filter(p=>_payMatchesMonth(p,mo)).sort((a,b)=>new Date(b.date||b.dueDate)-new Date(a.date||a.dueDate)).slice(0,10);

  // Room type summary
  let roomTypeSummary = '';
  DB.settings.roomTypes.forEach(type=>{
    const tRooms = DB.rooms.filter(r=>r.typeId===type.id);
    const tOcc = tRooms.filter(r=>getRoomOccupancy(r)>0).length;
    const pct = tRooms.length ? Math.round(tOcc/tRooms.length*100) : 0;
    roomTypeSummary+=`<div class="card" style="padding:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="font-size:13px;font-weight:600;color:var(--text)">${escHtml(type.name)}</div>
        <div style="font-size:22px;font-weight:900;color:${escHtml(type.color)}">${tRooms.length}</div>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:8px">${tOcc} occupied · ${tRooms.length-tOcc} vacant</div>
      <div class="room-occ-track"><div class="room-occ-fill" style="width:${pct}%;background:${escHtml(type.color)}"></div></div>
      <div style="font-size:11px;color:var(--text3);margin-top:4px;text-align:right">${pct}% occupied</div>
      <div style="font-size:12px;font-weight:700;color:var(--green);margin-top:6px">${fmtPKR(type.defaultRent)}/mo</div>
    </div>`;
  });

  // Seats availability bar chart data
  const pendingCancels = (DB.cancellations||[]).filter(c=>c.status==='Pending');

  return `
  ${pendingCancels.length>0?`
  <div style="background:linear-gradient(135deg,rgba(224,82,82,0.12),rgba(224,82,82,0.06));border:1px solid rgba(224,82,82,0.35);border-radius:var(--radius);padding:12px 18px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer" onclick="navigate('cancellations')">
    <div style="display:flex;align-items:center;gap:10px"><span style="font-size:16px">🚨</span>
      <div><div style="font-size:13px;font-weight:700;color:var(--red)">${pendingCancels.length} Pending Cancellation${pendingCancels.length!==1?'s':''}</div>
      <div style="font-size:11px;color:var(--text3)">${pendingCancels.map(c=>escHtml(c.studentName)).join(', ')} — seats freed</div></div>
    </div>
    <button class="btn btn-danger btn-sm" style="font-size:11px">View →</button>
  </div>`:''}

  <!-- ══ ROW 1: KPI FINANCIAL CARDS ══ -->
  ${(()=>{const transfers=DB.transfers||[];const moTransfers=transfers.filter(t=>t.date?.startsWith(mo));const moTransferTotal=moTransfers.reduce((s,t)=>s+Number(t.amount),0);return `
  <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:12px">
    <div onclick="navigate('payments')" style="background:linear-gradient(145deg,#011828,#010f18);border:1px solid rgba(2,37,71,0.7);border-radius:var(--radius);padding:18px;cursor:pointer;transition:var(--transition);position:relative;overflow:hidden" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 24px rgba(11,19,43,0.6)'" onmouseout="this.style.transform='';this.style.boxShadow=''">
      <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,#022547,transparent)"></div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:11px">
        <div style="width:36px;height:36px;border-radius:9px;background:rgba(2,37,71,0.25);display:flex;align-items:center;justify-content:center;font-size:16px">💰</div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:#3a8fd4">Total Revenue</div>
        <span style="margin-left:auto;font-size:10px;font-weight:600;color:#3a8fd4;background:rgba(2,37,71,0.2);padding:1px 6px;border-radius:20px;border:1px solid rgba(2,37,71,0.55)">${totalExpected>0?Math.round(collected/totalExpected*100):0}% · ${paidCount} paid</span>
      </div>
      <div style="font-size:32px;font-weight:800;color:var(--text);line-height:1;margin-bottom:7px;letter-spacing:-0.5px">${fmtPKR(collected)}</div>
      <div style="height:3px;background:rgba(255,255,255,0.05);border-radius:2px;overflow:hidden;margin-bottom:5px"><div style="height:100%;width:${totalExpected>0?Math.round(collected/totalExpected*100):0}%;background:#022547;border-radius:2px"></div></div>
      <div style="font-size:11px;color:var(--text3)">of ${fmtPKR(totalExpected)}</div>
    </div>
    <div onclick="navigate('reports')" style="background:linear-gradient(145deg,#041e26,#021318);border:1px solid rgba(35,181,211,0.35);border-radius:var(--radius);padding:18px;cursor:pointer;transition:var(--transition);position:relative;overflow:hidden" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 24px rgba(35,181,211,0.2)'" onmouseout="this.style.transform='';this.style.boxShadow=''">
      <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,#23B5D3,transparent)"></div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:11px">
        <div style="width:36px;height:36px;border-radius:9px;background:rgba(35,181,211,0.15);display:flex;align-items:center;justify-content:center;font-size:16px">📊</div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:#23B5D3">Available Fund</div>
        <span style="margin-left:auto;font-size:10px;font-weight:600;color:#23B5D3;background:rgba(35,181,211,0.1);padding:1px 6px;border-radius:20px;border:1px solid rgba(35,181,211,0.28)">${netProfit>=0?'Profit':'Loss'}</span>
      </div>
      <div style="font-size:32px;font-weight:800;color:${netProfit>=0?'#23B5D3':'#D90429'};line-height:1;margin-bottom:7px;letter-spacing:-0.5px">${fmtPKR(netProfit)}</div>
      <div style="height:3px;background:rgba(255,255,255,0.05);border-radius:2px;overflow:hidden;margin-bottom:5px"><div style="height:100%;width:${collected>0?Math.min(100,Math.round(Math.abs(netProfit)/collected*100)):0}%;background:${netProfit>=0?'#23B5D3':'rgba(217,4,41,0.7)'};border-radius:2px"></div></div>
      <div style="font-size:11px;color:var(--text3)">${fmtPKR(collected)}${moTransferDeduct>0?` − ${fmtPKR(moTransferDeduct)} (owner)`:''} − ${fmtPKR(moExp)}</div>
    </div>
    <div onclick="navigate('expenses')" style="background:linear-gradient(145deg,#200108,#140105);border:1px solid rgba(171,44,32,0.5);border-radius:var(--radius);padding:18px;cursor:pointer;transition:var(--transition);position:relative;overflow:hidden" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 24px rgba(217,4,41,0.2)'" onmouseout="this.style.transform='';this.style.boxShadow=''">
      <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,#ab2c20,transparent)"></div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:11px">
        <div style="width:36px;height:36px;border-radius:9px;background:rgba(171,44,32,0.15);display:flex;align-items:center;justify-content:center;font-size:16px">📉</div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:#ab2c20">Expenses</div>
        <span style="margin-left:auto;font-size:10px;font-weight:600;color:#ab2c20;background:rgba(171,44,32,0.1);padding:1px 6px;border-radius:20px;border:1px solid rgba(171,44,32,0.4)">${DB.expenses.filter(e=>e.date?.startsWith(mo)).length} items</span>
      </div>
      <div style="font-size:32px;font-weight:800;color:#ab2c20;line-height:1;margin-bottom:7px;letter-spacing:-0.5px">${fmtPKR(moExp)}</div>
      <div style="height:3px;background:rgba(255,255,255,0.05);border-radius:2px;overflow:hidden;margin-bottom:5px"><div style="height:100%;width:${collected>0?Math.min(100,Math.round(moExp/collected*100)):moExp>0?100:0}%;background:#ab2c20;border-radius:2px"></div></div>
      <div style="font-size:11px;color:var(--text3)">this month</div>
    </div>
    <!-- Transfer to Owner Card — also counted as expense in net calculation -->
    <div onclick="showAddTransferModal()" style="background:linear-gradient(145deg,#1a1a1a,#111111);border:1px solid rgba(191,192,192,0.28);border-radius:var(--radius);padding:18px;cursor:pointer;transition:var(--transition);position:relative;overflow:hidden" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 24px rgba(191,192,192,0.12)'" onmouseout="this.style.transform='';this.style.boxShadow=''">
      <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,#BFC0C0,transparent)"></div>
      ${transfers.length>0?'<div style="position:absolute;top:9px;right:9px;width:6px;height:6px;border-radius:50%;background:#BFC0C0"></div>':''}
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:11px">
        <div style="width:36px;height:36px;border-radius:9px;background:rgba(191,192,192,0.1);display:flex;align-items:center;justify-content:center;font-size:16px">🏦</div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:#BFC0C0">To Owner</div>
        <span style="margin-left:auto;font-size:10px;font-weight:600;color:#BFC0C0;background:rgba(191,192,192,0.07);padding:1px 6px;border-radius:20px;border:1px solid rgba(191,192,192,0.2)">${moTransfers.length} records</span>
      </div>
      <div style="font-size:32px;font-weight:800;color:var(--text);line-height:1;margin-bottom:7px;letter-spacing:-0.5px">${fmtPKR(moTransferTotal)}</div>
      <div style="height:3px;background:rgba(255,255,255,0.05);border-radius:2px;overflow:hidden;margin-bottom:5px"><div style="height:100%;width:${moTransferTotal>0?Math.min(100,Math.round(moTransferTotal/(collected||1)*100)):0}%;background:#BFC0C0;border-radius:2px"></div></div>
      <div style="font-size:11px;color:var(--text3)">${moTransferTotal>0?'deducted from net':'+ New Transfer'}</div>
    </div>
    <div onclick="navigate('payments')" style="background:linear-gradient(145deg,#1f1000,#130a00);border:1px solid rgba(251,133,0,0.3);border-radius:var(--radius);padding:18px;cursor:pointer;transition:var(--transition);position:relative;overflow:hidden" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 24px rgba(251,133,0,0.15)'" onmouseout="this.style.transform='';this.style.boxShadow=''">
      <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,#FB8500,transparent)"></div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:11px">
        <div style="width:36px;height:36px;border-radius:9px;background:rgba(251,133,0,0.15);display:flex;align-items:center;justify-content:center;font-size:16px">⏳</div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:#FB8500">Pending</div>
        <span style="margin-left:auto;font-size:10px;font-weight:600;color:#FB8500;background:rgba(251,133,0,0.1);padding:1px 6px;border-radius:20px;border:1px solid rgba(251,133,0,0.25)">${totalExpected>0?Math.round(pending/totalExpected*100):0}% · ${pendingCount} unpaid</span>
      </div>
      <div style="font-size:32px;font-weight:800;color:var(--text);line-height:1;margin-bottom:7px;letter-spacing:-0.5px">${fmtPKR(pending)}</div>
      <div style="height:3px;background:rgba(255,255,255,0.05);border-radius:2px;overflow:hidden;margin-bottom:5px"><div style="height:100%;width:${totalExpected>0?Math.round(pending/totalExpected*100):0}%;background:#FB8500;border-radius:2px"></div></div>
      <div style="font-size:11px;color:var(--text3)">click to collect</div>
    </div>
  </div>`;})()}

  <!-- ══ STAT BADGES: Occupied | Vacant | Active ══ -->
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">
    <div onclick="showOccupiedRoomsModal()" style="background:linear-gradient(135deg,#041a10,#021009);border:1px solid rgba(68,212,144,0.45);border-radius:10px;padding:14px 16px;cursor:pointer;transition:var(--transition);position:relative;overflow:hidden;display:flex;align-items:center;gap:12px" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 6px 20px rgba(75,125,100,0.25)'" onmouseout="this.style.transform='';this.style.boxShadow=''">
      <div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#44d490,transparent)"></div>
      <div style="width:40px;height:40px;border-radius:10px;background:rgba(68,212,144,0.2);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">🏠</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#44d490;margin-bottom:3px">Occupied Rooms</div>
        <div style="display:flex;align-items:baseline;gap:6px">
          <span style="font-size:28px;font-weight:900;color:#44d490;line-height:1;letter-spacing:-0.5px">${occ}</span>
          <span style="font-size:11px;color:var(--text3)">of ${DB.rooms.length}</span>
          ${seatsRemainingInOccupiedRooms>0?`<span style="background:rgba(68,212,144,0.2);border:1px solid rgba(68,212,144,0.4);border-radius:20px;padding:2px 7px;font-size:9px;font-weight:800;color:#44d490">+${seatsRemainingInOccupiedRooms} free</span>`:''}
        </div>
        <div style="height:3px;background:rgba(255,255,255,0.05);border-radius:2px;overflow:hidden;margin-top:6px"><div style="height:100%;width:${DB.rooms.length?Math.round(occ/DB.rooms.length*100):0}%;background:linear-gradient(90deg,#44d490,#6aedaa);border-radius:2px"></div></div>
      </div>
    </div>
    <div onclick="showVacantRoomsModal()" style="background:linear-gradient(135deg,#041a10,#021009);border:1px solid rgba(68,212,144,0.35);border-radius:10px;padding:14px 16px;cursor:pointer;transition:var(--transition);position:relative;overflow:hidden;display:flex;align-items:center;gap:12px" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 6px 20px rgba(15,188,173,0.15)'" onmouseout="this.style.transform='';this.style.boxShadow=''">
      <div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--teal),transparent)"></div>
      <div style="width:40px;height:40px;border-radius:10px;background:rgba(15,188,173,0.15);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">🔑</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#44d490;margin-bottom:3px">Vacant Rooms</div>
        <div style="display:flex;align-items:baseline;gap:6px">
          <span style="font-size:28px;font-weight:900;color:#44d490;line-height:1;letter-spacing:-0.5px">${vac}</span>
          <span style="font-size:11px;color:var(--text3)">${availSeats} seats free</span>
        </div>
        <div style="height:3px;background:rgba(255,255,255,0.05);border-radius:2px;overflow:hidden;margin-top:6px"><div style="height:100%;width:${DB.rooms.length?Math.round(vac/DB.rooms.length*100):0}%;background:linear-gradient(90deg,#44d490,#6aedaa);border-radius:2px"></div></div>
      </div>
    </div>
    <div onclick="navigate('students')" style="background:linear-gradient(135deg,#041a10,#021009);border:1px solid rgba(68,212,144,0.35);border-radius:10px;padding:14px 16px;cursor:pointer;transition:var(--transition);position:relative;overflow:hidden;display:flex;align-items:center;gap:12px" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 6px 20px rgba(144,224,239,0.15)'" onmouseout="this.style.transform='';this.style.boxShadow=''">
      <div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#90E0EF,transparent)"></div>
      <div style="width:40px;height:40px;border-radius:10px;background:rgba(144,224,239,0.15);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">🧑‍🎓</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#44d490;margin-bottom:3px">Active Students</div>
        <div style="display:flex;align-items:baseline;gap:6px">
          <span style="font-size:28px;font-weight:900;color:#44d490;line-height:1;letter-spacing:-0.5px">${activeStudents}</span>
          <span style="font-size:11px;color:var(--text3)">${DB.students.length} registered</span>
        </div>
        <div style="height:3px;background:rgba(255,255,255,0.05);border-radius:2px;overflow:hidden;margin-top:6px"><div style="height:100%;width:${totalSeats>0?Math.round(activeStudents/totalSeats*100):0}%;background:linear-gradient(90deg,#44d490,#6aedaa);border-radius:2px"></div></div>
      </div>
    </div>
  </div>
  <!-- ══ TREND + SEAT AVAILABILITY ROW ══ -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
  <div style="background:linear-gradient(180deg,#071220 0%,#040c16 100%);border:1px solid rgba(46,201,138,0.2);border-radius:var(--radius);padding:10px 14px 6px;position:relative;overflow:hidden">
    <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,#2ec98a,#0fbcad,transparent)"></div>
    <!-- Header: title row -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
      <div style="display:flex;align-items:center;gap:8px">
        <div style="width:26px;height:26px;border-radius:7px;background:rgba(46,201,138,0.13);display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0">📈</div>
        <div style="font-size:12px;font-weight:800;color:#e8eef8">Revenue Trend <span style="font-size:9px;font-weight:400;color:rgba(142,165,200,0.55)">· Jan–Dec</span></div>
      </div>
      <!-- Legend -->
      <div style="display:flex;align-items:center;gap:10px">
        <span style="display:flex;align-items:center;gap:3px"><span style="display:inline-block;width:14px;height:2.5px;background:#00e676;border-radius:2px"></span><span style="font-size:9px;color:rgba(0,230,118,0.95);font-weight:700">Revenue</span></span>
        <span style="display:flex;align-items:center;gap:3px"><span style="display:inline-block;width:14px;height:2.5px;background:#ff4d6d;border-radius:2px"></span><span style="font-size:9px;color:rgba(255,77,109,0.95);font-weight:700">Expenses</span></span>
        <span style="display:flex;align-items:center;gap:3px"><span style="display:inline-block;width:14px;height:2.5px;background:#ff8c42;border-radius:2px"></span><span style="font-size:9px;color:rgba(255,140,66,0.95);font-weight:700">Transfers</span></span>
        <span style="display:flex;align-items:center;gap:3px"><span style="display:inline-block;width:12px;height:2px;background:#f0c040;border-radius:2px"></span><span style="font-size:9px;color:rgba(240,192,64,0.9);font-weight:600">Pending</span></span>
      </div>
    </div>
    <!-- KPI chips row -->
    <div style="display:flex;gap:6px;margin-bottom:6px">
      <div style="flex:1;background:rgba(46,201,138,0.08);border:1px solid rgba(46,201,138,0.18);border-radius:7px;padding:4px 8px;display:flex;align-items:baseline;justify-content:space-between">
        <span style="font-size:9px;color:rgba(46,201,138,0.7);font-weight:700;text-transform:uppercase;letter-spacing:0.3px">Revenue</span>
        <span style="font-size:15px;font-weight:900;color:#2ec98a;letter-spacing:-0.5px">${fmtPKR(collected)}</span>
      </div>
      <div style="flex:1;background:rgba(224,82,82,0.08);border:1px solid rgba(224,82,82,0.15);border-radius:7px;padding:4px 8px;display:flex;align-items:baseline;justify-content:space-between">
        <span style="font-size:9px;color:rgba(224,82,82,0.7);font-weight:700;text-transform:uppercase;letter-spacing:0.3px">Expenses</span>
        <span style="font-size:15px;font-weight:900;color:#e05252;letter-spacing:-0.5px">${fmtPKR(moExp)}</span>
      </div>
      <div style="flex:1;background:${netProfit>=0?'rgba(46,201,138,0.08)':'rgba(224,82,82,0.08)'};border:1px solid ${netProfit>=0?'rgba(46,201,138,0.15)':'rgba(224,82,82,0.15)'};border-radius:7px;padding:4px 8px;display:flex;align-items:baseline;justify-content:space-between">
        <span style="font-size:9px;color:${netProfit>=0?'rgba(46,201,138,0.7)':'rgba(224,82,82,0.7)'};font-weight:700;text-transform:uppercase;letter-spacing:0.3px">Net</span>
        <span style="font-size:13px;font-weight:900;color:${netProfit>=0?'#2ec98a':'#e05252'};letter-spacing:-0.3px">${netProfit>=0?'+':''}${fmtPKR(netProfit)}</span>
      </div>
    </div>
    <!-- Chart.js canvas -->
    <div id="trend-chart-wrap" style="position:relative;height:160px;">
      <div id="trend-hb" style="position:fixed;background:#0f1c2e;border:1px solid #2a3d52;border-radius:10px;padding:12px 14px;font-size:12px;pointer-events:none;display:none;z-index:9999;min-width:210px;box-shadow:0 8px 24px rgba(0,0,0,.6);"></div>
      <canvas id="trend-canvas" style="display:block"></canvas>
    </div>
  </div>
  <!-- Seat availability — interactive room grid -->
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:10px;position:relative;overflow:hidden">
      <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--green),var(--teal),var(--purple))"></div>
      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:30px;height:30px;border-radius:8px;background:var(--teal-dim);display:flex;align-items:center;justify-content:center;font-size:14px">🛏️</div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--teal)">Seat Availability</div>
        </div>
        <div style="display:flex;gap:6px">
          <button onclick="printSeatAvailability()" style="font-size:10px;background:var(--bg3);border:1px solid var(--border2);color:var(--text2);border-radius:6px;padding:3px 9px;cursor:pointer;font-weight:600;display:flex;align-items:center;gap:4px"><span class="micon" style="font-size:13px">print</span>Print</button>
          <button onclick="showSeatDetailModal('rooms')" style="font-size:10px;background:var(--bg3);border:1px solid var(--border2);color:var(--text2);border-radius:6px;padding:3px 9px;cursor:pointer;font-weight:600">Expand ↗</button>
        </div>
      </div>
      <!-- Summary row -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;margin-bottom:10px">
        <div onclick="showSeatDetailModal('rooms')" style="background:rgba(15,188,173,0.1);border:1px solid rgba(15,188,173,0.2);border-radius:8px;padding:7px;text-align:center;cursor:pointer" title="All rooms">
          <div style="font-size:20px;font-weight:900;color:var(--teal)">${totalSeats}</div>
          <div style="font-size:9px;color:var(--text3);text-transform:uppercase;font-weight:600">Total</div>
        </div>
        <div onclick="showSeatDetailModal('vacant')" style="background:rgba(46,201,138,0.1);border:1px solid rgba(46,201,138,0.2);border-radius:8px;padding:7px;text-align:center;cursor:pointer" title="Free seats">
          <div style="font-size:20px;font-weight:900;color:var(--green)">${availSeats}</div>
          <div style="font-size:9px;color:var(--text3);text-transform:uppercase;font-weight:600">Free</div>
        </div>
        <div onclick="showSeatDetailModal('occupied')" style="background:rgba(224,82,82,0.1);border:1px solid rgba(224,82,82,0.2);border-radius:8px;padding:7px;text-align:center;cursor:pointer" title="Filled seats">
          <div style="font-size:20px;font-weight:900;color:var(--red)">${allActiveSeats}</div>
          <div style="font-size:9px;color:var(--text3);text-transform:uppercase;font-weight:600">Filled</div>
        </div>
      </div>
      <!-- Per-room mini tiles -->
      <div style="display:flex;flex-wrap:wrap;gap:4px;max-height:88px;overflow-y:auto">
        ${DB.rooms.map(r=>{
          const rtype2=getRoomType(r);
          const cap=rtype2?.capacity||1;
          const occ2=getRoomOccupancy(r);
          const free=cap-occ2;
          const pct=Math.round(occ2/cap*100);
          const isFull=free===0;
          const students2=DB.students.filter(s=>s.roomId===r.id&&s.status==='Active');
          return `<div onclick="showRoomSeatDetailModal('${r.id}')" title="Room #${r.number} — ${occ2}/${cap} filled, ${free} free — click to edit" style="background:${isFull?'rgba(46,201,138,0.12)':'rgba(200,168,75,0.1)'};border:1px solid ${isFull?'rgba(46,201,138,0.3)':'rgba(200,168,75,0.3)'};border-radius:6px;padding:5px 7px;cursor:pointer;min-width:38px;text-align:center;transition:all 0.15s" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 4px 12px rgba(0,0,0,0.3)'" onmouseout="this.style.transform='';this.style.boxShadow=''">
            <div style="font-size:11px;font-weight:900;color:${isFull?'var(--green)':'var(--gold2)'}">${r.number}</div>
            <div style="font-size:9px;color:var(--text3)">${occ2}/${cap}</div>
            <div style="height:3px;background:var(--bg4);border-radius:2px;margin-top:3px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${isFull?'var(--green)':'var(--gold)'};border-radius:2px"></div></div>
          </div>`;
        }).join('')}
      </div>
      <div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:4px"><div style="width:8px;height:8px;border-radius:2px;background:var(--gold)"></div><span style="font-size:10px;color:var(--text3)">Has free seats</span></div>
        <div style="display:flex;align-items:center;gap:4px"><div style="width:8px;height:8px;border-radius:2px;background:var(--green)"></div><span style="font-size:10px;color:var(--text3)">Full</span></div>
        <span style="font-size:10px;color:var(--text3);margin-left:auto">👆 tap any room</span>
      </div>
    </div>
  </div><!-- end 2-col trend+seat grid -->

  <!-- ══ ROW 3+4: BY ROOM TYPE + PENDING PAYMENTS (same row) ══ -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
  <div class="card" style="position:relative;margin-bottom:0">
    <div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--teal),var(--blue));border-radius:var(--radius) var(--radius) 0 0"></div>
    <div class="card-header" style="padding-bottom:10px;border-bottom:1px solid var(--border);margin-bottom:4px">
      <div class="card-title" style="font-size:16px"><span class="dash-pill-heading" style="background:rgba(15,188,173,0.1);border-color:rgba(15,188,173,0.25);color:var(--teal)"><span class="micon" style="font-size:16px">bed</span>By Room Type</span></div>
      <span style="font-size:12px;color:var(--teal);font-weight:800;background:var(--teal-dim);padding:3px 10px;border-radius:20px;border:1px solid rgba(15,188,173,0.25)">${seatPct}% full</span>
    </div>
    <div style="height:5px;background:var(--bg4);border-radius:3px;overflow:hidden;margin-bottom:12px">
      <div style="height:100%;width:${seatPct}%;background:linear-gradient(90deg,var(--green),var(--gold));border-radius:3px;transition:width 0.6s"></div>
    </div>
    ${seatBreakdown.replace(/<div style="display:flex;align-items:center;gap:14px;padding:10px 0;border-bottom:1px solid var\(--border\)">/g,'<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid rgba(30,48,80,0.5)">')}
  </div>
  <!-- PENDING PAYMENTS -->
  <div class="card" style="position:relative;display:flex;flex-direction:column;margin-bottom:0">
      <div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--gold),var(--amber))"></div>
      <div class="card-header" style="padding-bottom:10px;border-bottom:1px solid var(--border);margin-bottom:0">
        <div class="card-title" style="font-size:16px"><span class="dash-pill-heading" style="background:rgba(200,168,75,0.1);border-color:rgba(200,168,75,0.25);color:var(--gold2)"><span class="micon" style="font-size:16px">schedule</span>Pending Payments</span></div>
        <span class="badge badge-gold" style="font-size:12px;padding:4px 10px">${pendingCount}</span>
      </div>
      <div style="flex:1;overflow-y:auto;max-height:280px;padding-top:6px">
      ${(()=>{const moPending=DB.payments.filter(p=>p.status==='Pending'&&_payMatchesMonth(p,mo));return moPending.length===0?
        '<div style="padding:32px;text-align:center;color:var(--text3)"><div style="font-size:36px;margin-bottom:10px">🎉</div><div style="font-size:14px;font-weight:600">All cleared!</div></div>':
        moPending.slice(0,10).map(p=>{
          const unpaidShow = p.unpaid!=null?p.unpaid:p.amount;
          return '<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid rgba(30,48,80,0.5)">'
          +'<div onclick="showViewStudentModal(\''+p.studentId+'\')" style="cursor:pointer;flex:1;min-width:0">'
          +'<div style="font-size:13px;font-weight:700;color:var(--blue);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+escHtml(p.studentName||'')+'</div>'
          +'<div style="font-size:10px;color:var(--text3);margin-top:1px">Rm #'+(p.roomNumber||'?')+' · '+escHtml(p.month||'—')+'</div>'
          +'</div>'
          +'<div style="display:flex;align-items:center;gap:5px;flex-shrink:0;margin-left:8px">'
          +'<div style="text-align:right">'
          +'<div style="font-size:12px;font-weight:800;color:var(--red)">'+fmtPKR(unpaidShow)+'</div>'
          +'<div style="font-size:9px;color:var(--text3)">unpaid</div>'
          +'</div>'
          +'<button class="btn btn-success btn-sm" onclick="event.stopPropagation();markPaymentPaid(\''+p.id+'\');renderPage(\'dashboard\')" style="font-size:10px;padding:3px 7px" title="Mark paid"><span class=\"micon\" style=\"font-size:14px\">check_circle</span></button>'
          +'<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();showEditPaymentModal(\''+p.id+'\')" style="font-size:10px;padding:3px 7px" title="Edit"><span class=\"micon\" style=\"font-size:14px\">edit</span></button>'
          +'</div></div>';
        }).join('')})()}
      </div>
      ${pendingCount>0?`<div style="padding-top:10px;border-top:1px solid var(--border);margin-top:auto;display:flex;gap:8px"><button class="btn btn-secondary btn-sm" style="flex:1" onclick="navigate('payments')">View All →</button><button class="btn btn-sm" style="flex:1;background:#25d366;color:#fff;border:none" onclick="showRentReminderModal()"><span class=\"micon\" style=\"font-size:14px\">chat</span> Remind</button></div>`:''}
    </div>
  </div>
  </div><!-- end row3+4 grid -->

  <!-- ══ ROW 5: RECENT PAYMENTS ══ -->
  <div class="card" style="position:relative">
    <div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--blue),var(--purple))"></div>
    <div class="card-header" style="padding-bottom:10px;border-bottom:1px solid var(--border);margin-bottom:4px">
      <div class="card-title" style="font-size:16px"><span class="dash-pill-heading" style="background:rgba(74,156,240,0.1);border-color:rgba(74,156,240,0.25);color:var(--blue)"><span class="micon" style="font-size:16px">credit_card</span>Recent Payments</span></div>
      <button class="btn btn-secondary btn-sm" onclick="navigate('payments')" style="font-size:11px">View All →</button>
    </div>
    ${recentPay.length===0?'<div style="padding:32px;text-align:center;color:var(--text3)"><div style="font-size:36px;margin-bottom:10px">💳</div><div style="font-size:14px;font-weight:600">No payments yet</div></div>':
    '<div class="table-wrap" style="border:none">'
    +'<table><thead><tr><th style="font-size:10px">Student</th><th style="font-size:10px">Room</th><th style="font-size:10px">Monthly Rent</th><th style="font-size:10px">Paid (+Extras)</th><th style="font-size:10px">Unpaid</th><th style="font-size:10px">Method</th><th style="font-size:10px">Status</th><th style="font-size:10px">Date</th></tr></thead><tbody>'
    +recentPay.map(p=>{
      const st2 = DB.students.find(s=>s.id===p.studentId);
      const mRent = p.monthlyRent||p.totalRent||st2?.rent||0;
      const admFee = Number(p.fee||0);
      const extras = p.extraCharges||[];
      const unpaidAmt2=p.unpaid!=null?p.unpaid:0;
      let paidCell='<span style="color:var(--green);font-weight:700;font-size:12px">'+fmtPKR(p.amount)+'</span>';
      if(admFee>0) paidCell+='<div style="font-size:10px;color:var(--blue);font-weight:700">+'+fmtPKR(admFee)+' adm.</div>';
      extras.forEach(c=>{paidCell+='<div style="font-size:10px;color:var(--amber);font-weight:700">+'+fmtPKR(c.amount)+' '+escHtml(c.label||'')+'</div>';});
      return '<tr style="cursor:pointer" onclick="showViewStudentModal(\''+p.studentId+'\')">'
      +'<td><div style="display:flex;align-items:center;gap:7px">'
      +'<div style="width:26px;height:26px;border-radius:7px;background:var(--gold-dim);color:var(--gold2);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:11px;flex-shrink:0">'+(p.studentName||'?')[0].toUpperCase()+'</div>'
      +'<span style="font-weight:700;color:var(--blue);font-size:12px">'+escHtml(p.studentName||'')+'</span></div></td>'
      +'<td><span style="color:var(--gold2);font-weight:700;font-size:12px">#'+(p.roomNumber||'')+'</span></td>'
      +'<td><span style="font-weight:700;font-size:12px">'+(mRent>0?fmtPKR(mRent):'—')+'</span></td>'
      +'<td>'+paidCell+'</td>'
      +'<td><span style="color:'+(unpaidAmt2>0?'var(--red)':'var(--text3)')+';font-weight:700;font-size:12px">'+(unpaidAmt2>0?fmtPKR(unpaidAmt2):'—')+'</span></td>'
      +'<td>'+pmBadge(p.method)+'</td>'
      +'<td>'+statusBadge(p.status)+'</td>'
      +'<td style="font-size:11px;color:var(--text3)">'+fmtDate(p.date)+'</td>'
      +'</tr>';
    }).join('')
    +'</tbody></table></div>'}
  </div>`;
}

function showRoomSeatDetailModal(roomId) {
  const r = DB.rooms.find(x=>x.id===roomId); if(!r) return;
  const rtype = getRoomType(r);
  const cap = rtype?.capacity||1;
  const students = DB.students.filter(s=>s.roomId===r.id&&s.status==='Active');
  const occ = students.length;
  const free = cap - occ;
  const isFull = free===0;

  // Build seat slots
  let seatSlots = '';
  for(let i=0;i<cap;i++){
    const s = students[i];
    if(s){
      seatSlots += `<div style="background:var(--green-dim);border:1px solid rgba(46,201,138,0.3);border-radius:9px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:28px;height:28px;border-radius:7px;background:var(--gold-dim);color:var(--gold2);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;flex-shrink:0">${s.name[0]}</div>
          <div>
            <div style="font-weight:700;font-size:13px;color:var(--text)">${escHtml(s.name)}</div>
            <div style="font-size:11px;color:var(--text3)">${escHtml(s.phone||'No phone')}</div>
          </div>
        </div>
        <div style="display:flex;gap:5px">
          <button class="btn btn-secondary btn-sm" style="font-size:10px" onclick="closeModal();showViewStudentModal('${s.id}')">👁 View</button>
          <button class="btn btn-secondary btn-sm" style="font-size:10px" onclick="closeModal();showEditStudentModal('${s.id}')">✏️ Edit</button>
        </div>
      </div>`;
    } else {
      seatSlots += `<div style="background:var(--amber-dim);border:1px dashed rgba(200,168,75,0.4);border-radius:9px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:28px;height:28px;border-radius:7px;background:rgba(200,168,75,0.1);display:flex;align-items:center;justify-content:center;font-size:14px">🪑</div>
          <div style="font-size:13px;color:var(--text3);font-style:italic">Seat ${i+1} — Free</div>
        </div>
        <button class="btn btn-primary btn-sm" style="font-size:10px" onclick="closeModal();showAddStudentModal('${r.id}')">+ Add Student</button>
      </div>`;
    }
  }

  showModal('modal-md', `🛏️ Room #${r.number} — Seat Details`,`
    <!-- Room header -->
    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:18px;display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;text-align:center">
      <div>
        <div style="font-size:22px;font-weight:900;color:var(--gold2)">#${r.number}</div>
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase">Room</div>
      </div>
      <div>
        <div style="font-size:22px;font-weight:900;color:var(--text)">${rtype?.name||'—'}</div>
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase">Type</div>
      </div>
      <div>
        <div style="font-size:22px;font-weight:900;color:${isFull?'var(--green)':'var(--gold2)'}">${occ}/${cap}</div>
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase">Occupied</div>
      </div>
      <div>
        <div style="font-size:22px;font-weight:900;color:${free>0?'var(--teal)':'var(--text3)'}">${free}</div>
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase">Free</div>
      </div>
    </div>
    <!-- Progress bar -->
    <div style="height:6px;background:var(--bg4);border-radius:3px;overflow:hidden;margin-bottom:18px">
      <div style="height:100%;width:${Math.round(occ/cap*100)}%;background:${isFull?'var(--green)':'var(--gold)'};border-radius:3px;transition:width 0.5s"></div>
    </div>
    <!-- Seat slots -->
    <div style="display:flex;flex-direction:column;gap:8px">${seatSlots}</div>
  `,`
    <button class="btn btn-secondary" onclick="closeModal();showRoomDetail('${r.id}')">🏠 Full Room Details</button>
    ${free>0?`<button class="btn btn-primary" onclick="closeModal();showAddStudentModal('${r.id}')">+ Add Student</button>`:''}
    <button class="btn btn-secondary" onclick="closeModal()">Close</button>
  `);
}


// ── SEAT AVAILABILITY PRINT REPORT ──────────────────────────────────────────
function printSeatAvailability() {
  const hostel = DB.settings.hostelName || 'DAMAM Boys Hostel';
  const location = DB.settings.location || '';
  const now2 = new Date().toLocaleDateString('en-PK',{day:'2-digit',month:'long',year:'numeric'});
  const totalSeats = DB.rooms.reduce((s,r)=>{const t=DB.settings.roomTypes.find(x=>x.id===r.typeId);return s+(t?t.capacity:1);},0);
  const allActiveSeats2 = DB.students.filter(t=>t.status==='Active').length; // badge: ALL active
  const filledSeats = DB.students.filter(t=>t.status==='Active' && !t.isForced).length; // for free seat calc
  const freeSeats = totalSeats - filledSeats;
  const floors = [...new Set(DB.rooms.map(r=>r.floor||'Unknown'))].sort();
  let body = '';

  floors.forEach(floor => {
    const floorRooms = DB.rooms.filter(r=>(r.floor||'Unknown')===floor).sort((a,b)=>a.number-b.number);
    body += `<div class="floor-label">${floor} Floor</div><div class="room-grid">`;

    floorRooms.forEach(r => {
      const rtype = DB.settings.roomTypes.find(t=>t.id===r.typeId);
      const cap = rtype ? rtype.capacity : 1;
      const students = DB.students.filter(s=>s.roomId===r.id&&s.status==='Active');
      const occ = students.length;
      const free = cap - occ;
      const isFull = free === 0;
      const hasBath = (r.amenities||[]).some(a=>/bath|attach/i.test(a));

      const labelStyle = r.roomLabelFont ? `font-family:${r.roomLabelFont};` : '';
      body += `<div class="room-box ${isFull?'full':'partial'}">
        <div class="room-top">
          <span class="rnum" style="${labelStyle}">${r.roomLabel ? r.roomLabel+' · ' : ''}Rm #${r.number}</span>
          <span class="rtype">${rtype?rtype.name:'—'}</span>
          ${hasBath?'<span class="bath">🚿 Bath</span>':''}
          <span class="seats ${isFull?'seats-full':'seats-free'}">${isFull?'Full':free+' free'}</span>
        </div>
        <div class="occ-bar"><div style="width:${Math.round(occ/cap*100)}%;background:${isFull?'#16a34a':'#dc2626'};height:100%;border-radius:2px"></div></div>`;

      if (students.length) {
        students.forEach((s,i) => {
          body += `<div class="student-row"><span class="snum">${i+1}</span><span class="sname">${escHtml(s.name)}</span><span class="scourse">${escHtml(s.occupation||'—')}</span></div>`;
        });
      } else {
        body += `<div class="empty-row">— Vacant —</div>`;
      }
      // Outgoing: students with pending/confirmed cancellation in this room
      const outgoing = (DB.cancellations||[]).filter(c=>c.roomId===r.id&&(c.status==='Pending'||c.status==='Confirmed'));
      outgoing.forEach(c => {
        const vacDate = c.vacateDate ? new Date(c.vacateDate+'T00:00:00').toLocaleDateString('en-PK',{day:'2-digit',month:'short',year:'numeric'}) : 'TBD';
        body += `<div class="student-row outgoing-row"><span class="snum">↩</span><span class="sname" style="text-decoration:line-through;color:#999">${escHtml(c.studentName||'—')}</span><span class="out-badge">Out Going · ${vacDate}</span></div>`;
      });

      // Empty seat slots
      for(let i=occ;i<cap;i++){
        body += `<div class="seat-slot">Seat ${i+1} <span style="color:#bbb">— available —</span></div>`;
      }
      body += `</div>`;
    });
    body += `</div>`;
  });

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Room Visit Sheet</title>
  <style>
    @page { size: A4; margin: 10mm 10mm; }
    @media print { .no-print{display:none!important} }
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;font-size:11px;color:#111;background:#fff;padding:10px}
    .header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:10px}
    .header h1{font-size:18px;font-weight:900;color:#0f1a2e}
    .header .sub{font-size:10px;color:#666;margin-top:2px}
    .header .date{font-size:11px;font-weight:700;text-align:right;color:#333}
    .summary{display:flex;gap:8px;margin-bottom:12px}
    .sbox{flex:1;border:1.5px solid #ddd;border-radius:5px;padding:6px 10px;text-align:center}
    .sbox .v{font-size:20px;font-weight:900}
    .sbox .l{font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#888}
    .floor-label{font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#fff;background:#0f1a2e;padding:5px 10px;border-radius:4px;margin:10px 0 6px}
    .room-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:4px}
    .room-box{border:1.5px solid #ccc;border-radius:6px;padding:7px 9px;page-break-inside:avoid}
    .room-box.full{border-color:#16a34a;background:#f0fff5}
    .room-box.partial{border-color:#d97706;background:#fffdf0}
    .room-top{display:flex;align-items:center;gap:5px;margin-bottom:4px;flex-wrap:wrap}
    .rnum{font-size:13px;font-weight:900;color:#0f1a2e}
    .rtype{font-size:9px;background:#eee;border-radius:20px;padding:1px 6px;color:#555}
    .bath{font-size:9px;background:#e0f2fe;color:#0369a1;border-radius:20px;padding:1px 6px;font-weight:700}
    .seats{font-size:9px;font-weight:800;margin-left:auto;padding:1px 7px;border-radius:20px}
    .seats-full{background:#dcfce7;color:#15803d}
    .seats-free{background:#fef3c7;color:#b45309}
    .occ-bar{height:3px;background:#eee;border-radius:2px;margin-bottom:5px;overflow:hidden}
    .student-row{display:flex;align-items:center;gap:5px;padding:2px 0;border-bottom:1px dashed #eee;font-size:10px}
    .snum{width:14px;color:#aaa;font-weight:700;flex-shrink:0}
    .sname{font-weight:700;flex:1;color:#111}
    .scourse{color:#0369a1;font-size:9px;font-weight:700;background:#e0f2fe;border-radius:20px;padding:1px 6px;white-space:nowrap}
    .empty-row{font-size:10px;color:#aaa;font-style:italic;padding:2px 0}
    .seat-slot{font-size:10px;color:#bbb;padding:2px 0;border-bottom:1px dashed #f0f0f0}
    .outgoing-row{opacity:0.75}
    .out-badge{font-size:8px;font-weight:800;background:#fee2e2;color:#dc2626;border-radius:20px;padding:1px 6px;white-space:nowrap;margin-left:auto}
    .footer{margin-top:12px;text-align:center;font-size:9px;color:#aaa;border-top:1px solid #eee;padding-top:6px}
    .print-btn{display:block;margin:0 auto 12px;padding:8px 24px;background:#0f1a2e;color:#e6c96e;border:none;border-radius:5px;font-size:13px;font-weight:700;cursor:pointer}
  </style></head><body>
  <button class="print-btn no-print" onclick="window.print()">🖨️ Print Visit Sheet</button>
  <div class="header">
    <div>
      <h1>${escHtml(hostel)}</h1>
      <div class="sub">${escHtml(location)}</div>
      <div class="sub" style="margin-top:2px;font-weight:700">ROOM VISIT SHEET</div>
    </div>
    <div class="date">${now2}<br><span style="font-size:9px;color:#aaa">Carry this during room visits</span></div>
  </div>
  <div class="summary">
    <div class="sbox"><div class="v">${DB.rooms.length}</div><div class="l">Rooms</div></div>
    <div class="sbox"><div class="v" style="color:#111">${totalSeats}</div><div class="l">Total Seats</div></div>
    <div class="sbox"><div class="v" style="color:#dc2626">${allActiveSeats2}</div><div class="l">Occupied</div></div>
    <div class="sbox"><div class="v" style="color:#16a34a">${freeSeats}</div><div class="l">Available</div></div>
  </div>
  ${body}
  <div class="footer">${escHtml(hostel)} · Room Visit Sheet · ${now2}</div>
  </body></html>`;

  _electronPDF(html, (DB.settings.hostelName||'Hostel').replace(/\s+/g,'-').replace(/[^a-zA-Z0-9\-]/g,'')+'_Room-Visit-Sheet_'+new Date().toISOString().slice(0,10)+'.pdf', {pageSize:'A4'});
}
// ─────────────────────────────────────────────────────────────────────────────
function showSeatDetailModal(type) {
  if(type==='rooms') {
    // Show full room grid modal
    const allRooms = DB.rooms;
    let content = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px">';
    allRooms.forEach(r=>{
      const rt=getRoomType(r); const cap=rt?.capacity||1; const occ2=getRoomOccupancy(r); const free=cap-occ2;
      content+=`<div onclick="closeModal();showRoomSeatDetailModal('${r.id}')" style="background:${free===0?'var(--green-dim)':'var(--amber-dim)'};border:1px solid ${free===0?'rgba(46,201,138,0.3)':'rgba(200,168,75,0.3)'};border-radius:10px;padding:12px;cursor:pointer;transition:all 0.15s" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''">
        <div style="font-size:18px;font-weight:900;color:var(--text)">Rm #${r.number}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px">${rt?.name||'—'} · Floor ${r.floor||'?'}</div>
        <div style="margin-top:8px;display:flex;justify-content:space-between">
          <span style="font-size:12px;font-weight:700;color:${free===0?'var(--green)':'var(--gold2)'}">Occ: ${occ2}/${cap}</span>
          <span style="font-size:12px;font-weight:700;color:${free>0?'var(--teal)':'var(--text3)'}">${free} free</span>
        </div>
        <div style="height:4px;background:var(--bg4);border-radius:2px;margin-top:6px;overflow:hidden"><div style="height:100%;width:${Math.round(occ2/cap*100)}%;background:${free===0?'var(--green)':'var(--gold)'};border-radius:2px"></div></div>
      </div>`;
    });
    content += '</div>';
    showModal('modal-xl','🛏️ All Rooms — Seat Availability',`<div style="max-height:500px;overflow-y:auto">${content}</div>`);
    return;
  }
  let title, color, rows='';
  if(type==='vacant') {
    title='🔑 Vacant Rooms — Free Seats';
    color='var(--gold)';
    const vacantRooms = DB.rooms.filter(r=>{
      const occ=getRoomOccupancy(r);
      const cap=getRoomType(r)?.capacity||1;
      return occ < cap;
    });
    if(!vacantRooms.length){rows='<div style="padding:24px;text-align:center;color:var(--text3)">No vacant rooms</div>';}
    else vacantRooms.forEach(r=>{
      const type=getRoomType(r);
      const occ=getRoomOccupancy(r);
      const cap=type?.capacity||1;
      const free=cap-occ;
      rows+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">
        <div>
          <div style="font-weight:700;color:var(--text)">Room #${r.number}</div>
          <div style="font-size:12px;color:var(--text3)">${type?.name||'—'} · Floor ${r.floor||'?'}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:13px;font-weight:700;color:var(--green)">${free} free seat${free!==1?'s':''}</div>
          <div style="font-size:11px;color:var(--text3)">${occ}/${cap} occupied</div>
        </div>
      </div>`;
    });
  } else if(type==='occupied') {
    title='🏠 Occupied Rooms — Filled Seats';
    color='var(--green)';
    const occRooms = DB.rooms.filter(r=>getRoomOccupancy(r)>0);
    if(!occRooms.length){rows='<div style="padding:24px;text-align:center;color:var(--text3)">No occupied rooms</div>';}
    else occRooms.forEach(r=>{
      const rtype=getRoomType(r);
      const occ=getRoomOccupancy(r);
      const cap=rtype?.capacity||1;
      const students=DB.students.filter(s=>s.roomId===r.id&&s.status==='Active');
      rows+=`<div style="padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <div>
            <span style="font-weight:700;color:var(--text)">Room #${r.number}</span>
            <span style="font-size:12px;color:var(--text3);margin-left:8px">${rtype?.name||'—'} · Floor ${r.floor||'?'}</span>
          </div>
          <span style="font-size:12px;font-weight:700;color:var(--green)">${occ}/${cap} filled</span>
        </div>
        ${students.map(s=>`<div style="display:flex;align-items:center;gap:8px;padding:4px 0;padding-left:8px;border-left:2px solid var(--green)">
          <div style="width:26px;height:26px;border-radius:7px;background:var(--gold-dim);color:var(--gold2);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;flex-shrink:0">${s.name[0]}</div>
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--text)">${escHtml(s.name)}</div>
            <div style="font-size:11px;color:var(--text3)">${escHtml(s.phone||'No phone')}</div>
          </div>
        </div>`).join('')}
      </div>`;
    });
  } else {
    title='🧑‍🎓 Students in Occupied Rooms';
    color='var(--purple)';
    const activeStudents=DB.students.filter(s=>s.status==='Active');
    if(!activeStudents.length){rows='<div style="padding:24px;text-align:center;color:var(--text3)">No active students</div>';}
    else activeStudents.forEach(s=>{
      const room=DB.rooms.find(r=>r.id===s.roomId);
      const rtype=room?getRoomType(room):null;
      rows+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="closeModal();showViewStudentModal('${s.id}')">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:32px;height:32px;border-radius:9px;background:var(--purple-dim);color:var(--purple);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;flex-shrink:0">${s.name[0]}</div>
          <div>
            <div style="font-weight:700;color:var(--blue)">${escHtml(s.name)}</div>
            <div style="font-size:11px;color:var(--text3)">${escHtml(s.phone||'No phone')}</div>
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-size:12px;font-weight:700;color:var(--gold2)">Rm #${room?.number||'?'}</div>
          <div style="font-size:11px;color:var(--text3)">${rtype?.name||'—'}</div>
        </div>
      </div>`;
    });
  }
  showModal('modal-md', title,
    `<div style="border-top:3px solid ${color};margin:-24px -24px 16px;padding:14px 20px;background:var(--bg3)">
      <span style="font-size:12px;color:var(--text3)">Click rows to view details</span>
    </div>
    <div style="max-height:400px;overflow-y:auto">${rows}</div>`);
}

function showOccupiedRoomsModal() {
  const occRooms = DB.rooms.filter(r=>getRoomOccupancy(r)>0);
  const rows = occRooms.map(r=>{
    const type=getRoomType(r);
    const students=DB.students.filter(t=>t.roomId===r.id&&t.status==='Active');
    const occ=students.length;
    const cap=type.capacity;
    return `<tr>
      <td><span style="font-size:16px;font-weight:900;color:var(--gold2)">#${r.number}</span></td>
      <td><span class="badge" style="background:${type.color}22;border-color:${type.color}44;color:${type.color}">${escHtml(type.name)}</span></td>
      <td class="text-muted">${r.floor} Floor</td>
      <td><span class="badge badge-green">${occ}/${cap} beds</span></td>
      <td class="text-green fw-700">${fmtPKR(r.rent)}/mo</td>
      <td>${students.map(s=>`<div style="font-size:12px;color:var(--text);font-weight:600">• ${escHtml(s.name)}</div>`).join('')||'—'}</td>
      <td><button class="btn btn-secondary btn-sm" style="font-size:11px" onclick="closeModal();showRoomDetail('${r.id}')">View</button></td>
    </tr>`;
  }).join('');
  showModal('modal-xl','🏠 Occupied Rooms',`
    <div style="margin-bottom:14px;display:grid;grid-template-columns:repeat(5,1fr);gap:10px">
      <div style="background:var(--green-dim);border:1px solid rgba(46,201,138,0.3);border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:10px;color:var(--green);text-transform:uppercase;letter-spacing:1px;font-weight:700">Occupied Rooms</div>
        <div style="font-size:26px;font-weight:900;color:var(--green)">${occRooms.length}</div>
      </div>
      <div style="background:var(--blue-dim);border:1px solid rgba(74,156,240,0.3);border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:10px;color:var(--blue);text-transform:uppercase;letter-spacing:1px;font-weight:700">Total Students</div>
        <div style="font-size:26px;font-weight:900;color:var(--blue)">${DB.students.filter(t=>t.status==='Active').length}</div>
      </div>
      <div style="background:var(--gold-dim);border:1px solid rgba(200,168,75,0.3);border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:10px;color:var(--gold2);text-transform:uppercase;letter-spacing:1px;font-weight:700">Filled Seats</div>
        <div style="font-size:26px;font-weight:900;color:var(--gold2)">${occRooms.reduce((s,r)=>s+getRoomOccupancy(r),0)}</div>
      </div>
      <div style="background:var(--purple-dim);border:1px solid rgba(155,109,240,0.3);border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:10px;color:var(--purple);text-transform:uppercase;letter-spacing:1px;font-weight:700">Monthly Revenue</div>
        <div style="font-size:18px;font-weight:900;color:var(--purple)">${fmtPKR(occRooms.reduce((s,r)=>{const sts=DB.students.filter(t=>t.roomId===r.id&&t.status==='Active');return s+sts.reduce((ss,t)=>ss+Number(t.rent),0);},0))}</div>
      </div>
      <div style="background:var(--teal-dim);border:1px solid rgba(15,188,173,0.3);border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:10px;color:var(--teal);text-transform:uppercase;letter-spacing:1px;font-weight:700">Occupancy Rate</div>
        <div style="font-size:26px;font-weight:900;color:var(--teal)">${DB.rooms.length?Math.round(occRooms.length/DB.rooms.length*100):0}%</div>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Room</th><th>Type</th><th>Floor</th><th>Occupancy</th><th>Rent</th><th>Students</th><th></th></tr></thead>
        <tbody>${rows||'<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:24px">No occupied rooms</td></tr>'}</tbody>
      </table>
    </div>`);
}

function showVacantRoomsModal() {
  const vacRooms = DB.rooms.filter(r=>{
    const type=getRoomType(r);
    const occ=getRoomOccupancy(r);
    return occ < type.capacity;
  });
  const rows = vacRooms.map(r=>{
    const type=getRoomType(r);
    const occ=getRoomOccupancy(r);
    const avail=type.capacity-occ;
    const students=DB.students.filter(t=>t.roomId===r.id&&t.status==='Active');
    return `<tr>
      <td><span style="font-size:16px;font-weight:900;color:var(--gold2)">#${r.number}</span></td>
      <td><span class="badge" style="background:${type.color}22;border-color:${type.color}44;color:${type.color}">${escHtml(type.name)}</span></td>
      <td class="text-muted">${r.floor} Floor</td>
      <td><span class="badge badge-gold">${occ}/${type.capacity} occupied</span></td>
      <td><span class="badge badge-green" style="font-size:13px;padding:5px 12px">${avail} seat${avail!==1?'s':''} free</span></td>
      <td class="text-green fw-700">${fmtPKR(r.rent)}/mo</td>
      <td>${students.length?students.map(s=>`<div style="font-size:12px;color:var(--text2)">• ${escHtml(s.name)}</div>`).join(''):'<span style="font-size:12px;color:var(--text3)">Empty</span>'}</td>
      <td><button class="btn btn-primary btn-sm" style="font-size:11px" onclick="closeModal();showAddStudentModal('${r.id}')">+ Student</button></td>
    </tr>`;
  }).join('');
  const totalAvail=vacRooms.reduce((s,r)=>{const type=getRoomType(r);return s+(type.capacity-getRoomOccupancy(r));},0);
  showModal('modal-xl','🔑 Rooms with Available Seats',`
    <div style="margin-bottom:14px;display:grid;grid-template-columns:repeat(5,1fr);gap:10px">
      <div style="background:var(--teal-dim);border:1px solid rgba(15,188,173,0.3);border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:10px;color:var(--teal);text-transform:uppercase;letter-spacing:1px;font-weight:700">Rooms w/ Space</div>
        <div style="font-size:26px;font-weight:900;color:var(--teal)">${vacRooms.length}</div>
      </div>
      <div style="background:var(--green-dim);border:1px solid rgba(46,201,138,0.3);border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:10px;color:var(--green);text-transform:uppercase;letter-spacing:1px;font-weight:700">Free Seats</div>
        <div style="font-size:26px;font-weight:900;color:var(--green)">${totalAvail}</div>
      </div>
      <div style="background:var(--gold-dim);border:1px solid rgba(200,168,75,0.3);border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:10px;color:var(--gold2);text-transform:uppercase;letter-spacing:1px;font-weight:700">Fully Empty</div>
        <div style="font-size:26px;font-weight:900;color:var(--gold2)">${vacRooms.filter(r=>getRoomOccupancy(r)===0).length}</div>
      </div>
      <div style="background:var(--blue-dim);border:1px solid rgba(74,156,240,0.3);border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:10px;color:var(--blue);text-transform:uppercase;letter-spacing:1px;font-weight:700">Partial Rooms</div>
        <div style="font-size:26px;font-weight:900;color:var(--blue)">${vacRooms.filter(r=>getRoomOccupancy(r)>0).length}</div>
      </div>
      <div style="background:var(--purple-dim);border:1px solid rgba(155,109,240,0.3);border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:10px;color:var(--purple);text-transform:uppercase;letter-spacing:1px;font-weight:700">Students in Vacant</div>
        <div style="font-size:26px;font-weight:900;color:var(--purple)">${vacRooms.reduce((s,r)=>s+getRoomOccupancy(r),0)}</div>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Room</th><th>Type</th><th>Floor</th><th>Occupied</th><th>Available Seats</th><th>Rent</th><th>Current Residents</th><th></th></tr></thead>
        <tbody>${rows||'<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:24px">No vacant seats available</td></tr>'}</tbody>
      </table>
    </div>`);
}

// ════════════════════════════════════════════════════════════════════════════
// MONTH DETAIL MODAL — editable, updatable, exportable
// ════════════════════════════════════════════════════════════════════════════
function showMonthDetailModal(monthKey, monthLabel) {
  renderMonthModal(monthKey, monthLabel);
}

function renderMonthModal(monthKey, monthLabel) {
  const pays = DB.payments.filter(p=>_payMatchesMonth(p,monthKey));
  const paidPays = DB.payments.filter(p=>p.status==='Paid'&&_payMatchesMonth(p,monthKey));
  const pendPays = DB.payments.filter(p=>p.status==='Pending'&&_payMatchesMonth(p,monthKey));
  const exps = DB.expenses.filter(e=>e.date?.startsWith(monthKey));
  const rev = calcRevenue(monthKey);
  const expTotal = exps.reduce((s,e)=>s+Number(e.amount),0);
  const pendTotal = pendPays.reduce((s,p)=>s+Number(p.amount),0);
  const netProfit = rev - expTotal;
  // Active students (those registered and active with a room this month)
  // Show Active students + students who joined this month regardless of current status (historical view)
  const activeStudents = DB.students.filter(s=>s.status==='Active'||(s.joinDate?.startsWith(monthKey)&&DB.payments.some(p=>p.studentId===s.id&&_payMatchesMonth(p,monthKey))));

  const studentRows = activeStudents.map(s=>{
    const room = DB.rooms.find(r=>r.id===s.roomId);
    const sPays = DB.payments.filter(p=>p.studentId===s.id&&_payMatchesMonth(p,monthKey));
    const sPaid = sPays.filter(p=>p.status==='Paid').reduce((t,p)=>t+Number(p.amount),0);
    const sPend = sPays.filter(p=>p.status==='Pending').reduce((t,p)=>t+Number(p.amount),0);
    return `<tr>
      <td><span style="font-weight:700;color:var(--blue)">${escHtml(s.name)}</span><div style="font-size:11px;color:var(--text3)">${escHtml(s.phone||'')}</div></td>
      <td style="font-weight:700;color:var(--gold2)">#${room?room.number:'—'}</td>
      <td style="color:var(--text3);font-size:12px">${fmtPKR(s.rent)}/mo</td>
      <td style="color:var(--green);font-weight:700">${sPaid>0?fmtPKR(sPaid):'—'}</td>
      <td style="color:${sPend>0?'var(--amber)':'var(--text3)'};font-weight:${sPend>0?'700':'400'}">${sPend>0?fmtPKR(sPend):'—'}</td>
      <td>${statusBadge(s.status)}</td>
    </tr>`;
  }).join('');

  const feeRows = pays.map(p=>`<tr id="fee-row-${p.id}">
    <td><span style="color:var(--blue);font-weight:600">${escHtml(p.studentName||'—')}</span></td>
    <td style="color:var(--gold2);font-weight:700">#${escHtml(String(p.roomNumber||'—'))}</td>
    <td class="text-muted">${escHtml(p.month||'—')}</td>
    <td>
      <span class="editable-cell" onclick="editMonthFeeField('${p.id}','amount',this)" title="Click to edit">${fmtPKR(p.amount)}</span>
    </td>
    <td>${pmBadge(p.method)}</td>
    <td>
      <select onchange="updateMonthPayStatus('${p.id}',this.value)" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:3px 8px;font-size:12px;cursor:pointer">
        <option value="Paid" ${p.status==='Paid'?'selected':''}>✅ Paid</option>
        <option value="Pending" ${p.status==='Pending'?'selected':''}>⏳ Pending</option>
      </select>
    </td>
    <td class="text-muted" style="font-size:12px">
      <span class="editable-cell" onclick="editMonthFeeField('${p.id}','date',this)" title="Click to edit">${fmtDate(p.date)||'—'}</span>
    </td>
    <td>
      <button class="btn btn-danger btn-sm" style="font-size:10px;padding:3px 8px" onclick="deleteMonthPayment('${p.id}','${monthKey}','${escHtml(monthLabel)}')">🗑</button>
    </td>
  </tr>`).join('');

  const expRows = exps.map(e=>`<tr id="exp-row-${e.id}">
    <td class="text-muted" style="font-size:12px">
      <span class="editable-cell" onclick="editMonthExpField('${e.id}','date',this)" title="Click to edit">${fmtDate(e.date)||'—'}</span>
    </td>
    <td>
      <span class="editable-cell" onclick="editMonthExpField('${e.id}','category',this)" title="Click to edit">${escHtml(e.category||'—')}</span>
    </td>
    <td>
      <span class="editable-cell" onclick="editMonthExpField('${e.id}','description',this)" title="Click to edit">${escHtml(e.description||'—')}</span>
    </td>
    <td>
      <span class="editable-cell" style="color:var(--red);font-weight:700" onclick="editMonthExpField('${e.id}','amount',this)" title="Click to edit">${fmtPKR(e.amount)}</span>
    </td>
    <td>
      <button class="btn btn-danger btn-sm" style="font-size:10px;padding:3px 8px" onclick="deleteMonthExpense('${e.id}','${monthKey}','${escHtml(monthLabel)}')">🗑</button>
    </td>
  </tr>`).join('');

  showModal('modal-xl', `📅 ${monthLabel} — Full Monthly Report`,
  `<!-- KPI Summary -->
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px">
    <div style="background:var(--green-dim);border:1px solid rgba(46,201,138,0.3);border-radius:10px;padding:14px;text-align:center">
      <div style="font-size:9px;color:var(--green);text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:4px">💰 Total Revenue</div>
      <div style="font-size:22px;font-weight:900;color:var(--green)">${fmtPKR(rev)}</div>
      <div style="font-size:10px;color:var(--text3);margin-top:3px">${paidPays.length} payments</div>
    </div>
    <div style="background:var(--red-dim);border:1px solid rgba(224,82,82,0.3);border-radius:10px;padding:14px;text-align:center">
      <div style="font-size:9px;color:var(--red);text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:4px">📉 Expenses</div>
      <div style="font-size:22px;font-weight:900;color:var(--red)">${fmtPKR(expTotal)}</div>
      <div style="font-size:10px;color:var(--text3);margin-top:3px">${exps.length} records</div>
    </div>
    <div style="background:${netProfit>=0?'var(--green-dim)':'var(--red-dim)'};border:1px solid ${netProfit>=0?'rgba(46,201,138,0.3)':'rgba(224,82,82,0.3)'};border-radius:10px;padding:14px;text-align:center">
      <div style="font-size:9px;color:${netProfit>=0?'var(--green)':'var(--red)'};text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:4px">📊 Available Fund</div>
      <div style="font-size:22px;font-weight:900;color:${netProfit>=0?'var(--green)':'var(--red)'}">${fmtPKR(netProfit)}</div>
      <div style="font-size:10px;color:var(--text3);margin-top:3px">Rev − Exp</div>
    </div>
    <div style="background:var(--amber-dim);border:1px solid rgba(240,160,48,0.3);border-radius:10px;padding:14px;text-align:center">
      <div style="font-size:9px;color:var(--amber);text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:4px">⏳ Pending</div>
      <div style="font-size:22px;font-weight:900;color:var(--amber)">${fmtPKR(pendTotal)}</div>
      <div style="font-size:10px;color:var(--text3);margin-top:3px">${pendPays.length} unpaid</div>
    </div>
  </div>

  <!-- TAB NAVIGATION -->
  <div style="display:flex;gap:4px;margin-bottom:16px;background:var(--bg3);padding:4px;border-radius:10px">
    <button onclick="switchMonthTab('students')" id="mtab-students" class="btn btn-sm" style="flex:1;border-radius:7px;background:var(--gold-dim);color:var(--gold2);border:1px solid rgba(200,168,75,0.3)">🧑‍🎓 Students (${activeStudents.length})</button>
    <button onclick="switchMonthTab('fees')" id="mtab-fees" class="btn btn-sm" style="flex:1;border-radius:7px;background:transparent;color:var(--text3);border:none">💳 Fee Records (${pays.length})</button>
    <button onclick="switchMonthTab('expenses')" id="mtab-expenses" class="btn btn-sm" style="flex:1;border-radius:7px;background:transparent;color:var(--text3);border:none">📉 Expenses (${exps.length})</button>
  </div>

  <!-- STUDENTS TAB -->
  <div id="mpanel-students">
    <div class="table-wrap">
      <table><thead><tr><th>Student</th><th>Room</th><th>Monthly Rent</th><th>Paid</th><th>Pending</th><th>Status</th></tr></thead>
      <tbody>${studentRows||'<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:16px">No students found</td></tr>'}</tbody>
      </table>
    </div>
  </div>

  <!-- FEES TAB -->
  <div id="mpanel-fees" style="display:none">
    <div style="display:flex;justify-content:flex-end;margin-bottom:8px">
      <button class="btn btn-primary btn-sm" onclick="addMonthPaymentFromModal('${monthKey}','${escHtml(monthLabel)}')">+ Add Fee Record</button>
    </div>
    <div class="table-wrap">
      <table><thead><tr><th>Student</th><th>Room</th><th>Month</th><th>Amount ✏️</th><th>Method</th><th>Status</th><th>Date ✏️</th><th></th></tr></thead>
      <tbody id="fee-tbody">${feeRows||'<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:16px">No fee records</td></tr>'}</tbody>
      </table>
    </div>
  </div>

  <!-- EXPENSES TAB -->
  <div id="mpanel-expenses" style="display:none">
    <div style="display:flex;justify-content:flex-end;margin-bottom:8px">
      <button class="btn btn-primary btn-sm" onclick="addMonthExpenseFromModal('${monthKey}','${escHtml(monthLabel)}')">+ Add Expense</button>
    </div>
    <div class="table-wrap">
      <table><thead><tr><th>Date ✏️</th><th>Category ✏️</th><th>Description ✏️</th><th>Amount ✏️</th><th></th></tr></thead>
      <tbody id="exp-tbody">${expRows||'<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:16px">No expense records</td></tr>'}</tbody>
      </table>
    </div>
  </div>`,
  `<button class="btn btn-secondary" onclick="exportMonthCSV('${monthKey}','${escHtml(monthLabel)}')">📥 Export CSV</button>
   <button class="btn btn-secondary" onclick="printMonthReport('${monthKey}','${escHtml(monthLabel)}')">🖨️ Print Report</button>
   <button class="btn btn-primary" onclick="closeModal()">✓ Done</button>`
  );
}

function switchMonthTab(tab) {
  ['students','fees','expenses'].forEach(t=>{
    const panel=document.getElementById('mpanel-'+t);
    const btn=document.getElementById('mtab-'+t);
    if(!panel||!btn) return;
    const active = t===tab;
    panel.style.display=active?'block':'none';
    if(active){btn.style.background='var(--gold-dim)';btn.style.color='var(--gold2)';btn.style.border='1px solid rgba(200,168,75,0.3)';}
    else{btn.style.background='transparent';btn.style.color='var(--text3)';btn.style.border='none';}
  });
}

function editMonthFeeField(payId, field, cell) {
  const pay = DB.payments.find(p=>p.id===payId);
  if(!pay) return;
  const old = field==='amount'?pay.amount:pay[field];
  const inp = document.createElement('input');
  inp.type = field==='date'?'date':'text';
  inp.value = old||'';
  inp.className='editing-cell';
  inp.style.width='120px';
  cell.replaceWith(inp);
  inp.focus();
  const save = ()=>{
    const newVal = inp.value.trim();
    if(field==='amount') pay.amount=Number(newVal)||pay.amount;
    else pay[field]=newVal;
    saveDB();
    const span=document.createElement('span');
    span.className='editable-cell';
    span.title='Click to edit';
    span.onclick=()=>editMonthFeeField(payId,field,span);
    span.textContent = field==='amount'?fmtPKR(pay.amount):(field==='date'?fmtDate(pay[field]):pay[field]);
    if(field==='amount'){span.style.color='var(--green)';span.style.fontWeight='700';}
    inp.replaceWith(span);
    toast('Updated successfully','success');
  };
  inp.onblur=save;
  inp.onkeydown=e=>{if(e.key==='Enter')inp.blur();if(e.key==='Escape')inp.blur();};
}

function editMonthExpField(expId, field, cell) {
  const exp = DB.expenses.find(e=>e.id===expId);
  if(!exp) return;
  const old = field==='amount'?exp.amount:exp[field];
  const inp = document.createElement('input');
  inp.type = field==='date'?'date':'text';
  inp.value = old||'';
  inp.className='editing-cell';
  inp.style.width = field==='description'?'200px':'120px';
  cell.replaceWith(inp);
  inp.focus();
  const save = ()=>{
    const newVal = inp.value.trim();
    if(field==='amount') exp.amount=Number(newVal)||exp.amount;
    else exp[field]=newVal;
    saveDB();
    const span=document.createElement('span');
    span.className='editable-cell';
    span.title='Click to edit';
    span.onclick=()=>editMonthExpField(expId,field,span);
    span.textContent = field==='amount'?fmtPKR(exp.amount):(field==='date'?fmtDate(exp[field]):exp[field]);
    if(field==='amount'){span.style.color='var(--red)';span.style.fontWeight='700';}
    inp.replaceWith(span);
    toast('Updated successfully','success');
  };
  inp.onblur=save;
  inp.onkeydown=e=>{if(e.key==='Enter')inp.blur();if(e.key==='Escape')inp.blur();};
}

function updateMonthPayStatus(payId, newStatus) {
  const pay = DB.payments.find(p=>p.id===payId);
  if(!pay) return;
  pay.status = newStatus;
  if(newStatus==='Paid' && !pay.paidDate) pay.paidDate = today();
  if(newStatus==='Pending') pay.paidDate='';
  saveDB();
  toast('Payment status updated to '+newStatus,'success');
}

function deleteMonthPayment(payId, monthKey, monthLabel) {
  showConfirm('Delete Fee Record','Remove this fee record? This cannot be undone.',()=>{
    DB.payments = DB.payments.filter(p=>p.id!==payId);
    saveDB();
    toast('Fee record deleted','success');
    renderMonthModal(monthKey, monthLabel);
  });
}

function deleteMonthExpense(expId, monthKey, monthLabel) {
  showConfirm('Delete Expense','Remove this expense record? This cannot be undone.',()=>{
    DB.expenses = DB.expenses.filter(e=>e.id!==expId);
    saveDB();
    toast('Expense deleted','success');
    renderMonthModal(monthKey, monthLabel);
  });
}

function addMonthPaymentFromModal(monthKey, monthLabel) {
  closeModal();
  showAddPaymentModal();
}

function addMonthExpenseFromModal(monthKey, monthLabel) {
  closeModal();
  showAddExpenseModal();
}

function exportMonthCSV(monthKey, monthLabel) {
  const pays = DB.payments.filter(p=>_payMatchesMonth(p,monthKey));
  const exps = DB.expenses.filter(e=>e.date?.startsWith(monthKey));
  const rev = calcRevenue(monthKey);
  const expTotal = exps.reduce((s,e)=>s+Number(e.amount),0);
  let csv = `${DB.settings.hostelName} | ${monthLabel} Report\n\n`;
  csv += `Summary\nTotal Revenue,${rev}\nExpenses,${expTotal}\nAvailable Fund,${rev-expTotal}\nPending,${pays.filter(p=>p.status==='Pending').reduce((s,p)=>s+(p.unpaid!=null?Number(p.unpaid):Number(p.amount)),0)}\n\n`;
  csv += `Fee Records\nStudent,Room,Month,Amount,Method,Status,Date\n`;
  pays.forEach(p=>{ csv += [csvEsc(p.studentName),csvEsc(p.roomNumber),csvEsc(p.month),Number(p.amount),csvEsc(p.method),csvEsc(p.status),csvEsc(p.date||p.dueDate||'')].join(',')+"\n"; });
  csv += `\nExpenses\nDate,Category,Description,Amount\n`;
  exps.forEach(e=>{ csv += [csvEsc(e.date),csvEsc(e.category),csvEsc(e.description),Number(e.amount)].join(',')+"\n"; });
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Hostel_Report_${monthKey}.csv`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1500); // FIX 16: revoke blob URL to free memory
  toast('CSV exported successfully','success');
}

function printMonthReport(monthKey, monthLabel) {
  const pays = DB.payments.filter(p=>_payMatchesMonth(p,monthKey));
  const exps = DB.expenses.filter(e=>e.date?.startsWith(monthKey));
  const rev = calcRevenue(monthKey);
  const expTotal = exps.reduce((s,e)=>s+Number(e.amount),0);
  const pend = DB.payments.filter(p=>p.status==='Pending'&&_payMatchesMonth(p,monthKey)).reduce((s,p)=>s+(p.unpaid!=null?Number(p.unpaid):Number(p.amount)),0);
  const activeStudents = DB.students.filter(s=>s.status==='Active');
  const _mRptHtml = `<!DOCTYPE html><html><head><title>${monthLabel} Report</title>
  <style>
    body{font-family:Arial,sans-serif;padding:24px;color:#1e293b;font-size:13px}
    .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:12px;border-bottom:2px solid #c8a84b}
    .title{font-size:20px;font-weight:900;color:#1e293b}.subtitle{font-size:12px;color:#64748b;margin-top:3px}
    .badge{padding:6px 14px;border-radius:20px;font-size:11px;font-weight:700;background:#c8a84b22;color:#8b6a00;border:1px solid #c8a84b55}
    .kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px}
    .kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;text-align:center}
    .kpi label{font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:6px}
    .kpi .val{font-size:20px;font-weight:900;color:#1e293b}
    .section{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:16px}
    .section h3{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin-bottom:12px}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th{background:#f1f5f9;padding:8px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;font-weight:700;border-bottom:1px solid #e2e8f0}
    td{padding:8px 12px;border-bottom:1px solid #f8fafc}
    .green{color:#16a34a;font-weight:700}.red{color:#dc2626;font-weight:700}.gold{color:#854d0e;font-weight:700}
    .footer{margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;text-align:center;font-size:11px;color:#94a3b8}
    @media print{body{padding:16px}}
  </style></head><body>
  <div class="header">
    <div><div class="title">${DB.settings.hostelName}</div><div class="subtitle">${monthLabel} Report · Generated ${new Date().toLocaleDateString()}</div></div>
    <div class="badge">Monthly Report</div>
  </div>
  <div class="kpi-grid">
    <div class="kpi"><label>Total Revenue</label><div class="val green">${fmtPKR(rev)}</div></div>
    <div class="kpi"><label>Expenses</label><div class="val red">${fmtPKR(expTotal)}</div></div>
    <div class="kpi"><label>Available Fund</label><div class="val" style="color:${rev-expTotal>=0?'#16a34a':'#dc2626'}">${fmtPKR(rev-expTotal)}</div></div>
    <div class="kpi"><label>Pending</label><div class="val gold">${fmtPKR(pend)}</div></div>
  </div>
  <div class="section"><h3>🧑‍🎓 Active Students (${activeStudents.length})</h3>
    <table><thead><tr><th>Name</th><th>Room</th><th>Rent</th><th>Phone</th><th>Status</th></tr></thead><tbody>
    ${activeStudents.map(s=>{const rm=DB.rooms.find(r=>r.id===s.roomId);return `<tr><td>${escHtml(s.name)}</td><td class="gold">#${rm?rm.number:'—'}</td><td>${fmtPKR(s.rent)}</td><td>${escHtml(s.phone||'')}</td><td>${s.status}</td></tr>`;}).join('')||'<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:12px">No students</td></tr>'}
    </tbody></table>
  </div>
  <div class="section"><h3>💳 Fee Records</h3>
    <table><thead><tr><th>Student</th><th>Room</th><th>Month</th><th>Amount</th><th>Method</th><th>Status</th><th>Date</th></tr></thead><tbody>
    ${pays.map(p=>`<tr><td>${escHtml(p.studentName||'—')}</td><td class="gold">#${p.roomNumber||'—'}</td><td>${escHtml(p.month||'—')}</td><td class="${p.status==='Paid'?'green':'red'}">${fmtPKR(p.amount)}</td><td>${escHtml(p.method||'—')}</td><td class="${p.status==='Paid'?'green':'red'}">${p.status}</td><td>${fmtDate(p.date)||'—'}</td></tr>`).join('')||'<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:12px">No records</td></tr>'}
    </tbody></table>
  </div>
  <div class="section"><h3>📉 Expenses</h3>
    <table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th></tr></thead><tbody>
    ${exps.map(e=>`<tr><td>${fmtDate(e.date)}</td><td>${escHtml(e.category||'—')}</td><td>${escHtml(e.description||'—')}</td><td class="red">${fmtPKR(e.amount)}</td></tr>`).join('')||'<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:12px">No expenses</td></tr>'}
    </tbody></table>
  </div>
  <div class="footer">Generated ${new Date().toLocaleDateString()} · ${DB.settings.hostelName} · Confidential</div>
  </body></html>`;
  _electronPDF(_mRptHtml, (DB.settings.hostelName||'Report').replace(/\s+/g,'-').replace(/[^a-zA-Z0-9\-]/g,'')+'_'+monthLabel.replace(/\s+/g,'-')+'.pdf', {pageSize:'A4'});
}

// ════════════════════════════════════════════════════════════════════════════
// CANCELLATIONS
// ════════════════════════════════════════════════════════════════════════════
function renderCancellations(filterStatus='All') {
  const list = DB.cancellations || [];
  const pending = list.filter(c=>c.status==='Pending');
  const confirmed = list.filter(c=>c.status==='Confirmed');
  const restored = list.filter(c=>c.status==='Restored');
  const freed = list.filter(c=>c.status==='Pending'||c.status==='Confirmed');
  const filtered = filterStatus==='All'?list:filterStatus==='Freed'?freed:list.filter(c=>c.status===filterStatus);

  const mkRow = (c) => {
    const student = DB.students.find(s=>s.id===c.studentId);
    const statusBadgeHtml = c.status==='Pending'
      ? '<span class="badge badge-red">⏳ Pending</span>'
      : c.status==='Confirmed'
        ? '<span class="badge badge-gray" style="background:rgba(224,82,82,0.1);color:var(--red);border-color:rgba(224,82,82,0.3)">✅ Confirmed</span>'
        : '<span class="badge badge-green">↩️ Restored</span>';
    const actionBtns = c.status==='Pending'
      ? '<button class="btn btn-danger btn-sm" style="font-size:11px" onclick="confirmCancellation(\''+c.id+'\')"><span class=\"micon\" style=\"font-size:14px\">check_circle</span></button>'
        +'<button class="btn btn-success btn-sm" style="font-size:11px" onclick="restoreFromCancellation(\''+c.id+'\')">↩</button>'
      : c.status==='Confirmed'
        ? '<button class="btn btn-success btn-sm" style="font-size:11px" onclick="restoreFromCancellation(\''+c.id+'\')">↩ Restore</button>'
        : '';
    return `<tr style="cursor:pointer" onclick="showEditCancellationModal('${c.id}')">
      <td>
        <div style="font-weight:700;color:var(--blue)">${escHtml(c.studentName||'—')}</div>
        <div style="font-size:11px;color:var(--text3)">${escHtml(student?.phone||'')}</div>
      </td>
      <td><span style="font-size:15px;font-weight:900;color:var(--gold2)">#${c.roomNumber||'—'}</span></td>
      <td><span class="badge badge-gray">${escHtml(c.roomType||'—')}</span></td>
      <td class="text-muted" style="font-size:12px">${fmtDate(c.requestDate)}</td>
      <td class="text-muted" style="font-size:12px">${fmtDate(c.vacateDate)||'End of Month'}</td>
      <td>${statusBadgeHtml}</td>
      <td class="text-muted" style="font-size:12px;max-width:140px;white-space:normal">${escHtml(c.reason||'—')}</td>
      <td onclick="event.stopPropagation()">
        <div style="display:flex;gap:5px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" style="font-size:11px" onclick="showEditCancellationModal('${c.id}')">✏️ Edit</button>
          ${actionBtns}
        </div>
      </td>
    </tr>`;
  };

  return `
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px">
    <div onclick="renderPage('cancellations_All')" style="background:${filterStatus==='All'?'var(--bg3)':'var(--card)'};border:1px solid ${filterStatus==='All'?'var(--border2)':'var(--border)'};border-radius:var(--radius);padding:18px 16px;text-align:center;cursor:pointer;transition:var(--transition)" onmouseover="this.style.transform='translateY(-3px)'" onmouseout="this.style.transform=''">
      <div style="font-size:20px;margin-bottom:6px">📋</div>
      <div style="font-size:36px;font-weight:900;color:var(--text);line-height:1;margin-bottom:4px">${list.length}</div>
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${filterStatus==='All'?'var(--gold2)':'var(--text3)'}">All Records</div>
      <div style="font-size:10px;color:var(--text3);margin-top:4px">${filterStatus==='All'?'▲ showing all':'click to show all'}</div>
    </div>
    <div onclick="renderPage('cancellations_Pending')" style="background:${filterStatus==='Pending'?'var(--red-dim)':'var(--card)'};border:1px solid ${filterStatus==='Pending'?'rgba(224,82,82,0.4)':'var(--border)'};border-radius:var(--radius);padding:18px 16px;text-align:center;cursor:pointer;transition:var(--transition);position:relative;overflow:hidden" onmouseover="this.style.transform='translateY(-3px)'" onmouseout="this.style.transform=''">
      ${filterStatus==='Pending'?`<div style="position:absolute;top:0;left:0;right:0;height:3px;background:var(--red)"></div>`:''}
      <div style="font-size:20px;margin-bottom:6px">🚨</div>
      <div style="font-size:36px;font-weight:900;color:var(--red);line-height:1;margin-bottom:4px">${pending.length}</div>
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${filterStatus==='Pending'?'var(--red)':'var(--text3)'}">Pending</div>
      <div style="font-size:10px;color:var(--text3);margin-top:4px">${filterStatus==='Pending'?'▲ showing':'Awaiting action'}</div>
    </div>
    <div onclick="renderPage('cancellations_Confirmed')" style="background:${filterStatus==='Confirmed'?'rgba(224,82,82,0.08)':'var(--card)'};border:1px solid ${filterStatus==='Confirmed'?'rgba(224,82,82,0.3)':'var(--border)'};border-radius:var(--radius);padding:18px 16px;text-align:center;cursor:pointer;transition:var(--transition);position:relative;overflow:hidden" onmouseover="this.style.transform='translateY(-3px)'" onmouseout="this.style.transform=''">
      ${filterStatus==='Confirmed'?`<div style="position:absolute;top:0;left:0;right:0;height:3px;background:var(--red)"></div>`:''}
      <div style="font-size:20px;margin-bottom:6px">✅</div>
      <div style="font-size:36px;font-weight:900;color:var(--text2);line-height:1;margin-bottom:4px">${confirmed.length}</div>
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${filterStatus==='Confirmed'?'var(--red)':'var(--text3)'}">Confirmed</div>
      <div style="font-size:10px;color:var(--text3);margin-top:4px">${filterStatus==='Confirmed'?'▲ showing':'Students left'}</div>
    </div>
    <div onclick="renderPage('cancellations_Restored')" style="background:${filterStatus==='Restored'?'var(--green-dim)':'var(--card)'};border:1px solid ${filterStatus==='Restored'?'rgba(46,201,138,0.4)':'var(--border)'};border-radius:var(--radius);padding:18px 16px;text-align:center;cursor:pointer;transition:var(--transition);position:relative;overflow:hidden" onmouseover="this.style.transform='translateY(-3px)'" onmouseout="this.style.transform=''">
      ${filterStatus==='Restored'?`<div style="position:absolute;top:0;left:0;right:0;height:3px;background:var(--green)"></div>`:''}
      <div style="font-size:20px;margin-bottom:6px">↩️</div>
      <div style="font-size:36px;font-weight:900;color:var(--green);line-height:1;margin-bottom:4px">${restored.length}</div>
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${filterStatus==='Restored'?'var(--green)':'var(--text3)'}">Restored</div>
      <div style="font-size:10px;color:var(--text3);margin-top:4px">${filterStatus==='Restored'?'▲ showing':'Reversed cancels'}</div>
    </div>
  </div>

  <!-- Freed Seats banner clickable -->
  <div onclick="renderPage('cancellations_Freed')" style="background:${filterStatus==='Freed'?'var(--teal-dim)':'var(--card)'};border:1px solid ${filterStatus==='Freed'?'rgba(15,188,173,0.4)':'var(--border)'};border-radius:var(--radius);padding:14px 20px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;transition:var(--transition)" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''">
    <div style="display:flex;align-items:center;gap:14px">
      <div style="width:44px;height:44px;border-radius:10px;background:var(--teal-dim);display:flex;align-items:center;justify-content:center;font-size:20px">🛏️</div>
      <div>
        <div style="font-size:13px;font-weight:700;color:var(--teal)">Freed Seats (Pending + Confirmed)</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px">These seats are now vacant and available for new bookings</div>
      </div>
    </div>
    <div style="text-align:center">
      <div style="font-size:32px;font-weight:900;color:var(--teal)">${freed.length}</div>
      <div style="font-size:10px;color:var(--text3)">${filterStatus==='Freed'?'▲ showing':'click to filter'}</div>
    </div>
  </div>

  ${pending.length>0&&filterStatus==='All'?`
  <div style="background:rgba(224,82,82,0.07);border:1px solid rgba(224,82,82,0.25);border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px">
    <span style="font-size:16px">⚠️</span>
    <span style="font-size:12.5px;color:var(--text2)">${pending.length} pending cancellation${pending.length!==1?'s':''} await action — seats already freed. Click <strong style="color:var(--red)">Pending</strong> card above to view them.</span>
  </div>`:''}

  <div class="card">
    <div class="card-header">
      <div class="card-title">
        ${filterStatus==='All'?'📋 All Cancellations':filterStatus==='Pending'?'🚨 Pending Cancellations':filterStatus==='Confirmed'?'✅ Confirmed Cancellations':filterStatus==='Restored'?'↩️ Restored Cancellations':'🛏️ Freed Seats (Pending + Confirmed)'}
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:12px;color:var(--text3)">${filtered.length} record${filtered.length!==1?'s':''}</span>
        <button class="btn btn-secondary btn-sm" style="font-size:11px" onclick="downloadCancellationReport()">⬇️ Download Report</button>
        ${filterStatus!=='All'?`<button class="btn btn-secondary btn-sm" onclick="renderPage('cancellations_All')">✕ Clear Filter</button>`:''}
      </div>
    </div>
    ${filtered.length===0?`<div class="empty-state" style="padding:32px"><div class="icon">${filterStatus==='Pending'?'🎉':'📋'}</div><div>${filterStatus==='Pending'?'No pending cancellations!':'No records found'}</div></div>`:
    `<div class="table-wrap">
      <table><thead><tr><th>Student</th><th>Room</th><th>Type</th><th>Request Date</th><th>Vacate By</th><th>Status</th><th>Reason</th><th>Actions</th></tr></thead>
      <tbody>${filtered.map(c=>mkRow(c)).join('')}</tbody>
      </table>
    </div>`}
  </div>`;
}

function showEditCancellationModal(cancId) {
  const c = (DB.cancellations||[]).find(x=>x.id===cancId);
  if(!c) return;
  const student = DB.students.find(s=>s.id===c.studentId);
  const room = DB.rooms.find(r=>r.id===c.roomId);
  const statusOpts = ['Pending','Confirmed','Restored'].map(s=>`<option value="${s}" ${c.status===s?'selected':''}>${s==='Pending'?'⏳ Pending':s==='Confirmed'?'✅ Confirmed':'↩️ Restored'}</option>`).join('');

  showModal('modal-md','✏️ Edit Cancellation Record',`
    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:20px;display:flex;align-items:center;gap:14px">
      <div style="width:40px;height:40px;border-radius:10px;background:var(--red-dim);display:flex;align-items:center;justify-content:center;font-size:18px">🚫</div>
      <div>
        <div style="font-weight:700;font-size:14px;color:var(--text)">${escHtml(c.studentName||'—')}</div>
        <div style="font-size:12px;color:var(--text3)">Room #${c.roomNumber||'?'} · ${escHtml(c.roomType||'—')} · ${escHtml(student?.phone||'No phone')}</div>
      </div>
    </div>
    <div class="form-grid">
      <div class="field"><label>Status</label>
        <select class="form-control" id="f-cstatus" onchange="
          const v=this.value;
          document.getElementById('cancel-status-note').style.display=v==='Confirmed'?'block':'none';
          document.getElementById('restore-status-note').style.display=v==='Restored'?'block':'none';
        ">${statusOpts}</select>
        <div id="cancel-status-note" style="display:${c.status==='Confirmed'?'block':'none'};font-size:11px;color:var(--red);margin-top:4px">⚠️ Student will be marked as Left</div>
        <div id="restore-status-note" style="display:${c.status==='Restored'?'block':'none'};font-size:11px;color:var(--green);margin-top:4px">✅ Student will be restored to Active</div>
      </div>
      <div class="field"><label>Vacate By Date</label><input class="form-control cdp-trigger" id="f-cvacate" type="text" readonly onclick="showCustomDatePicker(this,event)" value="${c.vacateDate||''}"></div>
      <div class="field col-full"><label>Reason / Notes</label><textarea class="form-control" id="f-creason" rows="3" placeholder="Reason for cancellation…">${escHtml(c.reason||'')}</textarea></div>
    </div>
    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-top:4px;display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12px">
      <div><span style="color:var(--text3)">Requested:</span> <strong>${fmtDate(c.requestDate)}</strong></div>
      <div><span style="color:var(--text3)">Record ID:</span> <span style="font-family:var(--font-mono);color:var(--text3);font-size:10px">${c.id}</span></div>
    </div>`,
  `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
   <button class="btn btn-danger btn-sm" onclick="deleteCancellationRecord('${cancId}')"><span class=\"micon\" style=\"font-size:14px\">delete</span> Delete</button>
   <button class="btn btn-primary" onclick="submitEditCancellation('${cancId}')"><span class=\"micon\" style=\"font-size:14px\">save</span> Save</button>`);
}

function submitEditCancellation(cancId) {
  const c = (DB.cancellations||[]).find(x=>x.id===cancId);
  if(!c) return;
  const newStatus = document.getElementById('f-cstatus').value;
  const oldStatus = c.status;
  c.vacateDate = document.getElementById('f-cvacate').value;
  c.reason = document.getElementById('f-creason').value.trim();
  c.status = newStatus;
  // Update student status accordingly
  const student = DB.students.find(s=>s.id===c.studentId);
  if(student) {
    if(newStatus==='Confirmed') {
      student.status='Left';
      student.leftDate = new Date().toISOString().slice(0,10);
      student.lastRoom = student.roomNumber || '';
    }
    else if(newStatus==='Restored') student.status='Active';
    else if(newStatus==='Pending') student.status='Cancelling';
  }
  saveDB(); closeModal();
  renderPage('cancellations_'+newStatus);
  toast('Cancellation record updated','success');
}

function deleteCancellationRecord(cancId) {
  const c = (DB.cancellations||[]).find(x=>x.id===cancId);
  if(!c) return;
  showConfirm('Delete Record','Are you sure you want to permanently delete this cancellation record? The student status will not be changed.',()=>{
    DB.cancellations = (DB.cancellations||[]).filter(x=>x.id!==cancId);
    saveDB(); closeModal(); renderPage('cancellations_All');
    toast('Record deleted','success');
  });
}

function showAddCancellationModal() {
  const activeStudents = DB.students.filter(s=>s.status==='Active');
  const alreadyCancelling = (DB.cancellations||[]).filter(c=>c.status==='Pending').map(c=>c.studentId);
  const available = activeStudents.filter(s=>!alreadyCancelling.includes(s.id));
  const studentOpts = available.map(s=>{
    const room=DB.rooms.find(r=>r.id===s.roomId);
    return `<option value="${s.id}">👤 ${escHtml(s.name)} — Room #${room?room.number:'?'}</option>`;
  }).join('');

  if(available.length===0){
    toast('No active students available to cancel','error');
    return;
  }

  const endOfMonth = (()=>{ const d=new Date(); d.setMonth(d.getMonth()+1); d.setDate(0); return d.toISOString().split('T')[0]; })();

  showModal('modal-md','🚫 Add Cancellation Request',`
    <div style="background:var(--red-dim);border:1px solid rgba(224,82,82,0.25);border-radius:10px;padding:12px 16px;margin-bottom:18px;font-size:12.5px;color:var(--text2)">
      ⚠️ <strong>Note:</strong> Once added, the student's seat is immediately marked as <strong style="color:var(--red)">Vacant</strong> and available for new bookings.
    </div>
    <div class="form-grid">
      <div class="field col-full">
        <label>Search Student</label>
        <div style="position:relative">
          <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--text3);pointer-events:none">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          </span>
          <input class="form-control" id="canc-search" placeholder="Search by name, room #, student ID…"
            style="padding-left:32px;padding-right:32px"
            oninput="cancStudentSearch(this.value)"
            onfocus="cancStudentSearch(this.value)"
            onblur="setTimeout(()=>{const d=document.getElementById('canc-search-drop');if(d)d.style.display='none';},200)"
            autocomplete="off">
          <button onclick="document.getElementById('canc-search').value='';cancStudentSearch('');document.getElementById('canc-selected-info').style.display='none';document.getElementById('canc-student').value=''"
            style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text3);cursor:pointer;font-size:16px;line-height:1;padding:2px 4px"
            title="Clear">✕</button>
          <div id="canc-search-drop" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--bg2);border:1px solid var(--border2);border-radius:8px;z-index:9999;max-height:220px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,0.5);margin-top:2px"></div>
        </div>
        <input type="hidden" id="canc-student" value="">
        <!-- Selected student info card -->
        <div id="canc-selected-info" style="display:none;margin-top:8px;background:var(--bg3);border:1px solid var(--border2);border-radius:8px;padding:10px 14px;display:none">
          <div id="canc-selected-name" style="font-weight:700;font-size:14px;color:var(--text)"></div>
          <div id="canc-selected-meta" style="font-size:11px;color:var(--text3);margin-top:2px"></div>
        </div>
      </div>
      <div class="field">
        <label>Room (auto-filled)</label>
        <input id="canc-room-display" class="form-control" readonly placeholder="Select student first" style="opacity:0.7">
      </div>
      <div class="field">
        <label>Vacate By Date</label>
        <input class="form-control cdp-trigger" id="canc-vacate" type="text" readonly onclick="showCustomDatePicker(this,event)" value="${endOfMonth}">
      </div>
      <div class="field col-full">
        <label>Reason for Cancellation</label>
        <textarea id="canc-reason" class="form-control" placeholder="e.g. Shifting to own house, going back to hometown..."></textarea>
      </div>
    </div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
     <button class="btn btn-danger" onclick="saveCancellation()">🚫 Add to Cancellation List</button>`
  );
  // pass available list to search fn
  window._cancAvailable = available;
}

function cancStudentSearch(query) {
  const drop = document.getElementById('canc-search-drop');
  if (!drop) return;
  const available = window._cancAvailable || [];
  const q = query.trim().toLowerCase();
  const matches = q
    ? available.filter(s => {
        const room = DB.rooms.find(r=>r.id===s.roomId);
        return s.name.toLowerCase().includes(q)
          || s.id.toLowerCase().includes(q)
          || (s.phone||'').includes(q)
          || String(room?room.number:'').toLowerCase().includes(q);
      })
    : available;
  if (!matches.length) {
    drop.innerHTML = '<div style="padding:12px;text-align:center;color:var(--text3);font-size:12px">No students found</div>';
    drop.style.display = 'block';
    return;
  }
  drop.innerHTML = matches.slice(0,12).map(s => {
    const room = DB.rooms.find(r=>r.id===s.roomId);
    const roomLabel = room ? `Rm #${room.number}` : 'No room';
    return `<div onclick="selectCancStudent('${s.id}')"
      style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px"
      onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
      <div style="width:32px;height:32px;border-radius:8px;background:var(--red-dim);color:var(--red);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:13px;flex-shrink:0">${(s.name||'?')[0].toUpperCase()}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;color:var(--text);font-size:13px">${escHtml(s.name)}</div>
        <div style="font-size:11px;color:var(--text3)">${roomLabel} · ${escHtml(s.phone||'—')}</div>
      </div>
      <div style="font-size:10px;font-weight:700;color:var(--gold2);background:var(--gold-dim);border-radius:6px;padding:2px 7px">${roomLabel}</div>
    </div>`;
  }).join('');
  drop.style.display = 'block';
}

function selectCancStudent(studentId) {
  const s = DB.students.find(x=>x.id===studentId); if(!s) return;
  const room = DB.rooms.find(r=>r.id===s.roomId);
  const type = room ? getRoomType(room) : null;
  // Set hidden input
  const hiddenInp = document.getElementById('canc-student');
  if(hiddenInp) hiddenInp.value = studentId;
  // Fill search bar with name
  const searchInp = document.getElementById('canc-search');
  if(searchInp) searchInp.value = s.name;
  // Hide dropdown
  const drop = document.getElementById('canc-search-drop');
  if(drop) drop.style.display = 'none';
  // Show selected info card
  const infoCard = document.getElementById('canc-selected-info');
  const nameEl = document.getElementById('canc-selected-name');
  const metaEl = document.getElementById('canc-selected-meta');
  if(infoCard && nameEl && metaEl) {
    nameEl.textContent = s.name;
    metaEl.textContent = (room ? `Room #${room.number} · ${type?type.name:'—'} · Floor ${room.floor}` : 'No room') + (s.phone ? ' · '+s.phone : '');
    infoCard.style.display = 'block';
  }
  // Fill room display
  const roomEl = document.getElementById('canc-room-display');
  if(roomEl) roomEl.value = room ? `Room #${room.number} · ${type?type.name:''} · Floor ${room.floor}` : 'No room assigned';
}

function prefillCancStudentInfo(studentId) {
  selectCancStudent(studentId);
}

function saveCancellation() {
  const studentId = document.getElementById('canc-student').value;
  const vacateDate = document.getElementById('canc-vacate').value;
  const reason = document.getElementById('canc-reason').value.trim();
  if(!studentId){ toast('Please select a student','error'); return; }
  const student = DB.students.find(s=>s.id===studentId);
  if(!student){ toast('Student not found','error'); return; }
  const room = DB.rooms.find(r=>r.id===student.roomId);
  const type = room?getRoomType(room):null;
  if(!DB.cancellations) DB.cancellations=[];
  DB.cancellations.push({
    id: 'canc_'+uid(), // FIX 22: consistent 'canc_' prefix matching rest of cancellation system
    studentId: student.id,
    studentName: student.name,
    roomId: student.roomId||'',
    roomNumber: room?room.number:'—',
    roomType: type?type.name:'—',
    requestDate: today(),
    vacateDate: vacateDate||'',
    reason: reason,
    status: 'Pending',
    createdAt: today()
  });
  // Immediately mark student as Cancelling — removes from occupancy
  student.status = 'Cancelling';
  saveDB();
  closeModal();
  toast(`${student.name} added to cancellation list. Seat is now vacant.`, 'success');
  if(currentPage==='cancellations') renderPage('cancellations');
  else if(currentPage==='dashboard') renderPage('dashboard');
}

function confirmCancellation(cancId) {
  const c = DB.cancellations.find(x=>x.id===cancId);
  if(!c) return;
  showConfirm('Confirm Cancellation', `Mark ${c.studentName}'s cancellation as confirmed? Student will be set to "Left".`, ()=>{
    c.status = 'Confirmed';
    const student = DB.students.find(s=>s.id===c.studentId);
    if(student){
      student.status='Left';
      student.leftDate = new Date().toISOString().slice(0,10);
      student.lastRoom = student.roomNumber || '';
    }
    saveDB();
    toast(`${c.studentName} cancellation confirmed. Student marked as Left.`, 'success');
    renderPage('cancellations');
  });
}

function restoreFromCancellation(cancId) {
  const c = DB.cancellations.find(x=>x.id===cancId);
  if(!c) return;
  showConfirm('Restore Student', `Restore ${c.studentName} to Active? Their seat will be re-occupied.`, ()=>{
    c.status = 'Restored';
    const student = DB.students.find(s=>s.id===c.studentId);
    if(student){ student.status='Active'; }
    saveDB();
    toast(`${c.studentName} restored to Active. Seat is re-occupied.`, 'success');
    renderPage('cancellations');
  });
}

// ════════════════════════════════════════════════════════════════════════════
// ROOMS
// ════════════════════════════════════════════════════════════════════════════
let roomFilter = {status:'All', type:'All', floor:'All', search:''};
function renderRooms() {
  let rooms = DB.rooms.filter(r=>{
    const occ = getRoomOccupancy(r) > 0;
    if(roomFilter.status==='Occupied' && !occ) return false;
    if(roomFilter.status==='Vacant' && occ) return false;
    if(roomFilter.type!=='All' && r.typeId!==roomFilter.type) return false;
    if(roomFilter.floor!=='All' && r.floor!==roomFilter.floor) return false;
    if(roomFilter.search && !String(r.number).toLowerCase().includes(roomFilter.search.toLowerCase())) return false;
    return true;
  });

  const typeOptions = DB.settings.roomTypes.map(t=>`<option value="${t.id}" ${roomFilter.type===t.id?'selected':''}>${escHtml(t.name)}</option>`).join('');
  const floorOptions = DB.settings.floors.map(f=>`<option value="${f}" ${roomFilter.floor===f?'selected':''}>${f} Floor</option>`).join('');

  const cards = rooms.map(r=>{
    const type = getRoomType(r);
    const occ = getRoomOccupancy(r);
    const cap = type.capacity;
    const pct = cap>0?Math.round(occ/cap*100):0;
    const activeStudentNames = DB.students.filter(t=>t.roomId===r.id&&t.status==='Active').map(t=>t.name);
    return `<div class="room-card ${occ>0?'occupied':'vacant'}" onclick="showRoomDetail('${r.id}')">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div class="room-num">#${r.number}</div>
        <span class="badge ${occ>0?'badge-green':'badge-gold'}">${occ>0?'Occupied':'Vacant'}</span>
      </div>
      <div class="room-type" style="color:${escHtml(type.color)}">${escHtml(type.name)}</div>
      <div class="room-meta">
        <div class="room-meta-row"><span class="k">Floor</span><span class="v">${r.floor}</span></div>
        <div class="room-meta-row"><span class="k">Capacity</span><span class="v">${occ}/${cap} beds</span></div>
      </div>
      <div class="room-rent">${fmtPKR(r.rent)}/mo</div>
      <div class="room-occ-bar"><div class="room-occ-track"><div class="room-occ-fill" style="width:${pct}%;background:${escHtml(type.color)}"></div></div></div>
      ${activeStudentNames.length?`<div class="room-students">${activeStudentNames.map(n=>`<div class="room-student-name">• ${escHtml(n)}</div>`).join('')}</div>`:''}
      <div style="margin-top:10px;display:flex;gap:6px">
        <button class="btn btn-secondary btn-sm" style="flex:1;font-size:11px" onclick="event.stopPropagation();showEditRoomModal('${r.id}')">Edit</button>
        ${occ<cap
          ? `<button class="btn btn-primary btn-sm" style="flex:1;font-size:11px" onclick="event.stopPropagation();showAddStudentModal('${r.id}')">+ Student</button>`
          : `<button class="btn btn-sm" style="flex:1;font-size:11px;background:#b8860b;color:#fff;border:1px solid #c8a84b" onclick="event.stopPropagation();showAddStudentModal('${r.id}')" title="Room is full — force add anyway">⚡ Force Add</button>`}
      </div>
    </div>`;
  }).join('');

  return `
  <div class="filter-bar">
    <div class="search-wrap" style="max-width:200px">
      <svg class="search-icon" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <input class="form-control" id="search-rooms" placeholder="Room number…" value="${escHtml(roomFilter.search)}" oninput="capFirstChar(this);roomFilter.search=this.value;_dRooms();toggleClearBtn('search-rooms','clear-rooms')">
      <button class="search-clear ${roomFilter.search?'visible':''}" id="clear-rooms" onclick="roomFilter.search='';document.getElementById('search-rooms').value='';this.classList.remove('visible');renderPage('rooms')" title="Clear">✕</button>
    </div>
    <div class="filter-tabs">
      ${['All','Occupied','Vacant'].map(s=>`<button class="ftab ${roomFilter.status===s?'active':''}" onclick="roomFilter.status='${s}';renderPage('rooms')">${s}</button>`).join('')}
    </div>
    <select class="form-control" style="width:140px" onchange="roomFilter.type=this.value;renderPage('rooms')">
      <option value="All">All Types</option>${typeOptions}
    </select>
    <select class="form-control" style="width:140px" onchange="roomFilter.floor=this.value;renderPage('rooms')">
      <option value="All">All Floors</option>${floorOptions}
    </select>
    <span class="text-muted" style="font-size:12px;margin-left:auto">${rooms.length} rooms</span>
  </div>
  <div class="room-grid">${cards||'<div class="empty-state"><div class="icon">🏠</div><h3>No rooms found</h3></div>'}</div>`;
}

function showRoomDetail(id) {
  const r = DB.rooms.find(x=>x.id===id); if(!r) return;
  const type = getRoomType(r);
  const occ = getRoomOccupancy(r);
  const activeStudents = DB.students.filter(t=>t.roomId===r.id&&t.status==='Active');
  showModal('modal-md',`Room #${r.number} — ${type.name}`,`
    <div class="form-grid">
      <div class="card" style="padding:14px"><div class="stat-label">Type</div><div style="font-weight:700;color:${type.color}">${escHtml(type.name)}</div></div>
      <div class="card" style="padding:14px"><div class="stat-label">Floor</div><div style="font-weight:700">${r.floor}</div></div>
      <div class="card" style="padding:14px"><div class="stat-label">Capacity</div><div style="font-weight:700">${occ}/${type.capacity} occupied</div></div>
      <div class="card" style="padding:14px"><div class="stat-label">Monthly Rent</div><div style="font-weight:700;color:var(--green)">${fmtPKR(r.rent)}</div></div>
    </div>
    <div style="margin-top:14px"><div class="stat-label" style="margin-bottom:8px">Amenities</div><div class="tag-list">${(r.amenities||[]).map(a=>`<div class="tag-item">${escHtml(a)}</div>`).join('')||'<span class="text-muted">None listed</span>'}</div></div>
    ${activeStudents.length?`<div style="margin-top:14px"><div class="stat-label" style="margin-bottom:8px">Current Students</div>${activeStudents.map(t=>`<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)"><div class="avatar" style="background:var(--gold-dim);color:var(--gold)">${t.name[0]}</div><div><div style="font-weight:600">${escHtml(t.name)}</div><div class="td-sub">${escHtml(t.phone||'—')}</div></div><div class="ml-auto text-green fw-700">${fmtPKR(t.rent)}</div></div>`).join('')}</div>`:''}
    ${r.notes?`<div style="margin-top:14px;background:var(--bg3);border-radius:var(--radius-sm);padding:12px"><div class="stat-label" style="margin-bottom:4px">Notes</div><div style="font-size:13px;color:var(--text2)">${escHtml(r.notes)}</div></div>`:''}
  `,`<button class="btn btn-secondary" onclick="closeModal();showEditRoomModal('${r.id}')">Edit Room</button><button class="btn btn-primary" onclick="closeModal()">Close</button>`);
}

function showAddRoomModal(presetId='') {
  const typeOpts = DB.settings.roomTypes.map(t=>`<option value="${t.id}">${escHtml(t.name)}</option>`).join('');
  const floorOpts = DB.settings.floors.map(f=>`<option value="${f}">${f} Floor</option>`).join('');
  showModal('modal-lg','Add New Room',`
    <div class="form-grid">
      <div class="field"><label>Room Name / Number *</label>
        <input class="form-control" id="f-rnum" placeholder="e.g. A 01, B 02-a, B 02-b" maxlength="12" autocomplete="off"
          oninput="formatRoomNumber(this)"
          style="font-weight:700;letter-spacing:1px">
        <div style="font-size:10px;color:var(--text3);margin-top:3px">First letter AUTO-capitals · numbers · suffix in small (a, b…)</div>
      </div>
      <div class="field"><label>Floor *</label><select class="form-control" id="f-rfloor">${floorOpts}</select></div>
      <div class="field"><label>Room Type *</label><select class="form-control" id="f-rtype">${typeOpts}</select></div>

      <div class="field col-full"><label>Amenities (comma separated)</label><input class="form-control" id="f-ramen" value="Fan, Bed, Wardrobe, Attached Bath"></div>
      <div class="field col-full"><label>Notes</label><textarea class="form-control" id="f-rnotes"></textarea></div>
    </div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitAddRoom()">Add Room</button>`);
  // Live preview: update when number changes
  setTimeout(()=>{
    const ni=document.getElementById('f-rnum');
    const pr=document.getElementById('f-rnum-preview');
    if(ni&&pr){ ni.addEventListener('input',()=>{ pr.textContent=ni.value||'Preview'; }); }
  },100);
}
function submitAddRoom() {
  const num=(document.getElementById('f-rnum').value||'').trim().toUpperCase();
  const floor=document.getElementById('f-rfloor').value;
  const typeId=document.getElementById('f-rtype').value;
  // Rent auto-derived from Room Type — no manual override to avoid conflicts with Settings rent update
  const _roomTypeObj = DB.settings.roomTypes.find(t=>t.id===typeId);
  const rent = _roomTypeObj?.defaultRent || 0;
  if(!num||!floor||!typeId){toast('Fill all required fields','error');return;}
  if(DB.rooms.find(r=>String(r.number).toUpperCase()===num)){toast('Room name already exists','error');return;}
  const amenities=document.getElementById('f-ramen').value.split(',').map(s=>s.trim()).filter(Boolean);
  const notes=document.getElementById('f-rnotes').value;
  DB.rooms.push({id:'room_'+uid(),number:num,floor,typeId,rent,studentIds:[],amenities,notes});
  DB.rooms.sort((a,b)=>String(a.number).localeCompare(String(b.number)));
  logActivity('Room Added', 'Room #'+num+' ('+floor+' Floor)', 'Room');
  saveDB(); closeModal(); renderPage('rooms'); toast('Room added successfully','success');
}

function showEditRoomModal(id) {
  const r=DB.rooms.find(x=>x.id===id); if(!r) return;
  const typeOpts=DB.settings.roomTypes.map(t=>`<option value="${t.id}" ${r.typeId===t.id?'selected':''}>${escHtml(t.name)}</option>`).join('');
  const floorOpts=DB.settings.floors.map(f=>`<option value="${f}" ${r.floor===f?'selected':''}>${f} Floor</option>`).join('');
  showModal('modal-md',`Edit Room #${r.number}`,`
    <div class="form-grid">
      <div class="field"><label>Room Name / Number</label>
        <input class="form-control" id="f-rnum" maxlength="12" value="${r.number}"
          oninput="formatRoomNumber(this)"
          style="font-weight:700;letter-spacing:1px"></div>
      <div class="field"><label>Floor</label><select class="form-control" id="f-rfloor">${floorOpts}</select></div>
      <div class="field"><label>Room Type</label><select class="form-control" id="f-rtype">${typeOpts}</select></div>
      <div class="field col-full"><label>Amenities (comma separated)</label><input class="form-control" id="f-ramen" value="${escHtml((r.amenities||[]).join(', '))}"></div>
      <div class="field col-full"><label>Notes</label><textarea class="form-control" id="f-rnotes">${escHtml(r.notes||'')}</textarea></div>
    </div>`,
  `<button class="btn btn-danger" onclick="confirmDeleteRoom('${id}')">Delete Room</button><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitEditRoom('${id}')">Save Changes</button>`);
}
function submitEditRoom(id) {
  const r=DB.rooms.find(x=>x.id===id); if(!r) return;
  const newNum=(document.getElementById('f-rnum').value||'').trim().toUpperCase()||r.number;
  r.floor=document.getElementById('f-rfloor').value;
  r.typeId=document.getElementById('f-rtype').value;
  // Sync rent from room type — keeps rent consistent with Settings
  const _editedType = DB.settings.roomTypes.find(t=>t.id===r.typeId);
  if (_editedType) r.rent = _editedType.defaultRent;
  r.number=newNum;
  const oldNumber = r.number;
  r.amenities=document.getElementById('f-ramen').value.split(',').map(s=>s.trim()).filter(Boolean);
  r.notes=document.getElementById('f-rnotes').value;
  // Sync room number in payments and cancellations if changed
  if(String(r.number) !== String(oldNumber)) {
    DB.payments.filter(p=>p.roomId===r.id).forEach(p=>{ p.roomNumber=r.number; });
    DB.cancellations && DB.cancellations.filter(c=>c.roomId===r.id).forEach(c=>{ c.roomNumber=r.number; });
  }
  logActivity('Room Updated', 'Room #'+r.number, 'Room');
  saveDB(); closeModal(); renderPage('rooms'); toast('Room updated','success');
}
function confirmDeleteRoom(id) {
  const r=DB.rooms.find(x=>x.id===id); if(!r) return;
  if(getRoomOccupancy(r)>0){toast('Cannot delete occupied room','error');return;}
  closeModal();
  showConfirm(`Delete Room #${r.number}?`,'This cannot be undone.',()=>{
    DB.rooms=DB.rooms.filter(x=>x.id!==id);
    logActivity('Room Deleted', 'Room #'+r.number, 'Room');
    saveDB(); renderPage('rooms'); toast('Room deleted','info');
  });
}

// ════════════════════════════════════════════════════════════════════════════
// TENANTS
// ════════════════════════════════════════════════════════════════════════════
let studentFilter = {status:'All', search:''};
function renderStudents() {
  let students = DB.students.filter(t=>{
    if(studentFilter.status!=='All' && t.status!==studentFilter.status) return false;
    if(studentFilter.search){
      const s=studentFilter.search.toLowerCase();
      const room4s = DB.rooms.find(r=>r.id===t.roomId);
      if(![t.name,t.fatherName,t.id,t.cnic,t.phone,t.email,t.address,t.emergencyContact,t.occupation||t.course,room4s?.number&&String(room4s.number),room4s?.floor].some(f=>f&&String(f).toLowerCase().includes(s))) return false;
    }
    return true;
  });

  if(students.length===0 && DB.students.length===0) return `
    <div class="empty-state">
      <div class="icon">👤</div>
      <h3>No Students Yet</h3>
      <p style="margin-bottom:16px">Add your first student to get started</p>
      <button class="btn btn-primary" onclick="showAddStudentModal()">+ Add Student</button>
    </div>`;

  return `
  <div class="filter-bar">
    <div class="search-wrap">
      <svg class="search-icon" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <input class="form-control" id="search-students" placeholder="Name, father, ID, CNIC, phone, email, room, floor, course…" value="${escHtml(studentFilter.search)}" oninput="capFirstChar(this);studentFilter.search=this.value;_dStudents();toggleClearBtn('search-students','clear-students')">
      <button class="search-clear ${studentFilter.search?'visible':''}" id="clear-students" onclick="studentFilter.search='';document.getElementById('search-students').value='';this.classList.remove('visible');renderPage('students')" title="Clear">✕</button>
    </div>
    <div class="filter-tabs">
      ${['All','Active','Left','Blacklisted'].map(s=>`<button class="ftab ${studentFilter.status===s?'active':''}" onclick="studentFilter.status='${s}';renderPage('students')">${s}</button>`).join('')}
    </div>
    <span class="text-muted" style="font-size:12px;margin-left:auto">${students.length} students</span>
  </div>
  <div class="table-wrap">
    <table style="font-size:12px;border-collapse:collapse">
      <thead><tr>
        <th style="width:60px;padding:8px 8px">ID</th>
        <th style="min-width:140px;padding:8px 8px">Student</th>
        <th style="min-width:110px;padding:8px 8px">Room</th>
        <th style="min-width:120px;padding:8px 8px">Phone / Emergency</th>
        <th style="min-width:120px;padding:8px 8px">CNIC</th>
        <th style="min-width:120px;padding:8px 8px">Address</th>
        <th style="min-width:100px;padding:8px 8px">Course</th>
        <th style="min-width:80px;padding:8px 8px">Rent/Mo</th>
        <th style="min-width:70px;padding:8px 8px">Status</th>
        <th style="min-width:90px;padding:8px 8px">Actions</th>
      </tr></thead>
      <tbody>
        ${students.length===0?`<tr><td colspan="10" style="text-align:center;color:var(--text3);padding:30px">No students match filters</td></tr>`:
        students.map(t=>{
          const room=DB.rooms.find(r=>r.id===t.roomId);
          const av=t.name?t.name[0].toUpperCase():'?';
          const colors=['#4a9cf0','#9b6df0','#2ec98a','#c8a84b','#f0a030','#e05252','#0fbcad'];
          const c=colors[t.name?.charCodeAt(0)%colors.length]||'#4a9cf0';
          return `<tr style="cursor:pointer" onclick="showViewStudentModal('${t.id}')" title="Click row to view full profile">
            <td style="font-family:var(--font-mono);font-size:11px;font-weight:800;color:var(--gold2);text-align:center;padding:8px 4px">#${escHtml(t.id)}</td>
            <td style="padding:8px 6px"><div class="td-name"><div class="avatar" style="background:${c}22;color:${c};width:30px;height:30px;font-size:13px">${av}</div><div><div style="font-weight:600;color:var(--blue)">${escHtml(t.name)}</div><div style="font-size:10px;color:var(--text3)">${escHtml(t.fatherName||'')}</div></div></div></td>
            <td style="padding:8px 6px"><span class="text-gold fw-700">${room?'#'+room.number:'—'}</span><div class="td-sub" style="font-size:10px">${room?getRoomType(room).name:'—'} · ${room?room.floor+' Fl':'—'}</div></td>
            <td style="padding:8px 6px;font-size:12px">${escHtml(t.phone||'—')}${t.emergencyContact?'<div style="font-size:10px;color:var(--text3);margin-top:2px">🆘 '+escHtml(t.emergencyContact)+'</div>':''}</td>
            <td style="padding:8px 6px;font-family:var(--font-mono);font-size:11px;color:var(--text2)">${escHtml(t.cnic||'—')}</td>
            <td style="padding:8px 6px;font-size:11px;color:var(--text2)">${escHtml(t.address||'—')}</td>
            <td style="padding:8px 6px;font-size:11px;color:var(--text2)">${escHtml(t.occupation||t.course||'—')}</td>
            <td style="padding:8px 6px" class="text-green fw-700">${fmtPKR(t.rent)}</td>
            <td style="padding:8px 6px">${statusBadge(t.status||'Active')}</td>
            <td style="padding:8px 4px">
              <div style="display:flex;gap:3px;flex-wrap:nowrap;white-space:nowrap">
                <button class="btn btn-secondary btn-icon btn-sm" onclick="event.stopPropagation();showViewStudentModal('${t.id}')" title="View Profile" style="padding:4px 7px;font-size:11px">👁</button>
                <button class="btn btn-secondary btn-icon btn-sm" onclick="event.stopPropagation();showRoomShiftModal('${t.id}')" title="Shift Room" style="color:var(--blue);padding:4px 7px;font-size:11px">🔀</button>
                <button class="btn btn-danger btn-icon btn-sm" onclick="event.stopPropagation();confirmDeleteStudent('${t.id}')" title="Delete" style="padding:4px 7px;font-size:11px">🗑</button>
              </div>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>`;
}

function showAddStudentModal(presetRoomId='') {
  const availRooms = DB.rooms.filter(r=>{ const t=getRoomType(r); return getRoomOccupancy(r)<t.capacity; });
  // Fix #10: ALL rooms shown — full rooms are included with a warning flag
  const allRooms = DB.rooms;
  const roomOpts = allRooms.map(r=>{
    const t=getRoomType(r); const occ=getRoomOccupancy(r); const isFull=occ>=t.capacity;
    return `<option value="${r.id}" ${r.id===presetRoomId?'selected':''}>#${r.number} · ${t.name} · ${r.floor} Floor (${occ}/${t.capacity} occ.)${isFull?' ⚠ FULL':''}</option>`;
  }).join('');
  const pmOpts = DB.settings.paymentMethods.map(m=>`<option value="${m}">${m}</option>`).join('');
  showModal('modal-xl','➕ Add New Student',`
  <style>
  .as-section{background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:14px}
  .as-section-title{font-size:10px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:var(--gold2);margin-bottom:12px;display:flex;align-items:center;gap:6px}
  .room-card{border:2px solid var(--border);border-radius:10px;padding:10px 12px;cursor:pointer;transition:all 0.15s;background:var(--card);text-align:center;min-width:0}
  .room-card:hover{border-color:var(--gold2);background:var(--bg4)}
  .room-card.selected{border-color:var(--gold2);background:rgba(200,168,75,0.12);box-shadow:0 0 0 2px rgba(200,168,75,0.3)}
  .room-card .rc-num{font-size:18px;font-weight:900;color:var(--gold2);line-height:1}
  .room-card .rc-type{font-size:9px;color:var(--text3);margin-top:2px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px}
  .room-card .rc-occ{font-size:10px;font-weight:700;margin-top:4px}
  .room-card .rc-rent{font-size:10px;color:var(--text3);margin-top:1px}
  </style>

  <!-- PHOTO BANNER at top -->
  <div style="display:flex;align-items:center;gap:16px;margin-bottom:14px;padding:14px 16px;background:linear-gradient(135deg,var(--bg3),var(--bg4));border:1px solid var(--border2);border-radius:12px">
    <div id="add-student-photo-preview" style="width:72px;height:86px;border-radius:12px;border:2px dashed rgba(200,168,75,0.5);background:rgba(200,168,75,0.07);display:flex;align-items:center;justify-content:center;font-size:32px;flex-shrink:0;overflow:hidden;cursor:pointer" onclick="triggerStudentPhotoUpload()" title="Click to upload photo">🧑‍🎓</div>
    <div style="flex:1">
      <div style="font-size:13px;font-weight:800;color:var(--gold2);margin-bottom:8px">📸 Student Photo <span style="font-size:10px;color:var(--text3);font-weight:400">(optional)</span></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button type="button" class="btn btn-secondary btn-sm" onclick="triggerStudentPhotoUpload()" style="font-size:11px">📁 Upload</button>
        <button type="button" class="btn btn-secondary btn-sm" id="add-student-cam-btn" onclick="openAddStudentCamera()" style="font-size:11px">📷 Camera</button>
        <button type="button" class="btn btn-danger btn-sm" onclick="clearAddStudentPhoto()" style="font-size:11px;display:none" id="add-student-clear-btn">✕ Remove</button>
      </div>
      <input type="file" id="add-student-photo-file" accept="image/*" style="display:none" onchange="loadAddStudentPhoto(this)">
      <div id="add-student-cam-box" style="display:none;margin-top:8px">
        <video id="add-student-cam-video" autoplay playsinline style="width:100%;max-height:120px;border-radius:8px;background:#000"></video>
        <canvas id="add-student-cam-canvas" style="display:none"></canvas>
        <div style="display:flex;gap:6px;margin-top:6px">
          <button type="button" class="btn btn-primary btn-sm" style="flex:1;font-size:11px" onclick="captureAddStudentPhoto()">📸 Capture</button>
          <button type="button" class="btn btn-secondary btn-sm" style="flex:1;font-size:11px" onclick="closeAddStudentCamera()">✕ Close</button>
        </div>
      </div>
      <input type="hidden" id="add-student-photo-data" value="">
    </div>
  </div>

  <!-- SECTION 1: IDENTITY -->
  <div class="as-section">
    <div class="as-section-title">👤 Student Identity</div>
    <div class="form-grid" style="gap:12px">
      <div class="field"><label>Full Name *</label><input class="form-control" id="f-tname" placeholder="Muhammad Ali" oninput="autoCapName(this)" style="text-transform:capitalize"></div>
      <div class="field"><label>Father Name *</label><input class="form-control" id="f-tfname" placeholder="Muhammad Khan" oninput="autoCapName(this)" style="text-transform:capitalize"></div>
      <div class="field"><label>CNIC</label><input class="form-control" id="f-tcnic" placeholder="XXXXX-XXXXXXX-X" maxlength="15" oninput="fmtCnic(this)"></div>
      <div class="field"><label>Course / Study Field</label>
        <div style="position:relative" id="f-tocc-wrap">
          <input class="form-control" id="f-tocc" placeholder="e.g. BS Computer Science, MBBS, BBA…"
            oninput="courseAutocomplete(this)"
            onfocus="courseAutocomplete(this)"
            onkeydown="courseKeyNav(event)"
            onblur="setTimeout(()=>{const d=document.getElementById('course-suggestions');if(d)d.style.display='none';},200)"
            autocomplete="off">
          <div id="course-suggestions" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--bg2);border:1px solid var(--border2);border-radius:8px;z-index:9999;max-height:200px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,0.5);margin-top:2px"></div>
        </div>
        <input type="hidden" id="f-tocctype" value="Student">
        <input type="hidden" id="f-tocccustom" value="">
      </div>
    </div>
  </div>

  <!-- SECTION 2: CONTACT -->
  <div class="as-section">
    <div class="as-section-title">📞 Contact Information</div>
    <div class="form-grid" style="gap:12px">
      <div class="field"><label>Phone Number *</label>
        <input class="form-control" id="f-tphone" placeholder="03XX-XXXXXXX" maxlength="12" oninput="fmtPhone(this)">
      </div>
      <div class="field"><label>Emergency Contact</label>
        <input class="form-control" id="f-temerg" placeholder="03XX-XXXXXXX (Guardian/Family)">
      </div>
      <div class="field"><label>Email Address</label>
        <div style="position:relative;min-width:0">
          <input class="form-control" id="f-temail" type="text" placeholder="username" oninput="fmtEmail(this)" autocomplete="off" style="padding-right:90px">
          <span id="f-temail-hint" style="display:none;position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:12px;color:var(--text3);pointer-events:none;white-space:nowrap">@gmail.com</span>
        </div>
        <div style="font-size:10px;color:var(--text3);margin-top:2px">Type username — @gmail.com added automatically</div>
      </div>
      <div class="field col-full"><label>Home Address</label>
        <input class="form-control" id="f-taddress" placeholder="e.g. House #12, Street 4, Peshawar" autocomplete="off" oninput="cityAutocomplete(this)" onblur="hideCitySuggestions()" list="">
        <div id="f-taddress-suggestions" class="city-suggestions"></div>
      </div>
    </div>
  </div>

  <!-- SECTION 3: ASSIGN ROOM search -->
  <div class="as-section">
    <div class="as-section-title" style="justify-content:space-between">
      <span>🏠 Assign Room *</span>
      <span id="f-troom-selected-label" style="font-size:11px;color:var(--green);font-weight:700"></span>
    </div>
    <input type="hidden" id="f-troom" value="${presetRoomId||''}">
    <div style="position:relative">
      <input class="form-control" id="f-troom-search" placeholder="🔍 Search by room number, type, floor…" autocomplete="off"
        value="${(()=>{if(!presetRoomId)return '';const r=DB.rooms.find(x=>x.id===presetRoomId);if(!r)return '';const rt=getRoomType(r);return 'Room #'+r.number+' · '+rt.name+' · '+r.floor+' Floor';})()||''}"
        oninput="filterRoomSearch(this.value)" onfocus="filterRoomSearch(this.value)" onblur="setTimeout(()=>{const d=document.getElementById('room-search-drop');if(d)d.style.display='none';},180)">
      <div id="room-search-drop" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--card);border:1px solid var(--border2);border-radius:var(--radius-sm);z-index:500;max-height:220px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,0.4);margin-top:4px">
        ${allRooms.map(r=>{
          const rt=getRoomType(r); const occ=getRoomOccupancy(r); const free=rt.capacity-occ;
          const isFull = occ >= rt.capacity;
          const lbl='Room #'+r.number+' · '+rt.name+' · '+r.floor+' Floor';
          const occColor=isFull?'var(--red)':free<=1?'var(--amber)':'var(--green)';
          return '<div class="room-search-item" data-id="'+r.id+'" data-rent="'+(parseFloat(r.rent)||16000)+'"'
            +' data-label="'+lbl+'"'
            +' style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);transition:background 0.1s'+(isFull?';background:rgba(224,82,82,0.05)':'')+'"'
            +' onmouseover="this.style.background=\'var(--bg4)\'" onmouseout="this.style.background=\''+(isFull?'rgba(224,82,82,0.05)':'')+'\'}"'
            +' onmousedown="pickRoomSearch(\''+r.id+'\','+(parseFloat(r.rent)||16000)+',\''+lbl+'\')">'
            +'<div>'
            +'<span style="font-size:15px;font-weight:900;color:var(--gold2)">Room #'+r.number+'</span>'
            +'<span style="font-size:11px;color:var(--text3);margin-left:8px">'+rt.name+' · '+r.floor+' Floor</span>'
            +(isFull?'<span style="font-size:10px;font-weight:800;color:var(--red);margin-left:8px;background:rgba(224,82,82,0.15);padding:1px 6px;border-radius:20px">⚠ FULL</span>':'')
            +'</div>'
            +'<div style="text-align:right">'
            +'<div style="font-size:11px;font-weight:700;color:'+occColor+'">'+occ+'/'+rt.capacity+' occ · '+(isFull?'<span style=\'color:var(--red)\'>Over capacity</span>':free+' free')+'</div>'
            +'<div style="font-size:11px;color:var(--text3)">'+fmtPKR(parseFloat(r.rent)||0)+'/mo</div>'
            +'</div></div>';
        }).join('')}
        ${allRooms.length===0?'<div style="padding:14px;color:var(--text3);font-size:12px;text-align:center">No rooms configured</div>':''}
      </div>
    </div>
  </div>

  <!-- hidden stay-detail inputs so submitAddStudent still works -->
  <input type="hidden" id="f-trent" value="${presetRoomId?(parseFloat(DB.rooms.find(r=>r.id===presetRoomId)?.rent)||DB.settings.roomTypes[0]?.defaultRent||16000):DB.settings.roomTypes[0]?.defaultRent||16000}">
  <input type="hidden" id="f-tjoin" value="${today()}">
  <input type="hidden" id="f-tpm" value="${DB.settings.paymentMethods[0]||'Cash'}">

  <!-- SECTION 5: NOTES (collapsible) -->
  <div class="as-section" style="margin-bottom:0">
    <div class="as-section-title" style="cursor:pointer;justify-content:space-between;margin-bottom:0" onclick="const b=document.getElementById('opt-body');const a=document.getElementById('opt-arrow');b.style.display=b.style.display==='none'?'block':'none';a.textContent=b.style.display==='none'?'▶ Show':'▼ Hide'">
      <span>📝 Notes</span>
      <span id="opt-arrow" style="font-size:10px;color:var(--text3);font-weight:600">▶ Show</span>
    </div>
    <div id="opt-body" style="display:none;margin-top:12px">
      <div class="field"><label>Notes</label><textarea class="form-control" id="f-tnotes" placeholder="Additional notes…" rows="2"></textarea></div>
    </div>
  </div>`,
  `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>${presetRoomId?'<button class="btn btn-secondary" onclick="submitAddStudent(\''+presetRoomId+'\',true)">✚ Save & Add Another</button>':''}<button class="btn btn-secondary" onclick="submitAddStudent('${presetRoomId}', false, true)">💾 Save</button><button class="btn btn-primary" onclick="submitAddStudent('${presetRoomId}')">💰 Save &amp; Proceed to Payment</button>`);
}
function submitAddStudent(presetRoomId='', addAnother=false, saveOnly=false) {
  const name=document.getElementById('f-tname').value.trim();
  const roomId=document.getElementById('f-troom').value;
  // Derive rent from selected room if hidden input not yet updated
  const selectedRoomForRent = DB.rooms.find(r=>r.id===roomId);
  const rentFromRoom = selectedRoomForRent ? (parseFloat(selectedRoomForRent.rent)||DB.settings.roomTypes[0]?.defaultRent||16000) : (DB.settings.roomTypes[0]?.defaultRent||16000);
  const rentEl = document.getElementById('f-trent');
  const rent = parseFloat(rentEl?.value) || rentFromRoom;
  if(!name||!roomId||!rent){toast('Fill all required fields','error');return;}
  const joinDate = document.getElementById('f-tjoin').value || today();
  const payMethod = document.getElementById('f-tpm').value;
  const t={
    id:nextStudentId(), name, fatherName:document.getElementById('f-tfname').value.trim(),
    cnic:document.getElementById('f-tcnic').value.trim(),
    phone:document.getElementById('f-tphone').value.trim(), email:getEmailValue(),
    occupation: document.getElementById('f-tocc')?.value?.trim()||'',
    roomId, rent,
    deposit: 0,
    admissionFee: 0,
    joinDate, paymentMethod: payMethod,
    emergencyContact:document.getElementById('f-temerg').value.trim(), address:document.getElementById('f-taddress')?.value.trim()||'', notes:document.getElementById('f-tnotes').value.trim(),
    status:'Active', createdAt:today(),
    docs: { photo: document.getElementById('add-student-photo-data')?.value || '' }
  };
  // Fix #10: Capacity guard — warn warden but allow force-add with confirmation
  const selectedRoom = DB.rooms.find(r => r.id === roomId);
  if (selectedRoom) {
    const roomType = getRoomType(selectedRoom);
    if (roomType && getRoomOccupancy(selectedRoom) >= roomType.capacity) {
      const currentOcc = getRoomOccupancy(selectedRoom);
      showConfirm(
        '⚠️ Room Is At Full Capacity',
        `Room #${selectedRoom.number} (${roomType.name}) already has ${currentOcc}/${roomType.capacity} students. Do you want to force-add ${name} anyway? Room capacity display will remain at ${roomType.capacity} but this room will show as over-capacity.`,
        () => {
          t.isForced = true; // FIX: force-added students don't count against available seats
          DB.students.push(t);
          const room2 = DB.rooms.find(r=>r.id===roomId);
          logActivity('Student Force-Added', name + ' force-added to full Room #' + (room2?.number||'?') + ' ('+currentOcc+'/'+roomType.capacity+' cap)', 'Student');
          saveDB();
          if(addAnother && presetRoomId) {
            closeModal(); toast('✅ ' + name + ' added to full room!','success');
            setTimeout(()=>showAddStudentModal(presetRoomId), 200);
          } else if(saveOnly) {
            closeModal(); renderPage('students');
            toast('✅ ' + name + ' added (over capacity).','success');
          } else {
            closeModal(); renderPage('students');
            toast('✅ ' + name + ' added to full room — record payment below.','success');
            setTimeout(()=>openPaymentForNewStudent(t.id), 350);
          }
        }
      );
      return;
    }
  }
  DB.students.push(t);
  const room = DB.rooms.find(r=>r.id===roomId);
  logActivity('Student Added', name + ' admitted to Room #' + (room?.number||'?'), 'Student');
  saveDB();
  if(addAnother && presetRoomId) {
    closeModal();
    toast('\u2705 ' + name + ' added! Open next student for same room.','success');
    setTimeout(()=>showAddStudentModal(presetRoomId), 200);
  } else if(saveOnly) {
    closeModal();
    renderPage('students');
    toast('\u2705 ' + name + ' added successfully.','success');
  } else {
    closeModal();
    renderPage('students');
    toast('\u2705 ' + name + ' added — now record the payment below.','success');
    setTimeout(()=>openPaymentForNewStudent(t.id), 350);
  }
}

// Opens the Add Payment modal and pre-selects the newly added student
function openPaymentForNewStudent(studentId) {
  showAddPaymentModal();
  setTimeout(function(){ selectStudentForPayment(studentId); }, 120);
}
// ── Student-view modal return helpers ────────────────────────────────────
// _returnStudentId — defined in src/receipt.js

function editPaymentFromStudentView(payId, studentId) {
  _returnStudentId = studentId;
  showEditPaymentModal(payId);
}

// printReceiptFromStudentView() — moved to src/receipt.js


function showViewStudentModal(id) {
  const t=DB.students.find(x=>x.id===id); if(!t) return;
  const room=DB.rooms.find(r=>r.id===t.roomId);
  const rtype=room?getRoomType(room):null;
  const payHistory=DB.payments.filter(p=>p.studentId===id).sort((a,b)=>new Date(b.date)-new Date(a.date));
  // Include partial amounts already collected from pending records
  const totalPaid=payHistory.filter(p=>p.status==='Paid').reduce((s,p)=>s+Number(p.amount),0)
    + payHistory.filter(p=>p.status==='Pending'&&Number(p.amount)>0&&p.unpaid!=null&&Number(p.unpaid)>0).reduce((s,p)=>s+Number(p.amount),0);
  // Due = only actual unpaid remainder
  const totalDue=payHistory.filter(p=>p.status==='Pending').reduce((s,p)=>s+(p.unpaid!=null?Number(p.unpaid):Number(p.amount)),0);
  const av=t.name?t.name[0].toUpperCase():'?';
  const colors=['#4a9cf0','#9b6df0','#2ec98a','#c8a84b','#f0a030','#e05252','#0fbcad'];
  const ac=colors[t.name?.charCodeAt(0)%colors.length]||'#4a9cf0';
  showModal('modal-xl',``,`
    <!-- PROFILE HEADER -->
    <div style="background:linear-gradient(135deg,var(--bg3),var(--bg4));border-radius:12px;padding:24px;margin-bottom:20px;display:flex;align-items:center;gap:20px;border:1px solid var(--border2)">
      <div style="width:72px;height:72px;border-radius:18px;background:${ac}22;border:2px solid ${ac}55;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:900;color:${ac};flex-shrink:0;overflow:hidden">
        ${t.docs?.photo ? `<img src="${t.docs.photo}" style="width:100%;height:100%;object-fit:cover">` : av}
      </div>
      <div style="flex:1">
        <div style="font-size:22px;font-weight:800;color:var(--text);line-height:1.2">${escHtml(t.name)}</div>
        <div style="font-size:12px;color:var(--text3);font-family:var(--font-mono);margin-top:3px">#${escHtml(t.id)}</div>
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
          ${statusBadge(t.status||'Active')}
          ${room?`<span class="badge badge-gold">Room #${room.number} · ${escHtml(rtype?.name||'')}</span>`:'<span class="badge badge-gray">No Room Assigned</span>'}
          <span class="badge badge-blue">${escHtml(t.paymentMethod||'Cash')}</span>
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:1px">Monthly Rent</div>
        <div style="font-size:28px;font-weight:900;color:var(--green)">${fmtPKR(t.rent)}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px">Adm. Paid: ${fmtPKR(t.deposit||0)}</div>
      </div>
    </div>

    <!-- STATS ROW -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Total Paid</div>
        <div style="font-size:20px;font-weight:800;color:var(--green)">${fmtPKR(totalPaid)}</div>
      </div>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Outstanding</div>
        <div style="font-size:20px;font-weight:800;color:${totalDue>0?'var(--red)':'var(--green)'}">${fmtPKR(totalDue)}</div>
      </div>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Join Date</div>
        <div style="font-size:15px;font-weight:700;color:var(--text)">${fmtDate(t.joinDate)}</div>
      </div>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Payments Made</div>
        <div style="font-size:20px;font-weight:800;color:var(--blue)">${payHistory.filter(p=>p.status==='Paid').length}</div>
      </div>
    </div>

    <!-- PERSONAL INFO GRID -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px">
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:16px">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--gold2);margin-bottom:14px;display:flex;align-items:center;gap:6px">👤 Personal Information</div>
        ${[['Father / Guardian',t.fatherName],['Occupation / Course',t.occupation],['CNIC / ID',t.cnic],['Phone Number',t.phone],['Email Address',t.email],['Emergency Contact',t.emergencyContact]].map(([k,v])=>`
        <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--border)">
          <span style="font-size:11.5px;color:var(--text3);flex-shrink:0;width:130px">${k}</span>
          <span style="font-size:13px;font-weight:600;color:var(--text);text-align:right">${escHtml(v||'—')}</span>
        </div>`).join('')}
      </div>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:16px">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--teal);margin-bottom:14px;display:flex;align-items:center;gap:6px">🏠 Room & Accommodation</div>
        ${room?[['Room Number','#'+room.number],['Room Type',rtype?.name||'—'],['Floor',room.floor||'—'],['Capacity',rtype?.capacity+' beds'||'—'],['Amenities',(room.amenities||[]).join(', ')||'—'],['Room Notes',room.notes||'None']].map(([k,v])=>`
        <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--border)">
          <span style="font-size:11.5px;color:var(--text3);flex-shrink:0;width:130px">${k}</span>
          <span style="font-size:13px;font-weight:600;color:var(--text);text-align:right">${escHtml(String(v))}</span>
        </div>`).join('') : '<div style="color:var(--text3);font-size:13px;padding:20px 0;text-align:center">No room assigned</div>'}
      </div>
    </div>

    ${t.notes?`<div style="background:var(--amber-dim);border:1px solid rgba(240,160,48,0.25);border-radius:10px;padding:14px;margin-bottom:20px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--amber);margin-bottom:6px">📝 Notes</div><div style="font-size:13px;color:var(--text2)">${escHtml(t.notes)}</div></div>`:''}

    <!-- PAYMENT HISTORY TABLE -->
    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;overflow:hidden">
      <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--blue)">💳 Full Payment History (${payHistory.length} records)</div>
        <div style="display:flex;gap:6px">
          <span style="font-size:12px;color:var(--green)">Paid: ${fmtPKR(totalPaid)}</span>
          ${totalDue>0?`<span style="font-size:12px;color:var(--red)">Due: ${fmtPKR(totalDue)}</span>`:''}
        </div>
      </div>
      ${payHistory.length?(()=>{
        const _st=DB.students.find(s=>s.id===id);
        const rows=payHistory.map((p,i)=>{
          const mRent=p.monthlyRent||p.totalRent||_st?.rent||0;
          const admFee=Number(p.admissionFee||p.fee||0);
          const extras=p.extraCharges||[];
          const conc=Number(p.concession||p.discount||0);
          let paidCell='<span style="font-weight:800;color:var(--green)">'+fmtPKR(p.amount)+'</span>';
          if(admFee>0) paidCell+='<div style="font-size:10px;color:var(--blue);font-weight:700;margin-top:2px">🎓 +'+fmtPKR(admFee)+' adm.</div>';
          extras.forEach(c=>{paidCell+='<div style="font-size:10px;color:var(--amber);font-weight:700;margin-top:1px">+'+fmtPKR(c.amount)+' '+escHtml(c.label||'')+'</div>';});
          if(conc>0) paidCell+='<div style="font-size:10px;color:#e05c5c;font-weight:700;margin-top:1px">−'+fmtPKR(conc)+' concession</div>';
          return '<tr style="border-top:1px solid var(--border);background:'+(i%2?'var(--bg3)':'transparent')+'">'
          +'<td style="padding:10px 14px;font-weight:600">'+escHtml(p.month||'—')+'</td>'
          +'<td style="padding:10px 14px;font-weight:800;color:var(--text)">'+(mRent>0?fmtPKR(mRent):'<span style="color:var(--text3)">—</span>')+'</td>'
          +'<td style="padding:10px 14px;font-weight:700;color:var(--teal)">'+(conc>0?'−'+fmtPKR(conc):'<span style="color:var(--text3)">—</span>')+'</td>'
          +'<td style="padding:10px 14px">'+paidCell+'</td>'
          +'<td style="padding:10px 14px;font-weight:700;color:'+((p.unpaid||0)>0?'var(--red)':'var(--text3)')+'">'+((p.unpaid||0)>0?fmtPKR(p.unpaid||0):'—')+'</td>'
          +'<td style="padding:10px 14px">'+pmBadge(p.method)+'</td>'
          +'<td style="padding:10px 14px">'+statusBadge(p.status)+'</td>'
          +'<td style="padding:10px 14px;font-size:12px;color:var(--text3)">'+(fmtDate(p.date)||'—')+'</td>'
          +'<td style="padding:10px 14px"><div style="display:flex;gap:4px">'
          +(p.status!=='Paid'?`<button class="btn btn-success btn-icon btn-sm" onclick="markPaymentPaidFromStudentView('${p.id}','${id}')" title="Mark Paid" style="font-size:13px">✓</button>`:'')
          +`<button class="btn btn-secondary btn-icon btn-sm" onclick="printReceiptFromStudentView('${p.id}','${id}')" title="Print Receipt" style="font-size:13px">🧾</button>`
          +`<button class="btn btn-secondary btn-icon btn-sm" onclick="editPaymentFromStudentView('${p.id}','${id}')" title="Edit Payment" style="font-size:13px">✏️</button>`
          +`<button class="btn btn-danger btn-icon btn-sm" onclick="deletePaymentFromStudentView('${p.id}','${id}')" title="Delete" style="font-size:13px">🗑</button>`
          +'</div></td></tr>';
        }).join('');
        return '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">'
          +'<thead><tr style="background:var(--bg4)">'
          +'<th style="padding:10px 14px;text-align:left;font-size:11px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:0.8px">Month</th>'
          +'<th style="padding:10px 14px;text-align:left;font-size:11px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:0.8px">Monthly Rent</th>'
          +'<th style="padding:10px 14px;text-align:left;font-size:11px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:0.8px">Concession</th>'
          +'<th style="padding:10px 14px;text-align:left;font-size:11px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:0.8px">Paid (+Extras)</th>'
          +'<th style="padding:10px 14px;text-align:left;font-size:11px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:0.8px">Unpaid</th>'
          +'<th style="padding:10px 14px;text-align:left;font-size:11px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:0.8px">Method</th>'
          +'<th style="padding:10px 14px;text-align:left;font-size:11px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:0.8px">Status</th>'
          +'<th style="padding:10px 14px;text-align:left;font-size:11px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:0.8px">Date</th>'
          +'<th style="padding:10px 14px;text-align:left;font-size:11px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:0.8px">Actions</th>'
          +'</tr></thead><tbody>'+rows+'</tbody></table></div>';
      })():
      '<div style="padding:24px;text-align:center;color:var(--text3)">No payment records yet</div>'}
    </div>

    <!-- ROOM SHIFT HISTORY -->
    ${(()=>{
      const shifts = (DB.roomShifts||[]).filter(s=>s.studentId===id).sort((a,b)=>new Date(b.date)-new Date(a.date));
      if(!shifts.length) return '';
      return `<div style="background:var(--bg3);border:1px solid rgba(74,156,240,0.3);border-radius:10px;overflow:hidden;margin-top:16px">
        <div style="padding:12px 16px;border-bottom:1px solid var(--border);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--blue)">🔀 Room Shift History (${shifts.length})</div>
        <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:var(--bg4)">
          <th style="padding:9px 14px;text-align:left;font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase">Date</th>
          <th style="padding:9px 14px;text-align:left;font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase">From Room</th>
          <th style="padding:9px 14px;text-align:left;font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase">To Room</th>
          <th style="padding:9px 14px;text-align:left;font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase">Old Rent</th>
          <th style="padding:9px 14px;text-align:left;font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase">New Rent</th>
          <th style="padding:9px 14px;text-align:left;font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase">Reason</th>
        </tr></thead>
        <tbody>${shifts.map((s,i)=>`<tr style="border-top:1px solid var(--border);background:${i%2?'var(--bg3)':'transparent'}">
          <td style="padding:9px 14px;font-size:12px;color:var(--text3)">${fmtDate(s.date)}</td>
          <td style="padding:9px 14px"><span class="badge badge-gold">Rm #${s.fromRoomNumber}</span></td>
          <td style="padding:9px 14px"><span class="badge badge-blue">Rm #${s.toRoomNumber}</span></td>
          <td style="padding:9px 14px;color:var(--text3);font-size:12px">${fmtPKR(s.oldRent)}</td>
          <td style="padding:9px 14px;font-weight:700;color:var(--green);font-size:12px">${fmtPKR(s.newRent)}</td>
          <td style="padding:9px 14px;font-size:12px;color:var(--text2)">${escHtml(s.reason||'—')}</td>
        </tr>`).join('')}</tbody>
        </table></div>
      </div>`;
    })()}
  `,`
    <button class="btn btn-secondary" onclick="shareStudentWhatsApp('${id}')">&#x1F4F1; WhatsApp</button>
    <button class="btn btn-secondary" onclick="printStudentCard('${id}')">&#x1F5A8; Print</button>
    <button class="btn btn-secondary" style="background:var(--blue-dim);border-color:rgba(74,156,240,0.35);color:var(--blue)" onclick="closeModal();showRoomShiftModal('${id}')">🔀 Shift Room</button>
    <button class="btn btn-secondary" onclick="closeModal();showEditStudentModal('${id}')">&#x270F; Edit</button>
    ${t.status==='Active'?`<button class="btn btn-danger" onclick="closeModal();quickCancelStudent('${id}')">🚫 Cancel Seat</button>`:''}
    <button class="btn btn-primary" onclick="closeModal()">Close</button>
  `);
}

// ════════════════════════════════════════════════════════════════════════════
// ADD STUDENT — PHOTO HELPERS
// ════════════════════════════════════════════════════════════════════════════
function triggerStudentPhotoUpload() {
  const el = document.getElementById('add-student-photo-file');
  if(el) el.click();
}
function loadAddStudentPhoto(input) {
  const file = input.files[0]; if(!file) return;
  if(file.size > 5*1024*1024){ toast('Photo too large (max 5MB)','error'); return; }
  const reader = new FileReader();
  reader.onload = function(e) {
    const prev = document.getElementById('add-student-photo-preview');
    const data = document.getElementById('add-student-photo-data');
    if(prev) prev.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">`;
    if(data) data.value = e.target.result;
    const clr = document.getElementById('add-student-clear-btn'); if(clr) clr.style.display='';
    toast('Photo loaded','success');
  };
  reader.readAsDataURL(file);
}
function clearAddStudentPhoto() {
  const prev = document.getElementById('add-student-photo-preview');
  if(prev) prev.innerHTML = '🧑‍🎓';
  const data = document.getElementById('add-student-photo-data'); if(data) data.value='';
  const clr = document.getElementById('add-student-clear-btn'); if(clr) clr.style.display='none';
}
function openAddStudentCamera() {
  const box = document.getElementById('add-student-cam-box'); if(!box) return;
  if(!navigator.mediaDevices?.getUserMedia){ toast('Camera not supported on this device','error'); return; }
  // Stop any existing stream first
  const existVid = document.getElementById('add-student-cam-video');
  if(existVid?.srcObject){ existVid.srcObject.getTracks().forEach(t=>t.stop()); existVid.srcObject=null; }
  box.style.display = 'block';

  // FIX BUG-3: Check permission state first for a clear error message
  const _startCam = () => {
    navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480}}})
      .then(stream=>{
        const vid = document.getElementById('add-student-cam-video');
        if(!vid){ stream.getTracks().forEach(t=>t.stop()); return; }
        vid.srcObject = stream;
        vid._stream = stream;
        vid.oncanplay = () => { if(vid.paused) vid.play().catch(()=>{}); };
        if(vid.readyState >= 3) vid.play().catch(()=>{});
      })
      .catch(e=>{
        box.style.display='none';
        var msg;
        if(e.name==='NotAllowedError'||e.name==='PermissionDeniedError')
          msg='📷 Camera access denied. On Windows: Settings → Privacy & Security → Camera → enable this app. Then restart.';
        else if(e.name==='NotFoundError'||e.name==='DevicesNotFoundError')
          msg='📷 No camera found. Please connect a camera and try again.';
        else if(e.name==='NotReadableError'||e.name==='TrackStartError')
          msg='📷 Camera is in use by another app. Close other apps using the camera and retry.';
        else
          msg='📷 Camera error: '+(e.message||'Unknown error. Check camera connection.');
        toast(msg,'error');
      });
  };

  if(navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({name:'camera'}).then(function(ps){
      if(ps.state==='denied'){
        box.style.display='none';
        _showCameraPermBanner();
        return;
      }
      _startCam();
    }).catch(_startCam); // permissions API not fully supported — just try
  } else {
    _startCam();
  }
}
function captureAddStudentPhoto() {
  const vid = document.getElementById('add-student-cam-video');
  const cvs = document.getElementById('add-student-cam-canvas');
  if(!vid||!cvs) return;
  if(!vid.srcObject || !vid.videoWidth) {
    toast('Camera not ready yet — please wait a moment','error'); // use 'error' not 'warning'
    return;
  }
  cvs.width=vid.videoWidth; cvs.height=vid.videoHeight;
  cvs.getContext('2d').drawImage(vid,0,0);
  const dataUrl = cvs.toDataURL('image/jpeg',0.85);
  const prev = document.getElementById('add-student-photo-preview');
  if(prev) prev.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">`;
  const d = document.getElementById('add-student-photo-data'); if(d) d.value=dataUrl;
  const clr = document.getElementById('add-student-clear-btn'); if(clr) clr.style.display='';
  closeAddStudentCamera();
  toast('Photo captured!','success');
}
function closeAddStudentCamera() {
  const vid = document.getElementById('add-student-cam-video');
  if(vid?.srcObject) vid.srcObject.getTracks().forEach(t=>t.stop());
  const box = document.getElementById('add-student-cam-box'); if(box) box.style.display='none';
}

// EDIT STUDENT PHOTO HELPERS
function loadEditStudentPhoto(input) {
  const file = input.files[0]; if(!file) return;
  if(file.size > 5*1024*1024){ toast('Photo too large (max 5MB)','error'); return; }
  const reader = new FileReader();
  reader.onload = function(e) {
    const prev = document.getElementById('edit-student-photo-preview');
    const data = document.getElementById('edit-student-photo-data');
    if(prev) prev.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">`;
    if(data) data.value = e.target.result;
    const clr = document.getElementById('edit-student-clear-btn'); if(clr) clr.style.display='';
    toast('Photo loaded','success');
  };
  reader.readAsDataURL(file);
}
function clearEditStudentPhoto() {
  const prev = document.getElementById('edit-student-photo-preview');
  if(prev) prev.innerHTML = '🧑‍🎓';
  const data = document.getElementById('edit-student-photo-data'); if(data) data.value='';
  const clr = document.getElementById('edit-student-clear-btn'); if(clr) clr.style.display='none';
}
function openEditStudentCamera() {
  const box = document.getElementById('edit-student-cam-box'); if(!box) return;
  if(!navigator.mediaDevices?.getUserMedia){ toast('Camera not supported on this device','error'); return; }
  const existVid = document.getElementById('edit-student-cam-video');
  if(existVid?.srcObject){ existVid.srcObject.getTracks().forEach(t=>t.stop()); existVid.srcObject=null; }
  box.style.display = 'block';

  // FIX BUG-3: Check permission state first
  const _startCam = () => {
    navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:640},height:{ideal:480}}})
      .then(stream=>{
        const vid = document.getElementById('edit-student-cam-video');
        if(!vid){ stream.getTracks().forEach(t=>t.stop()); return; }
        vid.srcObject = stream;
        vid._stream = stream;
        vid.oncanplay = () => { if(vid.paused) vid.play().catch(()=>{}); };
        if(vid.readyState >= 3) vid.play().catch(()=>{});
      })
      .catch(e=>{
        box.style.display='none';
        var msg;
        if(e.name==='NotAllowedError'||e.name==='PermissionDeniedError')
          msg='📷 Camera access denied. On Windows: Settings → Privacy & Security → Camera → enable this app. Then restart.';
        else if(e.name==='NotFoundError'||e.name==='DevicesNotFoundError')
          msg='📷 No camera found. Please connect a camera and try again.';
        else if(e.name==='NotReadableError'||e.name==='TrackStartError')
          msg='📷 Camera is in use by another app. Close other apps using the camera and retry.';
        else
          msg='📷 Camera error: '+(e.message||'Unknown error. Check camera connection.');
        toast(msg,'error');
      });
  };

  if(navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({name:'camera'}).then(function(ps){
      if(ps.state==='denied'){
        box.style.display='none';
        _showCameraPermBanner();
        return;
      }
      _startCam();
    }).catch(_startCam);
  } else {
    _startCam();
  }
}
function captureEditStudentPhoto() {
  const vid = document.getElementById('edit-student-cam-video');
  const cvs = document.getElementById('edit-student-cam-canvas');
  if(!vid||!cvs) return;
  if(!vid.srcObject || !vid.videoWidth) {
    toast('Camera not ready yet — please wait a moment','error'); // use 'error' not 'warning'
    return;
  }
  cvs.width=vid.videoWidth; cvs.height=vid.videoHeight;
  cvs.getContext('2d').drawImage(vid,0,0);
  const dataUrl = cvs.toDataURL('image/jpeg',0.85);
  const prev = document.getElementById('edit-student-photo-preview');
  if(prev) prev.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">`;
  const d = document.getElementById('edit-student-photo-data'); if(d) d.value=dataUrl;
  const clr = document.getElementById('edit-student-clear-btn'); if(clr) clr.style.display='';
  closeEditStudentCamera();
  toast('Photo captured!','success');
}
function closeEditStudentCamera() {
  const vid = document.getElementById('edit-student-cam-video');
  if(vid?.srcObject) vid.srcObject.getTracks().forEach(t=>t.stop());
  const box = document.getElementById('edit-student-cam-box'); if(box) box.style.display='none';
}

function quickCancelStudent(studentId) {
  const student = DB.students.find(s=>s.id===studentId);
  if(!student){ toast('Student not found','error'); return; }
  // Check if already in cancellation list
  const existing = (DB.cancellations||[]).find(c=>c.studentId===studentId&&c.status==='Pending');
  if(existing){ toast(`${student.name} is already in the cancellation list`,'error'); return; }
  const room = DB.rooms.find(r=>r.id===student.roomId);
  const type = room?getRoomType(room):null;
  const endOfMonth = (()=>{ const d=new Date(); d.setMonth(d.getMonth()+1); d.setDate(0); return d.toISOString().split('T')[0]; })();
  if(!DB.cancellations) DB.cancellations=[];
  DB.cancellations.push({
    id: uid(),
    studentId: student.id,
    studentName: student.name,
    roomId: student.roomId||'',
    roomNumber: room?room.number:'—',
    roomType: type?type.name:'—',
    requestDate: today(),
    vacateDate: endOfMonth,
    reason: 'Student requested cancellation',
    status: 'Pending',
    createdAt: today()
  });
  student.status = 'Cancelling';
  saveDB();
  toast(`${student.name} added to cancellation list. Seat is now vacant.`, 'success');
  if(currentPage==='dashboard') renderPage('dashboard');
}

function shareStudentWhatsApp(id) {
  const t=DB.students.find(x=>x.id===id); if(!t) return;
  const room=DB.rooms.find(r=>r.id===t.roomId);
  const payHistory=DB.payments.filter(p=>p.studentId===id);
  const totalPaid=payHistory.filter(p=>p.status==='Paid').reduce((s,p)=>s+Number(p.amount),0);
  // FIX 1: use unpaid field so partial payments are not double-counted
  const totalDue=payHistory.filter(p=>p.status==='Pending').reduce((s,p)=>s+(p.unpaid!=null?Number(p.unpaid):Number(p.amount||0)),0);
  const msg=`*${DB.settings.hostelName}*
━━━━━━━━━━━━━━━━━━━━
👤 *Student Profile*
━━━━━━━━━━━━━━━━━━━━
*Name:* ${t.name}
*ID:* ${t.id}
*Father:* ${t.fatherName||'—'}
*CNIC:* ${t.cnic||'—'}
*Phone:* ${t.phone||'—'}
*Email:* ${t.email||'—'}
*Emergency:* ${t.emergencyContact||'—'}
━━━━━━━━━━━━━━━━━━━━
🏠 *Room Details*
*Room:* #${room?.number||'—'} (${room?DB.settings.roomTypes.find(x=>x.id===room.typeId)?.name:'—'})
*Floor:* ${room?.floor||'—'}
*Monthly Rent:* ${fmtPKR(t.rent)}
*Amount Paid:* ${fmtPKR(totalPaid)}
━━━━━━━━━━━━━━━━━━━━
💰 *Payment Summary*
*Total Paid:* ${fmtPKR(totalPaid)}
*Outstanding:* ${fmtPKR(totalDue)}
*Status:* ${t.status}
*Payment Method:* ${t.paymentMethod||'Cash'}
━━━━━━━━━━━━━━━━━━━━
Generated by ${DB.settings.hostelName} MS`;
  openExternalLink('whatsapp://send?text='+encodeURIComponent(msg));
}
function printStudentCard(id) {
  const t=DB.students.find(x=>x.id===id); if(!t) return;
  const room=DB.rooms.find(r=>r.id===t.roomId);
  const rtype=room?DB.settings.roomTypes.find(x=>x.id===room.typeId):null;
  const payHistory=DB.payments.filter(p=>p.studentId===id).sort((a,b)=>new Date(b.date)-new Date(a.date));
  const totalPaid=payHistory.filter(p=>p.status==='Paid').reduce((s,p)=>s+Number(p.amount),0);
  const totalDue=payHistory.filter(p=>p.status==='Pending').reduce((s,p)=>s+(p.unpaid!=null?Number(p.unpaid):Number(p.amount||0)),0);
  const _cardHtml = `<!DOCTYPE html><html><head><title>Student Profile — ${escHtml(t.name)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a2e;background:#fff;padding:32px;font-size:13px}
    .header{display:flex;align-items:center;justify-content:space-between;padding-bottom:16px;border-bottom:3px solid #c8a84b;margin-bottom:24px}
    .hostel-name{font-size:22px;font-weight:800;color:#1a1a2e}
    .hostel-sub{font-size:12px;color:#666;margin-top:3px}
    .report-badge{background:#c8a84b22;border:1px solid #c8a84b55;color:#8b6a00;padding:6px 14px;border-radius:20px;font-size:11px;font-weight:700}
    .profile-hero{background:linear-gradient(135deg,#0d1b2a,#1a2d4a);border-radius:12px;padding:24px;margin-bottom:20px;display:flex;align-items:center;gap:20px;color:#fff}
    .avatar{width:64px;height:64px;border-radius:14px;background:#c8a84b33;border:2px solid #c8a84b88;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:900;color:#c8a84b;flex-shrink:0}
    .badges{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
    .badge{padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
    .badge-green{background:#dcfce7;color:#166534}
    .badge-blue{background:#dbeafe;color:#1e40af}
    .badge-gold{background:#fef9c3;color:#854d0e}
    .section{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px;margin-bottom:16px}
    .section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin-bottom:12px}
    .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .info-item label{font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:2px}
    .info-item .val{font-size:13px;font-weight:600;color:#1e293b}
    .stats-row{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}
    .stat-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center}
    .stat-box .lbl{font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px}
    .stat-box .val{font-size:18px;font-weight:800;color:#1e293b}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th{background:#f1f5f9;padding:8px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;font-weight:700}
    td{padding:8px 12px;border-bottom:1px solid #f1f5f9}
    tr:last-child td{border-bottom:none}
    .paid{color:#16a34a;font-weight:700}
    .overdue{color:#dc2626;font-weight:700}
    .footer{margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;text-align:center;font-size:11px;color:#94a3b8}
    @media print{body{padding:16px}}
  </style></head><body>
  <div class="header">
    <div><div class="hostel-name">${t.name}</div><div class="hostel-sub">${DB.settings.hostelName} · ${DB.settings.location||''}</div></div>
    <div class="report-badge">Student Profile Report</div>
  </div>
  <div class="profile-hero">
    <div class="avatar">${t.name[0].toUpperCase()}</div>
    <div>
      <div style="font-size:20px;font-weight:800">${t.name}</div>
      <div style="font-size:12px;opacity:0.6;font-family:monospace;margin-top:2px">#${t.id}</div>
      <div class="badges">
        <span class="badge badge-${t.status==='Active'?'green':'blue'}">${t.status}</span>
        ${room?`<span class="badge badge-gold">Room #${room.number} · ${rtype?.name||''}</span>`:''}
      </div>
    </div>
    <div style="margin-left:auto;text-align:right">
      <div style="font-size:11px;opacity:0.6">Monthly Rent</div>
      <div style="font-size:26px;font-weight:900;color:#2ec98a">${fmtPKR(t.rent)}</div>
    </div>
  </div>
  <div class="stats-row">
    <div class="stat-box"><div class="lbl">Total Paid</div><div class="val" style="color:#16a34a;font-size:15px">${fmtPKR(totalPaid)}</div></div>
    <div class="stat-box"><div class="lbl">Outstanding</div><div class="val" style="color:${totalDue>0?'#dc2626':'#16a34a'};font-size:15px">${fmtPKR(totalDue)}</div></div>
    <div class="stat-box"><div class="lbl">Amt. Paid (Adm.)</div><div class="val" style="font-size:15px">${fmtPKR(t.deposit||0)}</div></div>
    <div class="stat-box"><div class="lbl">Payments</div><div class="val">${payHistory.filter(p=>p.status==='Paid').length}</div></div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">
    <div class="section">
      <div class="section-title">👤 Personal Information</div>
      <div class="info-grid">
        ${[['Father/Guardian',t.fatherName],['CNIC / ID',t.cnic],['Phone Number',t.phone],['Email',t.email],['Home Address',t.address],['Emergency Contact',t.emergencyContact],['Join Date',fmtDate(t.joinDate)]].map(([k,v])=>`<div class="info-item"><label>${k}</label><div class="val">${v||'—'}</div></div>`).join('')}
      </div>
    </div>
    <div class="section">
      <div class="section-title">🏠 Room & Accommodation</div>
      <div class="info-grid">
        ${room?[['Room Number','#'+room.number],['Room Type',rtype?.name||'—'],['Floor',room.floor||'—'],['Capacity',rtype?.capacity+' beds'||'—'],['Monthly Rent',fmtPKR(t.rent)],['Amenities',(room.amenities||[]).join(', ')||'—']].map(([k,v])=>`<div class="info-item"><label>${k}</label><div class="val">${v}</div></div>`).join(''):'<p style="color:#94a3b8">No room assigned</p>'}
      </div>
    </div>
  </div>
  <div class="section">
    <div class="section-title">💳 Payment History</div>
    ${payHistory.length?`<table><thead><tr><th>Month</th><th>Amount</th><th>Method</th><th>Status</th><th>Date</th><th>Notes</th></tr></thead><tbody>
    ${payHistory.map(p=>{
      const _admF=Number(p.admissionFee||p.fee||0);
      const _extras=(p.extraCharges||[]);
      const _conc=Number(p.concession||p.discount||0);
      const _extraHTML=_admF>0?`<div style='font-size:10px;color:#1e40af'>🎓 +${fmtPKR(_admF)} adm.</div>`:'';
      const _xHTML=_extras.map(x=>`<div style='font-size:10px;color:#b45309'>+${fmtPKR(x.amount)} ${escHtml(x.label||'')}</div>`).join('');
      const _concHTML=_conc>0?`<div style='font-size:10px;color:#dc2626'>−${fmtPKR(_conc)} concession</div>`:'';
      return `<tr><td>${p.month||'—'}</td><td class="${p.status==='Paid'?'paid':'overdue'}">${fmtPKR(p.amount)}${_extraHTML}${_xHTML}${_concHTML}</td><td>${p.method||'—'}</td><td class="${p.status==='Paid'?'paid':'overdue'}">${p.status}</td><td>${fmtDate(p.date)||'—'}</td><td style="color:#94a3b8">${p.notes||'—'}</td></tr>`;
    }).join('')}
    </tbody></table>`:'<p style="color:#94a3b8;text-align:center;padding:12px">No payment records</p>'}
  </div>
  <div class="footer">Generated ${new Date().toLocaleDateString()} · ${DB.settings.hostelName} Management System · ${DB.settings.location||''}</div>
  </body></html>`;
  var _cardName = 'Student_' + (t.name||'Profile').replace(/\s+/g,'-').replace(/[^a-zA-Z0-9\-]/g,'') + '_' + new Date().toISOString().slice(0,10) + '.pdf';
  _electronPDF(_cardHtml, _cardName, { pageSize: 'A4' });
}
function showEditStudentModal(id) {
  const t=DB.students.find(x=>x.id===id); if(!t) return;
  const allRooms=DB.rooms.filter(r=>r.id===t.roomId||getRoomOccupancy(r)<getRoomType(r).capacity);
  const pmOpts=DB.settings.paymentMethods.map(m=>`<option ${t.paymentMethod===m?'selected':''}>${m}</option>`).join('');
  const statOpts=['Active','Left','Blacklisted'].map(s=>`<option ${t.status===s?'selected':''}>${s}</option>`).join('');
  const curRoom=DB.rooms.find(r=>r.id===t.roomId);
  const curRt=curRoom?getRoomType(curRoom):null;
  const presetLabel=curRoom?`Room #${curRoom.number} · ${curRt?.name||''} · ${curRoom.floor||''} Floor`:'';
  showModal('modal-lg',`✏️ Edit Student — ${escHtml(t.name)}`,`
  <style>
  .as-section{background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:14px}
  .as-section-title{font-size:10px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:var(--gold2);margin-bottom:12px;display:flex;align-items:center;gap:6px}
  </style>
  <div style="display:flex;align-items:center;gap:16px;margin-bottom:14px;padding:14px 16px;background:linear-gradient(135deg,var(--bg3),var(--bg4));border:1px solid var(--border2);border-radius:12px">
    <div id="edit-student-photo-preview" style="width:72px;height:86px;border-radius:12px;border:2px dashed rgba(200,168,75,0.5);background:rgba(200,168,75,0.07);display:flex;align-items:center;justify-content:center;font-size:30px;flex-shrink:0;overflow:hidden">
      ${t.docs?.photo?`<img src="${t.docs.photo}" style="width:100%;height:100%;object-fit:cover;border-radius:10px">`:'🧑‍🎓'}
    </div>
    <div style="flex:1">
      <div style="font-size:13px;font-weight:800;color:var(--gold2);margin-bottom:8px">📸 Student Photo <span style="font-size:10px;color:var(--text3);font-weight:400">(optional)</span></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('edit-student-photo-file').click()" style="font-size:11px">📁 Upload</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="openEditStudentCamera()" style="font-size:11px">📷 Camera</button>
        <button type="button" class="btn btn-danger btn-sm" onclick="clearEditStudentPhoto()" style="font-size:11px;display:${t.docs?.photo?'block':'none'}" id="edit-student-clear-btn">✕ Remove</button>
      </div>
      <input type="file" id="edit-student-photo-file" accept="image/*" style="display:none" onchange="loadEditStudentPhoto(this)">
      <div id="edit-student-cam-box" style="display:none;margin-top:8px">
        <video id="edit-student-cam-video" autoplay playsinline style="width:100%;max-height:140px;border-radius:8px;background:#000"></video>
        <canvas id="edit-student-cam-canvas" style="display:none"></canvas>
        <div style="display:flex;gap:6px;margin-top:6px">
          <button type="button" class="btn btn-primary btn-sm" style="flex:1;font-size:11px" onclick="captureEditStudentPhoto()">📸 Capture</button>
          <button type="button" class="btn btn-secondary btn-sm" style="flex:1;font-size:11px" onclick="closeEditStudentCamera()">✕ Close</button>
        </div>
      </div>
      <input type="hidden" id="edit-student-photo-data" value="${escHtml(t.docs?.photo||'')}">
    </div>
  </div>
  <div class="as-section">
    <div class="as-section-title">👤 Student Identity</div>
    <div class="form-grid" style="gap:12px">
      <div class="field"><label>Full Name *</label><input class="form-control" id="f-tname" value="${escHtml(t.name)}" oninput="autoCapName(this)" style="text-transform:capitalize"></div>
      <div class="field"><label>Father Name</label><input class="form-control" id="f-tfname" value="${escHtml(t.fatherName||'')}" oninput="autoCapName(this)" style="text-transform:capitalize"></div>
      <div class="field"><label>CNIC</label><input class="form-control" id="f-tcnic" value="${escHtml(t.cnic||'')}" placeholder="XXXXX-XXXXXXX-X" maxlength="15" oninput="fmtCnic(this)"></div>
      <div class="field"><label>Course / Study Field</label><input class="form-control" id="f-tocc" value="${escHtml(t.occupation||t.course||'')}" placeholder="e.g. BS Computer Science, MBBS…"></div>
      <div class="field"><label>Status</label><select class="form-control" id="f-tstat">${statOpts}</select></div>
      <div class="field"><label>Join Date</label><input class="form-control cdp-trigger" id="f-tjoin" type="text" readonly onclick="showCustomDatePicker(this,event)" value="${t.joinDate||''}"></div>
    </div>
  </div>
  <div class="as-section">
    <div class="as-section-title">📞 Contact Information</div>
    <div class="form-grid" style="gap:12px">
      <div class="field"><label>Phone Number</label><input class="form-control" id="f-tphone" value="${escHtml(t.phone||'')}" placeholder="03XX-XXXXXXX" maxlength="12" oninput="fmtPhone(this)"></div>
      <div class="field"><label>Emergency Contact</label><input class="form-control" id="f-temerg" value="${escHtml(t.emergencyContact||'')}" placeholder="Guardian/Family phone"></div>
      <div class="field"><label>Email</label><input class="form-control" id="f-temail" value="${escHtml(t.email||'')}" placeholder="email@gmail.com"></div>
      <div class="field col-full"><label>Home Address</label>
        <input class="form-control" id="f-taddress" value="${escHtml(t.address||'')}" placeholder="e.g. House #12, Street 4, Peshawar" autocomplete="off" oninput="cityAutocomplete(this)" onblur="hideCitySuggestions()" list="">
        <div id="f-taddress-suggestions" class="city-suggestions"></div>
      </div>
    </div>
  </div>
  <div class="as-section">
    <div class="as-section-title" style="justify-content:space-between">
      <span>🏠 Assign Room *</span>
      <span id="f-troom-selected-label" style="font-size:11px;color:var(--green);font-weight:700">${escHtml(presetLabel)}</span>
    </div>
    <input type="hidden" id="f-troom" value="${escHtml(t.roomId||'')}">
    <div style="position:relative">
      <input class="form-control" id="f-troom-search" placeholder="🔍 Search by room number, type, floor…" autocomplete="off"
        value="${escHtml(presetLabel)}"
        oninput="filterRoomSearch(this.value)" onfocus="filterRoomSearch(this.value)" onblur="setTimeout(()=>{const d=document.getElementById('room-search-drop');if(d)d.style.display='none';},180)">
      <div id="room-search-drop" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--card);border:1px solid var(--border2);border-radius:var(--radius-sm);z-index:500;max-height:220px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,0.4);margin-top:4px">
        ${allRooms.map(r=>{const rt=getRoomType(r);const occ=getRoomOccupancy(r);const free=rt.capacity-occ;const lbl=`Room #${r.number} · ${rt.name} · ${r.floor} Floor`;return `<div class="room-search-item" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);transition:background 0.1s" onmouseover="this.style.background='var(--bg4)'" onmouseout="this.style.background=''" onmousedown="pickRoomSearch('${r.id}',${parseFloat(r.rent)||0},'${lbl}')"><div><span style="font-size:15px;font-weight:900;color:var(--gold2)">Room #${r.number}</span><span style="font-size:11px;color:var(--text3);margin-left:8px">${rt.name} · ${r.floor} Floor</span></div><div style="text-align:right"><div style="font-size:11px;font-weight:700;color:${free>0?'var(--green)':'var(--red)'}">${occ}/${rt.capacity} occ</div><div style="font-size:11px;color:var(--text3)">${fmtPKR(parseFloat(r.rent)||0)}/mo</div></div></div>`;}).join('')}
      </div>
    </div>
  </div>

  <div class="as-section" style="margin-bottom:0">
    <div class="as-section-title">📝 Notes</div>
    <textarea class="form-control" id="f-tnotes" rows="2" placeholder="Additional notes…">${escHtml(t.notes||'')}</textarea>
  </div>`,
  `<button class="btn btn-danger" onclick="confirmDeleteStudent('${id}')">🗑 Delete</button><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitEditStudent('${id}')">💾 Save Changes</button>`);
}

function submitEditStudent(id) {
  const t=DB.students.find(x=>x.id===id); if(!t) return;
  const _originalRoomId = t.roomId; // capture BEFORE any changes

  // FIX-STUDENT-UPDATE: Collect all new values FIRST before mutating anything.
  // Previously, data was mutated before the room capacity check, so a failed
  // validation left t in a corrupted in-memory state that could be saved later.
  const _newName   = document.getElementById('f-tname')?.value.trim()  || t.name;
  const _newFather = document.getElementById('f-tfname')?.value.trim() || '';
  const _newCnic   = document.getElementById('f-tcnic')?.value.trim()  || '';
  const _newPhone  = document.getElementById('f-tphone')?.value.trim() || '';
  const _newEmail  = document.getElementById('f-temail')?.value.trim() || '';
  const _newOccup  = document.getElementById('f-toccup')?.value.trim() || t.occupation || '';
  const _newRoomId = document.getElementById('f-troom')?.value || t.roomId;
  const _newJoin   = document.getElementById('f-tjoin')?.value  || t.joinDate || '';
  const _newStatus = document.getElementById('f-tstat')?.value  || t.status;
  const _newEmerg  = document.getElementById('f-temerg')?.value.trim()   || '';
  const _newAddr   = document.getElementById('f-taddress')?.value.trim() || '';
  const _newNotes  = document.getElementById('f-tnotes')?.value.trim()   || '';
  const _photoData = document.getElementById('edit-student-photo-data')?.value;

  // Capacity guard — validate BEFORE touching any data
  if (_newRoomId && _newRoomId !== _originalRoomId) {
    const newRoom = DB.rooms.find(r => r.id === _newRoomId);
    if (newRoom) {
      const newRoomType = getRoomType(newRoom);
      const othersInRoom = DB.students.filter(s => s.id !== id && s.roomId === _newRoomId && s.status === 'Active').length;
      if (newRoomType && othersInRoom >= newRoomType.capacity) {
        toast('That room is now full — please choose a different room.', 'error');
        return; // exit BEFORE any mutation — data stays clean
      }
    }
  }

  // All checks passed — now apply changes
  t.name            = _newName;
  t.fatherName      = _newFather;
  t.cnic            = _newCnic;
  t.phone           = _newPhone;
  t.email           = _newEmail;
  t.occupation      = _newOccup;
  t.joinDate        = _newJoin;
  t.status          = _newStatus;
  t.emergencyContact= _newEmerg;
  t.address         = _newAddr;
  t.notes           = _newNotes;

  // FIX 21: if room changed, update pending payment records
  if (_newRoomId && _newRoomId !== _originalRoomId) {
    const _newRoom = DB.rooms.find(r=>r.id===_newRoomId);
    DB.payments.forEach(p=>{
      if(p.studentId===t.id && p.status==='Pending') {
        p.roomId     = _newRoomId;
        p.roomNumber = _newRoom ? _newRoom.number : p.roomNumber;
      }
    });
  }
  t.roomId = _newRoomId;

  if(_photoData !== undefined) { if(!t.docs) t.docs={}; t.docs.photo = _photoData; }

  saveDB(); closeModal(); renderPage('students'); toast('Student updated','success');
}
function confirmDeleteStudent(id) {
  const t=DB.students.find(x=>x.id===id); if(!t) return;
  closeModal();
  showConfirm(`Remove ${t.name}?`,'This will permanently delete the student record.',()=>{
    DB.students=DB.students.filter(x=>x.id!==id);
    DB.payments=DB.payments.filter(p=>p.studentId!==id);
    saveDB(); renderPage('students'); toast('Student removed','info');
  });
}

// ════════════════════════════════════════════════════════════════════════════
// FEATURE 3: ROOM SHIFTING
// ════════════════════════════════════════════════════════════════════════════
function showRoomShiftModal(studentId) {
  const t = DB.students.find(x => x.id === studentId);
  if (!t) return;
  const fromRoom = DB.rooms.find(r => r.id === t.roomId);

  // Available rooms: not the current room, and must have a free bed
  const available = DB.rooms.filter(r => {
    if (r.id === t.roomId) return false;
    const type = getRoomType(r);
    return getRoomOccupancy(r) < type.capacity;
  });

  if (!available.length) {
    toast('No other rooms have available capacity right now.', 'error');
    return;
  }

  const roomOpts = available.map(r => {
    const type = getRoomType(r);
    const occ  = getRoomOccupancy(r);
    return `<option value="${r.id}" data-rent="${r.rent}">#${r.number} — ${type.name} · ${r.floor} Floor (${occ}/${type.capacity} occupied) · ${fmtPKR(r.rent)}/mo</option>`;
  }).join('');

  showModal('modal-md', '🔀 Shift Student to Another Room', `
    <!-- Current info banner -->
    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:18px;display:flex;align-items:center;gap:14px">
      <div style="font-size:24px">🧑‍🎓</div>
      <div>
        <div style="font-size:14px;font-weight:800;color:var(--text)">${escHtml(t.name)}</div>
        <div style="font-size:12px;color:var(--text3)">Currently in <strong style="color:var(--gold2)">Room #${fromRoom ? fromRoom.number : '?'}</strong> · Rent: <strong style="color:var(--green)">${fmtPKR(t.rent)}/mo</strong></div>
      </div>
    </div>

    <div class="form-grid">
      <div class="field col-full">
        <label>New Room *</label>
        <select class="form-control" id="shift-new-room" onchange="
          const opt = this.options[this.selectedIndex];
          const rent = opt.getAttribute('data-rent')||'';
          const el = document.getElementById('shift-new-rent');
          if(el && rent) { el.value = rent; }
        ">
          <option value="">— Select Room —</option>${roomOpts}
        </select>
      </div>
      <div class="field">
        <label>New Monthly Rent (PKR)</label>
        <input class="form-control" id="shift-new-rent" type="number" value="${t.rent}" placeholder="Auto-filled from room">
        <div style="font-size:11px;color:var(--text3);margin-top:3px">Leave as-is or adjust for the new room</div>
      </div>
      <div class="field">
        <label>Shift Date</label>
        <input class="form-control cdp-trigger" id="shift-date" type="text" readonly onclick="showCustomDatePicker(this,event)" value="${today()}">
      </div>
      <div class="field col-full">
        <label>Reason / Notes</label>
        <textarea class="form-control" id="shift-reason" rows="2" placeholder="e.g. Student requested single room, maintenance issue…"></textarea>
      </div>
    </div>

    <div style="background:var(--amber-dim);border:1px solid rgba(240,160,48,0.3);border-radius:8px;padding:10px 14px;font-size:12px;color:var(--text2);margin-top:4px">
      ⚠️ Shifting will update the student's room assignment and adjust all future payment records. Past payments stay unchanged.
    </div>
  `,
  `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
   <button class="btn btn-primary" style="background:linear-gradient(135deg,var(--blue),#2a6cc0)" onclick="submitRoomShift('${studentId}')">🔀 Confirm Shift</button>`
  );
}

function submitRoomShift(studentId) {
  const t = DB.students.find(x => x.id === studentId);
  if (!t) return;

  const newRoomId  = document.getElementById('shift-new-room')?.value;
  const newRent    = parseFloat(document.getElementById('shift-new-rent')?.value) || t.rent;
  const shiftDate  = document.getElementById('shift-date')?.value  || today();
  const reason     = document.getElementById('shift-reason')?.value?.trim() || '';

  if (!newRoomId) { toast('Please select a new room', 'error'); return; }
  // FIX: block shifting to the same room the student is already in
  if (newRoomId === t.roomId) { toast('Student is already assigned to this room — please select a different one.', 'error'); return; }

  const fromRoom = DB.rooms.find(r => r.id === t.roomId);
  const toRoom   = DB.rooms.find(r => r.id === newRoomId);
  if (!toRoom)   { toast('Selected room not found', 'error'); return; }

  // Check capacity again at submission time
  const type = getRoomType(toRoom);
  if (getRoomOccupancy(toRoom) >= type.capacity) {
    toast('That room is now full — please select a different room.', 'error');
    return;
  }

  // Record the shift in DB
  if (!DB.roomShifts) DB.roomShifts = [];
  DB.roomShifts.push({
    id: 'rs_' + uid(),
    studentId: t.id,
    studentName: t.name,
    fromRoomId: t.roomId,
    fromRoomNumber: fromRoom?.number || '?',
    toRoomId: newRoomId,
    toRoomNumber: toRoom.number,
    oldRent: t.rent,
    newRent,
    date: shiftDate,
    reason,
    byWarden: (typeof CUR_USER !== 'undefined' && CUR_USER?.name) ? CUR_USER.name : ''
  });

  // Update student record
  const oldRoomId = t.roomId;
  t.roomId = newRoomId;
  t.rent   = newRent;

  // Update all PENDING payment records for this student to reflect new room
  DB.payments.forEach(p => {
    if (p.studentId === studentId && p.status === 'Pending') {
      p.roomId     = newRoomId;
      p.roomNumber = toRoom.number;
      p.monthlyRent = newRent;
      // Recalculate unpaid using new rent if not yet partially paid
      if (!p.amount || p.amount === 0) {
        p.amount  = 0;
        p.unpaid  = newRent;
      }
    }
  });

  logActivity(
    'Room Shift',
    `${t.name}: Room #${fromRoom?.number||'?'} → Room #${toRoom.number}` + (reason ? ` · ${reason}` : ''),
    'Students'
  );

  saveDB();
  closeModal();
  renderPage('students');
  toast(`${t.name} shifted to Room #${toRoom.number} successfully`, 'success');
}
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// PAYMENTS
// ════════════════════════════════════════════════════════════════════════════
let payFilter = {status:'All', method:'All', search:'', showAll: false};
function renderPayments() {
  const mo = thisMonth();
  const moLabel = thisMonthLabel();

  let pays=DB.payments.filter(p=>{
    // Month filter — only show records for the selected calendar month unless showAll
    if(!payFilter.showAll) {
      if(!_payMatchesMonth(p, mo)) return false;
    }
    if(payFilter.status!=='All' && p.status!==payFilter.status) return false;
    if(payFilter.method!=='All' && p.method!==payFilter.method) return false;
    if(payFilter.search){const _ps=payFilter.search.toLowerCase();const _st4p=DB.students.find(s=>s.id===p.studentId);if(![p.studentName,String(p.roomNumber),p.month,p.method,p.status,_st4p?.fatherName,_st4p?.cnic,_st4p?.phone,_st4p?.email].some(f=>f&&String(f).toLowerCase().includes(_ps))) return false;}
    return true;
  }).sort((a,b)=>new Date(b.date)-new Date(a.date));

  const pmOpts=DB.settings.paymentMethods.map(m=>`<option value="${m}" ${payFilter.method===m?'selected':''}>${m}</option>`).join('');
  const total=pays.reduce((s,p)=>s+Number(p.amount),0);
  const paidAmt=DB.payments.filter(p=>p.status==='Paid').reduce((s,p)=>s+Number(p.amount),0);
  const unpaidAmt=DB.payments.filter(p=>p.status==='Pending').reduce((s,p)=>s+(p.unpaid!=null?Number(p.unpaid):Number(p.amount)),0);

  return `
  <div class="filter-bar">
    <div class="search-wrap">
      <svg class="search-icon" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <input class="form-control" id="search-payments" placeholder="Student name, room…" value="${escHtml(payFilter.search)}" oninput="capFirstChar(this);payFilter.search=this.value;_dPayments();toggleClearBtn('search-payments','clear-payments')">
      <button class="search-clear ${payFilter.search?'visible':''}" id="clear-payments" onclick="payFilter.search='';document.getElementById('search-payments').value='';this.classList.remove('visible');renderPage('payments')" title="Clear">✕</button>
    </div>
    <div class="filter-tabs">
      ${['All','Paid','Pending'].map(s=>`<button class="ftab ${payFilter.status===s?'active':''}" onclick="payFilter.status='${s}';renderPage('payments')">${s}</button>`).join('')}
    </div>
    <select class="form-control" style="width:160px" onchange="payFilter.method=this.value;renderPage('payments')">
      <option value="All">All Methods</option>${pmOpts}
    </select>
    <button class="btn btn-sm ${payFilter.showAll?'btn-primary':'btn-secondary'}" style="white-space:nowrap;font-size:11px" onclick="payFilter.showAll=!payFilter.showAll;renderPage('payments')" title="${payFilter.showAll?'Showing all months — click to filter by '+moLabel:'Showing '+moLabel+' only — click to show all'}">
      ${payFilter.showAll ? '📅 All Months' : '📅 '+moLabel}
    </button>
    <div style="margin-left:auto;display:flex;align-items:center;gap:12px">
      <span class="text-muted" style="font-size:12px">${pays.length} records · <span class="text-green fw-700">${fmtPKR(total)}</span></span>
      <button class="btn btn-secondary btn-sm" onclick="generateMonthlyRents()">⚡ Auto-Generate Month</button>
      <button class="btn btn-sm" onclick="showRentReminderModal()" style="background:#25d366;color:#fff;border:none" title="Send WhatsApp reminders to all with pending rent">&#x1F4F1; WhatsApp Reminders</button>
    </div>
  </div>
  <div class="table-wrap">
    <table style="border-collapse:collapse;width:100%">
      <thead><tr><th style="padding:8px 8px">Student</th><th style="padding:8px 8px">Room</th><th style="padding:8px 8px">Month</th><th style="padding:8px 8px">Rent/Mo</th><th style="padding:8px 6px;min-width:70px">Adm.Fee</th><th style="padding:8px 6px;min-width:90px">Extra Chrgs</th><th style="padding:8px 6px;min-width:80px">Concession</th><th style="padding:8px 8px">Amt Paid</th><th style="padding:8px 8px">Unpaid</th><th style="padding:8px 8px">Method</th><th style="padding:8px 8px">Status</th><th style="padding:8px 8px">Date</th><th style="padding:8px 8px;min-width:130px">Actions</th></tr></thead>
      <tbody>
        ${pays.length===0?'<tr><td colspan="12" style="text-align:center;color:var(--text3);padding:30px;border:none">No payment records found</td></tr>':
        pays.map(p=>{
          const _paf=Number(p.admissionFee||p.fee||0),_pex=(p.extraCharges||[]).filter(c=>Number(c.amount)>0),_pc=Number(p.concession||p.discount||0),_pcd=p.concessionDesc||p.discountDesc||'';
          return '<tr>'
          +'<td class="fw-700" style="cursor:pointer;white-space:nowrap;padding:8px 8px" onclick="showViewStudentModal(\''+p.studentId+'\'" title="Click to view student details"><span style="color:var(--blue)">'+escHtml(p.studentName||'')+'</span></td>'
          +'<td style="white-space:nowrap;padding:8px 8px"><span class="text-gold fw-700">#'+escHtml(String(p.roomNumber||''))+'</span></td>'
          +'<td class="text-muted" style="white-space:nowrap;padding:8px 8px">'+escHtml(p.month||'')+'</td>'
          +'<td class="text-muted fw-700" style="font-size:12px;padding:8px 8px">'+fmtPKR(p.monthlyRent||p.totalRent||p.amount)+'</td>'
          +'<td style="padding:8px 6px;vertical-align:middle">'+(_paf>0?'<span style="font-size:11px;font-weight:700;color:var(--blue)">'+fmtPKR(_paf)+'</span>':'<span style="color:var(--text3);font-size:10px">—</span>')+'</td>'
          +'<td style="padding:8px 6px;vertical-align:middle">'+(_pex.length?_pex.map(c=>'<div style="font-size:10px;font-weight:700;color:var(--amber)">'+(c.label?escHtml(c.label)+': ':'')+fmtPKR(c.amount)+'</div>').join(''):'<span style="color:var(--text3);font-size:10px">—</span>')+'</td>'
          +'<td style="padding:8px 6px;vertical-align:middle">'+(_pc>0?'<span style="font-size:11px;font-weight:700;color:var(--teal)">'+(_pcd?escHtml(_pcd)+': ':'')+'−'+fmtPKR(_pc)+'</span>':'<span style="color:var(--text3);font-size:10px">—</span>')+'</td>'
          +'<td class="text-green fw-700" style="padding:8px 8px">'+fmtPKR(p.amount)+'</td>'
          +'<td style="font-weight:700;color:'+((p.unpaid||0)>0?'var(--red)':'var(--green)')+';padding:8px 8px">'+fmtPKR(p.unpaid||0)+'</td>'
          +'<td style="padding:8px 8px">'+pmBadge(p.method)+'</td>'
          +'<td style="padding:8px 8px">'+statusBadge(p.status)+'</td>'
          +'<td style="padding:8px 8px;font-size:12px;color:var(--text3)">'+(fmtDate(p.date)||'—')+'</td>'
          +'<td style="padding:6px 4px;white-space:nowrap"><div style="display:flex;gap:2px;align-items:center;flex-wrap:nowrap">'
          +(p.status!=='Paid'?'<button class="btn btn-success btn-icon btn-sm" onclick="markPaymentPaid(\''+p.id+'\')" title="Mark Paid" style="font-size:11px;padding:3px 6px">✓ Paid</button>':'')
          +'<button class="btn btn-secondary btn-icon btn-sm" onclick="printReceipt(\''+p.id+'\')" title="Receipt" style="font-size:11px;padding:3px 6px">🧾</button>'
          +'<button class="btn btn-sm btn-icon" onclick="sendWA(\''+p.id+'\')" title="WhatsApp" style="background:#25d366;color:#fff;border:none;font-size:11px;padding:3px 6px">📱</button>'
          +'<button class="btn btn-secondary btn-icon btn-sm" onclick="showEditPaymentModal(\''+p.id+'\')" title="Edit" style="font-size:11px;padding:3px 6px">✏️</button>'
          +'<button class="btn btn-danger btn-icon btn-sm" onclick="deletePayment(\''+p.id+'\')" title="Delete" style="font-size:11px;padding:3px 6px">🗑</button>'
          +'</div></td>'
          +'</tr>';}).join('')}
      </tbody>
    </table>
  </div>`;
}

function generateMonthlyRents() {
  // FIX: use thisMonthLabel() — locale-safe, matches how all payment records store month strings.
  // Previously used toLocaleString('default',…) which can return different formats per device locale,
  // breaking the duplicate-guard check and generating duplicate entries on non-en-US systems.
  const mo=thisMonthLabel();
  const active=DB.students.filter(t=>t.status==='Active');
  let added=0;
  active.forEach(t=>{
    if(!DB.payments.some(p=>p.studentId===t.id&&_payMatchesMonth(p,thisMonth()))){
      const room=DB.rooms.find(r=>r.id===t.roomId);
      DB.payments.push({id:'p_'+uid(),collectedBy:CUR_USER?CUR_USER.name:'Auto',studentId:t.id,studentName:t.name,roomId:t.roomId,roomNumber:room?.number||'',amount:0,monthlyRent:t.rent,totalRent:t.rent,unpaid:t.rent,method:t.paymentMethod||'Cash',month:mo,date:today(),dueDate:'',status:'Pending',notes:'Auto-generated',paidDate:''});
      added++;
    }
  });
  saveDB(); renderPage('payments');
  toast(added>0?`Generated ${added} payment records`:'All students already have records for this month', added>0?'success':'info');
}
function markPaymentPaid(id) {
  const p = DB.payments.find(x => x.id === id); if (!p) return;
  const prevUnpaid = Number(p.unpaid) || 0;
  const prevPaid   = Number(p.amount) || 0;
  p.amount   = prevPaid + prevUnpaid;
  p.unpaid   = 0;
  p.discount = p.discount || 0;
  p.status   = 'Paid';
  p.paidDate = today();
  const collectionNote = prevUnpaid > 0 ? `Remaining ${fmtPKR(prevUnpaid)} collected on ${today()}` : '';
  if (collectionNote) p.notes = p.notes ? p.notes + ' | ' + collectionNote : collectionNote;
  // Log installment in partialPayments history
  if (!p.partialPayments) p.partialPayments = [];
  if (prevUnpaid > 0) {
    p.partialPayments.push({
      date: today(),
      amount: prevUnpaid,
      method: p.method || 'Cash',
      collectedBy: (typeof CUR_USER !== 'undefined' && CUR_USER && CUR_USER.name) ? CUR_USER.name : 'Warden',
      note: 'Pending cleared'
    });
  }
  saveDB();
  renderPage(currentPage);
  toast('Payment marked as paid — ' + fmtPKR(p.amount) + ' total collected', 'success');
}

// FIX Issue 3: Called from student modal — refreshes the student modal directly
// instead of calling renderPage (which fights with the modal re-open)
function markPaymentPaidFromStudentView(payId, studentId) {
  const p = DB.payments.find(x => x.id === payId); if (!p) return;
  const prevUnpaid = Number(p.unpaid) || 0;
  const prevPaid   = Number(p.amount) || 0;
  p.amount   = prevPaid + prevUnpaid;
  p.unpaid   = 0;
  p.discount = p.discount || 0;
  p.status   = 'Paid';
  p.paidDate = today();
  const collectionNote = prevUnpaid > 0 ? `Remaining ${fmtPKR(prevUnpaid)} collected on ${today()}` : '';
  if (collectionNote) p.notes = p.notes ? p.notes + ' | ' + collectionNote : collectionNote;
  if (!p.partialPayments) p.partialPayments = [];
  if (prevUnpaid > 0) {
    p.partialPayments.push({
      date: today(), amount: prevUnpaid,
      method: p.method || 'Cash',
      collectedBy: (typeof CUR_USER !== 'undefined' && CUR_USER && CUR_USER.name) ? CUR_USER.name : 'Warden',
      note: 'Pending cleared'
    });
  }
  saveDB();
  toast('Payment marked as paid — ' + fmtPKR(p.amount) + ' total collected', 'success');
  showViewStudentModal(studentId); // FIX: refresh student modal directly, no renderPage conflict
}
function deletePayment(id) {
  showConfirm('Delete payment record?','This cannot be undone.',()=>{
    DB.payments=DB.payments.filter(x=>x.id!==id);
    saveDB(); renderPage('payments'); toast('Payment deleted','info');
  });
}
function deletePaymentFromStudentView(payId, studentId) {
  showConfirm('Delete this payment record?','This will remove it from the student\'s financial history permanently.',()=>{
    DB.payments=DB.payments.filter(x=>x.id!==payId);
    saveDB();
    toast('Payment record deleted','info');
    showViewStudentModal(studentId); // refresh the modal
  });
}

// ════════════════════════════════════════════════════════════════════════════
// STUDENT SEARCH FOR PAYMENT MODAL
// ════════════════════════════════════════════════════════════════════════════
function filterStudentDropdown(query) {
  const results = document.getElementById('student-search-results');
  if (!query.trim()) { results.style.display='none'; return; }
  const q = query.toLowerCase();
  const matches = DB.students.filter(t => {
    if (t.status !== 'Active') return false;
    const room = DB.rooms.find(r => r.id === t.roomId);
    return t.name?.toLowerCase().includes(q) ||
           t.id?.toLowerCase().includes(q) ||
           String(room?.number||'').includes(q) ||
           t.cnic?.includes(q) ||
           t.phone?.includes(q);
  }).slice(0, 10);
  if (!matches.length) {
    results.innerHTML = `<div style="padding:12px 14px;color:var(--text3);font-size:13px;border-bottom:1px solid var(--border)">No registered student found</div>
      <div onclick="useManualNameEntry('${escHtml(query).replace(/'/g,"\\'")}');" style="padding:12px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;color:var(--blue);font-size:13px;font-weight:600;transition:background 0.15s" onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
        <span style="font-size:18px">✍️</span>
        <span>Use "<strong>${escHtml(query)}</strong>" as manual name</span>
      </div>`;
    results.style.display = 'block';
    return;
  }
  results.innerHTML = matches.map(t => {
    const room = DB.rooms.find(r => r.id === t.roomId);
    const rtype = room ? DB.settings.roomTypes.find(x => x.id === room.typeId) : null;
    return `<div onclick="selectStudentForPayment('${t.id}')" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);transition:background 0.15s" onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:32px;height:32px;border-radius:8px;background:var(--gold-dim);color:var(--gold2);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex-shrink:0">${t.name[0].toUpperCase()}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;color:var(--text);font-size:13px">${escHtml(t.name)}</div>
          <div style="font-size:11px;color:var(--text3)">Room #${room?.number||'?'} · ${rtype?.name||''} · ${escHtml(t.phone||'No phone')}</div>
        </div>
        <div style="font-size:12px;font-weight:700;color:var(--green)">${fmtPKR(t.rent)}</div>
      </div>
    </div>`;
  }).join('');
  results.style.display = 'block';
  // Auto-select if there is exactly one match
  if(matches.length===1 && (query.length>4)) selectStudentForPayment(matches[0].id);
}

function useManualNameEntry(name) {
  document.getElementById('f-pstudent').value = '__manual__';
  document.getElementById('f-pstudent-search').value = name;
  document.getElementById('student-search-results').style.display = 'none';
  const info = document.getElementById('selected-student-info');
  info.style.display = 'block';
  info.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:4px 0">
    <span style="font-size:18px">✍️</span>
    <div>
      <div style="font-size:13px;font-weight:700;color:var(--amber)">Manual entry: <strong>${escHtml(name)}</strong></div>
      <div style="font-size:11px;color:var(--text3)">Not linked to a registered student — fill in amounts manually below.</div>
    </div>
  </div>`;
}

function selectStudentForPayment(studentId) {
  const t = DB.students.find(x => x.id === studentId);
  if (!t) return;
  const room = DB.rooms.find(r => r.id === t.roomId);
  const rtype = room ? DB.settings.roomTypes.find(x => x.id === room.typeId) : null;
  // BUG FIX: Derive the most current rent. t.rent is updated by settings changes.
  // Additionally fall back to rtype.defaultRent so even edge-cases (e.g. _rentManuallySet
  // blocked a settings propagation) still show the latest room-type fee in the modal.
  const currentRent = t.rent || rtype?.defaultRent || 16000;
  document.getElementById('f-pstudent').value = studentId;
  document.getElementById('f-pstudent-search').value = t.name + ' — Room #' + (room?.number||'?');
  document.getElementById('student-search-results').style.display = 'none';
  if (document.getElementById('f-pamt')) { document.getElementById('f-pamt').value = currentRent; }
  if (document.getElementById('f-pconcession') && t.concession) {
    document.getElementById('f-pconcession').value = t.concession;
    if(t.concessionDesc && document.getElementById('f-pconcession-desc'))
      document.getElementById('f-pconcession-desc').value = t.concessionDesc;
  }
  recalcUnpaid();
  const info = document.getElementById('selected-student-info');
  info.style.display = 'block';
  info.innerHTML = `<div style="display:flex;gap:16px;flex-wrap:wrap">
    <div><span style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">Student ID</span><div style="font-weight:700;color:var(--text);font-family:var(--font-mono);font-size:12px">${escHtml(t.id)}</div></div>
    <div><span style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">Room</span><div style="font-weight:700;color:var(--gold2)">#${room?.number||'?'} · ${rtype?.name||''} · ${room?.floor||''} Floor</div></div>
    <div><span style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">Phone</span><div style="font-weight:600">${escHtml(t.phone||'—')}</div></div>
    <div><span style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">Monthly Rent</span><div style="font-weight:700;color:var(--green)">${fmtPKR(currentRent)}</div></div>
    <div><span style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">Address</span><div style="font-weight:600;color:var(--text2)">${escHtml(t.address || t.emergencyContact || 'No address on file')}</div></div>
  </div>`;
}

function recalcUnpaid() {
  const mr      = parseFloat(document.getElementById('f-pamt')?.value)||0;
  const extra   = getExtraChargesTotal();
  const admFee  = parseFloat(document.getElementById('f-padmfee')?.value)||0;
  const conc    = parseFloat(document.getElementById('f-pconcession')?.value)||0;
  const total   = Math.max(0, mr + extra + admFee - conc);
  // Cap paid amount — prevent accidental overpayment (e.g. 1600000 instead of 16000)
  const paidEl  = document.getElementById('f-ppaid');
  let pa = parseFloat(paidEl?.value)||0;
  if(pa > total && total > 0) {
    pa = total;
    if(paidEl) { paidEl.value = total; paidEl.style.border = '2px solid var(--amber)'; paidEl.title = 'Capped to total due: ' + total; }
    const capWarn = document.getElementById('f-ppaid-cap-warn');
    if(!capWarn && paidEl) {
      const w = document.createElement('div');
      w.id = 'f-ppaid-cap-warn';
      w.style.cssText = 'font-size:11px;color:var(--amber);margin-top:3px;font-weight:600';
      w.textContent = '⚠️ Amount capped to total due (' + Number(total).toLocaleString('en-PK') + ' PKR). Check for typos.';
      paidEl.parentNode.appendChild(w);
    }
  } else {
    if(paidEl) { paidEl.style.border = ''; paidEl.title = ''; }
    const capWarn = document.getElementById('f-ppaid-cap-warn');
    if(capWarn) capWarn.remove();
  }
  const u = Math.max(0, total - pa);
  const el = document.getElementById('f-punpaid');
  if(el){ el.value=u; el.style.color=u>0?'var(--red)':u===0?'var(--green)':'var(--amber)'; }
  const st = document.getElementById('f-pstat');
  if(st) st.value = (pa >= total && total > 0) ? 'Paid' : 'Pending';
  const etEl = document.getElementById('extra-charges-total');
  if(etEl) etEl.textContent = 'PKR ' + Number(extra).toLocaleString('en-PK');
}

function getExtraChargesTotal() {
  let total = 0;
  document.querySelectorAll('.extra-charge-amt-input').forEach(inp=>{
    total += parseFloat(inp.value)||0;
  });
  return total;
}

function getExtraChargesData() {
  const items = [];
  const rows = document.querySelectorAll('.extra-charge-row');
  rows.forEach(row=>{
    const desc = row.querySelector('.extra-charge-desc-input')?.value?.trim() || '';
    const amt  = parseFloat(row.querySelector('.extra-charge-amt-input')?.value)||0;
    if(amt>0) items.push({label: desc||'Extra Charge', description: desc, amount: amt});
  });
  return items;
}

function addExtraChargeRow(descOrLabel='', amount='') {
  const list = document.getElementById('extra-charges-list');
  if(!list) return;
  const rowId = 'ecr_' + Date.now();
  const div = document.createElement('div');
  div.className = 'extra-charge-row';
  div.id = rowId;
  div.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:6px';
  div.innerHTML = `
    <input class="form-control extra-charge-amt-input charge-amt" type="number" placeholder="Amount (PKR)" value="${amount}" min="0" style="width:120px;flex-shrink:0" oninput="recalcUnpaid()">
    <input class="form-control extra-charge-desc-input" type="text" placeholder="Description (e.g. Cooler Fee)" value="${escHtml(descOrLabel)}" style="flex:1" oninput="recalcUnpaid()">
    <button type="button" class="rm-btn" onclick="document.getElementById('${rowId}').remove();recalcUnpaid()" title="Remove" style="flex-shrink:0">✕</button>
  `;
  list.appendChild(div);
  recalcUnpaid();
}

function showAddPaymentForStudent(studentId) {
  const t = DB.students.find(s => s.id === studentId);
  if (!t) return;
  const room = DB.rooms.find(r => r.id === t.roomId);
  const pmOpts = DB.settings.paymentMethods.map(m => `<option ${m===t.paymentMethod?'selected':''}>${m}</option>`).join('');
  showModal('modal-md', `💳 Add Payment — ${escHtml(t.name)}`, `
    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:16px;display:flex;align-items:center;gap:12px">
      <div style="width:36px;height:36px;border-radius:9px;background:rgba(46,201,138,0.12);display:flex;align-items:center;justify-content:center;font-size:18px">👤</div>
      <div>
        <div style="font-size:13px;font-weight:700;color:var(--text)">${escHtml(t.name)}</div>
        <div style="font-size:11px;color:var(--text3)">Room #${room ? room.number : '—'} · ${room ? getRoomType(room).name : '—'} · ${escHtml(t.phone || '—')}</div>
      </div>
      <div style="margin-left:auto;text-align:right">
        <div style="font-size:13px;font-weight:800;color:var(--green)">${fmtPKR(t.rent)}</div>
        <div style="font-size:10px;color:var(--text3)">Monthly Rent</div>
      </div>
    </div>
    <input type="hidden" id="f-ps-studentId" value="${t.id}">
    <div class="form-grid">
      <div class="field"><label>Monthly Rent (PKR) *</label><input class="form-control" id="f-ps-amt" type="number" value="${t.rent||16000}" oninput="recalcUnpaidPS()"></div>
      <div class="field"><label>Amount Paid (PKR)</label><input class="form-control" id="f-ps-paid" type="number" placeholder="Enter amount paid" value="" oninput="recalcUnpaidPS()"></div>
      <!-- Concession + Extra Charges -->
      <div class="field col-full" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start">
        <div style="display:flex;flex-direction:column;gap:8px">
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--text2);display:block;margin-bottom:5px">Concession / Discount (PKR)</label>
            <input class="form-control" id="f-ps-concession" type="number" placeholder="0" min="0" value="" oninput="recalcUnpaidPS()">
          </div>
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--text2);display:block;margin-bottom:5px">Concession Description <span style="font-size:10px;color:var(--text3);font-weight:400">(optional)</span></label>
            <input class="form-control" id="f-ps-concession-desc" placeholder="e.g. Scholarship, Hardship…">
          </div>
        </div>
        <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:10px 12px">
          <label style="display:flex;align-items:center;justify-content:space-between;font-size:11px;font-weight:600;color:var(--text2);margin-bottom:8px">
            <span>➕ Extra Charges</span>
            <button type="button" class="btn btn-secondary btn-sm" style="font-size:11px;padding:3px 9px" onclick="addExtraChargeRow()">+ Add</button>
          </label>
          <div id="extra-charges-list"></div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;padding:6px 8px;background:var(--bg4);border:1px solid var(--border);border-radius:6px;font-size:12px">
            <span style="color:var(--text3)">Total Extra:</span>
            <span id="extra-charges-total" style="font-weight:800;color:var(--amber)">PKR 0</span>
          </div>
        </div>
      </div>
      <div class="field"><label>Unpaid / Remaining (PKR)</label><input class="form-control" id="f-ps-unpaid" type="number" value="${t.rent||16000}" readonly style="color:var(--red);font-weight:700;background:var(--bg3)" title="Auto-calculated: Rent + Extra − Concession − Paid"></div>
      <div class="field"><label>Payment Method</label><select class="form-control" id="f-ps-method">${pmOpts}</select></div>
      <div class="field"><label>Month</label><input class="form-control" id="f-ps-month" value="${thisMonthLabel()}"></div>
      <div class="field"><label>Status</label>
        <select class="form-control" id="f-ps-stat">
          <option value="Paid">✓ Paid</option>
          <option value="Pending" selected>⏳ Unpaid / Pending</option>
        </select>
      </div>
      <div class="field"><label>Payment Date</label><input class="form-control cdp-trigger" id="f-ps-date" type="text" readonly onclick="showCustomDatePicker(this,event)" value="${today()}"></div>
      <div class="field"><label>Due Date</label><input class="form-control cdp-trigger" id="f-ps-due" type="text" readonly onclick="showCustomDatePicker(this,event)" value="${(()=>{const d=new Date();d.setDate(6);return d.toISOString().split('T')[0];})()}"></div>
      <div class="field col-full"><label>Notes</label><input class="form-control" id="f-ps-notes" placeholder="Optional notes…"></div>
    </div>`,
  `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-warning" onclick="printAndSubmitPaymentForStudent()" style="background:linear-gradient(135deg,#e6a817,#f0c040);color:#1a1200;border:none;font-weight:700"><span class="micon" style="font-size:15px;vertical-align:middle">print</span> Print & Add Payment</button><button class="btn btn-primary" onclick="submitPaymentForStudent()"><span class=\"micon\" style=\"font-size:15px\">payments</span> Add Payment</button>`);
  // Auto-fill from existing pending payment for current month; warn if already fully paid
  const curMonthLabel = thisMonthLabel();
  const existingPaid    = DB.payments.find(p=>p.studentId===t.id&&p.status==='Paid'&&p.month===curMonthLabel);
  const existingPending = DB.payments.find(p=>p.studentId===t.id&&p.status==='Pending'&&p.month===curMonthLabel);
  // Inject already-paid warning banner at the top of the modal body
  if (existingPaid) {
    const mb = document.querySelector('#modal-container .modal-body');
    if (mb) {
      const banner = document.createElement('div');
      banner.style.cssText = 'background:rgba(224,82,82,0.12);border:1.5px solid rgba(224,82,82,0.5);border-radius:10px;padding:11px 14px;margin-bottom:14px;display:flex;align-items:center;gap:10px';
      banner.innerHTML = '<span style="font-size:18px">⚠️</span><div><div style="font-weight:800;color:var(--red);font-size:13px">Already Paid for '+escHtml(curMonthLabel)+'</div><div style="font-size:11px;color:var(--text2);margin-top:2px">'+escHtml(t.name)+' has already paid <strong>'+fmtPKR(existingPaid.amount)+'</strong> (Collected by: '+(existingPaid.collectedBy||'—')+'). Adding another payment will create a duplicate record.</div></div>';
      mb.insertBefore(banner, mb.firstChild);
    }
  }
  if (existingPending) {
    const rentEl  = document.getElementById('f-ps-amt');
    const paidEl  = document.getElementById('f-ps-paid');
    const unpaidEl= document.getElementById('f-ps-unpaid');
    const statEl  = document.getElementById('f-ps-stat');
    const notesEl = document.getElementById('f-ps-notes');
    // BUG FIX: Always use the student's CURRENT rent (t.rent) as the authoritative value.
    // existingPending.monthlyRent may be stale if the warden updated fees in Settings after
    // this pending record was created. t.rent is always kept in sync by updateRoomType/applyRent.
    const currentRentPS = t.rent || existingPending.monthlyRent || existingPending.amount || 16000;
    if (rentEl)   rentEl.value   = currentRentPS;
    if (paidEl)   paidEl.value   = existingPending.amount || 0;
    if (unpaidEl) unpaidEl.value = existingPending.unpaid != null ? existingPending.unpaid : (currentRentPS - (existingPending.amount||0));
    if (statEl)   statEl.value   = existingPending.status;
    if (notesEl)  notesEl.value  = existingPending.notes || '';
    toast('Loaded existing pending payment data', 'info');
  }
}
function recalcUnpaidPS() {
  const rent  = parseFloat(document.getElementById('f-ps-amt')?.value) || 0;
  const paid  = parseFloat(document.getElementById('f-ps-paid')?.value) || 0;
  const conc  = parseFloat(document.getElementById('f-ps-concession')?.value) || 0;
  var extra = 0;
  document.querySelectorAll('#extra-charges-list .extra-charge-amt-input').forEach(function(el){ extra += parseFloat(el.value)||0; });
  var etEl = document.getElementById('extra-charges-total');
  if(etEl) etEl.textContent = 'PKR ' + extra.toLocaleString('en-PK');
  const unpaid = Math.max(0, rent + extra - conc - paid);
  const unpaidEl = document.getElementById('f-ps-unpaid');
  if(unpaidEl) { unpaidEl.value = unpaid; unpaidEl.style.color = unpaid > 0 ? 'var(--red)' : 'var(--green)'; }
}
function submitPaymentForStudent() {
  const studentId   = document.getElementById('f-ps-studentId')?.value || '';
  const t           = DB.students.find(s => s.id === studentId);
  if (!t) { toast('Student not found', 'error'); return; }
  // Duplicate guard: block double-charging for the same month
  const enteredMonth = document.getElementById('f-ps-month')?.value || '';

  // Case 1 — already fully Paid (hard block, offer override)
  const alreadyPaid = DB.payments.find(p => p.studentId === studentId && p.status === 'Paid' && p.month === enteredMonth);
  if (alreadyPaid && !window._forcePayPS) {
    window._forcePayPS = true;
    showConfirm(
      '⚠️ Already Paid',
      `${escHtml(t.name)} already has a <strong>Paid</strong> record for <strong>${escHtml(enteredMonth)}</strong> (${fmtPKR(alreadyPaid.amount)}).<br><br>Adding another entry will charge this student twice. Are you absolutely sure?`,
      function(){ submitPaymentForStudent(); window._forcePayPS = false; },
      function(){ window._forcePayPS = false; }
    );
    return;
  }

  // Case 2 — a Pending record already exists for this month
  // (common scenario: payment auto-created at admission is still Pending,
  // then warden accidentally opens Add Payment again for the same month)
  const alreadyPending = DB.payments.find(p => p.studentId === studentId && p.status === 'Pending' && p.month === enteredMonth);
  if (alreadyPending && !window._updatePendingPS) {
    window._updatePendingPS = true;
    const existingPaidAmt = Number(alreadyPending.amount || 0);
    const existingUnpaid  = Number(alreadyPending.unpaid != null ? alreadyPending.unpaid : (alreadyPending.monthlyRent - existingPaidAmt));
    showConfirm(
      '⚠️ Pending Record Already Exists',
      `${escHtml(t.name)} already has a <strong>Pending</strong> payment for <strong>${escHtml(enteredMonth)}</strong>.<br>`
      + `<div style="margin:10px 0;background:var(--bg3);border-radius:8px;padding:10px 12px;font-size:12px;line-height:1.8">`
      + `Existing → Paid: <strong>${fmtPKR(existingPaidAmt)}</strong> &nbsp;|&nbsp; Unpaid: <strong style="color:var(--red)">${fmtPKR(existingUnpaid)}</strong></div>`
      + `<strong>Update the existing record</strong> instead of creating a duplicate?<br><small style="color:var(--text3)">Click <em>OK</em> to update · <em>Cancel</em> to abort</small>`,
      function() {
        // ── UPDATE existing pending record in-place ──────────────────
        const newMonthlyRent = parseFloat(document.getElementById('f-ps-amt')?.value)  || alreadyPending.monthlyRent || 0;
        const newPaid        = parseFloat(document.getElementById('f-ps-paid')?.value) || 0;
        const newUnpaid      = Math.max(0, newMonthlyRent - newPaid);
        const newStatus      = document.getElementById('f-ps-stat')?.value  || 'Pending';
        const newMethod      = document.getElementById('f-ps-method')?.value || alreadyPending.method || 'Cash';
        const newDate        = document.getElementById('f-ps-date')?.value   || today();
        const newNotes       = document.getElementById('f-ps-notes')?.value  || '';

        alreadyPending.monthlyRent = newMonthlyRent;
        alreadyPending.totalRent   = newMonthlyRent;
        alreadyPending.amount      = newPaid;
        alreadyPending.unpaid      = newUnpaid;
        alreadyPending.method      = newMethod;
        alreadyPending.status      = newStatus;
        alreadyPending.date        = newDate;
        alreadyPending.paidDate    = newStatus === 'Paid' ? newDate : (alreadyPending.paidDate || '');
        alreadyPending.collectedBy = CUR_USER?.name || alreadyPending.collectedBy || '';
        if (newNotes) alreadyPending.notes = newNotes;

        logActivity('Payment Updated', `${t.name} — ${enteredMonth} (existing record updated, no duplicate created)`, 'Finance');
        saveDB(); closeModal(); renderPage(currentPage);
        toast(`Payment updated for ${t.name} — no duplicate created`, 'success');
        window._updatePendingPS = false;
      },
      function() { window._updatePendingPS = false; }
    );
    return;
  }
  window._forcePayPS  = false;
  window._updatePendingPS = false;
  const room        = DB.rooms.find(r => r.id === t.roomId);
  const monthlyRent = parseFloat(document.getElementById('f-ps-amt')?.value) || 0;
  const paidAmount  = parseFloat(document.getElementById('f-ps-paid')?.value) || 0;
  const concessionPS = parseFloat(document.getElementById('f-ps-concession')?.value) || 0;
  const concessionDescPS = (document.getElementById('f-ps-concession-desc')?.value || '').trim();
  const extraChargesPS = getExtraChargesData();
  const extraTotalPS   = extraChargesPS.reduce((s,c)=>s+c.amount,0);
  const totalDuePS  = Math.max(0, monthlyRent + extraTotalPS - concessionPS);
  const unpaid      = Math.max(0, totalDuePS - paidAmount);
  const status      = document.getElementById('f-ps-stat')?.value || 'Pending';
  // FIX 8a: persist rent change on student record
  if (monthlyRent > 0 && t.rent !== monthlyRent) { t.rent = monthlyRent; }
  const _newPayIdPS = 'p_' + uid();
  DB.payments.push({
    id: _newPayIdPS,
    collectedBy: CUR_USER?.name || '',
    studentId,
    studentName: t.name || '',
    roomId: t.roomId || '',
    roomNumber: room?.number || '',
    amount: paidAmount,
    monthlyRent, unpaid,
    extraCharges: extraChargesPS, extraTotal: extraTotalPS,
    concession: concessionPS, concessionDesc: concessionDescPS,
    discount: concessionPS,
    totalRent: monthlyRent,
    method: document.getElementById('f-ps-method')?.value || 'Cash',
    month: document.getElementById('f-ps-month')?.value || '',
    status,
    date: document.getElementById('f-ps-date')?.value || today(),
    dueDate: document.getElementById('f-ps-due')?.value || '',
    paidDate: status === 'Paid' ? document.getElementById('f-ps-date')?.value || today() : '',
    notes: document.getElementById('f-ps-notes')?.value || '',
  });
  saveDB(); closeModal();
  renderPage(currentPage);
  toast(`Payment recorded for ${t.name}`, 'success');
  logActivity('Payment Added', `${t.name} — ${document.getElementById('f-ps-month')?.value}`, 'Finance');
  if (window._printAfterSave) { window._printAfterSave = false; setTimeout(()=>printReceipt(_newPayIdPS), 350); }
}
function showAddPaymentModal() {
  const activeStudents=DB.students.filter(t=>t.status==='Active');
  const pmOpts=DB.settings.paymentMethods.map(m=>`<option>${m}</option>`).join('');

  // Summary stats for header
  const totalPaid=DB.payments.filter(p=>p.status==='Paid').reduce((s,p)=>s+Number(p.amount),0);
  const totalPending=DB.payments.filter(p=>p.status==='Pending').reduce((s,p)=>s+Number(p.amount),0);

  showModal('modal-md','Add Payment',`
    <div class="form-grid">
      <div class="field col-full"><label>Search Student *</label>
        <div style="position:relative;min-width:0">
          <div style="position:relative">
            <svg style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--text3);pointer-events:none" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input class="form-control" id="f-pstudent-search" style="padding-left:34px" placeholder="Type name, room# or phone to search…" oninput="filterStudentDropdown(this.value)" autocomplete="off">
          </div>
          <input type="hidden" id="f-pstudent" value="">
          <div id="student-search-results" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--card);border:1px solid var(--border2);border-radius:var(--radius-sm);z-index:300;max-height:220px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,0.4)"></div>
        </div>
        <div id="selected-student-info" style="display:none;margin-top:8px;background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px;font-size:13px"></div>
      </div>
      <div class="field"><label>Monthly Rent (PKR) *</label><input class="form-control" id="f-pamt" type="number" placeholder="Enter monthly rent" value="" oninput="recalcUnpaid()"></div>
      <div class="field"><label>Amount Paid (PKR)</label><input class="form-control" id="f-ppaid" type="number" placeholder="Enter amount paid" value="" oninput="recalcUnpaid()"></div>
      <div class="field"><label>Admission Fee (PKR)</label><input class="form-control" id="f-padmfee" type="number" placeholder="0" min="0" value="" oninput="recalcUnpaid()"></div>
      <!-- Concession + Extra Charges side by side -->
      <div class="field col-full" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start">
        <!-- LEFT: Concession PKR + Description stacked -->
        <div style="display:flex;flex-direction:column;gap:8px">
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--text2);display:block;margin-bottom:5px">Concession / Discount (PKR)</label>
            <input class="form-control" id="f-pconcession" type="number" placeholder="0" min="0" value="" oninput="recalcUnpaid()">
          </div>
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--text2);display:block;margin-bottom:5px">Concession Description <span style="font-size:10px;color:var(--text3);font-weight:400">(optional)</span></label>
            <input class="form-control" id="f-pconcession-desc" placeholder="e.g. Scholarship, Hardship, Early payment…">
          </div>
        </div>
        <!-- RIGHT: Extra Charges panel -->
        <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:10px 12px">
          <label style="display:flex;align-items:center;justify-content:space-between;font-size:11px;font-weight:600;color:var(--text2);margin-bottom:8px">
            <span>➕ Extra Charges / Add-ons</span>
            <button type="button" class="btn btn-secondary btn-sm" style="font-size:11px;padding:3px 9px" onclick="addExtraChargeRow()">+ Add</button>
          </label>
          <div id="extra-charges-list"></div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;padding:6px 8px;background:var(--bg4);border:1px solid var(--border);border-radius:6px;font-size:12px">
            <span style="color:var(--text3)">Total Extra:</span>
            <span id="extra-charges-total" style="font-weight:800;color:var(--amber)">PKR 0</span>
          </div>
        </div>
      </div>
      <div class="field"><label>Unpaid / Remaining (PKR)</label><input class="form-control" id="f-punpaid" type="number" value="0" readonly style="background:var(--bg3);font-weight:700;color:var(--red)" title="Auto-calculated: Rent + Admission Fee + Extra Charges − Concession − Paid"></div>
      <div class="field"><label>Payment Method</label><select class="form-control" id="f-pmethod">${pmOpts}</select></div>
      <div class="field"><label>Month</label><input class="form-control" id="f-pmonth" value="${thisMonthLabel()}"></div>
      <div class="field"><label>Status</label>
        <select class="form-control" id="f-pstat">
          <option value="Paid">✓ Paid</option>
          <option value="Pending" selected>⏳ Unpaid / Pending</option>
        </select>
      </div>
      <div class="field"><label>Payment Date</label><input class="form-control cdp-trigger" id="f-pdate" type="text" readonly onclick="showCustomDatePicker(this,event)" value="${today()}"></div>
      <div class="field"><label>Due Date</label><input class="form-control cdp-trigger" id="f-pdue" type="text" readonly onclick="showCustomDatePicker(this,event)" value="${(()=>{const d=new Date();d.setDate(6);return d.toISOString().split('T')[0];})()}"></div>
      <div class="field col-full"><label>Notes</label><input class="form-control" id="f-pnotes-main" placeholder="Optional notes…"></div>
    </div>`,
  `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-warning" onclick="printAndSubmitAddPayment()" style="background:linear-gradient(135deg,#e6a817,#f0c040);color:#1a1200;border:none;font-weight:700"><span class="micon" style="font-size:15px;vertical-align:middle">print</span> Print & Add Payment</button><button class="btn btn-primary" onclick="submitAddPayment()"><span class="micon" style="font-size:15px">payments</span> Add Payment</button>`);
}
function submitAddPayment() {
  // Try to auto-select if only one student matches the search text
  const searchEl = document.getElementById('f-pstudent-search');
  const hiddenEl = document.getElementById('f-pstudent');
  if(hiddenEl && !hiddenEl.value && searchEl && searchEl.value.trim()) {
    const q = searchEl.value.trim().toLowerCase();
    const matches = DB.students.filter(t => t.status==='Active' && (
      t.name?.toLowerCase().includes(q) || t.id?.toLowerCase().includes(q) ||
      String(DB.rooms.find(r=>r.id===t.roomId)?.number||'').includes(q) ||
      t.cnic?.includes(q) || t.phone?.includes(q)
    ));
    if(matches.length===1) selectStudentForPayment(matches[0].id);
  }
  const studentIdRaw = document.getElementById('f-pstudent')?.value || '';
  const manualName = searchEl?.value?.trim() || '';
  const isManual = studentIdRaw === '__manual__';
  if(!studentIdRaw) {
    toast('Please search and select a student or enter a name manually','error');
    document.getElementById('f-pstudent-search')?.focus();
    return;
  }
  // Duplicate guard: block double-charging for the same month
  if (!isManual && !window._forcePayAP) {
    const enteredMonth2 = document.getElementById('f-pmonth')?.value || '';
    const tName = DB.students.find(s=>s.id===studentIdRaw)?.name || 'This student';

    // Case 1 — already fully Paid for this month (HARD BLOCK — no override)
    const alreadyPaid2 = DB.payments.find(p => p.studentId === studentIdRaw && p.status === 'Paid' && p.month === enteredMonth2);
    if (alreadyPaid2) {
      window._forcePayAP = false;
      toast(escHtml(tName) + ' has ALREADY PAID for ' + escHtml(enteredMonth2) + ' (' + fmtPKR(alreadyPaid2.amount) + '). No duplicate allowed.', 'error');
      return;
    }

    // Case 2 — a Pending / partial payment already exists for this month
    // (happens when warden records a payment at admission and then accidentally
    // opens Add Payment again for the same student & month)
    const alreadyPending2 = DB.payments.find(p => p.studentId === studentIdRaw && p.status === 'Pending' && p.month === enteredMonth2);
    if (alreadyPending2 && !window._updatePendingAP) {
      window._updatePendingAP = true;
      // Build a friendly detail line showing what already exists
      const existingPaidAmt = Number(alreadyPending2.amount || 0);
      const existingUnpaid  = Number(alreadyPending2.unpaid  != null ? alreadyPending2.unpaid : (alreadyPending2.monthlyRent - existingPaidAmt));
      showConfirm(
        '⚠️ Pending Record Already Exists',
        `${escHtml(tName)} already has a <strong>Pending</strong> payment for <strong>${escHtml(enteredMonth2)}</strong>.<br>`
        + `<div style="margin:10px 0;background:var(--bg3);border-radius:8px;padding:10px 12px;font-size:12px;line-height:1.8">`
        + `Existing → Paid: <strong>${fmtPKR(existingPaidAmt)}</strong> &nbsp;|&nbsp; Unpaid: <strong style="color:var(--red)">${fmtPKR(existingUnpaid)}</strong></div>`
        + `<strong>Update the existing record</strong> instead of creating a duplicate?<br><small style="color:var(--text3)">Click <em>OK</em> to update · <em>Cancel</em> to abort</small>`,
        function() {
          // ── UPDATE existing pending record in-place ──────────────────
          const newMonthlyRent = parseFloat(document.getElementById('f-pamt')?.value)  || alreadyPending2.monthlyRent || 0;
          const newPaid        = parseFloat(document.getElementById('f-ppaid')?.value) || 0;
          const newExtraCharges= getExtraChargesData();
          const newExtraTotal  = newExtraCharges.reduce((s,c)=>s+c.amount,0);
          const newTotalDue    = newMonthlyRent + newExtraTotal;
          const newUnpaid      = Math.max(0, newTotalDue - newPaid);
          const newStatus      = document.getElementById('f-pstat')?.value || 'Pending';
          const newMethod      = document.getElementById('f-pmethod')?.value || alreadyPending2.method || 'Cash';
          const newDate        = document.getElementById('f-pdate')?.value  || today();
          const newNotes       = document.getElementById('f-pnotes-main')?.value || document.getElementById('f-pnotes')?.value || '';

          // Merge into the existing record
          alreadyPending2.monthlyRent  = newMonthlyRent;
          alreadyPending2.totalRent    = newMonthlyRent;
          alreadyPending2.amount       = newPaid;
          alreadyPending2.unpaid       = newUnpaid;
          alreadyPending2.extraCharges = newExtraCharges;
          alreadyPending2.extraTotal   = newExtraTotal;
          alreadyPending2.method       = newMethod;
          alreadyPending2.status       = newStatus;
          alreadyPending2.date         = newDate;
          alreadyPending2.paidDate     = newStatus === 'Paid' ? newDate : (alreadyPending2.paidDate || '');
          alreadyPending2.collectedBy  = CUR_USER?.name || alreadyPending2.collectedBy || '';
          if (newNotes) alreadyPending2.notes = newNotes;

          logActivity('Payment Updated', `${escHtml(tName)} — ${enteredMonth2} (existing record updated, no duplicate created)`, 'Finance');
          saveDB(); closeModal(); renderPage('payments');
          toast(`Payment updated for ${tName} — no duplicate created`, 'success');
          window._updatePendingAP = false;
        },
        function() { window._updatePendingAP = false; }
      );
      return;
    }
    window._updatePendingAP = false;
  }
  window._forcePayAP = false;
  const monthlyRent = parseFloat(document.getElementById('f-pamt')?.value)||0;
  const paidAmount  = parseFloat(document.getElementById('f-ppaid')?.value)||0;
  const extraCharges = getExtraChargesData();
  const extraTotal  = extraCharges.reduce((s,c)=>s+c.amount,0);
  const admissionFee  = parseFloat(document.getElementById('f-padmfee')?.value)||0;
  const concession    = parseFloat(document.getElementById('f-pconcession')?.value)||0;
  const concessionDesc= (document.getElementById('f-pconcession-desc')?.value||'').trim();
  const totalDue    = Math.max(0, monthlyRent + extraTotal + admissionFee - concession);
  const totalRent   = monthlyRent;                // display rent = base only
  const unpaid      = Math.max(0, totalDue - paidAmount);
  const status      = document.getElementById('f-pstat')?.value || 'Pending';
  const t    = isManual ? null : DB.students.find(x=>x.id===studentIdRaw);
  const room = t ? DB.rooms.find(r=>r.id===t?.roomId) : null;
  const finalName = isManual ? manualName : (t?.name||'');
  const _newPayId = 'p_'+uid();
  DB.payments.push({
    id: _newPayId,
    collectedBy: CUR_USER?.name || '',  // BUG FIX: guard against null CUR_USER
    studentId: isManual ? '' : studentIdRaw,
    studentName: finalName,
    roomId: t?.roomId||'',
    roomNumber: room?.number||'',
    amount: paidAmount,
    monthlyRent, unpaid,
    extraCharges, extraTotal,
    admissionFee, concession, concessionDesc,
    totalRent,
    method: document.getElementById('f-pmethod')?.value||'Cash',
    month: document.getElementById('f-pmonth')?.value||'',
    status,
    date: document.getElementById('f-pdate')?.value||today(),
    dueDate: document.getElementById('f-pdue')?.value||'',
    paidDate: status==='Paid'?document.getElementById('f-pdate')?.value||today():'',
    notes: document.getElementById('f-pnotes-main')?.value || document.getElementById('f-pnotes')?.value || '',
  });
  logActivity('Payment Added', `${finalName||'student'} — ${document.getElementById('f-pmonth')?.value||''}`, 'Finance');
  saveDB(); closeModal(); renderPage('payments');
  toast(`Payment recorded for ${finalName||'student'}`,'success');
  if (window._printAfterSave) { window._printAfterSave = false; setTimeout(()=>printReceipt(_newPayId), 350); }
}
function printAndSubmitAddPayment() {
  window._printAfterSave = true;
  submitAddPayment();
}
function printAndSubmitPaymentForStudent() {
  window._printAfterSave = true;
  submitPaymentForStudent();
}
function showEditPaymentModal(id) {
  const p = DB.payments.find(x=>x.id===id); if(!p) return;
  const t = DB.students.find(s=>s.id===p.studentId);
  const room = t ? DB.rooms.find(r=>r.id===t.roomId) : null;
  const rtype = room ? DB.settings.roomTypes.find(x=>x.id===room.typeId) : null;
  const pmOpts = DB.settings.paymentMethods.map(m=>`<option ${p.method===m?'selected':''}>${m}</option>`).join('');
  // BUG FIX: Use the student's CURRENT rent (t.rent) as the primary value.
  // p.monthlyRent is the rent at the time the payment was recorded and may be stale
  // if the warden has since updated fees in Settings. t.rent is always kept in sync.
  const monthlyRent  = t?.rent || p.monthlyRent || p.totalRent || 0;
  const paidAmount   = p.amount || 0;
  const admissionFee = p.admissionFee || p.fee || 0;
  const concession   = p.concession || p.discount || 0;
  const concessionDesc = p.concessionDesc || p.discountDesc || '';
  const unpaid = p.unpaid != null ? p.unpaid : Math.max(0, monthlyRent + admissionFee - concession - paidAmount);
  showModal('modal-lg', `✏️ Edit Payment — ${escHtml(p.studentName||'Student')}`, `
    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:16px;display:flex;align-items:center;gap:12px">
      <div style="width:38px;height:38px;border-radius:9px;background:var(--gold-dim);color:var(--gold2);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:16px;flex-shrink:0">${(p.studentName||'?')[0].toUpperCase()}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:14px;color:var(--text)">${escHtml(p.studentName||'—')}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:1px">Room <span style="color:var(--gold2);font-weight:700">#${room?.number||'?'}</span>${rtype?` · ${escHtml(rtype.name)}`:''}${t?.phone?` · ${escHtml(t.phone)}`:''}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:13px;font-weight:900;color:var(--green)">${fmtPKR(t?.rent||monthlyRent)}</div>
        <div style="font-size:9px;color:var(--text3)">Monthly Rent</div>
      </div>
    </div>
    <div class="form-grid">
      <div class="field"><label>Monthly Rent (PKR) *</label><input class="form-control" id="f-pamt" type="number" value="${monthlyRent}" oninput="recalcUnpaid()"></div>
      <div class="field"><label>Amount Paid (PKR)</label><input class="form-control" id="f-ppaid" type="number" value="${paidAmount||''}" oninput="recalcUnpaid()"></div>
      <div class="field"><label>Admission Fee (PKR)</label><input class="form-control" id="f-padmfee" type="number" placeholder="0" min="0" value="${admissionFee||0}" oninput="recalcUnpaid()"></div>
      <!-- Concession + Extra Charges side by side -->
      <div class="field col-full" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start">
        <!-- LEFT: Concession PKR + Description stacked -->
        <div style="display:flex;flex-direction:column;gap:8px">
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--text2);display:block;margin-bottom:5px">Concession / Discount (PKR)</label>
            <input class="form-control" id="f-pconcession" type="number" placeholder="0" min="0" value="${concession||0}" oninput="recalcUnpaid()">
          </div>
          <div>
            <label style="font-size:11px;font-weight:600;color:var(--text2);display:block;margin-bottom:5px">Concession Description <span style="font-size:10px;color:var(--text3);font-weight:400">(optional)</span></label>
            <input class="form-control" id="f-pconcession-desc" placeholder="e.g. Scholarship, Hardship…" value="${escHtml(concessionDesc)}">
          </div>
        </div>
        <!-- RIGHT: Extra Charges panel -->
        <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:10px 12px">
          <label style="display:flex;align-items:center;justify-content:space-between;font-size:11px;font-weight:600;color:var(--text2);margin-bottom:8px">
            <span>➕ Extra Charges</span>
            <button type="button" class="btn btn-secondary btn-sm" style="font-size:11px;padding:3px 9px" onclick="addExtraChargeRow()">+ Add</button>
          </label>
          <div id="extra-charges-list"></div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;padding:6px 8px;background:var(--bg4);border:1px solid var(--border);border-radius:6px;font-size:12px">
            <span style="color:var(--text3)">Total Extra:</span>
            <span id="extra-charges-total" style="font-weight:800;color:var(--amber)">PKR ${Number(p.extraTotal||0).toLocaleString('en-PK')}</span>
          </div>
        </div>
      </div>
      <div class="field"><label>Unpaid / Remaining (PKR)</label><input class="form-control" id="f-punpaid" type="number" value="${unpaid||0}" readonly style="color:${unpaid>0?'var(--red)':'var(--green)'};font-weight:700;background:var(--bg3)"></div>
      <div class="field"><label>Status</label>
        <select class="form-control" id="f-pstat">
          <option value="Paid" ${unpaid===0&&monthlyRent>0?'selected':''}>✓ Paid</option>
          <option value="Pending" ${unpaid>0||!monthlyRent?'selected':''}>⏳ Unpaid / Pending</option>
        </select>
      </div>
      <div class="field"><label>Payment Method</label><select class="form-control" id="f-pmethod">${pmOpts}</select></div>
      <div class="field"><label>Month</label><input class="form-control" id="f-pmonth" value="${escHtml(p.month||'')}"></div>
      <div class="field"><label>Payment Date</label><input class="form-control cdp-trigger" id="f-pdate" type="text" readonly onclick="showCustomDatePicker(this,event)" value="${p.date||''}"></div>
      <div class="field"><label>Due Date</label><input class="form-control cdp-trigger" id="f-pdue" type="text" readonly onclick="showCustomDatePicker(this,event)" value="${p.dueDate||''}"></div>
      <div class="field col-full"><label>Notes</label><textarea class="form-control" id="f-pnotes" rows="2">${escHtml(p.notes||'')}</textarea></div>
    </div>`,
  `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
   <button class="btn btn-danger btn-sm" onclick="deletePayment('${id}')">🗑 Delete</button>
   <button class="btn btn-primary" onclick="submitEditPayment('${id}')">💾 Save Changes</button>`);
  setTimeout(function() {
    const ecl = document.getElementById('extra-charges-list');
    if(ecl && p.extraCharges && p.extraCharges.length) {
      ecl.innerHTML = '';
      p.extraCharges.forEach(c => addExtraChargeRow(c.description||c.desc||c.label||'', c.amount));
    }
    recalcUnpaid();
  }, 50);
}
function submitEditPayment(id) {
  const p = DB.payments.find(x=>x.id===id); if(!p) return;
  const monthlyRent  = parseFloat(document.getElementById('f-pamt')?.value)||0;
  const paidAmount   = parseFloat(document.getElementById('f-ppaid')?.value)||0;
  const admissionFee = parseFloat(document.getElementById('f-padmfee')?.value)||0;
  const concession   = parseFloat(document.getElementById('f-pconcession')?.value)||0;
  const concessionDesc = (document.getElementById('f-pconcession-desc')?.value||'').trim();
  const extraCharges = getExtraChargesData();
  const extraTotal   = extraCharges.reduce((s,c)=>s+c.amount, 0);
  const totalDue     = Math.max(0, monthlyRent + extraTotal + admissionFee - concession);
  const unpaid       = Math.max(0, totalDue - paidAmount);
  const prevPaid     = Number(p.amount) || 0;
  if (!p.partialPayments) p.partialPayments = [];
  if (paidAmount > prevPaid) {
    p.partialPayments.push({
      date: document.getElementById('f-pdate')?.value || today(),
      amount: paidAmount - prevPaid,
      method: document.getElementById('f-pmethod')?.value || 'Cash',
      collectedBy: (typeof CUR_USER !== 'undefined' && CUR_USER && CUR_USER.name) ? CUR_USER.name : 'Warden',
      note: 'Updated payment'
    });
  }
  p.monthlyRent    = monthlyRent;
  p.totalRent      = monthlyRent;
  p.amount         = paidAmount;
  p.admissionFee   = admissionFee;
  p.concession     = concession;
  p.concessionDesc = concessionDesc;
  p.discount       = concession;
  p.extraCharges   = extraCharges;
  p.extraTotal     = extraTotal;
  p.unpaid         = unpaid;
  p.method         = document.getElementById('f-pmethod')?.value || p.method;
  p.month          = document.getElementById('f-pmonth')?.value  || p.month;
  p.status         = document.getElementById('f-pstat')?.value   || p.status;
  p.date           = document.getElementById('f-pdate')?.value   || p.date;
  p.dueDate        = document.getElementById('f-pdue')?.value    || p.dueDate;
  p.paidDate       = p.status==='Paid' ? p.date : '';
  p.notes          = document.getElementById('f-pnotes')?.value  || '';
  // FIX 8a: If warden changed monthly rent, persist it on the student record
  // so all future auto-generated payments use the new rent.
  if (p.studentId) {
    const _st = DB.students.find(s => s.id === p.studentId);
    if (_st && monthlyRent > 0 && _st.rent !== monthlyRent) {
      _st.rent = monthlyRent;
    }
  }
  logActivity('Payment Updated', `${p.studentName||''} — ${p.month||''}`, 'Finance');
  saveDB();
  toast('Payment updated','success');
  if(_returnStudentId) {
    var _sid = _returnStudentId; _returnStudentId = null;
    showViewStudentModal(_sid);
  } else {
    closeModal(); renderPage('payments');
  }
}


// ════════════════════════════════════════════════════════════════════════════
// EXPENSES
// ════════════════════════════════════════════════════════════════════════════
let expFilter = {cat:'All', search:'', showAll: false};
function renderExpenses() {
  const mo = thisMonth();
  const moLabel = thisMonthLabel();

  let exps=DB.expenses.filter(e=>{
    // Month filter
    if(!expFilter.showAll && !(e.date||'').startsWith(mo)) return false;
    if(expFilter.cat!=='All' && e.category!==expFilter.cat) return false;
    if(expFilter.search && !e.description?.toLowerCase().includes(expFilter.search.toLowerCase()) && !e.category?.toLowerCase().includes(expFilter.search.toLowerCase())) return false;
    return true;
  }).sort((a,b)=>new Date(b.date)-new Date(a.date));

  const catOpts=DB.settings.expenseCategories.map(c=>`<option value="${c}" ${expFilter.cat===c?'selected':''}>${c}</option>`).join('');
  const total=exps.reduce((s,e)=>s+Number(e.amount),0);

  return `
  <div class="filter-bar">
    <div class="search-wrap">
      <svg class="search-icon" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <input class="form-control" id="search-expenses" placeholder="Search expenses…" value="${escHtml(expFilter.search)}" oninput="capFirstChar(this);expFilter.search=this.value;_dExpenses();toggleClearBtn('search-expenses','clear-expenses')">
      <button class="search-clear ${expFilter.search?'visible':''}" id="clear-expenses" onclick="expFilter.search='';document.getElementById('search-expenses').value='';this.classList.remove('visible');renderPage('expenses')" title="Clear">✕</button>
    </div>
    <select class="form-control" style="width:160px" onchange="expFilter.cat=this.value;renderPage('expenses')">
      <option value="All">All Categories</option>${catOpts}
    </select>
    <button class="btn btn-sm ${expFilter.showAll?'btn-primary':'btn-secondary'}" style="white-space:nowrap;font-size:11px" onclick="expFilter.showAll=!expFilter.showAll;renderPage('expenses')" title="${expFilter.showAll?'Showing all months — click to filter by '+moLabel:'Showing '+moLabel+' only — click to show all'}">
      ${expFilter.showAll ? '📅 All Months' : '📅 '+moLabel}
    </button>
    <span class="text-muted" style="font-size:12px;margin-left:auto">${exps.length} records · <span class="text-red fw-700">${fmtPKR(total)}</span></span>
  </div>
  <div class="table-wrap">
    <table style="border-collapse:collapse;width:100%">
      <thead><tr><th style="padding:8px 10px">Date</th><th style="padding:8px 10px">Category</th><th style="padding:8px 10px">Description</th><th style="padding:8px 10px">Amount</th><th style="padding:8px 10px">Actions</th></tr></thead>
      <tbody>
        ${exps.length===0?`<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:30px">No expenses found</td></tr>`:
        exps.map(e=>`<tr>
          <td class="text-muted" style="font-size:12px;padding:8px 10px">${fmtDate(e.date)}</td>
          <td style="padding:8px 10px"><span class="badge badge-amber">${escHtml(e.category)}</span></td>
          <td style="padding:8px 10px">${escHtml(e.description||'—')}</td>
          <td class="text-red fw-700" style="padding:8px 10px">${fmtPKR(e.amount)}</td>
          <td style="padding:8px 8px">
            <div style="display:flex;gap:4px">
              <button class="btn btn-secondary btn-icon btn-sm" onclick="showEditExpenseModal('${e.id}')">✏️</button>
              <button class="btn btn-danger btn-icon btn-sm" onclick="deleteExpense('${e.id}')">🗑</button>
            </div>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}
function showAddExpenseModal() {
  const catOpts=DB.settings.expenseCategories.map(c=>`<option>${c}</option>`).join('');
  showModal('modal-md','Add Expense',`
    <div class="form-grid">
      <div class="field"><label>Category *</label><select class="form-control" id="f-ecat">${catOpts}</select></div>
      <div class="field"><label>Amount (PKR) *</label><input class="form-control" id="f-eamt" type="number" placeholder="Enter amount"></div>
      <div class="field col-full"><label>Date</label><input class="form-control cdp-trigger" id="f-edate" type="text" readonly onclick="showCustomDatePicker(this,event)" value="${today()}"></div>
      <div class="field col-full"><label>Description</label><textarea class="form-control" id="f-edesc" placeholder="Expense details…"></textarea></div>
    </div>`,
  `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitAddExpense()">Add Expense</button>`);
}
function submitAddExpense() {
  const cat=document.getElementById('f-ecat').value;
  const amount=parseFloat(document.getElementById('f-eamt').value);
  if(!cat||!amount){toast('Fill required fields','error');return;}
  DB.expenses.push({id:'e_'+uid(),category:cat,amount,date:document.getElementById('f-edate').value,description:document.getElementById('f-edesc').value.trim()});
  logActivity('Expense Added', cat+' — PKR '+amount, 'Finance');
  saveDB(); closeModal(); renderPage('expenses'); toast('Expense recorded','success');
}
function showEditExpenseModal(id) {
  const e=DB.expenses.find(x=>x.id===id); if(!e) return;
  const catOpts=DB.settings.expenseCategories.map(c=>`<option ${e.category===c?'selected':''}>${c}</option>`).join('');
  showModal('modal-sm',`Edit Expense`,`
    <div class="form-grid">
      <div class="field"><label>Category</label><select class="form-control" id="f-ecat">${catOpts}</select></div>
      <div class="field"><label>Amount (PKR)</label><input class="form-control" id="f-eamt" type="number" value="${e.amount}"></div>
      <div class="field col-full"><label>Date</label><input class="form-control cdp-trigger" id="f-edate" type="text" readonly onclick="showCustomDatePicker(this,event)" value="${e.date||''}"></div>
      <div class="field col-full"><label>Description</label><textarea class="form-control" id="f-edesc">${escHtml(e.description||'')}</textarea></div>
    </div>`,
  `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="submitEditExpense('${id}')">Save</button>`);
}
function submitEditExpense(id) {
  const e=DB.expenses.find(x=>x.id===id); if(!e) return;
  e.category=document.getElementById('f-ecat').value;
  e.amount=parseFloat(document.getElementById('f-eamt').value)||e.amount;
  e.date=document.getElementById('f-edate').value;
  e.description=document.getElementById('f-edesc').value.trim();
  logActivity('Expense Updated', e.category+' — PKR '+e.amount, 'Finance');
  saveDB(); closeModal(); renderPage('expenses'); toast('Expense updated','success');
}
function deleteExpense(id) {
  showConfirm('Delete expense?','This cannot be undone.',()=>{
    const _del_e=DB.expenses.find(x=>x.id===id);
    DB.expenses=DB.expenses.filter(x=>x.id!==id);
    if(_del_e) logActivity('Expense Deleted', _del_e.category+' — PKR '+_del_e.amount, 'Finance');
    saveDB(); renderPage('expenses'); toast('Expense deleted','info');
  });
}

// ════════════════════════════════════════════════════════════════════════════
// CLEAR DATA FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════
function showClearAllMenu() {
  showModal('modal-md','🗑️ Clear Data',`
    <div style="background:var(--red-dim);border:1px solid rgba(224,82,82,0.35);border-radius:10px;padding:12px 16px;margin-bottom:18px;font-size:13px;color:var(--text2)">
      ⚠️ <strong style="color:var(--red)">Warning:</strong> This action is <strong>permanent and cannot be undone</strong>. Export a backup first!
    </div>
    <div style="display:flex;flex-direction:column;gap:10px">
      <div style="background:linear-gradient(135deg,rgba(224,82,82,0.12),rgba(224,82,82,0.06));border:1px solid rgba(224,82,82,0.4);border-radius:10px;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div>
          <div style="font-weight:800;color:var(--red);font-size:14px">☢️ Clear Everything</div>
          <div style="font-size:12px;color:var(--text3);margin-top:2px">Removes ALL students, payments, expenses &amp; cancellations</div>
        </div>
        <button class="btn btn-danger btn-sm" style="background:var(--red);color:#fff" onclick="clearAllDataWithPassword()">🔒 CLEAR ALL</button>
      </div>
    </div>
  `,`<button class="btn btn-secondary" onclick="closeModal()">Close</button>`);
}

function clearPayments(fromMenu=false) {
  const doIt = ()=>{
    DB.payments=[];
    saveDB();
    if(fromMenu){closeModal();}
    renderPage(currentPage==='payments'?'payments':currentPage);
    toast('All payment records cleared','info');
  };
  if(fromMenu) {
    showConfirm('Clear All Payments?',`This will permanently delete all ${DB.payments.length} payment records.`,doIt);
  } else {
    showConfirm('Clear All Payments?',`This will permanently delete all ${DB.payments.length} payment records. Cannot be undone!`,doIt);
  }
}

function clearExpenses(fromMenu=false) {
  const doIt = ()=>{
    DB.expenses=[];
    saveDB();
    if(fromMenu){closeModal();}
    renderPage(currentPage==='expenses'?'expenses':currentPage);
    toast('All expense records cleared','info');
  };
  if(fromMenu) {
    showConfirm('Clear All Expenses?',`This will permanently delete all ${DB.expenses.length} expense records.`,doIt);
  } else {
    showConfirm('Clear All Expenses?',`This will permanently delete all ${DB.expenses.length} expense records. Cannot be undone!`,doIt);
  }
}

function clearStudents(fromMenu=false) {
  const doIt = ()=>{
    DB.students=[];
    DB.payments=[];
    DB.cancellations=[];
    // FIX: DB.transfers are owner-level financial records, NOT student records.
    // Clearing students must NOT wipe owner transfer history.
    DB.fines=[];
    DB.checkinlog=[];
    saveDB();
    if(fromMenu){closeModal();}
    renderPage(currentPage==='students'?'students':currentPage);
    toast('All students and their records cleared','info');
  };
  if(fromMenu) {
    showConfirm('Clear All Students?',`This removes ALL ${DB.students.length} students, their payments, fines, check-in log and cancellations permanently. Owner transfers are preserved.`,doIt);
  } else {
    showConfirm('Clear All Students?',`This removes ALL ${DB.students.length} students, their payments, fines, check-in log and cancellations permanently. Owner transfers are preserved. Cannot be undone!`,doIt);
  }
}

function clearAllData(fromMenu=false) {
  const doIt = ()=>{
    DB.students=[];
    DB.payments=[];
    DB.expenses=[];
    DB.cancellations=[];
    DB.transfers=[];
    DB.maintenance=[];
    DB.complaints=[];
    DB.activityLog=[];
    DB.fines=[];
    DB.checkinlog=[];
    DB.notices=[];
    DB.inspections=[];
    DB.billSplits=[];
    saveDB();
    if(fromMenu){closeModal();}
    navigate('dashboard');
    toast('All data cleared successfully','info');
    renderSidebarCalendar();
  };
  showConfirm('☢️ Clear ALL Data?',
    `This will permanently delete ALL students (${DB.students.length}), payments (${DB.payments.length}), expenses (${DB.expenses.length}) and cancellations. This CANNOT be undone! Make sure you have a backup.`,
    doIt
  );
}

// ── PASSWORD-PROTECTED CLEAR ALL (Fix #11) ───────────────────────────────────
function clearAllDataWithPassword() {
  showModal('modal-sm','🔒 Confirm: Clear All Data',`
    <div style="background:rgba(224,82,82,0.1);border:1px solid rgba(224,82,82,0.3);border-radius:10px;padding:14px 16px;margin-bottom:16px">
      <div style="font-size:13px;font-weight:700;color:var(--red);margin-bottom:6px">⚠️ This action cannot be undone!</div>
      <div style="font-size:12px;color:var(--text3)">All students, payments, expenses and cancellations will be permanently deleted. Enter your warden password to proceed.</div>
    </div>
    <div class="field">
      <label>Warden Password</label>
      <input class="form-control" id="clear-all-pwd" type="password" placeholder="Enter your password…" autocomplete="off">
    </div>
    <div id="clear-pwd-err" style="color:var(--red);font-size:12px;margin-top:6px;display:none">❌ Incorrect password. Try again.</div>
  `,`<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
     <button class="btn btn-danger" onclick="confirmClearAllWithPassword()">Delete Everything</button>`);
  setTimeout(()=>{ const i=document.getElementById('clear-all-pwd'); if(i) i.focus(); },120);
}
function confirmClearAllWithPassword() {
  const pwd = document.getElementById('clear-all-pwd')?.value||'';
  const errEl = document.getElementById('clear-pwd-err');
  const user = CUR_USER || (DB.settings && DB.settings.wardens && DB.settings.wardens[0]);
  const storedPwd = user?.password || user?.pass || '';
  if (!pwd || (storedPwd && pwd !== storedPwd)) {
    if(errEl) errEl.style.display='block';
    const inp = document.getElementById('clear-all-pwd');
    if(inp) { inp.value=''; inp.focus(); }
    return;
  }
  closeModal();
  clearAllData(true);
}
// ─────────────────────────────────────────────────────────────────────────────

// ════════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════
let reportPeriod='month';
let reportDetail=null;
let studentReportFilter='All';

// ════════════════════════════════════════════════════════════════════════════
// REPORT DETAIL RENDERERS
// ════════════════════════════════════════════════════════════════════════════
function renderReportDetail(id, pays, exps, rev, pending, totalExp, net, occ) {
  const periodLabel = reportPeriod==='month' ? thisMonth() : thisYear();
  const csvBtn = (type, color) => `<button onclick="downloadDetailCSV('${type}')" style="background:${color};color:#fff;border:none;padding:5px 12px;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap">📥 CSV</button>`;
  const pdfBtn = `<button onclick="downloadReportDetailPDF('${id}')" style="background:var(--gold);color:#000;border:none;padding:5px 12px;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap">📄 PDF</button>`;

  // ── REVENUE ────────────────────────────────────────────────────────────────
  if (id === 'financial') {
    const paidOnly = pays.filter(p=>p.status==='Paid');
    return `<div class="card" style="margin-bottom:20px">
      <div class="card-header">
        <div class="card-title">💰 Revenue — Paid Transactions (${periodLabel})</div>
        <div style="display:flex;gap:8px;align-items:center">${csvBtn('financial','#16a34a')}${pdfBtn}</div>
      </div>
      <div class="two-col" style="margin-bottom:16px">
        <div style="background:var(--green-dim);border:1px solid rgba(46,201,138,0.3);border-radius:10px;padding:18px;text-align:center">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--green);font-weight:700;margin-bottom:6px">Total Revenue</div>
          <div style="font-size:30px;font-weight:900;color:var(--green)">${fmtPKR(rev)}</div>
          <div style="font-size:11px;color:var(--text3);margin-top:4px">${paidOnly.length} paid transactions</div>
        </div>
        <div style="background:var(--red-dim);border:1px solid rgba(224,82,82,0.3);border-radius:10px;padding:18px;text-align:center">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--red);font-weight:700;margin-bottom:6px">Total Expenses</div>
          <div style="font-size:30px;font-weight:900;color:var(--red)">${fmtPKR(totalExp)}</div>
          <div style="font-size:11px;color:var(--text3);margin-top:4px">${exps.length} expense entries</div>
        </div>
      </div>
      <div style="background:${net>=0?'var(--green-dim)':'var(--red-dim)'};border:1px solid ${net>=0?'rgba(46,201,138,0.3)':'rgba(224,82,82,0.3)'};border-radius:10px;padding:18px;text-align:center;margin-bottom:16px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:${net>=0?'var(--green)':'var(--red)'};font-weight:700;margin-bottom:6px">Available Fund</div>
        <div style="font-size:38px;font-weight:900;color:${net>=0?'var(--green)':'var(--red)'}">${fmtPKR(net)}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:6px">${fmtPKR(rev)} collected − ${fmtPKR(totalExp)} expenses</div>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Student</th><th>Room</th><th>Month</th><th>Amount Paid</th><th>Method</th><th>Date</th></tr></thead><tbody>
      ${paidOnly.sort((a,b)=>new Date(b.date)-new Date(a.date)).map(p=>`<tr style="cursor:pointer" onclick="showViewStudentModal('${p.studentId}')">
        <td class="fw-700" style="color:var(--blue)">${escHtml(p.studentName||'—')}</td>
        <td class="text-gold fw-700">#${p.roomNumber||'—'}</td>
        <td class="text-muted" style="font-size:12px">${escHtml(p.month||'—')}</td>
        <td class="text-green fw-700">${fmtPKR(p.amount)}</td>
        <td>${pmBadge(p.method)}</td>
        <td class="text-muted" style="font-size:12px">${fmtDate(p.date)}</td>
      </tr>`).join('')||'<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:20px">No paid transactions this period</td></tr>'}
      </tbody></table></div>
    </div>`;
  }

  // ── PENDING ────────────────────────────────────────────────────────────────
  if (id === 'pending') {
    const pendingPays = DB.payments.filter(p=>p.status==='Pending');
    const totalPend = pendingPays.reduce((s,p)=>s+(p.unpaid!=null?Number(p.unpaid):Number(p.amount)),0);
    return `<div class="card" style="margin-bottom:20px">
      <div class="card-header">
        <div class="card-title">⏳ Pending Payments — All Unpaid</div>
        <div style="display:flex;gap:8px;align-items:center">${csvBtn('pending','#d97706')}${pdfBtn}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px">
        <div style="background:var(--amber-dim);border:1px solid rgba(240,160,48,0.3);border-radius:10px;padding:16px;text-align:center">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--amber);font-weight:700">Total Outstanding</div>
          <div style="font-size:26px;font-weight:900;color:var(--amber)">${fmtPKR(totalPend)}</div>
        </div>
        <div style="background:var(--red-dim);border:1px solid rgba(224,82,82,0.3);border-radius:10px;padding:16px;text-align:center">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--red);font-weight:700">Records</div>
          <div style="font-size:26px;font-weight:900;color:var(--red)">${pendingPays.length}</div>
        </div>
        <div style="background:var(--blue-dim);border:1px solid rgba(74,156,240,0.3);border-radius:10px;padding:16px;text-align:center">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--blue);font-weight:700">Partially Paid</div>
          <div style="font-size:26px;font-weight:900;color:var(--blue)">${pendingPays.filter(p=>p.unpaid!=null&&Number(p.amount)>0).length}</div>
        </div>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Student</th><th>Room</th><th>Month</th><th>Partial Paid</th><th>Outstanding</th><th>Method</th><th>Date</th><th>Action</th></tr></thead><tbody>
      ${pendingPays.sort((a,b)=>new Date(b.date)-new Date(a.date)).map(p=>`<tr>
        <td class="fw-700" style="cursor:pointer;color:var(--blue)" onclick="showViewStudentModal('${p.studentId}')">${escHtml(p.studentName||'—')}</td>
        <td class="text-gold fw-700">#${p.roomNumber||'—'}</td>
        <td class="text-muted" style="font-size:12px">${escHtml(p.month||'—')}</td>
        <td class="${Number(p.amount)>0&&p.unpaid!=null?'text-green fw-700':'text-muted'}">${p.unpaid!=null?fmtPKR(p.amount):'—'}</td>
        <td class="text-red fw-700">${fmtPKR(p.unpaid!=null?p.unpaid:p.amount)}</td>
        <td>${pmBadge(p.method)}</td>
        <td class="text-muted" style="font-size:12px">${fmtDate(p.date)}</td>
        <td><button class="btn btn-success btn-sm" style="font-size:11px" onclick="markPaymentPaid('${p.id}');reportDetail='pending';renderPage('reports')">✓ Collect</button></td>
      </tr>`).join('')||'<tr><td colspan="8" style="text-align:center;color:var(--green);padding:20px">🎉 All rents collected!</td></tr>'}
      </tbody></table></div>
    </div>`;
  }

  // ── AVAILABLE FUND ─────────────────────────────────────────────────────────
  if (id === 'netprofit') {
    const allItems = [
      ...pays.filter(p=>p.status==='Paid').map(p=>({date:p.date,label:escHtml(p.studentName||'—'),desc:'Room #'+(p.roomNumber||'')+' · '+escHtml(p.month||''),amount:Number(p.amount),type:'income'})),
      ...exps.map(e=>({date:e.date,label:escHtml(e.category||'Expense'),desc:escHtml(e.description||'—'),amount:Number(e.amount),type:'expense'}))
    ].sort((a,b)=>new Date(b.date)-new Date(a.date));
    return `<div class="card" style="margin-bottom:20px">
      <div class="card-header">
        <div class="card-title">📊 Available Fund — ${periodLabel}</div>
        <div style="display:flex;gap:8px;align-items:center">${csvBtn('netprofit','#7c3aed')}${pdfBtn}</div>
      </div>
      <div style="background:${net>=0?'var(--green-dim)':'var(--red-dim)'};border:1px solid ${net>=0?'rgba(46,201,138,0.4)':'rgba(224,82,82,0.4)'};border-radius:12px;padding:22px;text-align:center;margin-bottom:16px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:${net>=0?'var(--green)':'var(--red)'};font-weight:700;margin-bottom:8px">Available Fund</div>
        <div style="font-size:44px;font-weight:900;color:${net>=0?'var(--green)':'var(--red)'};letter-spacing:-1px">${fmtPKR(net)}</div>
        <div style="font-size:12px;color:var(--text3);margin-top:6px">${fmtPKR(rev)} collected − ${fmtPKR(totalExp)} expenses</div>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Amount</th></tr></thead><tbody>
      ${allItems.map(item=>`<tr>
        <td class="text-muted" style="font-size:12px">${fmtDate(item.date)}</td>
        <td>${item.type==='income'?'<span class="badge badge-green">💰 Income</span>':'<span class="badge badge-red">📉 Expense</span>'}</td>
        <td><div style="font-weight:600">${item.label}</div><div style="font-size:11px;color:var(--text3)">${item.desc}</div></td>
        <td style="font-weight:700;color:${item.type==='income'?'var(--green)':'var(--red)'};">${item.type==='income'?'+':'−'}${fmtPKR(item.amount)}</td>
      </tr>`).join('')||'<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:20px">No transactions</td></tr>'}
      </tbody></table></div>
    </div>`;
  }

  // ── STUDENTS ───────────────────────────────────────────────────────────────
  if (id === 'students') {
    const badges = [
      {label:'All',       count:DB.students.length,                              color:'var(--blue)',  dim:'var(--blue-dim)',  border:'rgba(74,156,240,0.4)'},
      {label:'Active',    count:DB.students.filter(t=>t.status==='Active').length,  color:'var(--green)', dim:'var(--green-dim)', border:'rgba(46,201,138,0.4)'},
      {label:'Left',      count:DB.students.filter(t=>t.status==='Left').length,    color:'var(--amber)', dim:'var(--amber-dim)', border:'rgba(240,160,48,0.4)'},
      {label:'Blacklisted',count:DB.students.filter(t=>t.status==='Blacklisted').length,color:'var(--red)',dim:'var(--red-dim)',border:'rgba(224,82,82,0.4)'},
    ];
    const filtered = studentReportFilter==='All' ? DB.students : DB.students.filter(t=>t.status===studentReportFilter);
    return `<div class="card" style="margin-bottom:20px">
      <div class="card-header">
        <div class="card-title">👥 Student Report</div>
        <div style="display:flex;gap:8px;align-items:center">${csvBtn('students','#1d4ed8')}${pdfBtn}</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
        ${badges.map(b=>`<div onclick="studentReportFilter='${b.label}';renderPage('reports')" style="background:${studentReportFilter===b.label?b.dim:'var(--card)'};border:2px solid ${studentReportFilter===b.label?b.border:'var(--border)'};border-radius:10px;padding:14px;text-align:center;cursor:pointer;transition:var(--transition)" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:${b.color};font-weight:700">${b.label}</div>
          <div style="font-size:26px;font-weight:900;color:${b.color};margin:4px 0">${b.count}</div>
          <div style="font-size:9px;color:var(--text3)">${studentReportFilter===b.label?'▲ filtered':'click to filter'}</div>
        </div>`).join('')}
      </div>
      ${studentReportFilter!=='All'?`<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <span style="font-size:12px;color:var(--text3)">Showing <strong style="color:var(--text)">${studentReportFilter}</strong> (${filtered.length})</span>
        <button onclick="studentReportFilter='All';renderPage('reports')" class="btn btn-secondary btn-sm" style="font-size:11px">✕ Clear</button>
      </div>`:''}
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Father</th><th>Room</th><th>Join Date</th><th>Rent</th><th>Status</th><th>Phone</th></tr></thead><tbody>
      ${filtered.map(t=>{const r=DB.rooms.find(x=>x.id===t.roomId);return `<tr style="cursor:pointer" onclick="showViewStudentModal('${t.id}')">
        <td class="fw-700" style="color:var(--blue)">${escHtml(t.name)}</td>
        <td class="text-muted" style="font-size:12px">${escHtml(t.fatherName||'—')}</td>
        <td class="text-gold fw-700">${r?'#'+r.number:'—'}</td>
        <td class="text-muted" style="font-size:12px">${fmtDate(t.joinDate)}</td>
        <td class="text-green fw-700">${fmtPKR(t.rent)}</td>
        <td>${statusBadge(t.status)}</td>
        <td class="text-muted">${escHtml(t.phone||'—')}</td>
      </tr>`;}).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:20px">No students found</td></tr>'}
      </tbody></table></div>
    </div>`;
  }

  // ── ROOMS ──────────────────────────────────────────────────────────────────
  if (id === 'rooms') {
    return `<div class="card" style="margin-bottom:20px">
      <div class="card-header"><div class="card-title">🏠 Room Occupancy — Details</div>${pdfBtn}</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px">
        <div style="background:var(--green-dim);border:1px solid rgba(46,201,138,0.3);border-radius:10px;padding:16px;text-align:center"><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--green);font-weight:700">Occupied</div><div style="font-size:28px;font-weight:900;color:var(--green)">${occ}</div></div>
        <div style="background:var(--gold-dim);border:1px solid rgba(200,168,75,0.3);border-radius:10px;padding:16px;text-align:center"><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--gold2);font-weight:700">Vacant</div><div style="font-size:28px;font-weight:900;color:var(--gold2)">${DB.rooms.length-occ}</div></div>
        <div style="background:var(--blue-dim);border:1px solid rgba(74,156,240,0.3);border-radius:10px;padding:16px;text-align:center"><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--blue);font-weight:700">Total</div><div style="font-size:28px;font-weight:900;color:var(--blue)">${DB.rooms.length}</div></div>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Room</th><th>Type</th><th>Floor</th><th>Occupancy</th><th>Students</th><th>Status</th><th>Rent</th></tr></thead><tbody>
      ${DB.rooms.map(r=>{const type=getRoomType(r);const occ2=getRoomOccupancy(r);const sts=DB.students.filter(t=>t.roomId===r.id&&t.status==='Active');return `<tr style="cursor:pointer" onclick="showRoomDetail('${r.id}')"><td class="fw-700 text-gold">#${r.number}</td><td><span class="badge" style="background:${type.color}22;color:${type.color};border-color:${type.color}44">${escHtml(type.name)}</span></td><td class="text-muted">${r.floor} Floor</td><td class="text-muted">${occ2}/${type.capacity}</td><td style="font-size:12px">${sts.map(t=>escHtml(t.name)).join(', ')||'<span style="color:var(--text3)">Empty</span>'}</td><td><span class="badge ${occ2>0?'badge-green':'badge-gray'}">${occ2>0?'Occupied':'Vacant'}</span></td><td class="text-green fw-700">${fmtPKR(r.rent)}/mo</td></tr>`;}).join('')}
      </tbody></table></div>
    </div>`;
  }

  // ── EXPENSES ───────────────────────────────────────────────────────────────
  if (id === 'expenses') {
    return `<div class="card" style="margin-bottom:20px">
      <div class="card-header">
        <div class="card-title">📉 Expenses — ${periodLabel}</div>
        <div style="display:flex;align-items:center;gap:10px"><div style="font-size:18px;font-weight:900;color:var(--red)">${fmtPKR(totalExp)}</div>${csvBtn('expenses','#dc2626')}${pdfBtn}</div>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th></tr></thead><tbody>
      ${exps.sort((a,b)=>new Date(b.date)-new Date(a.date)).map(e=>`<tr>
        <td class="text-muted" style="font-size:12px">${fmtDate(e.date)}</td>
        <td><span class="badge badge-amber">${escHtml(e.category)}</span></td>
        <td>${escHtml(e.description||'—')}</td>
        <td class="text-red fw-700">${fmtPKR(e.amount)}</td>
      </tr>`).join('')||'<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:20px">No expenses this period</td></tr>'}
      </tbody></table></div>
    </div>`;
  }

  // ── PAYMENT METHODS ────────────────────────────────────────────────────────
  if (id === 'payments') {
    return `<div class="card" style="margin-bottom:20px">
      <div class="card-header"><div class="card-title">💳 Payment Methods — ${periodLabel}</div>${pdfBtn}</div>
      <div class="table-wrap"><table><thead><tr><th>Student</th><th>Room</th><th>Month</th><th>Amount Paid</th><th>Method</th><th>Status</th><th>Date</th></tr></thead><tbody>
      ${pays.filter(p=>p.status==='Paid').sort((a,b)=>new Date(b.date)-new Date(a.date)).map(p=>`<tr>
        <td class="fw-700">${escHtml(p.studentName||'—')}</td>
        <td class="text-gold fw-700">#${p.roomNumber||'—'}</td>
        <td class="text-muted">${escHtml(p.month||'—')}</td>
        <td class="text-green fw-700">${fmtPKR(p.amount)}</td>
        <td>${pmBadge(p.method)}</td>
        <td>${statusBadge(p.status)}</td>
        <td class="text-muted" style="font-size:12px">${fmtDate(p.date)}</td>
      </tr>`).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:20px">No paid transactions</td></tr>'}
      </tbody></table></div>
    </div>`;
  }

  // ── TRANSFERS ──────────────────────────────────────────────────────────────
  if (id === 'transfers') {
    const allTr = (DB.transfers||[]).slice().sort((a,b)=>new Date(b.date)-new Date(a.date));
    const totalTr = allTr.reduce((s,t)=>s+Number(t.amount),0);
    const cashTr  = allTr.filter(t=>t.method==='Cash').reduce((s,t)=>s+Number(t.amount),0);
    const bankTr  = allTr.filter(t=>t.method!=='Cash').reduce((s,t)=>s+Number(t.amount),0);
    const moKey   = periodLabel.slice(0,7);
    const moTr    = allTr.filter(t=>(t.date||'').startsWith(moKey));
    const moTotal = moTr.reduce((s,t)=>s+Number(t.amount),0);
    return `<div class="card" style="margin-bottom:20px">
      <div class="card-header">
        <div class="card-title">🏦 Transfers to Owner — All Records</div>
        <div style="display:flex;gap:8px;align-items:center">${csvBtn('transfers','#1d4ed8')}<button class="btn btn-primary btn-sm" onclick="showAddTransferModal()">+ New</button>${pdfBtn}</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
        <div style="background:var(--blue-dim);border:1px solid rgba(74,156,240,0.35);border-radius:10px;padding:14px;text-align:center"><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--blue);font-weight:700;margin-bottom:4px">Total</div><div style="font-size:22px;font-weight:900;color:var(--blue)">${fmtPKR(totalTr)}</div><div style="font-size:10px;color:var(--text3)">${allTr.length} records</div></div>
        <div style="background:var(--green-dim);border:1px solid rgba(46,201,138,0.3);border-radius:10px;padding:14px;text-align:center"><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--green);font-weight:700;margin-bottom:4px">Cash</div><div style="font-size:22px;font-weight:900;color:var(--green)">${fmtPKR(cashTr)}</div><div style="font-size:10px;color:var(--text3)">${allTr.filter(t=>t.method==='Cash').length} records</div></div>
        <div style="background:var(--purple-dim);border:1px solid rgba(155,109,240,0.3);border-radius:10px;padding:14px;text-align:center"><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--purple);font-weight:700;margin-bottom:4px">Bank</div><div style="font-size:22px;font-weight:900;color:var(--purple)">${fmtPKR(bankTr)}</div><div style="font-size:10px;color:var(--text3)">${allTr.filter(t=>t.method!=='Cash').length} records</div></div>
        <div style="background:var(--gold-dim);border:1px solid rgba(200,168,75,0.3);border-radius:10px;padding:14px;text-align:center"><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--gold2);font-weight:700;margin-bottom:4px">This Period</div><div style="font-size:22px;font-weight:900;color:var(--gold2)">${fmtPKR(moTotal)}</div><div style="font-size:10px;color:var(--text3)">${moTr.length} transfers</div></div>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Description</th><th>Method</th><th>Amount</th><th>Received By</th><th>Notes</th><th>By Warden</th><th>Actions</th></tr></thead><tbody>
      ${allTr.length===0?'<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:28px">No transfers yet — click + New to add.</td></tr>'
        :allTr.map(tr=>`<tr>
          <td class="text-muted" style="font-size:12px;white-space:nowrap">${fmtDate(tr.date)}</td>
          <td class="fw-700">${escHtml(tr.description||'Transfer')}</td>
          <td>${tr.method==='Cash'?'<span class="badge badge-green">💵 Cash</span>':'<span class="badge badge-blue">🏦 '+escHtml(tr.method)+'</span>'}</td>
          <td style="font-weight:900;color:var(--blue);font-size:14px">${fmtPKR(tr.amount)}</td>
          <td class="text-muted" style="font-size:12px">${escHtml(tr.receivedBy||'—')}</td>
          <td class="text-muted" style="font-size:12px">${escHtml(tr.notes||'—')}</td>
          <td class="text-muted" style="font-size:12px">${escHtml(tr.byWarden||'—')}</td>
          <td><div style="display:flex;gap:4px">
            <button class="btn btn-secondary btn-icon btn-sm" onclick="showEditTransferModal('${tr.id}')" title="Edit">✏️</button>
            <button class="btn btn-danger btn-icon btn-sm" onclick="deleteTransfer('${tr.id}');reportDetail='transfers';renderPage('reports')" title="Delete">🗑</button>
          </div></td>
        </tr>`).join('')}
      </tbody></table></div>
    </div>`;
  }
  return '';
}


function renderReports() {
  const key=reportPeriod==='month'?thisMonth():thisYear();
  const pays=DB.payments.filter(p=>_payMatchesMonth(p,key));
  const exps=DB.expenses.filter(e=>e.date?.startsWith(key));
  const rev=calcRevenue(key);
  const pending=DB.payments.filter(p=>p.status==='Pending'&&_payMatchesMonth(p,key)).reduce((s,p)=>s+(p.unpaid!=null?Number(p.unpaid):Number(p.amount)),0);
  const totalExp=exps.reduce((s,e)=>s+Number(e.amount),0);
  const net=rev-totalExp;
  const occ=DB.rooms.filter(r=>getRoomOccupancy(r)>0).length;
  const occRate=DB.rooms.length?Math.round(occ/DB.rooms.length*100):0;

  // Expense by category
  let catRows='';
  DB.settings.expenseCategories.forEach(cat=>{
    const amt=exps.filter(e=>e.category===cat).reduce((s,e)=>s+Number(e.amount),0);
    if(!amt) return;
    const pct=totalExp>0?Math.round(amt/totalExp*100):0;
    catRows+=`<div class="progress-row"><div class="progress-label">${escHtml(cat)}</div><div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:var(--red)"></div></div><div class="progress-value">${fmtPKR(amt)}</div></div>`;
  });

  // Method breakdown
  let methodRows='';
  DB.settings.paymentMethods.forEach(m=>{
    const amt=pays.filter(p=>p.status==='Paid'&&p.method===m).reduce((s,p)=>s+Number(p.amount),0);
    const cnt=pays.filter(p=>p.method===m).length;
    if(!cnt) return;
    const pct=rev>0?Math.round(amt/rev*100):0;
    methodRows+=`<div class="progress-row"><div class="progress-label">${escHtml(m)}</div><div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:var(--green)"></div></div><div class="progress-value">${fmtPKR(amt)}</div></div>`;
  });

  // Room type table
  const rtRows=DB.settings.roomTypes.map(type=>{
    const tRooms=DB.rooms.filter(r=>r.typeId===type.id);
    const tOcc=tRooms.filter(r=>getRoomOccupancy(r)>0).length;
    const tIds=DB.students.filter(t=>DB.rooms.find(r=>r.typeId===type.id&&r.id===t.roomId)&&t.status==='Active').map(t=>t.id);
    const tRev=pays.filter(p=>p.status==='Paid'&&tIds.includes(p.studentId)).reduce((s,p)=>s+Number(p.amount),0);
    return `<tr><td><span class="badge" style="background:${type.color}22;border-color:${type.color}44;color:${type.color}">${escHtml(type.name)}</span></td>
      <td class="fw-700">${tRooms.length}</td><td class="text-green fw-700">${tOcc}</td>
      <td class="text-gold">${tRooms.length-tOcc}</td><td class="text-green fw-700">${fmtPKR(tRev)}</td></tr>`;
  }).join('');

  // 12 months trend
  let trendHTML='';
  const mCount=reportPeriod==='month'?6:12;
  const trendData=[];
  for(let i=mCount-1;i>=0;i--){
    const _now=new Date(); const d=new Date(_now.getFullYear(),_now.getMonth()-i,1);
    const k=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    const lbl=d.toLocaleString('default',{month:'short'});
    const r2=calcRevenue(k);
    const e2=DB.expenses.filter(x=>x.date?.startsWith(k)).reduce((s,x)=>s+Number(x.amount),0);
    trendData.push({lbl,rev:r2,exp:e2});
  }
  const maxT=Math.max(...trendData.map(m=>Math.max(m.rev,m.exp)),1);
  trendData.forEach(m=>{
    const rh=Math.max((m.rev/maxT)*100,m.rev?2:0);
    const eh=Math.max((m.exp/maxT)*100,m.exp?2:0);
    trendHTML+=`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
      <div style="width:100%;display:flex;gap:2px;align-items:flex-end;height:120px">
        <div style="flex:1;background:var(--green);opacity:0.75;border-radius:3px 3px 0 0;height:${rh}%;min-height:${m.rev?2:0}px;transition:height 0.5s"></div>
        <div style="flex:1;background:var(--red);opacity:0.65;border-radius:3px 3px 0 0;height:${eh}%;min-height:${m.exp?2:0}px;transition:height 0.5s"></div>
      </div>
      <div style="font-size:10px;color:var(--text3)">${m.lbl}</div>
    </div>`;
  });

  // Build report cards data for clickable cards - removed per user request

  return `
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;flex-wrap:wrap">
    <button class="btn ${reportPeriod==='month'?'btn-primary':'btn-secondary'}" onclick="reportPeriod='month';reportDetail=null;renderPage('reports')">This Month</button>
    <button class="btn ${reportPeriod==='year'?'btn-primary':'btn-secondary'}" onclick="reportPeriod='year';reportDetail=null;renderPage('reports')">This Year</button>
    ${reportDetail?`<button class="btn btn-secondary btn-sm" onclick="reportDetail=null;renderPage('reports')">← Back to Reports</button>`:''}
    <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" onclick="printReport()" style="display:flex;align-items:center;gap:4px">🖨️ Print / PDF</button>
      <button class="btn btn-primary btn-sm" onclick="downloadAllStudentsPDF()" style="background:linear-gradient(135deg,#0d2d1a,#0a2015);border:1px solid rgba(46,201,138,0.5);color:var(--green);display:flex;align-items:center;gap:4px">📥 All Students PDF</button>
    </div>
  </div>

  ${reportDetail ? renderReportDetail(reportDetail, pays, exps, rev, pending, totalExp, net, occ) : ''}
  <!-- REPORTS: dashboard-style stat cards — each opens its own detail view -->
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr 1fr 1fr;gap:12px;margin-bottom:18px">
    <div style="background:linear-gradient(135deg,#0d2d1a,#0a2015);border:1px solid rgba(46,201,138,${reportDetail==='financial'?'0.7':'0.3'});border-radius:var(--radius);padding:16px 14px;display:flex;align-items:center;gap:10px;cursor:pointer;position:relative;overflow:hidden;transition:var(--transition)" onclick="reportDetail='financial';renderPage('reports')" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''">
      ${reportDetail==='financial'?'<div style="position:absolute;top:0;left:0;right:0;height:3px;background:var(--green)"></div>':''}
      <div style="width:38px;height:38px;border-radius:9px;background:rgba(46,201,138,0.15);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">💵</div>
      <div><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--green)">Revenue</div><div style="font-size:18px;font-weight:900;color:#fff">${fmtPKR(rev)}</div><div style="font-size:9px;color:var(--text3);margin-top:2px">${reportDetail==='financial'?'▲ showing detail':'click for detail →'}</div></div>
    </div>
    <div style="background:linear-gradient(135deg,#1a1000,#120b00);border:1px solid rgba(240,160,48,${reportDetail==='pending'?'0.7':'0.3'});border-radius:var(--radius);padding:16px 14px;display:flex;align-items:center;gap:10px;cursor:pointer;position:relative;overflow:hidden;transition:var(--transition)" onclick="reportDetail='pending';renderPage('reports')" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''">
      ${reportDetail==='pending'?'<div style="position:absolute;top:0;left:0;right:0;height:3px;background:var(--amber)"></div>':''}
      <div style="width:38px;height:38px;border-radius:9px;background:rgba(240,160,48,0.15);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">⏳</div>
      <div><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--amber)">Pending</div><div style="font-size:18px;font-weight:900;color:#fff">${fmtPKR(pending)}</div><div style="font-size:9px;color:var(--text3);margin-top:2px">${reportDetail==='pending'?'▲ showing detail':'click for detail →'}</div></div>
    </div>
    <div style="background:linear-gradient(135deg,#1a0e05,#140b02);border:1px solid rgba(224,82,82,${reportDetail==='expenses'?'0.7':'0.3'});border-radius:var(--radius);padding:16px 14px;display:flex;align-items:center;gap:10px;cursor:pointer;position:relative;overflow:hidden;transition:var(--transition)" onclick="reportDetail='expenses';renderPage('reports')" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''">
      ${reportDetail==='expenses'?'<div style="position:absolute;top:0;left:0;right:0;height:3px;background:var(--red)"></div>':''}
      <div style="width:38px;height:38px;border-radius:9px;background:rgba(224,82,82,0.15);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">📉</div>
      <div><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--red)">Expenses</div><div style="font-size:18px;font-weight:900;color:#fff">${fmtPKR(totalExp)}</div><div style="font-size:9px;color:var(--text3);margin-top:2px">${reportDetail==='expenses'?'▲ showing detail':'click for detail →'}</div></div>
    </div>
    <div style="background:linear-gradient(135deg,#1a1020,#120c1a);border:1px solid rgba(155,109,240,${reportDetail==='netprofit'?'0.7':'0.3'});border-radius:var(--radius);padding:16px 14px;display:flex;align-items:center;gap:10px;cursor:pointer;position:relative;overflow:hidden;transition:var(--transition)" onclick="reportDetail='netprofit';renderPage('reports')" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''">
      ${reportDetail==='netprofit'?'<div style="position:absolute;top:0;left:0;right:0;height:3px;background:var(--purple)"></div>':''}
      <div style="width:38px;height:38px;border-radius:9px;background:rgba(155,109,240,0.15);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">📊</div>
      <div><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--purple)">Available Fund</div><div style="font-size:18px;font-weight:900;color:${net>=0?'var(--green)':'var(--red)'}">${fmtPKR(net)}</div><div style="font-size:9px;color:var(--text3);margin-top:2px">${reportDetail==='netprofit'?'▲ showing detail':'click for detail →'}</div></div>
    </div>
    <div style="background:linear-gradient(135deg,#001a1a,#001212);border:1px solid rgba(15,188,173,${reportDetail==='rooms'?'0.7':'0.3'});border-radius:var(--radius);padding:16px 14px;display:flex;align-items:center;gap:10px;cursor:pointer;position:relative;overflow:hidden;transition:var(--transition)" onclick="reportDetail='rooms';renderPage('reports')" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''">
      ${reportDetail==='rooms'?'<div style="position:absolute;top:0;left:0;right:0;height:3px;background:var(--teal)"></div>':''}
      <div style="width:38px;height:38px;border-radius:9px;background:rgba(15,188,173,0.15);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">🏠</div>
      <div><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--teal)">Occupancy</div><div style="font-size:18px;font-weight:900;color:#fff">${occRate}%</div><div style="font-size:9px;color:var(--text3);margin-top:2px">${occ}/${DB.rooms.length} rooms</div></div>
    </div>
    <!-- FEATURE 4: Transfers to Owner as a full clickable record card -->
    <div style="background:linear-gradient(135deg,#070e18,#040a12);border:1px solid rgba(74,156,240,${reportDetail==='transfers'?'0.7':'0.2'});border-radius:var(--radius);padding:16px 14px;display:flex;align-items:center;gap:10px;cursor:pointer;position:relative;overflow:hidden;transition:var(--transition)" onclick="reportDetail='transfers';renderPage('reports')" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''">
      ${reportDetail==='transfers'?'<div style="position:absolute;top:0;left:0;right:0;height:3px;background:var(--blue)"></div>':''}
      <div style="width:38px;height:38px;border-radius:9px;background:rgba(74,156,240,0.15);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">🏦</div>
      <div><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--blue)">Transfers</div><div style="font-size:18px;font-weight:900;color:#fff">${fmtPKR((DB.transfers||[]).reduce((s,t)=>s+Number(t.amount),0))}</div><div style="font-size:9px;color:var(--text3);margin-top:2px">${(DB.transfers||[]).length} records · Owner</div></div>
    </div>
  </div>

  <div class="two-col" style="margin-bottom:20px">
    <div class="card">
      <div class="card-header"><div class="card-title">📈 Revenue vs Expenses</div></div>
      <div style="display:flex;gap:6px;align-items:flex-end;height:140px">${trendHTML}</div>
      <div class="chart-legend mt-8"><div class="chart-legend-item"><div class="chart-legend-dot" style="background:var(--green)"></div>Revenue</div><div class="chart-legend-item"><div class="chart-legend-dot" style="background:var(--red)"></div>Expenses</div></div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">💳 Payment Methods</div></div>
      ${methodRows||'<div class="text-muted" style="font-size:13px">No data for this period</div>'}
    </div>
  </div>
  <div class="two-col" style="margin-bottom:20px">
    <div class="card">
      <div class="card-header"><div class="card-title">📉 Expense Breakdown</div></div>
      ${catRows||'<div class="text-muted" style="font-size:13px">No expenses for this period</div>'}
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">🏨 Room Type Performance</div></div>
      <div class="table-wrap"><table><thead><tr><th>Type</th><th>Total</th><th>Occupied</th><th>Vacant</th><th>Revenue</th></tr></thead><tbody>${rtRows}</tbody></table></div>
    </div>
  </div>
  <div class="card">
    <div class="card-header"><div class="card-title">👥 Student Summary</div><div style="display:flex;gap:8px"><button class="btn btn-secondary btn-sm" onclick="reportDetail='students';renderPage('reports')" style="font-size:11px">👁 View All →</button></div></div>
    <div class="three-col">
      ${[['Active Students',DB.students.filter(t=>t.status==='Active').length,'var(--green)','students'],['Left',DB.students.filter(t=>t.status==='Left').length,'var(--text3)','students'],['Blacklisted',DB.students.filter(t=>t.status==='Blacklisted').length,'var(--red)','students'],['Total Registered',DB.students.length,'var(--gold)','students'],['Total Rooms',DB.rooms.length,'var(--blue)','rooms'],['Total Payments',DB.payments.length,'var(--teal)','financial']].map(([l,v,c,det])=>`<div class="card" style="padding:16px;text-align:center;cursor:pointer;transition:var(--transition)" onclick="reportDetail='${det}';renderPage('reports')" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''"><div class="stat-label">${l}</div><div class="fw-800" style="font-size:28px;margin-top:6px;color:${c}">${v}</div><div style="font-size:10px;color:var(--text3);margin-top:4px">click for detail →</div></div>`).join('')}
    </div>
  </div>

  ${false ? `
  <div class="card" style="margin-top:20px">
    <div class="card-header"><div class="card-title">🚨 Overdue Payments — Full Detail</div><span class="badge badge-red">${DB.payments.filter(p=>p.status==='Overdue').length} overdue</span></div>
    <div class="table-wrap"><table><thead><tr><th>Student</th><th>Room</th><th>Month</th><th>Amount</th><th>Due Date</th><th>Days Late</th><th>Action</th></tr></thead><tbody>
    ${DB.payments.filter(p=>p.status==='Overdue').length ? DB.payments.filter(p=>p.status==='Overdue').map(p=>{
      const days=p.dueDate?Math.max(0,Math.floor((Date.now()-new Date(p.dueDate))/86400000)):0;
      return '<tr><td class="fw-700" style="cursor:pointer;color:var(--blue)" onclick="showViewStudentModal(\''+p.studentId+'\')">' + escHtml(p.studentName||'—') + '</td><td class="text-gold fw-700">#' + escHtml(String(p.roomNumber||'')) + '</td><td class="text-muted">' + escHtml(p.month||'—') + '</td><td class="text-red fw-700">' + fmtPKR(p.amount) + '</td><td class="text-muted" style="font-size:12px">' + (fmtDate(p.dueDate)||'—') + '</td><td><span class="badge badge-red">' + (days>0?days+' days late':'—') + '</span></td><td><button class="btn btn-success btn-sm" onclick="markPaymentPaid(\''+p.id+'\');reportDetail=\'overdue\';renderPage(\'reports\')">Mark Paid</button></td></tr>';
    }).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:24px">🎉 No overdue payments!</td></tr>'}
    </tbody></table></div>
  </div>` : ''}

  ${reportDetail==='students' ? `
  <div class="card" style="margin-top:20px">
    <div class="card-header"><div class="card-title">👥 Full Student Directory</div><div style="display:flex;gap:8px;align-items:center"><span class="badge badge-blue">${DB.students.length} total</span><button class="btn btn-primary btn-sm" onclick="downloadDetailPDF('students')" style="font-size:11px">⬇ Download PDF</button></div></div>
    <div class="table-wrap"><table><thead><tr><th>Student ID</th><th>Name</th><th>Room</th><th>Father</th><th>Phone</th><th>Rent</th><th>Join Date</th><th>Status</th></tr></thead><tbody>
    ${DB.students.length ? DB.students.map(t=>{const room=DB.rooms.find(r=>r.id===t.roomId); return '<tr style="cursor:pointer" onclick="showViewStudentModal(\''+t.id+'\')"><td style="font-family:var(--font-mono);font-size:11px;color:var(--gold2);font-weight:700">#' + escHtml(t.id) + '</td><td style="font-weight:600;color:var(--blue)">' + escHtml(t.name) + '</td><td class="text-gold fw-700">' + (room?'#'+room.number:'—') + '</td><td class="text-muted">' + escHtml(t.fatherName||'—') + '</td><td>' + escHtml(t.phone||'—') + '</td><td class="text-green fw-700">' + fmtPKR(t.rent) + '</td><td class="text-muted" style="font-size:12px">' + fmtDate(t.joinDate) + '</td><td>' + statusBadge(t.status) + '</td></tr>';}).join('') : '<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:24px">No students found</td></tr>'}
    </tbody></table></div>
  </div>` : ''}

  ${reportDetail==='rooms' ? `
  <div class="card" style="margin-top:20px">
    <div class="card-header"><div class="card-title">🏠 Room Occupancy Detail</div><div style="display:flex;gap:8px;align-items:center"><span class="badge badge-gold">${DB.rooms.filter(r=>getRoomOccupancy(r)>0).length}/${DB.rooms.length} occupied</span><button class="btn btn-primary btn-sm" onclick="downloadDetailPDF('rooms')" style="font-size:11px">⬇ Download PDF</button></div></div>
    <div class="table-wrap"><table><thead><tr><th>Room</th><th>Floor</th><th>Type</th><th>Capacity</th><th>Occupied</th><th>Rent/mo</th><th>Status</th><th>Students</th></tr></thead><tbody>
    ${DB.rooms.map(r=>{const t=getRoomType(r);const oc=getRoomOccupancy(r);const names=DB.students.filter(s=>s.roomId===r.id&&s.status==='Active').map(s=>s.name);return '<tr><td class="text-gold fw-700">#'+r.number+'</td><td class="text-muted">'+r.floor+'</td><td><span class="badge" style="background:'+t.color+'22;color:'+t.color+';border:1px solid '+t.color+'44">'+escHtml(t.name)+'</span></td><td>'+t.capacity+' beds</td><td style="font-weight:700;color:'+(oc>0?'var(--green)':'var(--text3)')+'">'+oc+'/'+t.capacity+'</td><td class="text-green fw-700">'+fmtPKR(r.rent)+'</td><td>'+(oc>0?'<span class="badge badge-green">Occupied</span>':'<span class="badge badge-gold">Vacant</span>')+'</td><td style="font-size:12px;color:var(--text2)">'+(names.join(', ')||'—')+'</td></tr>';}).join('')}
    </tbody></table></div>
  </div>` : ''}

  ${reportDetail==='financial' ? `
  <div class="card" style="margin-top:20px">
    <div class="card-header"><div class="card-title">💰 Revenue — Financial Transactions</div><div style="display:flex;gap:8px;align-items:center"><span class="badge badge-green">${DB.payments.filter(p=>p.status==='Paid'&&_payMatchesMonth(p,key)).length} paid</span><button class="btn btn-primary btn-sm" onclick="downloadDetailPDF('financial')" style="font-size:11px">⬇ Download PDF</button></div></div>
    <div class="table-wrap"><table><thead><tr><th>Student</th><th>Room</th><th>Month</th><th>Amount Paid</th><th>Unpaid</th><th>Method</th><th>Status</th><th>Date</th></tr></thead><tbody>
    ${DB.payments.filter(p=>_payMatchesMonth(p,key)).sort((a,b)=>new Date(b.date)-new Date(a.date)).map(p=>'<tr><td class="fw-700" style="cursor:pointer;color:var(--blue)" onclick="showViewStudentModal(\''+p.studentId+'\')">'+escHtml(p.studentName||'—')+'</td><td class="text-gold fw-700">#'+escHtml(String(p.roomNumber||''))+'</td><td class="text-muted">'+escHtml(p.month||'—')+'</td><td class="text-green fw-700">'+fmtPKR(p.amount)+'</td><td style="color:'+((p.unpaid||0)>0?'var(--red)':'var(--text3)')+'">'+fmtPKR(p.unpaid||0)+'</td><td>'+pmBadge(p.method)+'</td><td>'+statusBadge(p.status)+'</td><td class="text-muted" style="font-size:12px">'+fmtDate(p.date)+'</td></tr>').join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:24px">No transactions found</td></tr>'}
    </tbody></table></div>
  </div>` : ''}

  ${reportDetail==='pending' ? `
  <div class="card" style="margin-top:20px">
    <div class="card-header"><div class="card-title">⏳ Pending Payments — Outstanding Detail</div><div style="display:flex;gap:8px;align-items:center"><span class="badge badge-gold">${DB.payments.filter(p=>p.status==='Pending'&&_payMatchesMonth(p,key)).length} unpaid this period</span><button class="btn btn-primary btn-sm" onclick="downloadDetailPDF('pending')" style="font-size:11px">⬇ Download PDF</button></div></div>
    <div class="table-wrap"><table><thead><tr><th>Student</th><th>Room</th><th>Month</th><th>Partial Paid</th><th>Still Owed</th><th>Method</th><th>Due Date</th><th>Action</th></tr></thead><tbody>
    ${DB.payments.filter(p=>p.status==='Pending').sort((a,b)=>new Date(a.dueDate||a.date)-new Date(b.dueDate||b.date)).map(p=>'<tr><td class="fw-700" style="cursor:pointer;color:var(--blue)" onclick="showViewStudentModal(\''+p.studentId+'\')">'+escHtml(p.studentName||'—')+'</td><td class="text-gold fw-700">#'+escHtml(String(p.roomNumber||''))+'</td><td class="text-muted">'+escHtml(p.month||'—')+'</td><td style="color:'+(Number(p.amount)>0?'var(--green)':'var(--text3)')+'">'+fmtPKR(p.amount||0)+'</td><td style="font-weight:700;color:var(--red)">'+fmtPKR(p.unpaid!=null?p.unpaid:p.amount)+'</td><td>'+pmBadge(p.method)+'</td><td class="text-muted" style="font-size:12px">'+(fmtDate(p.dueDate)||'—')+'</td><td><button class="btn btn-success btn-sm" style="font-size:11px" onclick="markPaymentPaid(\''+p.id+'\');reportDetail=\'pending\';renderPage(\'reports\')">✓ Collect</button></td></tr>').join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:24px">🎉 No pending payments!</td></tr>'}
    </tbody></table></div>
  </div>` : ''}

  ${reportDetail==='netprofit' ? `
  <div class="card" style="margin-top:20px">
    <div class="card-header"><div class="card-title">📊 Available Fund — Summary</div><div style="display:flex;gap:8px;align-items:center"><span class="badge" style="background:${net>=0?'rgba(46,201,138,0.15)':'rgba(224,82,82,0.15)'};color:${net>=0?'var(--green)':'var(--red)'};">${net>=0?'Profit':'Loss'}</span><button class="btn btn-primary btn-sm" onclick="downloadDetailPDF('netprofit')" style="font-size:11px">⬇ Download PDF</button></div></div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;padding:16px">
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:16px;text-align:center"><div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Total Revenue</div><div style="font-size:24px;font-weight:800;color:var(--green)">${fmtPKR(rev)}</div><div style="font-size:11px;color:var(--text3);margin-top:4px">${pays.filter(p=>p.status==='Paid').length} paid transactions</div></div>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:16px;text-align:center"><div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Total Expenses</div><div style="font-size:24px;font-weight:800;color:var(--red)">${fmtPKR(totalExp)}</div><div style="font-size:11px;color:var(--text3);margin-top:4px">${exps.length} expense records</div></div>
      <div style="background:var(--bg3);border:1px solid ${net>=0?'rgba(46,201,138,0.3)':'rgba(224,82,82,0.3)'};border-radius:10px;padding:16px;text-align:center"><div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Available Fund</div><div style="font-size:28px;font-weight:900;color:${net>=0?'var(--green)':'var(--red)'}">${fmtPKR(net)}</div><div style="font-size:11px;color:var(--text3);margin-top:4px">${rev>0?Math.round(net/rev*100):0}% margin</div></div>
    </div>
    <div style="padding:0 16px 16px"><div style="font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Expense Breakdown by Category</div>
    <table><thead><tr><th>Category</th><th>Amount</th><th>% of Expenses</th><th>Entries</th></tr></thead><tbody>
    ${DB.settings.expenseCategories.map(cat=>{const amt=exps.filter(e=>e.category===cat).reduce((s,e)=>s+Number(e.amount),0);const cnt=exps.filter(e=>e.category===cat).length;const pct=totalExp>0?Math.round(amt/totalExp*100):0;return amt>0?'<tr><td><span class="badge badge-amber">'+escHtml(cat)+'</span></td><td class="text-red fw-700">'+fmtPKR(amt)+'</td><td><div style="display:flex;align-items:center;gap:6px"><div style="flex:1;height:6px;background:var(--bg4);border-radius:3px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:var(--red);border-radius:3px"></div></div><span style="font-size:11px;color:var(--text3);width:30px">'+pct+'%</span></div></td><td class="text-muted" style="font-size:12px">'+cnt+'</td></tr>':'';}).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:16px">No expenses recorded</td></tr>'}
    </tbody></table></div>
  </div>` : ''}

  ${reportDetail==='expenses' ? `
  <div class="card" style="margin-top:20px">
    <div class="card-header"><div class="card-title">📉 Expense Detail</div><div style="display:flex;gap:8px;align-items:center"><span class="badge badge-red">${exps.length} records · ${fmtPKR(totalExp)}</span><button class="btn btn-primary btn-sm" onclick="downloadDetailPDF('expenses')" style="font-size:11px">⬇ Download PDF</button></div></div>
    <div class="table-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th></tr></thead><tbody>
    ${DB.expenses.filter(e=>e.date?.startsWith(key)).sort((a,b)=>new Date(b.date)-new Date(a.date)).map(e=>'<tr><td class="text-muted" style="font-size:12px">'+fmtDate(e.date)+'</td><td><span class="badge badge-amber">'+escHtml(e.category)+'</span></td><td>'+escHtml(e.description||'—')+'</td><td class="text-red fw-700">'+fmtPKR(e.amount)+'</td></tr>').join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:24px">No expenses found</td></tr>'}
    </tbody></table></div>
  </div>` : ''}

  `;
}

// ════════════════════════════════════════════════════════════════════════════
// TRANSFERS TO OWNER
// ════════════════════════════════════════════════════════════════════════════
function showTransferRecordsModal() {
  const transfers = (DB.transfers||[]).slice().sort((a,b)=>new Date(b.date)-new Date(a.date));
  const totalAll = transfers.reduce((s,t)=>s+Number(t.amount),0);
  const mo = new Date().toISOString().slice(0,7);
  const moTransfers = transfers.filter(t=>t.date?.startsWith(mo));
  const moTotal = moTransfers.reduce((s,t)=>s+Number(t.amount),0);

  const rows = transfers.length===0
    ? '<div style="padding:32px;text-align:center;color:var(--text3)"><div style="font-size:36px;margin-bottom:10px">🏦</div><div style="font-size:14px">No transfers recorded yet</div></div>'
    : '<div class="table-wrap"><table><thead><tr><th>#</th><th>Date</th><th>Amount</th><th>Method</th><th>Received By</th><th>Description</th><th>Actions</th></tr></thead><tbody>'
      + transfers.map((tr, idx)=>
          '<tr>'
          +'<td style="font-size:11px;font-weight:700;color:var(--text3)">'+String(idx+1).padStart(2,'0')+'</td>'
          +'<td style="font-size:12px;color:var(--text3)">'+fmtDate(tr.date)+'</td>'
          +'<td style="font-size:15px;font-weight:900;color:var(--blue)">'+fmtPKR(tr.amount)+'</td>'
          +'<td>'+(tr.method==='Cash'?'<span class="badge badge-green">💵 Cash</span>':'<span class="badge badge-blue">🏦 Bank</span>')+'</td>'
          +'<td style="font-weight:600;color:var(--text2)">'+escHtml(tr.receivedBy||'—')+'</td>'
          +'<td style="color:var(--text3);font-size:12px;max-width:140px;white-space:normal">'+escHtml(tr.description||'—')+'</td>'
          +'<td><div style="display:flex;gap:5px">'
          +'<button class="btn btn-secondary btn-sm" style="font-size:10px;padding:3px 8px" onclick="showEditTransferModal(\''+tr.id+'\')">✏️ Edit</button>'
          +'<button class="btn btn-danger btn-sm" style="font-size:10px;padding:3px 7px" onclick="deleteTransferFromModal(\''+tr.id+'\')">✕</button>'
          +'</div></td>'
          +'</tr>'
        ).join('')
      + '</tbody></table></div>';

  showModal('modal-xl','🏦 Transfer Records — Hostel → Owner',`
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px">
      <div style="background:linear-gradient(135deg,#0a1828,#060f1c);border:1px solid rgba(74,156,240,0.4);border-radius:12px;padding:16px;text-align:center">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--blue);margin-bottom:6px">🏦 Total Transferred</div>
        <div style="font-size:28px;font-weight:900;color:var(--blue)">${fmtPKR(totalAll)}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:4px">${transfers.length} record${transfers.length!==1?'s':''} total</div>
      </div>
      <div style="background:linear-gradient(135deg,#082818,#051a10);border:1px solid rgba(46,201,138,0.35);border-radius:12px;padding:16px;text-align:center">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--green);margin-bottom:6px">📅 This Month</div>
        <div style="font-size:28px;font-weight:900;color:var(--green)">${fmtPKR(moTotal)}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:4px">${moTransfers.length} transfer${moTransfers.length!==1?'s':''}</div>
      </div>
      <div style="background:linear-gradient(135deg,#14082a,#0d0520);border:1px solid rgba(155,109,240,0.35);border-radius:12px;padding:16px;text-align:center">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--purple);margin-bottom:6px">💵 Cash vs Bank</div>
        <div style="font-size:16px;font-weight:900;color:#fff;line-height:1.4">
          <span style="color:var(--green)">${fmtPKR(transfers.filter(t=>t.method==='Cash').reduce((s,t)=>s+Number(t.amount),0))}</span>
          <span style="color:var(--text3);font-size:12px"> cash</span><br>
          <span style="color:var(--blue)">${fmtPKR(transfers.filter(t=>t.method!=='Cash').reduce((s,t)=>s+Number(t.amount),0))}</span>
          <span style="color:var(--text3);font-size:12px"> bank</span>
        </div>
      </div>
    </div>
    ${rows}`,
  `<button class="btn btn-secondary" onclick="closeModal()">Close</button>
   <button class="btn btn-primary" onclick="closeModal();navigate('reports')">+ New Transfer (Reports)</button>`);
}

function deleteTransferFromModal(id) {
  showConfirm('Delete transfer?','This cannot be undone.',()=>{
    DB.transfers = (DB.transfers||[]).filter(x=>x.id!==id);
    saveDB();
    closeModal();
    setTimeout(()=>showTransferRecordsModal(), 100);
    toast('Transfer deleted','info');
  });
}

function showEditTransferModal(id) {
  const tr = (DB.transfers||[]).find(x=>x.id===id);
  if(!tr) return;
  showModal('modal-md','✏️ Edit Transfer — Hostel → Owner',`
    <div style="background:linear-gradient(135deg,#0d1a2d,#081525);border:1px solid rgba(74,156,240,0.3);border-radius:10px;padding:12px 14px;margin-bottom:16px;font-size:12px;color:var(--text2)">
      Editing transfer recorded on <strong>${fmtDate(tr.date)}</strong>
    </div>
    <div class="form-grid">
      <div class="field"><label>Transfer Method *</label>
        <select class="form-control" id="fe-trmethod">
          ${['Cash','Bank Transfer','JazzCash','EasyPaisa'].map(m=>`<option ${tr.method===m?'selected':''}>${m}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Amount (PKR) *</label>
        <input class="form-control" id="fe-tramt" type="number" value="${tr.amount}">
      </div>
      <div class="field"><label>Date *</label>
        <input class="form-control cdp-trigger" id="fe-trdate" type="text" readonly onclick="showCustomDatePicker(this,event)" value="${tr.date||today()}">
      </div>
      <div class="field"><label>Received By</label>
        <input class="form-control" id="fe-trrec" value="${escHtml(tr.receivedBy||'')}">
      </div>
      <div class="field col-full"><label>Description / Notes</label>
        <textarea class="form-control" id="fe-trdesc" rows="2">${escHtml(tr.description||'')}</textarea>
      </div>
    </div>`,
  `<button class="btn btn-secondary" onclick="closeModal();setTimeout(()=>showTransferRecordsModal(),80)">Cancel</button>
   <button class="btn btn-primary" onclick="submitEditTransfer('${id}')"><span class=\"micon\" style=\"font-size:14px\">save</span> Save</button>`);
}

function submitEditTransfer(id) {
  const tr = (DB.transfers||[]).find(x=>x.id===id);
  if(!tr) return;
  const amt = parseFloat(document.getElementById('fe-tramt').value);
  const method = document.getElementById('fe-trmethod').value;
  const date = document.getElementById('fe-trdate').value;
  if(!amt||!date){toast('Amount and date are required','error');return;}
  tr.amount = amt;
  tr.method = method;
  tr.date = date;
  tr.receivedBy = document.getElementById('fe-trrec').value.trim();
  tr.description = document.getElementById('fe-trdesc').value.trim();
  tr.editedAt = today();
  saveDB();
  closeModal();
  setTimeout(()=>showTransferRecordsModal(), 80);
  toast('Transfer updated','success');
}

function showAddTransferModal() {
  showModal('modal-md','🏦 New Transfer to Owner',`
    <div style="background:linear-gradient(135deg,#0d1a2d,#081525);border:1px solid rgba(74,156,240,0.3);border-radius:10px;padding:14px;margin-bottom:18px;font-size:13px;color:var(--text2)">
      Record cash or bank transfer sent from this hostel to the <strong>Owner</strong>
    </div>
    <div class="form-grid">
      <div class="field"><label>Transfer Method *</label>
        <select class="form-control" id="f-trmethod">
          <option value="Cash">💵 Cash</option>
          <option value="Bank Transfer">🏦 Bank Transfer</option>
          <option value="JazzCash">📱 JazzCash</option>
          <option value="EasyPaisa">📱 EasyPaisa</option>
        </select>
      </div>
      <div class="field"><label>Amount (PKR) *</label><input class="form-control" id="f-tramt" type="number" placeholder="Enter amount"></div>
      <div class="field"><label>Date *</label><input class="form-control cdp-trigger" id="f-trdate" type="text" readonly onclick="showCustomDatePicker(this,event)" value="${today()}"></div>
      <div class="field"><label>Received By</label><input class="form-control" id="f-trrec" placeholder="Owner / Recipient Name"></div>
      <div class="field col-full"><label>Description / Notes</label><textarea class="form-control" id="f-trdesc" placeholder="Purpose of transfer…" rows="2"></textarea></div>
    </div>`,
  `<button class="btn btn-secondary btn-sm" onclick="closeModal();showTransferRecordsModal()" style="margin-right:auto">📋 View Records</button>
   <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
   <button class="btn btn-primary" onclick="submitAddTransfer()">✓ Record Transfer</button>`);
}
function submitAddTransfer() {
  const amt = parseFloat(document.getElementById('f-tramt').value);
  const method = document.getElementById('f-trmethod').value;
  const date = document.getElementById('f-trdate').value;
  if(!amt||!method||!date){toast('Fill all required fields','error');return;}
  if(!DB.transfers) DB.transfers = [];
  DB.transfers.push({
    id:'tr_'+uid(), method, amount:amt, date,
    receivedBy: document.getElementById('f-trrec').value.trim(),
    description: document.getElementById('f-trdesc').value.trim(),
    notes: document.getElementById('f-trdesc').value.trim(),
    byWarden: (typeof CUR_USER !== 'undefined' && CUR_USER?.name) ? CUR_USER.name : '',
    createdAt: today()
  });
  saveDB(); closeModal();
  // Stay on current page (dashboard) and refresh it — don't redirect to reports
  renderPage(currentPage);
  toast('Transfer recorded — ' + fmtPKR(amt) + ' sent to owner','success');
}
function deleteTransfer(id) {
  showConfirm('Delete transfer record?','This cannot be undone.',()=>{
    DB.transfers = (DB.transfers||[]).filter(x=>x.id!==id);
    saveDB(); renderPage('reports'); toast('Transfer deleted','info');
  });
}

function drawCharts() {} // charts are rendered as HTML bars

function saveMaintenance() {
  const title = document.getElementById('mt-title')?.value?.trim();
  if(!title){toast('Enter a title','error');return;}
  if(!DB.maintenance) DB.maintenance=[];
  logActivity('Maintenance Added', title, 'Maintenance');
  DB.maintenance.push({
    id:'mt_'+uid(), title, roomId:document.getElementById('mt-room')?.value||'',
    priority:document.getElementById('mt-priority')?.value||'Medium',
    description:document.getElementById('mt-desc')?.value?.trim()||'',
    date:document.getElementById('mt-date')?.value||today(),
    status:'Open', resolvedDate:''
  });
  saveDB(); closeModal(); renderPage('maintenance'); toast('Maintenance request added','success');
}function saveComplaint() {
  const subject = document.getElementById('cp-subject')?.value?.trim();
  if(!subject){toast('Enter a subject','error');return;}
  if(!DB.complaints) DB.complaints=[];
  DB.complaints.push({
    id:'cp_'+uid(), subject,
    studentId:document.getElementById('cp-student')?.value||'',
    description:document.getElementById('cp-desc')?.value?.trim()||'',
    date:document.getElementById('cp-date')?.value||today(),
    status:'Open', response:''
  });
  saveDB(); closeModal(); renderPage('complaints'); toast('Complaint recorded','success');
}function showAddCheckinModal() {
  const students = DB.students.filter(s=>s.status==='Active').map(s=>`<option value="${s.id}">${escHtml(s.name)}</option>`).join('');
  const now = new Date();
  const timeStr = now.toTimeString().slice(0,5);
  showModal('modal-sm','Add Check-in / Out Entry',`
    <div class="form-grid">
      <div class="field col-full"><label>Student *</label><select id="ci-student" class="form-control"><option value="">Select Student</option>${students}</select></div>
      <div class="field"><label>Type</label><select id="ci-type" class="form-control"><option>Check-in</option><option>Check-out</option></select></div>
      <div class="field"><label>Date</label><input id="ci-date" class="form-control cdp-trigger" type="text" readonly onclick="showCustomDatePicker(this,event)" value="${today()}"></div>
      <div class="field"><label>Time</label><input id="ci-time" class="form-control" type="time" value="${timeStr}"></div>
      <div class="field"><label>Reason / Note</label><input id="ci-reason" class="form-control" placeholder="Optional reason"></div>
    </div>`,
  `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveCheckin()">Save Entry</button>`);
}
function saveCheckin() {
  const studentId = document.getElementById('ci-student')?.value;
  if(!studentId){toast('Select a student','error');return;}
  if(!DB.checkinlog) DB.checkinlog=[];
  DB.checkinlog.push({
    id:'ci_'+uid(), studentId,
    type:document.getElementById('ci-type')?.value||'Check-in',
    date:document.getElementById('ci-date')?.value||today(),
    time:document.getElementById('ci-time')?.value||'',
    reason:document.getElementById('ci-reason')?.value?.trim()||''
  });
  saveDB(); closeModal(); renderPage('checkinlog'); toast('Entry added','success');
}
function deleteCheckin(id) {
  DB.checkinlog=DB.checkinlog.filter(x=>x.id!==id); saveDB(); renderPage('checkinlog'); toast('Deleted','info');
}function showAddNoticeModal() {
  showModal('modal-sm','Post New Notice',`
    <div class="form-grid">
      <div class="field col-full"><label>Title *</label><input id="nt-title" class="form-control" placeholder="Notice title"></div>
      <div class="field"><label>Type</label><select id="nt-type" class="form-control"><option>General</option><option>Important</option><option>Info</option><option>Event</option></select></div>
      <div class="field"><label>Date</label><input id="nt-date" class="form-control cdp-trigger" type="text" readonly onclick="showCustomDatePicker(this,event)" value="${today()}"></div>
      <div class="field col-full"><label>Content</label><textarea id="nt-content" class="form-control" placeholder="Write notice content..."></textarea></div>
    </div>`,
  `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveNotice()">Post Notice</button>`);
}
function saveNotice() {
  const title = document.getElementById('nt-title')?.value?.trim();
  if(!title){toast('Enter a title','error');return;}
  if(!DB.notices) DB.notices=[];
  DB.notices.push({
    id:'nt_'+uid(), title,
    type:document.getElementById('nt-type')?.value||'General',
    content:document.getElementById('nt-content')?.value?.trim()||'',
    date:document.getElementById('nt-date')?.value||today()
  });
  saveDB(); closeModal(); renderPage('notices'); toast('Notice posted','success');
}
function deleteNotice(id) {
  showConfirm('Delete Notice?','',()=>{DB.notices=DB.notices.filter(x=>x.id!==id);saveDB();renderPage('notices');toast('Deleted','info');});
}function showAddFineModal() {
  const students = DB.students.filter(s=>s.status==='Active').map(s=>`<option value="${s.id}">${escHtml(s.name)}</option>`).join('');
  showModal('modal-sm','Add Fine / Penalty',`
    <div class="form-grid">
      <div class="field col-full"><label>Student *</label><select id="fn-student" class="form-control"><option value="">Select Student</option>${students}</select></div>
      <div class="field"><label>Amount (PKR) *</label><input id="fn-amount" class="form-control" type="number" placeholder="500"></div>
      <div class="field"><label>Date</label><input id="fn-date" class="form-control cdp-trigger" type="text" readonly onclick="showCustomDatePicker(this,event)" value="${today()}"></div>
      <div class="field col-full"><label>Reason</label><input id="fn-reason" class="form-control" placeholder="e.g. Late payment, Rule violation"></div>
      <div class="field col-full"><label>Additional Notes</label><textarea id="fn-notes" class="form-control" placeholder="Optional notes..."></textarea></div>
    </div>`,
  `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveFine()">Add Fine</button>`);
}
function saveFine() {
  const studentId = document.getElementById('fn-student')?.value;
  const amount = Number(document.getElementById('fn-amount')?.value||0);
  if(!studentId){toast('Select a student','error');return;}
  if(!amount||amount<=0){toast('Enter a valid amount','error');return;}
  if(!DB.fines) DB.fines=[];
  DB.fines.push({
    id:'fn_'+uid(), studentId, amount,
    reason:document.getElementById('fn-reason')?.value?.trim()||'',
    notes:document.getElementById('fn-notes')?.value?.trim()||'',
    date:document.getElementById('fn-date')?.value||today(),
    paid:false, paidDate:''
  });
  saveDB(); closeModal(); renderPage('fines'); toast('Fine recorded','success');
}
function payFine(id) {
  const f = DB.fines.find(x=>x.id===id);
  if(f){f.paid=true;f.paidDate=today();saveDB();renderPage('fines');toast('Fine marked as paid','success');}
}
function deleteFine(id) {
  showConfirm('Delete Fine?','',()=>{DB.fines=DB.fines.filter(x=>x.id!==id);saveDB();renderPage('fines');toast('Deleted','info');});
}


// ════════════════════════════════════════════════════════════════════════════
// ACTIVITY LOG
// ════════════════════════════════════════════════════════════════════════════
function renderActivityLog() {
  const list = DB.activityLog || [];
  const catColor = {'General':'var(--blue)','Maintenance':'var(--amber)','Finance':'var(--green)','Student':'var(--purple)','Complaint':'var(--red)','Room':'var(--teal)','Students':'var(--purple)'};
  const catIcon = {General:'edit_note',Maintenance:'build',Finance:'payments',Student:'person',Students:'person',Complaint:'report',Room:'meeting_room'};

  // Per-warden summary for current user
  const curName = (typeof CUR_USER !== 'undefined' && CUR_USER && CUR_USER.name) ? CUR_USER.name : '';
  const moKey = thisMonth();
  const myPayments = DB.payments.filter(p => p.byWarden === curName);
  const myPaymentsThisMo = myPayments.filter(p => _payMatchesMonth(p, moKey));
  const myPayTotal = myPaymentsThisMo.reduce((s,p) => s + Number(p.amount||0), 0);
  const myStudents = DB.students.filter(s => {
    const logEntry = list.find(a => a.action === 'Student Added' && a.details && a.details.startsWith(s.name) && a.by === curName);
    return logEntry;
  });
  const myStudentsThisMo = list.filter(a => a.action === 'Student Added' && a.by === curName && (a.date||'').startsWith(moKey));

  return `
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px">
    <div style="background:var(--card);border:1px solid rgba(46,201,138,0.25);border-radius:var(--radius);padding:16px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span class="micon" style="font-size:20px;color:var(--green)">payments</span>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text3)">Your Collections</div>
      </div>
      <div style="font-size:22px;font-weight:900;color:var(--green)">${fmtPKR(myPayTotal)}</div>
      <div style="font-size:11px;color:var(--text3);margin-top:3px">${myPaymentsThisMo.length} payment${myPaymentsThisMo.length!==1?'s':''} this month${curName?' · '+curName:''}</div>
    </div>
    <div style="background:var(--card);border:1px solid rgba(155,109,240,0.25);border-radius:var(--radius);padding:16px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span class="micon" style="font-size:20px;color:var(--purple)">person_add</span>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text3)">Students Added</div>
      </div>
      <div style="font-size:22px;font-weight:900;color:var(--purple)">${myStudentsThisMo.length}</div>
      <div style="font-size:11px;color:var(--text3);margin-top:3px">this month${curName?' · '+curName:''}</div>
    </div>
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span class="micon" style="font-size:20px;color:var(--text3)">history</span>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text3)">Log Entries</div>
      </div>
      <div style="font-size:22px;font-weight:900;color:var(--text)">${list.length}</div>
      <div style="font-size:11px;color:var(--text3);margin-top:3px">last 200 saved</div>
    </div>
  </div>
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
    <div style="font-size:13px;color:var(--text2)">${list.length} total entries</div>
    <button class="btn btn-danger btn-sm" onclick="showConfirm('Clear Activity Log?','This will permanently delete all activity log entries.',()=>{DB.activityLog=[];saveDB();renderPage('activitylog');})"><span class="micon" style="font-size:14px">delete</span> Clear Log</button>
  </div>
  ${list.length===0?`<div style="text-align:center;padding:80px 20px;color:var(--text3)"><span class="micon" style="font-size:56px;display:block;margin-bottom:16px;color:var(--border2)">history</span><div style="font-size:16px;font-weight:600;color:var(--text2);margin-bottom:8px">No Activity Yet</div><div>Actions in your dashboard will appear here automatically</div></div>`:''}
  <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
    ${list.map((a,i)=>`
    <div style="display:flex;align-items:center;gap:14px;padding:14px 18px;${i<list.length-1?'border-bottom:1px solid var(--border)':''}">
      <div style="width:40px;height:40px;border-radius:10px;background:${catColor[a.category]||'var(--blue)'}22;display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <span class="micon" style="font-size:20px;color:${catColor[a.category]||'var(--blue)'}">${catIcon[a.category]||'edit_note'}</span>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:14px;margin-bottom:2px">${escHtml(a.action)}</div>
        ${a.details?`<div style="font-size:12px;color:var(--text3)">${escHtml(a.details)}</div>`:''}
        ${a.by?`<div style="font-size:10px;color:var(--text3);margin-top:2px"><span class="micon" style="font-size:12px;vertical-align:middle">person</span> ${escHtml(a.by)}</div>`:''}
      </div>
      <div style="text-align:right;flex-shrink:0">
        <span style="font-size:11px;padding:2px 10px;border-radius:20px;background:${catColor[a.category]||'var(--blue)'}22;color:${catColor[a.category]||'var(--blue)'};margin-bottom:4px;display:inline-block">${a.category||'General'}</span>
        <div style="font-size:11px;color:var(--text3);margin-top:3px">${fmtDate(a.date)} · ${a.time||''}</div>
      </div>
    </div>`).join('')}
  </div>`;
}
function calcBillSplit() {
  const total = Number(document.getElementById('bs-total')?.value||0);
  const method = document.getElementById('bs-method')?.value||'equal';
  const result = document.getElementById('bs-result');
  const saveBtn = document.getElementById('bs-save-btn');
  if(!result) return;
  if(!total || total <= 0) { result.innerHTML=''; if(saveBtn) saveBtn.style.display='none'; return; }

  const activeStudents = DB.students.filter(s=>s.status==='Active');
  const occupiedRooms = [...new Set(activeStudents.map(s=>s.roomId).filter(Boolean))].map(rid=>({
    room: DB.rooms.find(r=>r.id===rid),
    students: activeStudents.filter(s=>s.roomId===rid)
  })).filter(x=>x.room);

  let perUnit = 0, unitLabel = '', rows = [];

  if(method==='equal') {
    const count = activeStudents.length || 1;
    perUnit = Math.ceil(total / count);
    unitLabel = 'per student';
    rows = activeStudents.map(s=>({ name:s.name, room:'Room '+(DB.rooms.find(r=>r.id===s.roomId)?.number||'?'), share:perUnit }));
  } else if(method==='byroom') {
    const count = occupiedRooms.length || 1;
    perUnit = Math.ceil(total / count);
    unitLabel = 'per room';
    rows = occupiedRooms.map(({room,students})=>({ name:'Room '+room.number+' ('+students.length+' students)', room:'', share:perUnit }));
  } else {
    const beds = activeStudents.length || 1;
    perUnit = Math.ceil(total / beds);
    unitLabel = 'per bed/student';
    rows = activeStudents.map(s=>{ const rm=DB.rooms.find(r=>r.id===s.roomId); return { name:s.name, room:'Room '+(rm?.number||'?'), share:perUnit }; });
  }

  window._lastBillSplit = { total, method, perUnit, rows };

  result.innerHTML = `
    <div style="background:var(--bg3);border:1px solid var(--border2);border-radius:12px;padding:20px">
      <div style="display:flex;justify-content:space-between;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border)">
        <div>
          <div style="font-size:12px;color:var(--text3)">Total Bill</div>
          <div style="font-size:24px;font-weight:800;color:var(--text)">${fmtPKR(total)}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:12px;color:var(--text3)">Each Pays (${unitLabel})</div>
          <div style="font-size:24px;font-weight:800;color:var(--gold2)">${fmtPKR(perUnit)}</div>
        </div>
      </div>
      <div style="max-height:300px;overflow-y:auto">
        ${rows.map(r=>`
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
          <div>
            <div style="font-weight:600;font-size:14px">${escHtml(r.name)}</div>
            ${r.room?`<div style="font-size:11px;color:var(--text3)">${r.room}</div>`:''}
          </div>
          <div style="font-weight:700;color:var(--amber)">${fmtPKR(r.share)}</div>
        </div>`).join('')}
      </div>
    </div>`;
  if(saveBtn) saveBtn.style.display='block';
}

function saveBillSplit() {
  if(!window._lastBillSplit) return;
  const { total, method, perUnit } = window._lastBillSplit;
  if(!DB.billSplits) DB.billSplits=[];
  DB.billSplits.push({
    id:'bs_'+uid(),
    type:document.getElementById('bs-type')?.value||'Electricity',
    month:document.getElementById('bs-month')?.value||'',
    total, method, perUnit, date:today()
  });
  logActivity('Bill Split Saved', (document.getElementById('bs-type')?.value||'Electricity')+' '+fmtPKR(total), 'Finance');
  saveDB(); renderPage('billsplit'); toast('Bill split saved to records','success');
}


// ════════════════════════════════════════════════════════════════════════════
// ROOM INSPECTIONS
// ════════════════════════════════════════════════════════════════════════════
const INSPECTION_ITEMS = ['Walls & Paint','Flooring','Windows & Locks','Bathroom','Plumbing','Electrical Fixtures','Fan / AC','Beds & Furniture','Cleanliness','Lighting'];function showAddInspectionModal() {
  const rooms = DB.rooms.map(r=>`<option value="${r.id}">Room ${r.number}</option>`).join('');
  showModal('modal-sm','Room Inspection Checklist',`
    <div class="form-grid">
      <div class="field"><label>Room *</label><select id="ins-room" class="form-control"><option value="">Select Room</option>${rooms}</select></div>
      <div class="field"><label>Overall Condition</label><select id="ins-cond" class="form-control"><option>Good</option><option>Fair</option><option>Poor</option></select></div>
      <div class="field"><label>Inspection Date</label><input id="ins-date" class="form-control cdp-trigger" type="text" readonly onclick="showCustomDatePicker(this,event)" value="${today()}"></div>
      <div class="field"><label>Inspected By</label><input id="ins-by" class="form-control" placeholder="Inspector name"></div>
    </div>
    <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text3);margin:16px 0 10px">✅ Inspection Checklist</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">
      ${INSPECTION_ITEMS.map(item=>`
      <label style="display:flex;align-items:center;gap:10px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:10px 12px;cursor:pointer;transition:border-color 0.2s" onmouseover="this.style.borderColor='var(--gold)'" onmouseout="this.style.borderColor='var(--border)'">
        <input type="checkbox" id="ins-chk-${item.replace(/[^a-z]/gi,'_')}" style="width:16px;height:16px;accent-color:var(--green)">
        <span style="font-size:13px">${item}</span>
      </label>`).join('')}
    </div>
    <div class="field"><label>Notes / Issues Found</label><textarea id="ins-notes" class="form-control" placeholder="Describe any issues or observations..."></textarea></div>`,
  `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveInspection()">Save Inspection</button>`);
}
function saveInspection() {
  const roomId = document.getElementById('ins-room')?.value;
  if(!roomId){toast('Select a room','error');return;}
  const checklist = {};
  INSPECTION_ITEMS.forEach(item=>{ checklist[item] = document.getElementById('ins-chk-'+item.replace(/[^a-z]/gi,'_'))?.checked||false; });
  if(!DB.inspections) DB.inspections=[];
  const room = DB.rooms.find(r=>r.id===roomId);
  DB.inspections.push({
    id:'ins_'+uid(), roomId,
    overallCondition:document.getElementById('ins-cond')?.value||'Good',
    date:document.getElementById('ins-date')?.value||today(),
    inspector:document.getElementById('ins-by')?.value?.trim()||'Admin',
    notes:document.getElementById('ins-notes')?.value?.trim()||'',
    checklist
  });
  logActivity('Room Inspected', 'Room '+(room?.number||''), 'Room');
  saveDB(); closeModal(); renderPage('inspections'); toast('Inspection saved','success');
}
function deleteInspection(id) {
  showConfirm('Delete Inspection?','',()=>{DB.inspections=DB.inspections.filter(x=>x.id!==id);saveDB();renderPage('inspections');toast('Deleted','info');});
}
// ════════════════════════════════════════════════════════════════════════════
// WHATSAPP BULK RENT REMINDER
// ════════════════════════════════════════════════════════════════════════════
function showRentReminderModal() {
  var pending = DB.payments.filter(function(p){return p.status==='Pending';});
  var studentIds = [];
  pending.forEach(function(p){if(p.studentId&&studentIds.indexOf(p.studentId)<0) studentIds.push(p.studentId);});
  var list = studentIds.map(function(sid){
    var s = DB.students.find(function(x){return x.id===sid;});
    var dues = pending.filter(function(p){return p.studentId===sid;});
    var totalDue = dues.reduce(function(sum,p){return sum+Number(p.unpaid!=null?p.unpaid:(p.amount||0));},0);
    var activeDues = dues.filter(function(p){return Number(p.unpaid!=null?p.unpaid:(p.amount||0))>0;});
    return {student:s, dues:activeDues, totalDue:totalDue};
  }).filter(function(x){return x.student && x.totalDue>0;});

  var wardenPhone = (CUR_USER&&CUR_USER.phone) ? CUR_USER.phone : '';
  var defaultNum = DB.settings.defaultWANumber || wardenPhone || '';
  var defaultNumFmt = defaultNum.replace(/[^0-9]/g,'').replace(/^0/,'92');

  var header = '<div style="background:var(--bg4);border:1px solid var(--border2);border-radius:10px;padding:12px;margin-bottom:14px">';
  header += '<div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:6px">&#x1F4F2; Default Notification Number (send all reminders to this number)</div>';
  header += '<div style="display:flex;gap:6px;align-items:center">';
  header += '<input id="wa-default-num" class="form-control" placeholder="e.g. 03001234567" value="'+escHtml(defaultNum)+'" style="flex:1">';
  header += '<button class="btn btn-primary btn-sm" onclick="var v=document.getElementById(\'wa-default-num\').value.trim();DB.settings.defaultWANumber=v;saveDB();toast(\'Saved\',\'success\')">Save</button>';
  if(defaultNumFmt) {
    header += '<a href="https://wa.me/'+defaultNumFmt+'" target="_blank" class="btn btn-sm" style="background:#25d366;color:#fff;border:none;text-decoration:none">&#x1F4E2; Notify</a>';
  }
  header += '</div></div>';

  var info = '<div style="background:var(--amber-dim);border:1px solid rgba(240,160,48,0.3);border-radius:10px;padding:12px;margin-bottom:14px">';
  info += '<div style="font-size:13px;font-weight:700;color:var(--amber);margin-bottom:3px">&#x26A0; '+list.length+' students have pending payments</div>';
  info += '<div style="font-size:11px;color:var(--text2)">Phone numbers are auto-fetched from student records. Click to open WhatsApp.</div></div>';

  var rows = '';
  if(list.length===0) {
    rows = '<div style="text-align:center;padding:24px;color:var(--green)">&#x1F389; All rents collected!</div>';
  } else {
    list.forEach(function(item){
      var student = item.student;
      var dues = item.dues;
      var totalDue = item.totalDue;
      var room = DB.rooms.find(function(r){return r.id===student.roomId;});
      var rawPhone = (student.phone||'').replace(/[^0-9]/g,'').replace(/^0/,'92');
      var msg = encodeURIComponent('Assalamu Alaikum *'+student.name+'*,\n\n'
        +'Reminder from *'+DB.settings.hostelName+'*\n\n'
        +'Dear Student,\n'
        +'This is a reminder that your hostel fee is still pending. Please make the payment as soon as possible to avoid any inconvenience, otherwise late fee charges may apply.\n'
        +'Thank you for your prompt attention.\n\n'
        +'💰 Pending Amount: *'+fmtPKR(totalDue)+'*\n'
        +'Room: #'+(room?room.number:'—')+'\n'
        +'Month(s): '+dues.map(function(d){return d.month;}).join(', '));
      // FIX 5: msg already URL-encoded — no double-encode. Add wa.me web fallback.
      var waDeepLink = rawPhone ? 'whatsapp://send?phone='+rawPhone+'&text='+msg : '';
      var waWebLink  = rawPhone ? 'https://wa.me/'+rawPhone+'?text='+msg : '';
      rows += '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:var(--bg3);border:1px solid var(--border);border-radius:10px;margin-bottom:8px;gap:10px">';
      rows += '<div style="flex:1;min-width:0">';
      rows += '<div style="font-weight:700;font-size:13px">'+escHtml(student.name)+'</div>';
      rows += '<div style="font-size:11px;color:var(--text3);margin-top:2px">Room '+(room?'#'+room.number:'—')+'  ·  '+dues.length+' month(s)  ·  <span style="color:var(--red);font-weight:700">'+fmtPKR(totalDue)+' due</span></div>';
      rows += '<div style="font-size:11px;color:var(--text3)">&#x1F4DE; '+(student.phone||'<span style="color:var(--red)">No phone number on record</span>')+'</div>';
      rows += '</div>';
      rows += '<div style="display:flex;gap:5px;flex-shrink:0">';
      if(rawPhone) {
        rows += '<button onclick="openExternalLink(\''+waDeepLink+'\')" class="btn btn-sm" style="background:#25d366;color:#fff;border:none;font-size:11px;cursor:pointer;display:inline-flex;align-items:center;gap:4px"><svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' width=\'13\' height=\'13\'><path d=\'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z\' fill=\'#fff\'/></svg> App</button>';
        rows += '<a href="'+waWebLink+'" target="_blank" class="btn btn-sm" style="background:#128C7E;color:#fff;border:none;font-size:11px;text-decoration:none;display:inline-flex;align-items:center">&#x1F310; Web</a>';
      } else {
        rows += '<span style="font-size:11px;color:var(--red)">No number</span>';
      }
      rows += '</div></div>';
    });
  }

  showModal('modal-lg','&#x1F4F1; WhatsApp Reminders', header+info+rows,
    '<button class="btn btn-secondary" onclick="closeModal()">Close</button>'
  );
}

// ════════════════════════════════════════════════════════════════════════════
let settingsTab = 'hostel';
function renderSettings() {
  const s = DB.settings;
  const tabs = [
    {id:'hostel', icon:'🏨', label:'Hostel Info'},
    {id:'rooms', icon:'🏠', label:'Room Types'},
    {id:'payments', icon:'💳', label:'Payment Methods'},
    {id:'expenses', icon:'📉', label:'Expense Categories'},
    {id:'floors', icon:'🏗️', label:'Floors'},
    {id:'theme', icon:'🎨', label:'Theme & Display'},
    {id:'data', icon:'💾', label:'Data Management'},
    {id:'rentupdate', icon:'💰', label:'Rent Update'},
    {id:'archive', icon:'📁', label:'Annual Archive'},
    {id:'splash',  icon:'✨', label:'Splash Screen'},
    {id:'license', icon:'🔐', label:'License'}
  
  ];

  const pmList = (s.paymentMethods||[]).map(m=>`<div class="tag-item" id="pm-${escHtml(m)}">${escHtml(m)}<button class="tag-remove" onclick="removePaymentMethod('${escHtml(m)}')">×</button></div>`).join('');
  const ecList = (s.expenseCategories||[]).map(c=>`<div class="tag-item" id="ec-${escHtml(c)}">${escHtml(c)}<button class="tag-remove" onclick="removeExpenseCategory('${escHtml(c)}')">×</button></div>`).join('');
  const floorList = (s.floors||[]).map(f=>`<div class="tag-item" id="fl-${escHtml(f)}">${escHtml(f)}<button class="tag-remove" onclick="removeFloor('${escHtml(f)}')">×</button></div>`).join('');
  const rtRows = (s.roomTypes||[]).map(t=>`
    <div class="room-type-row" id="rt-${t.id}">
      <div class="room-type-color" style="background:${t.color}"></div>
      <input class="form-control" style="flex:2" value="${escHtml(t.name)}" onchange="updateRoomType('${t.id}','name',this.value)" placeholder="Type name">
      <input class="form-control" style="flex:1" type="number" value="${t.capacity}" onchange="updateRoomType('${t.id}','capacity',this.value)" placeholder="Beds">
      <input class="form-control" style="flex:2" type="number" value="${t.defaultRent}" onchange="updateRoomType('${t.id}','defaultRent',this.value)" placeholder="Default rent">
      <input type="color" value="${t.color}" onchange="updateRoomType('${t.id}','color',this.value)" style="width:36px;height:36px;border:1px solid var(--border);border-radius:6px;background:var(--bg3);cursor:pointer;padding:2px">
      <button class="btn btn-danger btn-sm" onclick="removeRoomType('${t.id}')">Remove</button>
    </div>`).join('');

  return `
  <div style="display:grid;grid-template-columns:220px 1fr;gap:20px;align-items:start">
    <div class="card" style="padding:8px;position:sticky;top:80px">
      <div class="settings-nav">
        ${tabs.map(t=>`<div class="settings-tab ${settingsTab===t.id?'active':''}" onclick="settingsTab='${t.id}';renderPage('settings')">${t.icon} ${t.label}</div>`).join('')}
      </div>
    </div>

    <div>
      <!-- HOSTEL INFO -->
      <div class="settings-panel ${settingsTab==='hostel'?'active':''}">
        <div class="card">
          <div class="card-header"><div class="card-title">🏨 Hostel Information</div></div>
          <div class="form-grid">
            <div class="field col-full" style="background:rgba(200,168,75,0.06);border:1px solid rgba(200,168,75,0.2);border-radius:10px;padding:12px 14px">
              <label style="color:var(--gold2);font-weight:800">⚙️ System / App Name <span style="font-size:10px;font-weight:400;color:var(--text3)">(shown in title bar, reports footer &amp; receipts)</span></label>
              <input class="form-control" id="cfg-appname" value="${escHtml(s.appName||'HOSTIX')}" oninput="liveUpdateSetting('appName',this.value)" placeholder="e.g. HOSTIX, MyHostel, Al-Noor HMS…" style="margin-top:6px;font-weight:700;font-size:15px">
              <div style="font-size:10px;color:var(--text3);margin-top:4px">This is your branding name — printed on every receipt and PDF report.</div>
            </div>
            <div class="field"><label>Hostel Name</label><input class="form-control" id="cfg-name" value="${escHtml(s.hostelName)}" oninput="liveUpdateSetting('hostelName',this.value)"></div>
            <div class="field"><label>Tagline</label><input class="form-control" id="cfg-tag" value="${escHtml(s.tagline||'')}" oninput="liveUpdateSetting('tagline',this.value)"></div>
            <div class="field"><label>Location / City</label><input class="form-control" id="cfg-loc" value="${escHtml(s.location)}" oninput="liveUpdateSetting('location',this.value)"></div>
            <div class="field"><label>Contact Phone</label><input class="form-control" id="cfg-phone" value="${escHtml(s.phone||'')}" oninput="liveUpdateSetting('phone',this.value)" placeholder="03XX-XXXXXXX"></div>
            <div class="field"><label>Email Address</label><input class="form-control" id="cfg-email" type="email" value="${escHtml(s.email||'')}" oninput="liveUpdateSetting('email',this.value)" placeholder="hostel@email.com"></div>
            <div class="field"><label>System Version</label><input class="form-control" id="cfg-ver" value="${escHtml(s.version||'v2.0')}" oninput="liveUpdateSetting('version',this.value)"></div>
            <div class="field col-full">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none">
                🔤 Hostel Name Font Style
                <span style="flex:1"></span>
                <span style="font-size:11px;color:var(--text3);font-weight:400;margin-right:6px">Show font picker</span>
                <input type="checkbox" id="font-picker-toggle" ${s.showFontPicker!==false?'checked':''} onchange="DB.settings.showFontPicker=this.checked;saveDB();document.getElementById('font-picker-grid-wrap').style.display=this.checked?'':'none'" style="width:16px;height:16px;cursor:pointer;accent-color:var(--gold2)">
              </label>
              <div id="font-picker-grid-wrap" style="display:${s.showFontPicker!==false?'block':'none'}">
              <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:10px;margin-top:8px;max-height:280px;overflow-y:auto;padding-right:2px">
                ${[
                  ['DM Serif Display','DM Serif'],
                  ['Playfair Display','Playfair'],
                  ['Cinzel','Cinzel'],
                  ['Cormorant Garamond','Cormorant'],
                  ['Libre Baskerville','Baskerville'],
                  ['IM Fell English','Fell English'],
                  ['Philosopher','Philosopher'],
                  ['Yeseva One','Yeseva One'],
                  ['Bebas Neue','Bebas Neue'],
                  ['Rajdhani','Rajdhani'],
                  ['Teko','Teko'],
                  ['Josefin Sans','Josefin Sans'],
                  ['Righteous','Righteous'],
                  ['Georgia','Georgia'],
                  ['Impact','Impact'],
                  ['Trebuchet MS','Trebuchet'],
                  ['Palatino Linotype','Palatino'],
                  ['Arial Black','Arial Black'],
                  ['Times New Roman','Times New Roman'],
                  ['Segoe UI','Segoe UI'],
                ].map(([ff,label])=>`<div onclick="applyHostelFont('${ff}')" style="cursor:pointer;border:2px solid ${(s.hostelNameFont||'DM Serif Display')===ff?'var(--gold)':'var(--border)'};border-radius:8px;padding:8px 6px;text-align:center;background:${(s.hostelNameFont||'DM Serif Display')===ff?'var(--gold-dim)':'var(--bg3)'};transition:all 0.15s" onmouseover="this.style.borderColor='var(--gold2)'" onmouseout="this.style.borderColor='${(s.hostelNameFont||'DM Serif Display')===ff?'var(--gold)':'var(--border)'}'">
                  <div class="font-card-label" style="font-family:'${ff}',serif;font-size:13px;font-weight:700;color:var(--gold2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(s.hostelName||'Hostel Name')}</div>
                  <div style="font-size:8.5px;color:var(--text3);margin-top:2px">${label}</div>
                </div>`).join('')}
              </div>
              <div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:10px 14px;text-align:center">
                <span style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px">Preview: </span>
                <span id="font-preview-name" style="font-family:'${s.hostelNameFont||'DM Serif Display'}',serif;font-size:16px;font-weight:700;color:var(--gold2)">${escHtml(s.hostelName||'DAMAM Boys Hostel')}</span>
              </div>
              </div><!-- /font-picker-grid-wrap -->
            </div>
            <div class="field col-full">
              <label>Currency</label>
              <select class="form-control" id="cfg-curr" onchange="liveUpdateSetting('currency',this.value)">
                ${['PKR','USD','EUR','GBP','AED','SAR'].map(c=>`<option ${s.currency===c?'selected':''}>${c}</option>`).join('')}
              </select>
            </div>
          </div>
          <div style="margin-top:16px;text-align:right">
            <button class="btn btn-primary" onclick="saveSettings()">💾 Save Hostel Info</button>
          </div>
        </div>
      </div>

      <!-- ROOM TYPES -->
      <div class="settings-panel ${settingsTab==='rooms'?'active':''}">
        <div class="card">
          <div class="card-header"><div class="card-title">🏠 Room Types Configuration</div><button class="btn btn-primary btn-sm" onclick="addRoomType()">+ Add Type</button></div>
          <div style="display:grid;grid-template-columns:auto 2fr 1fr 2fr auto auto;gap:10px;margin-bottom:10px;padding:0 4px">
            <div class="stat-label">Color</div><div class="stat-label">Type Name</div><div class="stat-label">Capacity</div><div class="stat-label">Default Rent (PKR)</div><div class="stat-label">Pick Color</div><div></div>
          </div>
          <div id="room-types-list">${rtRows}</div>
          <div style="margin-top:14px;text-align:right">
            <button class="btn btn-primary" onclick="saveSettings()">💾 Save Room Types</button>
          </div>
          <div style="margin-top:16px;background:var(--amber-dim);border:1px solid rgba(240,160,48,0.2);border-radius:var(--radius-sm);padding:12px;font-size:13px;color:var(--amber)">
            ⚠️ Changing room types here updates default values. Existing room rents remain unchanged unless you edit them individually.
          </div>
        </div>
      </div>

      <!-- PAYMENT METHODS -->
      <div class="settings-panel ${settingsTab==='payments'?'active':''}">
        <div class="card">
          <div class="card-header"><div class="card-title">💳 Payment Methods</div></div>
          <div class="tag-list" id="pm-list">${pmList}</div>
          <div style="display:flex;gap:10px;margin-top:14px">
            <input class="form-control" id="new-pm" placeholder="Add new payment method…" onkeydown="if(event.key==='Enter')addPaymentMethod()">
            <button class="btn btn-primary" onclick="addPaymentMethod()">Add</button>
          </div>
        </div>
      </div>

      <!-- EXPENSE CATEGORIES -->
      <div class="settings-panel ${settingsTab==='expenses'?'active':''}">
        <div class="card">
          <div class="card-header"><div class="card-title">📉 Expense Categories</div></div>
          <div class="tag-list" id="ec-list">${ecList}</div>
          <div style="display:flex;gap:10px;margin-top:14px">
            <input class="form-control" id="new-ec" placeholder="Add new category…" onkeydown="if(event.key==='Enter')addExpenseCategory()">
            <button class="btn btn-primary" onclick="addExpenseCategory()">Add</button>
          </div>
        </div>
      </div>

      <!-- APP THEME -->
      <div class="settings-panel ${settingsTab==='theme'?'active':''}">
        <div class="card">
          <div class="card-header"><div class="card-title">🎨 App Theme & Appearance</div></div>
          <div class="settings-section">
            <div class="settings-section-title">Accent Color</div>
            <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:16px">
              ${[['#e05252','Red (Default)'],['#c8a84b','Gold'],['#38bdf8','Sky Blue'],['#2ec98a','Emerald'],['#9b6df0','Purple'],['#f0a030','Amber']].map(([col,lbl])=>`
              <div onclick="applyThemeColor('${col}')" style="border-radius:10px;padding:12px 6px;text-align:center;cursor:pointer;border:2px solid ${(s.accentColor||'#e05252')===col?col:'transparent'};background:${col}22;transition:all 0.2s">
                <div style="width:28px;height:28px;border-radius:50%;background:${col};margin:0 auto 6px"></div>
                <div style="font-size:10px;color:var(--text2);font-weight:600">${lbl}</div>
              </div>`).join('')}
            </div>
            <div style="display:flex;align-items:center;gap:14px;margin-top:10px">
              <div style="flex:1">
                <div style="font-size:13px;font-weight:600;color:var(--text2);margin-bottom:6px">Custom Accent Color</div>
                <div class="color-picker-wrap">
                  <input type="color" value="${s.accentColor||'#e05252'}" id="cfg-accent" onchange="applyThemeColor(this.value)">
                  <span style="font-size:13px;color:var(--text2)" id="accent-hex-label">${s.accentColor||'#e05252'}</span>
                </div>
              </div>
              <button class="btn btn-primary" onclick="applyThemeColor(document.getElementById('cfg-accent').value)">Apply Color</button>
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-section-title">Dashboard Month Auto-Advance</div>
            <div style="display:flex;align-items:center;justify-content:space-between;padding:12px;background:var(--bg3);border:1px solid var(--border);border-radius:10px">
              <div>
                <div style="font-size:13px;font-weight:700;color:var(--text)">Auto-generate rents on 1st of month</div>
                <div style="font-size:12px;color:var(--text3);margin-top:3px">Automatically create pending payment records when a new month starts</div>
              </div>
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                <input type="checkbox" id="cfg-automonth" ${(s.autoMonthGenerate!==false)?'checked':''} onchange="DB.settings.autoMonthGenerate=this.checked;saveDB();toast(this.checked?'Auto-generate enabled':'Auto-generate disabled','info')">
                <span style="font-size:13px;color:var(--text2)">${(s.autoMonthGenerate!==false)?'On':'Off'}</span>
              </label>
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-section-title">Sidebar Width</div>
            <div style="display:flex;align-items:center;gap:12px">
              <input type="range" min="220" max="320" value="${s.sidebarWidth||260}" style="flex:1;accent-color:var(--gold)" oninput="document.getElementById('cfg-sbw-val').textContent=this.value+'px';document.documentElement.style.setProperty('--sidebar-w',this.value+'px');document.getElementById('main').style.marginLeft=this.value+'px'" onchange="DB.settings.sidebarWidth=parseInt(this.value);saveDB()">
              <span id="cfg-sbw-val" style="font-size:13px;color:var(--gold2);font-weight:700;min-width:44px">${s.sidebarWidth||260}px</span>
            </div>
          </div>
        </div>
      </div>

      <!-- FLOORS (existing, kept in place) -->
      <div class="settings-panel ${settingsTab==='floors'?'active':''}">
        <div class="card">
          <div class="card-header"><div class="card-title">🏗️ Building Floors</div></div>
          <div class="tag-list" id="floor-list">${floorList}</div>
          <div style="display:flex;gap:10px;margin-top:14px">
            <input class="form-control" id="new-fl" placeholder="Add floor name (e.g. 4th)…" onkeydown="if(event.key==='Enter')addFloor()">
            <button class="btn btn-primary" onclick="addFloor()">Add</button>
          </div>
        </div>
      </div>

      <!-- DATA MANAGEMENT -->
      <div class="settings-panel ${settingsTab==='data'?'active':''}">
        <div class="card">
          <div class="card-header"><div class="card-title">💾 Data Management</div>
            <div style="font-size:12px;color:var(--text3)">For backup & restore, use the <strong style="color:var(--gold2)">Backup & Restore</strong> option in the sidebar menu.</div>
          </div>
          <div class="form-grid">
            <!-- EXCEL/CSV IMPORT CARD -->
            <div class="card" style="padding:16px;border-color:rgba(74,156,240,0.4);grid-column:span 2">
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
                <div style="width:34px;height:34px;border-radius:8px;background:var(--green-dim);display:flex;align-items:center;justify-content:center;font-size:16px">📊</div>
                <div>
                  <div style="font-weight:700;color:var(--text)">Import Students from Excel / CSV</div>
                  <div style="font-size:12px;color:var(--text3)">Bulk-add students from a spreadsheet — download the template, fill it in, then upload</div>
                </div>
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button class="btn btn-secondary btn-sm" onclick="downloadExcelTemplate()">⬇️ Download Template (.xlsx)</button>
                <button class="btn btn-secondary btn-sm" onclick="downloadCSVTemplate()">⬇️ Download Template (.csv)</button>
                <input type="file" id="excel-import-file" accept=".xlsx,.xls,.csv" style="display:none" onchange="importFromExcel(this)">
                <button class="btn btn-primary btn-sm" onclick="document.getElementById('excel-import-file').click()">📤 Upload & Import File</button>
              </div>
              <div style="margin-top:10px;padding:10px 12px;background:var(--bg3);border-radius:8px;font-size:12px;color:var(--text3)">
                <strong style="color:var(--gold2)">Required columns:</strong> Name, Father Name, CNIC, Phone, Room Number, Monthly Rent, Join Date, Payment Method, Status, Amount Paid
                <span style="margin-left:8px;color:var(--text3)">· Optional: Email, Occupation / Course, Emergency Contact, Notes, Amount Paid</span>
              </div>
            </div>

            <div class="card" style="padding:16px;border-color:var(--border2)">
              <div style="font-weight:700;margin-bottom:6px">System Stats</div>
              <div style="font-size:13px;color:var(--text3)">
                Rooms: ${DB.rooms.length} · Students: ${DB.students.length} · Payments: ${DB.payments.length} · Expenses: ${DB.expenses.length}
              </div>
              <div style="font-size:12px;color:var(--text3);margin-top:8px">Storage: ~${Math.round(JSON.stringify(DB).length/1024)}KB used</div>
            </div>
          </div>
        </div>
      </div>

      <!-- RENT UPDATE -->
      <div class="settings-panel ${settingsTab==='rentupdate'?'active':''}">
        <div class="card">
          <div class="card-header" style="padding-bottom:12px;border-bottom:1px solid var(--border);margin-bottom:16px">
            <div class="card-title" style="font-size:16px;display:flex;align-items:center;gap:8px"><span class="micon" style="font-size:20px;color:var(--gold2)">payments</span>Bulk Rent Update</div>
            <div style="font-size:12px;color:var(--text3);margin-top:4px">Update monthly rent for all or selected students. Changes apply to all future pending payments automatically.</div>
          </div>

          <!-- By Room Type quick-set -->
          <div style="background:var(--bg3);border:1px solid var(--border2);border-radius:10px;padding:16px;margin-bottom:18px">
            <div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:var(--gold2);margin-bottom:12px">⚡ Quick Set by Room Type</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px">
              ${DB.settings.roomTypes.map(function(type){
                var cnt=DB.students.filter(function(s){return s.status==='Active'&&DB.rooms.find(function(r){return r.id===s.roomId&&r.typeId===type.id;});}).length;
                return '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:12px">'
                  +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'
                  +'<div style="width:10px;height:10px;border-radius:3px;background:'+type.color+';flex-shrink:0"></div>'
                  +'<span style="font-size:13px;font-weight:700;color:var(--text)">'+escHtml(type.name)+'</span>'
                  +'<span style="margin-left:auto;font-size:10px;color:var(--text3)">'+cnt+' students</span>'
                  +'</div>'
                  +'<div style="display:flex;gap:6px;align-items:center">'
                  +'<input class="form-control" type="number" id="qr-'+type.id+'" value="'+type.defaultRent+'" style="flex:1;font-size:13px" placeholder="New rent">'
                  +'<button class="btn btn-primary btn-sm" onclick="applyRentByType(\''+type.id+'\')" style="white-space:nowrap;display:flex;align-items:center;gap:4px"><span class="micon" style="font-size:13px">check</span>Apply</button>'
                  +'</div></div>';
              }).join('')}
            </div>
            <div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <input class="form-control" type="number" id="qr-all" placeholder="New rent for ALL students" style="max-width:240px">
              <button class="btn btn-primary" onclick="applyRentToAll()" style="display:flex;align-items:center;gap:6px"><span class="micon" style="font-size:15px">group</span>Apply to All Students</button>
            </div>
          </div>

          <!-- Per-student table -->
          <div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:var(--text3);margin-bottom:10px">Individual Override</div>
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:13px">
              <thead>
                <tr style="background:var(--bg3)">
                  <th style="padding:10px 12px;text-align:left;color:var(--text3);font-size:11px;font-weight:700;text-transform:uppercase">Student</th>
                  <th style="padding:10px 12px;text-align:left;color:var(--text3);font-size:11px;font-weight:700;text-transform:uppercase">Room</th>
                  <th style="padding:10px 12px;text-align:left;color:var(--text3);font-size:11px;font-weight:700;text-transform:uppercase">Type</th>
                  <th style="padding:10px 12px;text-align:left;color:var(--text3);font-size:11px;font-weight:700;text-transform:uppercase">Current Rent</th>
                  <th style="padding:10px 12px;text-align:left;color:var(--text3);font-size:11px;font-weight:700;text-transform:uppercase">New Rent</th>
                  <th style="padding:10px 12px;text-align:center;color:var(--text3);font-size:11px;font-weight:700;text-transform:uppercase">Save</th>
                </tr>
              </thead>
              <tbody>
                ${DB.students.filter(function(s){return s.status==='Active';}).map(function(s,i){
                  var room=DB.rooms.find(function(r){return r.id===s.roomId;});
                  var rtype=room?DB.settings.roomTypes.find(function(t){return t.id===room.typeId;}):null;
                  return '<tr style="border-top:1px solid var(--border);background:'+(i%2?'var(--bg3)':'transparent')+'">'
                    +'<td style="padding:10px 12px"><div style="font-weight:700;color:var(--text)">'+escHtml(s.name)+'</div><div style="font-size:11px;color:var(--text3)">'+escHtml(s.phone||'—')+'</div></td>'
                    +'<td style="padding:10px 12px;font-weight:700;color:var(--gold2)">#'+(room?room.number:'—')+'</td>'
                    +'<td style="padding:10px 12px"><span style="font-size:11px;background:var(--bg4);border:1px solid var(--border2);border-radius:20px;padding:2px 8px;color:var(--text2)">'+(rtype?escHtml(rtype.name):'—')+'</span></td>'
                    +'<td style="padding:10px 12px;font-weight:700;color:var(--green)">'+fmtPKR(s.rent)+'</td>'
                    +'<td style="padding:10px 12px"><input class="form-control" type="number" id="sr-'+s.id+'" value="'+s.rent+'" style="width:120px;font-size:13px" placeholder="New rent"></td>'
                    +'<td style="padding:10px 12px;text-align:center"><button class="btn btn-success btn-sm" onclick="applyRentToStudent(\''+s.id+'\')" style="display:flex;align-items:center;gap:4px;margin:0 auto"><span class="micon" style="font-size:13px">check_circle</span>Save</button></td>'
                    +'</tr>';
                }).join('')}
              </tbody>
            </table>
          </div>
          ${DB.students.filter(function(s){return s.status==='Active';}).length===0?'<div style="text-align:center;padding:40px;color:var(--text3)">No active students found</div>':''}
        </div>
      </div>

    </div>
  </div>
      <!-- ANNUAL ARCHIVE PANEL -->
      <div class="settings-panel ${settingsTab==='archive'?'active':''}" style="text-align:center;padding:60px 20px;">
        <div style="font-size:48px;margin-bottom:16px">📁</div>
        <div style="font-size:18px;font-weight:800;color:var(--text);margin-bottom:8px">Annual Archive</div>
        <div style="font-size:13px;color:var(--text3);margin-bottom:20px">View full year financial breakdown, monthly trends and reports</div>
        <button class="btn btn-primary" onclick="navigate('archive')">Open Annual Archive →</button>
      </div>

      <!-- SPLASH SCREEN -->
      <div class="settings-panel ${settingsTab==='splash'?'active':''}">
        <div class="card">
          <div class="card-header">
            <div class="card-title">✨ Splash Screen</div>
            <div style="font-size:11px;color:var(--text3);margin-top:2px">Customize the welcome screen shown after login</div>
          </div>
          ${renderSplashSettings()}
        </div>
      </div>

      <!-- LICENSE -->
      <div class="settings-panel ${settingsTab==='license'?'active':''}">
        ${renderLicenseSettingsPanel()}
      </div>

    </div>
  </div>`;
}

function bindSettingsEvents() {}

// ── License Settings Panel (rendered inside Settings page) ────────────────────
function renderLicenseSettingsPanel() {
  const licCache = window._damam_license_cache;
  const hasLic   = licCache && licCache.valid;
  const expStr   = hasLic && licCache.expiry
    ? new Date(licCache.expiry).toLocaleDateString('en-PK',{day:'2-digit',month:'long',year:'numeric'})
    : '—';
  const keyStr   = hasLic && licCache.key
    ? (() => { const p = licCache.key.split('-'); return p.length===4 ? p[0]+'-'+p[1]+'-····-'+p[3] : licCache.key; })()
    : '—';

  return `
  <div class="card">
    <div class="card-header">
      <div class="card-title" style="display:flex;align-items:center;gap:8px">
        🔐 License Information
        <span style="font-size:11px;padding:2px 10px;border-radius:20px;font-weight:700;
          ${hasLic
            ? 'background:rgba(46,201,138,0.15);border:1px solid rgba(46,201,138,0.4);color:#2ec98a'
            : 'background:rgba(224,82,82,0.15);border:1px solid rgba(224,82,82,0.4);color:#e05252'}">
          ${hasLic ? '✅ Active' : '❌ Not Active'}
        </span>
      </div>
    </div>
    <div class="form-grid">
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px 16px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text3);margin-bottom:10px">License Key</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--gold2);letter-spacing:1px">${escHtml(keyStr)}</div>
      </div>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px 16px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text3);margin-bottom:10px">Valid Until</div>
        <div style="font-size:13px;font-weight:700;color:${hasLic?'var(--green)':'var(--text3)'}">${escHtml(expStr)}</div>
      </div>
    </div>
    <div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-secondary" onclick="openLicenseSettingsWindow()" style="display:flex;align-items:center;gap:6px">
        ⚙️ Manage License (Deactivate / Reset)
      </button>
    </div>
    <div style="margin-top:12px;background:rgba(30,64,128,0.1);border:1px solid rgba(30,64,128,0.25);border-radius:8px;padding:10px 14px;font-size:12px;color:var(--text3);line-height:1.6">
      To deactivate, reset, or prepare for uninstall, click <strong style="color:var(--text2)">Manage License</strong>
      above. You can also reach this from <strong style="color:var(--text2)">Help → License Settings</strong> in the menu bar.
    </div>
  </div>`;
}

function openLicenseSettingsWindow() {
  // Password gate removed — warden already authenticated via app login
  if (window.electronAPI && window.electronAPI.licenseOpenSettings) {
    window.electronAPI.licenseOpenSettings();
  } else {
    toast('License settings window not available in dev/browser mode.', 'info');
  }
}
function _doLicenseUnlock() { openLicenseSettingsWindow(); }
function liveUpdateSetting(key, val) {
  DB.settings[key] = val;
  saveDB();
  if(key==='appName') {
    const sbVer = document.getElementById('sb-version');
    if(sbVer) sbVer.textContent = (val||'HOSTIX') + ' · ' + (DB.settings.version||'v3.0');
    // Update page title
    document.title = (val||'HOSTIX') + ' | Hostel Management System';
  }
  if(key==='hostelName') {
    // Update sidebar name
    const sbName = document.getElementById('sb-hostel-name');
    if(sbName) sbName.textContent = val;
    // Update login screen hostel name
    const loginName = document.getElementById('login-hostel-name');
    if(loginName) loginName.textContent = val;
    // Update font-style preview cards — text AND preserve selected font
    const prev = document.getElementById('font-preview-name');
    if(prev) {
      prev.textContent = val || 'Hostel Name Preview';
      // Keep the currently selected font applied to the preview
      const ff = DB.settings.hostelNameFont || 'DM Serif Display';
      prev.style.fontFamily = `'${ff}', serif`;
    }
    // Also update each individual font card label so every card shows new name
    document.querySelectorAll('.font-card-label').forEach(el => {
      el.textContent = val || 'Hostel Name Preview';
    });
  }
  // BUG FIX: tagline changes were never reflected in the sidebar sub-label
  if(key==='tagline') {
    const subLbl = document.getElementById('sb-location-sub');
    if(subLbl) subLbl.textContent = val || 'Boys Residence';
  }
  if(key==='location') {
    const loc = document.getElementById('sb-location');
    if(loc) loc.textContent = val;
    // Also sync login screen address
    const loginAddr = document.getElementById('login-address');
    if(loginAddr) loginAddr.innerHTML = val ? `&#x1F4CD; ${val}` : '';
  }
  if(key==='version') {
    const ver = document.getElementById('sb-version');
    if(ver) ver.textContent = 'Management System ' + val;
  }
}
function applyHostelFont(fontFamily) {
  DB.settings.hostelNameFont = fontFamily;
  saveDB();
  // Apply to sidebar name
  const nameEl = document.getElementById('sb-hostel-name');
  if(nameEl) nameEl.style.fontFamily = `'${fontFamily}', serif`;
  // Update the live preview span immediately without full page re-render
  const prev = document.getElementById('font-preview-name');
  if(prev) {
    prev.style.fontFamily = `'${fontFamily}', serif`;
    prev.textContent = DB.settings.hostelName || 'Hostel Name Preview';
  }
  toast('Font updated — ' + fontFamily, 'success');
  renderPage('settings');
}
function saveSettings() {
  saveDB(); toast('Settings saved successfully','success');
}
// ── BULK RENT UPDATE ─────────────────────────────────────────────────────────
function _applyRentToStudentCore(student, newRent) {
  // Update student rent
  student.rent = newRent;
  // Update all PENDING payment records for this student so future dues are correct
  DB.payments.forEach(function(p) {
    if (p.studentId === student.id && p.status === 'Pending') {
      const oldUnpaid = p.unpaid != null ? Number(p.unpaid) : Number(p.amount);
      p.monthlyRent = newRent;
      // Recalculate unpaid based on new rent minus what was already paid
      const alreadyPaid = Number(p.amount) || 0;
      p.unpaid = Math.max(0, newRent - alreadyPaid - (p.discount || 0));
    }
  });
}

function applyRentToStudent(studentId) {
  const s = DB.students.find(x => x.id === studentId); if (!s) return;
  const inp = document.getElementById('sr-' + studentId); if (!inp) return;
  const newRent = parseFloat(inp.value);
  if (!newRent || newRent <= 0) { toast('Enter a valid rent amount', 'error'); return; }
  if (newRent === s.rent) { toast('Rent unchanged', 'info'); return; }
  const old = s.rent;
  _applyRentToStudentCore(s, newRent);
  s._rentManuallySet = true; // Fix #14: flag so auto defaultRent changes don't override this
  logActivity('Rent Updated', s.name + ' — ' + fmtPKR(old) + ' → ' + fmtPKR(newRent), 'Finance');
  saveDB();
  renderPage('settings');
  toast('Rent updated for ' + s.name + ' → ' + fmtPKR(newRent), 'success');
}

function applyRentByType(typeId) {
  const inp = document.getElementById('qr-' + typeId); if (!inp) return;
  const newRent = parseFloat(inp.value);
  if (!newRent || newRent <= 0) { toast('Enter a valid rent amount', 'error'); return; }
  const type = DB.settings.roomTypes.find(t => t.id === typeId); if (!type) return;
  // Update defaultRent for this room type
  type.defaultRent = newRent;
  // Apply to all active students in rooms of this type
  let count = 0;
  DB.students.filter(s => s.status === 'Active').forEach(function(s) {
    const room = DB.rooms.find(r => r.id === s.roomId);
    if (room && room.typeId === typeId) {
      _applyRentToStudentCore(s, newRent);
      count++;
    }
  });
  logActivity('Bulk Rent Update', type.name + ' — all ' + count + ' students → ' + fmtPKR(newRent), 'Finance');
  saveDB();
  renderPage('settings');
  toast(count + ' student(s) updated to ' + fmtPKR(newRent), 'success');
}

function applyRentToAll() {
  const inp = document.getElementById('qr-all'); if (!inp) return;
  const newRent = parseFloat(inp.value);
  if (!newRent || newRent <= 0) { toast('Enter a valid rent amount', 'error'); return; }
  showConfirm(
    'Update ALL students rent?',
    'This will set ' + fmtPKR(newRent) + ' as the new monthly rent for every active student and update all pending payments.',
    function() {
      let count = 0;
      DB.students.filter(s => s.status === 'Active').forEach(function(s) {
        _applyRentToStudentCore(s, newRent);
        count++;
      });
      // Also update all room type defaults
      DB.settings.roomTypes.forEach(function(t) { t.defaultRent = newRent; });
      logActivity('Global Rent Update', 'All ' + count + ' students → ' + fmtPKR(newRent), 'Finance');
      saveDB();
      renderPage('settings');
      toast('All ' + count + ' students updated to ' + fmtPKR(newRent), 'success');
    }
  );
}
// ─────────────────────────────────────────────────────────────────────────────

function updateRoomType(id, field, val) {
  const t=DB.settings.roomTypes.find(x=>x.id===id); if(!t) return;
  const oldRent = t.defaultRent;
  if(field==='capacity'||field==='defaultRent') t[field]=parseFloat(val)||t[field];
  else t[field]=val;
  // Fix #14: When defaultRent changes, update all rooms of this type AND their active students
  if(field==='defaultRent' && t.defaultRent !== oldRent) {
    const newRent = t.defaultRent;
    DB.rooms.forEach(function(r) {
      if(r.typeId !== id) return;
      r.rent = newRent; // update room default rent
      // Update all active students in this room whose rent matched the old default
      DB.students.forEach(function(s) {
        if(s.roomId === r.id && s.status === 'Active' && (s.rent === oldRent || !s._rentManuallySet)) {
          s.rent = newRent;
          // Also update any pending payments for this student
          DB.payments.forEach(function(p) {
            if(p.studentId === s.id && p.status === 'Pending') {
              p.monthlyRent = newRent; p.totalRent = newRent;
              p.unpaid = Math.max(0, newRent - (p.amount||0));
            }
          });
        }
      });
    });
    toast('Default rent updated to '+fmtPKR(newRent)+' — rooms & students updated', 'success');
  }
  saveDB();
}
function addRoomType() {
  const id='rt_'+uid();
  DB.settings.roomTypes.push({id,name:'New Type',capacity:1,defaultRent:16000,color:'#4a9cf0'});
  saveDB(); renderPage('settings'); toast('Room type added','success');
}
function removeRoomType(id) {
  if(DB.settings.roomTypes.length<=1){toast('Must have at least one room type','error');return;}
  if(DB.rooms.some(r=>r.typeId===id)){toast('Cannot remove type: rooms are using it','error');return;}
  DB.settings.roomTypes=DB.settings.roomTypes.filter(x=>x.id!==id);
  saveDB(); renderPage('settings'); toast('Room type removed','info');
}
function addPaymentMethod() {
  const val=document.getElementById('new-pm').value.trim();
  if(!val||DB.settings.paymentMethods.includes(val)){toast(val?'Already exists':'Enter a name','error');return;}
  DB.settings.paymentMethods.push(val);
  saveDB(); renderPage('settings'); toast('Payment method added','success');
}
function removePaymentMethod(m) {
  if(DB.settings.paymentMethods.length<=1){toast('Must keep at least one method','error');return;}
  DB.settings.paymentMethods=DB.settings.paymentMethods.filter(x=>x!==m);
  saveDB(); renderPage('settings');
}
function addExpenseCategory() {
  const val=document.getElementById('new-ec').value.trim();
  if(!val||DB.settings.expenseCategories.includes(val)){toast(val?'Already exists':'Enter a name','error');return;}
  DB.settings.expenseCategories.push(val);
  saveDB(); renderPage('settings'); toast('Category added','success');
}
function removeExpenseCategory(c) {
  if(DB.settings.expenseCategories.length<=1){toast('Must keep at least one category','error');return;}
  DB.settings.expenseCategories=DB.settings.expenseCategories.filter(x=>x!==c);
  saveDB(); renderPage('settings');
}
function addFloor() {
  const val=document.getElementById('new-fl').value.trim();
  if(!val||DB.settings.floors.includes(val)){toast(val?'Already exists':'Enter a name','error');return;}
  DB.settings.floors.push(val);
  saveDB(); renderPage('settings'); toast('Floor added','success');
}
function removeFloor(f) {
  if(DB.settings.floors.length<=1){toast('Must keep at least one floor','error');return;}
  if(DB.rooms.some(r=>r.floor===f)){toast('Cannot remove: rooms are on this floor','error');return;}
  DB.settings.floors=DB.settings.floors.filter(x=>x!==f);
  saveDB(); renderPage('settings');
}
function exportData() {
  const blob=new Blob([JSON.stringify(DB,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download=`${DB.settings.hostelName.replace(/\s+/g,'_')}_backup_${today()}.json`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1500); // FIX 17: revoke blob URL to free memory
  toast('Data exported successfully','success');
}
function importData(input) {
  const file=input.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    try {
      const data=JSON.parse(e.target.result);
      showConfirm('Import Data?','This will replace all current data with the imported backup.',()=>{
        DB=_initDBFields(data); // FIX 24: normalize schema on import same as restoreBackup
        saveDB(); navigate('dashboard'); toast('Data imported successfully','success');
      });
    } catch(err){ toast('Invalid backup file','error'); }
  };
  reader.readAsText(file);
}

// ════════════════════════════════════════════════════════════════════════════
// EXCEL / CSV IMPORT
// ════════════════════════════════════════════════════════════════════════════

function _excelTemplateRows() {
  return [
    ['Name*','Father Name*','CNIC','Phone','Email','Occupation / Course','Room Number*','Monthly Rent*','Join Date (YYYY-MM-DD)*','Payment Method','Status','Amount Paid','Emergency Contact','Notes'],
    ['Muhammad Ali','Muhammad Khan','35201-1234567-1','03001234567','m.ali@example.com','BS Computer Science','A 01','16000',today(),'Cash','Active','0','Guardian — 0300000000','Demo student'],
    ['Ahmed Hassan','Hassan Ali','35202-9876543-2','03119876543','','Teacher','A 02','18000',today(),'JazzCash','Active','18000','','Full first month paid'],
  ];
}

function downloadExcelTemplate() {
  if (typeof XLSX === 'undefined') {
    toast('SheetJS library not loaded — check your internet connection and try again.','error');
    return;
  }
  const ws = XLSX.utils.aoa_to_sheet(_excelTemplateRows());
  // Style header row width
  ws['!cols'] = [20,18,18,14,22,20,10,12,18,12,10,14,24,20].map(w=>({wch:w}));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Student');
  XLSX.writeFile(wb, 'DAMAM_Students_Template.xlsx');
  toast('Template downloaded — fill it in and re-upload','success');
}

function downloadCSVTemplate() {
  const rows = _excelTemplateRows();
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'DAMAM_Students_Template.csv';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1500);
  toast('CSV template downloaded','success');
}

function importFromExcel(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = ''; // reset so same file can be re-picked

  if (typeof XLSX === 'undefined') {
    toast('SheetJS library not loaded — connect to the internet and reload the page.','error');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const wb   = XLSX.read(data, {type:'array', cellDates:true});
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, {defval:'', raw:false});

      if (!rows.length) { toast('Spreadsheet appears empty','error'); return; }

      // Normalize column names: lowercase, strip spaces/asterisks
      function norm(s) { return String(s||'').toLowerCase().replace(/[^a-z0-9]/g,''); }
      const firstRow = rows[0];
      const keyMap = {}; // normalized → original key
      Object.keys(firstRow).forEach(k => { keyMap[norm(k)] = k; });

      function getCol(row, ...aliases) {
        for (const a of aliases) {
          const k = keyMap[norm(a)];
          if (k !== undefined && row[k] !== undefined && String(row[k]).trim() !== '') return String(row[k]).trim();
        }
        return '';
      }

      // Parse each row
      const preview = [];
      const errors  = [];

      rows.forEach((row, idx) => {
        const lineNo = idx + 2; // row 1 = header
        const name   = getCol(row,'Name','Full Name','Student Name','Student');
        const roomNo = getCol(row,'Room Number','Room No','Room','RoomNo','Room Name','RoomNumber','Room#','Rm');
        const rent   = parseFloat(getCol(row,'Monthly Rent','Rent','Fee','MonthlyRent')) || 0;

        if (!name)   { errors.push(`Row ${lineNo}: Name is required`); return; }
        if (!roomNo) { errors.push(`Row ${lineNo}: Room Number is required for ${name}`); return; }
        if (!rent)   { errors.push(`Row ${lineNo}: Monthly Rent is required for ${name}`); return; }

        // Find matching room by number — normalize both sides (strip spaces, lowercase)
        const _normRm = s => String(s).replace(/\s+/g,'').toLowerCase();
        const room = DB.rooms.find(r => _normRm(r.number) === _normRm(roomNo));
        if (!room) { errors.push(`Row ${lineNo}: Room #${roomNo} does not exist in app — skipping ${name}`); return; }

        // Check room capacity
        const rtype = getRoomType(room);
        if (getRoomOccupancy(room) >= rtype.capacity) {
          errors.push(`Row ${lineNo}: Room #${roomNo} is full — skipping ${name}`);
          return;
        }

        const joinDateRaw = getCol(row,'Join Date','JoinDate','Date','Joining Date','Admission Date');
        // Normalize date: try various formats
        let joinDate = today();
        if (joinDateRaw) {
          // SheetJS sometimes gives Date objects formatted as strings already
          const d = new Date(joinDateRaw);
          if (!isNaN(d.getTime())) joinDate = d.toISOString().split('T')[0];
          else joinDate = today();
        }

        const paidAtAdmission = parseFloat(getCol(row,'Amount Paid','Deposit','Advance','Deposit Paid','InitialPayment','AdvancePaid','Paid','Admission Payment','Paid At Admission')) || 0;
        const method = getCol(row,'Payment Method','Method','PaymentMethod') || DB.settings.paymentMethods[0] || 'Cash';
        const status = getCol(row,'Status','Student Status') || 'Active';

        preview.push({
          name,
          fatherName: getCol(row,'Father Name','FatherName','Father','Guardian'),
          cnic:       getCol(row,'CNIC','NIC','ID'),
          phone:      getCol(row,'Phone','Mobile','Contact','Cell','Phone Number','Contact Number','Tel'),
          email:      getCol(row,'Email','Email Address'),
          occupation: getCol(row,'Occupation','Course','Department','Occupation / Course','Study','Field','Program','Degree'),
          emergencyContact: getCol(row,'Emergency Contact','EmergencyContact','Guardian Contact'),
          notes:      getCol(row,'Notes','Remarks','Note'),
          roomId:     room.id,
          roomNumber: room.number,
          rent,
          joinDate,
          paidAtAdmission,
          paymentMethod: method,
          status: ['Active','Left','Blacklisted'].includes(status) ? status : 'Active',
        });
      });

      if (!preview.length && errors.length) {
        toast('No valid rows found. Check the errors below.','error');
        _showExcelImportResult([], errors);
        return;
      }

      _showExcelImportPreview(preview, errors);
    } catch(err) {
      console.error('Excel import error:', err);
      toast('Could not read file: ' + err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

function _showExcelImportPreview(rows, errors) {
  const errHtml = errors.length
    ? `<div style="background:var(--red-dim);border:1px solid rgba(224,82,82,0.3);border-radius:8px;padding:12px;margin-bottom:14px">
        <div style="font-size:12px;font-weight:700;color:var(--red);margin-bottom:6px">⚠️ ${errors.length} row${errors.length!==1?'s':''} skipped:</div>
        ${errors.map(e=>`<div style="font-size:11.5px;color:var(--text2);padding:2px 0">• ${escHtml(e)}</div>`).join('')}
       </div>` : '';

  const tableRows = rows.slice(0,20).map(r=>`
    <tr>
      <td class="fw-700" style="color:var(--blue)">${escHtml(r.name)}</td>
      <td style="color:var(--text2)">${escHtml(r.fatherName||'—')}</td>
      <td style="color:var(--gold2)">Rm #${r.roomNumber}</td>
      <td style="color:var(--green)">${fmtPKR(r.rent)}</td>
      <td style="font-size:11px;color:var(--text3)">${r.joinDate}</td>
      <td>${r.paidAtAdmission>0?`<span style="color:var(--green)">${fmtPKR(r.paidAtAdmission)}</span>`:'<span style="color:var(--text3)">—</span>'}</td>
      <td>${statusBadge(r.status)}</td>
    </tr>`).join('');

  showModal('modal-xl', '📊 Excel Import Preview', `
    <div style="background:var(--green-dim);border:1px solid rgba(46,201,138,0.3);border-radius:8px;padding:12px 16px;margin-bottom:14px;display:flex;align-items:center;gap:10px">
      <div style="font-size:22px">✅</div>
      <div>
        <div style="font-weight:700;color:var(--green)">${rows.length} student${rows.length!==1?'s':''} ready to import</div>
        <div style="font-size:12px;color:var(--text3)">Review the data below before confirming. Duplicate names in the same room will still be added.</div>
      </div>
    </div>
    ${errHtml}
    <div style="overflow-x:auto;max-height:340px;overflow-y:auto">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:var(--bg4);position:sticky;top:0">
          <th style="padding:9px 12px;text-align:left;font-size:11px;color:var(--text3);font-weight:700;text-transform:uppercase">Name</th>
          <th style="padding:9px 12px;text-align:left;font-size:11px;color:var(--text3);font-weight:700;text-transform:uppercase">Father</th>
          <th style="padding:9px 12px;text-align:left;font-size:11px;color:var(--text3);font-weight:700;text-transform:uppercase">Room</th>
          <th style="padding:9px 12px;text-align:left;font-size:11px;color:var(--text3);font-weight:700;text-transform:uppercase">Rent</th>
          <th style="padding:9px 12px;text-align:left;font-size:11px;color:var(--text3);font-weight:700;text-transform:uppercase">Join Date</th>
          <th style="padding:9px 12px;text-align:left;font-size:11px;color:var(--text3);font-weight:700;text-transform:uppercase">Initial Paid</th>
          <th style="padding:9px 12px;text-align:left;font-size:11px;color:var(--text3);font-weight:700;text-transform:uppercase">Status</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
      ${rows.length>20?`<div style="padding:10px;text-align:center;font-size:12px;color:var(--text3)">… and ${rows.length-20} more rows (all will be imported)</div>`:''}
    </div>`,
  `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
   <button class="btn btn-primary" style="background:linear-gradient(135deg,#0d2d1a,#0a2015);border-color:rgba(46,201,138,0.5);color:var(--green)" onclick="confirmExcelImport()">✅ Import ${rows.length} Students</button>`
  );
  // Store rows in a safe global — avoids JSON-in-onclick breakage on apostrophes/special chars
  window._excelImportRows = rows;
}

function confirmExcelImport() {
  const rows = window._excelImportRows || [];
  window._excelImportRows = null;
  closeModal();
  let added = 0, skipped = 0;
  rows.forEach(r => {
    // Re-check room capacity at import time
    const room = DB.rooms.find(x => x.id === r.roomId);
    if (!room) { skipped++; return; }
    const rtype = getRoomType(room);
    if (getRoomOccupancy(room) >= rtype.capacity) { skipped++; return; }

    const studentId = nextStudentId();
    const unpaid = Math.max(0, r.rent - r.paidAtAdmission);
    const mo = new Date(r.joinDate).toLocaleString('default',{month:'long',year:'numeric'});

    DB.students.push({
      id: studentId,
      name: r.name,
      fatherName: r.fatherName || '',
      cnic: r.cnic || '',
      phone: r.phone || '',
      email: r.email || '',
      occupation: r.occupation || '',
      emergencyContact: r.emergencyContact || '',
      notes: r.notes || '',
      roomId: r.roomId,
      rent: r.rent,
      deposit: r.paidAtAdmission,
      joinDate: r.joinDate,
      paymentMethod: r.paymentMethod,
      status: r.status,
      createdAt: today(),
      docs: { photo: '' }
    });

    // Create payment record for this student (same as manual admission)
    DB.payments.push({
      id: 'p_' + uid(),
      studentId,
      studentName: r.name,
      roomId: r.roomId,
      roomNumber: room.number,
      amount: r.paidAtAdmission,
      monthlyRent: r.rent,
      unpaid,
      method: r.paymentMethod,
      month: mo,
      date: r.joinDate,
      dueDate: '',
      status: r.paidAtAdmission >= r.rent ? 'Paid' : 'Pending',
      paidDate: r.paidAtAdmission >= r.rent ? r.joinDate : '',
      notes: r.paidAtAdmission > 0 ? 'Paid at admission (imported)' : 'Imported via Excel',
      byWarden: ''
    });
    added++;
  });

  logActivity('Excel Import', `${added} students imported from spreadsheet`, 'Student');
  saveDB();
  navigate('students');
  toast(`✅ ${added} student${added!==1?'s':''} imported successfully${skipped>0?' ('+skipped+' skipped — room full)':''}`, 'success');
}

function _showExcelImportResult(rows, errors) {
  showModal('modal-sm','Import Result',`
    <div style="text-align:center;padding:20px 0">
      <div style="font-size:36px;margin-bottom:10px">⚠️</div>
      <div style="font-weight:700;font-size:16px;margin-bottom:14px">No rows could be imported</div>
      ${errors.map(e=>`<div style="font-size:12px;color:var(--red);padding:3px 0">${escHtml(e)}</div>`).join('')}
    </div>`,
  `<button class="btn btn-primary" onclick="closeModal()">OK</button>`);
}
// ════════════════════════════════════════════════════════════════════════════
function resetAllData() {
  showConfirm('⚠️ Reset ALL Data?','This will permanently delete all students, payments, expenses, maintenance, complaints, fines, notices, inspections and bill splits. Rooms will be reset. This CANNOT be undone.',()=>{
    // BUG FIX: Previously only cleared students/payments/expenses, leaving
    // maintenance, complaints, fines, notices, activityLog, inspections,
    // billSplits, cancellations, checkinlog as orphaned ghost records.
    DB.students=[];
    DB.payments=[];
    DB.expenses=[];
    DB.cancellations=[];
    DB.maintenance=[];
    DB.complaints=[];
    DB.fines=[];
    DB.notices=[];
    DB.activityLog=[];
    DB.inspections=[];
    DB.billSplits=[];
    DB.checkinlog=[];
    DB.rooms=generateRooms();
    saveDB(); navigate('dashboard'); toast('All data reset','info');
  });
}

function shareReportWhatsApp() {
  const mo=reportPeriod==='month'?thisMonth():thisYear();
  const rev=calcRevenue(mo);
  const exps=DB.expenses.filter(e=>e.date?.startsWith(mo)).reduce((s,e)=>s+Number(e.amount),0);
  const occ=DB.rooms.filter(r=>getRoomOccupancy(r)>0).length;
  const msg=`*${DB.settings.hostelName}*
*${reportPeriod==='month'?'Monthly':'Annual'} Report*
━━━━━━━━━━━━━━━━━━━━
💰 *Revenue:* ${fmtPKR(rev)}
📉 *Expenses:* ${fmtPKR(exps)}
📊 *Available Fund:* ${fmtPKR(rev-exps)}
━━━━━━━━━━━━━━━━━━━━
🏠 *Rooms:* ${occ}/${DB.rooms.length} occupied
👥 *Active Students:* ${DB.students.filter(t=>t.status==='Active').length}
━━━━━━━━━━━━━━━━━━━━
Generated by ${DB.settings.hostelName} MS`;
  openExternalLink('whatsapp://send?text='+encodeURIComponent(msg));
}

function shareReportEmail() {
  const mo=reportPeriod==='month'?thisMonth():thisYear();
  const rev=calcRevenue(mo);
  const exps=DB.expenses.filter(e=>e.date?.startsWith(mo)).reduce((s,e)=>s+Number(e.amount),0);
  const occ=DB.rooms.filter(r=>getRoomOccupancy(r)>0).length;
  const subject=encodeURIComponent(`${reportPeriod==='month'?'Monthly':'Annual'} Report — ${DB.settings.hostelName}`);
  const body=encodeURIComponent(`${DB.settings.hostelName}\n${reportPeriod==='month'?'Monthly':'Annual'} Financial Report\n${'─'.repeat(40)}\n\nREVENUE: ${fmtPKR(rev)}\nEXPENSES: ${fmtPKR(exps)}\nNET PROFIT: ${fmtPKR(rev-exps)}\nROOMS: ${occ}/${DB.rooms.length} occupied\nACTIVE STUDENTS: ${DB.students.filter(t=>t.status==='Active').length}\n\n${'─'.repeat(40)}\nGenerated ${new Date().toLocaleDateString()} by ${DB.settings.hostelName} Management System`);
  // Open Gmail compose directly in browser
  openExternalLink('https://mail.google.com/mail/?view=cm&fs=1&su='+subject+'&body='+body);
}

// ── REPORT DROPDOWN TOGGLE ────────────────────────────────────────────────────
function toggleRptDrop(id) {
  const el = document.getElementById(id);
  if(!el) return;
  const isOpen = el.style.display === 'block';
  // Close all report dropdowns first
  ['rpt-print-drop','rpt-stu-drop'].forEach(function(did) {
    const d = document.getElementById(did);
    if(d) d.style.display = 'none';
  });
  if(!isOpen) {
    el.style.display = 'block';
    // Close when clicking outside
    setTimeout(function() {
      function outside(e) {
        if(!el.contains(e.target)) { el.style.display='none'; document.removeEventListener('click',outside,true); }
      }
      document.addEventListener('click', outside, true);
    }, 10);
  }
}

// ── SHARE ALL-STUDENTS PDF SUMMARY via WhatsApp ───────────────────────────────
function shareAllStudentsPDFWhatsApp() {
  const mo = thisMonth();
  const moLabel = thisMonthLabel();

  // Per-student fee data for this month
  const activeStudents = DB.students.filter(function(s){ return s.status==='Active'; })
    .slice().sort(function(a,b){ return (a.name||'').localeCompare(b.name||''); });

  var grandPaid = 0, grandPending = 0, grandRent = 0;

  var studentLines = activeStudents.map(function(s) {
    var room = DB.rooms.find(function(r){ return r.id===s.roomId; });
    var roomNo = room ? '#'+room.number : '—';
    var _mkDate = new Date(mo+'-01');
    var _mkLabel = _mkDate.toLocaleString('default',{month:'long',year:'numeric'});
    var _mkLabel2 = _mkDate.toLocaleString('default',{month:'short',year:'numeric'});
    var mPays = DB.payments.filter(function(p){
      return p.studentId===s.id && _payMatchesMonth(p, mo);
    });
    var paid    = mPays.filter(function(p){return p.status==='Paid';}).reduce(function(s,p){return s+Number(p.amount);},0);
    var pending = mPays.filter(function(p){return p.status==='Pending';}).reduce(function(s,p){return s+(p.unpaid!=null?Number(p.unpaid):Number(p.amount));},0);
    var status  = mPays.length===0 ? '⬜ No record' : pending>0 ? '🔴 Pending' : '✅ Paid';
    grandRent    += Number(s.rent||0);
    grandPaid    += paid;
    grandPending += pending;
    return status+' '+escHtml(s.name)+' ('+roomNo+') Rent:'+fmtPKR(s.rent)+(paid>0?' Paid:'+fmtPKR(paid):'')+(pending>0?' Due:'+fmtPKR(pending):'');
  });

  var lines = [
    '*'+DB.settings.hostelName+'*',
    '*Students Fee Report — '+moLabel+'*',
    '━━━━━━━━━━━━━━━━━━━━'
  ].concat(studentLines).concat([
    '━━━━━━━━━━━━━━━━━━━━',
    '👥 Total Active: '+activeStudents.length,
    '✅ Collected: '+fmtPKR(grandPaid),
    '🔴 Pending: '+fmtPKR(grandPending),
    '📅 Generated: '+new Date().toLocaleDateString()
  ]);

  openExternalLink('whatsapp://send?text=' + encodeURIComponent(lines.join('\n')));
}

// ── SHARE ALL-STUDENTS PDF SUMMARY via Gmail ──────────────────────────────────
function shareAllStudentsPDFGmail() {
  const mo = thisMonth();
  const moLabel = thisMonthLabel();
  const activeStudents = DB.students.filter(function(s){ return s.status==='Active'; })
    .slice().sort(function(a,b){ return (a.name||'').localeCompare(b.name||''); });

  var grandPaid = 0, grandPending = 0;
  var studentLines = [];

  activeStudents.forEach(function(s) {
    var room = DB.rooms.find(function(r){ return r.id===s.roomId; });
    var roomNo = room ? '#'+room.number : '—';
    var _mkDate = new Date(mo+'-01');
    var _mkLabel = _mkDate.toLocaleString('default',{month:'long',year:'numeric'});
    var _mkLabel2 = _mkDate.toLocaleString('default',{month:'short',year:'numeric'});
    var mPays = DB.payments.filter(function(p){
      return p.studentId===s.id && _payMatchesMonth(p, mo);
    });
    var paid    = mPays.filter(function(p){return p.status==='Paid';}).reduce(function(s,p){return s+Number(p.amount);},0);
    var pending = mPays.filter(function(p){return p.status==='Pending';}).reduce(function(s,p){return s+(p.unpaid!=null?Number(p.unpaid):Number(p.amount));},0);
    var status  = mPays.length===0 ? 'NO RECORD' : pending>0 ? 'PENDING' : 'PAID';
    grandPaid    += paid;
    grandPending += pending;
    studentLines.push('['+status+'] '+(s.name||'?')+' | Room '+roomNo+' | Rent: '+fmtPKR(s.rent)+(paid>0?' | Paid: '+fmtPKR(paid):'')+(pending>0?' | Due: '+fmtPKR(pending):''));
  });

  const subject = encodeURIComponent('Students Fee Report — ' + moLabel + ' | ' + DB.settings.hostelName);
  const bodyText =
    DB.settings.hostelName + '\nStudents Fee Report — ' + moLabel +
    '\n' + '─'.repeat(50) +
    '\n\n' + studentLines.join('\n') +
    '\n\n' + '─'.repeat(50) +
    '\nTOTAL COLLECTED: ' + fmtPKR(grandPaid) +
    '\nTOTAL PENDING:   ' + fmtPKR(grandPending) +
    '\n' + '─'.repeat(50) +
    '\nGenerated ' + new Date().toLocaleDateString() + ' | ' + DB.settings.hostelName + ' Management System';
  const body = encodeURIComponent(bodyText);
  // Open Gmail compose directly — no default mail client needed
  openExternalLink('https://mail.google.com/mail/?view=cm&fs=1&su=' + subject + '&body=' + body);
}

function downloadDetailPDF(type) {
  const key = reportPeriod==='month' ? thisMonth() : thisYear();
  const label = reportPeriod==='month' ? 'Monthly' : 'Annual';
  const pays = DB.payments.filter(p=>_payMatchesMonth(p,key));
  const exps = DB.expenses.filter(e=>e.date?.startsWith(key));
  const rev = calcRevenue(key);
  const totalExp = exps.reduce((s,e)=>s+Number(e.amount),0);
  const net = rev - totalExp;
  const css = `<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a2e;background:#fff;padding:28px;font-size:12px}.hdr{display:flex;align-items:center;justify-content:space-between;padding-bottom:14px;border-bottom:3px solid #c8a84b;margin-bottom:20px}.ht{font-size:20px;font-weight:800}.hs{font-size:11px;color:#666;margin-top:3px}table{width:100%;border-collapse:collapse;font-size:11px}th{background:#f1f5f9;padding:7px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;font-weight:700;border-bottom:1px solid #e2e8f0}td{padding:7px 10px;border-bottom:1px solid #f8fafc}.gr{color:#16a34a;font-weight:700}.re{color:#dc2626;font-weight:700}.go{color:#854d0e;font-weight:700}.kg{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px}.kc{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;text-align:center}.kl{font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:5px}.kv{font-size:20px;font-weight:900;color:#1e293b}.ft{margin-top:20px;padding-top:10px;border-top:1px solid #e2e8f0;text-align:center;font-size:10px;color:#94a3b8}@media print{body{padding:16px}}</style>`;
  let body = `<div class="hdr"><div><div class="ht">${DB.settings.hostelName}</div><div class="hs">${label} ${type==='financial'?'Revenue':type==='pending'?'Pending Payments':type==='netprofit'?'Available Fund Summary':'Expense'} Report · ${new Date().toLocaleDateString()}</div></div></div>`;
  if(type==='financial'){
    body+=`<div class="kg"><div class="kc"><span class="kl">Revenue</span><div class="kv gr">PKR ${rev.toLocaleString()}</div></div><div class="kc"><span class="kl">Pending</span><div class="kv go">PKR ${pays.filter(p=>p.status==='Pending').reduce((s,p)=>s+(p.unpaid!=null?Number(p.unpaid):Number(p.amount)),0).toLocaleString()}</div></div><div class="kc"><span class="kl">Transactions</span><div class="kv">${pays.length}</div></div></div>`;
    body+=`<table><thead><tr><th>Student</th><th>Room</th><th>Month</th><th>Paid</th><th>Unpaid</th><th>Method</th><th>Status</th><th>Date</th></tr></thead><tbody>${pays.sort((a,b)=>new Date(b.date)-new Date(a.date)).map(p=>`<tr><td>${p.studentName||'—'}</td><td class="go">#${p.roomNumber||'—'}</td><td>${p.month||'—'}</td><td class="${p.status==='Paid'?'gr':''}">PKR ${Number(p.amount).toLocaleString()}</td><td class="${(p.unpaid||0)>0?'re':''}">PKR ${(p.unpaid||0).toLocaleString()}</td><td>${p.method||'—'}</td><td class="${p.status==='Paid'?'gr':'re'}">${p.status}</td><td>${p.date||'—'}</td></tr>`).join('')||'<tr><td colspan="8" style="text-align:center;color:#aaa;padding:10px">No records</td></tr>'}</tbody></table>`;
  } else if(type==='pending'){
    const pend = DB.payments.filter(p=>p.status==='Pending');
    const totalUnpaid = pend.reduce((s,p)=>s+(p.unpaid!=null?Number(p.unpaid):Number(p.amount)),0);
    body+=`<div class="kg"><div class="kc"><span class="kl">Unpaid Records</span><div class="kv re">${pend.length}</div></div><div class="kc"><span class="kl">Total Outstanding</span><div class="kv re">PKR ${totalUnpaid.toLocaleString()}</div></div><div class="kc"><span class="kl">Partial Paid</span><div class="kv gr">PKR ${pend.reduce((s,p)=>s+Number(p.amount||0),0).toLocaleString()}</div></div></div>`;
    body+=`<table><thead><tr><th>Student</th><th>Room</th><th>Month</th><th>Partial Paid</th><th>Still Owed</th><th>Due Date</th></tr></thead><tbody>${pend.sort((a,b)=>new Date(a.dueDate||a.date)-new Date(b.dueDate||b.date)).map(p=>`<tr><td>${p.studentName||'—'}</td><td class="go">#${p.roomNumber||'—'}</td><td>${p.month||'—'}</td><td class="${Number(p.amount)>0?'gr':''}">PKR ${Number(p.amount||0).toLocaleString()}</td><td class="re">PKR ${(p.unpaid!=null?p.unpaid:p.amount).toLocaleString()}</td><td>${p.dueDate||'—'}</td></tr>`).join('')||'<tr><td colspan="6" style="text-align:center;color:#aaa;padding:10px">No pending payments</td></tr>'}</tbody></table>`;
  } else if(type==='netprofit'){
    body+=`<div class="kg"><div class="kc"><span class="kl">Revenue</span><div class="kv gr">PKR ${rev.toLocaleString()}</div></div><div class="kc"><span class="kl">Expenses</span><div class="kv re">PKR ${totalExp.toLocaleString()}</div></div><div class="kc"><span class="kl">Available Fund</span><div class="kv" style="color:${net>=0?'#16a34a':'#dc2626'}">PKR ${net.toLocaleString()}</div></div></div>`;
    body+=`<table><thead><tr><th>Category</th><th>Amount</th><th>% of Expenses</th></tr></thead><tbody>${DB.settings.expenseCategories.map(cat=>{const amt=exps.filter(e=>e.category===cat).reduce((s,e)=>s+Number(e.amount),0);const pct=totalExp>0?Math.round(amt/totalExp*100):0;return amt>0?`<tr><td>${cat}</td><td class="re">PKR ${amt.toLocaleString()}</td><td>${pct}%</td></tr>`:'';}).join('')||'<tr><td colspan="3" style="text-align:center;color:#aaa;padding:10px">No expenses</td></tr>'}</tbody></table>`;
  } else if(type==='expenses'){
    body+=`<div class="kc" style="text-align:center;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin-bottom:18px"><span class="kl">Total Expenses</span><div class="kv re">PKR ${totalExp.toLocaleString()}</div></div>`;
    body+=`<table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th></tr></thead><tbody>${exps.sort((a,b)=>new Date(b.date)-new Date(a.date)).map(e=>`<tr><td>${e.date||'—'}</td><td>${e.category||'—'}</td><td>${e.description||'—'}</td><td class="re">PKR ${Number(e.amount).toLocaleString()}</td></tr>`).join('')||'<tr><td colspan="4" style="text-align:center;color:#aaa;padding:10px">No expenses</td></tr>'}</tbody></table>`;
  } else if(type==='students'){
    body+=`<table><thead><tr><th>ID</th><th>Name</th><th>Room</th><th>Father</th><th>Phone</th><th>Rent/mo</th><th>Join Date</th><th>Status</th></tr></thead><tbody>${DB.students.map(t=>{const room=DB.rooms.find(r=>r.id===t.roomId);return `<tr><td style="font-size:10px;color:#aaa">#${t.id}</td><td>${t.name}</td><td class="go">${room?'#'+room.number:'—'}</td><td>${t.fatherName||'—'}</td><td>${t.phone||'—'}</td><td class="gr">PKR ${Number(t.rent||0).toLocaleString()}</td><td>${t.joinDate||'—'}</td><td class="${t.status==='Active'?'gr':t.status==='Blacklisted'?'re':''}">${t.status}</td></tr>`;}).join('')||'<tr><td colspan="8" style="text-align:center;color:#aaa;padding:10px">No students</td></tr>'}</tbody></table>`;
  } else if(type==='rooms'){
    body+=`<table><thead><tr><th>Room</th><th>Floor</th><th>Type</th><th>Capacity</th><th>Occupied</th><th>Rent/mo</th><th>Status</th><th>Students</th></tr></thead><tbody>${DB.rooms.map(r=>{const t=getRoomType(r);const oc=getRoomOccupancy(r);const names=DB.students.filter(s=>s.roomId===r.id&&s.status==='Active').map(s=>s.name);return `<tr><td class="go">#${r.number}</td><td>${r.floor}</td><td>${t.name}</td><td>${t.capacity} beds</td><td class="${oc>0?'gr':''}">${oc}/${t.capacity}</td><td class="gr">PKR ${Number(r.rent||0).toLocaleString()}</td><td class="${oc>0?'gr':'go'}">${oc>0?'Occupied':'Vacant'}</td><td>${names.join(', ')||'—'}</td></tr>`;}).join('')||'<tr><td colspan="8" style="text-align:center;color:#aaa;padding:10px">No rooms</td></tr>'}</tbody></table>`;
  }
  body += `<div class="ft">Generated ${new Date().toLocaleDateString()} · ${DB.settings.hostelName} · Confidential</div>`;
  _electronPDF(`<!DOCTYPE html><html><head><title>${type} detail</title>${css}</head><body>${body}</body></html>`,
    (DB.settings.hostelName||'Report').replace(/\s+/g,'-').replace(/[^a-zA-Z0-9\-]/g,'')+'_'+type+'_'+key+'.pdf', {pageSize:'A4'});
}

function downloadReportDetailPDF(detailId) {
  const mo = reportPeriod==='month' ? thisMonth() : thisYear();
  const pays = DB.payments.filter(p=>_payMatchesMonth(p,mo));
  const exps = DB.expenses.filter(e=>e.date?.startsWith(mo));
  const rev = calcRevenue(mo);
  const totalExp = exps.reduce((s,e)=>s+Number(e.amount),0);
  const net = rev - totalExp;
  const hostel = DB.settings.hostelName || 'DAMAM Hostel';
  const titles = {financial:'Financial Summary',pending:'Pending Payments',netprofit:'Available Fund',students:'Student Directory',rooms:'Room Occupancy',expenses:'Expense Breakdown',payments:'Payment Transactions'};
  const title = titles[detailId] || 'Report';
  let tableHTML = '';
  if(detailId==='financial'||detailId==='payments') {
    const p2 = detailId==='payments' ? pays.filter(x=>x.status==='Paid') : pays;
    tableHTML = `<h3>Transactions</h3><table><thead><tr><th>Student</th><th>Room</th><th>Month</th><th>Paid</th><th>Unpaid</th><th>Method</th><th>Status</th><th>Date</th></tr></thead><tbody>${p2.sort((a,b)=>new Date(b.date)-new Date(a.date)).map(p=>`<tr><td>${p.studentName||'—'}</td><td>#${p.roomNumber||'—'}</td><td>${p.month||'—'}</td><td class="green">${fmtPKR(p.amount)}</td><td class="${(p.unpaid||0)>0?'red':''}">${fmtPKR(p.unpaid||0)}</td><td>${p.method||'—'}</td><td>${p.status}</td><td>${fmtDate(p.date)}</td></tr>`).join('')}</tbody></table>`;
  } else if(detailId==='expenses') {
    tableHTML = `<h3>Expenses</h3><table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th></tr></thead><tbody>${exps.sort((a,b)=>new Date(b.date)-new Date(a.date)).map(e=>`<tr><td>${fmtDate(e.date)}</td><td>${e.category||'—'}</td><td>${e.description||'—'}</td><td class="red">${fmtPKR(e.amount)}</td></tr>`).join('')}</tbody></table>`;
  } else if(detailId==='pending') {
    const pendPays = DB.payments.filter(p=>p.status==='Pending');
    tableHTML = `<h3>Pending Payments</h3><table><thead><tr><th>Student</th><th>Room</th><th>Month</th><th>Partial Paid</th><th>Outstanding</th><th>Method</th><th>Date</th></tr></thead><tbody>${pendPays.sort((a,b)=>new Date(b.date)-new Date(a.date)).map(p=>`<tr><td>${p.studentName||'—'}</td><td>#${p.roomNumber||'—'}</td><td>${p.month||'—'}</td><td class="${p.unpaid!=null&&Number(p.amount)>0?'green':''}">${p.unpaid!=null?fmtPKR(p.amount):'—'}</td><td class="red">${fmtPKR(p.unpaid!=null?p.unpaid:p.amount)}</td><td>${p.method||'—'}</td><td>${fmtDate(p.date)}</td></tr>`).join('')}</tbody></table>`;
  } else if(detailId==='students') {
    tableHTML = `<h3>Student Directory</h3><table><thead><tr><th>Name</th><th>Room</th><th>Join Date</th><th>Rent</th><th>Status</th><th>Phone</th></tr></thead><tbody>${DB.students.map(t=>{const r=DB.rooms.find(x=>x.id===t.roomId);return `<tr><td>${t.name}</td><td>${r?'#'+r.number:'—'}</td><td>${fmtDate(t.joinDate)}</td><td class="green">${fmtPKR(t.rent)}</td><td>${t.status}</td><td>${t.phone||'—'}</td></tr>`;}).join('')}</tbody></table>`;
  } else if(detailId==='rooms') {
    tableHTML = `<h3>Room Occupancy</h3><table><thead><tr><th>Room</th><th>Type</th><th>Floor</th><th>Capacity</th><th>Students</th><th>Status</th></tr></thead><tbody>${DB.rooms.map(r=>{const type=getRoomType(r);const occ=getRoomOccupancy(r);const sts=DB.students.filter(t=>t.roomId===r.id&&t.status==='Active');return `<tr><td class="gold">#${r.number}</td><td>${type.name}</td><td>${r.floor}</td><td>${occ}/${type.capacity}</td><td>${sts.map(t=>t.name).join(', ')||'Empty'}</td><td>${occ>0?'Occupied':'Vacant'}</td></tr>`;}).join('')}</tbody></table>`;
  } else if(detailId==='netprofit') {
    // Full breakdown: revenue transactions + expense list + transfers deduction
    const allTr = (DB.transfers||[]).filter(t=>(t.date||'').startsWith(mo));
    const trTotal = allTr.reduce((s,t)=>s+Number(t.amount),0);
    tableHTML = `
      <div class="summary-box" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 20px;margin-bottom:16px">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;text-align:center">
          <div><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#16a34a;font-weight:700;margin-bottom:4px">Revenue</div><div style="font-size:22px;font-weight:900;color:#16a34a">${fmtPKR(rev)}</div></div>
          <div><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#dc2626;font-weight:700;margin-bottom:4px">Total Outgoing</div><div style="font-size:22px;font-weight:900;color:#dc2626">${fmtPKR(totalExp + trTotal)}</div><div style="font-size:10px;color:#666">Expenses ${fmtPKR(totalExp)}${trTotal>0?' + Transfers '+fmtPKR(trTotal):''}</div></div>
          <div><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:${net>=0?'#16a34a':'#dc2626'};font-weight:700;margin-bottom:4px">Available Fund</div><div style="font-size:22px;font-weight:900;color:${net>=0?'#16a34a':'#dc2626'}">${fmtPKR(net - trTotal)}</div></div>
        </div>
      </div>
      <h3>💰 Revenue — Paid Transactions</h3>
      <table><thead><tr><th>Student</th><th>Room</th><th>Month</th><th>Amount Paid</th><th>Method</th><th>Date</th></tr></thead><tbody>
      ${pays.filter(p=>p.status==='Paid').sort((a,b)=>new Date(b.date)-new Date(a.date)).map(p=>`<tr><td>${p.studentName||'—'}</td><td class="gold">#${p.roomNumber||'—'}</td><td>${p.month||'—'}</td><td class="green">${fmtPKR(p.amount)}</td><td>${p.method||'—'}</td><td>${fmtDate(p.date)}</td></tr>`).join('')||'<tr><td colspan="6" style="text-align:center;color:#aaa;padding:10px">No paid transactions this period</td></tr>'}
      </tbody></table>
      <h3 style="margin-top:18px">📉 Expenses</h3>
      <table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th></tr></thead><tbody>
      ${exps.sort((a,b)=>new Date(b.date)-new Date(a.date)).map(e=>`<tr><td>${fmtDate(e.date)}</td><td>${e.category||'—'}</td><td>${e.description||'—'}</td><td class="red">${fmtPKR(e.amount)}</td></tr>`).join('')||'<tr><td colspan="4" style="text-align:center;color:#aaa;padding:10px">No expenses this period</td></tr>'}
      </tbody></table>
      ${allTr.length>0?`
      <h3 style="margin-top:18px">🏦 Transfers to Owner</h3>
      <table><thead><tr><th>Date</th><th>Method</th><th>Description</th><th>Received By</th><th>Amount</th></tr></thead><tbody>
      ${allTr.map(t=>`<tr><td>${fmtDate(t.date)}</td><td>${t.method||'—'}</td><td>${t.description||'—'}</td><td>${t.receivedBy||'—'}</td><td class="red">${fmtPKR(t.amount)}</td></tr>`).join('')}
      <tr style="background:#f8fafc;font-weight:700"><td colspan="4" style="text-align:right;padding:8px 12px">Total Transferred</td><td class="red">${fmtPKR(trTotal)}</td></tr>
      </tbody></table>`:''}`;
  } else if(detailId==='transfers') {
    const allTr2 = (DB.transfers||[]).slice().sort((a,b)=>new Date(b.date)-new Date(a.date));
    const trTotal2 = allTr2.reduce((s,t)=>s+Number(t.amount),0);
    const moTr2 = allTr2.filter(t=>(t.date||'').startsWith(mo));
    const moTrTotal = moTr2.reduce((s,t)=>s+Number(t.amount),0);
    tableHTML = `
      <div class="summary-box" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px 20px;margin-bottom:16px">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;text-align:center">
          <div><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#1d4ed8;font-weight:700;margin-bottom:4px">Total All Time</div><div style="font-size:22px;font-weight:900;color:#1d4ed8">${fmtPKR(trTotal2)}</div><div style="font-size:10px;color:#666">${allTr2.length} records</div></div>
          <div><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#1d4ed8;font-weight:700;margin-bottom:4px">This Period</div><div style="font-size:22px;font-weight:900;color:#1d4ed8">${fmtPKR(moTrTotal)}</div><div style="font-size:10px;color:#666">${moTr2.length} records</div></div>
          <div><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#666;font-weight:700;margin-bottom:4px">Period Revenue</div><div style="font-size:22px;font-weight:900;color:#16a34a">${fmtPKR(rev)}</div></div>
        </div>
      </div>
      <h3>🏦 All Transfer Records</h3>
      <table><thead><tr><th>Date</th><th>Method</th><th>Description</th><th>Received By</th><th>By Warden</th><th>Amount</th></tr></thead><tbody>
      ${allTr2.length===0?'<tr><td colspan="6" style="text-align:center;color:#aaa;padding:14px">No transfers recorded yet</td></tr>':allTr2.map(t=>`<tr><td>${fmtDate(t.date)}</td><td>${t.method||'—'}</td><td>${t.description||'—'}</td><td>${t.receivedBy||'—'}</td><td>${t.byWarden||'—'}</td><td class="red" style="font-weight:900">${fmtPKR(t.amount)}</td></tr>`).join('')}
      <tr style="background:#f8fafc;font-weight:700"><td colspan="5" style="text-align:right;padding:8px 12px">Grand Total</td><td class="red">${fmtPKR(trTotal2)}</td></tr>
      </tbody></table>`;
  }
  _electronPDF(`<!DOCTYPE html><html><head><title>${title} — ${hostel}</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',sans-serif;color:#1a1a2e;background:#fff;padding:32px;font-size:13px}.header{display:flex;justify-content:space-between;align-items:center;padding-bottom:16px;border-bottom:3px solid #c8a84b;margin-bottom:24px}.title{font-size:22px;font-weight:800}.kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px}.kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;text-align:center}.kpi label{font-size:10px;color:#94a3b8;text-transform:uppercase;display:block;margin-bottom:6px}.kpi .val{font-size:20px;font-weight:900}.summary-box{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:20px;margin-bottom:20px;font-size:15px}h3{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin:16px 0 10px}table{width:100%;border-collapse:collapse;font-size:12px}th{background:#f1f5f9;padding:8px 12px;text-align:left;font-size:10px;text-transform:uppercase;color:#64748b;font-weight:700;border-bottom:1px solid #e2e8f0}td{padding:8px 12px;border-bottom:1px solid #f1f5f9}.green{color:#16a34a;font-weight:700}.red{color:#dc2626;font-weight:700}.gold{color:#854d0e;font-weight:700}.footer{margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;text-align:center;font-size:11px;color:#94a3b8}@media print{body{padding:16px}}</style></head><body><div class="header"><div><div class="title">${hostel} — ${title}</div><div style="font-size:12px;color:#666;margin-top:3px">${mo} · Generated ${new Date().toLocaleDateString()}</div></div><div style="font-size:11px;color:#94a3b8">PDF Report</div></div><div class="kpi-grid"><div class="kpi"><label>Revenue</label><div class="val green">${fmtPKR(rev)}</div></div><div class="kpi"><label>Expenses</label><div class="val red">${fmtPKR(totalExp)}</div></div><div class="kpi"><label>Available Fund</label><div class="val ${net>=0?'green':'red'}">${fmtPKR(net)}</div></div></div>${tableHTML}<div class="footer">Generated ${new Date().toLocaleDateString()} · ${hostel} · Confidential</div></body></html>`,
    hostel.replace(/\s+/g,'-').replace(/[^a-zA-Z0-9\-]/g,'') + '_' + title.replace(/\s+/g,'-') + '_' + mo + '.pdf',
    { pageSize: 'A4' });
}

function printReport() {
  const mo=reportPeriod==='month'?thisMonth():thisYear();
  const pays=DB.payments.filter(p=>_payMatchesMonth(p,mo));
  const exps=DB.expenses.filter(e=>e.date?.startsWith(mo));
  const rev=calcRevenue(mo);
  const expTotal=exps.reduce((s,e)=>s+Number(e.amount),0);
  const _printKey=reportPeriod==='month'?thisMonth():thisYear();
  const pending=DB.payments.filter(p=>p.status==='Pending'&&_payMatchesMonth(p,_printKey)).reduce((s,p)=>s+(p.unpaid!=null?Number(p.unpaid):Number(p.amount)),0);
  const occ=DB.rooms.filter(r=>getRoomOccupancy(r)>0).length;
  const _rptHtml = `<!DOCTYPE html><html><head><title>${reportPeriod==='month'?'Monthly':'Annual'} Report — ${DB.settings.hostelName}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a2e;background:#fff;padding:32px;font-size:13px}
    .header{display:flex;align-items:center;justify-content:space-between;padding-bottom:16px;border-bottom:3px solid #c8a84b;margin-bottom:24px}
    .title{font-size:22px;font-weight:800;color:#1a1a2e}
    .subtitle{font-size:12px;color:#666;margin-top:3px}
    .badge{padding:6px 14px;border-radius:20px;font-size:11px;font-weight:700;background:#c8a84b22;color:#8b6a00;border:1px solid #c8a84b55}
    .kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px}
    .kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;text-align:center}
    .kpi label{font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:6px}
    .kpi .val{font-size:20px;font-weight:900;color:#1e293b}
    .section{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:16px}
    .section h3{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin-bottom:12px}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th{background:#f1f5f9;padding:8px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;font-weight:700;border-bottom:1px solid #e2e8f0}
    td{padding:8px 12px;border-bottom:1px solid #f8fafc}
    .green{color:#16a34a;font-weight:700}
    .red{color:#dc2626;font-weight:700}
    .gold{color:#854d0e;font-weight:700}
    .footer{margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;text-align:center;font-size:11px;color:#94a3b8}
    @media print{body{padding:16px}}
  </style></head><body>
  <div class="header">
    <div><div class="title">${DB.settings.hostelName}</div><div class="subtitle">${reportPeriod==='month'?'Monthly':'Annual'} Report · ${DB.settings.location||''} · Generated ${new Date().toLocaleDateString()}</div></div>
    <div class="badge">${reportPeriod==='month'?'Monthly':'Annual'} Report</div>
  </div>
  <div class="kpi-grid">
    <div class="kpi"><label>Revenue</label><div class="val green">${fmtPKR(rev)}</div></div>
    <div class="kpi"><label>Expenses</label><div class="val red">${fmtPKR(expTotal)}</div></div>
    <div class="kpi"><label>Available Fund</label><div class="val" style="color:${rev-expTotal>=0?'#16a34a':'#dc2626'}">${fmtPKR(rev-expTotal)}</div></div>
    <div class="kpi"><label>Pending</label><div class="val gold">${fmtPKR(pending)}</div></div>
    <div class="kpi"><label>Rooms Occupied</label><div class="val">${occ}/${DB.rooms.length}</div></div>
    <div class="kpi"><label>Active Students</label><div class="val">${DB.students.filter(t=>t.status==='Active').length}</div></div>
    <div class="kpi"><label>Total Payments</label><div class="val">${pays.filter(p=>p.status==='Paid').length}</div></div>
    <div class="kpi"><label>Transferred to Owner</label><div class="val" style="color:#854d0e">${fmtPKR((DB.transfers||[]).filter(tr=>(tr.date||'').startsWith(mo)).reduce((s,t)=>s+Number(t.amount),0))}</div></div>
  </div>
  <div class="section">
    <h3>💳 Payment Transactions</h3>
    <table><thead><tr><th>Student</th><th>Room</th><th>Month</th><th>Amount</th><th>Method</th><th>Status</th><th>Date</th></tr></thead><tbody>
    ${pays.sort((a,b)=>new Date(b.date)-new Date(a.date)).map(p=>`<tr><td>${p.studentName||'—'}</td><td class="gold">#${p.roomNumber||'—'}</td><td>${p.month||'—'}</td><td class="${p.status==='Paid'?'green':'red'}">${fmtPKR(p.amount)}</td><td>${p.method||'—'}</td><td class="${p.status==='Paid'?'green':'red'}">${p.status}</td><td>${fmtDate(p.date)||'—'}</td></tr>`).join('')||'<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:12px">No transactions</td></tr>'}
    </tbody></table>
  </div>
  <div class="section">
    <h3>📉 Expense Breakdown</h3>
    <table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th></tr></thead><tbody>
    ${exps.map(e=>`<tr><td>${fmtDate(e.date)}</td><td>${e.category||'—'}</td><td>${e.description||'—'}</td><td class="red">${fmtPKR(e.amount)}</td></tr>`).join('')||'<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:12px">No expenses</td></tr>'}
    </tbody></table>
  </div>
  <div class="section">
    <h3>🏦 Transfers to Owner</h3>
    <table><thead><tr><th>Date</th><th>Description</th><th>Method</th><th>Amount</th></tr></thead><tbody>
    ${(DB.transfers||[]).filter(tr=>(tr.date||'').startsWith(mo)).map(tr=>`<tr><td>${fmtDate(tr.date)}</td><td>${escHtml(tr.description||'Transfer')}</td><td>${escHtml(tr.method||'—')}</td><td class="gold">${fmtPKR(tr.amount)}</td></tr>`).join('')||'<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:12px">No transfers this period</td></tr>'}
    </tbody></table>
    ${(DB.transfers||[]).length>0?`<div style="text-align:right;padding:8px 12px 0;font-weight:700;color:#854d0e">Total Transferred: ${fmtPKR((DB.transfers||[]).filter(tr=>(tr.date||'').startsWith(mo)).reduce((s,t)=>s+Number(t.amount),0))}</div>`:''}
  </div>
  <div class="footer">Generated ${new Date().toLocaleDateString()} · ${DB.settings.hostelName} Management System · Confidential</div>
  </body></html>`;
  _electronPDF(_rptHtml, (DB.settings.hostelName||'Report').replace(/\s+/g,'-').replace(/[^a-zA-Z0-9\-]/g,'')+'_Report_'+(reportPeriod==='month'?thisMonth():thisYear())+'.pdf', {pageSize:'A4'});
}

// ════════════════════════════════════════════════════════════════════════════
// MODAL SYSTEM
// ════════════════════════════════════════════════════════════════════════════
function showModal(size, title, body, footer='') {
  const html=`<div class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal ${size}">
      <div class="modal-header">
        <div class="modal-title">${title}</div>
        <button class="btn btn-secondary btn-icon" onclick="closeModal()">
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer?`<div class="modal-footer">${footer}</div>`:''}
    </div>
  </div>`;
  document.getElementById('modal-container').innerHTML=html;
}
function closeModal() {
  // Stop any active camera streams before destroying modal
  ['add-student-cam-video','edit-student-cam-video'].forEach(id=>{
    const vid = document.getElementById(id);
    if(vid?.srcObject){ vid.srcObject.getTracks().forEach(t=>t.stop()); vid.srcObject=null; }
  });
  document.getElementById('modal-container').innerHTML='';
}
let _pendingConfirmCb = null;
let _pendingConfirmCancelCb = null;
function showConfirm(title, text, onConfirm, onCancel) {
  _pendingConfirmCb = onConfirm;
  _pendingConfirmCancelCb = onCancel || null;
  showModal('modal-sm', title,
    `<p class="confirm-text">${text}</p>`,
    `<button class="btn btn-secondary" onclick="closeModal();if(_pendingConfirmCancelCb){_pendingConfirmCancelCb();_pendingConfirmCancelCb=null;}">Cancel</button><button class="btn btn-danger" onclick="closeModal();if(_pendingConfirmCb){_pendingConfirmCb();_pendingConfirmCb=null;}">Confirm</button>`
  );
}
// ════════════════════════════════════════════════════════════════════════════
// BACKUP & RESTORE
// ════════════════════════════════════════════════════════════════════════════
function showBackupRestoreModal() {
  const now = new Date();
  const ts = now.toLocaleDateString('en-PK',{year:'numeric',month:'short',day:'2-digit'}) + ' ' + now.toLocaleTimeString('en-PK',{hour:'2-digit',minute:'2-digit'});
  const dataSize = (JSON.stringify(DB).length / 1024).toFixed(1);
  const studentCount = DB.students.length;
  const paymentCount = DB.payments.length;
  const roomCount = DB.rooms.length;

  showModal('modal-md','🛡️ Backup & Restore Data',`
    <div style="background:var(--teal-dim);border:1px solid rgba(15,188,173,0.3);border-radius:10px;padding:14px 16px;margin-bottom:20px;display:flex;align-items:center;gap:12px">
      <div style="font-size:22px">🔒</div>
      <div>
        <div style="font-size:13px;font-weight:700;color:var(--teal)">Your data is safe in this browser</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px">Export a backup file to your PC/phone to protect against browser data loss</div>
      </div>
    </div>

    <!-- Stats row -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px">
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:9px;padding:12px;text-align:center">
        <div style="font-size:20px;font-weight:900;color:var(--gold2)">${studentCount}</div>
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:600;margin-top:2px">Students</div>
      </div>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:9px;padding:12px;text-align:center">
        <div style="font-size:20px;font-weight:900;color:var(--green)">${roomCount}</div>
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:600;margin-top:2px">Rooms</div>
      </div>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:9px;padding:12px;text-align:center">
        <div style="font-size:20px;font-weight:900;color:var(--blue)">${paymentCount}</div>
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:600;margin-top:2px">Payments</div>
      </div>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:9px;padding:12px;text-align:center">
        <div style="font-size:20px;font-weight:900;color:var(--purple)">${dataSize}KB</div>
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;font-weight:600;margin-top:2px">Data Size</div>
      </div>
    </div>

    <!-- Export section -->
    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:14px">
      <div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:var(--teal);margin-bottom:10px">📤 Export / Download Backup</div>
      <div style="font-size:12.5px;color:var(--text2);margin-bottom:12px">Download a <strong style="color:var(--text)">.json</strong> backup file containing all your hostel data. Store it on your PC, USB, or Google Drive.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="exportBackup('json')" style="flex:1">
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download JSON Backup
        </button>
        <button class="btn btn-secondary" onclick="exportBackup('copy')">
          📋 Copy to Clipboard
        </button>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:8px">Last snapshot: ${ts}</div>
    </div>

    <!-- FIX: Google Drive Backup Section (replaces Gmail) -->
    <div style="background:var(--bg3);border:1px solid rgba(66,133,244,0.35);border-radius:10px;padding:16px;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <div style="width:30px;height:30px;background:rgba(66,133,244,0.15);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px">☁️</div>
        <div>
          <div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#4285f4">Google Drive Backup</div>
          <div style="font-size:11px;color:var(--text3)">Save backup file directly to Google Drive</div>
        </div>
      </div>
      <!-- FIX-GDRIVE: Gmail account input field -->
      <div class="field" style="margin-bottom:12px">
        <label style="font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.8px;display:block;margin-bottom:5px">Google Account (Gmail) for Drive Upload</label>
        <input class="form-control" id="gdrive-email" type="email" placeholder="yourname@gmail.com"
          value="${escHtml(DB.settings.driveEmail||'')}"
          oninput="DB.settings.driveEmail=this.value.trim();saveDB()"
          style="font-size:12px">
        <div style="font-size:10px;color:var(--text3);margin-top:4px">Saved for reference — used to open the correct Drive account in your browser.</div>
      </div>
      <div class="field" style="margin-bottom:12px">
        <label style="font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.8px;display:block;margin-bottom:5px">Auto-Backup Schedule</label>
        <select class="form-control" id="backup-schedule" onchange="DB.settings.backupSchedule=this.value;saveDB();updateBackupScheduleLabel()">
          <option value="" ${!DB.settings.backupSchedule?'selected':''}>Disabled</option>
          <option value="daily" ${DB.settings.backupSchedule==='daily'?'selected':''}>Every Day</option>
          <option value="2days" ${DB.settings.backupSchedule==='2days'?'selected':''}>Every 2 Days</option>
          <option value="3days" ${DB.settings.backupSchedule==='3days'?'selected':''}>Every 3 Days</option>
          <option value="weekly" ${DB.settings.backupSchedule==='weekly'?'selected':''}>Every Week</option>
          <option value="monthly" ${DB.settings.backupSchedule==='monthly'?'selected':''}>Every Month</option>
        </select>
        <div id="schedule-next-lbl" style="font-size:11px;color:var(--text3);margin-top:5px">${getNextBackupLabel()}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="sendBackupToDrive()" style="background:linear-gradient(135deg,#4285f4,#1a6ed8);border:none;flex:1;display:flex;align-items:center;justify-content:center;gap:6px">
          <span style="font-size:14px">☁️</span> Backup Now to Google Drive
        </button>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:8px;padding:8px 10px;background:var(--bg4);border-radius:6px">
        💡 Clicking <strong>Backup Now</strong> downloads the JSON file and opens your Google Drive${DB.settings.driveEmail?` (<strong>${escHtml(DB.settings.driveEmail)}</strong>)`:''} in the browser. Upload the file there to save it in the cloud.
      </div>
    </div>

    <!-- Restore section -->
    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:16px">
      <div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:var(--amber);margin-bottom:10px">📥 Restore from Backup</div>
      <div style="background:var(--amber-dim);border:1px solid rgba(240,160,48,0.25);border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:var(--text2)">
        ⚠️ <strong>Warning:</strong> Restoring will <strong style="color:var(--red)">replace ALL current data</strong>. Make sure to export a backup first!
      </div>
      <div style="margin-bottom:10px">
        <label style="display:block;font-size:11.5px;color:var(--text3);font-weight:600;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.8px">Select Backup File (.json)</label>
        <input type="file" id="restore-file-input" accept=".json" class="form-control" style="font-size:12px">
      </div>
      <button class="btn btn-danger" onclick="restoreBackup()" style="width:100%">
        <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        Restore Data from File
      </button>
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
        <div style="font-size:11.5px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:8px">Or Paste JSON directly</div>
        <textarea id="restore-json-paste" class="form-control" rows="3" placeholder="Paste JSON backup data here…" style="font-family:var(--font-mono);font-size:11px"></textarea>
        <button class="btn btn-secondary" onclick="restoreFromPaste()" style="width:100%;margin-top:8px">📋 Restore from Pasted JSON</button>
      </div>
    </div>
  `, `<button class="btn btn-secondary" onclick="closeModal()">Close</button>`);
}

async function exportBackup(mode) {
  const now = new Date();
  const filename = 'DAMAM_Backup_' + now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0') + '.json';
  // Include archive from server for full backup
  let archive = { payments: [], expenses: [] };
  try { archive = await apiGetArchive(); } catch(e) {}
  const exportData = { db: DB, archive: archive, exportedAt: now.toISOString(), version: '4.0-web' };
  const json = JSON.stringify(exportData, null, 2);
  if (mode === 'json') {
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    // Mark backup date
    DB.settings.lastBackupDate = now.toISOString().slice(0,10);
    saveDB();
    toast('✅ Backup downloaded: ' + filename, 'success');
  } else {
    navigator.clipboard.writeText(json).then(() => {
      toast('Data copied to clipboard!', 'success');
    }).catch(() => {
      toast('Copy failed — use Download button instead', 'error');
    });
  }
}

// ── Fix #7: Gmail Backup Helpers ─────────────────────────────────────────────
function getNextBackupLabel() {
  const sched = DB.settings && DB.settings.backupSchedule;
  const last  = DB.settings && DB.settings.lastBackupDate;
  if (!sched) return 'Auto-backup is disabled.';
  const intervalDays = {daily:1,'2days':2,'3days':3,weekly:7,monthly:30}[sched] || 0;
  if (!intervalDays) return '';
  const lastDate = last ? new Date(last) : null;
  if (!lastDate) return 'Next: on next app open';
  const nextDate = new Date(lastDate.getTime() + intervalDays * 86400000);
  const diff = Math.ceil((nextDate - Date.now()) / 86400000);
  return diff <= 0 ? '⏰ Backup due now!' : `Next backup in ${diff} day${diff!==1?'s':''}`;
}
function updateBackupScheduleLabel() {
  const el = document.getElementById('schedule-next-lbl');
  if(el) el.textContent = getNextBackupLabel();
}
// FIX: Replace Gmail backup with direct Google Drive backup
function sendBackupToDrive() {
  // Step 1: Download the backup JSON file to PC
  exportBackup('json');
  // Step 2: Open Google Drive upload page in system browser
  var driveUrl = 'https://drive.google.com/drive/my-drive';
  openExternalLink(driveUrl);
  // Update last backup date
  DB.settings.lastBackupDate = new Date().toISOString().slice(0,10);
  saveDB();
  updateBackupScheduleLabel();
  toast('✅ Backup downloaded! Now upload it to Google Drive in your browser.', 'success');
}
// Keep old name as alias for any auto-backup calls
function sendBackupToGmail() { sendBackupToDrive(); }
// Auto-backup check on app start — runs after DB is loaded
function checkAutoBackupSchedule() {
  const sched = DB.settings && DB.settings.backupSchedule;
  if (!sched) return;
  const intervalDays = {daily:1,'2days':2,'3days':3,weekly:7,monthly:30}[sched] || 0;
  if (!intervalDays) return;
  const last = DB.settings.lastBackupDate;
  if (last) {
    const daysSince = Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
    if (daysSince < intervalDays) return; // not due yet
  }
  // FIX-B2: Show a prominent sticky banner with a one-click "Backup Now" button
  // instead of a silent toast the warden might miss or dismiss accidentally.
  setTimeout(function() {
    if (document.getElementById('backup-due-banner')) return; // no duplicates
    var lastStr = last
      ? 'Last backup: ' + new Date(last).toLocaleDateString('en-PK',{day:'2-digit',month:'short',year:'numeric'}) + '.'
      : 'No backup has been made yet.';
    var banner = document.createElement('div');
    banner.id = 'backup-due-banner';
    // FIX B5: moved to bottom so it does not cover the app header/sidebar
    banner.style.cssText = [
      'position:fixed','bottom:0','left:0','right:0','z-index:99999',
      'background:linear-gradient(90deg,#1e3c6a,#2a5298)',
      'color:#e8eef8','font-size:13px','font-weight:600',
      'padding:10px 20px','display:flex','align-items:center',
      'gap:12px','box-shadow:0 -3px 16px rgba(0,0,0,0.55)'
    ].join(';');
    // FIX B5: use this.parentElement.remove() — avoids broken inner-quote bug
    banner.innerHTML =
      '<span style="font-size:18px">⏰</span>' +
      '<span style="flex:1">Scheduled backup is due. ' + lastStr + ' Back up now to avoid data loss.</span>' +
      '<button onclick="sendBackupToDrive();this.parentElement.remove();" ' +
        'style="background:#e6c96e;color:#071428;border:none;border-radius:7px;padding:6px 16px;' +
        'font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap">💾 Backup Now</button>' +
      '<button onclick="this.parentElement.remove();" ' +
        'style="background:rgba(255,255,255,0.1);color:#e8eef8;border:none;border-radius:7px;' +
        'padding:6px 12px;font-size:12px;cursor:pointer;white-space:nowrap">Dismiss</button>';
    document.body.prepend(banner);
  }, 3000);
}
// ─────────────────────────────────────────────────────────────────────────────

// ── MIDNIGHT AUTO-BACKUP SCHEDULER (BUG-5 FIX) ───────────────────────────────
// Fires at 00:00 every night. If a backup schedule is set AND it is due,
// runs sendBackupToDrive() automatically — no user action needed.
(function _initMidnightBackup() {
  function _msUntilMidnight() {
    var n = new Date();
    var m = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 15); // 00:00:15
    return m - n;
  }
  function _midnightCheck() {
    try {
      var sched = DB && DB.settings && DB.settings.backupSchedule;
      if (!sched || sched === 'off') return;
      var intervalDays = {daily:1,'2days':2,'3days':3,weekly:7,monthly:30}[sched] || 0;
      if (!intervalDays) return;
      var last = DB.settings.lastBackupDate;
      var daysSince = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : 999;
      if (daysSince >= intervalDays) {
        sendBackupToDrive();
        if (typeof toast === 'function') toast('🌙 Midnight auto-backup completed to Google Drive.', 'success');
      }
    } catch(e) { console.warn('[AutoBackup] midnight check error:', e); }
  }
  // Schedule first tick at next midnight, then repeat every 24 h
  setTimeout(function _firstMidnightTick() {
    _midnightCheck();
    setInterval(_midnightCheck, 24 * 60 * 60 * 1000);
  }, _msUntilMidnight());
})();
// ─────────────────────────────────────────────────────────────────────────────

function _initDBFields(d) {
  // FIX #14: Canonical single source of truth for all DB field normalisation.
  // Called by loadDB(), restoreBackup(), and restoreFromPaste().
  if (!d) d = {};
  if (!d.students) d.students = [];
  if (!d.payments) d.payments = [];
  if (!d.expenses) d.expenses = [];
  if (!d.cancellations) d.cancellations = [];
  if (!d.maintenance) d.maintenance = [];
  if (!d.complaints) d.complaints = [];
  if (!d.checkinlog) d.checkinlog = [];
  if (!d.notices) d.notices = [];
  if (!d.fines) d.fines = [];
  if (!d.activityLog) d.activityLog = [];
  if (!d.inspections) d.inspections = [];
  if (!d.billSplits) d.billSplits = [];
  if (!d.transfers) d.transfers = [];
  if (!d.roomShifts) d.roomShifts = [];   // Room shift history records
  if (!d.settings) d.settings = {};
  // Init roomTypes BEFORE generateRooms so rooms get correct default rents
  // roomTypes already initialized above (before generateRooms)
  if (!d.rooms || d.rooms.length === 0) d.rooms = generateRooms(d.settings.roomTypes);
  // Core identity — previously missing from restoreBackup path
  if (!d.settings.appName) d.settings.appName = 'HOSTIX'; // ← Customisable system name
  if (!d.settings.hostelName) d.settings.hostelName = 'DAMAM Boys Hostel';
  if (!d.settings.tagline) d.settings.tagline = 'Safe & Comfortable Living';
  if (!d.settings.location) d.settings.location = '4/1 Kakakhel Street, Danishabad Shaheen Town, Peshawar';
  if (!d.settings.phone) d.settings.phone = '';
  if (!d.settings.email) d.settings.email = '';
  if (!d.settings.version) d.settings.version = 'v1.0';
  // Appearance
  if (!d.settings.accentColor) d.settings.accentColor = '#e05252';
  if (!d.settings.hostelNameFont) d.settings.hostelNameFont = 'DM Serif Display';
  if (d.settings.showFontPicker === undefined) d.settings.showFontPicker = true;
  // Behaviour
  if (!d.settings.currency) d.settings.currency = 'PKR';
  if (d.settings.autoMonthGenerate === undefined) d.settings.autoMonthGenerate = true;
  if (!d.settings.defaultWANumber) d.settings.defaultWANumber = '';
  // Collections
  if (!d.settings.roomTypes || !d.settings.roomTypes.length) d.settings.roomTypes = [
    { id:'1s', name:'1-Seater', capacity:1, defaultRent:16000, color:'#4a9cf0' },
    { id:'2s', name:'2-Seater', capacity:2, defaultRent:16000, color:'#9b6df0' },
    { id:'3s', name:'3-Seater', capacity:3, defaultRent:16000, color:'#2ec98a' },
    { id:'4s', name:'4-Seater', capacity:4, defaultRent:16000, color:'#c8a84b' },
    { id:'5s', name:'5-Seater', capacity:5, defaultRent:16000, color:'#f0a030' }
  ];
  if (!d.settings.paymentMethods) d.settings.paymentMethods = ['Cash','JazzCash','EasyPaisa','Bank Transfer','Cheque'];
  if (!d.settings.expenseCategories) d.settings.expenseCategories = ['Electricity','Water','Gas','Maintenance','Cleaning','Security','Internet','Furniture','Plumbing','Other'];
  if (!d.settings.floors) d.settings.floors = ['Ground','1st','2nd','3rd'];
  return d;
}

function restoreBackup() {
  const input = document.getElementById('restore-file-input');
  if (!input || !input.files || !input.files.length) {
    toast('Please select a backup .json file first', 'error'); return;
  }
  const file = input.files[0];
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const parsed = JSON.parse(e.target.result);
      const dbData = (parsed.db && parsed.db.students) ? parsed.db : parsed;
      if (!dbData.students || !dbData.rooms || !dbData.settings) {
        toast('Invalid backup file — not a DAMAM hostel backup', 'error'); return;
      }
      const count = dbData.students.length;
      showConfirm('Restore Backup?',
        'This will replace ALL current data with backup data (' + count + ' students). This cannot be undone!',
        function() {
          // restoreFromFile() is in storage.js — handles API sync
          restoreFromFile(e.target.result);
          applySavedTheme();
          closeModal();
        }
      );
    } catch(err) {
      toast('Restore failed: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

function restoreFromPaste() {
  const text = document.getElementById('restore-json-paste')?.value?.trim();
  if(!text){ toast('Please paste JSON data first', 'error'); return; }
  try {
    let parsed = JSON.parse(text);
    // BUG FIX: Support both flat format and old wrapped {db:...,archive:...} format
    if (parsed.db && parsed.db.students) parsed = parsed.db;
    if(!parsed.students || !parsed.rooms || !parsed.settings){
      toast('Invalid JSON — not a valid DAMAM hostel backup', 'error'); return;
    }
    const count = parsed.students.length;
    showConfirm('Restore from Pasted Data?',
      `This will replace ALL current data (${count} students found in backup). This cannot be undone!`,
      ()=>{
        DB = _initDBFields(parsed);
        saveDB();
        updateSidebar();
        applySavedTheme();
        navigate('dashboard');
        toast('Data restored from pasted backup!', 'success');
        closeModal();
      }
    );
  } catch(err) {
    toast('Invalid JSON — check for errors in pasted data', 'error');
  }
}


// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════
function statusBadge(s) {
  const map={Paid:'badge-green',Pending:'badge-gold',Active:'badge-green',Left:'badge-gray',Blacklisted:'badge-red',Cancelling:'badge-red'};
  const icons={Active:'●',Left:'◌',Blacklisted:'✕',Cancelling:'🚫',Paid:'✓',Pending:'⏳'};
  return `<span class="badge ${map[s]||'badge-gray'}">${icons[s]||''} ${escHtml(s||'—')}</span>`;
}
function pmBadge(m) {
  // BUG FIX: 'EasypaIsa' was a dead duplicate key with a capital-I typo that
  // could never match any real payment method. Removed. EasyPaisa is sufficient.
  const map={Cash:'badge-green',JazzCash:'badge-purple',EasyPaisa:'badge-teal','Bank Transfer':'badge-blue',Cheque:'badge-amber'};
  return `<span class="badge ${map[m]||'badge-gray'}">${escHtml(m||'—')}</span>`;
}


// ════════════════════════════════════════════════════════════════════════════
// FIX #2 — CUSTOM LIFETIME DATE PICKER (replaces native type="text" readonly onclick="showCustomDatePicker(this,event)" class="cdp-trigger")
// ════════════════════════════════════════════════════════════════════════════
(function _initCustomDatePicker() {
  // Inject picker CSS once
  if (document.getElementById('_cdp-style')) return;
  const s = document.createElement('style');
  s.id = '_cdp-style';
  s.textContent = `
    #_cdp-overlay{position:fixed;inset:0;z-index:9999;display:none}
    #_cdp-overlay.open{display:block}
    #_cdp-box{
      position:fixed;background:var(--card,#1e2533);border:1px solid var(--border2,rgba(255,255,255,0.12));
      border-radius:14px;padding:0;box-shadow:0 12px 40px rgba(0,0,0,0.6);
      width:290px;z-index:10000;font-family:var(--font,'DM Sans',sans-serif);
      overflow:hidden;animation:_cdp-in 0.18s ease;
    }
    @keyframes _cdp-in{from{opacity:0;transform:scale(0.95) translateY(-6px)}to{opacity:1;transform:none}}
    #_cdp-header{
      display:flex;align-items:center;gap:8px;
      background:var(--bg3,#141824);border-bottom:1px solid var(--border,rgba(255,255,255,0.07));
      padding:12px 14px;
    }
    #_cdp-icon{font-size:18px;opacity:0.7}
    #_cdp-display{
      flex:1;font-size:15px;font-weight:700;color:var(--text,#e0e8f0);
      letter-spacing:0.3px;font-family:var(--font-mono,'JetBrains Mono',monospace);
    }
    #_cdp-clear{
      background:rgba(255,255,255,0.08);border:none;border-radius:50%;width:24px;height:24px;
      color:var(--text3,#6b7a99);font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;
      transition:background 0.15s;line-height:1;padding:0;
    }
    #_cdp-clear:hover{background:rgba(224,82,82,0.25);color:#e05252}
    #_cdp-nav{
      display:flex;align-items:center;justify-content:space-between;
      padding:10px 14px;gap:6px;
    }
    #_cdp-nav button{
      background:var(--bg4,rgba(255,255,255,0.05));border:1px solid var(--border,rgba(255,255,255,0.07));
      border-radius:8px;padding:5px 11px;color:var(--text2,#b0bcd4);font-size:16px;
      cursor:pointer;transition:background 0.15s;
    }
    #_cdp-nav button:hover{background:var(--bg3,#141824)}
    #_cdp-month-lbl{font-size:14px;font-weight:800;color:var(--text,#e0e8f0);display:flex;align-items:center;gap:8px}
    #_cdp-year-sel{
      background:var(--bg4,rgba(255,255,255,0.06));border:1px solid var(--border2,rgba(255,255,255,0.1));
      color:var(--text,#e0e8f0);border-radius:6px;padding:2px 4px;font-size:13px;font-weight:700;cursor:pointer;
    }
    #_cdp-dow{
      display:grid;grid-template-columns:repeat(7,1fr);
      padding:0 10px;margin-bottom:4px;
    }
    #_cdp-dow span{
      font-size:10px;font-weight:800;text-align:center;color:var(--text3,#6b7a99);
      text-transform:uppercase;letter-spacing:0.6px;padding:4px 0;
    }
    #_cdp-days{
      display:grid;grid-template-columns:repeat(7,1fr);
      padding:0 10px 12px;gap:2px;
    }
    ._cdp-day{
      aspect-ratio:1;display:flex;align-items:center;justify-content:center;
      font-size:12px;font-weight:500;border-radius:8px;cursor:pointer;
      color:var(--text,#e0e8f0);transition:background 0.12s,color 0.12s;
      border:none;background:transparent;
    }
    ._cdp-day:hover{background:var(--bg3,rgba(255,255,255,0.08))}
    ._cdp-day.today{background:var(--gold,#c8a84b);color:#000;font-weight:800}
    ._cdp-day.today:hover{background:var(--gold2,#dbbe6e)}
    ._cdp-day.selected{background:var(--blue,#4a9cf0);color:#fff;font-weight:800}
    ._cdp-day.other-month{color:var(--text3,#6b7a99);opacity:0.45}
    ._cdp-day.other-month:hover{opacity:0.7}
    .cdp-input-wrap{position:relative;display:inline-block;width:100%}
    .cdp-trigger{
      cursor:pointer!important;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' fill='none' viewBox='0 0 24 24' stroke='%236b7a99' stroke-width='2'%3E%3Crect x='3' y='4' width='18' height='18' rx='2'/%3E%3Cline x1='16' y1='2' x2='16' y2='6'/%3E%3Cline x1='8' y1='2' x2='8' y2='6'/%3E%3Cline x1='3' y1='10' x2='21' y2='10'/%3E%3C/svg%3E") !important;
      background-repeat:no-repeat!important;background-position:calc(100% - 10px) center!important;
      padding-right:36px!important;
    }
  `;
  document.head.appendChild(s);

  // Create picker DOM
  const overlay = document.createElement('div');
  overlay.id = '_cdp-overlay';
  overlay.innerHTML = `
    <div id="_cdp-box">
      <div id="_cdp-header">
        <span id="_cdp-icon">📅</span>
        <span id="_cdp-display">Select date</span>
        <button id="_cdp-clear" title="Clear date" onclick="_cdpClear()">✕</button>
      </div>
      <div id="_cdp-nav">
        <button onclick="_cdpPrev()">‹</button>
        <div id="_cdp-month-lbl">
          <span id="_cdp-month-name"></span>
          <select id="_cdp-year-sel" onchange="_cdpSetYear(this.value)"></select>
        </div>
        <button onclick="_cdpNext()">›</button>
      </div>
      <div id="_cdp-dow">
        <span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span>
      </div>
      <div id="_cdp-days"></div>
    </div>`;
  document.body.appendChild(overlay);

  // Close on outside click
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) _cdpClose();
  });
})();

let _cdpTarget = null, _cdpY = new Date().getFullYear(), _cdpM = new Date().getMonth(), _cdpSelected = null;
const _MN = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function showCustomDatePicker(input, event) {
  if (event) event.stopPropagation();
  _cdpTarget = input;
  // Parse existing value
  const v = input.value;
  let d = v ? new Date(v + 'T00:00:00') : new Date();
  if (isNaN(d.getTime())) d = new Date();
  _cdpSelected = v ? new Date(v + 'T00:00:00') : null;
  _cdpY = d.getFullYear(); _cdpM = d.getMonth();
  _cdpBuildYearSelect();
  _cdpRender();
  // Position box near input
  const box = document.getElementById('_cdp-box');
  const rect = input.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  box.style.top = spaceBelow > 310 ? (rect.bottom + window.scrollY + 4) + 'px' : (rect.top + window.scrollY - 320) + 'px';
  box.style.left = Math.min(rect.left, window.innerWidth - 300) + 'px';
  document.getElementById('_cdp-overlay').classList.add('open');
}
function _cdpClose() {
  document.getElementById('_cdp-overlay').classList.remove('open');
  _cdpTarget = null;
}
function _cdpClear() {
  if (_cdpTarget) { _cdpTarget.value = ''; _cdpTarget.dispatchEvent(new Event('input',{bubbles:true})); _cdpTarget.dispatchEvent(new Event('change',{bubbles:true})); }
  _cdpSelected = null;
  document.getElementById('_cdp-display').textContent = 'Select date';
  _cdpClose();
}
function _cdpPrev() { _cdpM--; if (_cdpM < 0) { _cdpM = 11; _cdpY--; } _cdpBuildYearSelect(); _cdpRender(); }
function _cdpNext() { _cdpM++; if (_cdpM > 11) { _cdpM = 0; _cdpY++; } _cdpBuildYearSelect(); _cdpRender(); }
function _cdpSetYear(y) { _cdpY = parseInt(y); _cdpRender(); }
function _cdpBuildYearSelect() {
  const sel = document.getElementById('_cdp-year-sel'); if (!sel) return;
  const min = 2015, max = new Date().getFullYear() + 10;
  if (!sel.dataset.min || parseInt(sel.dataset.min) !== min) {
    sel.innerHTML = '';
    for (let y = min; y <= max; y++) { const o = document.createElement('option'); o.value = o.textContent = y; sel.appendChild(o); }
    sel.dataset.min = min;
  }
  sel.value = _cdpY;
}
function _cdpRender() {
  const mn = document.getElementById('_cdp-month-name'); if (mn) mn.textContent = _MN[_cdpM];
  const ysel = document.getElementById('_cdp-year-sel'); if (ysel) ysel.value = _cdpY;
  const now = new Date(), todayY = now.getFullYear(), todayM = now.getMonth(), todayD = now.getDate();
  const first = new Date(_cdpY, _cdpM, 1).getDay();
  const days = new Date(_cdpY, _cdpM + 1, 0).getDate();
  const prevDays = new Date(_cdpY, _cdpM, 0).getDate();
  const selY = _cdpSelected ? _cdpSelected.getFullYear() : -1;
  const selM = _cdpSelected ? _cdpSelected.getMonth() : -1;
  const selD = _cdpSelected ? _cdpSelected.getDate() : -1;
  let html = '';
  for (let i = 0; i < first; i++) {
    const d = prevDays - first + 1 + i;
    html += `<button class="_cdp-day other-month" onclick="_cdpPrev();_cdpPick(${d})">${d}</button>`;
  }
  for (let d = 1; d <= days; d++) {
    const isToday = d === todayD && _cdpM === todayM && _cdpY === todayY;
    const isSel = d === selD && _cdpM === selM && _cdpY === selY;
    const cls = isToday ? 'today' : isSel ? 'selected' : '';
    html += `<button class="_cdp-day ${cls}" onclick="_cdpPick(${d})">${d}</button>`;
  }
  let extra = 0; while ((first + days + extra) % 7 !== 0) extra++;
  for (let d = 1; d <= extra; d++) html += `<button class="_cdp-day other-month" onclick="_cdpNext();_cdpPick(${d})">${d}</button>`;
  document.getElementById('_cdp-days').innerHTML = html;
  // Update display
  const disp = document.getElementById('_cdp-display');
  if (disp && _cdpSelected) disp.textContent = String(_cdpSelected.getDate()).padStart(2,'0') + '/' + String(_cdpSelected.getMonth()+1).padStart(2,'0') + '/' + _cdpSelected.getFullYear();
  else if (disp) disp.textContent = 'Select date';
}
function _cdpPick(d) {
  _cdpSelected = new Date(_cdpY, _cdpM, d);
  const val = _cdpY + '-' + String(_cdpM + 1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
  if (_cdpTarget) {
    _cdpTarget.value = val;
    _cdpTarget.dispatchEvent(new Event('input', {bubbles:true}));
    _cdpTarget.dispatchEvent(new Event('change', {bubbles:true}));
  }
  _cdpRender();
  setTimeout(_cdpClose, 160);
}
// ─────────────────────────────────────────────────────────────────────────────

// ════════════════════════════════════════════════════════════════════════════
// FIX #9 — AUTO CAPITALIZE (fallback if src/utils.js hasn't defined these)
// ════════════════════════════════════════════════════════════════════════════
if (typeof autoCapName === 'undefined') {
  window.autoCapName = function(inp) {
    const v = inp.value;
    // Capitalize first letter of each word
    inp.value = v.replace(/\b\w/g, c => c.toUpperCase());
    // Move caret to end
    try { const len = inp.value.length; inp.setSelectionRange(len, len); } catch(e) {}
  };
}
if (typeof capFirstChar === 'undefined') {
  window.capFirstChar = function(inp) {
    if (inp.value.length === 1) inp.value = inp.value.toUpperCase();
  };
}
// Inject global CSS so name/text columns display capitalized everywhere in app
(function _injectCapCSS() {
  if (document.getElementById('_cap-css')) return;
  const s = document.createElement('style');
  s.id = '_cap-css';
  s.textContent = `
    /* Fix #9: Auto-capitalize student names and text fields throughout app */
    .td-name > div > div:first-child,
    input.form-control[id*="name"], input.form-control[id*="tname"],
    input.form-control[id*="fname"], input.form-control[id*="father"],
    input.form-control[id*="search-students"],
    input.form-control[placeholder*="name"], input.form-control[placeholder*="Name"] {
      text-transform: capitalize;
    }
    /* Prevent ALL-CAPS display in tables – normalize to Title Case via CSS */
    table td { font-variant: normal; text-transform: none; }
    table td .td-name div { text-transform: capitalize; }
  `;
  document.head.appendChild(s);
})();
// ─────────────────────────────────────────────────────────────────────────────

// ════════════════════════════════════════════════════════════════════════════
// TOAST
// ════════════════════════════════════════════════════════════════════════════
// ── Camera Permission Banner ──────────────────────────────────────────────────
// Shows a persistent, dismissible sticky banner when camera access is blocked.
// Uses a flag so it never appears twice at the same time.
var _camPermBannerActive = false;
function _showCameraPermBanner() {
  if (_camPermBannerActive || document.getElementById('cam-perm-banner')) return;
  _camPermBannerActive = true;
  var b = document.createElement('div');
  b.id = 'cam-perm-banner';
  b.style.cssText = [
    'position:fixed','top:0','right:0','z-index:99998',
    'background:linear-gradient(135deg,#2a0a0a,#3d0f0f)',
    'border:1.5px solid rgba(224,82,82,0.6)',
    'border-top:none','border-right:none',
    'border-radius:0 0 0 12px',
    'color:#f0c0c0','font-size:12.5px','font-weight:500',
    'padding:10px 14px 10px 16px',
    'display:flex','align-items:flex-start','gap:10px',
    'max-width:340px','line-height:1.5',
    'box-shadow:-4px 4px 20px rgba(0,0,0,0.5)'
  ].join(';');
  b.innerHTML =
    '<span style="font-size:18px;flex-shrink:0;margin-top:1px">📷</span>' +
    '<span style="flex:1"><strong style="color:#e05252;display:block;margin-bottom:3px">Camera permission blocked.</strong>' +
    'Go to <strong style="color:#f0c0c0">Windows Settings → Privacy &amp; Security → Camera</strong> and enable this app, then restart.</span>' +
    '<button onclick="document.getElementById(\'cam-perm-banner\').remove();window._camPermBannerActive=false;" ' +
      'style="background:none;border:none;color:#e05252;font-size:16px;cursor:pointer;padding:0 0 0 6px;line-height:1;flex-shrink:0;margin-top:1px" ' +
      'title="Dismiss">✕</button>';
  document.body.appendChild(b);
}

function toast(msg, type='info') {
  const icons={success:'✓',error:'✕',info:'ℹ'};
  const t=document.createElement('div');
  t.className=`toast ${type}`;
  t.innerHTML=`<span>${icons[type]||'•'}</span><span>${escHtml(msg)}</span>`;
  document.getElementById('toast-container').appendChild(t);
  // BUG FIX 1: transition must be set BEFORE changing opacity, otherwise the
  //   browser applies the new opacity instantly with no animation.
  // BUG FIX 2: 800ms is too short for error messages; use type-aware timing.
  const delay = type==='error' ? 4000 : 2500;
  setTimeout(()=>{ t.style.transition='opacity 0.3s'; t.style.opacity='0'; setTimeout(()=>t.remove(),300); }, delay);
}

// ════════════════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// LOGO UPLOAD
// ════════════════════════════════════════════════════════════════════════════
function uploadLogo(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const img  = document.getElementById('sb-logo-img');
    const svg  = document.getElementById('sb-logo-svg');
    img.src = e.target.result;
    img.style.display = 'block';
    if (svg) svg.style.display = 'none';
    // Also sync login screen logo
    const loginImg   = document.getElementById('login-logo-img');
    const loginEmoji = document.getElementById('login-logo-emoji');
    if (loginImg)   { loginImg.src = e.target.result; loginImg.style.display = 'block'; }
    if (loginEmoji) loginEmoji.style.display = 'none';
    window._HOSTEL_LOGO = e.target.result;
    apiSaveLogo(e.target.result).catch(function(err){ if(typeof toast==='function') toast('Logo save failed: '+err.message,'error'); });
    toast('Logo updated — login screen updated too', 'success');
  };
  reader.readAsDataURL(file);
  input.value = '';
}
function loadSavedLogo() {
  apiGetLogo().then(function(saved) {
    if (!saved) return;
    window._HOSTEL_LOGO = saved; // used by receipt.js for logo on receipts
    var img   = document.getElementById('sb-logo-img');
    var svg   = document.getElementById('sb-logo-svg');
    if (img) { img.src = saved; img.style.display = 'block'; if(svg) svg.style.display='none'; }
    var loginImg   = document.getElementById('login-logo-img');
    var loginEmoji = document.getElementById('login-logo-emoji');
    if (loginImg)   { loginImg.src = saved; loginImg.style.display = 'block'; }
    if (loginEmoji) loginEmoji.style.display = 'none';
  }).catch(function(){});
}

// ════════════════════════════════════════════════════════════════════════════
// SIDEBAR CALENDAR (professional compact inline calendar)
// ════════════════════════════════════════════════════════════════════════════
let _sbCalYear = new Date().getFullYear();
let _sbCalMonth = new Date().getMonth(); // 0-indexed
let _sbCalOpen = false;

function toggleSbCal() {
  _sbCalOpen = !_sbCalOpen;
  const body = document.getElementById('sb-cal-body');
  const arrow = document.getElementById('sb-cal-arrow');
  if(body) body.style.display = _sbCalOpen ? 'block' : 'none';
  if(arrow) arrow.style.opacity = _sbCalOpen ? '1' : '0.6';
  if(_sbCalOpen) renderSidebarCalendar();
}
function closeSbCal() {
  _sbCalOpen = false;
  const body = document.getElementById('sb-cal-body');
  const arrow = document.getElementById('sb-cal-arrow');
  if(body) body.style.display = 'none';
  if(arrow) arrow.style.opacity = '0.6';
}

// Close calendar when clicking anywhere outside it
document.addEventListener('click', function(e) {
  if(!_sbCalOpen) return;
  const wrap = document.getElementById('sb-calendar-wrap');
  if(wrap && !wrap.contains(e.target)) closeSbCal();
});

function renderSidebarCalendar() {
  const lbl = document.getElementById('sb-cal-current-lbl');
  const todayLbl = document.getElementById('sb-cal-today-lbl');
  const daysEl = document.getElementById('sb-cal-days');
  if(!lbl || !daysEl) return;

  const now = new Date();
  const todayDate = now.getDate();
  const todayMonth = now.getMonth();
  const todayYear = now.getFullYear();

  // Always update today label in header (visible even when collapsed)
  if(todayLbl) {
    todayLbl.textContent = now.toLocaleString('default',{weekday:'short',day:'numeric',month:'short'});
  }
  if(!_sbCalOpen) return; // only render days grid if expanded

  const d = new Date(_sbCalYear, _sbCalMonth, 1);
  const monthName = d.toLocaleString('default',{month:'long'});
  const monthKey = `${_sbCalYear}-${String(_sbCalMonth+1).padStart(2,'0')}`;
  lbl.textContent = monthName;

  // ── Year dropdown ──────────────────────────────────────────────────────────
  const yearSel = document.getElementById('sb-cal-year-sel');
  if(yearSel) {
    const minYear = 2026;
    const maxYear = new Date().getFullYear() + 5;
    // Re-build only when range changes
    const needsBuild = !yearSel.dataset.min || parseInt(yearSel.dataset.min) !== minYear || parseInt(yearSel.dataset.max) !== maxYear;
    if(needsBuild) {
      yearSel.innerHTML = '';
      for(let y = minYear; y <= maxYear; y++) {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y;
        yearSel.appendChild(opt);
      }
      yearSel.dataset.min = minYear;
      yearSel.dataset.max = maxYear;
    }
    yearSel.value = _sbCalYear;
  }

  // Days in month, first day of week (Mon=0)
  const daysInMonth = new Date(_sbCalYear, _sbCalMonth+1, 0).getDate();
  let startDay = d.getDay() - 1; if(startDay < 0) startDay = 6;

  // Payment indicators
  const hasPaid = DB.payments.some(p=>p.status==='Paid'&&_payMatchesMonth(p,monthKey));
  const hasPend = DB.payments.some(p=>p.status==='Pending'&&_payMatchesMonth(p,monthKey));

  // Build paid days set for dot indicators
  const paidDays = new Set();
  const pendDays = new Set();
  DB.payments.forEach(p=>{
    const d2 = p.paidDate||p.date||'';
    if(d2.startsWith(monthKey)) {
      const day = parseInt(d2.slice(8,10));
      if(p.status==='Paid') paidDays.add(day);
      else pendDays.add(day);
    }
  });

  let html = '';
  // Empty cells before first day
  for(let i=0;i<startDay;i++) html += '<div></div>';

  for(let day=1;day<=daysInMonth;day++) {
    const isToday = day===todayDate && _sbCalMonth===todayMonth && _sbCalYear===todayYear;
    const isPast = new Date(_sbCalYear,_sbCalMonth,day) < new Date(todayYear,todayMonth,todayDate);
    const hasPaidDot = paidDays.has(day);
    const hasPendDot = pendDays.has(day);
    const dotColor = hasPaidDot ? 'var(--green)' : hasPendDot ? 'var(--amber)' : 'transparent';

    const dayDateStr = `${monthKey}-${String(day).padStart(2,'0')}`;
    const isFuture = new Date(_sbCalYear,_sbCalMonth,day) > new Date(todayYear,todayMonth,todayDate);

    let bg = 'transparent';
    let color = isPast ? 'var(--text3)' : 'var(--text)';
    let border = 'none';
    if(isToday) { bg='var(--gold)'; color='#000'; border='none'; }

    html += `<div onclick="navigateToMonth('${monthKey}');closeSbCal()" title="View ${monthKey} on dashboard" style="position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;aspect-ratio:1;border-radius:5px;cursor:pointer;background:${bg};color:${color};font-size:10.5px;font-weight:${isToday?'800':'500'};transition:background 0.12s;border:${border}" onmouseover="if('${isToday}'!=='true')this.style.background='var(--bg3)'" onmouseout="if('${isToday}'!=='true')this.style.background='transparent'">
      ${day}
      <div style="width:4px;height:4px;border-radius:50%;background:${dotColor};margin-top:1px"></div>
    </div>`;
  }
  daysEl.innerHTML = html;
}

function sbCalPrev() {
  _sbCalMonth--;
  if(_sbCalMonth < 0) { _sbCalMonth=11; _sbCalYear--; }
  renderSidebarCalendar();
  // Auto-update dashboard when navigating calendar months
  const key = _sbCalYear + '-' + String(_sbCalMonth+1).padStart(2,'0');
  _dashboardMonth = key;
  const resetBtn = document.getElementById('sb-cal-reset-btn');
  if(resetBtn) resetBtn.style.display = 'inline-block';
  renderPage(currentPage);
}
function sbCalNext() {
  _sbCalMonth++;
  if(_sbCalMonth > 11) { _sbCalMonth=0; _sbCalYear++; }
  renderSidebarCalendar();
  // Auto-update dashboard when navigating calendar months
  const key = _sbCalYear + '-' + String(_sbCalMonth+1).padStart(2,'0');
  _dashboardMonth = key;
  const resetBtn = document.getElementById('sb-cal-reset-btn');
  if(resetBtn) resetBtn.style.display = 'inline-block';
  renderPage(currentPage);
}

// Called when user picks a year from the year dropdown inside the sidebar calendar
function sbCalSetYear(year) {
  _sbCalYear = parseInt(year);
  renderSidebarCalendar();
  const key = _sbCalYear + '-' + String(_sbCalMonth+1).padStart(2,'0');
  _dashboardMonth = key;
  const resetBtn = document.getElementById('sb-cal-reset-btn');
  if(resetBtn) resetBtn.style.display = 'inline-block';
  renderPage(currentPage);
}

// Navigate dashboard/reports to a specific month (called from calendar click)
// ── TREND CHART DRAWING (stock-market style) ─────────────────────────────────
// ── TREND CHART (Chart.js — Jan–Dec, revenue line + hover tooltip) ───────────
var _dashTrendChart = null;
setTimeout(function(){
  if(typeof Chart!=='undefined'&&typeof ChartDataLabels!=='undefined') Chart.register(ChartDataLabels);
},0);

function drawTrendChart() {
  var canvas = document.getElementById('trend-canvas');
  if (!canvas || typeof Chart === 'undefined') return;

  var MS2 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var MN2 = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var now  = new Date();
  var yr   = now.getFullYear();
  var curKey = yr + '-' + String(now.getMonth()+1).padStart(2,'0');

  var months=[], revD=[], expD=[], trfD=[], pendD=[], real=[];
  for(var i=0;i<12;i++){
    var k = yr+'-'+String(i+1).padStart(2,'0');
    var isPast = k <= curKey;
    var rev = isPast ? calcRevenue(k) : 0;
    var exp = isPast ? (DB.expenses||[]).filter(e=>(e.date||'').startsWith(k)).reduce((s,e)=>s+Number(e.amount||0),0) : 0;
    var trf = isPast ? (DB.transfers||[]).filter(t=>(t.date||'').startsWith(k)).reduce((s,t)=>s+Number(t.amount||0),0) : 0;
    var pend= isPast ? (DB.payments||[]).filter(p=>p.status==='Pending'&&_payMatchesMonth(p,k)).reduce((s,p)=>s+(p.unpaid!=null?Number(p.unpaid):Number(p.amount||0)),0) : 0;
    months.push({label:MS2[i], full:MN2[i]+' '+yr, key:k});
    revD.push(isPast&&rev>0?rev:null);
    expD.push(isPast&&exp>0?exp:null);
    trfD.push(isPast&&trf>0?trf:null);
    pendD.push(isPast&&pend>0?pend:null);
    real.push(isPast&&rev>0);
  }

  var plotRev = revD.map(function(v){return v!==null?v:0;});
  var ptColors = plotRev.map(function(v,i){
    if(!real[i]) return 'rgba(0,230,118,0.15)';
    if(i===0) return '#00e676';
    var p=null; for(var j=i-1;j>=0;j--){if(real[j]){p=plotRev[j];break;}} return v>=(p||0)?'#00e676':'#ff4d6d';
  });
  var lblColors = plotRev.map(function(v,i){
    if(!real[i]) return 'rgba(255,255,255,0.1)';
    if(i===0) return '#00e676';
    return v>=(plotRev[i-1]||0)?'#00e676':'#ff4d6d';
  });

  var badge = document.getElementById('trend-hb');
  function showBadge(idx,x,y){
    var rev=revD[idx]||0, exp=expD[idx]||0, trf=trfD[idx]||0, pend=pendD[idx]||0, net=rev-exp-trf;
    var isR=real[idx];
    badge.innerHTML='<div style="font-size:12px;font-weight:700;color:#e8eef8;margin-bottom:8px">'+months[idx].full+'</div>'+(isR?[
      '<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="display:flex;align-items:center;gap:5px;color:#8a9ab8"><span style="width:7px;height:7px;border-radius:50%;background:#00e676;display:inline-block"></span>Revenue</span><span style="font-weight:700;color:#00e676">'+fmtPKR(rev)+'</span></div>',
      '<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="display:flex;align-items:center;gap:5px;color:#8a9ab8"><span style="width:7px;height:7px;border-radius:50%;background:#ff4d6d;display:inline-block"></span>Expenses</span><span style="font-weight:700;color:#ff4d6d">'+fmtPKR(exp)+'</span></div>',
      '<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="display:flex;align-items:center;gap:5px;color:#8a9ab8"><span style="width:7px;height:7px;border-radius:50%;background:#ff8c42;display:inline-block"></span>Transfers</span><span style="font-weight:700;color:#ff8c42">'+fmtPKR(trf)+'</span></div>',
      '<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="display:flex;align-items:center;gap:5px;color:#8a9ab8"><span style="width:7px;height:7px;border-radius:50%;background:#f0c040;display:inline-block"></span>Pending</span><span style="font-weight:700;color:#f0c040">'+fmtPKR(pend)+'</span></div>',
      '<hr style="border:none;border-top:1px solid #2a3d52;margin:6px 0"/>',
      '<div style="display:flex;justify-content:space-between;font-weight:700"><span>Net</span><span style="color:'+(net>=0?'#00e676':'#ff4d6d')+'">'+(net>=0?'+':'−')+fmtPKR(net)+'</span></div>'
    ].join(''):'<div style="color:#4a6080;font-size:12px;text-align:center;padding:6px 0">No data yet</div>');
    var vw=window.innerWidth, vh=window.innerHeight;
    var left=x+16; if(left+230>vw) left=x-240;
    var top=y-80;  if(top<8) top=y+16; if(top+220>vh) top=vh-230;
    badge.style.left=left+'px'; badge.style.top=top+'px'; badge.style.display='block';
  }

  if(_dashTrendChart){_dashTrendChart.destroy();_dashTrendChart=null;}

  _dashTrendChart = new Chart(canvas.getContext('2d'),{
    type:'line',
    data:{
      labels:months.map(function(m){return m.label;}),
      datasets:[{
        data:plotRev,
        borderColor:function(c){var g=c.chart.ctx.createLinearGradient(0,0,c.chart.width,0);g.addColorStop(0,'#00e676');g.addColorStop(1,'rgba(0,230,118,0.3)');return g;},
        borderWidth:2.5,
        pointBackgroundColor:ptColors, pointBorderColor:ptColors,
        pointRadius:function(c){return real[c.dataIndex]?6:3;}, pointHoverRadius:9,
        tension:0.35, fill:false,
        datalabels:{
          display:function(c){return real[c.dataIndex];},
          anchor:'end',align:'top',offset:6,
          color:function(c){return lblColors[c.dataIndex];},
          backgroundColor:'#0f1c2e', borderColor:function(c){return lblColors[c.dataIndex];},
          borderWidth:1, borderRadius:4, padding:{top:3,bottom:3,left:7,right:7},
          font:{size:10,weight:'700'},
          formatter:function(v,c){
            var i=c.dataIndex; if(!real[i])return'';
            var pv=null; for(var j=i-1;j>=0;j--){if(real[j]){pv=plotRev[j];break;}}
            if(pv===null)return'PKR '+v.toLocaleString();
            var p=(((v-pv)/pv)*100).toFixed(1);
            return'PKR '+v.toLocaleString()+'\n'+(parseFloat(p)>=0?'▲':'▼')+' '+Math.abs(p)+'%';
          }
        }
      }]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      layout:{padding:{top:50,right:10,left:4,bottom:0}},
      plugins:{legend:{display:false},tooltip:{enabled:false}},
      onHover:function(event,els){
        if(els.length>0){
          var cx=event.native?event.native.clientX:event.x;
          var cy=event.native?event.native.clientY:event.y;
          showBadge(els[0].index,cx,cy);
        } else { if(badge) badge.style.display='none'; }
      },
      scales:{
        x:{grid:{color:'rgba(255,255,255,0.03)'},border:{display:false},ticks:{color:'#4a6080',font:{size:11}}},
        y:{grid:{color:'rgba(255,255,255,0.03)'},border:{display:false},ticks:{color:'#4a6080',font:{size:11},callback:function(v){return v>=1e6?(v/1e6).toFixed(1)+'M':v>=1000?(v/1000).toFixed(0)+'k':v;}}}
      }
    }
  });
}
// ─────────────────────────────────────────────────────────────────────────────

function navigateToMonth(monthKey) {
  const realMonth = new Date().toISOString().slice(0,7);
  _dashboardMonth = (monthKey === realMonth) ? null : monthKey;
  const resetBtn = document.getElementById('sb-cal-reset-btn');
  if(resetBtn) resetBtn.style.display = _dashboardMonth ? 'inline-block' : 'none';
  if(currentPage === 'reports') {
    reportPeriod = 'month'; reportDetail = null; renderPage('reports');
  } else if(currentPage === 'dashboard') {
    renderPage('dashboard');
  } else {
    // Stay on whatever page the user is on — re-render it filtered to the new month
    renderPage(currentPage);
  }
  const d = new Date(monthKey+'-01');
  toast('Viewing → ' + d.toLocaleString('default',{month:'long',year:'numeric'}), 'info');
}

// Download detail panel as CSV
function downloadDetailCSV(type) {
  const key = reportPeriod==='month' ? thisMonth() : thisYear();
  let rows = [], filename = '';
  if (type === 'financial') {
    filename = 'Revenue_'+key+'.csv';
    rows.push(['Student','Room','Month','Amount Paid','Method','Date']);
    DB.payments.filter(p=>p.status==='Paid'&&_payMatchesMonth(p,key)).forEach(p=>{
      rows.push([p.studentName||'—','#'+(p.roomNumber||'—'),p.month||'—',p.amount,p.method||'—',p.date||'—']);
    });
  } else if (type === 'pending') {
    filename = 'Pending_Payments.csv';
    rows.push(['Student','Room','Month','Partial Paid','Outstanding','Method','Date']);
    DB.payments.filter(p=>p.status==='Pending').forEach(p=>{
      rows.push([p.studentName||'—','#'+(p.roomNumber||'—'),p.month||'—',
        p.unpaid!=null?p.amount:0, p.unpaid!=null?p.unpaid:p.amount,
        p.method||'—', p.date||'—']);
    });
  } else if (type === 'expenses') {
    filename = 'Expenses_'+key+'.csv';
    rows.push(['Date','Category','Description','Amount']);
    DB.expenses.filter(e=>(e.date||'').startsWith(key)).forEach(e=>{
      rows.push([e.date||'—',e.category||'—',e.description||'—',e.amount]);
    });
  } else if (type === 'transfers') {
    filename = 'Transfers.csv';
    rows.push(['Date','Description','Method','Amount','Received By','Notes']);
    (DB.transfers||[]).forEach(t=>{
      rows.push([t.date||'—',t.description||'—',t.method||'—',t.amount,t.receivedBy||'—',t.notes||'—']);
    });
  } else if (type === 'students') {
    filename = 'Students_'+(studentReportFilter==='All'?'All':studentReportFilter)+'.csv';
    rows.push(['Name','Father Name','Room','Phone','CNIC','Join Date','Rent','Status']);
    const list = studentReportFilter==='All' ? DB.students : DB.students.filter(t=>t.status===studentReportFilter);
    list.forEach(t=>{
      const r = DB.rooms.find(x=>x.id===t.roomId);
      rows.push([t.name||'—',t.fatherName||'—',r?'#'+r.number:'—',t.phone||'—',t.cnic||'—',t.joinDate||'—',t.rent,t.status||'—']);
    });
  } else if (type === 'netprofit') {
    filename = 'AvailableFund_'+key+'.csv';
    rows.push(['Date','Type','Description','Amount']);
    DB.payments.filter(p=>p.status==='Paid'&&_payMatchesMonth(p,key)).forEach(p=>{
      rows.push([p.date||'—','Income',p.studentName+' · '+p.month,p.amount]);
    });
    DB.expenses.filter(e=>(e.date||'').startsWith(key)).forEach(e=>{
      rows.push([e.date||'—','Expense',e.category+': '+e.description,'-'+e.amount]);
    });
  }
  if (!rows.length) { toast('No data to export','error'); return; }
  const csv = rows.map(r=>r.map(c=>'"'+String(c==null?'':c).replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1500); // FIX 18: revoke blob URL to free memory
  toast('Downloaded: '+filename,'success');
}
let calPopoverOpen = false;
function calPopSelect(key, label) {
  document.getElementById('cal-popover-el')?.remove();
  calPopoverOpen=false;
  showMonthDetailModal(key, label);
}


// ════════════════════════════════════════════════════════════════════════════
function checkAutoMonthAdvance() {
  if (DB.settings.autoMonthGenerate === false) return;
  const now = new Date();
  const currentMonthKey = now.toISOString().slice(0, 7);
  const lastGenKey = DB.settings.lastAutoGenMonth || null;
  if (lastGenKey === currentMonthKey) return;

  const startDate = lastGenKey ? new Date(lastGenKey + '-01') : new Date(now.getFullYear(), now.getMonth(), 1);
  if (lastGenKey) startDate.setMonth(startDate.getMonth() + 1);

  let totalAdded = 0;
  let monthsGenerated = [];

  while (startDate <= now) {
    const mo = startDate.toLocaleString('default', { month: 'long', year: 'numeric' });
    const active = DB.students.filter(t => t.status === 'Active');
    let added = 0;
    active.forEach(t => {
      if (!DB.payments.some(p => p.studentId === t.id && p.month === mo)) {
        const room = DB.rooms.find(r => r.id === t.roomId);
        DB.payments.push({
          id: 'p_' + uid(), studentId: t.id, studentName: t.name,
          roomId: t.roomId, roomNumber: room?.number || '',
          amount: 0, monthlyRent: t.rent, totalRent: t.rent, unpaid: t.rent,
          method: t.paymentMethod || 'Cash', month: mo,
          date: startDate.toISOString().split('T')[0],
          dueDate: '', status: 'Pending',
          notes: 'Auto-generated', paidDate: ''
        });
        added++;
      }
    });
    if (added > 0) { totalAdded += added; monthsGenerated.push(mo); }
    startDate.setMonth(startDate.getMonth() + 1);
  }

  DB.settings.lastAutoGenMonth = currentMonthKey;
  saveDB();

  if (totalAdded > 0) {
    const msg = monthsGenerated.length === 1
      ? '🗓️ Auto-generated ' + totalAdded + ' payment records for ' + monthsGenerated[0]
      : '🗓️ Auto-generated ' + totalAdded + ' payment records for ' + monthsGenerated.length + ' months';
    toast(msg, 'success');
  }
}

function quickDashTransfer() {
  const amt = parseFloat(document.getElementById('dash-transfer-amt')?.value)||0;
  const method = document.getElementById('dash-transfer-method')?.value||'Cash';
  const recv = document.getElementById('dash-transfer-recv')?.value?.trim()||'';
  const desc = document.getElementById('dash-transfer-desc')?.value?.trim()||'Transfer to Owner';
  if(!amt||amt<=0){toast('Enter a valid amount','error');return;}
  if(!DB.transfers) DB.transfers=[];
  DB.transfers.push({id:'tr_'+uid(),amount:amt,method,receivedBy:recv,description:desc,date:today()});
  saveDB();
  ['dash-transfer-amt','dash-transfer-recv','dash-transfer-desc'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  renderPage('dashboard');
  toast(`Transfer of ${fmtPKR(amt)} recorded!`,'success');
}

// Alias the old name for backward compat

// ── DASHBOARD GLOBAL SEARCH ───────────────────────────────────────────────────
function dashGlobalSearch(query) {
  var clearBtn = document.getElementById('dash-search-clear');
  var resultsBox = document.getElementById('dash-search-results');
  if (!resultsBox) return;
  if (clearBtn) clearBtn.style.display = query.length > 0 ? 'inline-flex' : 'none';
  if (!query.trim()) { resultsBox.style.display = 'none'; return; }

  var q = query.trim().toLowerCase();
  var results = [];

  // Search students: name, father name, CNIC, phone, address, city
  DB.students.forEach(function(s) {
    var room = DB.rooms.find(function(r){ return r.id === s.roomId; });
    var roomLabel = room ? '#' + room.number : '—';
    var haystack = [s.id, s.name, s.fatherName, s.cnic, s.phone, s.emergencyContact, s.email, s.occupation, s.address, s.city, s.permanentAddress, roomLabel].filter(Boolean).join(' ').toLowerCase();
    if (haystack.includes(q)) {
      results.push({
        type: 'student', icon: '🧑‍🎓',
        title: s.name || '—',
        sub: 'ID: ' + s.id + ' · Room ' + roomLabel + (s.occupation ? ' · ' + s.occupation : '') + (s.phone ? ' · ' + s.phone : ''),
        badge: statusBadge(s.status || 'Active'),
        action: "showViewStudentModal('" + s.id + "')"
      });
    }
  });

  // Search rooms: number, type, floor, amenities
  DB.rooms.forEach(function(r) {
    var type = getRoomType(r);
    var occ = getRoomOccupancy(r);
    var haystack = ['room', r.number, type ? type.name : '', r.floor, (r.amenities || []).join(' ')].join(' ').toLowerCase();
    if (haystack.includes(q)) {
      results.push({
        type: 'room', icon: '🛏️',
        title: 'Room #' + r.number,
        sub: (type ? type.name : '') + ' · ' + r.floor + ' Floor · ' + occ + '/' + (type ? type.capacity : 1) + ' filled',
        badge: '<span class="badge ' + (occ >= (type ? type.capacity : 1) ? 'badge-green' : 'badge-gray') + '">' + (occ >= (type ? type.capacity : 1) ? 'Full' : 'Available') + '</span>',
        action: "showRoomDetail('" + r.id + "')"
      });
    }
  });

  // Search by city / address / location
  var locationHits = {};
  DB.students.forEach(function(s) {
    var fields = [s.city, s.address, s.permanentAddress].filter(Boolean);
    fields.forEach(function(f) {
      if (f.toLowerCase().includes(q)) {
        var key = f.toLowerCase();
        if (!locationHits[key]) locationHits[key] = {city: f, students: []};
        locationHits[key].students.push(s.name);
      }
    });
  });
  Object.keys(locationHits).slice(0, 4).forEach(function(k) {
    var hit = locationHits[k];
    results.push({
      type: 'location', icon: '📍',
      title: hit.city,
      sub: hit.students.slice(0, 3).join(', ') + (hit.students.length > 3 ? ' +' + (hit.students.length - 3) + ' more' : ''),
      badge: '<span class="badge badge-blue">' + hit.students.length + ' student' + (hit.students.length !== 1 ? 's' : '') + '</span>',
      action: "studentFilter.search='" + hit.city.replace(/'/g, "\\'") + "';navigate('students')"
    });
  });

  // Payments by student name
  var payHits = [];
  DB.payments.forEach(function(p) {
    if ((p.studentName || '').toLowerCase().includes(q)) {
      if (!payHits.find(function(x){ return x.studentId === p.studentId; })) {
        payHits.push(p);
      }
    }
  });
  payHits.slice(0, 3).forEach(function(p) {
    results.push({
      type: 'payment', icon: '💳',
      title: p.studentName || '—',
      sub: p.month + ' · ' + (p.status === 'Paid' ? '✓ Paid' : '⏳ Pending') + ' · ' + fmtPKR(p.amount),
      badge: statusBadge(p.status),
      action: "payFilter.search='" + (p.studentName||'').replace(/'/g, "\\'") + "';navigate('payments')"
    });
  });

  if (!results.length) {
    resultsBox.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:13px">No results for <strong style="color:var(--text)">"' + escHtml(query) + '"</strong></div>';
    resultsBox.style.display = 'block';
    // Position under the search input
    var inp = document.getElementById('dash-global-search');
    if (inp) { var r2 = inp.getBoundingClientRect(); resultsBox.style.left = r2.left + 'px'; }
    return;
  }

  var grouped = {student:[], room:[], location:[], payment:[]};
  var groupLabels = {student:'Students', room:'Rooms', location:'Locations / Addresses', payment:'Finance'};
  // Also group by course for course searches
  var courseSub = {};
  DB.students.forEach(function(s){
    if(s.occupation && s.occupation.toLowerCase().includes(q)){
      var k = s.occupation;
      if(!courseSub[k]) courseSub[k]={course:k,students:[]};
      courseSub[k].students.push(s.name);
    }
  });
  Object.keys(courseSub).slice(0,3).forEach(function(k){
    var hit=courseSub[k];
    grouped['student'].push({type:'student',icon:'🎓',title:hit.course,sub:hit.students.slice(0,4).join(', ')+(hit.students.length>4?' +'+(hit.students.length-4)+' more':''),badge:'<span class="badge badge-blue">'+hit.students.length+' student'+(hit.students.length!==1?'s':'')+'</span>',action:"studentFilter.search='"+hit.course.replace(/'/g,"\\'")+ "';navigate('students')"});
  });
  results.forEach(function(r){ if (grouped[r.type]) grouped[r.type].push(r); });

  var html = '';
  ['student','room','location','payment'].forEach(function(type) {
    var items = grouped[type];
    if (!items.length) return;
    html += '<div style="padding:8px 14px 4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text3);border-bottom:1px solid var(--border)">' + groupLabels[type] + ' <span style="color:var(--text2)">' + items.length + '</span></div>';
    items.slice(0, 5).forEach(function(item) {
      html += '<div onclick="' + item.action + ';document.getElementById(\'dash-global-search\').value=\'\';dashGlobalSearchClear()" style="display:flex;align-items:center;gap:12px;padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);transition:background 0.12s" onmouseover="this.style.background=\'var(--bg3)\'" onmouseout="this.style.background=\'\'">';
      html += '<div style="width:32px;height:32px;border-radius:8px;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0">' + item.icon + '</div>';
      html += '<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(item.title) + '</div>';
      html += '<div style="font-size:11px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px">' + escHtml(item.sub) + '</div></div>';
      html += '<div style="flex-shrink:0">' + item.badge + '</div></div>';
    });
  });

  resultsBox.innerHTML = html;
  resultsBox.style.display = 'block';
  // Align dropdown under the header search input
  var inp2 = document.getElementById('dash-global-search');
  if (inp2) { var r3 = inp2.getBoundingClientRect(); resultsBox.style.left = r3.left + 'px'; }
}

function dashGlobalSearchClear() {
  var resultsBox = document.getElementById('dash-search-results');
  var clearBtn = document.getElementById('dash-search-clear');
  if (resultsBox) resultsBox.style.display = 'none';
  if (clearBtn) clearBtn.style.display = 'none';
}

// Close search results when clicking outside
document.addEventListener('click', function(e) {
  var box = document.getElementById('dash-search-results');
  var input = document.getElementById('dash-global-search');
  if (box && input && !box.contains(e.target) && e.target !== input) {
    box.style.display = 'none';
  }
});// ════════════════════════════════════════════════════════════════════════════
// 6-MONTH DATA RETENTION
// ════════════════════════════════════════════════════════════════════════════
async function enforceDataRetention() {
  // Keep ALL data from the last 6 full months + current month (7 months total)
  // Older records are archived to a separate localStorage key before pruning
  // IMPORTANT: Pending payments are NEVER archived — they represent active unpaid debt
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth() - 6, 1); // 6 months ago start
  const cutoffKey = cutoff.toISOString().slice(0,7); // e.g. "2025-09"

  // Archive old PAID payments before removing (Pending payments are never pruned)
  const oldPayments = DB.payments.filter(p => {
    if (p.status === 'Pending') return false; // never archive outstanding debt
    const d = p.paidDate||p.date||'';
    return d && d.slice(0,7) < cutoffKey;
  });
  const oldExpenses = DB.expenses.filter(e => {
    const d = e.date||'';
    return d && d.slice(0,7) < cutoffKey;
  });

  if(oldPayments.length > 0 || oldExpenses.length > 0) {
    // Save to archive
    try {
      let existingArchive = { payments: [], expenses: [] };
      try { existingArchive = await apiGetArchive(); } catch(e) {}
      // FIX #8: Deduplicate by ID before appending — repeated saves previously caused duplicate archive entries
      const existingPayIds = new Set((existingArchive.payments||[]).map(p => p.id));
      const existingExpIds = new Set((existingArchive.expenses||[]).map(e => e.id));
      existingArchive.payments = [
        ...(existingArchive.payments||[]),
        ...oldPayments.filter(p => !existingPayIds.has(p.id))
      ];
      existingArchive.expenses = [
        ...(existingArchive.expenses||[]),
        ...oldExpenses.filter(e => !existingExpIds.has(e.id))
      ];
      existingArchive.lastArchived = new Date().toISOString();
      apiSaveArchive(existingArchive).catch(console.error);
    } catch(e) {}

    // Remove from live DB — but keep all Pending payments regardless of age
    DB.payments = DB.payments.filter(p => {
      if (p.status === 'Pending') return true; // always keep unpaid records
      const d = p.paidDate||p.date||'';
      return !d || d.slice(0,7) >= cutoffKey;
    });
    DB.expenses = DB.expenses.filter(e => {
      const d = e.date||'';
      return !d || d.slice(0,7) >= cutoffKey;
    });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// THEME / ACCENT COLOR
// ════════════════════════════════════════════════════════════════════════════
function applyThemeColor(hex) {
  DB.settings.accentColor = hex;
  // FIX #12: Derive --gold2 as a lighter tint (not identical to --gold) for proper text contrast
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  // Lighten by blending toward white by ~30%
  const lighten = (ch) => Math.round(Math.min(255, ch + (255 - ch) * 0.30));
  const gold2Hex = '#' + [r,g,b].map(c => lighten(c).toString(16).padStart(2,'0')).join('');
  document.documentElement.style.setProperty('--gold', hex);
  document.documentElement.style.setProperty('--gold2', gold2Hex);
  document.documentElement.style.setProperty('--gold3', '#' + [r,g,b].map(c => Math.round(Math.min(255, c + (255-c)*0.55)).toString(16).padStart(2,'0')).join(''));
  document.documentElement.style.setProperty('--gold-dim', `rgba(${r},${g},${b},0.15)`);
  document.documentElement.style.setProperty('--shadow-gold', `0 4px 20px rgba(${r},${g},${b},0.25)`);
  saveDB();
  const lbl=document.getElementById('accent-hex-label'); if(lbl) lbl.textContent=hex;
  renderPage('settings');
  toast('Theme color updated','success');
}

function applySavedTheme() {
  var hex = DB.settings.accentColor || '#e05252';
  if (!hex || hex.length !== 7) return;
  var r = parseInt(hex.slice(1,3), 16);
  var g = parseInt(hex.slice(3,5), 16);
  var b = parseInt(hex.slice(5,7), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return;
  var lighten = function(ch) { return Math.round(Math.min(255, ch + (255 - ch) * 0.30)); };
  var gold2Hex = '#' + [r,g,b].map(function(c){ return lighten(c).toString(16).padStart(2,'0'); }).join('');
  document.documentElement.style.setProperty('--gold', hex);
  document.documentElement.style.setProperty('--gold2', gold2Hex);
}

function applySavedSidebar() {
  const w = DB.settings.sidebarWidth;
  if(w && w!==260) {
    document.documentElement.style.setProperty('--sidebar-w', w+'px');
    const main=document.getElementById('main'); if(main) main.style.marginLeft=w+'px';
  }
}

document.getElementById('hdr-date').textContent = new Date().toLocaleDateString('en-PK',{weekday:'short',day:'2-digit',month:'short',year:'numeric'});

// ── WEB BOOT — loads from MongoDB API on startup ──────────────────────────────
// loadDB() is now async (fetches from /api/sync). We run it then boot the UI.
(async function _boot() {
  // Show a loading indicator while data fetches from server
  var contentEl = document.getElementById('content');
  if (contentEl) contentEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:60vh;flex-direction:column;gap:16px"><div style="width:40px;height:40px;border:3px solid rgba(200,168,75,0.2);border-top-color:#c8a84b;border-radius:50%;animation:spin 0.9s linear infinite"></div><div style="color:var(--text3);font-size:13px">Loading hostel data…</div></div>';

  try {
    await loadDB();
  } catch(e) {
    console.error('[Boot] loadDB failed:', e.message);
  }

  migrateStudentIdsToNumeric();

// ── FIX #3: Auto-confirm cancellations whose vacate date has passed ───────────
// Runs on every app boot so no manual step is ever needed.
function processAutoCancellations() {
  var todayStr = today(); // returns "YYYY-MM-DD"
  var count = 0;
  (DB.cancellations||[]).forEach(function(c) {
    if (c.status !== 'Pending') return;
    if (!c.vacateDate)          return;
    if (c.vacateDate > todayStr) return; // future — not yet
    // Vacate date reached or passed → auto-confirm
    c.status          = 'Confirmed';
    c.autoConfirmedAt = todayStr;
    var student = DB.students.find(function(s){ return s.id === c.studentId; });
    if (student && student.status !== 'Left') {
      student.status   = 'Left';
      student.leftDate = c.vacateDate;
    }
    count++;
  });
  if (count > 0) {
    saveDB();
    console.log('[Auto-Confirm] '+count+' cancellation(s) auto-confirmed on boot.');
  }
}
processAutoCancellations();
// ─────────────────────────────────────────────────────────────────────────────

  updateSidebar();
  loadSavedLogo();
  applySavedTheme();
  applySavedSidebar();
  renderSidebarCalendar();
  renderPage(currentPage);
})(); // end _boot()
checkAutoMonthAdvance();
checkAutoBackupSchedule(); // Fix #7: remind warden if scheduled backup is due

// Fix #5: Ensure sb-contact-section exists in sidebar (below Clear All in System section)
(function _ensureContactSection() {
  if (document.getElementById('sb-contact-section')) return;
  // Fallback: insert before closing of .sb-nav
  const nav = document.querySelector('#sidebar .sb-nav');
  if (!nav) return;
  const div = document.createElement('div');
  div.id = 'sb-contact-section';
  nav.appendChild(div);
})();
// Sync login screen hostel name from saved settings
const loginNameEl = document.getElementById('login-hostel-name');
if (loginNameEl && DB.settings && DB.settings.hostelName) {
  loginNameEl.textContent = DB.settings.hostelName;
}

// ══════════════════════════════════════════════════════════════════════════
// SPLASH SCREEN ENGINE
// ══════════════════════════════════════════════════════════════════════════
var _splashTimer = null;
var _splashAnimFrame = null;

function getSplashConfig() {
  var def = {
    enabled: true,
    duration: 1.5,
    message: 'Have a productive day managing the hostel. All the best!',
    bg: 'dark-blue',
    customBg: '',
    showParticles: true
  };
  return Object.assign({}, def, DB.settings.splashScreen || {});
}

var SPLASH_THEMES = {
  'dark-blue':  { bg: 'linear-gradient(135deg,#060c18 0%,#0a1628 50%,#071020 100%)', label: '🌙 Dark Blue' },
  'midnight':   { bg: 'linear-gradient(135deg,#0d0d1a 0%,#1a0a2e 50%,#0d0d1a 100%)', label: '🔮 Midnight Purple' },
  'deep-green': { bg: 'linear-gradient(135deg,#030f07 0%,#051a0d 50%,#030f07 100%)', label: '🌿 Deep Green' },
  'charcoal':   { bg: 'linear-gradient(135deg,#111 0%,#1c1c1c 50%,#111 100%)',         label: '⬛ Charcoal' },
  'navy-gold':  { bg: 'linear-gradient(135deg,#03080f 0%,#0a1a2e 40%,#1a1000 100%)',  label: '⭐ Navy & Gold' },
  'crimson':    { bg: 'linear-gradient(135deg,#0f0305 0%,#1a0508 50%,#0f0305 100%)',  label: '🔴 Deep Crimson' },
  'custom':     { bg: '', label: '🎨 Custom Color' }
};

async function showSplashScreen() {
  var cfg = getSplashConfig();
  if (!cfg.enabled) return;
  var el = document.getElementById('splash-screen');
  if (!el) return;

  // Apply background theme
  var theme = SPLASH_THEMES[cfg.bg] || SPLASH_THEMES['dark-blue'];
  var bgVal = (cfg.bg === 'custom' && cfg.customBg) ? cfg.customBg : theme.bg;
  el.style.background = bgVal;

  // Populate content
  var hostelName = (DB.settings && DB.settings.hostelName) || 'DAMAM Boys Hostel';
  var wardenName = (CUR_USER && CUR_USER.name) || 'Warden';
  var logo = window._HOSTEL_LOGO || '';

  var nameEl = document.getElementById('splash-hostel-name');
  if (nameEl) nameEl.textContent = hostelName;
  var greetingEl = document.getElementById('splash-warden-name');
  if (greetingEl) greetingEl.textContent = wardenName;
  var msgEl = document.getElementById('splash-message');
  if (msgEl) msgEl.textContent = cfg.message || '';

  var logoImg   = document.getElementById('splash-logo-img');
  var logoEmoji = document.getElementById('splash-logo-emoji');
  if (logo && logoImg && logoEmoji) {
    logoImg.src = logo; logoImg.style.display = 'block';
    logoEmoji.style.display = 'none';
  } else if (logoImg && logoEmoji) {
    logoImg.style.display = 'none';
    logoEmoji.style.display = 'block';
  }

  // Particles
  if (cfg.showParticles !== false) _startSplashParticles();

  // Fade in
  el.style.display = 'flex';
  requestAnimationFrame(function() {
    requestAnimationFrame(function() { el.style.opacity = '1'; });
  });

  // Progress bar
  var dur = Math.max(0.5, Number(cfg.duration) || 1.5) * 1000;
  var prog = document.getElementById('splash-progress');
  if (prog) {
    prog.style.transition = 'none'; prog.style.width = '0%';
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){
        prog.style.transition = 'width ' + dur + 'ms linear';
        prog.style.width = '100%';
      });
    });
  }

  // Auto-dismiss
  _splashTimer = setTimeout(_hideSplash, dur);
  el.addEventListener('click', _hideSplash, { once: true });
}

function _hideSplash() {
  clearTimeout(_splashTimer);
  if (_splashAnimFrame) { cancelAnimationFrame(_splashAnimFrame); _splashAnimFrame = null; }
  var el = document.getElementById('splash-screen');
  if (!el || el.style.display === 'none') return;
  el.style.opacity = '0';
  setTimeout(function() {
    el.style.display = 'none';
    var canvas = document.getElementById('splash-canvas');
    if (canvas) { var ctx = canvas.getContext('2d'); ctx.clearRect(0,0,canvas.width,canvas.height); }
  }, 650);
}

function _startSplashParticles() {
  var canvas = document.getElementById('splash-canvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  var pts = Array.from({length:55}, function(){
    return { x:Math.random()*canvas.width, y:Math.random()*canvas.height,
             r:Math.random()*2+0.5, dx:(Math.random()-0.5)*0.4,
             dy:-Math.random()*0.6-0.2, alpha:Math.random()*0.6+0.2 };
  });
  (function draw(){
    var sp = document.getElementById('splash-screen');
    if (!sp || sp.style.display==='none') return;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    pts.forEach(function(p){
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle='rgba(200,168,75,'+p.alpha+')'; ctx.fill();
      p.x+=p.dx; p.y+=p.dy;
      if(p.y<-5){p.y=canvas.height+5;p.x=Math.random()*canvas.width;}
      if(p.x<-5||p.x>canvas.width+5) p.x=Math.random()*canvas.width;
    });
    _splashAnimFrame = requestAnimationFrame(draw);
  })();
}

// ── Settings renderer for Splash Screen tab ──────────────────────────────
function renderSplashSettings() {
  var cfg = getSplashConfig();
  var themeOpts = Object.keys(SPLASH_THEMES).map(function(k){
    return '<option value="'+k+'"'+(cfg.bg===k?' selected':'')+'>'+SPLASH_THEMES[k].label+'</option>';
  }).join('');
  return '<div style="display:flex;flex-direction:column;gap:18px">'
    // Enable toggle
    +'<div style="display:flex;align-items:center;justify-content:space-between;background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px 16px">'
      +'<div><div style="font-weight:700;font-size:13px;color:var(--text)">Enable Splash Screen</div>'
      +'<div style="font-size:11px;color:var(--text3);margin-top:2px">Show a welcome screen after every login</div></div>'
      +'<label style="position:relative;display:inline-block;width:44px;height:24px;cursor:pointer">'
        +'<input type="checkbox" id="sp-enabled" '+(cfg.enabled?'checked':'')+' onchange="saveSplashField(\'enabled\',this.checked)" style="opacity:0;width:0;height:0;position:absolute">'
        +'<span style="position:absolute;inset:0;background:'+(cfg.enabled?'var(--green)':'var(--border2)')+';border-radius:24px;transition:0.2s" id="sp-toggle-track"></span>'
        +'<span style="position:absolute;top:3px;left:'+(cfg.enabled?'23px':'3px')+';width:18px;height:18px;background:#fff;border-radius:50%;transition:0.2s;box-shadow:0 1px 4px rgba(0,0,0,0.3)" id="sp-toggle-knob"></span>'
      +'</label>'
    +'</div>'
    // Duration
    +'<div class="field"><label>Display Duration (seconds)</label>'
      +'<div style="display:flex;align-items:center;gap:10px">'
        +'<input class="form-control" type="range" id="sp-duration" min="2" max="12" step="1" value="'+(cfg.duration||1.5)+'" oninput="document.getElementById(\'sp-dur-val\').textContent=this.value+\'s\';saveSplashField(\'duration\',+this.value)" style="flex:1;accent-color:var(--gold)">'
        +'<span id="sp-dur-val" style="font-weight:800;color:var(--gold);min-width:28px">'+(cfg.duration||1.5)+'s</span>'
      +'</div>'
    +'</div>'
    // Welcome message
    +'<div class="field"><label>Welcome Message</label>'
      +'<textarea class="form-control" id="sp-message" rows="3" placeholder="e.g. Have a productive day!" onchange="saveSplashField(\'message\',this.value)" style="resize:vertical">'+(cfg.message||'')+'</textarea>'
    +'</div>'
    // Theme
    +'<div class="field"><label>Background Theme</label>'
      +'<select class="form-control" id="sp-bg" onchange="saveSplashField(\'bg\',this.value);toggleCustomBg()">'
        +themeOpts
      +'</select>'
    +'</div>'
    // Custom color
    +'<div class="field" id="sp-custom-wrap" style="display:'+(cfg.bg==='custom'?'block':'none')+'">'
      +'<label>Custom Background (CSS gradient or color)</label>'
      +'<input class="form-control" id="sp-customBg" placeholder="e.g. linear-gradient(135deg,#1a0a2e,#0a1628) or #12131f" value="'+(cfg.customBg||'')+'" oninput="saveSplashField(\'customBg\',this.value)">'
    +'</div>'
    // Particles toggle
    +'<div style="display:flex;align-items:center;justify-content:space-between;background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px 16px">'
      +'<div><div style="font-weight:700;font-size:13px;color:var(--text)">Floating Particles ✨</div>'
      +'<div style="font-size:11px;color:var(--text3);margin-top:2px">Animated gold particles in the background</div></div>'
      +'<label style="position:relative;display:inline-block;width:44px;height:24px;cursor:pointer">'
        +'<input type="checkbox" id="sp-particles" '+(cfg.showParticles!==false?'checked':'')+' onchange="saveSplashField(\'showParticles\',this.checked)" style="opacity:0;width:0;height:0;position:absolute">'
        +'<span style="position:absolute;inset:0;background:'+(cfg.showParticles!==false?'var(--green)':'var(--border2)')+';border-radius:24px;transition:0.2s"></span>'
        +'<span style="position:absolute;top:3px;left:'+(cfg.showParticles!==false?'23px':'3px')+';width:18px;height:18px;background:#fff;border-radius:50%;transition:0.2s;box-shadow:0 1px 4px rgba(0,0,0,0.3)"></span>'
      +'</label>'
    +'</div>'
    // Preview button
    +'<button class="btn btn-primary" onclick="showSplashScreen()" style="width:100%">👁 Preview Splash Screen</button>'
  +'</div>';
}

function saveSplashField(key, val) {
  if (!DB.settings.splashScreen) DB.settings.splashScreen = {};
  DB.settings.splashScreen[key] = val;
  saveDB();
  // Update toggle UI for boolean fields
  if (key === 'enabled' || key === 'showParticles') {
    var trackId = key === 'enabled' ? 'sp-toggle-track' : null;
    if (trackId) {
      var track = document.getElementById(trackId);
      var knob  = document.getElementById('sp-toggle-knob');
      if (track) track.style.background = val ? 'var(--green)' : 'var(--border2)';
      if (knob)  knob.style.left = val ? '23px' : '3px';
    }
  }
}

function toggleCustomBg() {
  var sel = document.getElementById('sp-bg');
  var wrap = document.getElementById('sp-custom-wrap');
  if (wrap) wrap.style.display = sel && sel.value === 'custom' ? 'block' : 'none';
}

navigate('dashboard');
// ─────────────────────────────────────────────────────────────────────────────

// ── KEYBOARD SHORTCUTS: Escape = close modal, Enter = save form ───────────────
document.addEventListener('keydown', function(e) {
  // Escape: close any open modal
  if (e.key === 'Escape') {
    const modal = document.querySelector('.modal-overlay');
    if (modal) { closeModal(); return; }
    // Also clear global search if open
    const srch = document.getElementById('dash-global-search');
    if (srch && document.activeElement === srch) { srch.value=''; dashGlobalSearchClear(); }
    return;
  }

  // Enter: click the primary save/submit button inside the active modal
  if (e.key === 'Enter') {
    const active = document.activeElement;
    // Don't intercept Enter inside textareas (multi-line) or selects
    if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;
    // Don't intercept Enter when already on a button
    if (active && active.tagName === 'BUTTON') return;
    const modal = document.querySelector('.modal');
    if (!modal) return;
    // Find the last .btn-primary in the modal footer — that's always the Save/Submit button
    const footer = modal.querySelector('.modal-footer');
    if (!footer) return;
    const primaryBtn = Array.from(footer.querySelectorAll('.btn-primary')).pop();
    if (primaryBtn && !primaryBtn.disabled) { e.preventDefault(); primaryBtn.click(); }
    return;
  }
});
// ─────────────────────────────────────────────────────────────────────────────

// ── ARROW KEY NAVIGATION IN FORMS ────────────────────────────────────────────
// ArrowDown / ArrowUp moves focus to the next/previous focusable field inside
// any modal or filter-bar form. Works on input, select, and textarea elements.
document.addEventListener('keydown', function(e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const active = document.activeElement;
  if (!active) return;
  const tag = active.tagName;
  // Only trigger inside input/select/textarea — but not multi-line textarea scrolling
  if (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') return;
  // For inputs with type text/number/date/password, not range/checkbox/radio
  const skipTypes = ['range','checkbox','radio','file','hidden','submit','button','reset'];
  if (tag === 'INPUT' && skipTypes.includes(active.type)) return;
  // Find all focusable fields in the closest modal or form container
  const container = active.closest('.modal, .filter-bar, #content') || document;
  const fields = Array.from(container.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled]):not([readonly])'))
    .filter(el => el.offsetParent !== null); // only visible elements
  const idx = fields.indexOf(active);
  if (idx === -1) return;
  let next = -1;
  if (e.key === 'ArrowDown') next = idx + 1 < fields.length ? idx + 1 : 0;
  if (e.key === 'ArrowUp')   next = idx - 1 >= 0 ? idx - 1 : fields.length - 1;
  if (next !== -1) {
    e.preventDefault();
    fields[next].focus();
    // Select text in inputs for easy overwrite
    if (fields[next].tagName === 'INPUT' && fields[next].select) {
      try { fields[next].select(); } catch(_) {}
    }
  }
});
// ─────────────────────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════
// COMBINED ISSUES PAGE (Complaints & Maintenance tabs)
// ══════════════════════════════════════════════════════════════════
var issuesTab = 'maintenance';

function renderIssues() {
  var mlist = DB.maintenance || [];
  var clist = DB.complaints || [];
  var mOpen = mlist.filter(function(m){return m.status==='Open';}).length;
  var mIP   = mlist.filter(function(m){return m.status==='InProgress';}).length;
  var mRes  = mlist.filter(function(m){return m.status==='Resolved';}).length;
  var cOpen = clist.filter(function(c){return c.status==='Open';}).length;
  var cRev  = clist.filter(function(c){return c.status==='UnderReview';}).length;
  var cRes  = clist.filter(function(c){return c.status==='Resolved';}).length;

  var html = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px">';
  html += '<div style="background:var(--card);border:1px solid rgba(224,82,82,0.3);border-radius:var(--radius);padding:14px;text-align:center"><div style="font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase;margin-bottom:4px">&#x1F527; Open</div><div style="font-size:26px;font-weight:800;color:var(--red)">'+mOpen+'</div></div>';
  html += '<div style="background:var(--card);border:1px solid rgba(240,160,48,0.3);border-radius:var(--radius);padding:14px;text-align:center"><div style="font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase;margin-bottom:4px">In Progress</div><div style="font-size:26px;font-weight:800;color:var(--amber)">'+mIP+'</div></div>';
  html += '<div style="background:var(--card);border:1px solid rgba(46,201,138,0.3);border-radius:var(--radius);padding:14px;text-align:center"><div style="font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase;margin-bottom:4px">&#x1F4AC; Complaints</div><div style="font-size:26px;font-weight:800;color:var(--purple)">'+cOpen+'</div></div>';
  html += '</div>';

  // Tab bar
  var mActive = issuesTab==='maintenance';
  html += '<div style="display:flex;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;margin-bottom:18px">';
  html += '<button onclick="issuesTab=\'maintenance\';renderPage(\'issues\')" style="flex:1;padding:11px;border:none;font-family:var(--font);font-size:13px;font-weight:700;cursor:pointer;background:'+(mActive?'var(--gold-dim)':'var(--bg3)')+';color:'+(mActive?'var(--gold2)':'var(--text2)')+'">&#x1F527; Maintenance ('+(mlist.filter(function(x){return x.status!=='Resolved';}).length)+' active)</button>';
  html += '<div style="width:1px;background:var(--border)"></div>';
  var cActive = issuesTab==='complaints';
  html += '<button onclick="issuesTab=\'complaints\';renderPage(\'issues\')" style="flex:1;padding:11px;border:none;font-family:var(--font);font-size:13px;font-weight:700;cursor:pointer;background:'+(cActive?'var(--gold-dim)':'var(--bg3)')+';color:'+(cActive?'var(--gold2)':'var(--text2)')+'">&#x1F4AC; Complaints ('+(clist.filter(function(x){return x.status!=='Resolved';}).length)+' open)</button>';
  html += '</div>';

  if(issuesTab==='maintenance') {
    if(mlist.length===0) {
      html += '<div style="text-align:center;padding:60px 20px;color:var(--text3)"><div style="font-size:48px;margin-bottom:12px">&#x1F527;</div><div style="font-size:15px">No maintenance requests yet</div><button class="btn btn-primary" style="margin-top:14px" onclick="showAddIssueModal()">+ Add Request</button></div>';
    } else {
      var sList = mlist.slice().reverse();
      for(var i=0;i<sList.length;i++) {
        var m = sList[i];
        var room = DB.rooms.find(function(r){return r.id===m.roomId;});
        var sc = m.status==='Open'?'var(--red)':m.status==='InProgress'?'var(--amber)':'var(--green)';
        var pc = m.priority==='High'?'var(--red)':m.priority==='Low'?'var(--teal)':'var(--amber)';
        html += '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:10px;display:flex;align-items:flex-start;gap:14px">';
        html += '<div style="width:40px;height:40px;border-radius:9px;background:'+sc+'22;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">&#x1F527;</div>';
        html += '<div style="flex:1;min-width:0">';
        html += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">';
        html += '<span style="font-weight:700;font-size:14px">'+escHtml(m.title)+'</span>';
        html += '<span style="font-size:11px;padding:2px 8px;border-radius:20px;background:'+sc+'22;color:'+sc+'">'+m.status+'</span>';
        html += '<span style="font-size:11px;padding:2px 8px;border-radius:20px;background:'+pc+'22;color:'+pc+'">'+((m.priority||'Medium')+' Priority')+'</span>';
        html += '</div>';
        html += '<div style="font-size:12px;color:var(--text2);margin-bottom:4px">'+escHtml(m.description||'')+'</div>';
        html += '<div style="font-size:11px;color:var(--text3)">Room '+(room?room.number:'N/A')+' &nbsp;·&nbsp; '+fmtDate(m.date)+(m.resolvedDate?' &nbsp;·&nbsp; &#x2705; '+fmtDate(m.resolvedDate):'')+'</div>';
        html += '</div>';
        html += '<div style="display:flex;gap:4px;flex-shrink:0">';
        if(m.status!=='Resolved') html += '<button class="btn btn-sm" style="background:var(--green-dim);color:var(--green);border:1px solid rgba(46,201,138,0.3)" onclick="resolveMaint(\''+m.id+'\')"><span class=\"micon\" style=\"font-size:14px\">check_circle</span></button>';
        if(m.status==='Open') html += '<button class="btn btn-sm" style="background:var(--amber-dim);color:var(--amber);border:1px solid rgba(240,160,48,0.3)" onclick="progressMaint(\''+m.id+'\')">&#x23F3;</button>';
        html += '<button class="btn btn-sm btn-danger" onclick="delMaint(\''+m.id+'\')"><span class=\"micon\" style=\"font-size:14px\">delete</span></button>';
        html += '</div></div>';
      }
    }
  } else {
    if(clist.length===0) {
      html += '<div style="text-align:center;padding:60px 20px;color:var(--text3)"><div style="font-size:48px;margin-bottom:12px">&#x1F4AC;</div><div>No complaints yet</div><button class="btn btn-primary" style="margin-top:14px" onclick="showAddIssueModal()">+ Add Complaint</button></div>';
    } else {
      var csl = clist.slice().reverse();
      for(var j=0;j<csl.length;j++) {
        var cc = csl[j];
        var student = DB.students.find(function(s){return s.id===cc.studentId;});
        var csc = cc.status==='Open'?'var(--red)':cc.status==='UnderReview'?'var(--amber)':'var(--green)';
        html += '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:10px">';
        html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px">';
        html += '<div><div style="font-weight:700;font-size:14px;margin-bottom:3px">'+escHtml(cc.subject)+'</div><div style="font-size:11px;color:var(--text3)">By: '+(student?escHtml(student.name):'Unknown')+' &nbsp;·&nbsp; '+fmtDate(cc.date)+'</div></div>';
        html += '<div style="display:flex;gap:6px;align-items:center">';
        html += '<span style="font-size:11px;padding:2px 8px;border-radius:20px;background:'+csc+'22;color:'+csc+'">'+((cc.status==='UnderReview'?'Under Review':cc.status))+'</span>';
        if(cc.status!=='Resolved') html += '<button class="btn btn-sm" style="background:var(--green-dim);color:var(--green)" onclick="resolveComp(\''+cc.id+'\')">Resolve</button>';
        html += '<button class="btn btn-sm btn-danger" onclick="delComp(\''+cc.id+'\')"><span class=\"micon\" style=\"font-size:14px\">delete</span></button>';
        html += '</div></div>';
        html += '<div style="font-size:13px;color:var(--text2);background:var(--bg3);border-radius:8px;padding:10px">'+escHtml(cc.description||'')+'</div>';
        if(cc.response) html += '<div style="font-size:12px;color:var(--teal);background:var(--teal-dim);border-radius:8px;padding:8px;margin-top:6px">Response: '+escHtml(cc.response)+'</div>';
        html += '</div>';
      }
    }
  }
  return html;
}

function showAddIssueModal() {
  var rooms = DB.rooms.map(function(r){return '<option value="'+r.id+'">Room '+r.number+'</option>';}).join('');
  var students = DB.students.filter(function(s){return s.status==='Active';}).map(function(s){return '<option value="'+s.id+'">'+escHtml(s.name)+'</option>';}).join('');
  showModal('modal-md','Add Complaint / Maintenance',
    '<div style="display:flex;gap:8px;margin-bottom:18px">'+
    '<button type="button" id="ib-maint" onclick="document.getElementById(\'if-maint\').style.display=\'block\';document.getElementById(\'if-comp\').style.display=\'none\';this.style.background=\'var(--gold-dim)\';this.style.color=\'var(--gold2)\';document.getElementById(\'ib-comp\').style.background=\'var(--bg3)\';document.getElementById(\'ib-comp\').style.color=\'var(--text2)\'" class="btn" style="flex:1;background:var(--gold-dim);color:var(--gold2);">&#x1F527; Maintenance</button>'+
    '<button type="button" id="ib-comp" onclick="document.getElementById(\'if-comp\').style.display=\'block\';document.getElementById(\'if-maint\').style.display=\'none\';this.style.background=\'var(--gold-dim)\';this.style.color=\'var(--gold2)\';document.getElementById(\'ib-maint\').style.background=\'var(--bg3)\';document.getElementById(\'ib-maint\').style.color=\'var(--text2)\'" class="btn btn-secondary" style="flex:1">&#x1F4AC; Complaint</button>'+
    '</div>'+
    '<div id="if-maint"><div class="form-grid">'+
    '<div class="field col-full"><label>Issue Title *</label><input id="mt-title" class="form-control" placeholder="e.g. Broken fan, Leaking pipe"></div>'+
    '<div class="field"><label>Room</label><select id="mt-room" class="form-control"><option value="">Select Room</option>'+rooms+'</select></div>'+
    '<div class="field"><label>Priority</label><select id="mt-priority" class="form-control"><option>High</option><option selected>Medium</option><option>Low</option></select></div>'+
    '<div class="field"><label>Date</label><input id="mt-date" class="form-control cdp-trigger" type="text" readonly onclick="showCustomDatePicker(this,event)" value="'+today()+'"></div>'+
    '<div class="field col-full"><label>Description</label><textarea id="mt-desc" class="form-control" placeholder="Describe the issue..."></textarea></div>'+
    '</div></div>'+
    '<div id="if-comp" style="display:none"><div class="form-grid">'+
    '<div class="field col-full"><label>Student</label><select id="cp-student" class="form-control"><option value="">Select Student</option>'+students+'</select></div>'+
    '<div class="field col-full"><label>Subject *</label><input id="cp-subject" class="form-control" placeholder="Brief subject"></div>'+
    '<div class="field"><label>Date</label><input id="cp-date" class="form-control cdp-trigger" type="text" readonly onclick="showCustomDatePicker(this,event)" value="'+today()+'"></div>'+
    '<div class="field col-full"><label>Description</label><textarea id="cp-desc" class="form-control" placeholder="Describe the complaint..."></textarea></div>'+
    '</div></div>',
    '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveIssue()">Submit</button>'
  );
}

function saveIssue() {
  var isComp = document.getElementById('if-comp') && document.getElementById('if-comp').style.display!=='none';
  if(!isComp) {
    var title = (document.getElementById('mt-title')||{}).value||''; title=title.trim();
    if(!title){toast('Enter a title','error');return;}
    if(!DB.maintenance) DB.maintenance=[];
    logActivity('Maintenance Added',title,'Maintenance');
    DB.maintenance.push({id:'mt_'+uid(),title:title,roomId:(document.getElementById('mt-room')||{}).value||'',
      priority:(document.getElementById('mt-priority')||{}).value||'Medium',
      description:((document.getElementById('mt-desc')||{}).value||'').trim(),
      date:(document.getElementById('mt-date')||{}).value||today(),status:'Open',resolvedDate:''});
    issuesTab='maintenance';
  } else {
    var subj = (document.getElementById('cp-subject')||{}).value||''; subj=subj.trim();
    if(!subj){toast('Enter a subject','error');return;}
    if(!DB.complaints) DB.complaints=[];
    DB.complaints.push({id:'cp_'+uid(),subject:subj,
      studentId:(document.getElementById('cp-student')||{}).value||'',
      description:((document.getElementById('cp-desc')||{}).value||'').trim(),
      date:(document.getElementById('cp-date')||{}).value||today(),status:'Open',response:''});
    issuesTab='complaints';
  }
  saveDB(); closeModal(); renderPage('issues'); toast('Saved','success');
}

function resolveMaint(id){var m=DB.maintenance.find(function(x){return x.id===id;});if(m){m.status='Resolved';m.resolvedDate=today();saveDB();renderPage('issues');toast('Resolved','success');}}
function progressMaint(id){var m=DB.maintenance.find(function(x){return x.id===id;});if(m){m.status='InProgress';saveDB();renderPage('issues');toast('In Progress','info');}}
function delMaint(id){showConfirm('Delete?','',function(){DB.maintenance=DB.maintenance.filter(function(x){return x.id!==id;});saveDB();renderPage('issues');toast('Deleted','info');});}
function resolveComp(id) {
  // FIX #7: Replace blocking native prompt() with an in-app modal dialog
  var cc = DB.complaints.find(function(x){return x.id===id;}); if(!cc) return;
  showModal('modal-sm', '✅ Resolve Complaint',
    '<div class="field"><label>Optional Response</label>' +
    '<textarea id="comp-resolve-text" class="form-control" rows="3" placeholder="Enter a response or leave blank…"></textarea></div>',
    '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-success" onclick="(function(){' +
      'var cc=DB.complaints.find(function(x){return x.id===\''+id+'\';});' +
      'if(cc){cc.status=\'Resolved\';cc.response=(document.getElementById(\'comp-resolve-text\')||{}).value||\'\';}' +
      'saveDB();closeModal();renderPage(\'issues\');toast(\'Complaint resolved\',\'success\');' +
    '})()">Mark Resolved</button>'
  );
}
function delComp(id){showConfirm('Delete?','',function(){DB.complaints=DB.complaints.filter(function(x){return x.id!==id;});saveDB();renderPage('issues');toast('Deleted','info');});}

// Keep original function names as aliases so dashboard alerts still work
function resolveMaintenance(id){resolveMaint(id);}
function progressMaintenance(id){progressMaint(id);}
function deleteMaintenance(id){delMaint(id);}
function resolveComplaint(id){resolveComp(id);}
function deleteComplaint(id){delComp(id);}
function showAddMaintenanceModal(){issuesTab='maintenance';showAddIssueModal();}
function showAddComplaintModal(){issuesTab='complaints';showAddIssueModal();}


// ══════════════════════════════════════════════════════════════════
// RECEIPT GENERATOR
// ══════════════════════════════════════════════════════════════════
// printReceipt() — moved to src/receipt.js

// doPrintReceipt() — moved to src/receipt.js

// sendWA() — moved to src/receipt.js

// ── Fix #8: Patch window.open so receipt windows never show LICENSE INFO ──────
// This intercepts any popup opened by printReceipt/doPrintReceipt in receipt.js
// and strips the "SOFTWARE LICENSE INFO" block before the user sees it.
(function _patchReceiptLicenseStrip() {
  const _origOpen = window.open.bind(window);
  window.open = function(url, target, features) {
    const w = _origOpen(url, target, features);
    if (!w) return w;
    // Patch document.write on the new window to strip license sections
    const _origWrite = w.document.write.bind(w.document);
    w.document.write = function(html) {
      if (typeof html === 'string') {
        // Remove any block containing "SOFTWARE LICENSE INFO" or license key patterns
        html = html.replace(/[\s\S]*?SOFTWARE\s+LICENSE\s+INFO[\s\S]*?(?=<(?:div|table|tr|section|footer)|$)/gi, '');
        // Remove license key rows with HOSTEL- prefix pattern
        html = html.replace(/<tr[^>]*>[\s\S]*?H[O0]STEL[-_][\w-]+[\s\S]*?<\/tr>/gi, '');
        // Remove "Machine:" rows
        html = html.replace(/<tr[^>]*>[\s\S]*?Machine\s*:[\s\S]*?<\/tr>/gi, '');
        // Remove "Valid Until" rows that appear in license section (not in student info)
        html = html.replace(/<tr[^>]*>[\s\S]*?Valid\s+Until[\s\S]*?<\/tr>/gi, function(m) {
          // Keep if it looks like a student/payment row, remove if it's license-related
          if (m.includes('May-') || m.includes('2026') || m.includes('2027')) return '';
          return m;
        });
        // Strip any <div> block that contains "SOFTWARE LICENSE" text
        html = html.replace(/<div[^>]*>(?:[^<]|<(?!\/div>))*?SOFTWARE LICENSE[^<]*<\/div>/gi, '');
      }
      return _origWrite(html);
    };
    return w;
  };
})();
// ─────────────────────────────────────────────────────────────────────────────


// ── SETTINGS DROPDOWN ────────────────────────────────────────────────────────
function toggleSettingsDropdown() {
  const dd = document.getElementById('settings-dropdown');
  const ch = document.getElementById('settings-chevron');
  if (!dd) return;
  const open = dd.style.display === 'block';
  dd.style.display = open ? 'none' : 'block';
  if (ch) ch.style.transform = open ? '' : 'rotate(180deg)';
}

// ── FORMER STUDENTS — search & restore ───────────────────────────────────────
function showFormerStudentsModal() {
  const total = DB.students.filter(s=>s.status==='Left').length;
  // FIX 9: first arg is the CSS size class — 'Former Students' was being passed as size
  showModal('modal-lg', 'Former Students',
    `<div style="font-size:12px;color:var(--text3);margin-bottom:12px">Search by name, ID, mobile, CNIC, email, father name, occupation, location or former room.</div>
     <div style="display:flex;gap:8px;margin-bottom:14px">
       <div style="flex:1;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:8px 12px;text-align:center">
         <div style="font-size:18px;font-weight:900;color:var(--gold2)">${total}</div>
         <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.6px">Former Students</div>
       </div>
       <div style="flex:1;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:8px 12px;text-align:center">
         <div style="font-size:18px;font-weight:900;color:var(--green)" id="former-avail-count">${DB.rooms.filter(r=>{const t=getRoomType(r);return getRoomOccupancy(r)<(t?.capacity||1);}).length}</div>
         <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.6px">Rooms Available</div>
       </div>
     </div>
     <div style="position:relative;margin-bottom:14px">
       <div style="display:flex;align-items:center;background:var(--bg3);border:1px solid var(--border2);border-radius:10px;overflow:hidden">
         <div style="padding:0 12px;color:var(--text3);display:flex;align-items:center">
           <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
         </div>
         <input id="former-search-input" type="text" placeholder="Search name, mobile, CNIC, email, father name, room, occupation…"
           autocomplete="off" style="flex:1;background:none;border:none;outline:none;color:var(--text);font-size:13px;padding:11px 0;font-family:var(--font)"
           oninput="formerStudentSearch(this.value)">
         <button onclick="document.getElementById('former-search-input').value='';formerStudentSearch('')"
           style="background:none;border:none;color:var(--text3);cursor:pointer;padding:0 12px;font-size:16px">✕</button>
       </div>
     </div>
     <div id="former-results">
       <div style="text-align:center;padding:40px 20px;color:var(--text3)">
         <div style="font-size:32px;margin-bottom:10px">🔍</div>
         <div style="font-size:13px;font-weight:600">Start typing to search former students</div>
       </div>
     </div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Close</button>`
  );
  setTimeout(()=>{const i=document.getElementById('former-search-input');if(i)i.focus();},100);
}

function formerStudentSearch(query) {
  const results = document.getElementById('former-results'); if (!results) return;
  const q = query.trim().toLowerCase();
  if (!q) { results.innerHTML='<div style="text-align:center;padding:40px 20px;color:var(--text3)"><div style="font-size:32px;margin-bottom:10px">🔍</div><div style="font-size:13px;font-weight:600">Start typing to search</div></div>'; return; }
  const former = DB.students.filter(s=>{
    if(s.status!=='Left') return false;
    return [s.name,s.id,s.phone,s.cnic,s.email,s.fatherName,s.occupation,s.address,s.lastRoom,s.roomNumber,String(s.roomNumber||'')].some(v=>v&&String(v).toLowerCase().includes(q));
  });
  if (!former.length) { results.innerHTML='<div style="text-align:center;padding:40px 20px;color:var(--text3)"><div style="font-size:32px;margin-bottom:10px">😕</div><div style="font-size:13px;font-weight:600">No former students found</div></div>'; return; }
  results.innerHTML = `<div style="font-size:11px;color:var(--text3);margin-bottom:10px">${former.length} result${former.length!==1?'s':''} found</div>`+former.map(s=>{
    const payHistory = DB.payments.filter(p=>p.studentId===s.id).sort((a,b)=>new Date(b.date)-new Date(a.date));
    const totalPaid  = payHistory.filter(p=>p.status==='Paid').reduce((sum,p)=>sum+Number(p.amount||0),0);
    const pendRecs   = payHistory.filter(p=>p.status==='Pending');
    const totalPend  = pendRecs.reduce((sum,p)=>sum+(p.unpaid!=null?Number(p.unpaid):Number(p.amount||0)),0);
    const histBadge  = totalPend>0?`<span style="background:rgba(255,77,109,0.15);color:var(--red);border:1px solid rgba(255,77,109,0.3);border-radius:6px;padding:2px 8px;font-size:10px;font-weight:700">⚠️ ${pendRecs.length} pending · ${fmtPKR(totalPend)}</span>`:payHistory.length?`<span style="background:rgba(46,201,138,0.1);color:var(--green);border:1px solid rgba(46,201,138,0.2);border-radius:6px;padding:2px 8px;font-size:10px;font-weight:700">✅ All clear</span>`:`<span style="background:var(--bg4);color:var(--text3);border-radius:6px;padding:2px 8px;font-size:10px">No history</span>`;
    const recentRows = payHistory.slice(0,4).map(p=>`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:11px"><span style="color:var(--text3)">${escHtml(p.month||fmtDate(p.date)||'—')}</span><span style="color:${p.status==='Paid'?'var(--green)':'var(--red)'};font-weight:700">${fmtPKR(p.amount)}</span><span style="color:${p.status==='Paid'?'var(--green)':'var(--red)'}">${p.status==='Paid'?'✅':'⏳'}</span></div>`).join('');
    return `<div id="fsr-${s.id}" style="background:var(--bg3);border:1px solid var(--border2);border-radius:12px;padding:14px 16px;margin-bottom:10px">
      <div style="display:flex;align-items:flex-start;gap:13px">
        <div style="width:44px;height:44px;border-radius:11px;background:var(--gold-dim);color:var(--gold2);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:18px;flex-shrink:0">${(s.name||'?')[0].toUpperCase()}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:800;color:var(--text);margin-bottom:4px">${escHtml(s.name||'—')}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px 16px;margin-bottom:8px">
            ${s.phone?`<div style="font-size:11px;color:var(--text3)">📞 ${escHtml(s.phone)}</div>`:''}
            ${s.cnic?`<div style="font-size:11px;color:var(--text3)">🪪 ${escHtml(s.cnic)}</div>`:''}
            ${s.fatherName?`<div style="font-size:11px;color:var(--text3)">👨 ${escHtml(s.fatherName)}</div>`:''}
            ${s.email?`<div style="font-size:11px;color:var(--text3)">✉️ ${escHtml(s.email)}</div>`:''}
            ${s.occupation?`<div style="font-size:11px;color:var(--text3)">💼 ${escHtml(s.occupation)}</div>`:''}
            ${(s.lastRoom||s.roomNumber)?`<div style="font-size:11px;color:var(--gold2);font-weight:600">🏠 Former Rm #${escHtml(String(s.lastRoom||s.roomNumber||'—'))}</div>`:''}
            ${s.leftDate?`<div style="font-size:11px;color:var(--red)">📅 Left: ${fmtDate(s.leftDate)}</div>`:''}
            ${s.rent?`<div style="font-size:11px;color:var(--green);font-weight:600">💰 ${fmtPKR(s.rent)}/mo</div>`:''}
          </div>
          <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 12px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
              <span style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.6px">Payment History</span>
              ${histBadge}
              ${payHistory.length?`<span style="font-size:10px;color:var(--text3)">${payHistory.length} records · Paid: <strong style="color:var(--green)">${fmtPKR(totalPaid)}</strong></span>`:''}
            </div>
            ${recentRows||`<div style="font-size:11px;color:var(--text3);text-align:center;padding:4px">No payment records</div>`}
          </div>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
        <button onclick="openRestoreStudentForm('${s.id}')"
          style="background:linear-gradient(135deg,#00c853,#00e676);border:none;color:#060c18;border-radius:8px;padding:8px 20px;font-size:12px;font-weight:800;cursor:pointer;display:flex;align-items:center;gap:6px">
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M3 12a9 9 0 109 9"/><path d="M3 12l4-4m-4 4l4 4"/></svg>
          Restore Student
        </button>
      </div>
    </div>`;
  }).join('');
}

function _getAvailableRooms() {
  return DB.rooms.filter(r=>{ const t=getRoomType(r); return getRoomOccupancy(r)<(t?.capacity||1); });
}

function openRestoreStudentForm(studentId) {
  const t = DB.students.find(x=>x.id===studentId); if(!t) return;
  const availRooms = _getAvailableRooms();
  const roomOpts = availRooms.map(r=>{ const type=getRoomType(r); return `<option value="${r.id}">Room #${r.number} — ${type?.name||''} (${getRoomOccupancy(r)}/${type?.capacity||1} filled)</option>`; }).join('');
  const pmOpts = DB.settings.paymentMethods.map(m=>`<option ${t.paymentMethod===m?'selected':''}>${escHtml(m)}</option>`).join('');
  const today = new Date().toISOString().slice(0,10);
  const thisMonthKey = today.slice(0,7);
  const payHistory = DB.payments.filter(p=>p.studentId===t.id).sort((a,b)=>new Date(b.date)-new Date(a.date));
  const totalPaid = payHistory.filter(p=>p.status==='Paid').reduce((s,p)=>s+Number(p.amount||0),0);
  const pendRecs  = payHistory.filter(p=>p.status==='Pending');
  const totalPend = pendRecs.reduce((s,p)=>s+(p.unpaid!=null?Number(p.unpaid):Number(p.amount||0)),0);
  const histRows  = payHistory.slice(0,6).map((p,i)=>`<tr style="border-top:1px solid var(--border);background:${i%2?'var(--bg3)':'transparent'}"><td style="padding:7px 10px;font-weight:600;font-size:11px">${escHtml(p.month||'—')}</td><td style="padding:7px 10px;color:var(--green);font-weight:700;font-size:11px">${fmtPKR(p.amount)}</td><td style="padding:7px 10px;color:${(p.unpaid||0)>0?'var(--red)':'var(--text3)'};font-weight:700;font-size:11px">${(p.unpaid||0)>0?fmtPKR(p.unpaid):'—'}</td><td style="padding:7px 10px;font-size:11px">${escHtml(p.method||'—')}</td><td style="padding:7px 10px;font-size:11px;color:${p.status==='Paid'?'var(--green)':'var(--red)'};font-weight:700">${p.status==='Paid'?'✅':'⏳'} ${p.status}</td><td style="padding:7px 10px;font-size:10px;color:var(--text3)">${fmtDate(p.date)||'—'}</td></tr>`).join('');

  showModal('modal-lg', `<span style="color:var(--green)">🔄 Restore — ${escHtml(t.name)}</span>`,
    `<div style="font-size:12px;color:var(--text3);margin-bottom:14px;background:var(--green-dim);border:1px solid rgba(46,201,138,0.25);border-radius:8px;padding:10px 14px">All previous details are pre-filled. Update room, rent, and payment details.</div>
    ${payHistory.length?`<div style="margin-bottom:16px;background:var(--bg3);border:1px solid var(--border2);border-radius:10px;overflow:hidden">
      <div style="padding:10px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div style="font-size:12px;font-weight:700;color:var(--blue)">📋 Past Payment History</div>
        <div style="display:flex;gap:8px">
          <span style="font-size:11px;font-weight:700;color:var(--green)">Paid: ${fmtPKR(totalPaid)}</span>
          ${totalPend>0?`<span style="font-size:11px;font-weight:700;color:var(--red);background:rgba(255,77,109,0.1);padding:2px 8px;border-radius:5px">⚠️ Past pending: ${fmtPKR(totalPend)}</span>`:`<span style="font-size:11px;color:var(--green)">✅ No past dues</span>`}
        </div>
      </div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:var(--bg4)"><th style="padding:7px 10px;text-align:left;font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase">Month</th><th style="padding:7px 10px;text-align:left;font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase">Paid</th><th style="padding:7px 10px;text-align:left;font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase">Unpaid</th><th style="padding:7px 10px;text-align:left;font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase">Method</th><th style="padding:7px 10px;text-align:left;font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase">Status</th><th style="padding:7px 10px;text-align:left;font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase">Date</th></tr></thead>
        <tbody>${histRows}</tbody>
      </table></div>
      ${payHistory.length>6?`<div style="padding:7px 14px;font-size:10px;color:var(--text3);border-top:1px solid var(--border)">Showing 6 of ${payHistory.length} records</div>`:''}
    </div>`:''}
    <div class="form-grid">
      <div class="field"><label>Full Name</label><input class="form-control" id="rs-name" value="${escHtml(t.name||'')}" style="text-transform:capitalize" oninput="autoCapName(this)"></div>
      <div class="field"><label>Father Name</label><input class="form-control" id="rs-fname" value="${escHtml(t.fatherName||'')}" style="text-transform:capitalize" oninput="autoCapName(this)"></div>
      <div class="field"><label>CNIC</label><input class="form-control" id="rs-cnic" value="${escHtml(t.cnic||'')}" placeholder="XXXXX-XXXXXXX-X" maxlength="15" oninput="fmtCnic(this)"></div>
      <div class="field"><label>Phone</label><input class="form-control" id="rs-phone" value="${escHtml(t.phone||'')}"></div>
      <div class="field"><label>Email</label><input class="form-control" id="rs-email" value="${escHtml(t.email||'')}"></div>
      <div class="field"><label>Occupation</label><input class="form-control" id="rs-occ" value="${escHtml(t.occupation||'')}"></div>
      <div class="field col-full"><label>Home Address</label><input class="form-control" id="rs-address" value="${escHtml(t.address||'')}"></div>
      <div class="field"><label>Emergency Contact</label><input class="form-control" id="rs-emerg" value="${escHtml(t.emergencyContact||'')}"></div>
      <div class="field"><label>Re-join Date</label><input class="form-control cdp-trigger" id="rs-join" type="text" readonly onclick="showCustomDatePicker(this,event)" value="${today}"></div>
      <div class="field col-full" style="border-top:1px solid var(--border);padding-top:14px;margin-top:4px"><div style="font-size:12px;font-weight:700;color:var(--green);margin-bottom:10px">🏠 New Room Assignment</div></div>
      <div class="field"><label>Assign Room *</label><select class="form-control" id="rs-room"><option value="">— Select available room —</option>${roomOpts}</select></div>
      <div class="field"><label>Monthly Rent (PKR) *</label><input class="form-control" id="rs-rent" type="number" value="${t.rent||''}" placeholder="e.g. 16000" oninput="rsRecalc()"></div>
      <div class="field col-full" style="border-top:1px solid var(--border);padding-top:14px;margin-top:4px"><div style="font-size:12px;font-weight:700;color:var(--gold2);margin-bottom:10px">💰 First Month Payment</div></div>
      <div class="field"><label>Payment Month</label><input class="form-control" id="rs-month" type="text" value="${thisMonthLabel()}" oninput="rsCheckMonthDuplicate('${t.id}',this.value)" placeholder="e.g. March 2026"></div>
      <div class="field"><label>Payment Method</label><select class="form-control" id="rs-pm">${pmOpts}</select></div>
      <div id="rs-month-warning" class="field col-full" style="display:none"></div>
      <div class="field col-full" style="border-top:1px solid var(--border);padding-top:14px;margin-top:4px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="font-size:12px;font-weight:700;color:var(--red)">➕ Extra Charges</div>
          <button type="button" onclick="rsAddExtraRow()" style="background:var(--red-dim);border:1px solid rgba(255,77,109,0.3);color:var(--red);border-radius:7px;padding:4px 12px;font-size:11px;font-weight:700;cursor:pointer">+ Add Charge</button>
        </div>
        <div id="rs-extra-list"></div>
      </div>
      <div class="field col-full" style="border-top:1px solid var(--border);padding-top:14px;margin-top:4px"><div style="font-size:12px;font-weight:700;color:var(--teal);margin-bottom:10px">🎁 Concession / Discount</div></div>
      <div class="field"><label>Concession Amount (PKR)</label><input class="form-control" id="rs-concession" type="number" min="0" placeholder="0" oninput="rsRecalc()"></div>
      <div class="field"><label>Concession Reason</label><input class="form-control" id="rs-conc-reason" placeholder="e.g. Loyalty discount…"></div>
      <!-- Net Payable summary -->
      <div class="field col-full">
        <div id="rs-total-box" style="background:var(--bg3);border:1px solid var(--border2);border-radius:10px;padding:12px 16px;display:flex;gap:16px;flex-wrap:wrap;align-items:center">
          <div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.6px">Rent</div><div id="rs-tot-rent" style="font-size:16px;font-weight:900;color:var(--blue)">PKR 0</div></div>
          <div style="color:var(--border2);font-size:20px">+</div>
          <div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.6px">Extra Charges</div><div id="rs-tot-extra" style="font-size:16px;font-weight:900;color:var(--red)">PKR 0</div></div>
          <div style="color:var(--border2);font-size:20px">−</div>
          <div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.6px">Concession</div><div id="rs-tot-conc" style="font-size:16px;font-weight:900;color:var(--teal)">PKR 0</div></div>
          <div style="color:var(--border2);font-size:20px">=</div>
          <div style="background:rgba(200,168,75,0.1);border:1px solid rgba(200,168,75,0.3);border-radius:8px;padding:8px 14px">
            <div style="font-size:10px;color:var(--gold2);text-transform:uppercase;letter-spacing:.6px;font-weight:700">Net Payable</div>
            <div id="rs-tot-net" style="font-size:22px;font-weight:900;color:var(--gold2)">PKR 0</div>
          </div>
        </div>
      </div>
      <div class="field col-full" style="border-top:1px solid var(--border);padding-top:14px;margin-top:4px"><div style="font-size:12px;font-weight:700;color:var(--green);margin-bottom:10px">✍️ Payment Entry</div></div>
      <div class="field"><label>Amount Paid (PKR)</label><input class="form-control" id="rs-amount" type="number" placeholder="Leave empty to skip" oninput="rsRecalc()"></div>
      <div class="field"><label>Pending / Unpaid (PKR)</label><input class="form-control" id="rs-pending" type="number" min="0" placeholder="Auto-calculated" oninput="this.dataset.manual=1"><div style="font-size:10px;color:var(--text3);margin-top:4px">Auto: Net − Amount Paid. Override if needed.</div></div>
      <div class="field"><label>Payment Status</label><select class="form-control" id="rs-pstatus" onchange="rsRecalc()"><option value="Paid">✅ Paid</option><option value="Pending">⏳ Pending</option></select></div>
      <div class="field"><label>Notes</label><input class="form-control" id="rs-notes" placeholder="Optional note…"></div>
    </div>`,
    `<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
     <button class="btn btn-primary" onclick="submitRestoreStudent('${studentId}')">🔄 Restore &amp; Save</button>`
  );
  // Run duplicate-month check immediately for the default month
  setTimeout(function(){ rsCheckMonthDuplicate('${t.id}', document.getElementById('rs-month')?.value); }, 80);
}

function rsAddExtraRow(label='',amount='') {
  const list=document.getElementById('rs-extra-list'); if(!list) return;
  const id='rsec_'+Date.now(); const div=document.createElement('div');
  div.id=id; div.style.cssText='display:flex;gap:8px;margin-bottom:8px;align-items:center';
  div.innerHTML=`<input class="form-control rs-extra-label" type="text" placeholder="Charge name" value="${escHtml(label)}" style="flex:1" oninput="rsRecalc()"><input class="form-control rs-extra-amt" type="number" placeholder="PKR" value="${amount}" min="0" style="width:120px" oninput="rsRecalc()"><button type="button" onclick="document.getElementById('${id}').remove();rsRecalc()" style="background:var(--red-dim);border:1px solid rgba(255,77,109,0.3);color:var(--red);border-radius:7px;padding:4px 9px;cursor:pointer;font-size:14px;flex-shrink:0">✕</button>`;
  list.appendChild(div);
}

function _normMonthLabel(val) {
  if (!val) return '';
  // Already "March 2026" style
  if (/[A-Za-z]/.test(val)) return val.trim();
  // YYYY-MM format -> "March 2026"
  try { const [y,m] = val.split('-'); return new Date(+y, +m-1, 1).toLocaleString('default',{month:'long',year:'numeric'}); } catch(e){ return val; }
}

function rsCheckMonthDuplicate(studentId, monthVal) {
  const warn = document.getElementById('rs-month-warning');
  if (!warn) return;
  if (!monthVal) { warn.style.display = 'none'; return; }
  const normVal = _normMonthLabel(monthVal);
  const existing = DB.payments.filter(p => p.studentId === studentId && _normMonthLabel(p.month) === normVal);
  const paid    = existing.find(p => p.status === 'Paid');
  const pending = existing.find(p => p.status === 'Pending');
  if (paid) {
    warn.style.display = '';
    warn.innerHTML = '<div style="background:rgba(255,77,109,0.1);border:1px solid rgba(255,77,109,0.35);border-radius:9px;padding:10px 14px;font-size:12px;color:var(--red);font-weight:600">⚠️ This student already has a <strong>Paid</strong> payment for <strong>' + monthVal + '</strong>. The payment section below has been disabled to avoid duplicates. Change the month or leave amount empty.</div>';
    // Disable and clear payment fields
    ['rs-amount','rs-pending','rs-concession'].forEach(function(id){
      const el = document.getElementById(id);
      if (el) { el.value = ''; el.disabled = true; }
    });
    const ps = document.getElementById('rs-pstatus');
    if (ps) ps.disabled = true;
  } else if (pending) {
    warn.style.display = '';
    warn.innerHTML = '<div style="background:rgba(200,168,75,0.08);border:1px solid rgba(200,168,75,0.3);border-radius:9px;padding:10px 14px;font-size:12px;color:var(--gold2);font-weight:600">⚠️ This student has a <strong>Pending</strong> payment of <strong>' + fmtPKR(pending.unpaid || pending.amount) + '</strong> for <strong>' + monthVal + '</strong>. Submitting will add a new record — consider updating the existing one instead.</div>';
    ['rs-amount','rs-pending','rs-concession','rs-pstatus'].forEach(function(id){
      const el = document.getElementById(id); if (el) el.disabled = false;
    });
  } else {
    warn.style.display = 'none';
    ['rs-amount','rs-pending','rs-concession','rs-pstatus'].forEach(function(id){
      const el = document.getElementById(id); if (el) el.disabled = false;
    });
  }
  rsRecalc();
}

function rsRecalc() {
  const rent=parseFloat(document.getElementById('rs-rent')?.value)||0;
  const paid=parseFloat(document.getElementById('rs-amount')?.value)||0;
  const conc=parseFloat(document.getElementById('rs-concession')?.value)||0;
  let extra=0; document.querySelectorAll('.rs-extra-amt').forEach(el=>{extra+=parseFloat(el.value)||0;});
  const net=rent+extra-conc;
  const f=v=>'PKR '+Math.round(Math.abs(v)).toLocaleString();
  const el=id=>document.getElementById(id);
  if(el('rs-tot-rent'))  el('rs-tot-rent').textContent =f(rent);
  if(el('rs-tot-extra')) el('rs-tot-extra').textContent=f(extra);
  if(el('rs-tot-conc'))  el('rs-tot-conc').textContent =f(conc);
  if(el('rs-tot-net'))   el('rs-tot-net').textContent  =f(net);
  const pendEl=el('rs-pending'), statEl=el('rs-pstatus');
  if(pendEl&&!pendEl.dataset.manual){
    const autoPend=Math.max(0,net-paid);
    pendEl.value=autoPend>0?autoPend:'';
    if(statEl) statEl.value=autoPend>0?'Pending':'Paid';
  }
}

function submitRestoreStudent(studentId) {
  const t=DB.students.find(x=>x.id===studentId); if(!t) return;
  const roomId=document.getElementById('rs-room').value;
  const rent  =parseFloat(document.getElementById('rs-rent').value)||0;
  if(!roomId){toast('Please select a room','error');return;}
  if(!rent)  {toast('Please enter monthly rent','error');return;}
  const room=DB.rooms.find(r=>r.id===roomId);
  const type=getRoomType(room);
  if(getRoomOccupancy(room)>=(type?.capacity||1)){toast('That room is full — pick another','error');return;}
  t.name            =document.getElementById('rs-name').value.trim()||t.name;
  t.fatherName      =document.getElementById('rs-fname').value.trim();
  t.cnic            =document.getElementById('rs-cnic').value.trim();
  t.phone           =document.getElementById('rs-phone').value.trim();
  t.email           =document.getElementById('rs-email').value.trim();
  t.occupation      =document.getElementById('rs-occ').value.trim();
  t.address         =document.getElementById('rs-address').value.trim();
  t.emergencyContact=document.getElementById('rs-emerg').value.trim();
  t.joinDate        =document.getElementById('rs-join').value;
  t.roomId=roomId; t.roomNumber=room?.number||''; t.rent=rent;
  t.paymentMethod=document.getElementById('rs-pm').value;
  t.status='Active'; t.restoredAt=new Date().toISOString().slice(0,10); t.leftDate='';
  const extraCharges=[];
  document.querySelectorAll('#rs-extra-list > div').forEach(row=>{
    const lbl=row.querySelector('.rs-extra-label')?.value?.trim();
    const amt=parseFloat(row.querySelector('.rs-extra-amt')?.value)||0;
    if(lbl&&amt>0) extraCharges.push({label:lbl,amount:amt});
  });
  const extraTotal =extraCharges.reduce((s,c)=>s+c.amount,0);
  const concession =parseFloat(document.getElementById('rs-concession').value)||0;
  const concReason =document.getElementById('rs-conc-reason').value.trim();
  const amount     =parseFloat(document.getElementById('rs-amount').value)||0;
  const pendingAmt =parseFloat(document.getElementById('rs-pending').value)||0;
  const pStatus    =document.getElementById('rs-pstatus').value;
  const extraNotes =document.getElementById('rs-notes').value.trim();
  const monthVal = _normMonthLabel(document.getElementById('rs-month').value);
  // Bug fix: prevent duplicate payment if this month is already fully paid
  const existingPaid = monthVal && DB.payments.find(p => p.studentId === t.id && _normMonthLabel(p.month) === monthVal && p.status === 'Paid');
  if (existingPaid) {
    toast(`ℹ️ Skipped payment — ${monthVal} is already marked Paid for ${t.name}.`, 'info');
  } else if(amount>0||extraTotal>0){
    const netAmount=rent+extraTotal-concession;
    const unpaid=pendingAmt>0?pendingAmt:(pStatus==='Pending'?netAmount:undefined);
    const notesParts=['First payment after restore'];
    if(extraCharges.length) notesParts.push('Charges: '+extraCharges.map(c=>`${c.label} ${fmtPKR(c.amount)}`).join(', '));
    if(concession>0) notesParts.push(`Concession: ${fmtPKR(concession)}${concReason?' ('+concReason+')':''}`);
    if(extraNotes) notesParts.push(extraNotes);
    DB.payments.push({id:uid(),studentId:t.id,studentName:t.name,roomId,roomNumber:room?.number||'',month:monthVal,monthlyRent:rent,totalRent:rent,amount,unpaid,fee:0,extraCharges,extraTotal,concession,method:t.paymentMethod,status:pStatus,date:t.joinDate||new Date().toISOString().slice(0,10),notes:notesParts.join(' | ')});
  }
  if(!DB.activityLog) DB.activityLog=[];
  DB.activityLog.unshift({id:uid(),type:'restore',icon:'🔄',text:`${t.name} restored to Room #${room?.number||''}`,date:new Date().toISOString()});
  saveDB(); closeModal();
  toast(`✅ ${t.name} restored to Room #${room?.number||''}!`,'success');
  if(currentPage==='dashboard'||currentPage==='students') renderPage(currentPage);
}
// ─────────────────────────────────────────────────────────────────────────────

function showUserMgmt() {
  var rows = '';
  var wList = ['warden1','warden2'];
  wList.forEach(function(key){
    var w = WARDENS[key];
    var isActive = key===CUR_ROLE;
    var photoSrc = w.photo || '';
    var avatarHtml = photoSrc
      ? '<img src="'+photoSrc+'" id="warden-avatar-img-'+key+'" style="width:56px;height:56px;border-radius:14px;object-fit:cover;border:2px solid var(--gold);cursor:pointer" onclick="document.getElementById(\'warden-photo-input-'+key+'\').click()" title="Click to change photo">'
      : '<div id="warden-avatar-img-'+key+'" onclick="document.getElementById(\'warden-photo-input-'+key+'\').click()" style="width:56px;height:56px;border-radius:14px;background:linear-gradient(135deg,var(--gold),#9a7a1a);display:flex;align-items:center;justify-content:center;font-size:24px;cursor:pointer;border:2px dashed rgba(200,168,75,0.3)" title="Click to upload photo">&#x1F464;</div>';
    rows += '<div style="background:var(--bg3);border:1px solid '+(isActive?'rgba(200,168,75,0.5)':'var(--border)')+';border-radius:12px;padding:16px;margin-bottom:10px">';
    rows += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">';
    rows += '<div style="position:relative;flex-shrink:0">';
    rows += avatarHtml;
    rows += '<div onclick="document.getElementById(\'warden-photo-input-'+key+'\').click()" style="position:absolute;bottom:-4px;right:-4px;width:20px;height:20px;border-radius:50%;background:var(--gold);display:flex;align-items:center;justify-content:center;font-size:11px;cursor:pointer;border:2px solid var(--bg3)" title="Change photo">✏️</div>';
    rows += '<input type="file" id="warden-photo-input-'+key+'" accept="image/*" style="display:none" onchange="handleWardenPhoto(event,\''+key+'\')">';
    rows += '</div>';
    rows += '<div style="flex:1">';
    rows += '<div style="font-weight:800;font-size:15px;color:var(--text)">'+escHtml(w.name)+(isActive?' <span style="font-size:9px;background:var(--gold-dim);color:var(--gold2);padding:2px 8px;border-radius:20px;border:1px solid rgba(200,168,75,0.3)">● LOGGED IN</span>':'')+'</div>';
    rows += '<div style="font-size:11px;color:var(--text3);margin-top:2px">Full access · Add, edit payments &amp; records</div>';
    rows += (photoSrc ? '<div style="font-size:10px;color:var(--green);margin-top:4px">✓ Profile photo set</div>' : '<div style="font-size:10px;color:var(--text3);margin-top:4px">Click avatar to upload a photo</div>');
    rows += '</div></div>';
    rows += '<div class="form-grid" style="gap:8px">';
    rows += '<div class="field"><label style="font-size:11px">Display Name</label><input id="wn-'+key+'" class="form-control" value="'+escHtml(w.name)+'" placeholder="Warden Name"></div>';
    rows += '<div class="field"><label style="font-size:11px">New Password</label><input id="wp-'+key+'" class="form-control" type="password" placeholder="Leave blank to keep current"></div>';
    rows += '<div class="field col-full"><label style="font-size:11px">📱 WhatsApp Number <span style="font-weight:400;color:var(--text3)">(used as default WA reminder number)</span></label><input id="wwa-'+key+'" class="form-control" value="'+escHtml(w.phone||'')+'" placeholder="03XX-XXXXXXX"></div>';
    rows += '</div>';
    rows += '<div style="display:flex;gap:8px;margin-top:10px">';
    rows += '<button class="btn btn-primary btn-sm" style="flex:1" onclick="saveWardenInfo(\''+key+'\')">&#x1F4BE; Save Changes</button>';
    if(photoSrc) rows += '<button class="btn btn-danger btn-sm" onclick="removeWardenPhoto(\''+key+'\')" title="Remove profile photo">🗑 Photo</button>';
    rows += '</div>';
    rows += '</div>';
  });

  showModal('modal-md','&#x1F9D1;&#x200D;&#x1F4BC; Warden Management',
    rows,
    '<button class="btn btn-secondary" onclick="closeModal()">Close</button><button class="btn btn-danger btn-sm" onclick="logout()">&#x1F6AA; Logout</button>'
  );
}

function handleWardenPhoto(event, key) {
  var file = event.target.files[0];
  if(!file) return;
  if(file.size > 2 * 1024 * 1024) { toast('Photo must be under 2MB','error'); return; }
  var reader = new FileReader();
  reader.onload = function(e) {
    // Resize to max 200x200 before storing
    var img = new Image();
    img.onload = function() {
      var canvas = document.createElement('canvas');
      var MAX = 200;
      var scale = Math.min(MAX/img.width, MAX/img.height, 1);
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      var dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      WARDENS[key].photo = dataUrl;
      saveWardenConfig();
      // Live-update the avatar in the modal without closing it
      var imgEl = document.getElementById('warden-avatar-img-'+key);
      if(imgEl) {
        imgEl.outerHTML = '<img src="'+dataUrl+'" id="warden-avatar-img-'+key+'" style="width:56px;height:56px;border-radius:14px;object-fit:cover;border:2px solid var(--gold);cursor:pointer" onclick="document.getElementById(\'warden-photo-input-'+key+'\').click()" title="Click to change photo">';
      }
      // Update the role badge in header if it's the current user
      if(key === CUR_ROLE) { CUR_USER = WARDENS[key]; updateRoleBadge(); }
      // Update login screen avatar
      updateLoginAvatar(key);
      toast('Profile photo updated!','success');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function removeWardenPhoto(key) {
  WARDENS[key].photo = '';
  saveWardenConfig();
  if(key === CUR_ROLE) { CUR_USER = WARDENS[key]; updateRoleBadge(); }
  updateLoginAvatar(key);
  toast('Photo removed','info');
  showUserMgmt(); // refresh modal
}

function updateLoginAvatar(key) {
  // Update the warden selector card on the login screen
  var num = key === 'warden1' ? '1' : '2';
  var card = document.getElementById('rb-warden'+num);
  if(!card) return;
  var photoEl = card.querySelector('.warden-login-photo');
  var w = WARDENS[key];
  if(w.photo) {
    if(photoEl) {
      photoEl.src = w.photo;
    } else {
      var emojiEl = card.querySelector('.warden-login-emoji');
      if(emojiEl) {
        emojiEl.innerHTML = '<img class="warden-login-photo" src="'+w.photo+'" style="width:36px;height:36px;border-radius:9px;object-fit:cover;border:1.5px solid rgba(200,168,75,0.5)">';
      }
    }
  } else {
    if(photoEl) {
      var parent = photoEl.parentElement;
      parent.innerHTML = '<span class="warden-login-emoji" style="font-size:22px;margin-bottom:4px;">&#x1F9D1;&#x200D;&#x1F4BC;</span>';
    }
  }
}

function saveWardenInfo(key) {
  var nameEl = document.getElementById('wn-'+key);
  var pwEl   = document.getElementById('wp-'+key);
  var wwaEl  = document.getElementById('wwa-'+key);
  if(!nameEl||!nameEl.value.trim()){toast('Name cannot be empty','error');return;}
  WARDENS[key].name = nameEl.value.trim();
  if(pwEl&&pwEl.value.trim()) WARDENS[key].pw = pwEl.value.trim();
  if(pwEl) pwEl.value='';
  if(wwaEl) {
    WARDENS[key].phone = wwaEl.value.trim();
    // Auto-update default WA number to the current logged-in warden's number
    if(key===CUR_ROLE && wwaEl.value.trim()) {
      DB.settings.defaultWANumber = wwaEl.value.trim();
      saveDB();
    }
  }
  saveWardenConfig();
  // Update display name label on login screen
  var lbl = document.getElementById('wb'+(key==='warden1'?'1':'2')+'-name');
  if(lbl) lbl.textContent=WARDENS[key].name;
  if(key===CUR_ROLE) { CUR_USER=WARDENS[key]; updateRoleBadge(); }
  toast(WARDENS[key].name+' updated','success');
}


// saveUPW replaced by saveWardenInfo

// ══════════════════════════════════════════════════════════════════
// STUDENT DOCUMENTS UPLOAD
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════
// STUDENT ID CARD GENERATOR
// ══════════════════════════════════════════════════════════════════


// ══════════════════════════════════════════════════════════════════
// ALL STUDENTS PDF DOWNLOAD
// ══════════════════════════════════════════════════════════════════
function downloadAllStudentsPDF() {
  // Build last 24 month options
  var monthOpts = '';
  for(var i=0;i<24;i++){
    var d=new Date(); d.setDate(1); d.setMonth(d.getMonth()-i);
    var val=d.toISOString().slice(0,7);
    var lbl=d.toLocaleString('default',{month:'long',year:'numeric'});
    monthOpts += '<option value="'+val+'"'+(i===0?' selected':'')+'>'+lbl+'</option>';
  }
  showModal('modal-md','📥 Download Students PDF',
    '<div style="padding:4px 0">'
    +'<div style="margin-bottom:18px">'
    +'<label style="font-size:12px;font-weight:700;color:var(--text2);display:block;margin-bottom:6px">Select Month for Fee Report</label>'
    +'<select id="pdf-month-sel" class="form-control">'+monthOpts+'</select>'
    +'<div style="font-size:11px;color:var(--text3);margin-top:6px">The PDF will show each student\'s rent, deposit, paid amount, and pending balance for the selected month.</div>'
    +'</div>'
    +'<div style="background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:14px">'
    +'<div style="font-size:12px;font-weight:700;color:var(--gold2);margin-bottom:8px">📋 Report will include:</div>'
    +'<div style="font-size:12px;color:var(--text2);line-height:1.8">'
    +'✅ Student name, father\'s name, room number<br>'
    +'✅ CNIC and phone number<br>'
    +'✅ Monthly rent &amp; deposit paid on joining<br>'
    +'✅ Amount paid in selected month<br>'
    +'✅ Pending / unpaid balance for that month<br>'
    +'✅ Payment status badge<br>'
    +'✅ <strong style="color:var(--amber)">Expenses summary badge &amp; full breakdown</strong><br>'
    +'✅ <strong style="color:var(--blue)">Transfer to Owner badge &amp; full breakdown</strong><br>'
    +'✅ <strong style="color:var(--green)">Net Available fund calculation</strong>'
    +'</div>'
    +'</div>'
    +'</div>',
    '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>'
    +'<button class="btn btn-primary" onclick="doGenerateStudentsPDF(document.getElementById(\'pdf-month-sel\').value);closeModal()">📥 Generate PDF</button>'
  );
}

function doGenerateStudentsPDF(monthKey) {
  var appName  = DB.settings.appName  || 'HOSTIX';
  var hostel   = DB.settings.hostelName || 'DAMAM Boys Hostel';
  var location = DB.settings.location  || '';
  var now      = new Date().toLocaleDateString('en-PK',{day:'2-digit',month:'long',year:'numeric'});
  // Use day 2 to avoid UTC-offset shifting to previous month
  var d        = new Date(monthKey+'-02');
  var monthLabel = d.toLocaleString('default',{month:'long',year:'numeric'});

  // Sort all students by name
  var allStudents = DB.students.slice().sort(function(a,b){return (a.name||'').localeCompare(b.name||'');});

  // FIX #4: Exclude Left/Cancelling students who left BEFORE the selected month.
  // Exception: always include if they have an actual payment record for that month.
  var students = allStudents.filter(function(s) {
    if (s.status !== 'Left' && s.status !== 'Cancelling') return true;
    // If they have a payment record for this month, include them regardless
    if (DB.payments.some(function(p){ return p.studentId===s.id && _payMatchesMonth(p, monthKey); })) return true;
    // Exclude if leftDate is before the first day of selected month
    if (s.leftDate && s.leftDate < monthKey+'-01') return false;
    return true;
  });

  var total  = students.length;
  var active = students.filter(function(s){return s.status==='Active';}).length;
  var left   = students.filter(function(s){return s.status==='Left';}).length;

  // Grand totals
  var grandRent=0, grandAdmFee=0, grandExtra=0, grandConc=0, grandPaid=0, grandPending=0;

  // Month-level expenses and transfers
  var grandExpenses  = (DB.expenses||[]).filter(function(e){ return (e.date||'').startsWith(monthKey); }).reduce(function(s,e){ return s+Number(e.amount||0); },0);
  var grandTransfers = (DB.transfers||[]).filter(function(t){ return (t.date||'').startsWith(monthKey); }).reduce(function(s,t){ return s+Number(t.amount||0); },0);

  var rows = '';
  students.forEach(function(s, i) {
    var room = DB.rooms.find(function(r){return r.id===s.roomId;});

    // FIX #1 #5: use _payMatchesMonth — correctly matches both "2026-04-15" date fields
    // AND "April 2026" month labels (the old startsWith never matched month labels).
    var mPays = DB.payments.filter(function(p){
      return p.studentId===s.id && _payMatchesMonth(p, monthKey);
    });

    var paidAmt    = mPays.filter(function(p){return p.status==='Paid';}).reduce(function(acc,p){return acc+Number(p.amount||0);},0)
                   + mPays.filter(function(p){return p.status==='Pending'&&Number(p.amount||0)>0&&p.unpaid!=null&&Number(p.unpaid)>0;}).reduce(function(acc,p){return acc+Number(p.amount||0);},0);
    var pendingAmt = mPays.filter(function(p){return p.status==='Pending';}).reduce(function(acc,p){return acc+(p.unpaid!=null?Number(p.unpaid):Number(p.amount||0));},0);
    var admFee     = mPays.reduce(function(acc,p){return acc+Number(p.admissionFee||p.fee||0);},0);
    var extraTotal = mPays.reduce(function(acc,p){return acc+(p.extraTotal!=null&&Number(p.extraTotal)>0?Number(p.extraTotal):(p.extraCharges||[]).reduce(function(x,c){return x+Number(c.amount||0);},0));},0);
    var concession = mPays.reduce(function(acc,p){return acc+Number(p.concession||p.discount||0);},0);

    var hasRecord   = mPays.length > 0;
    var statusTxt   = !hasRecord ? '—' : pendingAmt>0 ? 'Partial' : 'Paid ✓';
    var statusStyle = !hasRecord ? 'color:#888;background:#f0f0f0' : pendingAmt>0 ? 'color:#8b1a1a;background:#fde8e8' : 'color:#1a6b3a;background:#d4f4e0';
    var sColor      = s.status==='Active'?'#1a7a3a':s.status==='Left'?'#555':'#8b0000';
    var sBg         = s.status==='Active'?'#d4f4e0':s.status==='Left'?'#eee':'#fde8e8';
    var rowBg       = (i%2===0)?'#fff':'#f9f9fb';

    grandRent    += Number(s.rent||0);
    grandAdmFee  += admFee;
    grandExtra   += extraTotal;
    grandConc    += concession;
    grandPaid    += paidAmt;
    grandPending += pendingAmt;

    var dash = '<span style="color:#ccc">—</span>';
    // Build extra charges label: show each charge with description+amount
    var extCell = (function(){
      var allExt = [];
      mPays.forEach(function(p){
        (p.extraCharges||[]).forEach(function(c){
          if(Number(c.amount)>0) allExt.push((c.label?c.label+': ':'')+fmtPKR(c.amount));
        });
      });
      return allExt.length ? allExt.join('<br>') : dash;
    })();
    // Build concession label
    var concCell = (function(){
      if(!concession) return dash;
      var descs = [];
      mPays.forEach(function(p){
        var pConc = Number(p.concession||p.discount||0);
        if(pConc>0){
          var desc = p.concessionDesc||p.discountDesc||'';
          descs.push((desc?desc+': ':'')+fmtPKR(pConc));
        }
      });
      return descs.length ? '−'+descs.join('<br>') : '−'+fmtPKR(concession);
    })();

    rows += '<tr style="background:'+rowBg+'">';
    rows += '<td style="padding:6px 5px;border:1px solid #c8d0db;text-align:center;font-weight:700;color:#888;font-size:10px">'+(i+1)+'</td>';
    rows += '<td style="padding:6px 5px;border:1px solid #c8d0db;font-weight:700;color:#111">'+escHtml(s.name||'—')+'</td>';
    rows += '<td style="padding:6px 5px;border:1px solid #c8d0db;color:#444;font-size:10px">'+escHtml(s.fatherName||'—')+'</td>';
    rows += '<td style="padding:6px 5px;border:1px solid #c8d0db;text-align:center;font-weight:800;color:#b8860b">'+(room?'#'+room.number:'—')+'</td>';
    rows += '<td style="padding:6px 5px;border:1px solid #c8d0db;font-family:monospace;font-size:9.5px;color:#444">'+escHtml(s.cnic||'—')+'</td>';
    rows += '<td style="padding:6px 5px;border:1px solid #c8d0db;font-size:10px;color:#333">'+escHtml(s.phone||'—')+'</td>';
    rows += '<td style="padding:6px 5px;border:1px solid #c8d0db;text-align:right;font-weight:800;color:#1a5c3a">'+fmtPKR(s.rent||0)+'</td>';
    rows += '<td style="padding:6px 5px;border:1px solid #c8d0db;text-align:right;font-weight:700;color:'+(admFee>0?'#1a3a7a':'#bbb')+';font-size:10px">'+(admFee>0?fmtPKR(admFee):dash)+'</td>';
    rows += '<td style="padding:6px 5px;border:1px solid #c8d0db;text-align:right;font-weight:700;color:'+(extraTotal>0?'#7a4d00':'#bbb')+';font-size:10px">'+extCell+'</td>';
    rows += '<td style="padding:6px 5px;border:1px solid #c8d0db;text-align:right;font-weight:700;color:'+(concession>0?'#0a5a40':'#bbb')+';font-size:10px">'+concCell+'</td>';
    rows += '<td style="padding:6px 5px;border:1px solid #c8d0db;text-align:right;font-weight:800;color:'+(paidAmt>0?'#1a6b3a':'#aaa')+'">'+(paidAmt>0?fmtPKR(paidAmt):dash)+'</td>';
    rows += '<td style="padding:6px 5px;border:1px solid #c8d0db;text-align:right;font-weight:800;color:'+(pendingAmt>0?'#8b1a1a':'#aaa')+'">'+(pendingAmt>0?fmtPKR(pendingAmt):dash)+'</td>';
    rows += '<td style="padding:6px 5px;border:1px solid #c8d0db;text-align:center"><span style="display:inline-block;padding:2px 6px;border-radius:20px;font-size:9px;font-weight:800;'+statusStyle+'">'+statusTxt+'</span></td>';
    rows += '<td style="padding:6px 5px;border:1px solid #c8d0db;text-align:center"><span style="display:inline-block;padding:2px 6px;border-radius:20px;font-size:9px;font-weight:800;background:'+sBg+';color:'+sColor+'">'+escHtml(s.status||'—')+'</span></td>';
    rows += '</tr>';
  });

  // Totals row — adm/ext/conc NOT grand-totalled (they are per-student breakdown only)
  rows += '<tr style="background:#0f1a2e">';
  rows += '<td colspan="6" style="padding:8px 8px;font-weight:900;color:#e6c96e;font-size:12px;border:1px solid #2a3d5a">TOTALS &nbsp;<span style="font-weight:400;font-size:10px">('+total+' students)</span></td>';
  rows += '<td style="padding:8px 5px;text-align:right;font-weight:900;color:#e6c96e">'+fmtPKR(grandRent)+'</td>';
  rows += '<td style="padding:8px 5px;text-align:center;color:#4a6a9a;font-size:9px">—</td>';
  rows += '<td style="padding:8px 5px;text-align:center;color:#4a6a9a;font-size:9px">—</td>';
  rows += '<td style="padding:8px 5px;text-align:center;color:#4a6a9a;font-size:9px">—</td>';
  rows += '<td style="padding:8px 5px;text-align:right;font-weight:900;color:#4ade80">'+fmtPKR(grandPaid)+'</td>';
  rows += '<td style="padding:8px 5px;text-align:right;font-weight:900;color:#f87171">'+fmtPKR(grandPending)+'</td>';
  rows += '<td colspan="2" style="padding:8px 5px;text-align:center;font-size:10px;color:#8899bb">'+active+' active · '+left+' left</td>';
  rows += '</tr>';

  var netFund = grandPaid - grandExpenses - grandTransfers;

  // ── HTML ──────────────────────────────────────────────────────────────────
  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=1300">';
  html += '<title>'+hostel+' — Students Fee Report '+monthLabel+'</title>';
  html += '<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800;900&display=swap" rel="stylesheet">';
  html += '<style>';
  html += '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}';
  html += '@page{size:A4 landscape;margin:7mm 9mm}@media print{html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}';
  html += 'body{font-family:\'Outfit\',Arial,sans-serif;background:#fff;color:#111;padding:14px 18px;font-size:10.5px}';
  html += '@media print{body{padding:3px 4px;font-size:9.5px}.no-print{display:none!important}}';
  // 11 cols: # name father room cnic phone rent paid pend fst sst
  html += 'table{width:100%;border-collapse:collapse;table-layout:fixed}';
  html += 'col.c-no{width:3%}col.c-name{width:13%}col.c-father{width:10%}col.c-room{width:4%}col.c-cnic{width:11%}col.c-phone{width:8%}col.c-rent{width:7%}col.c-adm{width:7%}col.c-ext{width:8%}col.c-conc{width:8%}col.c-paid{width:8%}col.c-pend{width:7%}col.c-fst{width:7%}col.c-sst{width:6%}';
  html += 'thead th{background:#0f1a2e;color:#e6c96e;padding:7px 5px;text-align:left;font-size:8.5px;font-weight:800;text-transform:uppercase;letter-spacing:0.4px;border:1px solid #1e3050;word-break:break-word}';
  html += 'thead th.r{text-align:right}thead th.c{text-align:center}';
  html += 'td{padding:5px 5px;border:1px solid #c8d0db !important;word-break:break-word;vertical-align:middle;font-size:10px}';
  html += 'tr:hover td{background:#f0f4ff!important}';
  html += '.sum{display:inline-flex;align-items:center;gap:5px;background:#f5f7ff;border:1px solid #dde2ea;border-radius:8px;padding:5px 10px;margin:2px}';
  html += '.sum .v{font-size:15px;font-weight:900}.sum .l{font-size:8px;color:#666;font-weight:600;text-transform:uppercase;letter-spacing:0.5px}';
  html += '.pbtn{background:#0f1a2e;color:#e6c96e;border:none;padding:8px 18px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:Outfit,Arial,sans-serif}';
  html += '</style></head><body>';

  // Header
  html += '<div style="border-bottom:3px solid #c8a84b;padding-bottom:10px;margin-bottom:12px;display:flex;align-items:flex-start;justify-content:space-between">';
  html += '<div><div style="font-size:22px;font-weight:900;color:#0f1a2e">'+escHtml(hostel)+'</div>';
  if(location) html += '<div style="font-size:11px;color:#666;margin-top:2px">📍 '+escHtml(location)+'</div>';
  html += '<div style="font-size:14px;font-weight:800;color:#b8860b;margin-top:4px;text-transform:uppercase;letter-spacing:0.8px">Students Fee Report — '+monthLabel+'</div></div>';
  html += '<div style="text-align:right"><div style="font-size:10px;color:#888">Generated on</div><div style="font-size:12px;font-weight:700;color:#333">'+now+'</div>';
  html += '<button class="pbtn no-print" style="margin-top:8px" onclick="window.print()">🖨️ Print / Save PDF</button></div>';
  html += '</div>';

  // Summary badges (Fix #12: admission fee and concession removed from grand total badges)
  html += '<div style="display:flex;flex-wrap:wrap;gap:0;margin-bottom:12px">';
  html += '<div class="sum"><div class="v" style="color:#0f1a2e">'+total+'</div><div class="l">In<br>Report</div></div>';
  html += '<div class="sum"><div class="v" style="color:#1a7a3a">'+active+'</div><div class="l">Active</div></div>';
  html += '<div class="sum"><div class="v" style="color:#555">'+left+'</div><div class="l">Left</div></div>';
  html += '<div class="sum" style="background:#e8f5e9"><div class="v" style="color:#1a5c3a">'+fmtPKR(grandRent)+'</div><div class="l">Rent<br>Expected</div></div>';
  html += '<div class="sum" style="background:#e8f5e9"><div class="v" style="color:#1a6b3a">'+fmtPKR(calcRevenue(monthKey))+'</div><div class="l">Total<br>Collected</div></div>';
  var _pdfPending=DB.payments.filter(function(p){return p.status==='Pending'&&_payMatchesMonth(p,monthKey);}).reduce(function(s,p){return s+(p.unpaid!=null?Number(p.unpaid):Number(p.amount||0));},0);
  html += '<div class="sum" style="background:'+(_pdfPending>0?'#fde8e8':'#edfaf3')+'">';
  html += '<div class="v" style="color:'+(_pdfPending>0?'#8b1a1a':'#1a6b3a')+'">'+fmtPKR(_pdfPending)+'</div><div class="l">Pending<br>Unpaid</div></div>';
  html += '<div class="sum" style="background:#fff8e1;border-color:#e8a830"><div class="v" style="color:#854d0e">'+fmtPKR(grandExpenses)+'</div><div class="l">Expenses<br>'+monthLabel+'</div></div>';
  html += '<div class="sum" style="background:#eef2ff"><div class="v" style="color:#1a2c80">'+fmtPKR(grandTransfers)+'</div><div class="l">Transfer<br>to Owner</div></div>';
  html += '<div class="sum" style="background:'+(netFund>=0?'#edfaf3':'#fde8e8')+'"><div class="v" style="color:'+(netFund>=0?'#1a6b3a':'#8b1a1a')+'">'+fmtPKR(netFund)+'</div><div class="l">Net<br>Available</div></div>';
  html += '</div>';

  // Table
  html += '<table>';
  html += '<colgroup><col class="c-no"><col class="c-name"><col class="c-father"><col class="c-room"><col class="c-cnic"><col class="c-phone"><col class="c-rent"><col class="c-adm"><col class="c-ext"><col class="c-conc"><col class="c-paid"><col class="c-pend"><col class="c-fst"><col class="c-sst"></colgroup>';
  html += '<thead><tr>';
  html += '<th class="c">#</th><th>Student Name</th><th>Father\'s Name</th><th class="c">Room</th><th>CNIC</th><th>Phone</th>';
  html += '<th class="r">Rent/Mo</th>';
  html += '<th class="r" style="color:#7ab4ff">Adm.Fee</th>';
  html += '<th class="r" style="color:#ffd27a">Extra Chrgs</th>';
  html += '<th class="r" style="color:#7aefcf">Concession</th>';
  html += '<th class="r" style="color:#4ade80">Amount Paid</th>';
  html += '<th class="r" style="color:#f87171">Pending</th>';
  html += '<th class="c">Fee Status</th>';
  html += '<th class="c">Stu.Status</th>';
  html += '</tr></thead>';
  html += '<tbody>'+rows+'</tbody>';
  html += '</table>';

  // Expenses breakdown section
  var monthExpenses = (DB.expenses||[]).filter(function(e){ return (e.date||'').startsWith(monthKey); });
  if(monthExpenses.length) {
    html += '<div style="margin-top:16px;padding:12px 14px;background:#fffbf0;border:1px solid #e8c86a;border-radius:10px">';
    html += '<div style="font-size:13px;font-weight:800;color:#6b3d00;margin-bottom:8px">📉 Expenses — '+monthLabel+'</div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px">';
    html += '<thead><tr style="background:#3d2000"><th style="padding:6px 10px;color:#e6c96e;text-align:left;border:1px solid #6b3d00">Date</th><th style="padding:6px 10px;color:#e6c96e;text-align:left;border:1px solid #6b3d00">Category</th><th style="padding:6px 10px;color:#e6c96e;text-align:left;border:1px solid #6b3d00">Description</th><th style="padding:6px 10px;color:#e6c96e;text-align:right;border:1px solid #6b3d00">Amount</th></tr></thead><tbody>';
    var expTotal=0;
    monthExpenses.sort(function(a,b){return (a.date||'').localeCompare(b.date||'');}).forEach(function(e,i){
      expTotal+=Number(e.amount||0);
      html+='<tr style="background:'+(i%2===0?'#fff':'#fffbf0')+'">';
      html+='<td style="padding:5px 10px;border:1px solid #e8c86a">'+fmtDate(e.date)+'</td>';
      html+='<td style="padding:5px 10px;border:1px solid #e8c86a"><span style="padding:2px 8px;border-radius:20px;font-size:10px;font-weight:800;background:#fde8b4;color:#7a4400">'+escHtml(e.category||'—')+'</span></td>';
      html+='<td style="padding:5px 10px;border:1px solid #e8c86a;color:#444">'+escHtml(e.description||'—')+'</td>';
      html+='<td style="padding:5px 10px;border:1px solid #e8c86a;text-align:right;font-weight:800;color:#8b1a1a">'+fmtPKR(e.amount)+'</td>';
      html+='</tr>';
    });
    html+='<tr style="background:#3d2000"><td colspan="3" style="padding:6px 10px;border:1px solid #6b3d00;font-weight:900;color:#e6c96e">Total Expenses</td><td style="padding:6px 10px;border:1px solid #6b3d00;text-align:right;font-weight:900;color:#f87171">'+fmtPKR(expTotal)+'</td></tr>';
    html+='</tbody></table></div>';
  }

  // Transfers breakdown section
  var monthTransfers = (DB.transfers||[]).filter(function(t){ return (t.date||'').startsWith(monthKey); });
  if(monthTransfers.length) {
    html += '<div style="margin-top:14px;padding:12px 14px;background:#f0f4ff;border:1px solid #c5d0e6;border-radius:10px">';
    html += '<div style="font-size:13px;font-weight:800;color:#0f1a2e;margin-bottom:8px">🏦 Transfers to Owner — '+monthLabel+'</div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:11px">';
    html += '<thead><tr style="background:#0f1a2e"><th style="padding:6px 10px;color:#e6c96e;text-align:left;border:1px solid #1e3050">Date</th><th style="padding:6px 10px;color:#e6c96e;text-align:left;border:1px solid #1e3050">Description</th><th style="padding:6px 10px;color:#e6c96e;text-align:left;border:1px solid #1e3050">Method</th><th style="padding:6px 10px;color:#e6c96e;text-align:right;border:1px solid #1e3050">Amount</th></tr></thead><tbody>';
    var trTotal=0;
    monthTransfers.forEach(function(t,i){
      trTotal+=Number(t.amount||0);
      html+='<tr style="background:'+(i%2===0?'#fff':'#f9f9fb')+'">';
      html+='<td style="padding:5px 10px;border:1px solid #dde2ea">'+fmtDate(t.date)+'</td>';
      html+='<td style="padding:5px 10px;border:1px solid #dde2ea;font-weight:600">'+escHtml(t.description||'Transfer')+'</td>';
      html+='<td style="padding:5px 10px;border:1px solid #dde2ea">'+escHtml(t.method||'—')+'</td>';
      html+='<td style="padding:5px 10px;border:1px solid #dde2ea;text-align:right;font-weight:800;color:#854d0e">'+fmtPKR(t.amount)+'</td>';
      html+='</tr>';
    });
    html+='<tr style="background:#0f1a2e"><td colspan="3" style="padding:6px 10px;border:1px solid #1e3050;font-weight:900;color:#e6c96e">Total Transferred</td><td style="padding:6px 10px;border:1px solid #1e3050;text-align:right;font-weight:900;color:#e6c96e">'+fmtPKR(trTotal)+'</td></tr>';
    html+='</tbody></table></div>';
  }

  html += '<div style="margin-top:12px;padding-top:6px;border-top:1px solid #ddd;display:flex;justify-content:space-between;align-items:center">';
  html += '<div style="font-size:9px;color:#aaa">Generated by <strong>' + escHtml(appName) + '</strong> · '+escHtml(hostel)+' · '+monthLabel+'</div>';
  html += '<div style="font-size:10px;color:#555;font-weight:600">'+total+' students · Collected: <b style="color:#1a6b3a">'+fmtPKR(grandPaid)+'</b> · Expenses: <b style="color:#854d0e">'+fmtPKR(grandExpenses)+'</b> · Net: <b style="color:'+(netFund>=0?'#1a6b3a':'#8b1a1a')+'">'+fmtPKR(netFund)+'</b></div>';
  html += '</div>';

  // FIX-PDF-SHARE: Build share text for WhatsApp / Gmail
  var _shareText = hostel + ' — Fee Report ' + monthLabel + '\n'
    + 'Students: ' + total + ' · Active: ' + active + '\n'
    + 'Collected: ' + fmtPKR(grandPaid) + '\n'
    + 'Expenses: '  + fmtPKR(grandExpenses) + '\n'
    + 'Pending: '   + fmtPKR(_pdfPending) + '\n'
    + 'Net Available: ' + fmtPKR(netFund);
  var _waPhone = (CUR_USER&&CUR_USER.phone) ? CUR_USER.phone.replace(/[^0-9]/g,'').replace(/^0/,'92') : '';
  var _waLink  = 'whatsapp://send?' + (_waPhone?'phone='+_waPhone+'&':'') + 'text=' + encodeURIComponent(_shareText);
  var _gmailLink = 'https://mail.google.com/mail/?view=cm&su=' + encodeURIComponent(hostel+' Fee Report '+monthLabel) + '&body=' + encodeURIComponent(_shareText);

  // FIX-PRINT-HANG: Auto-print script removed — calling window.print() automatically
  // in a child window.open() hangs the Electron renderer on Windows. User uses the button.
  html += '</body></html>';

  // ── IN-APP VIEWER (always — no window.open, no external save dialog) ─────────
  // Removes old viewer if open, builds a full-screen overlay with toolbar,
  // renders the report inside an <iframe> using srcdoc — works in Electron.
  var _viewerId = '_inapp_report_viewer';
  var _oldViewer = document.getElementById(_viewerId);
  if (_oldViewer) _oldViewer.remove();

  // Build suggestedName for Save PDF button (used by electronAPI if available)
  var _suggestedName = (hostel).replace(/\s+/g,'-').replace(/[^a-zA-Z0-9\-]/g,'')
    + '_Fee-Report_' + monthLabel.replace(/\s+/g,'-') + '.pdf';

  // Print handler: prefer electronAPI native PDF, fall back to iframe print
  var _printHandler = 'if(window.electronAPI&&window.electronAPI.receiptSavePDF){'
    + 'var fr=document.getElementById(\'_rpt_frame\');'
    + 'if(fr)window.electronAPI.receiptSavePDF(fr.srcdoc||\'\',"' + _suggestedName + '",{landscape:true,pageSize:\'A4\'});'
    + '}else{'
    + 'var fr2=document.getElementById(\'_rpt_frame\');if(fr2)fr2.contentWindow.print();'
    + '}';

  var _viewer = document.createElement('div');
  _viewer.id = _viewerId;
  _viewer.style.cssText = 'position:fixed;inset:0;z-index:99998;background:#1e293b;display:flex;flex-direction:column';
  _viewer.innerHTML =
    // ── toolbar ──
    '<div style="background:#0f1a2e;padding:10px 16px;display:flex;align-items:center;gap:10px;flex-shrink:0;border-bottom:2px solid #c8a84b">'
    + '<span style="font-size:18px">📄</span>'
    + '<span style="color:#e6c96e;font-weight:800;font-size:14px">Students Fee Report — '+escHtml(monthLabel)+'</span>'
    + '<div style="flex:1"></div>'
    + '<button onclick="'+_printHandler+'" style="background:#1e5fd4;color:#fff;border:none;padding:8px 18px;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer;margin-right:4px">🖨️ Print / Save PDF</button>'
    + '<button onclick="openExternalLink(\''+_waLink+'\')" style="background:#25d366;color:#fff;border:none;padding:8px 14px;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer;margin-right:4px">📲 WhatsApp</button>'
    + '<button onclick="openExternalLink(\''+_gmailLink+'\')" style="background:#ea4335;color:#fff;border:none;padding:8px 14px;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer;margin-right:8px">📧 Gmail</button>'
    + '<button onclick="document.getElementById(\''+_viewerId+'\').remove()" style="background:rgba(255,255,255,0.1);color:#e8eef8;border:1px solid rgba(255,255,255,0.2);padding:8px 14px;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer">✕ Close</button>'
    + '</div>'
    // ── iframe ──
    + '<iframe id="_rpt_frame" style="flex:1;border:none;width:100%;background:#fff"></iframe>';

  document.body.appendChild(_viewer);

  // Use srcdoc — reliable in Electron same-renderer, no blob URL issues
  var _frame = document.getElementById('_rpt_frame');
  _frame.srcdoc = html;
}

// ── ADD STUDENT RECALC ───────────────────────────────────────────────────────
function filterRoomSearch(q) {
  const drop = document.getElementById('room-search-drop'); if(!drop) return;
  const items = drop.querySelectorAll('.room-search-item');
  const v = q.toLowerCase();
  let any = false;
  items.forEach(el => {
    const label = el.dataset.label.toLowerCase();
    const show = !v || label.includes(v);
    el.style.display = show ? '' : 'none';
    if(show) any = true;
  });
  drop.style.display = 'block';
}
function pickRoomSearch(roomId, rent, label) {
  document.getElementById('f-troom').value = roomId;
  document.getElementById('f-trent').value = parseFloat(rent)||DB.settings.roomTypes[0]?.defaultRent||16000;
  const inp = document.getElementById('f-troom-search');
  if(inp) inp.value = label;
  const lbl = document.getElementById('f-troom-selected-label');
  if(lbl) lbl.textContent = '✓ Selected';
  const drop = document.getElementById('room-search-drop');
  if(drop) drop.style.display = 'none';
  recalcStudentUnpaid();
}function recalcStudentUnpaid() {
  const r = parseFloat(document.getElementById('f-trent')?.value)||0;
  const a = parseFloat(document.getElementById('f-tdeposit')?.value)||0;
  const admFee = parseFloat(document.getElementById('f-tadmfee')?.value)||0;
  const extra = getStudentExtraChargesTotal();
  const total = r + admFee + extra;
  const u = Math.max(0, total - a);
  const el = document.getElementById('f-tunpaid');
  if(el){ el.value=u; el.style.color=u>0?'var(--red)':'var(--green)'; }
  const lbl = document.getElementById('f-tdeposit-status');
  if(lbl) lbl.textContent = a>=total&&total>0?'✓ Full amount paid — will be marked Paid':a>0?'⚠ Partial — will be marked Pending':'No amount paid — auto-pending record created';
  const fb = document.getElementById('f-tadmfee-badge');
  if(fb) fb.textContent = admFee>0 ? fmtPKR(admFee) : 'No Fee';
  const etEl = document.getElementById('student-extra-charges-total');
  if(etEl) etEl.textContent = 'PKR ' + Number(extra).toLocaleString('en-PK');
}
function getStudentExtraChargesTotal() {
  let t=0; document.querySelectorAll('.student-extra-charge-amt').forEach(i=>{ t+=parseFloat(i.value)||0; }); return t;
}
function getStudentExtraChargesData() {
  const items=[];
  document.querySelectorAll('.student-extra-charge-row').forEach(row=>{
    const label=row.querySelector('.student-extra-label')?.value?.trim();
    const amt=parseFloat(row.querySelector('.student-extra-charge-amt')?.value)||0;
    if(label&&amt>0) items.push({label,amount:amt});
  });
  return items;
}
function addStudentExtraChargeRow(label='',amount='') {
  const list=document.getElementById('student-extra-charges-list'); if(!list) return;
  const rowId='secr_'+Date.now();
  const div=document.createElement('div');
  div.className='extra-charge-row student-extra-charge-row'; div.id=rowId;
  div.innerHTML=`<input class="form-control student-extra-label" type="text" placeholder="Charge name (e.g. Cooler Fee)" value="${escHtml(label)}" style="flex:1" oninput="recalcStudentUnpaid()"><input class="form-control student-extra-charge-amt charge-amt" type="number" placeholder="Amount (PKR)" value="${amount}" min="0" oninput="recalcStudentUnpaid()"><button type="button" class="rm-btn" onclick="document.getElementById('${rowId}').remove();recalcStudentUnpaid()" title="Remove">✕</button>`;
  list.appendChild(div); recalcStudentUnpaid();
}
// ─────────────────────────────────────────────────────────────────────────────

// ── INPUT AUTO-FORMAT ────────────────────────────────────────────────────────
function fmtPhone(inp) {
  let v = inp.value.replace(/\D/g,'');
  if(v.length > 4) v = v.slice(0,4) + '-' + v.slice(4,11);
  inp.value = v;
}
function fmtCnic(inp) {
  let v = inp.value.replace(/\D/g,'');
  if(v.length > 5) v = v.slice(0,5) + '-' + v.slice(5);
  if(v.length > 13) v = v.slice(0,13) + '-' + v.slice(13,14);
  inp.value = v;
}
function fmtEmail(inp) {
  const hint = document.getElementById('f-temail-hint');
  // FIX 7: trim before checking to avoid stale hint on trailing-space input
  const v = inp.value.trim();
  if(v && !v.includes('@')) {
    if(hint) hint.style.display = 'block';
  } else {
    if(hint) hint.style.display = 'none';
  }
}
function getEmailValue() {
  const el = document.getElementById('f-temail');
  if(!el) return '';
  const v = el.value.trim();
  if(!v) return '';
  // FIX 8: full email kept as-is (user@yahoo.com etc.), bare username gets @gmail.com
  return v.includes('@') ? v : v + '@gmail.com';
}
// ─────────────────────────────────────────────────────────────────────────────

// ── CANCELLATION DOWNLOAD REPORT ─────────────────────────────────────────────
function downloadCancellationReport() {
  const list = DB.cancellations || [];
  if(!list.length){ toast('No cancellation records to export','error'); return; }

  // Get last 2 months date range
  const now = new Date();
  const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth()-2, 1);

  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <title>Cancellation Report — ${DB.settings.hostelName||'Hostel'}</title>
  <style>
    @page { margin: 15mm; }
    @media print { .no-print { display:none; } }
    body { font-family: Arial, sans-serif; font-size: 12px; color: #111; margin: 0; padding: 20px; }
    h1 { font-size: 20px; color: #0f1a2e; margin-bottom: 4px; }
    .sub { color: #888; font-size: 11px; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
    th { background: #0f1a2e; color: #e6c96e; padding: 8px 10px; text-align: left; font-size: 11px; letter-spacing: 0.5px; }
    td { padding: 7px 10px; border-bottom: 1px solid #eee; vertical-align: top; font-size: 11px; }
    tr:nth-child(even) td { background: #f8f9fb; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 10px; font-weight: 700; }
    .badge-red { background: #fee2e2; color: #dc2626; }
    .badge-green { background: #dcfce7; color: #16a34a; }
    .badge-amber { background: #fef3c7; color: #b45309; }
    .badge-gray { background: #f3f4f6; color: #555; }
    .section-title { font-size: 13px; font-weight: 800; color: #0f1a2e; border-left: 4px solid #c8a84b; padding-left: 10px; margin: 20px 0 10px; }
    .pay-row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px dashed #eee; font-size: 11px; }
    .no-print { margin-bottom: 16px; }
    button { padding: 8px 18px; background: #0f1a2e; color: #e6c96e; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 700; margin-right: 8px; }
  </style></head><body>
  <div class="no-print">
    <button onclick="window.print()"><span class=\"micon\" style=\"font-size:15px\">print</span> Print</button>
    <button onclick="window.close()">✕ Close</button>
  </div>
  <h1>📋 Cancellation Report</h1>
  <div class="sub">${DB.settings.hostelName||'Hostel'} · Generated: ${new Date().toLocaleString('en-PK')} · Includes last 2 months payment history</div>`;

  list.forEach(c => {
    const student = DB.students.find(s=>s.id===c.studentId);
    // Get last 2 months of payments for this student
    const payments = (DB.payments||[]).filter(p=>{
      if(p.studentId !== c.studentId) return false;
      const d = new Date(p.date||p.dueDate||'');
      return d >= twoMonthsAgo;
    }).sort((a,b)=>new Date(b.date||b.dueDate||0)-new Date(a.date||a.dueDate||0)).slice(0,6);

    // BUG FIX: 'Confirmed' incorrectly mapped to badge-red (same as Pending).
    // Fixed: Pending→red, Confirmed→amber, Cancelled/Vacated→gray, others→green.
    const statusBadge = c.status==='Pending' ? 'badge-red'
      : c.status==='Confirmed'  ? 'badge-amber'
      : (c.status==='Cancelled' || c.status==='Vacated') ? 'badge-gray'
      : 'badge-green';

    html += `<div style="border:1px solid #ddd;border-radius:8px;padding:14px;margin-bottom:20px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
        <div>
          <div style="font-size:15px;font-weight:800;color:#0f1a2e">${c.studentName||'—'}</div>
          <div style="font-size:11px;color:#888;margin-top:2px">Room #${c.roomNumber||'—'} · ${c.roomType||'—'} · ${student?.phone||'No phone'}</div>
        </div>
        <span class="badge ${statusBadge}">${c.status}</span>
      </div>
      <table>
        <tr><th>Field</th><th>Details</th></tr>
        <tr><td>Request Date</td><td>${fmtDate(c.requestDate)||'—'}</td></tr>
        <tr><td>Vacate Date</td><td>${fmtDate(c.vacateDate)||'End of Month'}</td></tr>
        <tr><td>Reason</td><td>${c.reason||'—'}</td></tr>
        <tr><td>Notes</td><td>${c.notes||'—'}</td></tr>
      </table>
      <div class="section-title">💰 Payment History (Last 2 Months)</div>`;

    if(payments.length) {
      html += `<table><tr><th>Month</th><th>Rent</th><th>Paid</th><th>Unpaid</th><th>Method</th><th>Date</th><th>Status</th></tr>`;
      payments.forEach(p=>{
        const statusCls = p.status==='Paid'?'badge-green':'badge-red';
        html += `<tr>
          <td>${p.month||'—'}</td>
          <td>${fmtPKR(p.monthlyRent||0)}</td>
          <td>${fmtPKR(p.amount||0)}</td>
          <td style="color:${(p.unpaid||0)>0?'#dc2626':'#16a34a'};font-weight:700">${fmtPKR(p.unpaid||0)}</td>
          <td>${p.method||'—'}</td>
          <td>${fmtDate(p.date)||'—'}</td>
          <td><span class="badge ${statusCls}">${p.status}</span></td>
        </tr>`;
      });
      html += `</table>`;
    } else {
      html += `<div style="color:#aaa;font-size:11px;padding:8px 0">No payment records in last 2 months</div>`;
    }
    html += `</div>`;
  });

  html += `</body></html>`;

  _electronPDF(html, (DB.settings.hostelName||'Hostel').replace(/\s+/g,'-').replace(/[^a-zA-Z0-9\-]/g,'')+'_Rent-Summary_'+new Date().toISOString().slice(0,10)+'.pdf', {pageSize:'A4'});
}
// ─────────────────────────────────────────────────────────────────────────────

// ── CITY AUTOCOMPLETE ────────────────────────────────────────────────────────
const PK_CITIES = [
  // KPK & FATA (primary — hostel is in Peshawar)
  'Peshawar','Mardan','Nowshera','Charsadda','Swabi','Swat','Mingora','Abbottabad',
  'Mansehra','Haripur','Kohat','Hangu','Karak','Bannu','Lakki Marwat','Tank',
  'Dera Ismail Khan','Chitral','Dir','Lower Dir','Upper Dir','Shangla','Buner',
  'Malakand','Batkhela','Timergara','Matta','Kabal','Barikot','Daggar','Alpuri',
  'Chakdara','Parachinar','Kurram','North Waziristan','South Waziristan','Mohmand',
  'Bajaur','Khyber','Landi Kotal','Jamrud','Bara','Wana','Razmak','Miranshah',
  'Orakzai','Darra Adam Khel','Khar','Nawagai','Ghazi','Havelian','Doaba',
  // Punjab
  'Lahore','Faisalabad','Rawalpindi','Gujranwala','Multan','Sialkot','Bahawalpur',
  'Sargodha','Sheikhupura','Jhang','Rahim Yar Khan','Gujrat','Kasur','Dera Ghazi Khan',
  'Sahiwal','Okara','Wah Cantonment','Mianwali','Pakpattan','Attock','Muzaffargarh',
  'Khanewal','Chiniot','Jhelum','Hafizabad','Chakwal','Khushab','Mandi Bahauddin',
  'Narowal','Toba Tek Singh','Vehari','Lodhran','Bahawalnagar','Layyah',
  // Sindh
  'Karachi','Hyderabad','Sukkur','Larkana','Nawabshah','Mirpur Khas','Jacobabad',
  'Shikarpur','Khairpur','Dadu','Badin','Thatta','Umerkot','Sanghar','Tando Allahyar',
  // Balochistan
  'Quetta','Turbat','Khuzdar','Gwadar','Hub','Chaman','Sibi','Dera Murad Jamali',
  'Loralai','Kharan','Nushki','Panjgur','Mastung','Kalat',
  // Islamabad & AJK & GB
  'Islamabad','Muzaffarabad','Mirpur','Rawalakot','Gilgit','Skardu','Hunza',
  'Ghanche','Ghizer','Astore','Chilas',
];

function cityAutocomplete(input) {
  const val = input.value.trim().toLowerCase();
  const box = document.getElementById('f-taddress-suggestions');
  if (!box) return;
  if (val.length < 2) { box.classList.remove('open'); box.innerHTML=''; return; }
  const matches = PK_CITIES.filter(c => c.toLowerCase().includes(val)).slice(0, 8);
  if (!matches.length) { box.classList.remove('open'); box.innerHTML=''; return; }
  box.innerHTML = matches.map(c => {
    const hi = c.replace(new RegExp('('+val.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')', 'gi'), '<b>$1</b>');
    return `<div class="city-suggestion-item" onmousedown="pickCity('${c.replace(/'/g,"\\'")}','${input.id}')">${hi}</div>`;
  }).join('');
  box.classList.add('open');
  // Position relative to parent field
  const parent = input.parentElement;
  if(parent) parent.style.position = 'relative';
}

function pickCity(city, inputId) {
  const inp = document.getElementById(inputId);
  if (inp) {
    // Append city to existing text if there's already something typed, else just set city
    const cur = inp.value.trim();
    // If user typed a partial word, replace that last word with the city
    const words = cur.split(',');
    words[words.length-1] = ' ' + city;
    inp.value = words.join(',').replace(/^\s*,\s*/,'').trim() + ', ';
    inp.focus();
  }
  hideCitySuggestions();
}

function hideCitySuggestions() {
  setTimeout(()=>{
    const box = document.getElementById('f-taddress-suggestions');
    if(box){ box.classList.remove('open'); box.innerHTML=''; }
  }, 150);
}
// ─────────────────────────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════════
// ANNUAL ARCHIVE — Merged from annual-archive.html
// ════════════════════════════════════════════════════════════════════════════
var _archSelYear = new Date().getFullYear();
var _archCurMK = '';
var _archMK = '';
var _archTab = 'overview';
var _archChartInst = null;

var _ARCH_MN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
var _ARCH_MS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var _archFmt = function(v){ return 'PKR ' + Math.round(Math.abs(v||0)).toLocaleString(); };
var _archFmtD = function(d){ if(!d) return '--'; var x=new Date(d+'T00:00:00'); return isNaN(x)?d:x.toLocaleDateString('en-PK',{day:'2-digit',month:'short',year:'numeric'}); };

function renderArchive() {
  var now = new Date();
  _archCurMK = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  return '<div style="padding:4px 0">' +
    '<div class="arch-top-bar">' +
      '<div>' +
        '<h1>&#x1F4C1; Annual <span>Archive</span></h1>' +
        '<div style="font-size:11px;color:var(--text3);margin-top:2px;">Click any month card to view details &bull; Edit/delete any record &bull; Add data</div>' +
      '</div>' +
      '<div class="arch-year-tabs" id="archYearTabs"></div>' +
    '</div>' +
    '<div class="arch-trend-card">' +
      '<div class="arch-trend-header">' +
        '<div style="width:26px;height:26px;background:rgba(30,62,95,0.8);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:13px;">&#x1F4C8;</div>' +
        '<div><div class="arch-trend-title">Revenue Trend</div><div class="arch-trend-sub" id="archTrendSub">12-month view</div></div>' +
        '<div class="arch-trend-legend">' +
          '<div class="arch-leg-item"><div class="arch-leg-dot" style="background:#00e676"></div>Revenue</div>' +
          '<div class="arch-leg-item"><div class="arch-leg-dot" style="background:#ff4d6d"></div>Expenses</div>' +
          '<div class="arch-leg-item"><div class="arch-leg-dot" style="background:#ff8c42"></div>Transfers</div>' +
          '<div class="arch-leg-item"><div class="arch-leg-dot" style="background:#f0c040"></div>Pending</div>' +
        '</div>' +
      '</div>' +
      '<div class="arch-trend-badges" id="archTrendBadges"></div>' +
      '<div class="arch-chart-wrap"><canvas id="archTrendChart"></canvas><div class="arch-hb" id="archHb"></div></div>' +
    '</div>' +
    '<div class="arch-summary-bar" id="archSummaryBar"></div>' +
    '<div id="archYearDetailPanel" style="display:none;"></div>' +
    '<div class="arch-month-grid" id="archMonthGrid"></div>' +
  '</div>';
}

function archAfterRender() {
  archRenderYearTabs();
  archRenderPage();
}

function _archMatchMonth(p,mk){
  if((p.date||'').startsWith(mk))return true;
  if((p.dueDate||'').startsWith(mk))return true;
  if((p.paidDate||'').startsWith(mk))return true;
  if(p.month){try{var pd=new Date(p.month+' 1');if(!isNaN(pd)){var pmk=pd.getFullYear()+'-'+String(pd.getMonth()+1).padStart(2,'0');if(pmk===mk)return true;}}catch(e){}}
  return false;
}
function archAgg(mk) {
  var py=DB.payments||[], ex=DB.expenses||[], tr=DB.transfers||[], st=DB.students||[], rm=DB.rooms||[];
  var matchPy=py.filter(function(p){return _archMatchMonth(p,mk);});
  var rev=matchPy.filter(function(p){return p.status==='Paid';}).reduce(function(s,p){return s+Number(p.amount||0);},0)
         +matchPy.filter(function(p){return p.status==='Pending'&&Number(p.amount||0)>0&&p.unpaid!=null;}).reduce(function(s,p){return s+Number(p.amount||0);},0);
  var pend=matchPy.filter(function(p){return p.status==='Pending';}).reduce(function(s,p){return s+(p.unpaid!=null?Number(p.unpaid):Number(p.amount||0));},0);
  var exp=ex.filter(function(e){return (e.date||'').startsWith(mk);}).reduce(function(s,e){return s+Number(e.amount||0);},0);
  var trf=tr.filter(function(t){return (t.date||'').startsWith(mk);}).reduce(function(s,t){return s+Number(t.amount||0);},0);
  var payList=matchPy;
  var expList=ex.filter(function(e){return (e.date||'').startsWith(mk);});
  var trfList=tr.filter(function(t){return (t.date||'').startsWith(mk);});
  var stuList=st.filter(function(s){return s.status==='Active';}).map(function(s){var r=rm.find(function(r){return r.id===s.roomId;});return Object.assign({},s,{roomNumber:r?r.number:'--'});});
  return {rev:rev,pend:pend,exp:exp,trf:trf,net:rev-exp-trf,payList:payList,expList:expList,trfList:trfList,stuList:stuList};
}

function archRenderYearTabs() {
  var el = document.getElementById('archYearTabs'); if(!el) return;
  var dates = [].concat(
    (DB.payments||[]).map(function(p){return p.date||p.dueDate||'';}),
    (DB.expenses||[]).map(function(e){return e.date||'';}),
    (DB.transfers||[]).map(function(t){return t.date||'';})
  ).filter(Boolean);
  var years = new Set(dates.map(function(d){return d.slice(0,4);}).filter(function(y){return y>'2000';}));
  years.add(String(new Date().getFullYear()));
  el.innerHTML = Array.from(years).sort().reverse().map(function(y){
    return '<button class="arch-year-tab '+(y==_archSelYear?'active':'')+'" onclick="_archSelYear='+y+';document.getElementById(\'archYearDetailPanel\').style.display=\'none\';archRenderYearTabs();archRenderPage();">'+y+'</button>';
  }).join('');
}

function archRenderPage() {
  archRenderSummary();
  archRenderGrid();
  archRenderTrend();
}

function archRenderSummary() {
  var el = document.getElementById('archSummaryBar'); if(!el) return;
  var tR=0,tE=0,tT=0,tP=0;
  for(var m=1;m<=12;m++){var a=archAgg(_archSelYear+'-'+String(m).padStart(2,'0'));tR+=a.rev;tE+=a.exp;tT+=a.trf;tP+=a.pend;}
  var tN=tR-tE-tT;
  var cards=[
    {l:'Total Revenue',v:_archFmt(tR),s:_archSelYear+' collected',c:'var(--green)',t:'revenue'},
    {l:'Total Expenses',v:_archFmt(tE),s:'Direct costs',c:'var(--red)',t:'expenses'},
    {l:'Total Transfers',v:_archFmt(tT),s:'Outgoing',c:'var(--amber)',t:'transfers'},
    {l:'Pending Due',v:_archFmt(tP),s:'Uncollected',c:'var(--gold2)',t:'pending'},
    {l:'Net '+_archSelYear,v:(tN>=0?'+':'')+_archFmt(tN),s:'Rev-Exp-Trf',c:tN>=0?'var(--green)':'var(--red)',t:'net'},
  ];
  el.innerHTML = cards.map(function(c){
    return '<div class="arch-s-card" onclick="archShowYearDetail(\''+c.t+'\')" style="border-color:'+c.c+'22">'+
      '<div class="arch-s-label">'+c.l+'</div><div class="arch-s-val" style="color:'+c.c+'">'+c.v+'</div>'+
      '<div class="arch-s-sub">'+c.s+'</div><div class="arch-s-hint">&#x1F4CB; Click for detail</div>'+
    '</div>';
  }).join('');
}

function archShowYearDetail(type) {
  var panel=document.getElementById('archYearDetailPanel'); if(!panel) return;
  panel.style.display='block'; setTimeout(function(){panel.scrollIntoView({behavior:'smooth',block:'start'});},50);
  var allPay=[],allExp=[],allTrf=[];
  for(var m=1;m<=12;m++){
    var mk=_archSelYear+'-'+String(m).padStart(2,'0');
    allPay.push.apply(allPay,(DB.payments||[]).filter(function(p){return _archMatchMonth(p,mk);}));
    allExp.push.apply(allExp,(DB.expenses||[]).filter(function(e){return (e.date||'').startsWith(mk);}));
    allTrf.push.apply(allTrf,(DB.transfers||[]).filter(function(t){return (t.date||'').startsWith(mk);}));
  }
  var titles={revenue:'Revenue Detail',expenses:'Expenses Detail',transfers:'Transfers Detail',pending:'Pending Payments',net:'Monthly Net Breakdown'};
  var icons={revenue:'&#x1F4B0;',expenses:'&#x1F4C9;',transfers:'&#x1F3E6;',pending:'&#x23F3;',net:'&#x1F4CA;'};
  var content='';
  if(type==='revenue'){
    var paid=allPay.filter(function(p){return p.status==='Paid';}),tot=paid.reduce(function(s,p){return s+Number(p.amount||0);},0);
    content=archMkTbl(paid,['Student','Room','Month','Amount','Method','Date'],function(p){return '<td class="td-name">'+escHtml(p.studentName||'--')+'</td><td style="color:var(--gold2)">#'+escHtml(String(p.roomNumber||'--'))+'</td><td>'+escHtml(p.month||'--')+'</td><td style="color:var(--green);font-weight:700">'+_archFmt(p.amount)+'</td><td>'+escHtml(p.method||'--')+'</td><td style="color:var(--text3)">'+_archFmtD(p.date)+'</td>';},
    'Total: '+_archFmt(tot)+' - '+paid.length+' payments');
  } else if(type==='expenses'){
    var tot2=allExp.reduce(function(s,e){return s+Number(e.amount||0);},0);
    content=archMkTbl(allExp,['Date','Category','Description','Amount'],function(e){return '<td style="color:var(--text3)">'+_archFmtD(e.date)+'</td><td><span class="badge badge-amber">'+escHtml(e.category||'--')+'</span></td><td>'+escHtml(e.description||'--')+'</td><td style="color:var(--red);font-weight:700">'+_archFmt(e.amount)+'</td>';},
    'Total: '+_archFmt(tot2)+' - '+allExp.length+' records');
  } else if(type==='transfers'){
    var tot3=allTrf.reduce(function(s,t){return s+Number(t.amount||0);},0);
    content=archMkTbl(allTrf,['Date','Description','Method','Amount'],function(t){return '<td style="color:var(--text3)">'+_archFmtD(t.date)+'</td><td>'+escHtml(t.description||t.note||'--')+'</td><td>'+escHtml(t.method||'--')+'</td><td style="color:var(--amber);font-weight:700">'+_archFmt(t.amount)+'</td>';},
    'Total: '+_archFmt(tot3)+' - '+allTrf.length+' records');
  } else if(type==='pending'){
    var p2=allPay.filter(function(p){return p.status==='Pending';}),tot4=p2.reduce(function(s,p){return s+(p.unpaid!=null?Number(p.unpaid):Number(p.amount||0));},0);
    content=archMkTbl(p2,['Student','Room','Month','Pending'],function(p){return '<td class="td-name">'+escHtml(p.studentName||'--')+'</td><td style="color:var(--gold2)">#'+escHtml(String(p.roomNumber||'--'))+'</td><td>'+escHtml(p.month||'--')+'</td><td style="color:var(--red);font-weight:700">'+_archFmt(p.unpaid!=null?p.unpaid:p.amount)+'</td>';},
    'Total Pending: '+_archFmt(tot4)+' - '+p2.length+' records');
  } else if(type==='net'){
    var rows=[];
    for(var m2=1;m2<=12;m2++){var mk2=_archSelYear+'-'+String(m2).padStart(2,'0');var a=archAgg(mk2);if(a.rev>0||a.exp>0||a.trf>0)rows.push({month:_ARCH_MN[m2-1],mk:mk2,rev:a.rev,exp:a.exp,trf:a.trf,net:a.net});}
    content=rows.length===0?'<div class="arch-empty-state"><div class="arch-empty-icon">&#x1F4EB;</div>No data</div>':
      '<div class="arch-tbl-wrap"><table><thead><tr><th>Month</th><th>Revenue</th><th>Expenses</th><th>Transfers</th><th>Net</th></tr></thead><tbody>'+
      rows.map(function(r){return '<tr onclick="archOpenModal(\''+r.mk+'\')" style="cursor:pointer"><td style="font-weight:700">'+r.month+'</td><td style="color:var(--green);font-weight:700">'+_archFmt(r.rev)+'</td><td style="color:var(--red);font-weight:700">'+_archFmt(r.exp)+'</td><td style="color:var(--amber);font-weight:700">'+_archFmt(r.trf)+'</td><td style="color:'+(r.net>=0?'var(--green)':'var(--red)')+';font-weight:700">'+(r.net>=0?'+':'')+_archFmt(r.net)+'</td></tr>';}).join('')+
      '</tbody></table></div>';
  }
  panel.innerHTML='<div class="arch-year-detail"><div class="arch-year-detail-hdr">'+
    '<div style="font-size:14px;font-weight:700">'+icons[type]+' '+titles[type]+' — '+_archSelYear+'</div>'+
    '<div style="display:flex;gap:8px"><button class="arch-print-btn" onclick="archPrintYearDetail()">&#x1F5A8; Print</button><button class="arch-back-btn" onclick="document.getElementById(\'archYearDetailPanel\').style.display=\'none\'">&#x2715; Close</button></div>'+
    '</div><div id="archYdContent">'+content+'</div></div>';
}

function archMkTbl(rows,headers,rowFn,summary) {
  if(!rows.length) return '<div class="arch-empty-state"><div class="arch-empty-icon">&#x1F4EB;</div>No records</div>';
  return (summary?'<div style="font-size:11px;color:var(--text3);margin-bottom:10px;padding:6px 10px;background:var(--card);border-radius:6px">'+summary+'</div>':'')+
    '<div class="arch-tbl-wrap"><table><thead><tr>'+headers.map(function(h){return '<th>'+h+'</th>';}).join('')+'</tr></thead><tbody>'+
    rows.map(function(r){return '<tr>'+rowFn(r)+'</tr>';}).join('')+'</tbody></table></div>';
}

function archRenderGrid() {
  var el=document.getElementById('archMonthGrid'); if(!el) return;
  var now=new Date();
  _archCurMK = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  var revArr=[];
  for(var m=1;m<=12;m++) revArr.push(archAgg(_archSelYear+'-'+String(m).padStart(2,'0')).rev);
  var maxR=Math.max.apply(null,revArr.concat([1]));
  var html='';
  for(var m=1;m<=12;m++){
    var mk=_archSelYear+'-'+String(m).padStart(2,'0');
    var a=archAgg(mk);
    var isFut=mk>_archCurMK, isCur=mk===_archCurMK, hasData=a.rev>0||a.exp>0||a.trf>0;
    var bw=hasData?Math.round(a.rev/maxR*100):0;
    var bc='arch-badge-future',bt='Future';
    if(isCur){bc='arch-badge-live';bt='Live';}else if(!isFut&&hasData){bc='arch-badge-done';bt='Done';}else if(!isFut&&!hasData){bc='arch-badge-empty';bt='No Data';}
    var cc=isFut?'future-month':(isCur?'current-month':(hasData?'has-data':''));
    html+='<div class="arch-month-card '+cc+'" onclick="archOpenModal(\''+mk+'\')">'+
      '<button class="arch-mc-add-btn" onclick="event.stopPropagation();archQuickAdd(\''+mk+'\')">+ Add</button>'+
      '<div class="arch-mc-header"><div class="arch-mc-name">'+_ARCH_MN[m-1]+'</div><div class="arch-mc-badge '+bc+'">'+bt+'</div></div>'+
      (hasData||isCur?
        '<div class="arch-mc-stat"><span class="arch-mc-stat-label">Revenue</span><span class="arch-mc-stat-val" style="color:var(--green)">'+_archFmt(a.rev)+'</span></div>'+
        '<div class="arch-mc-stat"><span class="arch-mc-stat-label">Expenses</span><span class="arch-mc-stat-val" style="color:var(--red)">'+_archFmt(a.exp)+'</span></div>'+
        '<div class="arch-mc-stat"><span class="arch-mc-stat-label">Transfers</span><span class="arch-mc-stat-val" style="color:var(--amber)">'+_archFmt(a.trf)+'</span></div>'+
        (a.pend>0?'<div class="arch-mc-stat"><span class="arch-mc-stat-label">Pending</span><span class="arch-mc-stat-val" style="color:var(--gold2)">'+_archFmt(a.pend)+'</span></div>':'')+
        '<div class="arch-mc-divider"></div>'+
        '<div class="arch-mc-net"><span style="color:var(--text2)">Net</span><span style="color:'+(a.net>=0?'var(--green)':'var(--red)')+'">'+(a.net>=0?'+':'')+_archFmt(a.net)+'</span></div>'+
        '<div class="arch-mc-bar"><div class="arch-mc-bar-fill" style="width:'+bw+'%;background:'+(a.net>=0?'var(--green)':'var(--red)')+'"></div></div>'
      :'<div class="arch-empty-state" style="padding:14px 0"><div style="font-size:18px;opacity:.3">&#x1F4EB;</div><div style="font-size:11px;margin-top:4px">'+(isFut?'Future':'No records')+'</div></div>')+
      '<div class="arch-mc-hint">Open details &#x2192;</div>'+
    '</div>';
  }
  el.innerHTML=html;
}

function archRenderTrend() {
  var canvas=document.getElementById('archTrendChart'); if(!canvas||typeof Chart==='undefined') return;
  var now=new Date(), yr=_archSelYear;
  var curKey=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  var MONTHS=[],revD=[],expD=[],trfD=[],pendD=[],netD=[],real=[];
  for(var i=0;i<12;i++){
    var k=yr+'-'+String(i+1).padStart(2,'0'), isPast=k<=curKey;
    var a=archAgg(k);
    MONTHS.push({label:_ARCH_MS[i],full:_ARCH_MN[i]+' '+yr,key:k});
    revD.push(isPast&&a.rev>0?a.rev:null);
    expD.push(isPast&&a.exp>0?a.exp:null);
    trfD.push(isPast&&a.trf>0?a.trf:null);
    pendD.push(isPast&&a.pend>0?a.pend:null);
    netD.push(isPast&&a.rev>0?a.net:null);
    real.push(isPast&&a.rev>0);
  }
  // Update badges for current month
  var curIdx=MONTHS.findIndex(function(m){return m.key===curKey;});
  var cR=curIdx>=0&&revD[curIdx]!=null?revD[curIdx]:0;
  var cE=curIdx>=0&&expD[curIdx]!=null?expD[curIdx]:0;
  var cT=curIdx>=0&&trfD[curIdx]!=null?trfD[curIdx]:0;
  var cN=cR-cE-cT;
  var sub=document.getElementById('archTrendSub'); if(sub) sub.textContent=MONTHS[0].label+' – '+MONTHS[MONTHS.length-1].label+' · 12-month view';
  var badges=document.getElementById('archTrendBadges');
  if(badges) badges.innerHTML=
    '<div class="arch-t-badge"><div class="arch-t-badge-label">Revenue</div><div class="arch-t-badge-val" style="color:var(--green)">'+_archFmt(cR)+'</div></div>'+
    '<div class="arch-t-badge"><div class="arch-t-badge-label">Expenses</div><div class="arch-t-badge-val" style="color:var(--red)">'+_archFmt(cE)+'</div></div>'+
    '<div class="arch-t-badge"><div class="arch-t-badge-label">Transfers</div><div class="arch-t-badge-val" style="color:var(--amber)">'+_archFmt(cT)+'</div></div>'+
    '<div class="arch-t-badge"><div class="arch-t-badge-label">Net</div><div class="arch-t-badge-val" style="color:'+(cN>=0?'var(--green)':'var(--red)')+'">'+(cN>=0?'+':'')+_archFmt(cN)+'</div></div>'; // FIX 12: explicit grouping — '+' sign now shows on positive Net values
  var plotRev=revD.map(function(v){return v!==null?v:0;});
  var ptColors=plotRev.map(function(v,i){if(!real[i])return 'rgba(0,230,118,0.15)';if(i===0)return '#00e676';var p=null;for(var j=i-1;j>=0;j--){if(real[j]){p=plotRev[j];break;}}return v>=(p||0)?'#00e676':'#ff4d6d';});
  var badge=document.getElementById('archHb');
  function showBadge(idx,x,y){
    var rev=revD[idx],exp2=expD[idx],trf=trfD[idx],pend=pendD[idx],net=netD[idx],isR=real[idx];
    badge.innerHTML='<div class="arch-hb-month">'+MONTHS[idx].full+(isR?'':'<span style="font-size:9px;color:#f0c040;background:rgba(240,192,64,0.12);border-radius:3px;padding:1px 5px;margin-left:5px">No Data</span>')+'</div>'+
    (isR?'<div class="arch-hb-row"><div class="arch-hb-left"><div class="arch-hb-dot" style="background:#00e676"></div>Revenue</div><span class="arch-hb-val">'+_archFmt(rev)+'</span></div>'+
    '<div class="arch-hb-row"><div class="arch-hb-left"><div class="arch-hb-dot" style="background:#ff4d6d"></div>Expenses</div><span class="arch-hb-val" style="color:#ff4d6d">'+_archFmt(exp2||0)+'</span></div>'+
    '<div class="arch-hb-row"><div class="arch-hb-left"><div class="arch-hb-dot" style="background:#ff8c42"></div>Transfers</div><span class="arch-hb-val" style="color:#ff8c42">'+_archFmt(trf||0)+'</span></div>'+
    '<div class="arch-hb-row"><div class="arch-hb-left"><div class="arch-hb-dot" style="background:#f0c040"></div>Pending</div><span class="arch-hb-val" style="color:#f0c040">'+_archFmt(pend||0)+'</span></div>'+
    '<hr class="arch-hb-divider"/>'+
    '<div class="arch-hb-net-row"><span>Net</span><span style="color:'+((net||0)>=0?'#00e676':'#ff4d6d')+'">'+((net||0)>=0?'+':'−')+_archFmt(net||0)+'</span></div>'
    :'<div style="color:var(--text3);font-size:12px;text-align:center;padding:8px 0">No data yet</div>');
    var wrap=document.querySelector('.arch-chart-wrap');
    if(!wrap) return;
    var ww=wrap.offsetWidth;
    var left=x+16; if(left+220>ww) left=x-226;
    var top=y-70; if(top<0) top=y+16;
    badge.style.left=left+'px'; badge.style.top=top+'px'; badge.style.display='block';
  }
  if(_archChartInst) { _archChartInst.destroy(); _archChartInst=null; }
  _archChartInst=new Chart(canvas.getContext('2d'),{
    type:'line',
    data:{
      labels:MONTHS.map(function(m){return m.label;}),
      datasets:[{
        data:plotRev,
        borderColor:function(c){var g=c.chart.ctx.createLinearGradient(0,0,c.chart.width,0);g.addColorStop(0,'#00e676');g.addColorStop(1,'rgba(0,230,118,0.3)');return g;},
        borderWidth:2.5,
        pointBackgroundColor:ptColors, pointBorderColor:ptColors,
        pointRadius:function(c){return real[c.dataIndex]?6:3;}, pointHoverRadius:9,
        tension:0.35, fill:false,
        datalabels:{
          display:function(c){return plotRev[c.dataIndex]>0;},
          anchor:'end',align:'top',offset:6,
          color:function(c){return ptColors[c.dataIndex];},
          backgroundColor:'#131f2e', borderColor:function(c){return ptColors[c.dataIndex];},
          borderWidth:1, borderRadius:4, padding:{top:3,bottom:3,left:7,right:7},
          font:{size:10,weight:'700'},
          formatter:function(v,c){
            var i=c.dataIndex; if(!real[i]) return '';
            var pv=null; for(var j=i-1;j>=0;j--){if(real[j]){pv=plotRev[j];break;}}
            if(pv===null) return 'PKR '+v.toLocaleString();
            var p=(((v-pv)/pv)*100).toFixed(1);
            return 'PKR '+v.toLocaleString()+'\n'+(parseFloat(p)>=0?'▲':'▼')+' '+Math.abs(p)+'%';
          }
        }
      }]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      layout:{padding:{top:50,right:10,left:4,bottom:0}},
      plugins:{legend:{display:false},tooltip:{enabled:false}},
      onHover:function(event,els){
        if(els.length>0){
          var wrap=document.querySelector('.arch-chart-wrap');
          var rect=wrap.getBoundingClientRect();
          var x=(event.native?event.native.clientX:event.x)-rect.left;
          var y=(event.native?event.native.clientY:event.y)-rect.top;
          showBadge(els[0].index,x,y);
        } else { badge.style.display='none'; }
      },
      scales:{
        x:{grid:{color:'rgba(255,255,255,0.03)'},border:{display:false},ticks:{color:'#4a6080',font:{size:11}}},
        y:{grid:{color:'rgba(255,255,255,0.03)'},border:{display:false},ticks:{color:'#4a6080',font:{size:11},callback:function(v){return v>=1000000?(v/1000000).toFixed(1)+'M':v>=1000?(v/1000).toFixed(0)+'k':v;}}}
      }
    }
  });
}

// ── ARCH MODAL ────────────────────────────────────────────────────────────────
function archOpenModal(mk) {
  _archMK=mk;
  var yr=mk.split('-')[0], mo=mk.split('-')[1];
  var mN=_ARCH_MN[parseInt(mo)-1], a=archAgg(mk);
  document.getElementById('archModalTitle').textContent=mN+' '+yr;
  document.getElementById('archModalSub').textContent=a.payList.length+' payments · '+a.expList.length+' expenses · '+a.trfList.length+' transfers · '+a.stuList.length+' students';
  document.getElementById('archModalSummary').innerHTML=
    '<div class="arch-ms-item" onclick="archSwitchTab(\'payments\')"><div class="arch-ms-label">Revenue</div><div class="arch-ms-val" style="color:var(--green)">'+_archFmt(a.rev)+'</div><div class="arch-ms-hint">&#x2192; Payments</div></div>'+
    '<div class="arch-ms-item" onclick="archSwitchTab(\'expenses\')"><div class="arch-ms-label">Expenses</div><div class="arch-ms-val" style="color:var(--red)">'+_archFmt(a.exp)+'</div><div class="arch-ms-hint">&#x2192; Expenses</div></div>'+
    '<div class="arch-ms-item" onclick="archSwitchTab(\'transfers\')"><div class="arch-ms-label">Transfers</div><div class="arch-ms-val" style="color:var(--amber)">'+_archFmt(a.trf)+'</div><div class="arch-ms-hint">&#x2192; Transfers</div></div>'+
    '<div class="arch-ms-item" onclick="archSwitchTab(\'payments\')"><div class="arch-ms-label">Pending</div><div class="arch-ms-val" style="color:var(--gold2)">'+_archFmt(a.pend)+'</div><div class="arch-ms-hint">&#x2192; Payments</div></div>'+
    '<div class="arch-ms-item" onclick="archSwitchTab(\'overview\')"><div class="arch-ms-label">Net</div><div class="arch-ms-val" style="color:'+(a.net>=0?'var(--green)':'var(--red)')+'">'+(a.net>=0?'+':'')+_archFmt(a.net)+'</div><div class="arch-ms-hint">&#x2192; Overview</div></div>';
  archSwitchTab('overview');
  document.getElementById('archModalOverlay').classList.remove('hidden');
}

function archCloseModal() { document.getElementById('archModalOverlay').classList.add('hidden'); }

function archSwitchTab(name) {
  _archTab=name;
  var names=['overview','payments','expenses','transfers','students'];
  document.querySelectorAll('.arch-tab-btn').forEach(function(b,i){b.classList.toggle('active',names[i]===name);});
  document.querySelectorAll('.arch-tab-panel').forEach(function(p){p.classList.remove('active');});
  document.getElementById('arch-tab-'+name).classList.add('active');
  archRefreshTab();
}

function archRefreshTab() {
  var a=archAgg(_archMK);
  document.getElementById('archModalSub').textContent=a.payList.length+' payments · '+a.expList.length+' expenses · '+a.trfList.length+' transfers · '+a.stuList.length+' students';
  if(_archTab==='overview') archRenderOv(a);
  if(_archTab==='payments') archRenderPay(a);
  if(_archTab==='expenses') archRenderExp(a);
  if(_archTab==='transfers') archRenderTrfTab(a);
  if(_archTab==='students') archRenderStu(a);
}

function archRenderOv(a) {
  var cr=a.pend+a.rev>0?Math.round(a.rev/(a.rev+a.pend)*100):(a.rev>0?100:0);
  var top=[].concat(a.expList).sort(function(x,y){return Number(y.amount)-Number(x.amount);}).slice(0,3);
  document.getElementById('arch-tab-overview').innerHTML=
    '<div class="arch-ov-grid">'+
      '<div class="arch-ov-card" onclick="archSwitchTab(\'payments\')"><div class="arch-ov-label">&#x1F4B0; Revenue</div><div class="arch-ov-val" style="color:var(--green)">'+_archFmt(a.rev)+'</div><div class="arch-ov-sub">'+a.payList.filter(function(p){return p.status==='Paid';}).length+' paid</div><div class="arch-ov-bar"><div class="arch-ov-bar-fill" style="width:'+cr+'%;background:var(--green)"></div></div></div>'+
      '<div class="arch-ov-card" onclick="archSwitchTab(\'payments\')"><div class="arch-ov-label">&#x23F3; Pending</div><div class="arch-ov-val" style="color:var(--gold2)">'+_archFmt(a.pend)+'</div><div class="arch-ov-sub">'+a.payList.filter(function(p){return p.status==='Pending';}).length+' unpaid</div><div class="arch-ov-bar"><div class="arch-ov-bar-fill" style="width:'+(100-cr)+'%;background:var(--gold2)"></div></div></div>'+
      '<div class="arch-ov-card" onclick="archSwitchTab(\'expenses\')"><div class="arch-ov-label">&#x1F4C9; Expenses</div><div class="arch-ov-val" style="color:var(--red)">'+_archFmt(a.exp)+'</div><div class="arch-ov-sub">'+a.expList.length+' records</div><div class="arch-ov-bar"><div class="arch-ov-bar-fill" style="width:'+(a.rev>0?Math.min(100,Math.round(a.exp/a.rev*100)):0)+'%;background:var(--red)"></div></div></div>'+
      '<div class="arch-ov-card" onclick="archSwitchTab(\'transfers\')"><div class="arch-ov-label">&#x1F3E6; Transfers</div><div class="arch-ov-val" style="color:var(--amber)">'+_archFmt(a.trf)+'</div><div class="arch-ov-sub">'+a.trfList.length+' records</div><div class="arch-ov-bar"><div class="arch-ov-bar-fill" style="width:'+(a.rev>0?Math.min(100,Math.round(a.trf/a.rev*100)):0)+'%;background:var(--amber)"></div></div></div>'+
    '</div>'+
    '<div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:14px">'+
      '<div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="font-size:12px;font-weight:700;color:var(--text2)">Collection Rate</span><span style="font-size:15px;font-weight:800;color:'+(cr>=80?'var(--green)':cr>=50?'var(--gold2)':'var(--red)')+'">'+cr+'%</span></div>'+
      '<div style="height:8px;background:rgba(255,255,255,0.05);border-radius:4px;overflow:hidden"><div style="height:100%;width:'+cr+'%;background:'+(cr>=80?'var(--green)':cr>=50?'var(--gold2)':'var(--red)')+';border-radius:4px"></div></div>'+
    '</div>'+
    (top.length?'<div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.7px;margin-bottom:10px">Top Expenses</div>'+
    top.map(function(e){return '<div onclick="archSwitchTab(\'expenses\')" style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:var(--bg);border-radius:8px;margin-bottom:6px;border:1px solid var(--border);cursor:pointer"><div><div style="font-size:12px;font-weight:600">'+escHtml(e.category||'Other')+'</div><div style="font-size:10px;color:var(--text3)">'+escHtml(e.description||'')+' · '+_archFmtD(e.date)+'</div></div><div style="color:var(--red);font-weight:700">'+_archFmt(e.amount)+'</div></div>';}).join(''):'');
}

function archRenderPay(a) {
  var tbl='<div class="arch-search-bar">'+
    '<input class="arch-search-inp" id="archPayS" placeholder="Search student, room..." oninput="archFlt(\'archPayT\',\'archPayS\')"/>'+
    '<button class="arch-filter-btn" onclick="archFltSt(\'archPayT\',\'all\')">All ('+a.payList.length+')</button>'+
    '<button class="arch-filter-btn" style="color:var(--green)" onclick="archFltSt(\'archPayT\',\'Paid\')">Paid ('+a.payList.filter(function(p){return p.status==='Paid';}).length+')</button>'+
    '<button class="arch-filter-btn" style="color:var(--gold2)" onclick="archFltSt(\'archPayT\',\'Pending\')">Pending ('+a.payList.filter(function(p){return p.status==='Pending';}).length+')</button>'+
    '<button class="arch-export-btn" onclick="archDoCSV(\'payments\')">&#x2B07; CSV</button>'+
    '<button class="arch-add-btn" onclick="archShowAddPayment()">&#x2795; Add</button>'+
  '</div>'+
  '<div class="arch-tbl-wrap"><table id="archPayT"><thead><tr><th>Student</th><th>Room</th><th>Amount</th><th>Method</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead><tbody>'+
  (a.payList.length===0?'<tr><td colspan="7"><div class="arch-empty-state"><div class="arch-empty-icon">&#x1F4B8;</div>No records</div></td></tr>':
  a.payList.map(function(p){return '<tr data-status="'+p.status+'">'+
    '<td style="font-weight:600;cursor:pointer;color:var(--blue)" onclick="showViewStudentModal(\''+p.studentId+'\')">'+escHtml(p.studentName||'--')+'</td>'+
    '<td style="color:var(--gold2);font-weight:700">#'+escHtml(String(p.roomNumber||'--'))+'</td>'+
    '<td style="color:'+(p.status==='Paid'?'var(--green)':'var(--gold2)')+';font-weight:700">'+_archFmt(p.amount)+'</td>'+
    '<td>'+escHtml(p.method||'--')+'</td>'+
    '<td><span class="badge '+(p.status==='Paid'?'badge-green':'badge-gold')+'">'+p.status+'</span></td>'+
    '<td style="color:var(--text3)">'+_archFmtD(p.date||p.dueDate)+'</td>'+
    '<td><div style="display:flex;gap:5px">'+
      '<button class="btn btn-secondary btn-sm" style="font-size:10px" onclick="showEditPaymentModal(\''+p.id+'\')">Edit</button>'+
      '<button class="btn btn-danger btn-sm" style="font-size:10px" onclick="archDelRecord(\'payment\',\''+p.id+'\')">Del</button>'+
    '</div></td></tr>';}).join(''))+
  '</tbody></table></div>';
  document.getElementById('arch-tab-payments').innerHTML=tbl;
}

function archRenderExp(a) {
  var catMap={};
  a.expList.forEach(function(e){catMap[e.category||'Other']=(catMap[e.category||'Other']||0)+Number(e.amount||0);});
  var tot=a.expList.reduce(function(s,e){return s+Number(e.amount||0);},0);
  var catBars=Object.entries(catMap).sort(function(x,y){return y[1]-x[1];}).slice(0,5).map(function(entry){
    var c=entry[0],v=entry[1],pct=tot>0?Math.round(v/tot*100):0;
    return '<div class="arch-cat-row" onclick="archFltCat(\''+escHtml(c)+'\')">'+
      '<div style="width:90px;font-size:11px;color:var(--text2);flex-shrink:0">'+escHtml(c)+'</div>'+
      '<div style="flex:1;height:6px;background:rgba(255,255,255,0.05);border-radius:3px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:var(--red);border-radius:3px"></div></div>'+
      '<div style="font-size:11px;font-weight:700;color:var(--red);width:90px;text-align:right">'+_archFmt(v)+'</div></div>';
  }).join('');
  document.getElementById('arch-tab-expenses').innerHTML=
    (catBars?'<div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:14px"><div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.7px;margin-bottom:10px">By Category — click to filter</div>'+catBars+'</div>':'')+
    '<div class="arch-search-bar"><input class="arch-search-inp" id="archExpS" placeholder="Search..." oninput="archFlt(\'archExpT\',\'archExpS\')"/>'+
    '<button class="arch-export-btn" onclick="archDoCSV(\'expenses\')">&#x2B07; CSV</button>'+
    '<button class="arch-add-btn" onclick="archShowAddExpense()">&#x2795; Add</button></div>'+
    '<div class="arch-tbl-wrap"><table id="archExpT"><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Actions</th></tr></thead><tbody>'+
    (a.expList.length===0?'<tr><td colspan="5"><div class="arch-empty-state"><div class="arch-empty-icon">&#x1F9FE;</div>No records</div></td></tr>':
    a.expList.map(function(e){return '<tr>'+
      '<td style="color:var(--text3)">'+_archFmtD(e.date)+'</td>'+
      '<td><span class="badge badge-amber">'+escHtml(e.category||'--')+'</span></td>'+
      '<td>'+escHtml(e.description||'--')+'</td>'+
      '<td style="color:var(--red);font-weight:700">'+_archFmt(e.amount)+'</td>'+
      '<td><div style="display:flex;gap:5px">'+
        '<button class="btn btn-secondary btn-sm" style="font-size:10px" onclick="showEditExpenseModal(\''+e.id+'\')">Edit</button>'+
        '<button class="btn btn-danger btn-sm" style="font-size:10px" onclick="archDelRecord(\'expense\',\''+e.id+'\')">Del</button>'+
      '</div></td></tr>';}).join(''))+
    '</tbody></table></div>';
}

function archRenderTrfTab(a) {
  document.getElementById('arch-tab-transfers').innerHTML=
    '<div class="arch-search-bar"><input class="arch-search-inp" id="archTrfS" placeholder="Search..." oninput="archFlt(\'archTrfT\',\'archTrfS\')"/>'+
    '<button class="arch-export-btn" onclick="archDoCSV(\'transfers\')">&#x2B07; CSV</button>'+
    '<button class="arch-add-btn" onclick="archShowAddTransfer()">&#x2795; Add</button></div>'+
    '<div class="arch-tbl-wrap"><table id="archTrfT"><thead><tr><th>Date</th><th>Description</th><th>Method</th><th>Received By</th><th>Amount</th><th>Actions</th></tr></thead><tbody>'+
    (a.trfList.length===0?'<tr><td colspan="6"><div class="arch-empty-state"><div class="arch-empty-icon">&#x1F504;</div>No records</div></td></tr>':
    a.trfList.map(function(t){return '<tr>'+
      '<td style="color:var(--text3)">'+_archFmtD(t.date)+'</td>'+
      '<td>'+escHtml(t.description||t.note||'--')+'</td>'+
      '<td><span class="badge badge-blue">'+escHtml(t.method||'--')+'</span></td>'+
      '<td>'+escHtml(t.receivedBy||'--')+'</td>'+
      '<td style="color:var(--amber);font-weight:700">'+_archFmt(t.amount)+'</td>'+
      '<td><div style="display:flex;gap:5px">'+
        '<button class="btn btn-secondary btn-sm" style="font-size:10px" onclick="showEditTransferModal(\''+t.id+'\')">Edit</button>'+
        '<button class="btn btn-danger btn-sm" style="font-size:10px" onclick="archDelRecord(\'transfer\',\''+t.id+'\')">Del</button>'+
      '</div></td></tr>';}).join(''))+
    '</tbody></table></div>';
}

function archRenderStu(a) {
  document.getElementById('arch-tab-students').innerHTML=
    '<div class="arch-search-bar"><input class="arch-search-inp" id="archStuS" placeholder="Search name, room..." oninput="archFltStu()"/>'+
    '<span style="font-size:11px;color:var(--text3)">'+a.stuList.length+' active students</span></div>'+
    '<div class="arch-stu-grid" id="archStuG">'+
    (a.stuList.length===0?'<div class="arch-empty-state" style="grid-column:1/-1"><div class="arch-empty-icon">&#x1F465;</div>No students</div>':
    a.stuList.map(function(s){return '<div class="arch-stu-card" data-n="'+escHtml((s.name||'').toLowerCase())+'" data-r="'+String(s.roomNumber||'').toLowerCase()+'" onclick="showViewStudentModal(\''+s.id+'\')">'+
      '<div class="arch-stu-av">'+(s.name||'?')[0].toUpperCase()+'</div>'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+escHtml(s.name||'--')+'</div>'+
        '<div style="font-size:10px;color:var(--text3)">Rm #'+escHtml(String(s.roomNumber||'--'))+'</div>'+
        '<div style="font-size:11px;font-weight:700;color:var(--green)">'+_archFmt(s.rent||0)+'/mo</div>'+
      '</div></div>';}).join(''))+
    '</div>';
}

// ── ARCH FILTER HELPERS ───────────────────────────────────────────────────────
function archFlt(tId,iId){var q=document.getElementById(iId).value.toLowerCase();document.querySelectorAll('#'+tId+' tbody tr').forEach(function(r){r.style.display=r.textContent.toLowerCase().includes(q)?'':'none';});}
function archFltSt(tId,st){document.querySelectorAll('#'+tId+' tbody tr').forEach(function(r){r.style.display=(st==='all'||r.dataset.status===st)?'':'none';});}
function archFltCat(cat){document.querySelectorAll('#archExpT tbody tr').forEach(function(r){r.style.display=r.textContent.includes(cat)?'':'none';});var i=document.getElementById('archExpS');if(i)i.value=cat;}
function archFltStu(){var q=document.getElementById('archStuS').value.toLowerCase();document.querySelectorAll('#archStuG .arch-stu-card').forEach(function(e){e.style.display=((e.dataset.n||'').includes(q)||(e.dataset.r||'').includes(q))?'':'none';});}

// ── ARCH ADD MENU ─────────────────────────────────────────────────────────────
function archShowAddMenu() {
  var mo=parseInt(_archMK.split('-')[1])-1, yr=_archMK.split('-')[0];
  document.getElementById('archEditTitle').innerHTML='Add Data to '+_ARCH_MN[mo]+' '+yr+' <button class="arch-edit-close" onclick="archCloseEdit()">&#x2715;</button>';
  document.getElementById('archEditForm').innerHTML=
    '<p style="font-size:12px;color:var(--text3);margin-bottom:16px;">What do you want to add?</p>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'+
    '<button onclick="archShowAddPayment()" style="padding:14px;border-radius:10px;border:1px solid rgba(46,201,138,0.3);background:rgba(46,201,138,0.1);color:var(--green);font-size:13px;font-weight:700;cursor:pointer;">&#x1F4B0; Payment</button>'+
    '<button onclick="archShowAddExpense()" style="padding:14px;border-radius:10px;border:1px solid rgba(224,82,82,0.3);background:rgba(224,82,82,0.1);color:var(--red);font-size:13px;font-weight:700;cursor:pointer;">&#x1F4C9; Expense</button>'+
    '<button onclick="archShowAddTransfer()" style="padding:14px;border-radius:10px;border:1px solid rgba(255,140,66,0.3);background:rgba(255,140,66,0.1);color:var(--amber);font-size:13px;font-weight:700;cursor:pointer;">&#x1F3E6; Transfer</button>'+
    '<button onclick="archCloseEdit()" style="padding:14px;border-radius:10px;border:1px solid var(--border2);background:transparent;color:var(--text2);font-size:13px;font-weight:700;cursor:pointer;">Cancel</button>'+
    '</div>';
  document.getElementById('archEditOverlay').classList.remove('hidden');
}

function archShowAddPayment() {
  var students=(DB.students||[]).filter(function(s){return s.status==='Active';});
  var methods=(DB.settings&&DB.settings.paymentMethods)||['Cash','JazzCash','EasyPaisa','Bank Transfer'];
  var mo=parseInt(_archMK.split('-')[1])-1, yr=_archMK.split('-')[0];
  document.getElementById('archEditTitle').innerHTML='&#x1F4B0; Add Payment <button class="arch-edit-close" onclick="archCloseEdit()">&#x2715;</button>';
  document.getElementById('archEditForm').innerHTML=
    '<div class="form-row" style="margin-bottom:12px"><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:5px">Student</label>'+
    '<select class="form-control" id="archFStu" onchange="archFillRent()">'+
    '<option value="">-- select student --</option>'+
    students.map(function(s){var r=(DB.rooms||[]).find(function(r){return r.id===s.roomId;});return '<option value="'+s.id+'" data-rent="'+(s.rent||0)+'">'+escHtml(s.name)+' (Rm '+(r?r.number:'?')+')</option>';}).join('')+
    '</select></div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">'+
    '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:5px">Amount (PKR)</label><input class="form-control" type="number" id="archFAmt" placeholder="16000"/></div>'+
    '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:5px">Status</label><select class="form-control" id="archFStatus"><option>Paid</option><option>Pending</option></select></div>'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">'+
    '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:5px">Method</label><select class="form-control" id="archFMethod">'+methods.map(function(m){return '<option>'+m+'</option>';}).join('')+'</select></div>'+
    '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:5px">Date</label><input class="form-control cdp-trigger" type="text" readonly onclick="showCustomDatePicker(this,event)" id="archFDate" value="'+_archMK+'-01"/></div>'+
    '</div>'+
    '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:5px">Month Label</label><input class="form-control" type="text" id="archFMonth" value="'+_ARCH_MN[mo]+' '+yr+'"/></div>'+
    '<button class="btn btn-primary" style="width:100%" onclick="archSavePayment()">&#x2713; Save Payment</button>';
}

function archFillRent(){var sel=document.getElementById('archFStu');var opt=sel.options[sel.selectedIndex];if(opt&&opt.dataset.rent)document.getElementById('archFAmt').value=opt.dataset.rent;}

function archSavePayment(){
  var stuId=document.getElementById('archFStu').value; if(!stuId){alert('Select a student');return;}
  var stu=(DB.students||[]).find(function(s){return s.id===stuId;}); var rm=(DB.rooms||[]).find(function(r){return r.id===stu.roomId;});
  var amt=Number(document.getElementById('archFAmt').value||0); var status=document.getElementById('archFStatus').value;
  var pay={id:'pay_'+uid(),studentId:stuId,studentName:stu.name||'',roomId:stu.roomId||'',roomNumber:rm?rm.number:'',amount:amt,monthlyRent:stu.rent||amt,unpaid:status==='Pending'?amt:0,method:document.getElementById('archFMethod').value,month:document.getElementById('archFMonth').value,date:document.getElementById('archFDate').value,dueDate:document.getElementById('archFDate').value,paidDate:status==='Paid'?document.getElementById('archFDate').value:'',status:status,createdAt:new Date().toISOString()};
  if(!DB.payments)DB.payments=[];DB.payments.push(pay);saveDB();archCloseEdit();archRefreshTab();archRenderPage();archSwitchTab('payments');
}

function archShowAddExpense(){
  var cats=(DB.settings&&DB.settings.expenseCategories)||['Electricity','Water','Gas','Maintenance','Cleaning','Other'];
  document.getElementById('archEditTitle').innerHTML='&#x1F4C9; Add Expense <button class="arch-edit-close" onclick="archCloseEdit()">&#x2715;</button>';
  document.getElementById('archEditForm').innerHTML=
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">'+
    '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:5px">Category</label><select class="form-control" id="archFCat">'+cats.map(function(c){return '<option>'+c+'</option>';}).join('')+'</select></div>'+
    '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:5px">Amount (PKR)</label><input class="form-control" type="number" id="archFAmt" placeholder="5000"/></div>'+
    '</div>'+
    '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:5px">Description</label><input class="form-control" type="text" id="archFDesc" placeholder="e.g. Electricity bill"/></div>'+
    '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:5px">Date</label><input class="form-control cdp-trigger" type="text" readonly onclick="showCustomDatePicker(this,event)" id="archFDate" value="'+_archMK+'-01"/></div>'+
    '<button class="btn btn-primary" style="width:100%" onclick="archSaveExpense()">&#x2713; Save Expense</button>';
}

function archSaveExpense(){
  var exp={id:'exp_'+uid(),category:document.getElementById('archFCat').value,description:document.getElementById('archFDesc').value,amount:Number(document.getElementById('archFAmt').value||0),date:document.getElementById('archFDate').value,createdAt:new Date().toISOString()};
  if(!DB.expenses)DB.expenses=[];DB.expenses.push(exp);saveDB();archCloseEdit();archRefreshTab();archRenderPage();archSwitchTab('expenses');
}

function archShowAddTransfer(){
  var methods=(DB.settings&&DB.settings.paymentMethods)||['Cash','JazzCash','EasyPaisa','Bank Transfer'];
  document.getElementById('archEditTitle').innerHTML='&#x1F3E6; Add Transfer <button class="arch-edit-close" onclick="archCloseEdit()">&#x2715;</button>';
  document.getElementById('archEditForm').innerHTML=
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">'+
    '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:5px">Amount (PKR)</label><input class="form-control" type="number" id="archFAmt" placeholder="10000"/></div>'+
    '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:5px">Method</label><select class="form-control" id="archFMethod">'+methods.map(function(m){return '<option>'+m+'</option>';}).join('')+'</select></div>'+
    '</div>'+
    '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:5px">Description</label><input class="form-control" type="text" id="archFDesc" placeholder="Monthly owner transfer"/></div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">'+
    '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:5px">Received By</label><input class="form-control" type="text" id="archFRecv" placeholder="Owner name"/></div>'+
    '<div><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:5px">Date</label><input class="form-control cdp-trigger" type="text" readonly onclick="showCustomDatePicker(this,event)" id="archFDate" value="'+_archMK+'-01"/></div>'+
    '</div>'+
    '<button class="btn btn-primary" style="width:100%" onclick="archSaveTransfer()">&#x2713; Save Transfer</button>';
}

function archSaveTransfer(){
  var trf={id:'trf_'+uid(),amount:Number(document.getElementById('archFAmt').value||0),method:document.getElementById('archFMethod').value,description:document.getElementById('archFDesc').value,receivedBy:document.getElementById('archFRecv').value,date:document.getElementById('archFDate').value,createdAt:new Date().toISOString()};
  if(!DB.transfers)DB.transfers=[];DB.transfers.push(trf);saveDB();archCloseEdit();archRefreshTab();archRenderPage();archSwitchTab('transfers');
}

function archDelRecord(type,id){
  // FIX 20: replaced blocking native confirm() with in-app showConfirm modal
  showConfirm('Delete Record', 'Delete this record? This cannot be undone.', function() {
    if(type==='payment') DB.payments=(DB.payments||[]).filter(function(x){return x.id!==id;});
    if(type==='expense') DB.expenses=(DB.expenses||[]).filter(function(x){return x.id!==id;});
    if(type==='transfer') DB.transfers=(DB.transfers||[]).filter(function(x){return x.id!==id;});
    saveDB();archRefreshTab();archRenderPage();
  });
}

function archCloseEdit(){document.getElementById('archEditOverlay').classList.add('hidden');}
function archQuickAdd(mk){_archMK=mk;archOpenModal(mk);setTimeout(function(){archShowAddMenu();},300);}
function archPrintCurrentTab(){archPrintTab(_archTab);}

function archDoCSV(type){
  var a=archAgg(_archMK); var mo=parseInt(_archMK.split('-')[1])-1, yr=_archMK.split('-')[0];
  var mN=_ARCH_MN[mo]; var csv='',fn='';
  if(type==='payments'){fn='Payments_'+mN+'_'+yr+'.csv';csv='Student,Room,Month,Amount,Method,Status,Date\n';a.payList.forEach(function(p){csv+='"'+(p.studentName||'')+'","'+(p.roomNumber||'')+'","'+(p.month||'')+'",'+p.amount+',"'+(p.method||'')+'","'+p.status+'","'+(p.date||p.dueDate||'')+'"\n';});}
  else if(type==='expenses'){fn='Expenses_'+mN+'_'+yr+'.csv';csv='Date,Category,Description,Amount\n';a.expList.forEach(function(e){csv+='"'+e.date+'","'+(e.category||'')+'","'+(e.description||'')+'",'+e.amount+'\n';});}
  else if(type==='transfers'){fn='Transfers_'+mN+'_'+yr+'.csv';csv='Date,Description,Method,Received By,Amount\n';a.trfList.forEach(function(t){csv+='"'+t.date+'","'+(t.description||t.note||'')+'","'+(t.method||'')+'","'+(t.receivedBy||'')+'",'+t.amount+'\n';});}
  var blob=new Blob([csv],{type:'text/csv'});
  var a2=document.createElement('a');a2.href=URL.createObjectURL(blob);a2.download=fn;a2.click();
  setTimeout(function(){URL.revokeObjectURL(a2.href);},1500); // FIX 19: revoke blob URL
}

function archPrintTab(tab){
  var a=archAgg(_archMK); var mo=parseInt(_archMK.split('-')[1])-1, yr=_archMK.split('-')[0];
  var mN=_ARCH_MN[mo]; var hostel=(DB.settings&&DB.settings.hostelName)||'DAMAM Boys Hostel';
  var titles={overview:'Monthly Overview',payments:'Payments',expenses:'Expenses',transfers:'Transfers',students:'Active Students'};
  var body='';
  if(tab==='payments'){var tot=a.payList.reduce(function(s,p){return s+Number(p.amount||0);},0);body='<table><thead><tr><th>Student</th><th>Room</th><th>Month</th><th>Amount</th><th>Method</th><th>Status</th><th>Date</th></tr></thead><tbody>'+a.payList.map(function(p){return '<tr><td>'+escHtml(p.studentName||'--')+'</td><td>#'+escHtml(String(p.roomNumber||'--'))+'</td><td>'+escHtml(p.month||'--')+'</td><td>'+_archFmt(p.amount)+'</td><td>'+escHtml(p.method||'--')+'</td><td>'+p.status+'</td><td>'+_archFmtD(p.date||p.dueDate)+'</td></tr>';}).join('')+'</tbody><tfoot><tr><td colspan="3">Total</td><td>'+_archFmt(tot)+'</td><td colspan="3"></td></tr></tfoot></table>';}
  else if(tab==='expenses'){var tot2=a.expList.reduce(function(s,e){return s+Number(e.amount||0);},0);body='<table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th></tr></thead><tbody>'+a.expList.map(function(e){return '<tr><td>'+_archFmtD(e.date)+'</td><td>'+escHtml(e.category||'--')+'</td><td>'+escHtml(e.description||'--')+'</td><td>'+_archFmt(e.amount)+'</td></tr>';}).join('')+'</tbody><tfoot><tr><td colspan="3">Total</td><td>'+_archFmt(tot2)+'</td></tr></tfoot></table>';}
  else if(tab==='transfers'){var tot3=a.trfList.reduce(function(s,t){return s+Number(t.amount||0);},0);body='<table><thead><tr><th>Date</th><th>Description</th><th>Method</th><th>Received By</th><th>Amount</th></tr></thead><tbody>'+a.trfList.map(function(t){return '<tr><td>'+_archFmtD(t.date)+'</td><td>'+escHtml(t.description||t.note||'--')+'</td><td>'+escHtml(t.method||'--')+'</td><td>'+escHtml(t.receivedBy||'--')+'</td><td>'+_archFmt(t.amount)+'</td></tr>';}).join('')+'</tbody><tfoot><tr><td colspan="4">Total</td><td>'+_archFmt(tot3)+'</td></tr></tfoot></table>';}
  else if(tab==='students'){body='<table><thead><tr><th>#</th><th>Name</th><th>Father Name</th><th>Room</th><th>Phone</th><th>Rent</th></tr></thead><tbody>'+a.stuList.map(function(s,i){return '<tr><td>'+(i+1)+'</td><td>'+escHtml(s.name||'--')+'</td><td>'+escHtml(s.fatherName||'--')+'</td><td>#'+escHtml(String(s.roomNumber||'--'))+'</td><td>'+escHtml(s.phone||'--')+'</td><td>'+_archFmt(s.rent||0)+'</td></tr>';}).join('')+'</tbody></table>';}
  var w=window.open('','_blank','width=960,height=720'); if(!w){alert('Allow popups');return;}
  var _archHtml = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>'+escHtml(titles[tab]||tab)+' — '+mN+' '+yr+'</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:"Segoe UI",sans-serif;color:#111;background:#fff;padding:28px;font-size:12px}.hdr{display:flex;justify-content:space-between;border-bottom:3px solid #c8a84b;padding-bottom:14px;margin-bottom:18px}.hn{font-size:18px;font-weight:900;color:#0f1a2e}table{width:100%;border-collapse:collapse;margin-bottom:20px}th{background:#f1f5f9;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;color:#64748b;font-weight:700;border-bottom:1px solid #e2e8f0}td{padding:7px 10px;border-bottom:1px solid #f1f5f9}tfoot td{background:#f1f5f9;font-weight:700}</style></head><body>'
    +'<div class="hdr"><div><div class="hn">'+escHtml(hostel)+'</div><div style="font-size:13px;font-weight:700;margin-top:6px">'+escHtml(titles[tab]||tab)+' — '+mN+' '+yr+'</div></div><div style="font-size:10px;color:#888">'+new Date().toLocaleDateString('en-PK',{day:'2-digit',month:'long',year:'numeric'})+'</div></div>'
    +body+'</body></html>';
  _electronPDF(_archHtml, hostel.replace(/\s+/g,'-').replace(/[^a-zA-Z0-9\-]/g,'')+'_'+mN+'-'+yr+'_'+(tab||'report')+'.pdf', {pageSize:'A4'});
}

function archPrintYearDetail(){
  var c=document.getElementById('archYdContent'); if(!c) return;
  var hostel=(DB.settings&&DB.settings.hostelName)||'DAMAM Hostel';
  var w=window.open('','_blank','width=960,height=720'); if(!w){alert('Allow popups');return;}
  var _annHtml = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Annual Report '+_archSelYear+'</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:"Segoe UI",sans-serif;color:#111;background:#fff;padding:28px;font-size:12px}table{width:100%;border-collapse:collapse}th{background:#f1f5f9;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;color:#64748b;font-weight:700;border-bottom:1px solid #e2e8f0}td{padding:7px 10px;border-bottom:1px solid #f1f5f9}</style></head><body>'
    +'<h2 style="margin-bottom:16px;font-size:18px;font-weight:900;color:#0f1a2e">'+escHtml(hostel)+' — Annual Report '+_archSelYear+'</h2>'
    +c.innerHTML+'</body></html>';
  _electronPDF(_annHtml, hostel.replace(/\s+/g,'-').replace(/[^a-zA-Z0-9\-]/g,'')+'_Annual-Report_'+_archSelYear+'.pdf', {pageSize:'A4', landscape:true});
}

// Hook renderPage to call archAfterRender when archive page is shown
(function(){
  var _origRenderPage = renderPage;
  renderPage = function(p, resetScroll) {
    _origRenderPage(p, resetScroll);
    if(p === 'archive') {
      setTimeout(archAfterRender, 120);
    }
  };
})();
