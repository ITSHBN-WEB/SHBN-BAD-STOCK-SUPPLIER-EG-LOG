/* =========================================================================
   SHBN - Bad Stock Supplier/EG Log — frontend logic
   Talks to a Google Apps Script Web App (see Code.gs) as its backend.
   ========================================================================= */

// TODO: paste your deployed Apps Script /exec URL here before publishing.
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
const ADMIN_PASSWORD = '8888';

/* ---------------------------------------------------------------------- */
/* API helper                                                              */
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
  // Content-Type text/plain avoids a CORS preflight against the Apps Script exec endpoint.
  const res = await fetch(WEB_APP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: action, payload: payload })
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Request failed.');
  return json.data;
}

/* ---------------------------------------------------------------------- */
/* Toast / confirm helpers                                                 */
/* ---------------------------------------------------------------------- */

function toast(message, type) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = 'toast' + (type ? ' ' + type : '');
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { el.hidden = true; }, 3200);
}

function confirmDialog(message) {
  return new Promise(function (resolve) {
    const overlay = document.getElementById('confirmOverlay');
    document.getElementById('confirmMessage').textContent = message;
    overlay.hidden = false;
    function cleanup(result) {
      overlay.hidden = true;
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    const okBtn = document.getElementById('confirmOk');
    const cancelBtn = document.getElementById('confirmCancel');
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

/* ---------------------------------------------------------------------- */
/* Tabs                                                                     */
/* ---------------------------------------------------------------------- */

document.getElementById('tabs').addEventListener('click', function (e) {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
  btn.classList.add('active');
  document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
  document.getElementById('view-' + btn.dataset.tab).classList.add('active');
  if (btn.dataset.tab === 'it') refreshItLists();
});

/* =========================================================================
   NEW ENTRY
   ========================================================================= */

let cart = []; // { material, description, eanUpc, numerator, salesUnit, quantity, reason }
let headerInfo = { staffSupervisor: '', badStockCategory: '' };

document.getElementById('btnContinueStep1').addEventListener('click', function () {
  const staffSupervisor = document.getElementById('staffSupervisorName').value.trim();
  const category = document.getElementById('badStockCategory').value;
  if (!staffSupervisor || !category) {
    toast('Please fill in staff / supervisor name and bad stock category.', 'error');
    return;
  }
  headerInfo.staffSupervisor = staffSupervisor;
  headerInfo.badStockCategory = category;
  document.getElementById('summaryStaff').textContent = headerInfo.staffSupervisor;
  document.getElementById('summaryCategory').textContent = headerInfo.badStockCategory;
  document.getElementById('new-step1').hidden = true;
  document.getElementById('new-step2').hidden = false;
});

document.getElementById('btnEditHeader').addEventListener('click', function () {
  document.getElementById('new-step2').hidden = true;
  document.getElementById('new-step1').hidden = false;
});

let currentProduct = null;

document.getElementById('btnSearch').addEventListener('click', searchProduct);
document.getElementById('scanCode').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { e.preventDefault(); searchProduct(); }
});

async function searchProduct() {
  const code = document.getElementById('scanCode').value.trim();
  const hint = document.getElementById('searchHint');
  hint.textContent = '';
  hint.className = 'hint';
  if (!code) { hint.textContent = 'Enter or scan a product code first.'; hint.className = 'hint error'; return; }
  try {
    const data = await apiGet('searchProduct', { code: code });
    if (!data.found) {
      document.getElementById('productResult').hidden = true;
      hint.textContent = 'No product found for "' + code + '". Check with Admin to add it to the masterlist.';
      hint.className = 'hint error';
      currentProduct = null;
      return;
    }
    currentProduct = data.product;
    document.getElementById('prDescription').textContent = currentProduct.description || '-';
    document.getElementById('prSalesUnit').textContent = currentProduct.salesUnit || '-';
    document.getElementById('prNumerator').textContent = currentProduct.numerator || '-';
    document.getElementById('prDepartment').textContent = currentProduct.department || '-';
    document.getElementById('productResult').hidden = false;
    document.getElementById('qtyInput').value = '';
    document.getElementById('reasonInput').value = '';
    document.getElementById('qtyInput').focus();
  } catch (err) {
    hint.textContent = err.message;
    hint.className = 'hint error';
  }
}

document.getElementById('btnInsertItem').addEventListener('click', function () {
  if (!currentProduct) { toast('Search for a product first.', 'error'); return; }
  const qty = Number(document.getElementById('qtyInput').value);
  const reason = document.getElementById('reasonInput').value;
  if (!qty || qty <= 0) { toast('Enter a valid quantity.', 'error'); return; }
  if (qty > 999) { toast('Quantity cannot exceed 999.', 'error'); return; }
  if (!reason) { toast('Select a reason.', 'error'); return; }

  const existing = cart.find(function (it) { return it.material === currentProduct.material; });
  if (existing) {
    const newQty = existing.quantity + qty;
    if (newQty > 999) { toast('Combined quantity for this item would exceed 999.', 'error'); return; }
    existing.quantity = newQty;
    existing.reason = reason;
  } else {
    cart.push({
      material: currentProduct.material,
      description: currentProduct.description,
      eanUpc: currentProduct.eanUpc,
      numerator: currentProduct.numerator,
      salesUnit: currentProduct.salesUnit,
      quantity: qty,
      reason: reason
    });
  }
  renderCart();
  document.getElementById('productResult').hidden = true;
  document.getElementById('scanCode').value = '';
  document.getElementById('scanCode').focus();
  currentProduct = null;
});

function renderCart() {
  const body = document.getElementById('cartBody');
  const empty = document.getElementById('cartEmptyNote');
  body.innerHTML = '';
  if (!cart.length) { empty.hidden = false; return; }
  empty.hidden = true;
  cart.forEach(function (it, idx) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + escapeHtml(it.material) + '</td>' +
      '<td>' + escapeHtml(it.eanUpc) + '</td>' +
      '<td>' + escapeHtml(it.description) + '</td>' +
      '<td><input type="number" min="1" max="999" value="' + it.quantity + '" data-idx="' + idx + '" class="cartQtyInput"></td>' +
      '<td>' + escapeHtml(it.salesUnit) + '</td>' +
      '<td>' + escapeHtml(it.reason) + '</td>' +
      '<td class="row-actions"><button class="icon-btn delete" data-idx="' + idx + '" title="Remove">&#10005;</button></td>';
    body.appendChild(tr);
  });
}

document.getElementById('cartBody').addEventListener('change', function (e) {
  if (!e.target.classList.contains('cartQtyInput')) return;
  const idx = Number(e.target.dataset.idx);
  let val = Number(e.target.value);
  if (!val || val <= 0) val = 1;
  if (val > 999) { val = 999; toast('Quantity cannot exceed 999.', 'error'); }
  cart[idx].quantity = val;
  e.target.value = val;
});

document.getElementById('cartBody').addEventListener('click', function (e) {
  const btn = e.target.closest('.icon-btn.delete');
  if (!btn) return;
  cart.splice(Number(btn.dataset.idx), 1);
  renderCart();
});

document.getElementById('btnSubmitCart').addEventListener('click', async function () {
  if (!cart.length) { toast('Add at least one item before submitting.', 'error'); return; }
  this.disabled = true;
  try {
    const result = await apiPost('submitTransaction', {
      staffSupervisor: headerInfo.staffSupervisor,
      badStockCategory: headerInfo.badStockCategory,
      items: cart
    });
    toast('Submitted. Transaction ' + result.txnId + ' saved to ' + result.sheet + '.', 'success');
    resetNewEntry();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    this.disabled = false;
  }
});

function resetNewEntry() {
  cart = [];
  headerInfo = { staffSupervisor: '', badStockCategory: '' };
  document.getElementById('staffSupervisorName').value = '';
  document.getElementById('badStockCategory').value = '';
  document.getElementById('productResult').hidden = true;
  document.getElementById('searchHint').textContent = '';
  renderCart();
  document.getElementById('new-step2').hidden = true;
  document.getElementById('new-step1').hidden = false;
}



/* =========================================================================
   IT ENTRY
   ========================================================================= */

document.querySelectorAll('.subtab').forEach(function (btn) {
  btn.addEventListener('click', function () {
    document.querySelectorAll('.subtab').forEach(function (t) { t.classList.remove('active'); });
    btn.classList.add('active');
    const isPending = btn.dataset.subtab === 'pending';
    document.getElementById('pendingList').hidden = !isPending;
    document.getElementById('completedList').hidden = isPending;
    closeTxnPanel();
  });
});

async function refreshItLists() {
  try {
    const [pending, completed] = await Promise.all([
      apiGet('getPendingList'), apiGet('getCompletedList')
    ]);
    renderItList('pendingList', pending, false);
    renderItList('completedList', completed, true);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderItList(containerId, items, isCompleted) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  if (!items.length) {
    const p = document.createElement('p');
    p.className = 'empty-note';
    p.textContent = isCompleted ? 'No completed transactions in the last 14 days.' : 'No pending transactions.';
    container.appendChild(p);
    return;
  }
  items.forEach(function (t) {
    const div = document.createElement('div');
    div.className = 'it-item';
    div.dataset.txn = t.txnId;
    div.innerHTML =
      '<div class="it-main">' +
      '<span class="it-txn">' + escapeHtml(t.txnId) + (isCompleted ? ' &middot; Doc ' + escapeHtml(t.materialDocument) : '') + '</span>' +
      '<span class="it-meta">' + escapeHtml(t.staffSupervisor) + ' &middot; ' + escapeHtml(t.badStockCategory) + ' &middot; ' + t.itemCount + ' item(s)</span>' +
      '<span class="it-meta">' + escapeHtml(isCompleted ? t.keyInDate : t.date) + '</span>' +
      '</div>' +
      '<span class="it-badge' + (isCompleted ? ' done' : '') + '">' + (isCompleted ? 'Completed' : 'Pending') + '</span>';
    div.addEventListener('click', function () { openTxnPanel(t.txnId, isCompleted); });
    container.appendChild(div);
  });
}

let activeTxn = null;
let activeTxnCompleted = false;
let txnPendingChanges = {}; // { rowIndex: newQty }

async function openTxnPanel(txnId, isCompleted) {
  try {
    const data = await apiGet('getTransaction', { txnId: txnId });
    activeTxn = data;
    activeTxnCompleted = isCompleted;
    txnPendingChanges = {};
    document.getElementById('txnPanel').hidden = false;
    document.getElementById('txnPanelId').textContent = data.txnId;
    const first = data.entries[0];
    document.getElementById('txnPanelSummary').textContent =
      first.staffSupervisor + ' \u00b7 ' + first.badStockCategory + ' \u00b7 ' + first.date;
    renderTxnTable();
    updateSaveRow();
    document.getElementById('keyinBlock').hidden = isCompleted;
    document.getElementById('btnDeleteTxn').hidden = isCompleted;
    document.getElementById('materialDocInput').value = '';
    document.getElementById('keyInByInput').value = '';
    document.getElementById('txnPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    toast(err.message, 'error');
  }
}

function updateSaveRow() {
  const hasChanges = !activeTxnCompleted && Object.keys(txnPendingChanges).length > 0;
  document.getElementById('txnSaveRow').hidden = !hasChanges;
}

function renderTxnTable() {
  const body = document.getElementById('txnBody');
  body.innerHTML = '';
  activeTxn.entries.forEach(function (en) {
    const tr = document.createElement('tr');
    const qtyCell = activeTxnCompleted
      ? '<td>' + en.quantity + '</td>'
      : '<td><input type="number" min="1" max="999" value="' + en.quantity + '" data-row="' + en.rowIndex + '" class="txnQtyInput" style="width:56px"></td>';
    const actionCell = activeTxnCompleted
      ? '<td></td>'
      : '<td><button class="icon-btn delete" data-row="' + en.rowIndex + '" title="Remove">&#10005;</button></td>';
    tr.innerHTML =
      '<td>' + escapeHtml(en.material) + '</td>' +
      '<td>' + escapeHtml(en.eanUpc) + '</td>' +
      '<td>' + escapeHtml(en.description) + '</td>' +
      qtyCell +
      '<td>' + escapeHtml(en.salesUnit) + '</td>' +
      '<td>' + escapeHtml(en.reason) + '</td>' +
      actionCell;
    body.appendChild(tr);
  });
}

document.getElementById('txnBody').addEventListener('input', function (e) {
  if (!e.target.classList.contains('txnQtyInput')) return;
  const rowIndex = Number(e.target.dataset.row);
  let val = Number(e.target.value);
  if (val > 999) { val = 999; e.target.value = val; toast('Quantity cannot exceed 999.', 'error'); }
  const original = activeTxn.entries.find(function (en) { return en.rowIndex === rowIndex; }).quantity;
  if (val && val > 0 && val !== original) {
    txnPendingChanges[rowIndex] = val;
  } else {
    delete txnPendingChanges[rowIndex];
  }
  updateSaveRow();
});

document.getElementById('btnSaveTxnChanges').addEventListener('click', async function () {
  const entries = Object.keys(txnPendingChanges);
  if (!entries.length) return;
  this.disabled = true;
  try {
    for (const rowIndex of entries) {
      await apiPost('updateEntryQty', { txnId: activeTxn.txnId, rowIndex: Number(rowIndex), quantity: txnPendingChanges[rowIndex] });
    }
    toast('Changes saved.', 'success');
    txnPendingChanges = {};
    await openTxnPanel(activeTxn.txnId, activeTxnCompleted);
    await refreshItLists();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    this.disabled = false;
  }
});

document.getElementById('txnBody').addEventListener('click', async function (e) {
  const btn = e.target.closest('.icon-btn.delete');
  if (!btn) return;
  const ok = await confirmDialog('Remove this item from the transaction?');
  if (!ok) return;
  try {
    await apiPost('deleteEntry', { txnId: activeTxn.txnId, rowIndex: Number(btn.dataset.row) });
    toast('Item removed.', 'success');
    if (activeTxn.entries.length <= 1) { closeTxnPanel(); } else { await openTxnPanel(activeTxn.txnId, activeTxnCompleted); }
    await refreshItLists();
  } catch (err) {
    toast(err.message, 'error');
  }
});

document.getElementById('btnDeleteTxn').addEventListener('click', async function () {
  const ok = await confirmDialog('Delete the whole transaction ' + activeTxn.txnId + '? This cannot be undone.');
  if (!ok) return;
  try {
    await apiPost('deleteTransaction', { txnId: activeTxn.txnId });
    toast('Transaction deleted.', 'success');
    closeTxnPanel();
    await refreshItLists();
  } catch (err) {
    toast(err.message, 'error');
  }
});

document.getElementById('btnSubmitKeyIn').addEventListener('click', async function () {
  if (Object.keys(txnPendingChanges).length) {
    toast('Save your quantity changes first.', 'error');
    return;
  }
  const materialDocument = document.getElementById('materialDocInput').value.trim();
  const keyInBy = document.getElementById('keyInByInput').value.trim();
  if (!materialDocument || !keyInBy) { toast('Fill in Material Document and Key in by.', 'error'); return; }
  this.disabled = true;
  try {
    await apiPost('submitKeyIn', { txnId: activeTxn.txnId, materialDocument: materialDocument, keyInBy: keyInBy });
    toast('Transaction completed.', 'success');
    await openTxnPanel(activeTxn.txnId, true); // reload as completed
    await refreshItLists();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    this.disabled = false;
  }
});

document.getElementById('btnCloseTxn').addEventListener('click', async function () {
  if (Object.keys(txnPendingChanges).length) {
    const ok = await confirmDialog('You have unsaved quantity changes. Discard them?');
    if (!ok) return;
  }
  closeTxnPanel();
});
function closeTxnPanel() {
  activeTxn = null;
  txnPendingChanges = {};
  document.getElementById('txnPanel').hidden = true;
}

document.getElementById('btnPrintTxn').addEventListener('click', async function () {
  if (!activeTxn) return;
  const btn = this;
  btn.disabled = true;
  btn.textContent = 'Sending...';
  try {
    const result = await apiPost('requestPrint', { txnId: activeTxn.txnId });
    toast('Print request sent to the Print Station.', 'success');
    pollPrintRequest(result.requestId, btn);
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Print';
  }
});

function pollPrintRequest(requestId, btn) {
  btn.textContent = 'Waiting for Print Station...';
  let attempts = 0;
  const maxAttempts = 40; // ~2 minutes at 3s intervals
  const interval = setInterval(async function () {
    attempts++;
    try {
      const data = await apiGet('getPrintRequestStatus', { requestId: requestId });
      if (data.status === 'PRINTED') {
        clearInterval(interval);
        toast('Printed at the Print Station.', 'success');
        btn.disabled = false; btn.textContent = 'Print';
      } else if (data.status === 'CANCELLED') {
        clearInterval(interval);
        toast('Print request was cancelled at the Print Station.', 'error');
        btn.disabled = false; btn.textContent = 'Print';
      } else if (attempts >= maxAttempts) {
        clearInterval(interval);
        toast('Still waiting — make sure the Print Station tab is open.', 'error');
        btn.disabled = false; btn.textContent = 'Print';
      }
    } catch (err) {
      clearInterval(interval);
      toast(err.message, 'error');
      btn.disabled = false; btn.textContent = 'Print';
    }
  }, 3000);
}

/* =========================================================================
   ADMIN
   ========================================================================= */

document.getElementById('btnUnlockAdmin').addEventListener('click', function () {
  const val = document.getElementById('adminPassword').value;
  const hint = document.getElementById('adminLockHint');
  if (val === ADMIN_PASSWORD) {
    document.getElementById('adminLock').hidden = true;
    document.getElementById('adminPanel').hidden = false;
  } else {
    hint.textContent = 'Incorrect password.';
    hint.className = 'hint error';
  }
});

document.getElementById('btnToggleSingleForm').addEventListener('click', function () {
  const form = document.getElementById('singleForm');
  form.hidden = !form.hidden;
});

document.getElementById('btnAddSingle').addEventListener('click', async function () {
  const payload = {
    material: document.getElementById('singleMaterial').value.trim(),
    description: document.getElementById('singleDescription').value.trim(),
    salesUnit: document.getElementById('singleSalesUnit').value.trim(),
    numerator: document.getElementById('singleNumerator').value.trim(),
    eanUpc: document.getElementById('singleEanUpc').value.trim(),
    department: document.getElementById('singleDepartment').value.trim()
  };
  const hint = document.getElementById('singleHint');
  if (!payload.material) { hint.textContent = 'Material code is required.'; hint.className = 'hint error'; return; }
  this.disabled = true;
  try {
    await apiPost('addSingleMasterData', payload);
    hint.textContent = 'Saved to masterlist.';
    hint.className = 'hint ok';
    ['singleMaterial', 'singleDescription', 'singleSalesUnit', 'singleNumerator', 'singleEanUpc', 'singleDepartment']
      .forEach(function (id) { document.getElementById(id).value = ''; });
  } catch (err) {
    hint.textContent = err.message;
    hint.className = 'hint error';
  } finally {
    this.disabled = false;
  }
});

document.getElementById('btnUploadMasterlist').addEventListener('click', async function () {
  const dept = document.getElementById('deptInput').value.trim();
  const fileInput = document.getElementById('fileInput');
  const hint = document.getElementById('uploadHint');
  hint.className = 'hint';
  if (!dept) { hint.textContent = 'Enter a department name.'; hint.className = 'hint error'; return; }
  if (!fileInput.files.length) { hint.textContent = 'Choose an Excel file.'; hint.className = 'hint error'; return; }

  this.disabled = true;
  hint.textContent = 'Reading file...';
  try {
    const rows = await parseMasterlistExcel(fileInput.files[0]);
    if (!rows.length) throw new Error('No usable rows found in the file.');
    hint.textContent = 'Uploading ' + rows.length + ' rows...';
    const result = await apiPost('uploadMasterlist', { department: dept, rows: rows });
    hint.textContent = 'Done. ' + result.added + ' added, ' + result.updated + ' updated.';
    hint.className = 'hint ok';
    fileInput.value = '';
  } catch (err) {
    hint.textContent = err.message;
    hint.className = 'hint error';
  } finally {
    this.disabled = false;
  }
});

function parseMasterlistExcel(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        const colMap = { material: null, description: null, salesUnit: null, numerator: null, eanUpc: null };
        if (json.length) {
          Object.keys(json[0]).forEach(function (key) {
            const k = key.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (k === 'material') colMap.material = key;
            else if (k.indexOf('materialdescription') != -1 || k === 'description') colMap.description = key;
            else if (k.indexOf('salesunit') != -1) colMap.salesUnit = key;
            else if (k.indexOf('numerator') != -1) colMap.numerator = key;
            else if (k.indexOf('eanupc') != -1 || k === 'ean' || k === 'upc') colMap.eanUpc = key;
          });
        }
        const rows = json.map(function (r) {
          return {
            material: colMap.material ? String(r[colMap.material]).trim() : '',
            description: colMap.description ? String(r[colMap.description]).trim() : '',
            salesUnit: colMap.salesUnit ? String(r[colMap.salesUnit]).trim() : '',
            numerator: colMap.numerator ? r[colMap.numerator] : '',
            eanUpc: colMap.eanUpc ? String(r[colMap.eanUpc]).trim() : ''
          };
        }).filter(function (r) { return r.material; });
        resolve(rows);
      } catch (err) {
        reject(new Error('Could not read the Excel file: ' + err.message));
      }
    };
    reader.onerror = function () { reject(new Error('Could not read the file.')); };
    reader.readAsArrayBuffer(file);
  });
}

/* ---------------------------------------------------------------------- */
/* Utilities                                                                */
/* ---------------------------------------------------------------------- */

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------------------------------------------------------------------- */
/* Auto-uppercase text inputs                                              */
/* ---------------------------------------------------------------------- */
// All free-text fields are forced to uppercase as the user types (matches
// the convention used across the other SHBN tools). Number/password/file
// inputs and dropdowns are left alone.

const UPPERCASE_FIELD_IDS = [
  'staffSupervisorName', 'scanCode',
  'materialDocInput', 'keyInByInput',
  'deptInput',
  'singleMaterial', 'singleDescription', 'singleSalesUnit', 'singleEanUpc', 'singleDepartment'
];

function enableAutoUppercase() {
  UPPERCASE_FIELD_IDS.forEach(function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', function () {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      el.value = el.value.toUpperCase();
      if (start !== null && end !== null) el.setSelectionRange(start, end);
    });
  });
}
enableAutoUppercase();
