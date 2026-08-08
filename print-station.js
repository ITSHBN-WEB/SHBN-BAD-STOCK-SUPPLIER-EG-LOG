/* =========================================================================
   SHBN Bad Stock Log — Print Station
   Kept open on the office computer. Polls the Apps Script backend for
   pending print requests (queued by IT Entry's Print button) and lets
   staff here either print them or cancel them.
   ========================================================================= */

// Must match the WEB_APP_URL used in app.js.
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwRqhGs_op3u7UcfpTu9qSPnRjkTKOvYhZHgpBwFMhekrchT6hALVSwsmkO7G6Z0u4Z/exec';
const OUTLET_NAME = 'SEGSHBN';
const POLL_INTERVAL_MS = 5000;

let knownRequestIds = null; // null until first poll completes, so we don't notify for items already pending on load
let pendingPrintRequestId = null; // request currently in the native print dialog

/* ---------------------------------------------------------------------- */
/* API helpers                                                             */
/* ---------------------------------------------------------------------- */

async function apiGet(action, params) {
  const url = new URL(WEB_APP_URL);
  url.searchParams.set('action', action);
  Object.keys(params || {}).forEach(function (k) { url.searchParams.set(k, params[k]); });
  const res = await fetch(url.toString());
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Request failed.');
  return json.data;
}

async function apiPost(action, payload) {
  const res = await fetch(WEB_APP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: action, payload: payload })
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

function notifyNewRequest(item) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const body = item.context
    ? (item.context.staffSupervisor + ' \u00b7 ' + item.context.badStockCategory + ' \u00b7 ' + item.context.itemCount + ' item(s)')
    : ('Transaction ' + item.txnId);
  const n = new Notification('New print request', { body: body });
  n.onclick = function () { window.focus(); };
}

/* ---------------------------------------------------------------------- */
/* Queue polling + rendering                                               */
/* ---------------------------------------------------------------------- */

async function pollQueue() {
  const statusEl = document.getElementById('pollStatus');
  try {
    const items = await apiGet('getPrintQueue');
    renderQueue(items);

    const currentIds = items.map(function (it) { return it.requestId; });
    if (knownRequestIds === null) {
      knownRequestIds = new Set(currentIds); // first load: don't notify for pre-existing requests
    } else {
      items.forEach(function (it) {
        if (!knownRequestIds.has(it.requestId)) {
          notifyNewRequest(it);
          knownRequestIds.add(it.requestId);
        }
      });
      // drop ids that are no longer pending so the set doesn't grow forever
      knownRequestIds = new Set(currentIds);
    }

    statusEl.className = 'ps-status live';
    statusEl.innerHTML = '<span class="pulse"></span>Live \u2014 last checked ' + new Date().toLocaleTimeString();
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
    const card = document.createElement('div');
    card.className = 'card ps-item';
    const meta = item.context
      ? escapeHtml(item.context.staffSupervisor) + ' \u00b7 ' + escapeHtml(item.context.badStockCategory) + ' \u00b7 ' + item.context.itemCount + ' item(s)'
      : 'Transaction details unavailable';
    card.innerHTML =
      '<div class="ps-main">' +
      '<span class="ps-txn">' + escapeHtml(item.txnId) + '</span>' +
      '<span class="ps-meta">' + meta + '</span>' +
      '<span class="ps-meta">Requested ' + escapeHtml(item.requestedAt) + '</span>' +
      '</div>' +
      '<div class="ps-actions">' +
      '<button class="btn btn-secondary btn-cancel" data-request="' + item.requestId + '">Cancel</button>' +
      '<button class="btn btn-primary btn-print" data-request="' + item.requestId + '" data-txn="' + item.txnId + '">Print</button>' +
      '</div>';
    container.appendChild(card);
  });
}

document.getElementById('queueList').addEventListener('click', async function (e) {
  const printBtn = e.target.closest('.btn-print');
  const cancelBtn = e.target.closest('.btn-cancel');

  if (printBtn) {
    printBtn.disabled = true;
    try {
      await handlePrint(printBtn.dataset.request, printBtn.dataset.txn);
    } catch (err) {
      alert('Could not load this transaction: ' + err.message);
    } finally {
      printBtn.disabled = false;
    }
  }

  if (cancelBtn) {
    const ok = confirm('Cancel this print request without printing it?');
    if (!ok) return;
    cancelBtn.disabled = true;
    try {
      await apiPost('updatePrintStatus', { requestId: cancelBtn.dataset.request, status: 'CANCELLED' });
      pollQueue();
    } catch (err) {
      alert(err.message);
      cancelBtn.disabled = false;
    }
  }
});

/* ---------------------------------------------------------------------- */
/* Printing                                                                 */
/* ---------------------------------------------------------------------- */

async function handlePrint(requestId, txnId) {
  const data = await apiGet('getTransaction', { txnId: txnId });
  const first = data.entries[0];
  renderPrintArea({
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
  pendingPrintRequestId = requestId;
  window.print();
}

// Fires once the native print dialog closes (Print or Cancel from that
// dialog can't be reliably distinguished across browsers), so this marks
// the request as PRINTED — use the Cancel button in the list above to
// reject a request before it ever reaches this dialog.
window.addEventListener('afterprint', async function () {
  if (!pendingPrintRequestId) return;
  const requestId = pendingPrintRequestId;
  pendingPrintRequestId = null;
  try {
    await apiPost('updatePrintStatus', { requestId: requestId, status: 'PRINTED' });
  } catch (err) {
    // non-fatal — queue will just show it as pending again next poll
  }
  pollQueue();
});

function renderPrintArea(t) {
  const rows = t.entries.map(function (en) {
    return '<tr><td>' + escapeHtml(en.material) + '</td><td>' + escapeHtml(en.eanUpc) + '</td><td>' + escapeHtml(en.description) + '</td>' +
      '<td>' + en.quantity + '</td><td>' + escapeHtml(en.salesUnit) + '</td><td>' + escapeHtml(en.reason) + '</td></tr>';
  }).join('');

  const blank = '__________________';

  document.getElementById('printArea').innerHTML =
    '<div class="print-header">' +
    '<div class="print-title">SHBN - BAD STOCK SUPPLIER/EG LOG</div>' +
    '<div class="print-outlet">OUTLET: ' + OUTLET_NAME + '</div>' +
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

/* ---------------------------------------------------------------------- */
/* Boot                                                                     */
/* ---------------------------------------------------------------------- */

pollQueue();
setInterval(pollQueue, POLL_INTERVAL_MS);
