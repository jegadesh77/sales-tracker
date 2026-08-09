/* Sales Tracker — vanilla JS PWA, data synced to a GitHub repo via the Contents API. */

const CHANNELS = [
  { key: 'tiktok',    label: 'TikTok' },
  { key: 'shopee',    label: 'Shopee' },
  { key: 'shopee_sg', label: 'Shopee SG' },
  { key: 'lazada',    label: 'Lazada' },
  { key: 'pgmall',    label: 'PG Mall' },
  { key: 'webstore',  label: 'Webstore' },
  { key: 'walkin',    label: 'Walk-in' },
];

const LS_SETTINGS = 'st_settings_v1';
const LS_RECORDS  = 'st_records_v1';
const LS_SHA      = 'st_sha_v1';
const LS_PENDING  = 'st_pending_v1';

let settings = loadJSON(LS_SETTINGS, null);
let records  = normalizeRecords(loadJSON(LS_RECORDS, {}));  // { "2026-08-09": { tiktok: {sales,platformFee,productCost,profit}, ... } }
let fileSha  = loadJSON(LS_SHA, null);
let pending  = loadJSON(LS_PENDING, []);     // list of date strings with unsynced local changes
let currentEntryDate = todayStr();
let currentMonth = todayStr().slice(0, 7);   // "YYYY-MM"

function loadJSON(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch (e) { return fallback; }
}
function saveJSON(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function money(n) {
  n = Number(n) || 0;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* Migrate legacy { sales, cost, profit } entries to { sales, platformFee, productCost, profit }.
   Legacy "cost" is treated as product cost with platform fee 0, so totals and profit stay unchanged. */
function normalizeDay(day) {
  const out = {};
  CHANNELS.forEach(c => {
    const v = (day && day[c.key]) || {};
    if (v.platformFee !== undefined || v.productCost !== undefined) {
      out[c.key] = {
        sales: v.sales ?? '',
        platformFee: v.platformFee ?? '',
        productCost: v.productCost ?? '',
        profit: v.profit ?? '',
      };
    } else {
      out[c.key] = {
        sales: v.sales ?? '',
        platformFee: '',
        productCost: v.cost ?? '',
        profit: v.profit ?? '',
      };
    }
  });
  return out;
}
function normalizeRecords(recs) {
  const out = {};
  Object.keys(recs || {}).forEach(d => { out[d] = normalizeDay(recs[d]); });
  return out;
}

/* ---------------- GitHub sync ---------------- */

function ghConfigured() {
  return settings && settings.owner && settings.repo && settings.token;
}

function ghUrl() {
  const path = (settings.path || 'data/records.json');
  return `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${path}`;
}

async function ghFetchRecords() {
  if (!ghConfigured()) return { ok: false, reason: 'not-configured' };
  setSyncDot('busy');
  try {
    const res = await fetch(`${ghUrl()}?ref=${encodeURIComponent(settings.branch || 'main')}`, {
      headers: { Authorization: `Bearer ${settings.token}`, Accept: 'application/vnd.github+json' }
    });
    if (res.status === 404) {
      fileSha = null;
      saveJSON(LS_SHA, fileSha);
      setSyncDot('ok');
      return { ok: true, notFound: true };
    }
    if (!res.ok) {
      setSyncDot('err');
      return { ok: false, reason: `HTTP ${res.status}` };
    }
    const data = await res.json();
    fileSha = data.sha;
    saveJSON(LS_SHA, fileSha);
    const jsonStr = b64DecodeUnicode(data.content.replace(/\n/g, ''));
    const parsed = JSON.parse(jsonStr);
    records = normalizeRecords(parsed.records || {});
    saveJSON(LS_RECORDS, records);
    setSyncDot('ok');
    return { ok: true };
  } catch (e) {
    setSyncDot('err');
    return { ok: false, reason: e.message };
  }
}

async function ghPushRecords(commitMessage) {
  if (!ghConfigured()) return { ok: false, reason: 'not-configured' };
  setSyncDot('busy');
  const body = {
    message: commitMessage || `Update sales record ${todayStr()}`,
    content: b64EncodeUnicode(JSON.stringify({ records }, null, 2)),
    branch: settings.branch || 'main',
  };
  if (fileSha) body.sha = fileSha;
  try {
    const res = await fetch(ghUrl(), {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${settings.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      setSyncDot('err');
      // sha mismatch -> someone/something else updated the file since we last read it
      if (res.status === 409 || (errBody.message || '').includes('does not match')) {
        return { ok: false, reason: 'conflict' };
      }
      return { ok: false, reason: errBody.message || `HTTP ${res.status}` };
    }
    const data = await res.json();
    fileSha = data.content.sha;
    saveJSON(LS_SHA, fileSha);
    setSyncDot('ok');
    return { ok: true };
  } catch (e) {
    setSyncDot('err');
    return { ok: false, reason: e.message };
  }
}

function b64EncodeUnicode(str) {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (m, p1) => String.fromCharCode('0x' + p1)));
}
function b64DecodeUnicode(str) {
  return decodeURIComponent(atob(str).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
}

function setSyncDot(state) {
  const dot = document.getElementById('syncDot');
  if (!dot) return;
  dot.className = 'sync-dot ' + (state || '');
}

/* Try to sync one date's record. On conflict, re-fetch remote, re-merge just this date, retry once. */
async function syncDate(dateStr) {
  if (!ghConfigured()) {
    if (!pending.includes(dateStr)) pending.push(dateStr);
    saveJSON(LS_PENDING, pending);
    return { ok: false, reason: 'not-configured' };
  }
  let result = await ghPushRecords(`Update sales record ${dateStr}`);
  if (!result.ok && result.reason === 'conflict') {
    const remote = await ghFetchRecords();
    if (remote.ok) {
      // re-apply this date's local values on top of the freshly-pulled remote
      const local = loadJSON(LS_RECORDS, {});
      records[dateStr] = local[dateStr];
      result = await ghPushRecords(`Update sales record ${dateStr}`);
    }
  }
  if (result.ok) {
    pending = pending.filter(d => d !== dateStr);
    saveJSON(LS_PENDING, pending);
  } else {
    if (!pending.includes(dateStr)) pending.push(dateStr);
    saveJSON(LS_PENDING, pending);
  }
  return result;
}

async function syncAllPending() {
  if (!ghConfigured() || pending.length === 0) return;
  for (const d of [...pending]) {
    await syncDate(d);
  }
  renderPendingBadges();
}

/* ---------------- Entry view ---------------- */

function emptyDay() {
  const day = {};
  CHANNELS.forEach(c => { day[c.key] = { sales: '', platformFee: '', productCost: '', profit: '' }; });
  return day;
}

function renderEntryView() {
  document.getElementById('entryDate').value = currentEntryDate;
  const day = records[currentEntryDate] || emptyDay();
  const container = document.getElementById('channelCards');
  container.innerHTML = '';
  CHANNELS.forEach(c => {
    const v = day[c.key] || { sales: '', platformFee: '', productCost: '', profit: '' };
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h2>${c.label} <span class="subtotal" data-role="chsub-${c.key}">RM 0.00</span></h2>
      <div class="field-row">
        <div class="field"><label>Sales</label><input type="number" inputmode="decimal" step="0.01" data-ch="${c.key}" data-f="sales" value="${v.sales}"></div>
        <div class="field"><label>Platform Fee</label><input type="number" inputmode="decimal" step="0.01" data-ch="${c.key}" data-f="platformFee" value="${v.platformFee}"></div>
        <div class="field"><label>Product Cost</label><input type="number" inputmode="decimal" step="0.01" data-ch="${c.key}" data-f="productCost" value="${v.productCost}"></div>
        <div class="field"><label>Profit</label><input type="number" inputmode="decimal" step="0.01" data-ch="${c.key}" data-f="profit" value="${v.profit}"></div>
      </div>`;
    container.appendChild(card);
  });
  container.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', onFieldInput);
  });
  updateDayTotals();
}

function onFieldInput(e) {
  const ch = e.target.dataset.ch, f = e.target.dataset.f;
  // auto-suggest profit = sales - platformFee - productCost, only if the user hasn't typed a profit value yet
  if (f === 'sales' || f === 'platformFee' || f === 'productCost') {
    const salesInp = document.querySelector(`input[data-ch="${ch}"][data-f="sales"]`);
    const feeInp   = document.querySelector(`input[data-ch="${ch}"][data-f="platformFee"]`);
    const costInp  = document.querySelector(`input[data-ch="${ch}"][data-f="productCost"]`);
    const profitInp = document.querySelector(`input[data-ch="${ch}"][data-f="profit"]`);
    if (profitInp.dataset.touched !== '1') {
      const s = parseFloat(salesInp.value) || 0;
      const fee = parseFloat(feeInp.value) || 0;
      const c = parseFloat(costInp.value) || 0;
      profitInp.value = (s - fee - c).toFixed(2);
    }
  }
  if (f === 'profit') e.target.dataset.touched = '1';
  updateDayTotals();
}

function updateDayTotals() {
  let totSales = 0, totFee = 0, totCost = 0, totProfit = 0;
  CHANNELS.forEach(c => {
    const s = parseFloat(document.querySelector(`input[data-ch="${c.key}"][data-f="sales"]`)?.value) || 0;
    const fee = parseFloat(document.querySelector(`input[data-ch="${c.key}"][data-f="platformFee"]`)?.value) || 0;
    const co = parseFloat(document.querySelector(`input[data-ch="${c.key}"][data-f="productCost"]`)?.value) || 0;
    const p = parseFloat(document.querySelector(`input[data-ch="${c.key}"][data-f="profit"]`)?.value) || 0;
    totSales += s; totFee += fee; totCost += co; totProfit += p;
    const subEl = document.querySelector(`[data-role="chsub-${c.key}"]`);
    if (subEl) subEl.textContent = `RM ${money(s)}`;
  });
  document.getElementById('totSales').textContent = `RM ${money(totSales)}`;
  document.getElementById('totFee').textContent = `RM ${money(totFee)}`;
  document.getElementById('totCost').textContent = `RM ${money(totCost)}`;
  document.getElementById('totProfit').textContent = `RM ${money(totProfit)}`;
}

function collectDayFromForm() {
  const day = {};
  CHANNELS.forEach(c => {
    day[c.key] = {
      sales:       document.querySelector(`input[data-ch="${c.key}"][data-f="sales"]`).value || '0',
      platformFee: document.querySelector(`input[data-ch="${c.key}"][data-f="platformFee"]`).value || '0',
      productCost: document.querySelector(`input[data-ch="${c.key}"][data-f="productCost"]`).value || '0',
      profit:      document.querySelector(`input[data-ch="${c.key}"][data-f="profit"]`).value || '0',
    };
  });
  return day;
}

async function onSave() {
  const statusEl = document.getElementById('entryStatus');
  const btn = document.getElementById('saveBtn');
  const day = collectDayFromForm();
  records[currentEntryDate] = day;
  saveJSON(LS_RECORDS, records);
  btn.disabled = true;
  statusEl.className = 'status-msg';
  statusEl.textContent = ghConfigured() ? 'Saving to GitHub…' : 'Saved on this phone (GitHub not set up — see Settings).';
  if (ghConfigured()) {
    const result = await syncDate(currentEntryDate);
    if (result.ok) {
      statusEl.className = 'status-msg ok';
      statusEl.textContent = `Saved & synced to GitHub (${currentEntryDate}).`;
    } else if (result.reason === 'not-configured') {
      statusEl.className = 'status-msg';
      statusEl.textContent = 'Saved on this phone. Set up GitHub in Settings to back it up.';
    } else {
      statusEl.className = 'status-msg err';
      statusEl.textContent = `Saved on phone, but GitHub sync failed (${result.reason}). Will retry automatically.`;
    }
  }
  btn.disabled = false;
  renderPendingBadges();
  renderHistoryView();
  renderMonthlyView();
}

/* ---------------- History view ---------------- */

function renderHistoryView() {
  const list = document.getElementById('historyList');
  const dates = Object.keys(records).sort().reverse();
  if (dates.length === 0) {
    list.innerHTML = '<div class="empty-state">No entries yet. Add today\'s sales on the Entry tab.</div>';
    return;
  }
  list.innerHTML = '';
  dates.forEach(d => {
    const day = records[d];
    let sales = 0, profit = 0;
    CHANNELS.forEach(c => {
      sales += parseFloat(day[c.key]?.sales) || 0;
      profit += parseFloat(day[c.key]?.profit) || 0;
    });
    const row = document.createElement('div');
    row.className = 'history-item';
    const isPending = pending.includes(d);
    row.innerHTML = `
      <div>
        <div class="d">${d}${isPending ? '<span class="pending-badge">not synced</span>' : ''}</div>
        <div class="m">Sales RM ${money(sales)}</div>
      </div>
      <div class="amt"><b>RM ${money(profit)}</b><span>profit</span></div>`;
    row.addEventListener('click', () => {
      currentEntryDate = d;
      switchView('entry');
    });
    list.appendChild(row);
  });
}

function renderPendingBadges() {
  const nav = document.getElementById('tabHistory');
  if (pending.length > 0) {
    nav.querySelector('.ic').textContent = '📜';
    nav.title = `${pending.length} day(s) not yet synced`;
  }
}

/* ---------------- Monthly view ---------------- */

function shiftMonth(delta) {
  const [y, m] = currentMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  currentMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  renderMonthlyView();
}

function renderMonthlyView() {
  document.getElementById('monthLabel').textContent = monthLabel(currentMonth);
  const dates = Object.keys(records).filter(d => d.startsWith(currentMonth));
  const totals = {};
  CHANNELS.forEach(c => totals[c.key] = { sales: 0, platformFee: 0, productCost: 0, profit: 0 });
  let grand = { sales: 0, platformFee: 0, productCost: 0, profit: 0 };
  dates.forEach(d => {
    const day = records[d];
    CHANNELS.forEach(c => {
      const v = day[c.key] || {};
      const s = parseFloat(v.sales) || 0, fee = parseFloat(v.platformFee) || 0, co = parseFloat(v.productCost) || 0, p = parseFloat(v.profit) || 0;
      totals[c.key].sales += s; totals[c.key].platformFee += fee; totals[c.key].productCost += co; totals[c.key].profit += p;
      grand.sales += s; grand.platformFee += fee; grand.productCost += co; grand.profit += p;
    });
  });
  const tbody = document.getElementById('monthTableBody');
  tbody.innerHTML = '';
  CHANNELS.forEach(c => {
    const t = totals[c.key];
    if (t.sales === 0 && t.platformFee === 0 && t.productCost === 0 && t.profit === 0) return;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${c.label}</td><td>${money(t.sales)}</td><td>${money(t.platformFee)}</td><td>${money(t.productCost)}</td><td>${money(t.profit)}</td>`;
    tbody.appendChild(tr);
  });
  document.getElementById('monthFootSales').textContent = money(grand.sales);
  document.getElementById('monthFootFee').textContent = money(grand.platformFee);
  document.getElementById('monthFootCost').textContent = money(grand.productCost);
  document.getElementById('monthFootProfit').textContent = money(grand.profit);
  document.getElementById('monthDaysCount').textContent = `${dates.length} day(s) recorded`;
}

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/* ---------------- Settings view ---------------- */

function renderSettingsView() {
  const s = settings || {};
  document.getElementById('setOwner').value = s.owner || '';
  document.getElementById('setRepo').value = s.repo || '';
  document.getElementById('setBranch').value = s.branch || 'main';
  document.getElementById('setPath').value = s.path || 'data/records.json';
  document.getElementById('setToken').value = s.token || '';
}

async function onSaveSettings() {
  settings = {
    owner: document.getElementById('setOwner').value.trim(),
    repo: document.getElementById('setRepo').value.trim(),
    branch: document.getElementById('setBranch').value.trim() || 'main',
    path: document.getElementById('setPath').value.trim() || 'data/records.json',
    token: document.getElementById('setToken').value.trim(),
  };
  saveJSON(LS_SETTINGS, settings);
  const statusEl = document.getElementById('settingsStatus');
  statusEl.className = 'status-msg';
  statusEl.textContent = 'Testing connection…';
  const result = await ghFetchRecords();
  if (result.ok && result.notFound) {
    statusEl.className = 'status-msg ok';
    statusEl.textContent = 'Connected. No records file yet — it will be created on your first save.';
  } else if (result.ok) {
    statusEl.className = 'status-msg ok';
    statusEl.textContent = 'Connected and pulled existing records.';
    renderHistoryView();
    renderMonthlyView();
    renderEntryView();
  } else {
    statusEl.className = 'status-msg err';
    statusEl.textContent = `Could not connect (${result.reason}). Check owner/repo/token.`;
  }
}

/* ---------------- Navigation ---------------- */

function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelectorAll('nav.tabbar button').forEach(b => b.classList.remove('active'));
  document.getElementById('tab' + name.charAt(0).toUpperCase() + name.slice(1)).classList.add('active');
  if (name === 'entry') renderEntryView();
  if (name === 'history') renderHistoryView();
  if (name === 'monthly') renderMonthlyView();
  if (name === 'settings') renderSettingsView();
}

/* ---------------- Init ---------------- */

window.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('entryDate').addEventListener('change', (e) => {
    currentEntryDate = e.target.value;
    renderEntryView();
  });
  document.getElementById('saveBtn').addEventListener('click', onSave);
  document.getElementById('tabEntry').addEventListener('click', () => switchView('entry'));
  document.getElementById('tabHistory').addEventListener('click', () => switchView('history'));
  document.getElementById('tabMonthly').addEventListener('click', () => switchView('monthly'));
  document.getElementById('tabSettings').addEventListener('click', () => switchView('settings'));
  document.getElementById('prevMonth').addEventListener('click', () => shiftMonth(-1));
  document.getElementById('nextMonth').addEventListener('click', () => shiftMonth(1));
  document.getElementById('saveSettingsBtn').addEventListener('click', onSaveSettings);
  document.getElementById('syncNowBtn').addEventListener('click', async () => {
    const r = await ghFetchRecords();
    if (r.ok) { await syncAllPending(); renderHistoryView(); renderMonthlyView(); renderEntryView(); }
  });

  switchView('entry');
  renderPendingBadges();

  if (ghConfigured()) {
    await ghFetchRecords();
    await syncAllPending();
    renderEntryView();
    renderHistoryView();
    renderMonthlyView();
  }

  window.addEventListener('online', syncAllPending);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
});
