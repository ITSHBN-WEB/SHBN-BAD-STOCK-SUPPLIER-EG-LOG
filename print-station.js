/* =========================================================================
   SHBN Print Station — multi-app version
   Kept open on the office computer. Polls EVERY app's Apps Script backend
   listed in PRINT_SOURCES for pending print requests (queued by each app's
   IT Entry "Send to Print Station" button) and lets staff here print or
   cancel them, regardless of which app they came from.

   To add another app later: add an entry to PRINT_SOURCES below with that
   app's deployed /exec URL, and make sure that app's own Code.gs has the
   same requestPrint / getPrintQueue / updatePrintStatus /
   getPrintRequestStatus endpoints (Bad Stock Supplier/EG's Code.gs and Bad
   Stock Fresh Market's Code.gs both already have them).
   ========================================================================= */

const PRINT_SOURCES = [
  {
    id: 'supplier_eg',
    label: 'Bad Stock Supplier/EG',
    webAppUrl: 'https://script.google.com/macros/s/AKfycbwRqhGs_op3u7UcfpTu9qSPnRjkTKOvYhZHgpBwFMhekrchT6hALVSwsmkO7G6Z0u4Z/exec' // same URL as Supplier/EG's app.js
  },
  {
    id: 'fresh_market',
    label: 'Bad Stock Fresh Market',
    webAppUrl: 'https://script.google.com/macros/s/AKfycbwg2_9PLumzPLimQEV7-Ym-UvEXPhlyvqGLzzl8T24WLUnDWHw-j3OPrBkOphJGm52l/exec' // same URL as Fresh Market's index.html
  }
];

// Was 5000ms — polling both apps' getPrintQueue() every 5 seconds, each of
// which scans every month-tab looking for matching rows, adds up fast over
// a full day and can exhaust Apps Script's daily execution quota (especially
// on a free/personal Gmail account), which then breaks EVERYTHING using
// that script project — not just the Print Station. Widened to 20s as a
// much lighter load; a 15-20s delay before a new print request is noticed
// is an acceptable tradeoff against the whole app going down.
const POLL_INTERVAL_MS = 20000;

let knownRequestKeys = null; // null until first poll completes, so we don't notify for items already pending on load
let pendingPrint = null; // { requestId, sourceId } — request currently in the native print dialog

/* ---------------------------------------------------------------------- */
/* API helpers (take a base URL since there are now multiple backends)     */
/* ---------------------------------------------------------------------- */

async function apiGet(baseUrl, action, params) {
  const url = new URL(baseUrl);
  url.searchParams.set('action', action);
  Object.keys(params || {}).forEach(function (k) { url.searchParams.set(k, params[k]); });
  const res = await fetch(url.toString());
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Request failed.');
  return json.data;
}

async function apiPost(baseUrl, action, payload) {
  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: action, payload: payload, params: payload }) // "params" too: Fresh Market's backend reads params, Supplier/EG's reads payload
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Request failed.');
  return json.data;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function sourceById(id) {
  return PRINT_SOURCES.find(function (s) { return s.id === id; });
}

// Not in style.css, so injected here once — blinking red warning line shown
// on a queue card when its batch still has item(s) not in the Masterlist.
(function injectUnmatchedWarningStyle() {
  var style = document.createElement('style');
  style.textContent =
    '.ps-unmatched-warn{display:block;font-size:12px;font-weight:700;font-style:italic;color:#ef4444;margin-top:4px;animation:ps-unmatched-blink 1.1s ease-in-out infinite;}' +
    '@keyframes ps-unmatched-blink{0%,100%{opacity:1;}50%{opacity:0.25;}}' +
    '.btn-print:disabled{opacity:0.45;cursor:not-allowed;}';
  document.head.appendChild(style);
})();

/* ---------------------------------------------------------------------- */
/* Notifications                                                           */
/* ---------------------------------------------------------------------- */

document.getElementById('btnEnableNotify').addEventListener('click', function () {
  if (!('Notification' in window)) {
    document.getElementById('notifyStatus').textContent = 'This browser does not support desktop notifications.';
    return;
  }
  Notification.requestPermission().then(updateNotifyStatus);
});

function updateNotifyStatus() {
  const el = document.getElementById('notifyStatus');
  if (!('Notification' in window)) { el.textContent = ''; return; }
  if (Notification.permission === 'granted') el.textContent = 'Notifications are on.';
  else if (Notification.permission === 'denied') el.textContent = 'Notifications are blocked in this browser — you\u2019ll need to allow them from the browser\u2019s site settings.';
  else el.textContent = 'Notifications are off.';
}
updateNotifyStatus();

function contextLabel(item) {
  if (!item.context) return 'Details unavailable';
  const c = item.context;
  if (item.sourceId === 'fresh_market') {
    return [c.staff, c.supervisor, c.category, c.itemCount + ' item(s)'].filter(Boolean).join(' \u00b7 ');
  }
  return [c.staffSupervisor, c.badStockCategory, c.itemCount + ' item(s)'].filter(Boolean).join(' \u00b7 ');
}

function notifyNewRequest(item) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const source = sourceById(item.sourceId);
  const n = new Notification('New print request \u2014 ' + (source ? source.label : ''), { body: contextLabel(item) });
  n.onclick = function () { window.focus(); };
}

/* ---------------------------------------------------------------------- */
/* Queue polling + rendering                                               */
/* ---------------------------------------------------------------------- */

async function pollQueue() {
  const statusEl = document.getElementById('pollStatus');
  try {
    const perSourceResults = await Promise.all(PRINT_SOURCES.map(function (source) {
      return apiGet(source.webAppUrl, 'getPrintQueue')
        .then(function (items) {
          return items.map(function (it) {
            it.sourceId = source.id;
            it.key = source.id + '::' + it.requestId;
            return it;
          });
        })
        .catch(function (err) {
          return { error: source.label + ': ' + err.message };
        });
    }));

    const errors = perSourceResults.filter(function (r) { return r && r.error; });
    const items = [].concat.apply([], perSourceResults.filter(function (r) { return Array.isArray(r); }));

    renderQueue(items);

    const currentKeys = items.map(function (it) { return it.key; });
    if (knownRequestKeys === null) {
      knownRequestKeys = new Set(currentKeys); // first load: don't notify for pre-existing requests
    } else {
      items.forEach(function (it) {
        if (!knownRequestKeys.has(it.key)) notifyNewRequest(it);
      });
      knownRequestKeys = new Set(currentKeys);
    }

    if (errors.length) {
      statusEl.className = 'ps-status';
      statusEl.textContent = 'Problem reaching: ' + errors.map(function (e) { return e.error; }).join('; ');
    } else {
      statusEl.className = 'ps-status live';
      statusEl.innerHTML = '<span class="pulse"></span>Live \u2014 last checked ' + new Date().toLocaleTimeString();
    }
  } catch (err) {
    statusEl.className = 'ps-status';
    statusEl.textContent = 'Could not reach the backend: ' + err.message;
  }
}

function renderQueue(items) {
  const container = document.getElementById('queueList');
  container.innerHTML = '';
  if (!items.length) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = '<p class="empty-note">No pending print requests.</p>';
    container.appendChild(card);
    return;
  }
  items.forEach(function (item) {
    const source = sourceById(item.sourceId);
    const unmatchedCount = (item.context && item.context.unmatchedCount) || 0;
    const card = document.createElement('div');
    card.className = 'card ps-item';
    card.innerHTML =
      '<div class="ps-main">' +
      '<span class="ps-app">' + escapeHtml(source ? source.label : item.sourceId) + '</span>' +
      '<span class="ps-meta">' + escapeHtml(contextLabel(item)) + '</span>' +
      '<span class="ps-meta">Requested ' + escapeHtml(item.requestedAt) + '</span>' +
      (unmatchedCount > 0
        ? '<span class="ps-unmatched-warn">! ' + unmatchedCount + ' item(s) is not in masterlist. Please check.</span>'
        : '') +
      '</div>' +
      '<div class="ps-actions">' +
      '<button class="btn btn-secondary btn-cancel" data-key="' + item.key + '">Cancel</button>' +
      '<button class="btn btn-primary btn-print" data-key="' + item.key + '"' + (unmatchedCount > 0 ? ' disabled title="Some data is not in the masterlist. Please check."' : '') + '>Print</button>' +
      '</div>';
    container.appendChild(card);
    card.dataset.item = JSON.stringify(item);
  });
}

document.getElementById('queueList').addEventListener('click', async function (e) {
  const printBtn = e.target.closest('.btn-print');
  const cancelBtn = e.target.closest('.btn-cancel');

  if (printBtn) {
    const item = JSON.parse(printBtn.closest('.card').dataset.item);
    const source = sourceById(item.sourceId);
    printBtn.disabled = true;
    try {
      await handlePrint(item, source);
    } catch (err) {
      alert('Could not load this transaction: ' + err.message);
    } finally {
      printBtn.disabled = false;
    }
  }

  if (cancelBtn) {
    const item = JSON.parse(cancelBtn.closest('.card').dataset.item);
    const source = sourceById(item.sourceId);
    const ok = confirm('Cancel this print request without printing it?');
    if (!ok) return;
    cancelBtn.disabled = true;
    try {
      await apiPost(source.webAppUrl, 'updatePrintStatus', { requestId: item.requestId, status: 'CANCELLED' });
      pollQueue();
    } catch (err) {
      alert(err.message);
      cancelBtn.disabled = false;
    }
  }
});

/* ---------------------------------------------------------------------- */
/* Printing — each app has its own data shape, so its own render function  */
/* ---------------------------------------------------------------------- */

async function handlePrint(item, source) {
  if (item.sourceId === 'fresh_market') {
    const data = await apiGet(source.webAppUrl, 'getBatchPrintData', { txnId: item.txnId });
    // Re-check against the freshest data available, in case the queue list
    // is up to a poll interval stale (or the button was clicked before it
    // re-rendered as disabled) — the disabled state above is a UX hint, not
    // the real gate.
    const stillUnmatched = data.items.some(function (it) { return !it.description; });
    if (stillUnmatched) {
      alert('Some data is not in the masterlist. Please check.');
      return;
    }
    renderPrintAreaFreshMarket(data);
  } else {
    const data = await apiGet(source.webAppUrl, 'getTransaction', { txnId: item.txnId });
    const first = data.entries[0];
    renderPrintAreaSupplierEg({
      staffSupervisor: first.staffSupervisor,
      badStockCategory: first.badStockCategory,
      date: first.date,
      materialDocument: first.materialDocument || '',
      keyInBy: first.keyInBy || '',
      keyInDate: first.keyInDate || '',
      entries: data.entries.map(function (en) {
        return { material: en.material, eanUpc: en.eanUpc, description: en.description, quantity: en.quantity, salesUnit: en.salesUnit, reason: en.reason };
      })
    });
  }
  pendingPrint = { requestId: item.requestId, sourceId: item.sourceId };
  window.print();
}

// Fires once the native print dialog closes (Print or Cancel from that
// dialog can't be reliably distinguished across browsers), so this marks
// the request as PRINTED — use the Cancel button in the list above to
// reject a request before it ever reaches this dialog.
window.addEventListener('afterprint', async function () {
  if (!pendingPrint) return;
  const { requestId, sourceId } = pendingPrint;
  const source = sourceById(sourceId);
  pendingPrint = null;
  try {
    await apiPost(source.webAppUrl, 'updatePrintStatus', { requestId: requestId, status: 'PRINTED' });
  } catch (err) {
    // non-fatal — queue will just show it as pending again next poll
  }
  pollQueue();
});

// ---- Bad Stock Supplier/EG print layout ----
function renderPrintAreaSupplierEg(t) {
  const rows = t.entries.map(function (en) {
    return '<tr><td>' + escapeHtml(en.material) + '</td><td>' + escapeHtml(en.eanUpc) + '</td><td>' + escapeHtml(en.description) + '</td>' +
      '<td>' + en.quantity + '</td><td>' + escapeHtml(en.salesUnit) + '</td><td>' + escapeHtml(en.reason) + '</td></tr>';
  }).join('');

  const blank = '__________________';

  document.getElementById('printArea').innerHTML =
    '<div class="print-header">' +
    '<div class="print-title">SHBN - BAD STOCK SUPPLIER/EG LOG</div>' +
    '<div class="print-outlet">OUTLET: SEGSHBN</div>' +
    '<div class="print-meta">' +
    '<span><strong>Date:</strong> ' + escapeHtml(t.date) + '</span>' +
    '<span><strong>Category:</strong> ' + escapeHtml(t.badStockCategory) + '</span>' +
    '<span><strong>Staff / Supervisor:</strong> ' + escapeHtml(t.staffSupervisor) + '</span>' +
    '</div>' +
    '</div>' +
    '<div class="print-body">' +
    '<table class="print-table"><thead><tr><th>Material</th><th>Product Code</th><th>Description</th><th>Qty</th><th>Unit</th><th>Reason</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table>' +
    '<div class="print-sign"><span>Staff / Supervisor</span><span>Manager</span></div>' +
    '<div class="print-itonly">FOR IT USE ONLY</div>' +
    '<div class="print-fields">' +
    '<div><span class="pf-label">Material document</span><span>: ' + (t.materialDocument ? escapeHtml(t.materialDocument) : blank) + '</span></div>' +
    '<div><span class="pf-label">Key in by</span><span>: ' + (t.keyInBy ? escapeHtml(t.keyInBy) : blank) + '</span></div>' +
    '<div><span class="pf-label">Date</span><span>: ' + (t.keyInDate ? escapeHtml(t.keyInDate) : blank) + '</span></div>' +
    '</div>' +
    '</div>';
}

// ---- Bad Stock Fresh Market print layout ----
// This mirrors Fresh Market's OWN local print template (openPrintView() in
// that app's Index.html) instead of Supplier/EG's print-header/print-table
// layout — the two apps have visually distinct printed slips, so each gets
// its own render function here. Classes below are prefixed "fm-" and defined
// via an injected <style> block scoped to ".fm-print" so they can never
// collide with Supplier/EG's print-* classes from style.css, since both
// templates take turns using the same #printArea element depending on which
// request is being printed.
function renderPrintAreaFreshMarket(p) {
  const rows = p.items.map(function (it) {
    return '<tr><td>' + escapeHtml(it.plu) + '</td><td>' + escapeHtml(it.description || '') + '</td><td>' + escapeHtml(String(it.qty)) + '</td><td>' + escapeHtml(it.uom || '') + '</td></tr>';
  }).join('');

  document.getElementById('printArea').innerHTML =
    '<style>' +
    '.fm-print{font-family:Georgia, "Times New Roman", serif;color:#222;}' +
    '.fm-print .fm-title{text-align:center;font-size:20px;font-weight:700;letter-spacing:0.5px;margin-bottom:2px;}' +
    '.fm-print .fm-subtitle{text-align:center;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:1px;margin-bottom:16px;}' +
    '.fm-print .fm-meta{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;font-size:13px;margin-bottom:14px;border-top:1px solid #999;border-bottom:1px solid #999;padding:10px 0;}' +
    '.fm-print .fm-meta div span{color:#666;}' +
    '.fm-print .fm-meta div b{display:block;font-size:14px;}' +
    '.fm-print table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:30px;}' +
    '.fm-print thead{display:table-header-group;}' + /* explicit: repeat this on every printed page */
    '.fm-print tr{page-break-inside:avoid;}' +
    '.fm-print th,.fm-print td{border:1px solid #999;padding:8px 10px;text-align:left;}' +
    '.fm-print th.fm-col-head{background:#eee;text-transform:uppercase;font-size:11px;letter-spacing:0.3px;}' +
    '.fm-print .fm-sign-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:50px;page-break-inside:avoid;}' +
    '.fm-print .fm-sign-box{font-size:12px;}' +
    '.fm-print .fm-sign-line{border-top:1px solid #333;margin-top:40px;padding-top:6px;}' +
    '.fm-print .fm-sign-label{font-weight:700;text-transform:uppercase;font-size:10.5px;letter-spacing:0.4px;color:#444;}' +
    '</style>' +
    '<div class="fm-print">' +
    '<div class="fm-title">SHBN &mdash; Bad Stock Log</div>' +
    '<div class="fm-subtitle">Bad Stock Report</div>' +
    '<div class="fm-meta">' +
    '<div><span>Date</span><b>' + escapeHtml(p.date) + (p.time ? ', ' + escapeHtml(p.time) : '') + '</b></div>' +
    '<div><span>Bad Stock Category</span><b>' + escapeHtml(p.category) + '</b></div>' +
    '<div><span>Staff</span><b>' + escapeHtml(p.staff) + '</b></div>' +
    '<div><span>Supervisor</span><b>' + escapeHtml(p.supervisor) + '</b></div>' +
    '<div><span>Material Document</span><b>' + (p.materialDocument ? escapeHtml(p.materialDocument) : '') + '</b></div>' +
    '<div><span>Key In By</span><b>' + (p.keyInBy ? escapeHtml(p.keyInBy) : '') + '</b></div>' +
    '</div>' +
    '<table>' +
    '<thead><tr><th class="fm-col-head">PLU / Product Code</th><th class="fm-col-head">Description</th><th class="fm-col-head">Quantity</th><th class="fm-col-head">UOM</th></tr></thead>' +
    '<tbody>' + rows + '</tbody>' +
    '</table>' +
    '<div class="fm-sign-grid">' +
    '<div class="fm-sign-box"><div class="fm-sign-line"></div><div class="fm-sign-label">Staff</div>' + escapeHtml(p.staff) + '</div>' +
    '<div class="fm-sign-box"><div class="fm-sign-line"></div><div class="fm-sign-label">Supervisor</div>' + escapeHtml(p.supervisor) + '</div>' +
    '<div class="fm-sign-box"><div class="fm-sign-line"></div><div class="fm-sign-label">Manager</div>&nbsp;</div>' +
    '<div class="fm-sign-box"><div class="fm-sign-line"></div><div class="fm-sign-label">Key In By</div>' + (p.keyInBy ? escapeHtml(p.keyInBy) : '') + '</div>' +
    '</div>' +
    '</div>';
}

/* ---------------------------------------------------------------------- */
/* Boot                                                                     */
/* ---------------------------------------------------------------------- */

// Manual refresh — lets staff immediately re-check the queue (picking up,
// e.g., an admin having just added a previously-missing PLU to the
// Masterlist) instead of waiting up to POLL_INTERVAL_MS for the next
// automatic poll. Guarded in case index.html hasn't been updated with the
// button yet, so this file doesn't error out on load.
var btnRefreshQueue = document.getElementById('btnRefreshQueue');
if (btnRefreshQueue) {
  btnRefreshQueue.addEventListener('click', function () {
    btnRefreshQueue.disabled = true;
    pollQueue().finally(function () { btnRefreshQueue.disabled = false; });
  });
}

pollQueue();
setInterval(pollQueue, POLL_INTERVAL_MS);
