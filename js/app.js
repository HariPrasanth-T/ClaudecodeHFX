/* HSE Certificate Tracker - Main App
 * Vanilla JS module. Uses IndexedDB for storage (handles file Blobs).
 */

// ============================================================
// CONSTANTS
// ============================================================
const DEFAULT_COURSES = [
  'ESR',
  'First Aid',
  'Initial Fire Response',
  'HSE Induction',
  'Risk Assessment',
  'HSE Management',
  'Scaffolding Awareness',
  'Lorry Loader Operator',
  'Working at Heights',
  'Confined Space',
  'Permit to Work',
  'Banksman / Flagman',
  'H2S Awareness',
  'Defensive Driving',
];

const DEFAULT_MEDICAL_TYPES = [
  'Annual Fitness',
  'Pre-Employment',
  'Periodic Medical',
  'Food Handler',
  'Confined Space Medical',
  'Driver Medical',
  'Working at Heights Medical',
  'COVID / Vaccination',
  'Eye Test',
  'Hearing Test',
  'Other',
];

const DOC_TYPES = ['Resident ID', 'Passport', 'Driving License', 'CEP', 'DCRP', 'Insurance', 'Other'];

const VEHICLE_FIELDS = [
  { key: 'plate', label: 'Plate / Reg. No', required: true },
  { key: 'make', label: 'Make' },
  { key: 'model', label: 'Model' },
  { key: 'year', label: 'Year' },
  { key: 'color', label: 'Color' },
  { key: 'chassis', label: 'Chassis No.' },
  { key: 'user', label: 'Assigned User' },
];

const ALERT_THRESHOLDS = [45, 30, 15, 10, 5, 3, 1, 0];

// ============================================================
// INDEXEDDB
// ============================================================
const DB_NAME = 'hse-tracker';
const DB_VERSION = 1;
const STORES = ['personnel', 'documents', 'vehicles', 'history', 'files', 'meta', 'expiryIndex', 'firedAlerts'];

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('personnel')) db.createObjectStore('personnel', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('vehicles')) db.createObjectStore('vehicles', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('expiryIndex')) db.createObjectStore('expiryIndex', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('firedAlerts')) db.createObjectStore('firedAlerts', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let DB;

const dbApi = {
  async put(store, val) {
    return new Promise((resolve, reject) => {
      const tx = DB.transaction(store, 'readwrite');
      tx.objectStore(store).put(val);
      tx.oncomplete = () => resolve(val);
      tx.onerror = () => reject(tx.error);
    });
  },
  async get(store, key) {
    return new Promise((resolve, reject) => {
      const tx = DB.transaction(store, 'readonly');
      const r = tx.objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  },
  async del(store, key) {
    return new Promise((resolve, reject) => {
      const tx = DB.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
  async all(store) {
    return new Promise((resolve, reject) => {
      const tx = DB.transaction(store, 'readonly');
      const r = tx.objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
  },
  async clearAll() {
    for (const s of STORES) {
      await new Promise((resolve, reject) => {
        const tx = DB.transaction(s, 'readwrite');
        tx.objectStore(s).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
  }
};

// ============================================================
// UTILITIES
// ============================================================
const uid = () => 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

function fmtDate(d) {
  if (!d) return '—';
  const dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}
function isoDate(d) {
  if (!d) return '';
  const dt = (d instanceof Date) ? d : new Date(d);
  if (isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  const ms = (new Date(b).setHours(0,0,0,0)) - (new Date(a).setHours(0,0,0,0));
  return Math.round(ms / (1000*60*60*24));
}
function daysUntil(d) {
  if (!d) return null;
  return daysBetween(new Date(), d);
}
function addPeriod(startISO, period) {
  // period like '1y','2y','3y','6m','90d'
  const m = (''+period).trim().match(/^(\d+)\s*([dDmMyY])$/);
  if (!m || !startISO) return '';
  const n = parseInt(m[1], 10);
  const u = m[2].toLowerCase();
  const d = new Date(startISO);
  if (u === 'y') d.setFullYear(d.getFullYear() + n);
  else if (u === 'm') d.setMonth(d.getMonth() + n);
  else d.setDate(d.getDate() + n);
  return isoDate(d);
}
function statusOf(expiryISO) {
  if (!expiryISO) return { kind: 'unknown', label: '—', tag: 'muted' };
  const d = daysUntil(expiryISO);
  if (d < 0) return { kind: 'expired', label: `Expired ${-d}d`, tag: 'expired' };
  if (d <= 30) return { kind: 'soon', label: `${d}d left`, tag: 'soon' };
  return { kind: 'ok', label: `${d}d left`, tag: 'ok' };
}
function escapeHtml(s) {
  return (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0]||'') + (parts[1]?.[0]||'')).toUpperCase();
}

function toast(msg, kind = '') {
  const wrap = $('#toastWrap');
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 3000);
}

// ============================================================
// STATE
// ============================================================
const state = {
  personnel: [],
  documents: [],
  vehicles: [],
  history: [],
  meta: {},
  courseCatalog: [...DEFAULT_COURSES],
  medicalTypes: [...DEFAULT_MEDICAL_TYPES],
  notifEnabled: false,
};

async function loadState() {
  const [p, d, v, h, m] = await Promise.all([
    dbApi.all('personnel'),
    dbApi.all('documents'),
    dbApi.all('vehicles'),
    dbApi.all('history'),
    dbApi.all('meta'),
  ]);
  state.personnel = p;
  state.documents = d;
  state.vehicles = v;
  state.history = h;
  state.meta = Object.fromEntries(m.map(x => [x.key, x.value]));
  state.courseCatalog = state.meta.courseCatalog || [...DEFAULT_COURSES];
  state.medicalTypes = state.meta.medicalTypes || [...DEFAULT_MEDICAL_TYPES];
  state.notifEnabled = !!state.meta.notifEnabled;
}

async function saveMeta(key, value) {
  state.meta[key] = value;
  await dbApi.put('meta', { key, value });
}

// ============================================================
// FILES (Blobs in IndexedDB)
// ============================================================
async function saveFile(file) {
  if (!file) return null;
  const id = uid();
  await dbApi.put('files', { id, name: file.name, type: file.type, size: file.size, blob: file });
  return { id, name: file.name, type: file.type, size: file.size };
}
async function getFile(id) {
  if (!id) return null;
  return dbApi.get('files', id);
}
async function deleteFile(id) {
  if (!id) return;
  return dbApi.del('files', id);
}

function buildFileURL(rec) {
  if (!rec) return '';
  return URL.createObjectURL(rec.blob);
}

// ============================================================
// EXPIRY INDEX (flat list of expiries, used for alerts)
// ============================================================
async function rebuildExpiryIndex() {
  // Clear index
  const tx = DB.transaction('expiryIndex', 'readwrite');
  tx.objectStore('expiryIndex').clear();
  await new Promise(r => tx.oncomplete = r);

  const items = collectAllExpiries();
  for (const it of items) {
    await dbApi.put('expiryIndex', it);
  }
}

function collectAllExpiries() {
  const out = [];
  for (const p of state.personnel) {
    for (const c of (p.courses || [])) {
      if (c.expiry) out.push({
        id: `course:${p.id}:${c.id}`, kind: 'course',
        title: `${c.name} — ${p.name}`,
        subtitle: p.civilId ? `Civil ID: ${p.civilId}` : '',
        expiry: c.expiry, refType: 'personnel', refId: p.id,
      });
    }
    for (const med of (p.medicals || [])) {
      if (med.expiry) out.push({
        id: `medical:${p.id}:${med.id}`, kind: 'medical',
        title: `Medical (${med.type}) — ${p.name}`,
        subtitle: med.notes || '', expiry: med.expiry,
        refType: 'personnel', refId: p.id,
      });
    }
  }
  for (const d of state.documents) {
    if (d.expiry) out.push({
      id: `document:${d.id}`, kind: 'document',
      title: `${d.docType}${d.number?' #'+d.number:''} — ${d.holder||''}`,
      subtitle: d.notes || '', expiry: d.expiry,
      refType: 'documents', refId: d.id,
    });
  }
  for (const v of state.vehicles) {
    for (const r of (v.records || [])) {
      if (r.expiry) out.push({
        id: `vehicle:${v.id}:${r.id}`, kind: 'vehicle',
        title: `${r.kind} — ${v.plate}`,
        subtitle: v.user ? `User: ${v.user}` : '', expiry: r.expiry,
        refType: 'vehicles', refId: v.id,
      });
    }
  }
  return out;
}

// ============================================================
// NOTIFICATIONS
// ============================================================
async function checkExpiryAlerts(showToasts = true) {
  if (!state.notifEnabled) return [];
  const items = collectAllExpiries();
  const fired = await dbApi.all('firedAlerts');
  const firedMap = new Map(fired.map(f => [f.key, f.t]));
  const alerts = [];
  for (const it of items) {
    const d = daysUntil(it.expiry);
    if (d == null) continue;
    if (ALERT_THRESHOLDS.includes(d) || d < 0) {
      const key = `${it.id}:${d}`;
      if (!firedMap.has(key)) {
        alerts.push({ ...it, daysLeft: d, key });
      }
    }
  }
  for (const a of alerts) {
    await dbApi.put('firedAlerts', { key: a.key, t: Date.now() });
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const title = a.daysLeft <= 0 ? `Expired: ${a.title}` : `Expires in ${a.daysLeft} day${a.daysLeft===1?'':'s'}: ${a.title}`;
        const opts = { body: a.subtitle || '', tag: a.key, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' };
        if (reg) reg.showNotification(title, opts);
        else new Notification(title, opts);
      } catch (e) {/* ignore */}
    }
    if (showToasts) {
      const kind = a.daysLeft <= 0 ? 'error' : (a.daysLeft <= 5 ? 'error' : 'warn');
      toast(`${a.daysLeft <= 0 ? 'Expired' : a.daysLeft + 'd left'}: ${a.title}`, kind);
    }
  }
  return alerts;
}

async function requestNotificationPerm() {
  if (!('Notification' in window)) {
    toast('Notifications not supported in this browser', 'warn');
    return false;
  }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    state.notifEnabled = true;
    await saveMeta('notifEnabled', true);
    toast('Notifications enabled', 'success');
    // attempt periodic background sync if available
    try {
      const reg = await navigator.serviceWorker.ready;
      if ('periodicSync' in reg) {
        const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
        if (status.state === 'granted') {
          await reg.periodicSync.register('expiry-check', { minInterval: 12 * 60 * 60 * 1000 });
        }
      }
    } catch (e) { /* ignore */ }
    return true;
  } else {
    toast('Notifications denied', 'warn');
    return false;
  }
}

// ============================================================
// ROUTING / NAV
// ============================================================
function route() {
  const hash = (location.hash || '#dashboard').slice(1).split('?')[0];
  const valid = ['dashboard', 'personnel', 'medical', 'documents', 'vehicles', 'history', 'alerts', 'settings'];
  const view = valid.includes(hash) ? hash : 'dashboard';
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  $$('.nav-link').forEach(a => a.classList.toggle('active', a.dataset.view === view));
  if (window.innerWidth <= 800) $('#sidebar').classList.remove('open');
  renderView(view);
}

function renderView(view) {
  switch (view) {
    case 'dashboard': renderDashboard(); break;
    case 'personnel': renderPersonnel(); break;
    case 'medical': renderMedical(); break;
    case 'documents': renderDocuments(); break;
    case 'vehicles': renderVehicles(); break;
    case 'history': renderHistory(); break;
    case 'alerts': renderAlerts(); break;
    case 'settings': renderSettings(); break;
  }
}

// ============================================================
// DASHBOARD
// ============================================================
function renderDashboard() {
  const items = collectAllExpiries();
  const okN = items.filter(i => statusOf(i.expiry).kind === 'ok').length;
  const soonN = items.filter(i => statusOf(i.expiry).kind === 'soon').length;
  const expN = items.filter(i => statusOf(i.expiry).kind === 'expired').length;
  const totalP = state.personnel.length;
  const totalD = state.documents.length;
  const totalV = state.vehicles.length;
  const totalM = state.personnel.reduce((s, p) => s + (p.medicals?.length || 0), 0);

  $('#statsGrid').innerHTML = `
    ${statCard('People', totalP, 'M16 20a6 6 0 10-12 0M12 12a4 4 0 100-8 4 4 0 000 8z', 'var(--primary)')}
    ${statCard('Courses', items.filter(i=>i.kind==='course').length, 'M4 6h16M4 12h10M4 18h6', 'var(--violet)')}
    ${statCard('Medicals', totalM, 'M12 4v16M4 12h16', 'var(--green)')}
    ${statCard('Documents', totalD, 'M7 3h10l3 3v15H4V3z', 'var(--amber)')}
    ${statCard('Vehicles', totalV, 'M3 13l2-6h14l2 6v5H3z', '#f472b6')}
    ${statCard('Valid', okN, 'M5 13l4 4L19 7', 'var(--green)')}
    ${statCard('Expiring ≤30d', soonN, 'M12 2v6M12 22v-6M2 12h6', 'var(--amber)')}
    ${statCard('Expired', expN, 'M6 6l12 12M18 6L6 18', 'var(--red)')}
  `;

  // Donut chart
  drawDonut('donutChart', [
    { value: okN, color: '#22c55e', label: 'Valid' },
    { value: soonN, color: '#f59e0b', label: 'Expiring ≤30d' },
    { value: expN, color: '#ef4444', label: 'Expired' },
  ]);
  $('#donutLegend').innerHTML = `
    <span class="legend-item"><span class="legend-dot" style="background:#22c55e"></span>Valid (${okN})</span>
    <span class="legend-item"><span class="legend-dot" style="background:#f59e0b"></span>Expiring (${soonN})</span>
    <span class="legend-item"><span class="legend-dot" style="background:#ef4444"></span>Expired (${expN})</span>
  `;

  // Bar chart for next 6 months
  const now = new Date();
  const months = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.push({ y: d.getFullYear(), m: d.getMonth(), count: 0, label: d.toLocaleDateString(undefined, { month: 'short' }) });
  }
  for (const it of items) {
    const d = new Date(it.expiry);
    for (const mo of months) {
      if (d.getFullYear() === mo.y && d.getMonth() === mo.m) { mo.count++; break; }
    }
  }
  drawBars('barChart', months);

  // Expiring soon list
  const soon = items
    .filter(i => statusOf(i.expiry).kind !== 'unknown')
    .sort((a,b) => new Date(a.expiry) - new Date(b.expiry))
    .filter(i => daysUntil(i.expiry) <= 60)
    .slice(0, 12);
  $('#expiringCount').textContent = soon.length;
  $('#expiringList').innerHTML = soon.length === 0
    ? '<div class="muted">Nothing expiring in 60 days. </div>'
    : soon.map(i => {
        const s = statusOf(i.expiry);
        return `<div class="list-item" data-jump='${escapeHtml(JSON.stringify({type:i.refType,id:i.refId}))}'>
          <div class="left"><div class="avatar">${initials(i.title)}</div>
            <div><div>${escapeHtml(i.title)}</div><div class="muted">Expires ${fmtDate(i.expiry)}</div></div>
          </div>
          <span class="tag ${s.tag}">${s.label}</span>
        </div>`;
      }).join('');

  // Module breakdown
  const modules = [
    { name: 'Personnel', count: totalP, color: 'var(--primary)' },
    { name: 'Courses', count: items.filter(i=>i.kind==='course').length, color: 'var(--violet)' },
    { name: 'Medical', count: items.filter(i=>i.kind==='medical').length, color: 'var(--green)' },
    { name: 'Documents', count: totalD, color: 'var(--amber)' },
    { name: 'Vehicles', count: totalV, color: '#f472b6' },
  ];
  $('#moduleStats').innerHTML = modules.map(m => `
    <div class="list-item"><div class="left"><span class="legend-dot" style="background:${m.color}"></span>${m.name}</div>
    <div class="right"><strong>${m.count}</strong></div></div>
  `).join('');

  // Recently added (from personnel, documents, vehicles - merged by createdAt)
  const recent = [
    ...state.personnel.map(p => ({ kind: 'Personnel', name: p.name, date: p.createdAt, ref: { type: 'personnel', id: p.id } })),
    ...state.documents.map(d => ({ kind: 'Document', name: `${d.docType} — ${d.holder||''}`, date: d.createdAt, ref: { type: 'documents', id: d.id } })),
    ...state.vehicles.map(v => ({ kind: 'Vehicle', name: v.plate, date: v.createdAt, ref: { type: 'vehicles', id: v.id } })),
  ].filter(x => x.date).sort((a,b) => new Date(b.date)-new Date(a.date)).slice(0, 8);
  $('#recentList').innerHTML = recent.length === 0 ? '<div class="muted">No records yet.</div>' :
    recent.map(r => `<div class="list-item" data-jump='${escapeHtml(JSON.stringify(r.ref))}'>
      <div class="left"><div class="avatar">${initials(r.name)}</div>
        <div><div>${escapeHtml(r.name)}</div><div class="muted">${r.kind} • ${fmtDate(r.date)}</div></div></div>
    </div>`).join('');

  // Click handlers for jump
  $$('.list-item[data-jump]').forEach(el => {
    el.addEventListener('click', () => {
      const j = JSON.parse(el.dataset.jump);
      jumpTo(j.type, j.id);
    });
  });
}

function statCard(label, num, path, color) {
  return `<div class="stat">
    <div class="stat-icon" style="color:${color}"><svg viewBox="0 0 24 24" width="22" height="22"><path d="${path}" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
    <div><div class="stat-num">${num}</div><div class="stat-label">${label}</div></div>
  </div>`;
}

function drawDonut(elId, segments) {
  const el = $('#' + elId);
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total === 0) { el.innerHTML = '<div class="muted" style="text-align:center;padding:30px">No data</div>'; return; }
  const size = 220, r = 80, cx = size/2, cy = size/2, sw = 22;
  let start = -Math.PI/2;
  const parts = segments.map(seg => {
    const ang = (seg.value/total) * Math.PI * 2;
    const end = start + ang;
    const large = ang > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
    const path = `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
    start = end;
    return `<path d="${path}" stroke="${seg.color}" stroke-width="${sw}" fill="none" stroke-linecap="butt" />`;
  }).join('');
  el.innerHTML = `
    <div class="donut">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${parts}</svg>
      <div class="donut-text">
        <div>
          <div style="font-size:28px;font-weight:700">${total}</div>
          <div class="muted">items</div>
        </div>
      </div>
    </div>`;
}

function drawBars(elId, data) {
  const el = $('#' + elId);
  const max = Math.max(1, ...data.map(d => d.count));
  el.innerHTML = `<div class="bars-wrap"><div class="bars">${data.map(d => {
    const h = Math.round((d.count/max) * 140);
    const cls = d.count >= max * 0.75 ? 'danger' : d.count >= max * 0.4 ? 'warn' : '';
    return `<div class="bar ${cls}" style="height:${Math.max(h, d.count > 0 ? 6 : 2)}px" title="${d.label}: ${d.count}">
      <span class="bar-val">${d.count}</span><span class="bar-lbl">${d.label}</span>
    </div>`;
  }).join('')}</div></div>`;
}

// ============================================================
// PERSONNEL
// ============================================================
function getPersonNextExpiry(p) {
  const expiries = [...(p.courses||[]), ...(p.medicals||[])].map(x => x.expiry).filter(Boolean);
  if (expiries.length === 0) return null;
  return expiries.sort()[0];
}

function getPersonStatus(p) {
  const exps = [...(p.courses||[]), ...(p.medicals||[])].map(x => x.expiry).filter(Boolean);
  if (exps.length === 0) return { kind: 'missing', tag: 'muted', label: 'No records' };
  let worst = { kind: 'ok', tag: 'ok' };
  for (const e of exps) {
    const s = statusOf(e);
    if (s.kind === 'expired') return s;
    if (s.kind === 'soon') worst = s;
  }
  return worst;
}

function renderPersonnel() {
  const q = $('#personnelSearch').value.trim().toLowerCase();
  const sort = $('#personnelSort').value;
  const filter = $('#personnelFilter').value;
  let list = state.personnel.slice();

  if (q) {
    list = list.filter(p => {
      const hay = [p.name, p.civilId, p.position, p.department, p.phone,
        ...(p.courses||[]).map(c=>c.name+' '+c.cert),
        ...(p.medicals||[]).map(m=>m.type)].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }
  if (filter !== 'all') {
    list = list.filter(p => getPersonStatus(p).kind === (filter === 'ok' ? 'ok' : filter === 'soon' ? 'soon' : filter === 'expired' ? 'expired' : 'missing'));
  }
  list.sort((a,b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'nextExpiry') {
      const ax = getPersonNextExpiry(a) || '9999-12-31', bx = getPersonNextExpiry(b) || '9999-12-31';
      return ax.localeCompare(bx);
    }
    if (sort === 'created') return (b.createdAt||'').localeCompare(a.createdAt||'');
    if (sort === 'status') {
      const rank = { expired: 0, soon: 1, ok: 2, missing: 3 };
      return rank[getPersonStatus(a).kind] - rank[getPersonStatus(b).kind];
    }
    return 0;
  });

  const wrap = $('#personnelList');
  if (list.length === 0) {
    wrap.innerHTML = `<div class="empty-state" style="grid-column:1/-1">No personnel match. <br><button class="btn btn-primary" id="addPersonEmpty">+ Add Person</button></div>`;
    const b = $('#addPersonEmpty'); if (b) b.onclick = () => openPersonModal();
    return;
  }
  wrap.innerHTML = list.map(p => {
    const s = getPersonStatus(p);
    const next = getPersonNextExpiry(p);
    return `<div class="card-row" data-id="${p.id}">
      <div class="header">
        <div class="avatar">${initials(p.name)}</div>
        <div style="flex:1;min-width:0">
          <div class="name">${escapeHtml(p.name)}</div>
          <div class="meta">${escapeHtml(p.position||'')}${p.position && p.civilId?' • ':''}${p.civilId?'Civil ID: '+escapeHtml(p.civilId):''}</div>
        </div>
        <span class="tag ${s.tag}">${s.label}</span>
      </div>
      <div class="meta">
        Courses: <strong>${(p.courses||[]).length}</strong> &nbsp;•&nbsp; Medical: <strong>${(p.medicals||[]).length}</strong>
        ${next ? '&nbsp;•&nbsp; Next: '+fmtDate(next) : ''}
      </div>
    </div>`;
  }).join('');

  $$('.card-row', wrap).forEach(c => c.onclick = () => openPersonModal(c.dataset.id));
}

async function openPersonModal(id) {
  let person = id ? state.personnel.find(p => p.id === id) : null;
  const isNew = !person;
  if (isNew) person = { id: uid(), name: '', civilId: '', position: '', department: '', phone: '', email: '', courses: [], medicals: [], createdAt: new Date().toISOString() };

  let selectedCertId = null; // currently shown cert in side-pane

  function render() {
    const courses = person.courses || [];
    const medicals = person.medicals || [];
    const selectedItem = [...courses, ...medicals].find(c => c.id === selectedCertId);

    $('#modalTitle').textContent = isNew ? 'Add Person' : person.name || 'Person';
    $('#modalBody').innerHTML = `
      <div class="detail-pane">
        <div class="left-pane">
          <div class="grid-2">
            <div class="field"><label>Full Name *</label><input id="f_name" type="text" value="${escapeHtml(person.name)}" placeholder="e.g. Hari Prasanth"/></div>
            <div class="field"><label>Civil ID</label><input id="f_civilId" type="text" value="${escapeHtml(person.civilId||'')}"/></div>
            <div class="field"><label>Position</label><input id="f_position" type="text" value="${escapeHtml(person.position||'')}"/></div>
            <div class="field"><label>Department</label><input id="f_department" type="text" value="${escapeHtml(person.department||'')}"/></div>
            <div class="field"><label>Phone</label><input id="f_phone" type="text" value="${escapeHtml(person.phone||'')}"/></div>
            <div class="field"><label>Email</label><input id="f_email" type="email" value="${escapeHtml(person.email||'')}"/></div>
          </div>
          <h3 style="margin-top:14px">Training Courses</h3>
          <div id="courseRows">${
            courses.length === 0 ? '<div class="muted">No courses. Click "+ Add Course" to add one.</div>' :
            courses.map(c => certRowHtml(c, selectedCertId)).join('')
          }</div>
          <div class="row gap" style="margin-top:8px">
            <button class="btn" id="addCourseRow">+ Add Course</button>
          </div>
          <h3 style="margin-top:14px">Medical / Fitness</h3>
          <div id="medicalRows">${
            medicals.length === 0 ? '<div class="muted">No medicals. Click "+ Add Medical".</div>' :
            medicals.map(m => certRowHtml(m, selectedCertId, true)).join('')
          }</div>
          <div class="row gap" style="margin-top:8px">
            <button class="btn" id="addMedicalRow">+ Add Medical</button>
          </div>
        </div>
        <div class="right-pane">
          <h3>Certificate</h3>
          <div class="cert-preview" id="certPreview">${certPreviewHtml(selectedItem)}</div>
          ${selectedItem ? `
            <div class="row gap" style="margin-top:10px">
              <button class="btn" id="zoomCert">View Fullscreen</button>
              <button class="btn" id="shareCert">Share</button>
              ${selectedItem.fileId ? `<button class="btn btn-danger" id="rmFile">Remove file</button>` : ''}
            </div>` : ''}
        </div>
      </div>
    `;
    $('#modalFoot').innerHTML = `
      ${!isNew ? '<button class="btn btn-danger" id="delPerson">Delete Person</button>' : ''}
      ${!isNew ? '<button class="btn" id="printPerson">Print / Save PDF</button>' : ''}
      ${!isNew ? '<button class="btn" id="sharePerson">Share Summary</button>' : ''}
      <div class="flex-spacer"></div>
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-primary" id="savePerson">Save</button>
    `;

    // Wire up event handlers
    $$('#courseRows .cert-row, #medicalRows .cert-row').forEach(row => {
      row.onclick = (e) => {
        if (e.target.closest('.row-actions')) return;
        selectedCertId = row.dataset.id;
        render();
      };
    });
    $$('.row-edit', $('#modalBody')).forEach(b => b.onclick = (e) => { e.stopPropagation(); openCertEditor(b.dataset.id); });
    $$('.row-del', $('#modalBody')).forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this certificate? It will be moved to Expired History.')) return;
      await archiveCert(b.dataset.id, 'deleted');
      render();
    });
    $$('.row-renew', $('#modalBody')).forEach(b => b.onclick = (e) => { e.stopPropagation(); renewCert(b.dataset.id); });

    $('#addCourseRow').onclick = () => openCertEditor(null, 'course');
    $('#addMedicalRow').onclick = () => openCertEditor(null, 'medical');
    const zb = $('#zoomCert'); if (zb) zb.onclick = () => openLightbox(selectedItem);
    const sb = $('#shareCert'); if (sb) sb.onclick = () => shareCert(selectedItem, person);
    const rm = $('#rmFile'); if (rm) rm.onclick = async () => {
      if (selectedItem.fileId) { await deleteFile(selectedItem.fileId); selectedItem.fileId = null; selectedItem.fileName = ''; selectedItem.fileType = ''; }
      await dbApi.put('personnel', person);
      render();
    };

    // Drag-and-drop file onto cert preview to attach to the selected cert
    const dropZone = $('#certPreview');
    if (dropZone && selectedItem) {
      ['dragenter','dragover'].forEach(ev => dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.add('dragover'); }));
      ['dragleave','drop'].forEach(ev => dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.remove('dragover'); }));
      dropZone.addEventListener('drop', async e => {
        const file = e.dataTransfer?.files?.[0];
        if (!file) return;
        if (selectedItem.fileId) await deleteFile(selectedItem.fileId);
        const fi = await saveFile(file);
        selectedItem.fileId = fi.id; selectedItem.fileName = fi.name; selectedItem.fileType = fi.type;
        await dbApi.put('personnel', person);
        toast('File attached', 'success');
        render();
      });
    }

    $('#savePerson').onclick = async () => {
      person.name = $('#f_name').value.trim();
      person.civilId = $('#f_civilId').value.trim();
      person.position = $('#f_position').value.trim();
      person.department = $('#f_department').value.trim();
      person.phone = $('#f_phone').value.trim();
      person.email = $('#f_email').value.trim();
      if (!person.name) { toast('Name is required', 'error'); return; }
      person.updatedAt = new Date().toISOString();
      await dbApi.put('personnel', person);
      const idx = state.personnel.findIndex(p => p.id === person.id);
      if (idx >= 0) state.personnel[idx] = person; else state.personnel.push(person);
      await rebuildExpiryIndex();
      closeModal();
      toast('Saved', 'success');
      renderPersonnel();
    };

    const pp = $('#printPerson'); if (pp) pp.onclick = () => printPersonSummary(person);
    const sp = $('#sharePerson'); if (sp) sp.onclick = () => sharePersonSummary(person);

    const dp = $('#delPerson'); if (dp) dp.onclick = async () => {
      if (!confirm(`Delete ${person.name}? All courses & medicals will be archived.`)) return;
      for (const c of (person.courses||[])) await archiveCert(c.id, 'person-deleted', person);
      for (const m of (person.medicals||[])) await archiveCert(m.id, 'person-deleted', person);
      // delete files
      for (const c of [...(person.courses||[]), ...(person.medicals||[])]) if (c.fileId) await deleteFile(c.fileId);
      await dbApi.del('personnel', person.id);
      state.personnel = state.personnel.filter(p => p.id !== person.id);
      await rebuildExpiryIndex();
      closeModal();
      toast('Deleted', 'success');
      renderPersonnel();
    };
  }

  function openCertEditor(certId, kind) {
    const all = [...(person.courses||[]), ...(person.medicals||[])];
    const isCert = certId != null;
    let cert = isCert ? all.find(c => c.id === certId) : null;
    let isMedical = kind === 'medical' || (cert && (person.medicals||[]).some(m => m.id === cert.id));
    if (!cert) {
      cert = { id: uid(), name: '', type: '', issued: '', validity: '2y', expiry: '', cert: '', notes: '', fileId: null, fileName: '', fileType: '' };
    }
    showSubModal('Edit Certificate', `
      <div class="grid-2">
        <div class="field">
          <label>${isMedical ? 'Medical Type' : 'Course Name'} *</label>
          ${isMedical ? `<select id="cf_name">
            ${state.medicalTypes.map(m => `<option value="${escapeHtml(m)}" ${cert.type===m?'selected':''}>${escapeHtml(m)}</option>`).join('')}
            <option value="__other__">Other (specify)…</option>
          </select>
          <input id="cf_nameOther" type="text" placeholder="Specify..." style="margin-top:6px" value="${escapeHtml(cert.type && !state.medicalTypes.includes(cert.type)?cert.type:'')}" ${cert.type && !state.medicalTypes.includes(cert.type)?'':'hidden'}/>` :
          `<select id="cf_name">
            ${state.courseCatalog.map(c => `<option value="${escapeHtml(c)}" ${cert.name===c?'selected':''}>${escapeHtml(c)}</option>`).join('')}
            <option value="__other__">Other (specify)…</option>
          </select>
          <input id="cf_nameOther" type="text" placeholder="Specify..." style="margin-top:6px" value="${escapeHtml(cert.name && !state.courseCatalog.includes(cert.name)?cert.name:'')}" ${cert.name && !state.courseCatalog.includes(cert.name)?'':'hidden'}/>`}
        </div>
        <div class="field"><label>Certificate / Reference No.</label><input id="cf_cert" type="text" value="${escapeHtml(cert.cert||'')}"/></div>
        <div class="field"><label>Issued / Course Date</label><input id="cf_issued" type="date" value="${cert.issued||''}"/></div>
        <div class="field"><label>Validity</label>
          <select id="cf_validity">
            <option value="6m"${cert.validity==='6m'?' selected':''}>6 months</option>
            <option value="1y"${cert.validity==='1y'?' selected':''}>1 year</option>
            <option value="2y"${cert.validity==='2y'?' selected':''}>2 years</option>
            <option value="3y"${cert.validity==='3y'?' selected':''}>3 years</option>
            <option value="5y"${cert.validity==='5y'?' selected':''}>5 years</option>
            <option value="custom"${cert.validity==='custom'?' selected':''}>Custom (set expiry below)</option>
          </select>
        </div>
        <div class="field"><label>Expiry Date *</label><input id="cf_expiry" type="date" value="${cert.expiry||''}"/></div>
        ${!isMedical ? '' : `<div class="field"><label>Notes</label><input id="cf_notes" type="text" value="${escapeHtml(cert.notes||'')}"/></div>`}
      </div>
      <div class="field file-row">
        <label>Certificate File (PDF or image)</label>
        <div class="row gap">
          <input type="file" id="cf_file" accept="image/*,application/pdf,application/x-pdf" />
          <button type="button" class="btn btn-sm" id="cf_camera">Camera</button>
        </div>
        ${cert.fileName ? `<div class="filename">Current: ${escapeHtml(cert.fileName)} (${cert.fileType||''})</div>` : ''}
      </div>
      ${!isMedical ? `<div class="field"><label>Notes</label><input id="cf_notes" type="text" value="${escapeHtml(cert.notes||'')}"/></div>` : ''}
    `, [
      { label: 'Cancel', class: 'btn', close: true },
      { label: 'Save', class: 'btn btn-primary', action: async () => {
        const sel = $('#cf_name').value;
        const other = $('#cf_nameOther').value.trim();
        const nameVal = sel === '__other__' ? other : sel;
        if (!nameVal) { toast('Name is required', 'error'); return false; }
        const file = $('#cf_file').files[0];
        if (file) {
          // delete previous file if existed
          if (cert.fileId) await deleteFile(cert.fileId);
          const fi = await saveFile(file);
          cert.fileId = fi.id; cert.fileName = fi.name; cert.fileType = fi.type;
        }
        if (isMedical) { cert.type = nameVal; cert.name = nameVal; }
        else { cert.name = nameVal; cert.type = 'course'; }
        cert.cert = $('#cf_cert').value.trim();
        cert.issued = $('#cf_issued').value;
        cert.validity = $('#cf_validity').value;
        if (cert.validity !== 'custom' && cert.issued) {
          const e = addPeriod(cert.issued, cert.validity);
          if (e) cert.expiry = e;
        }
        const expIn = $('#cf_expiry').value;
        if (expIn) cert.expiry = expIn;
        cert.notes = $('#cf_notes').value.trim();
        if (!cert.expiry) { toast('Expiry is required', 'error'); return false; }
        if (!isCert) {
          if (isMedical) (person.medicals = person.medicals || []).push(cert);
          else (person.courses = person.courses || []).push(cert);
        }
        // Save person immediately to persist cert
        person.updatedAt = new Date().toISOString();
        await dbApi.put('personnel', person);
        const i = state.personnel.findIndex(p => p.id === person.id);
        if (i >= 0) state.personnel[i] = person; else state.personnel.push(person);
        await rebuildExpiryIndex();
        selectedCertId = cert.id;
        return true;
      }}
    ], render);

    const sel = document.getElementById('cf_name');
    const other = document.getElementById('cf_nameOther');
    sel.onchange = () => { other.hidden = sel.value !== '__other__'; };
    const cam = document.getElementById('cf_camera');
    if (cam) cam.onclick = () => {
      const inp = document.getElementById('cf_file');
      inp.setAttribute('capture', 'environment');
      inp.setAttribute('accept', 'image/*');
      inp.click();
      // reset to original after click
      setTimeout(() => { inp.removeAttribute('capture'); inp.setAttribute('accept','image/*,application/pdf'); }, 500);
    };

    // Sync validity to expiry
    const issuedInp = document.getElementById('cf_issued');
    const valInp = document.getElementById('cf_validity');
    const expInp = document.getElementById('cf_expiry');
    function syncExpiry() {
      const iv = issuedInp.value, v = valInp.value;
      if (v === 'custom' || !iv) return;
      const e = addPeriod(iv, v);
      if (e) expInp.value = e;
    }
    issuedInp.onchange = syncExpiry;
    valInp.onchange = syncExpiry;
  }

  async function renewCert(certId) {
    const all = [...(person.courses||[]), ...(person.medicals||[])];
    const cert = all.find(c => c.id === certId);
    if (!cert) return;
    // archive current cert into history before updating
    const histEntry = {
      id: uid(), source: (person.medicals||[]).some(m=>m.id===cert.id) ? 'medical' : 'course',
      refType: 'personnel', refId: person.id, refName: person.name,
      civilId: person.civilId || '',
      title: cert.name || cert.type, certNo: cert.cert||'', issued: cert.issued||'', expiry: cert.expiry||'',
      fileId: cert.fileId||null, fileName: cert.fileName||'', fileType: cert.fileType||'',
      notes: cert.notes||'', archivedAt: new Date().toISOString(), reason: 'renewed'
    };
    state.history.push(histEntry);
    await dbApi.put('history', histEntry);

    // Open editor pre-filled, but with reset issued/expiry/file
    cert.issued = isoDate(new Date());
    cert.expiry = addPeriod(cert.issued, cert.validity || '2y') || cert.expiry;
    // Move the file to history; keep the cert without file by default
    cert.fileId = null; cert.fileName = ''; cert.fileType = '';
    await dbApi.put('personnel', person);
    await rebuildExpiryIndex();
    toast('Renewed — previous moved to history', 'success');
    render();
    openCertEditor(cert.id);
  }

  async function archiveCert(certId, reason, personOverride) {
    const _p = personOverride || person;
    const allC = [...( _p.courses||[]), ...( _p.medicals||[])];
    const cert = allC.find(c => c.id === certId);
    if (!cert) return;
    const isMedical = (_p.medicals||[]).some(m => m.id === certId);
    const histEntry = {
      id: uid(), source: isMedical ? 'medical' : 'course',
      refType: 'personnel', refId: _p.id, refName: _p.name,
      civilId: _p.civilId || '',
      title: cert.name || cert.type, certNo: cert.cert||'', issued: cert.issued||'', expiry: cert.expiry||'',
      fileId: cert.fileId||null, fileName: cert.fileName||'', fileType: cert.fileType||'',
      notes: cert.notes||'', archivedAt: new Date().toISOString(), reason
    };
    state.history.push(histEntry);
    await dbApi.put('history', histEntry);

    if (isMedical) _p.medicals = (_p.medicals||[]).filter(m => m.id !== certId);
    else _p.courses = (_p.courses||[]).filter(c => c.id !== certId);
    await dbApi.put('personnel', _p);
    const idx = state.personnel.findIndex(x => x.id === _p.id);
    if (idx >= 0) state.personnel[idx] = _p;
    await rebuildExpiryIndex();
  }

  showModal();
  render();
}

function certRowHtml(c, selectedId, isMedical) {
  const s = statusOf(c.expiry);
  const title = isMedical ? c.type : c.name;
  return `<div class="cert-row${c.id===selectedId?' selected':''}" data-id="${c.id}">
    <div>
      <div class="title">${escapeHtml(title||'(untitled)')}${c.cert?` <span class="muted">#${escapeHtml(c.cert)}</span>`:''}</div>
      <div class="subtitle">Issued ${fmtDate(c.issued)} • Expires ${fmtDate(c.expiry)}</div>
    </div>
    <div class="right">
      <span class="tag ${s.tag}">${s.label}</span>
      <div class="row-actions row gap">
        <button class="btn btn-sm row-edit" data-id="${c.id}">Edit</button>
        <button class="btn btn-sm btn-success row-renew" data-id="${c.id}">Renew</button>
        <button class="btn btn-sm btn-danger row-del" data-id="${c.id}">Del</button>
      </div>
    </div>
  </div>`;
}

function certPreviewHtml(item, targetId = 'certPreview') {
  if (!item) return `<div class="cert-empty" data-preview-target="${targetId}">Select a course or medical to view its certificate.</div>`;
  if (!item.fileId) return `<div class="cert-empty" data-preview-target="${targetId}">No file attached.<br><br>Click <strong>Edit</strong> and attach a PDF or image.</div>`;
  setTimeout(async () => {
    const f = await getFile(item.fileId);
    if (!f) return;
    const url = URL.createObjectURL(f.blob);
    const isImg = (f.type||'').startsWith('image/');
    const isPdf = (f.type||'').includes('pdf');
    const el = document.getElementById(targetId);
    if (!el) { URL.revokeObjectURL(url); return; }
    if (isImg) el.innerHTML = `<img src="${url}" alt="${escapeHtml(f.name)}" />`;
    else if (isPdf) el.innerHTML = `<iframe src="${url}#toolbar=0" title="${escapeHtml(f.name)}"></iframe>`;
    else el.innerHTML = `<div class="cert-empty"><a href="${url}" download="${escapeHtml(f.name)}">${escapeHtml(f.name)}</a></div>`;
    const img = el.querySelector('img');
    if (img) img.onclick = () => openLightbox(item);
  }, 10);
  return `<div class="cert-empty" data-preview-target="${targetId}">Loading…</div>`;
}

async function openLightbox(item) {
  if (!item || !item.fileId) { toast('No file attached', 'warn'); return; }
  const f = await getFile(item.fileId);
  if (!f) { toast('File not found', 'error'); return; }
  const url = URL.createObjectURL(f.blob);
  const isImg = (f.type||'').startsWith('image/');
  const isPdf = (f.type||'').includes('pdf');
  const lb = $('#lightbox');
  const c = $('#lightboxContent');
  if (isImg) c.innerHTML = `<img src="${url}" alt="cert" />`;
  else if (isPdf) c.innerHTML = `<iframe src="${url}" title="cert"></iframe>`;
  else c.innerHTML = `<div><a href="${url}" download="${escapeHtml(f.name)}">${escapeHtml(f.name)}</a></div>`;
  lb.hidden = false;
}

// ============================================================
// MEDICAL VIEW (cross-cuts personnel medicals)
// ============================================================
function renderMedical() {
  const q = $('#medicalSearch').value.trim().toLowerCase();
  const sort = $('#medicalSort').value;
  let rows = [];
  for (const p of state.personnel) {
    for (const m of (p.medicals||[])) {
      rows.push({ person: p, med: m });
    }
  }
  if (q) rows = rows.filter(r => (r.person.name+' '+r.med.type+' '+(r.med.notes||'')+' '+(r.person.civilId||'')).toLowerCase().includes(q));
  rows.sort((a,b) => {
    if (sort === 'name') return a.person.name.localeCompare(b.person.name);
    if (sort === 'expiry') return (a.med.expiry||'9999').localeCompare(b.med.expiry||'9999');
    if (sort === 'type') return (a.med.type||'').localeCompare(b.med.type||'');
    return 0;
  });

  const wrap = $('#medicalList');
  if (rows.length === 0) { wrap.innerHTML = '<div class="empty-state" style="grid-column:1/-1">No medical records.</div>'; return; }
  wrap.innerHTML = rows.map(r => {
    const s = statusOf(r.med.expiry);
    return `<div class="card-row" data-pid="${r.person.id}" data-cid="${r.med.id}">
      <div class="header">
        <div class="avatar">${initials(r.person.name)}</div>
        <div style="flex:1;min-width:0">
          <div class="name">${escapeHtml(r.person.name)}</div>
          <div class="meta">${escapeHtml(r.med.type||'')}</div>
        </div>
        <span class="tag ${s.tag}">${s.label}</span>
      </div>
      <div class="meta">Issued ${fmtDate(r.med.issued)} • Expires ${fmtDate(r.med.expiry)}</div>
    </div>`;
  }).join('');
  $$('.card-row', wrap).forEach(c => c.onclick = () => openPersonModal(c.dataset.pid));
}

// ============================================================
// DOCUMENTS (IDs, passports etc.)
// ============================================================
function renderDocuments() {
  const q = $('#documentsSearch').value.trim().toLowerCase();
  const sort = $('#documentsSort').value;
  const tFilter = $('#documentsType').value;
  let list = state.documents.slice();
  if (q) list = list.filter(d => (d.holder+' '+d.docType+' '+(d.number||'')+' '+(d.notes||'')+' '+(d.issuer||'')).toLowerCase().includes(q));
  if (tFilter !== 'all') list = list.filter(d => d.docType === tFilter);
  list.sort((a,b) => {
    if (sort === 'name') return (a.holder||'').localeCompare(b.holder||'');
    if (sort === 'expiry') return (a.expiry||'9999').localeCompare(b.expiry||'9999');
    if (sort === 'type') return (a.docType||'').localeCompare(b.docType||'');
    return 0;
  });
  const wrap = $('#documentsList');
  if (list.length === 0) { wrap.innerHTML = '<div class="empty-state" style="grid-column:1/-1">No documents yet.</div>'; return; }
  wrap.innerHTML = list.map(d => {
    const s = statusOf(d.expiry);
    return `<div class="card-row" data-id="${d.id}">
      <div class="header">
        <div class="avatar">${initials(d.holder||d.docType)}</div>
        <div style="flex:1;min-width:0">
          <div class="name">${escapeHtml(d.docType)}${d.number?` <span class="muted">#${escapeHtml(d.number)}</span>`:''}</div>
          <div class="meta">${escapeHtml(d.holder||'')}</div>
        </div>
        <span class="tag ${s.tag}">${s.label}</span>
      </div>
      <div class="meta">Issued ${fmtDate(d.issued)} • Expires ${fmtDate(d.expiry)}</div>
    </div>`;
  }).join('');
  $$('.card-row', wrap).forEach(c => c.onclick = () => openDocumentModal(c.dataset.id));
}

async function openDocumentModal(id) {
  let doc = id ? state.documents.find(d => d.id === id) : null;
  const isNew = !doc;
  if (isNew) doc = { id: uid(), docType: 'Resident ID', holder: '', number: '', issuer: '', issued: '', expiry: '', notes: '', fileId: null, fileName: '', fileType: '', createdAt: new Date().toISOString() };

  function render() {
    $('#modalTitle').textContent = isNew ? 'Add Document' : `${doc.docType} — ${doc.holder||''}`;
    $('#modalBody').innerHTML = `
      <div class="detail-pane">
        <div>
          <div class="grid-2">
            <div class="field"><label>Document Type *</label>
              <select id="d_docType">
                ${DOC_TYPES.map(t => `<option value="${t}" ${doc.docType===t?'selected':''}>${t}</option>`).join('')}
              </select>
            </div>
            <div class="field"><label>Document Number</label><input id="d_number" type="text" value="${escapeHtml(doc.number||'')}"/></div>
            <div class="field"><label>Holder Name *</label><input id="d_holder" type="text" value="${escapeHtml(doc.holder||'')}"/></div>
            <div class="field"><label>Issuer / Country</label><input id="d_issuer" type="text" value="${escapeHtml(doc.issuer||'')}"/></div>
            <div class="field"><label>Issued Date</label><input id="d_issued" type="date" value="${doc.issued||''}"/></div>
            <div class="field"><label>Expiry Date *</label><input id="d_expiry" type="date" value="${doc.expiry||''}"/></div>
          </div>
          <div class="field"><label>Notes</label><textarea id="d_notes" rows="3">${escapeHtml(doc.notes||'')}</textarea></div>
          <div class="field file-row">
            <label>Document File (PDF or image)</label>
            <div class="row gap">
              <input type="file" id="d_file" accept="image/*,application/pdf" />
              <button type="button" class="btn btn-sm" id="d_camera">Camera</button>
            </div>
            ${doc.fileName ? `<div class="filename">Current: ${escapeHtml(doc.fileName)}</div>` : ''}
          </div>
        </div>
        <div>
          <h3>Document File</h3>
          <div class="cert-preview" id="docPreview">${certPreviewHtml(doc, 'docPreview')}</div>
          ${doc.fileId ? `<div class="row gap" style="margin-top:10px">
            <button class="btn" id="zoomDoc">View Fullscreen</button>
            <button class="btn" id="shareDoc">Share</button>
          </div>` : ''}
        </div>
      </div>
    `;
    $('#modalFoot').innerHTML = `
      ${!isNew ? '<button class="btn btn-danger" id="delDoc">Delete</button>' : ''}
      ${!isNew && doc.expiry ? '<button class="btn btn-success" id="renewDoc">Renew</button>' : ''}
      <div class="flex-spacer"></div>
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-primary" id="saveDoc">Save</button>
    `;
    const cam = $('#d_camera'); if (cam) cam.onclick = () => {
      const i = $('#d_file'); i.setAttribute('capture','environment'); i.setAttribute('accept','image/*'); i.click();
      setTimeout(() => { i.removeAttribute('capture'); i.setAttribute('accept','image/*,application/pdf'); }, 500);
    };
    const zb = $('#zoomDoc'); if (zb) zb.onclick = () => openLightbox(doc);
    const sb = $('#shareDoc'); if (sb) sb.onclick = () => shareCert(doc, { name: doc.holder });

    $('#saveDoc').onclick = async () => {
      doc.docType = $('#d_docType').value;
      doc.number = $('#d_number').value.trim();
      doc.holder = $('#d_holder').value.trim();
      doc.issuer = $('#d_issuer').value.trim();
      doc.issued = $('#d_issued').value;
      doc.expiry = $('#d_expiry').value;
      doc.notes = $('#d_notes').value.trim();
      const file = $('#d_file').files[0];
      if (file) { if (doc.fileId) await deleteFile(doc.fileId); const fi = await saveFile(file); doc.fileId = fi.id; doc.fileName = fi.name; doc.fileType = fi.type; }
      if (!doc.holder) { toast('Holder name required', 'error'); return; }
      doc.updatedAt = new Date().toISOString();
      await dbApi.put('documents', doc);
      const idx = state.documents.findIndex(x => x.id === doc.id);
      if (idx >= 0) state.documents[idx] = doc; else state.documents.push(doc);
      await rebuildExpiryIndex();
      closeModal(); toast('Saved', 'success'); renderDocuments();
    };

    const dd = $('#delDoc'); if (dd) dd.onclick = async () => {
      if (!confirm('Delete this document? It will be moved to history.')) return;
      const histEntry = { id: uid(), source: 'document', refType: 'documents', refId: doc.id, refName: doc.holder,
        title: doc.docType, certNo: doc.number, issued: doc.issued, expiry: doc.expiry,
        fileId: doc.fileId, fileName: doc.fileName, fileType: doc.fileType, notes: doc.notes,
        archivedAt: new Date().toISOString(), reason: 'deleted' };
      state.history.push(histEntry); await dbApi.put('history', histEntry);
      await dbApi.del('documents', doc.id);
      state.documents = state.documents.filter(x => x.id !== doc.id);
      await rebuildExpiryIndex();
      closeModal(); toast('Deleted', 'success'); renderDocuments();
    };

    const rn = $('#renewDoc'); if (rn) rn.onclick = async () => {
      const histEntry = { id: uid(), source: 'document', refType: 'documents', refId: doc.id, refName: doc.holder,
        title: doc.docType, certNo: doc.number, issued: doc.issued, expiry: doc.expiry,
        fileId: doc.fileId, fileName: doc.fileName, fileType: doc.fileType, notes: doc.notes,
        archivedAt: new Date().toISOString(), reason: 'renewed' };
      state.history.push(histEntry); await dbApi.put('history', histEntry);
      doc.fileId = null; doc.fileName = ''; doc.fileType = '';
      doc.issued = isoDate(new Date());
      // default to +5 years for many IDs
      doc.expiry = addPeriod(doc.issued, '5y');
      render();
      toast('Renewed — previous archived', 'success');
    };
  }

  showModal(); render();
}

// ============================================================
// VEHICLES
// ============================================================
function vehicleNextExpiry(v) {
  const ex = (v.records||[]).map(r => r.expiry).filter(Boolean).sort();
  return ex[0] || null;
}

function renderVehicles() {
  const q = $('#vehiclesSearch').value.trim().toLowerCase();
  const sort = $('#vehiclesSort').value;
  let list = state.vehicles.slice();
  if (q) list = list.filter(v => Object.values(v).join(' ').toLowerCase().includes(q) || (v.records||[]).some(r => (r.kind+' '+(r.notes||'')).toLowerCase().includes(q)));
  list.sort((a,b) => {
    if (sort === 'plate') return (a.plate||'').localeCompare(b.plate||'');
    if (sort === 'expiry') return (vehicleNextExpiry(a)||'9999').localeCompare(vehicleNextExpiry(b)||'9999');
    if (sort === 'user') return (a.user||'').localeCompare(b.user||'');
    return 0;
  });
  const wrap = $('#vehiclesList');
  if (list.length === 0) { wrap.innerHTML = '<div class="empty-state" style="grid-column:1/-1">No vehicles yet.</div>'; return; }
  wrap.innerHTML = list.map(v => {
    const next = vehicleNextExpiry(v);
    const s = statusOf(next);
    return `<div class="card-row" data-id="${v.id}">
      <div class="header">
        <div class="avatar" style="background:linear-gradient(135deg,#f472b6,#f59e0b)">${initials(v.plate||'V')}</div>
        <div style="flex:1;min-width:0">
          <div class="name">${escapeHtml(v.plate)}</div>
          <div class="meta">${escapeHtml(v.make||'')} ${escapeHtml(v.model||'')} ${v.year?'• '+v.year:''}</div>
        </div>
        <span class="tag ${s.tag}">${s.label}</span>
      </div>
      <div class="meta">Records: ${(v.records||[]).length} ${v.user?'• User: '+escapeHtml(v.user):''}${next?' • Next: '+fmtDate(next):''}</div>
    </div>`;
  }).join('');
  $$('.card-row', wrap).forEach(c => c.onclick = () => openVehicleModal(c.dataset.id));
}

async function openVehicleModal(id) {
  let v = id ? state.vehicles.find(x => x.id === id) : null;
  const isNew = !v;
  if (isNew) v = { id: uid(), plate: '', make: '', model: '', year: '', color: '', chassis: '', user: '', records: [], createdAt: new Date().toISOString() };
  let selectedRecId = null;
  const RECORD_KINDS = ['Mulkia', 'Insurance', 'Inspection', 'Other'];

  function render() {
    const recs = v.records || [];
    const sel = recs.find(r => r.id === selectedRecId);
    $('#modalTitle').textContent = isNew ? 'Add Vehicle' : `Vehicle ${v.plate||''}`;
    $('#modalBody').innerHTML = `
      <div class="detail-pane">
        <div>
          <div class="grid-2">
            ${VEHICLE_FIELDS.map(f => `<div class="field"><label>${f.label}${f.required?' *':''}</label><input id="v_${f.key}" type="text" value="${escapeHtml(v[f.key]||'')}"/></div>`).join('')}
          </div>
          <h3 style="margin-top:14px">Records (Mulkia, Insurance, etc.)</h3>
          <div id="vRecRows">${
            recs.length === 0 ? '<div class="muted">No records. Add one below.</div>' :
            recs.map(r => {
              const s = statusOf(r.expiry);
              return `<div class="cert-row${r.id===selectedRecId?' selected':''}" data-id="${r.id}">
                <div>
                  <div class="title">${escapeHtml(r.kind)}${r.number?` <span class="muted">#${escapeHtml(r.number)}</span>`:''}</div>
                  <div class="subtitle">Issued ${fmtDate(r.issued)} • Expires ${fmtDate(r.expiry)}</div>
                </div>
                <div class="right">
                  <span class="tag ${s.tag}">${s.label}</span>
                  <div class="row-actions row gap">
                    <button class="btn btn-sm rec-edit" data-id="${r.id}">Edit</button>
                    <button class="btn btn-sm btn-success rec-renew" data-id="${r.id}">Renew</button>
                    <button class="btn btn-sm btn-danger rec-del" data-id="${r.id}">Del</button>
                  </div>
                </div>
              </div>`;
            }).join('')
          }</div>
          <button class="btn" id="addVRec" style="margin-top:8px">+ Add Record</button>
        </div>
        <div>
          <h3>Attached File</h3>
          <div class="cert-preview" id="certPreview">${certPreviewHtml(sel)}</div>
          ${sel ? `<div class="row gap" style="margin-top:10px">
            ${sel.fileId ? '<button class="btn" id="zoomVRec">View Fullscreen</button>' : ''}
            <button class="btn" id="shareVRec">Share</button>
          </div>` : ''}
        </div>
      </div>
    `;
    $('#modalFoot').innerHTML = `
      ${!isNew ? '<button class="btn btn-danger" id="delVehicle">Delete</button>' : ''}
      <div class="flex-spacer"></div>
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-primary" id="saveVehicle">Save</button>
    `;
    $$('#vRecRows .cert-row').forEach(row => row.onclick = (e) => { if (e.target.closest('.row-actions')) return; selectedRecId = row.dataset.id; render(); });
    $$('.rec-edit').forEach(b => b.onclick = (e) => { e.stopPropagation(); openRecEditor(b.dataset.id); });
    $$('.rec-del').forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this record? Moved to history.')) return;
      const r = recs.find(x => x.id === b.dataset.id);
      const histEntry = { id: uid(), source: 'vehicle', refType: 'vehicles', refId: v.id, refName: v.plate,
        title: r.kind, certNo: r.number||'', issued: r.issued, expiry: r.expiry,
        fileId: r.fileId, fileName: r.fileName, fileType: r.fileType, notes: r.notes,
        archivedAt: new Date().toISOString(), reason: 'deleted' };
      state.history.push(histEntry); await dbApi.put('history', histEntry);
      v.records = recs.filter(x => x.id !== b.dataset.id);
      await dbApi.put('vehicles', v);
      const i = state.vehicles.findIndex(x => x.id === v.id); if (i >= 0) state.vehicles[i] = v;
      await rebuildExpiryIndex();
      render();
    });
    $$('.rec-renew').forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      const r = recs.find(x => x.id === b.dataset.id);
      const histEntry = { id: uid(), source: 'vehicle', refType: 'vehicles', refId: v.id, refName: v.plate,
        title: r.kind, certNo: r.number||'', issued: r.issued, expiry: r.expiry,
        fileId: r.fileId, fileName: r.fileName, fileType: r.fileType, notes: r.notes,
        archivedAt: new Date().toISOString(), reason: 'renewed' };
      state.history.push(histEntry); await dbApi.put('history', histEntry);
      r.issued = isoDate(new Date()); r.expiry = addPeriod(r.issued, r.validity||'1y') || r.expiry;
      r.fileId = null; r.fileName = ''; r.fileType = '';
      await dbApi.put('vehicles', v);
      await rebuildExpiryIndex();
      selectedRecId = r.id; render(); openRecEditor(r.id);
    });
    $('#addVRec').onclick = () => openRecEditor(null);

    const zb = $('#zoomVRec'); if (zb) zb.onclick = () => openLightbox(sel);
    const sb = $('#shareVRec'); if (sb) sb.onclick = () => shareCert(sel, { name: v.plate });

    $('#saveVehicle').onclick = async () => {
      for (const f of VEHICLE_FIELDS) v[f.key] = $('#v_'+f.key).value.trim();
      if (!v.plate) { toast('Plate is required', 'error'); return; }
      v.updatedAt = new Date().toISOString();
      await dbApi.put('vehicles', v);
      const i = state.vehicles.findIndex(x => x.id === v.id);
      if (i >= 0) state.vehicles[i] = v; else state.vehicles.push(v);
      await rebuildExpiryIndex();
      closeModal(); toast('Saved', 'success'); renderVehicles();
    };
    const dv = $('#delVehicle'); if (dv) dv.onclick = async () => {
      if (!confirm(`Delete vehicle ${v.plate}? All records will be archived.`)) return;
      for (const r of (v.records||[])) {
        const histEntry = { id: uid(), source: 'vehicle', refType: 'vehicles', refId: v.id, refName: v.plate,
          title: r.kind, certNo: r.number||'', issued: r.issued, expiry: r.expiry,
          fileId: r.fileId, fileName: r.fileName, fileType: r.fileType, notes: r.notes,
          archivedAt: new Date().toISOString(), reason: 'vehicle-deleted' };
        state.history.push(histEntry); await dbApi.put('history', histEntry);
      }
      await dbApi.del('vehicles', v.id);
      state.vehicles = state.vehicles.filter(x => x.id !== v.id);
      await rebuildExpiryIndex();
      closeModal(); toast('Deleted', 'success'); renderVehicles();
    };
  }

  function openRecEditor(recId) {
    let rec = recId ? v.records.find(r => r.id === recId) : null;
    const isNewRec = !rec;
    if (!rec) rec = { id: uid(), kind: 'Mulkia', number: '', issued: '', validity: '1y', expiry: '', notes: '', fileId: null, fileName: '', fileType: '' };
    const RECORD_KINDS = ['Mulkia', 'Insurance', 'Inspection', 'Roadworthy', 'Other'];

    showSubModal('Vehicle Record', `
      <div class="grid-2">
        <div class="field"><label>Record Type *</label>
          <select id="vr_kind">
            ${RECORD_KINDS.map(k => `<option value="${k}" ${rec.kind===k?'selected':''}>${k}</option>`).join('')}
            <option value="__other__">Other (specify)…</option>
          </select>
          <input id="vr_kindOther" type="text" placeholder="Specify..." style="margin-top:6px" value="${escapeHtml(rec.kind && !RECORD_KINDS.includes(rec.kind)?rec.kind:'')}" ${rec.kind && !RECORD_KINDS.includes(rec.kind)?'':'hidden'}/>
        </div>
        <div class="field"><label>Number / Reference</label><input id="vr_number" type="text" value="${escapeHtml(rec.number||'')}"/></div>
        <div class="field"><label>Issued</label><input id="vr_issued" type="date" value="${rec.issued||''}"/></div>
        <div class="field"><label>Validity</label>
          <select id="vr_validity">
            <option value="6m"${rec.validity==='6m'?' selected':''}>6 months</option>
            <option value="1y"${rec.validity==='1y'?' selected':''}>1 year</option>
            <option value="2y"${rec.validity==='2y'?' selected':''}>2 years</option>
            <option value="3y"${rec.validity==='3y'?' selected':''}>3 years</option>
            <option value="custom"${rec.validity==='custom'?' selected':''}>Custom</option>
          </select>
        </div>
        <div class="field"><label>Expiry *</label><input id="vr_expiry" type="date" value="${rec.expiry||''}"/></div>
      </div>
      <div class="field"><label>Notes</label><input id="vr_notes" type="text" value="${escapeHtml(rec.notes||'')}"/></div>
      <div class="field file-row">
        <label>File (PDF or image)</label>
        <input type="file" id="vr_file" accept="image/*,application/pdf" />
        ${rec.fileName ? `<div class="filename">Current: ${escapeHtml(rec.fileName)}</div>` : ''}
      </div>
    `, [
      { label: 'Cancel', class: 'btn', close: true },
      { label: 'Save', class: 'btn btn-primary', action: async () => {
        const k = $('#vr_kind').value;
        rec.kind = k === '__other__' ? ($('#vr_kindOther').value.trim() || 'Other') : k;
        rec.number = $('#vr_number').value.trim();
        rec.issued = $('#vr_issued').value;
        rec.validity = $('#vr_validity').value;
        if (rec.validity !== 'custom' && rec.issued) {
          const e = addPeriod(rec.issued, rec.validity); if (e) rec.expiry = e;
        }
        const expIn = $('#vr_expiry').value;
        if (expIn) rec.expiry = expIn;
        rec.notes = $('#vr_notes').value.trim();
        const file = $('#vr_file').files[0];
        if (file) { if (rec.fileId) await deleteFile(rec.fileId); const fi = await saveFile(file); rec.fileId = fi.id; rec.fileName = fi.name; rec.fileType = fi.type; }
        if (!rec.expiry) { toast('Expiry is required', 'error'); return false; }
        if (isNewRec) (v.records = v.records || []).push(rec);
        await dbApi.put('vehicles', v);
        const i = state.vehicles.findIndex(x => x.id === v.id);
        if (i >= 0) state.vehicles[i] = v; else state.vehicles.push(v);
        await rebuildExpiryIndex();
        selectedRecId = rec.id;
        return true;
      }}
    ], render);
    const sel = $('#vr_kind'), oth = $('#vr_kindOther');
    sel.onchange = () => { oth.hidden = sel.value !== '__other__'; };
    const ii = $('#vr_issued'), vv = $('#vr_validity'), ex = $('#vr_expiry');
    function sync() { if (vv.value === 'custom' || !ii.value) return; const e = addPeriod(ii.value, vv.value); if (e) ex.value = e; }
    ii.onchange = sync; vv.onchange = sync;
  }

  showModal(); render();
}

// ============================================================
// HISTORY
// ============================================================
function renderHistory() {
  const q = $('#historySearch').value.trim().toLowerCase();
  const src = $('#historySource').value;
  let list = state.history.slice();
  if (q) list = list.filter(h => (h.refName+' '+h.title+' '+(h.certNo||'')+' '+(h.notes||'')).toLowerCase().includes(q));
  if (src !== 'all') list = list.filter(h => h.source === src);
  list.sort((a,b) => (b.archivedAt||'').localeCompare(a.archivedAt||''));
  const wrap = $('#historyList');
  if (list.length === 0) { wrap.innerHTML = '<div class="empty-state" style="grid-column:1/-1">No expired/archived records yet.</div>'; return; }
  wrap.innerHTML = list.map(h => `<div class="card-row" data-id="${h.id}">
    <div class="header">
      <div class="avatar">${initials(h.refName||h.title)}</div>
      <div style="flex:1;min-width:0">
        <div class="name">${escapeHtml(h.title)} ${h.refName?`<span class="muted">— ${escapeHtml(h.refName)}</span>`:''}</div>
        <div class="meta">${escapeHtml(h.source)} • ${h.reason||'archived'} • Archived ${fmtDate(h.archivedAt)}</div>
      </div>
      <span class="tag muted">${h.source}</span>
    </div>
    <div class="meta">Was issued ${fmtDate(h.issued)} • Expired ${fmtDate(h.expiry)}${h.certNo?' • #'+escapeHtml(h.certNo):''}</div>
  </div>`).join('');
  $$('.card-row', wrap).forEach(c => c.onclick = () => openHistoryModal(c.dataset.id));
}

async function openHistoryModal(id) {
  const h = state.history.find(x => x.id === id);
  if (!h) return;
  $('#modalTitle').textContent = `History: ${h.title}`;
  $('#modalBody').innerHTML = `
    <div class="detail-pane">
      <div>
        <div class="grid-2">
          <div class="field"><label>Title</label><div>${escapeHtml(h.title)}</div></div>
          <div class="field"><label>Holder</label><div>${escapeHtml(h.refName||'')}</div></div>
          <div class="field"><label>Source</label><div>${escapeHtml(h.source)}</div></div>
          <div class="field"><label>Reason</label><div>${escapeHtml(h.reason||'')}</div></div>
          <div class="field"><label>Issued</label><div>${fmtDate(h.issued)}</div></div>
          <div class="field"><label>Expired</label><div>${fmtDate(h.expiry)}</div></div>
          <div class="field"><label>Cert No.</label><div>${escapeHtml(h.certNo||'—')}</div></div>
          <div class="field"><label>Archived</label><div>${fmtDate(h.archivedAt)}</div></div>
        </div>
        <div class="field"><label>Notes</label><div>${escapeHtml(h.notes||'—')}</div></div>
      </div>
      <div>
        <h3>Original File</h3>
        <div class="cert-preview" id="certPreview">${certPreviewHtml(h)}</div>
        ${h.fileId ? `<div class="row gap" style="margin-top:10px">
          <button class="btn" id="zoomHist">View Fullscreen</button>
          <button class="btn" id="shareHist">Share</button>
        </div>` : ''}
      </div>
    </div>`;
  $('#modalFoot').innerHTML = `
    <button class="btn btn-danger" id="delHist">Delete from history</button>
    <div class="flex-spacer"></div>
    <button class="btn" data-close>Close</button>
  `;
  const zb = $('#zoomHist'); if (zb) zb.onclick = () => openLightbox(h);
  const sb = $('#shareHist'); if (sb) sb.onclick = () => shareCert(h, { name: h.refName });
  $('#delHist').onclick = async () => {
    if (!confirm('Permanently delete this history record?')) return;
    if (h.fileId) await deleteFile(h.fileId);
    await dbApi.del('history', h.id);
    state.history = state.history.filter(x => x.id !== h.id);
    closeModal(); renderHistory(); toast('Deleted', 'success');
  };
  showModal();
}

// ============================================================
// ALERTS VIEW
// ============================================================
function renderAlerts() {
  const items = collectAllExpiries().filter(i => i.expiry).sort((a,b) => new Date(a.expiry) - new Date(b.expiry));
  const wrap = $('#alertsList');
  if (items.length === 0) { wrap.innerHTML = '<div class="muted">No tracked expiries yet.</div>'; return; }
  wrap.innerHTML = items.slice(0, 200).map(i => {
    const s = statusOf(i.expiry);
    const dl = daysUntil(i.expiry);
    return `<div class="list-item" data-jump='${escapeHtml(JSON.stringify({type:i.refType,id:i.refId}))}'>
      <div class="left"><div class="avatar">${initials(i.title)}</div>
        <div><div>${escapeHtml(i.title)}</div>
          <div class="muted">${escapeHtml(i.subtitle||'')}${i.subtitle?' • ':''}Expires ${fmtDate(i.expiry)}</div>
        </div>
      </div>
      <span class="tag ${s.tag}">${dl < 0 ? 'Expired '+(-dl)+'d ago' : dl+'d left'}</span>
    </div>`;
  }).join('');
  $$('.list-item[data-jump]', wrap).forEach(el => el.onclick = () => { const j = JSON.parse(el.dataset.jump); jumpTo(j.type, j.id); });
}

// ============================================================
// SETTINGS
// ============================================================
function renderSettings() {
  $('#setNotifEnabled').checked = !!state.notifEnabled;
  const cc = $('#courseCatalog');
  cc.innerHTML = state.courseCatalog.map((c, i) => `<span class="chip">${escapeHtml(c)} <button data-i="${i}" title="Remove">×</button></span>`).join('');
  $$('button', cc).forEach(b => b.onclick = async () => {
    const i = parseInt(b.dataset.i, 10);
    state.courseCatalog.splice(i, 1);
    await saveMeta('courseCatalog', state.courseCatalog);
    renderSettings();
  });
}

// ============================================================
// MODAL / LIGHTBOX HELPERS
// ============================================================
function showModal() { $('#modal').hidden = false; }
function closeModal() { $('#modal').hidden = true; }
function closeLightbox() { $('#lightbox').hidden = true; $('#lightboxContent').innerHTML = ''; }
function closeSearch() { $('#searchOverlay').hidden = true; }

let subModalOnReturn = null;
let subModalHadParent = false;
function showSubModal(title, bodyHtml, buttons, onReturn) {
  // If invoked from another (parent) modal, remember to re-render that parent on close.
  subModalHadParent = !$('#modal').hidden;
  subModalOnReturn = onReturn || null;
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = bodyHtml;
  $('#modalFoot').innerHTML = buttons.map((b, i) => `<button class="${b.class}" data-i="${i}">${b.label}</button>`).join('');
  $$('#modalFoot button').forEach(btn => btn.onclick = async () => {
    const b = buttons[parseInt(btn.dataset.i, 10)];
    if (b.close) restoreSubModal();
    else if (b.action) {
      const ok = await b.action();
      if (ok !== false) restoreSubModal();
    }
  });
  showModal();
}
function restoreSubModal() {
  const cb = subModalOnReturn;
  subModalOnReturn = null;
  if (cb) {
    // Parent supplied a re-render callback — keep modal open and let it repaint.
    cb();
    return;
  }
  // Otherwise close the modal entirely.
  closeModal();
  // If a list view is visible, refresh it so any saved changes show.
  const active = $$('.view.active')[0];
  if (active) renderView(active.id.replace('view-',''));
}

// ============================================================
// SHARING
// ============================================================
function printPersonSummary(person) {
  const rows = (label, list, titleOf) => list.length === 0 ? '' : `
    <h3>${label}</h3>
    <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:12px">
      <thead><tr style="background:#eef2f7"><th style="text-align:left;padding:6px;border:1px solid #cbd5e1">Name</th><th style="padding:6px;border:1px solid #cbd5e1">Cert No.</th><th style="padding:6px;border:1px solid #cbd5e1">Issued</th><th style="padding:6px;border:1px solid #cbd5e1">Expires</th><th style="padding:6px;border:1px solid #cbd5e1">Status</th></tr></thead>
      <tbody>${list.map(c => {
        const s = statusOf(c.expiry);
        return `<tr><td style="padding:6px;border:1px solid #cbd5e1">${escapeHtml(titleOf(c))}</td><td style="padding:6px;border:1px solid #cbd5e1">${escapeHtml(c.cert||'')}</td><td style="padding:6px;border:1px solid #cbd5e1">${fmtDate(c.issued)}</td><td style="padding:6px;border:1px solid #cbd5e1">${fmtDate(c.expiry)}</td><td style="padding:6px;border:1px solid #cbd5e1">${s.label}</td></tr>`;
      }).join('')}</tbody>
    </table>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(person.name)} — HSE Summary</title>
    <style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0b1220;padding:24px;max-width:780px;margin:auto}
      h1{margin:0 0 4px 0}h3{margin-top:18px;border-bottom:1px solid #cbd5e1;padding-bottom:4px}
      .meta{color:#475569;margin-bottom:16px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;font-size:13px}</style>
    </head><body>
    <h1>${escapeHtml(person.name)}</h1>
    <div class="meta">HSE Certificate Summary • Generated ${fmtDate(new Date())}</div>
    <div class="grid">
      <div><strong>Civil ID:</strong> ${escapeHtml(person.civilId||'—')}</div>
      <div><strong>Position:</strong> ${escapeHtml(person.position||'—')}</div>
      <div><strong>Department:</strong> ${escapeHtml(person.department||'—')}</div>
      <div><strong>Phone:</strong> ${escapeHtml(person.phone||'—')}</div>
      <div><strong>Email:</strong> ${escapeHtml(person.email||'—')}</div>
    </div>
    ${rows('Training Courses', person.courses||[], c => c.name)}
    ${rows('Medical / Fitness', person.medicals||[], c => c.type)}
    </body></html>`;
  const w = window.open('', '_blank');
  if (!w) { toast('Pop-up blocked', 'error'); return; }
  w.document.write(html);
  w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 250);
}

async function sharePersonSummary(person) {
  const lines = [`*${person.name}* — HSE Summary`];
  if (person.civilId) lines.push(`Civil ID: ${person.civilId}`);
  if (person.position) lines.push(`Position: ${person.position}`);
  lines.push('');
  if ((person.courses||[]).length) {
    lines.push('*Courses:*');
    for (const c of person.courses) lines.push(`• ${c.name} — expires ${fmtDate(c.expiry)} (${statusOf(c.expiry).label})`);
  }
  if ((person.medicals||[]).length) {
    lines.push('*Medical:*');
    for (const m of person.medicals) lines.push(`• ${m.type} — expires ${fmtDate(m.expiry)} (${statusOf(m.expiry).label})`);
  }
  const text = lines.join('\n');
  try {
    if (navigator.share) { await navigator.share({ title: person.name + ' — HSE', text }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  showSubModal('Share Summary', `
    <textarea readonly rows="10" style="width:100%">${escapeHtml(text)}</textarea>
    <div class="row gap" style="margin-top:8px">
      <a class="btn" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}">WhatsApp</a>
      <a class="btn" target="_blank" rel="noopener" href="mailto:?subject=${encodeURIComponent(person.name+' — HSE Summary')}&body=${encodeURIComponent(text)}">Email</a>
      <button class="btn" id="copySummary">Copy</button>
    </div>
  `, [{ label: 'Close', class: 'btn', close: true }]);
  $('#copySummary').onclick = async () => { try { await navigator.clipboard.writeText(text); toast('Copied', 'success'); } catch { toast('Copy failed', 'error'); } };
}

async function shareCert(item, person) {
  if (!item) return;
  const lines = [];
  lines.push(`*${item.name || item.type || item.title || item.kind || 'Certificate'}*`);
  if (person && person.name) lines.push(`Holder: ${person.name}`);
  if (item.cert || item.number || item.certNo) lines.push(`No: ${item.cert || item.number || item.certNo}`);
  if (item.issued) lines.push(`Issued: ${fmtDate(item.issued)}`);
  if (item.expiry) lines.push(`Expires: ${fmtDate(item.expiry)} (${statusOf(item.expiry).label})`);
  if (item.notes) lines.push(`Notes: ${item.notes}`);
  const text = lines.join('\n');

  let files = [];
  if (item.fileId) {
    const f = await getFile(item.fileId);
    if (f) files.push(new File([f.blob], f.name || 'certificate', { type: f.type || 'application/octet-stream' }));
  }

  // Try Web Share API with files first
  try {
    if (navigator.canShare && files.length && navigator.canShare({ files })) {
      await navigator.share({ title: item.name || item.title || 'Certificate', text, files });
      return;
    }
    if (navigator.share) {
      await navigator.share({ title: item.name || item.title || 'Certificate', text });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }

  // Fallback menu
  const url = files[0] ? URL.createObjectURL(files[0]) : '';
  showSubModal('Share', `
    <div class="row gap" style="flex-direction:column;align-items:stretch">
      <textarea readonly rows="6">${escapeHtml(text)}</textarea>
      <div class="row gap">
        <a class="btn" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}">WhatsApp</a>
        <a class="btn" target="_blank" rel="noopener" href="mailto:?subject=${encodeURIComponent('Certificate: '+(item.name||item.title||''))}&body=${encodeURIComponent(text)}">Email</a>
        ${url ? `<a class="btn" href="${url}" download="${escapeHtml(files[0].name)}">Download File</a>` : ''}
        <button class="btn" id="copyShareText">Copy Text</button>
      </div>
    </div>
  `, [{ label: 'Close', class: 'btn', close: true }]);
  $('#copyShareText').onclick = async () => {
    try { await navigator.clipboard.writeText(text); toast('Copied to clipboard', 'success'); }
    catch { toast('Copy failed', 'error'); }
  };
}

// ============================================================
// GLOBAL SEARCH
// ============================================================
function buildSearchIndex() {
  const idx = [];
  for (const p of state.personnel) {
    idx.push({ type: 'Personnel', label: p.name, sub: [p.position, p.civilId].filter(Boolean).join(' • '), ref: { type: 'personnel', id: p.id }, hay: [p.name, p.civilId, p.position, p.department, p.phone, p.email].filter(Boolean).join(' ').toLowerCase() });
    for (const c of (p.courses||[])) idx.push({ type: 'Course', label: `${c.name} — ${p.name}`, sub: `Expires ${fmtDate(c.expiry)}`, ref: { type: 'personnel', id: p.id }, hay: (p.name+' '+(c.name||'')+' '+(c.cert||'')).toLowerCase() });
    for (const m of (p.medicals||[])) idx.push({ type: 'Medical', label: `${m.type} — ${p.name}`, sub: `Expires ${fmtDate(m.expiry)}`, ref: { type: 'personnel', id: p.id }, hay: (p.name+' '+(m.type||'')).toLowerCase() });
  }
  for (const d of state.documents) idx.push({ type: 'Document', label: `${d.docType} — ${d.holder||''}`, sub: d.number ? `#${d.number} • Expires ${fmtDate(d.expiry)}` : `Expires ${fmtDate(d.expiry)}`, ref: { type: 'documents', id: d.id }, hay: (d.holder+' '+d.docType+' '+(d.number||'')+' '+(d.issuer||'')).toLowerCase() });
  for (const v of state.vehicles) {
    idx.push({ type: 'Vehicle', label: v.plate, sub: [v.make, v.model, v.user].filter(Boolean).join(' • '), ref: { type: 'vehicles', id: v.id }, hay: Object.values(v).join(' ').toLowerCase() });
    for (const r of (v.records||[])) idx.push({ type: 'Vehicle Record', label: `${r.kind} — ${v.plate}`, sub: `Expires ${fmtDate(r.expiry)}`, ref: { type: 'vehicles', id: v.id }, hay: (v.plate+' '+(r.kind||'')+' '+(r.number||'')).toLowerCase() });
  }
  return idx;
}

function openGlobalSearch() {
  $('#searchOverlay').hidden = false;
  $('#globalSearchInput').value = '';
  $('#globalSearchResults').innerHTML = '<div class="muted" style="padding:20px;text-align:center">Type to search across all records…</div>';
  $('#globalSearchInput').focus();
}

function runGlobalSearch(q) {
  q = q.trim().toLowerCase();
  const wrap = $('#globalSearchResults');
  if (!q) { wrap.innerHTML = '<div class="muted" style="padding:20px;text-align:center">Type to search across all records…</div>'; return; }
  const idx = buildSearchIndex();
  const matched = idx.filter(x => x.hay.includes(q)).slice(0, 100);
  if (matched.length === 0) { wrap.innerHTML = '<div class="muted" style="padding:20px;text-align:center">No matches.</div>'; return; }
  wrap.innerHTML = matched.map((r, i) => `<div class="search-result" data-i="${i}">
    <div class="avatar">${initials(r.label)}</div>
    <div style="flex:1;min-width:0">
      <div>${escapeHtml(r.label)}</div>
      <div class="muted">${escapeHtml(r.sub||'')}</div>
    </div>
    <span class="type-tag">${r.type}</span>
  </div>`).join('');
  $$('.search-result', wrap).forEach((el, i) => el.onclick = () => { closeSearch(); jumpTo(matched[i].ref.type, matched[i].ref.id); });
}

function jumpTo(type, id) {
  location.hash = '#' + type;
  setTimeout(() => {
    if (type === 'personnel') openPersonModal(id);
    else if (type === 'documents') openDocumentModal(id);
    else if (type === 'vehicles') openVehicleModal(id);
  }, 100);
}

// ============================================================
// EXPORT / IMPORT
// ============================================================
async function exportData() {
  const payload = {
    version: 1, exportedAt: new Date().toISOString(),
    personnel: state.personnel, documents: state.documents, vehicles: state.vehicles, history: state.history, meta: state.meta,
    files: []
  };
  const files = await dbApi.all('files');
  for (const f of files) {
    const b64 = await blobToBase64(f.blob);
    payload.files.push({ id: f.id, name: f.name, type: f.type, size: f.size, dataB64: b64 });
  }
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `hse-tracker-backup-${isoDate(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Backup downloaded', 'success');
}

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}
function base64ToBlob(b64, type) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: type || 'application/octet-stream' });
}

async function importData(file) {
  try {
    const txt = await file.text();
    const data = JSON.parse(txt);
    if (!data.version) throw new Error('Invalid backup');
    if (!confirm('Importing will replace existing data. Continue?')) return;
    await dbApi.clearAll();
    for (const p of (data.personnel||[])) await dbApi.put('personnel', p);
    for (const d of (data.documents||[])) await dbApi.put('documents', d);
    for (const v of (data.vehicles||[])) await dbApi.put('vehicles', v);
    for (const h of (data.history||[])) await dbApi.put('history', h);
    for (const [k, v] of Object.entries(data.meta||{})) await dbApi.put('meta', { key: k, value: v });
    for (const f of (data.files||[])) await dbApi.put('files', { id: f.id, name: f.name, type: f.type, size: f.size, blob: base64ToBlob(f.dataB64, f.type) });
    await loadState();
    await rebuildExpiryIndex();
    route();
    toast('Import complete', 'success');
  } catch (e) {
    console.error(e);
    toast('Import failed: ' + e.message, 'error');
  }
}

async function exportHistoryCSV() {
  const rows = [['Source','Holder','Title','Cert No.','Issued','Expiry','Reason','Archived']];
  for (const h of state.history) {
    rows.push([h.source, h.refName||'', h.title||'', h.certNo||'', h.issued||'', h.expiry||'', h.reason||'', h.archivedAt||'']);
  }
  const csv = rows.map(r => r.map(x => '"'+(''+x).replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `hse-history-${isoDate(new Date())}.csv`; a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// EVENT WIRING
// ============================================================
function wireEvents() {
  window.addEventListener('hashchange', route);
  $('#menuToggle').onclick = () => $('#sidebar').classList.toggle('open');
  $('#globalSearchBtn').onclick = openGlobalSearch;
  $('#globalSearchInput').addEventListener('input', e => runGlobalSearch(e.target.value));
  $('#globalSearchInput').addEventListener('keydown', e => { if (e.key === 'Escape') closeSearch(); });
  document.addEventListener('click', e => {
    if (e.target.matches('[data-close]')) {
      if (e.target.closest('.modal')) closeModal();
      else if (e.target.closest('.lightbox')) closeLightbox();
      else if (e.target.closest('.search-overlay')) closeSearch();
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal(); closeLightbox(); closeSearch(); }
    if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); openGlobalSearch(); }
  });

  // Search/filter inputs
  ['personnelSearch','personnelSort','personnelFilter'].forEach(id => $('#'+id).addEventListener('input', renderPersonnel));
  ['medicalSearch','medicalSort'].forEach(id => $('#'+id).addEventListener('input', renderMedical));
  ['documentsSearch','documentsSort','documentsType'].forEach(id => $('#'+id).addEventListener('input', renderDocuments));
  ['vehiclesSearch','vehiclesSort'].forEach(id => $('#'+id).addEventListener('input', renderVehicles));
  ['historySearch','historySource'].forEach(id => $('#'+id).addEventListener('input', renderHistory));

  // Add buttons
  $('#addPersonBtn').onclick = () => openPersonModal();
  $('#addMedicalBtn').onclick = async () => {
    if (state.personnel.length === 0) { toast('Add a person first', 'warn'); location.hash = '#personnel'; setTimeout(() => openPersonModal(), 200); return; }
    showSubModal('Choose person', `
      <select id="chooseP" style="width:100%">
        <option value="">— Select —</option>
        ${state.personnel.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
      </select>
    `, [
      { label: 'Cancel', class: 'btn', close: true },
      { label: 'Open', class: 'btn btn-primary', action: () => {
        const pid = $('#chooseP').value; if (!pid) { toast('Select a person', 'error'); return false; }
        setTimeout(() => openPersonModal(pid), 50);
        return true;
      }}
    ]);
  };
  $('#addDocumentBtn').onclick = () => openDocumentModal();
  $('#addVehicleBtn').onclick = () => openVehicleModal();
  $('#exportHistory').onclick = exportHistoryCSV;

  // Notification
  $('#notifBtn').onclick = async () => {
    location.hash = '#alerts';
  };
  $('#enableNotifBtn').onclick = requestNotificationPerm;
  $('#testNotifBtn').onclick = () => {
    if (Notification.permission === 'granted') {
      new Notification('HSE Tracker test', { body: 'Notifications are working ✓', icon: 'icons/icon-192.png' });
    } else {
      toast('Enable notifications first', 'warn');
    }
  };

  // Dashboard
  $('#dashRefresh').onclick = () => { rebuildExpiryIndex().then(renderDashboard); };
  $('#dashShare').onclick = async () => {
    const items = collectAllExpiries();
    const lines = [`*HSE Tracker Summary — ${fmtDate(new Date())}*`];
    lines.push(`People: ${state.personnel.length}, Documents: ${state.documents.length}, Vehicles: ${state.vehicles.length}`);
    const soon = items.filter(i => statusOf(i.expiry).kind === 'soon').length;
    const exp = items.filter(i => statusOf(i.expiry).kind === 'expired').length;
    lines.push(`Expiring ≤30d: ${soon}  •  Expired: ${exp}`);
    const text = lines.join('\n');
    if (navigator.share) { try { await navigator.share({ title: 'HSE Tracker', text }); return; } catch {} }
    await navigator.clipboard?.writeText(text); toast('Summary copied', 'success');
  };

  // Settings
  $('#setNotifEnabled').onchange = async (e) => {
    if (e.target.checked) {
      const ok = await requestNotificationPerm();
      if (!ok) e.target.checked = false;
    } else {
      state.notifEnabled = false; await saveMeta('notifEnabled', false); toast('Notifications disabled', 'warn');
    }
  };
  $('#exportBtn').onclick = exportData;
  $('#importBtn').onclick = () => $('#importInput').click();
  $('#importInput').onchange = (e) => { const f = e.target.files[0]; if (f) importData(f); };
  $('#wipeBtn').onclick = async () => {
    if (!confirm('Wipe ALL data on this device? This cannot be undone.')) return;
    if (!confirm('Are you absolutely sure?')) return;
    await dbApi.clearAll();
    await loadState();
    toast('All data wiped', 'success');
    route();
  };
  $('#addCourseBtn').onclick = async () => {
    const v = $('#newCourseInput').value.trim();
    if (!v) return;
    if (state.courseCatalog.includes(v)) { toast('Already in catalog', 'warn'); return; }
    state.courseCatalog.push(v);
    await saveMeta('courseCatalog', state.courseCatalog);
    $('#newCourseInput').value = '';
    renderSettings();
  };
  $('#newCourseInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#addCourseBtn').click(); });

  // PWA install prompt
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    $('#installBtn').hidden = false;
  });
  $('#installBtn').onclick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') $('#installBtn').hidden = true;
    deferredPrompt = null;
  };
}

// ============================================================
// SEED DATA (only if empty, to give first-run a feel)
// ============================================================
async function seedIfEmpty() {
  if (state.personnel.length || state.documents.length || state.vehicles.length) return;
  const today = new Date();
  const dt = (off) => { const d = new Date(today); d.setDate(d.getDate() + off); return isoDate(d); };
  const samples = [
    {
      name: 'Hari Prasanth Thiyagarajan', civilId: '98931347', position: 'HSE Officer', department: 'Operations',
      courses: [
        { name: 'First Aid', issued: dt(-365), validity: '2y', expiry: dt(20), cert: 'FA-2024-091' },
        { name: 'HSE Induction', issued: dt(-180), validity: '3y', expiry: dt(900), cert: 'HSE-IND-552' },
        { name: 'Working at Heights', issued: dt(-400), validity: '1y', expiry: dt(-5), cert: 'WAH-2023-12' },
      ],
      medicals: [
        { type: 'Annual Fitness', issued: dt(-300), validity: '1y', expiry: dt(60), notes: 'Cleared' },
      ]
    },
    {
      name: 'Anantharaj Marimuthu', civilId: '98361782', position: 'Crane Operator', department: 'Lifting',
      courses: [
        { name: 'Lorry Loader Operator', issued: dt(-200), validity: '3y', expiry: dt(900) },
        { name: 'Banksman / Flagman', issued: dt(-90), validity: '1y', expiry: dt(275) },
      ],
      medicals: [{ type: 'Driver Medical', issued: dt(-100), validity: '1y', expiry: dt(265) }],
    },
    {
      name: 'Sadanandhan Chezhian', civilId: '', position: 'Scaffolder', department: 'Civil',
      courses: [
        { name: 'Scaffolding Awareness', issued: dt(-60), validity: '2y', expiry: dt(670) },
        { name: 'ESR', issued: dt(-720), validity: '3y', expiry: dt(360) },
      ],
      medicals: [],
    }
  ];
  for (const s of samples) {
    const person = {
      id: uid(), name: s.name, civilId: s.civilId, position: s.position, department: s.department,
      phone: '', email: '',
      courses: s.courses.map(c => ({ id: uid(), ...c })),
      medicals: s.medicals.map(m => ({ id: uid(), ...m })),
      createdAt: new Date().toISOString()
    };
    await dbApi.put('personnel', person);
    state.personnel.push(person);
  }
  const docs = [
    { id: uid(), docType: 'Resident ID', holder: 'Hari Prasanth Thiyagarajan', number: '298831427', issuer: 'Kuwait', issued: dt(-400), expiry: dt(330), createdAt: new Date().toISOString() },
    { id: uid(), docType: 'Passport', holder: 'Hari Prasanth Thiyagarajan', number: 'M9123456', issuer: 'India', issued: dt(-1100), expiry: dt(2500), createdAt: new Date().toISOString() },
    { id: uid(), docType: 'Driving License', holder: 'Anantharaj Marimuthu', number: 'DL-22-441', issuer: 'Kuwait', issued: dt(-300), expiry: dt(40), createdAt: new Date().toISOString() },
  ];
  for (const d of docs) { await dbApi.put('documents', d); state.documents.push(d); }
  const v = { id: uid(), plate: '12345 / 1', make: 'Toyota', model: 'Hilux', year: '2022', color: 'White', chassis: 'MR0FB****', user: 'Hari Prasanth',
    records: [
      { id: uid(), kind: 'Mulkia', number: 'MK-001', issued: dt(-150), validity: '1y', expiry: dt(215), notes: '' },
      { id: uid(), kind: 'Insurance', number: 'INS-9981', issued: dt(-150), validity: '1y', expiry: dt(8), notes: '' },
    ], createdAt: new Date().toISOString() };
  await dbApi.put('vehicles', v); state.vehicles.push(v);
}

// ============================================================
// BOOT
// ============================================================
async function boot() {
  try {
    DB = await openDB();
  } catch (e) {
    alert('Failed to open database: ' + e.message);
    return;
  }
  await loadState();
  await seedIfEmpty();
  await rebuildExpiryIndex();
  wireEvents();
  route();

  // Register service worker
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('sw.js'); } catch (e) { console.warn('SW failed:', e); }
  }

  // Check expiries (toast + notif)
  setTimeout(() => checkExpiryAlerts(true), 800);
}

boot();
