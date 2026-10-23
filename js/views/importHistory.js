/**
 * views/importHistory.js — Import history, validation preview, and data management
 */

import { db, clearAllStores } from '../db.js';
import { previewBatch, importBatch } from '../importer.js';
import { formatIST, esc, toast } from '../utils.js';
import { refreshInbox } from './inbox.js';
import { renderOverview } from './overview.js';

let _pendingBatchData = null;
let _pendingFilename  = null;

export function initImportView() {
  const browseBtn = document.getElementById('import-browse-btn');
  const fileInput = document.getElementById('import-file-input');
  const dropZone  = document.getElementById('import-drop-zone');

  browseBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    fileInput?.click();
  });

  fileInput?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
      fileInput.value = ''; // allow re-selecting same file
    }
  });

  // Drag & drop
  dropZone?.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone?.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  });
  dropZone?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput?.click();
    }
  });

  // Preset buttons
  document.getElementById('btn-demo-initial')?.addEventListener('click', () => loadPresetDataset('data/01_initial.json', '01_initial.json'));
  document.getElementById('btn-demo-update')?.addEventListener('click',  () => loadPresetDataset('data/02_update.json', '02_update.json'));
  document.getElementById('btn-demo-reset')?.addEventListener('click',   confirmAndResetWorkspace);
  document.getElementById('btn-reset-workspace-top')?.addEventListener('click', confirmAndResetWorkspace);

  // Overview and Inbox CTA buttons
  document.getElementById('btn-empty-import-initial')?.addEventListener('click', () => loadPresetDataset('data/01_initial.json', '01_initial.json'));
  document.getElementById('btn-empty-browse')?.addEventListener('click', () => fileInput?.click());
  document.getElementById('btn-inbox-import-cta')?.addEventListener('click', () => loadPresetDataset('data/01_initial.json', '01_initial.json'));
  document.getElementById('inbox-btn-import')?.addEventListener('click', () => {
    window.location.hash = '#import';
  });

  // Modal event bindings
  document.getElementById('import-preview-close')?.addEventListener('click', closePreviewModal);
  document.getElementById('import-preview-cancel')?.addEventListener('click', closePreviewModal);
  document.getElementById('import-preview-confirm')?.addEventListener('click', executeConfirmedImport);

  // Initial renders
  renderImportHistory();
  renderAuditLog();
}

/**
 * Read and validate user-provided JSON file.
 */
async function processFile(file) {
  if (!file.name.toLowerCase().endsWith('.json')) {
    setResult('<strong>Invalid file type:</strong> Please upload a valid JSON dataset (.json).', 'error');
    toast('Please select a .json file.', 'error');
    return;
  }

  setResult('Reading and parsing file…', 'info');

  let batchData;
  try {
    const text = await file.text();
    batchData = JSON.parse(text);
  } catch (err) {
    setResult(`<strong>JSON Syntax Error:</strong> The file could not be parsed as valid JSON.<br><span class="fw-mono">${esc(err.message)}</span>`, 'error');
    toast('Malformed JSON: syntax error.', 'error');
    return;
  }

  await runInspectionAndShowPreview(batchData, file.name);
}

/**
 * Load one of the supplied assignment datasets and show preview.
 */
export async function loadPresetDataset(path, filename) {
  setResult(`Fetching ${esc(filename)}…`, 'info');
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);
    const data = await res.json();
    await runInspectionAndShowPreview(data, filename);
  } catch (err) {
    setResult(`<strong>Error loading ${esc(filename)}:</strong> ${esc(err.message)}`, 'error');
    toast('Failed to load dataset file.', 'error');
  }
}

/**
 * Compute pre-import preview metrics and show modal.
 */
async function runInspectionAndShowPreview(batchData, filename) {
  setResult('Validating schema and computing impact against current database…', 'info');

  try {
    const preview = await previewBatch(batchData, filename);

    if (!preview.valid) {
      const errorHtml = `
        <strong>Schema Validation Failed:</strong><br>
        The selected file does not adhere to the expected SpendNest dataset contract.<br>
        ${preview.errors.map(e => `• ${esc(e)}`).join('<br>')}`;
      setResult(errorHtml, 'error');
      toast('Dataset failed schema validation.', 'error');
      return;
    }

    _pendingBatchData = batchData;
    _pendingFilename  = filename;

    renderPreviewModal(preview);
    setResult(`Inspection complete for <strong>${esc(filename)}</strong>. Please review the pre-import preview dialog.`, 'info');

  } catch (err) {
    setResult(`<strong>Inspection error:</strong> ${esc(err.message)}`, 'error');
    toast('Dataset inspection error.', 'error');
    console.error(err);
  }
}

/**
 * Render the Pre-Import Preview & Confirmation Modal.
 */
function renderPreviewModal(preview) {
  const modal = document.getElementById('modal-import-preview');
  const body  = document.getElementById('import-preview-body');
  const title = document.getElementById('import-preview-title');
  const confirmBtn = document.getElementById('import-preview-confirm');
  if (!modal || !body) return;

  if (title) title.textContent = `Import Preview — ${preview.filename}`;

  let alertHtml = '';
  if (preview.transcriptUpdates.length > 0) {
    alertHtml += `
      <div class="preview-alert warn">
        <strong>⚠️ Transcript Changes Detected:</strong><br>
        ${preview.transcriptUpdates.map(u => `• <strong>${esc(u.record_ref)}</strong> (${esc(u.source_type)}): ${esc(u.reason)}`).join('<br>')}
      </div>`;
  }

  if (preview.overridesPreserved > 0) {
    alertHtml += `
      <div class="preview-alert info">
        <strong>🔒 User Manual Overrides Protected:</strong><br>
        ${preview.overridesPreserved} existing manual route correction(s) will be strictly preserved and not overwritten.
      </div>`;
  }

  if (preview.warnings.length > 0) {
    alertHtml += `
      <div class="preview-alert warn">
        <strong>Notices &amp; Warnings:</strong><br>
        ${preview.warnings.map(w => `• ${esc(w)}`).join('<br>')}
      </div>`;
  }

  if (preview.errors.length > 0) {
    alertHtml += `
      <div class="preview-alert error">
        <strong>Critical Errors in Batch:</strong><br>
        ${preview.errors.map(e => `• ${esc(e)}`).join('<br>')}
      </div>`;
  }

  body.innerHTML = `
    <div class="preview-meta-grid">
      <div class="preview-meta-item"><strong>Batch ID:</strong> <code>${esc(preview.batch_id)}</code></div>
      <div class="preview-meta-item"><strong>Revision:</strong> ${preview.revision !== null ? `Revision ${esc(String(preview.revision))}` : 'None'}</div>
      <div class="preview-meta-item"><strong>Exported At:</strong> ${preview.exported_at ? formatIST(preview.exported_at) : 'N/A'}</div>
      <div class="preview-meta-item"><strong>Records in File:</strong> ${preview.totalInFile} (${preview.callsInFile} calls, ${preview.meetingsInFile} meetings)</div>
    </div>

    <div class="preview-stats-grid">
      <div class="preview-stat-card stat-insert">
        <div class="preview-stat-num">${preview.toInsert}</div>
        <div class="preview-stat-lbl">New to Insert</div>
      </div>
      <div class="preview-stat-card stat-update">
        <div class="preview-stat-num">${preview.toUpdate}</div>
        <div class="preview-stat-lbl">To Update</div>
      </div>
      <div class="preview-stat-card stat-unchanged">
        <div class="preview-stat-num">${preview.unchanged}</div>
        <div class="preview-stat-lbl">Unchanged</div>
      </div>
      <div class="preview-stat-card stat-conflict">
        <div class="preview-stat-num">${preview.rejected}</div>
        <div class="preview-stat-lbl">Rejected / Invalid</div>
      </div>
    </div>

    ${alertHtml}

    <p style="font-size:12px;color:var(--navy-600);margin-top:10px;line-height:1.5">
      Identity resolution uses composite key <code>(source_type, source_id)</code>. Click <strong>Confirm &amp; Apply Import</strong> to write changes to IndexedDB and update dashboard metrics.
    </p>
  `;

  if (confirmBtn) {
    confirmBtn.disabled = (preview.toInsert === 0 && preview.toUpdate === 0);
    confirmBtn.textContent = (preview.toInsert === 0 && preview.toUpdate === 0)
      ? 'No Changes to Ingest'
      : 'Confirm & Apply Import';
  }

  modal.classList.remove('hidden');
}

function closePreviewModal() {
  const modal = document.getElementById('modal-import-preview');
  if (modal) modal.classList.add('hidden');
  _pendingBatchData = null;
  _pendingFilename  = null;
}

/**
 * Execute import after user confirmation.
 */
async function executeConfirmedImport() {
  if (!_pendingBatchData) return;

  const batchData = _pendingBatchData;
  const filename  = _pendingFilename || 'dataset.json';

  const confirmBtn = document.getElementById('import-preview-confirm');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Ingesting…';
  }

  try {
    const result = await importBatch(batchData);
    closePreviewModal();

    const summaryLines = [
      `<strong>✓ Ingestion Succeeded:</strong> ${esc(filename)}`,
      `<strong>Batch ID:</strong> ${esc(result.batch_id)} (rev ${esc(String(result.revision ?? 1))})`,
      `<strong>Timestamp:</strong> ${formatIST(result.imported_at)}`,
      `<br>`,
      `<strong>Added:</strong> ${result.inserted} new record(s)`,
      `<strong>Updated:</strong> ${result.updated} existing record(s)`,
      `<strong>Unchanged:</strong> ${result.unchanged} record(s)`,
      `<strong>Rejected:</strong> ${result.rejected} record(s)`,
    ];

    if (result.warnings.length) {
      summaryLines.push('', `<strong>Warnings:</strong>`, ...result.warnings.map(w => `• ${esc(w)}`));
    }

    setResult(summaryLines.join('<br>'), 'success');
    toast(`Import complete: ${result.inserted} added, ${result.updated} updated, ${result.unchanged} unchanged.`, 'success');

    await renderImportHistory();
    await renderAuditLog();
    refreshInbox();
    renderOverview().catch(console.error);

  } catch (err) {
    setResult(`<strong>Import execution error:</strong> ${esc(err.message)}`, 'error');
    toast('Import execution failed.', 'error');
    console.error(err);
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Confirm & Apply Import';
    }
  }
}

/**
 * Reset Workspace: Clears all IndexedDB stores after explicit user confirmation.
 */
export async function confirmAndResetWorkspace() {
  const confirmed = window.confirm(
    'RESET WORKSPACE?\n\n' +
    'This action will permanently delete ALL imported conversation records, automated analyses, user manual route overrides, import history, and audit logs from browser IndexedDB.\n\n' +
    'The workspace will be restored to an empty state with 0 records.\n\n' +
    'Are you sure you want to proceed?'
  );

  if (!confirmed) return;

  try {
    await clearAllStores();
    setResult('<strong>Workspace Reset Complete:</strong> All records, analyses, manual route corrections, and audit history have been cleared.', 'info');
    toast('Workspace reset: all records and corrections cleared.', 'warning');

    await renderImportHistory();
    await renderAuditLog();
    refreshInbox();
    await renderOverview();

    window.location.hash = '#overview';
  } catch (err) {
    setResult(`<strong>Reset error:</strong> ${esc(err.message)}`, 'error');
    toast('Failed to reset database.', 'error');
    console.error(err);
  }
}

function setResult(html, type) {
  const el = document.getElementById('import-result');
  if (!el) return;
  el.innerHTML = html;
  el.className = `import-result ${type}`;
}

export async function renderImportHistory() {
  const history = await db.getImportHistory();
  const el      = document.getElementById('import-history-list');
  if (!el) return;

  if (!history?.length) {
    el.innerHTML = '<p class="text-muted" style="padding:16px">No imports yet. Use the upload box or preset buttons above.</p>';
    return;
  }

  const sorted = [...history].sort((a, b) => (b.imported_at > a.imported_at ? 1 : -1));
  el.innerHTML = sorted.map(h => `
    <div class="import-batch-entry">
      <div class="import-batch-name">
        ${esc(h.batch_id)}
        <span style="font-weight:400;color:var(--navy-500);font-size:12px">
          ${h.revision !== null ? `rev ${esc(String(h.revision))}` : 'no-revision'}
        </span>
      </div>
      <div class="import-batch-time">${formatIST(h.imported_at)}</div>
      <div class="import-batch-stats">
        <span class="import-stat inserted"><span class="stat-count">${h.inserted}</span> added</span>
        <span class="import-stat updated"><span class="stat-count">${h.updated}</span> updated</span>
        <span class="import-stat unchanged"><span class="stat-count">${h.unchanged}</span> unchanged</span>
        <span class="import-stat rejected"><span class="stat-count">${h.rejected}</span> rejected</span>
      </div>
      ${h.warnings?.length ? `<p style="font-size:11px;color:var(--amber-600);margin-top:4px">⚠ ${h.warnings.length} notice(s)</p>` : ''}
      ${h.errors?.length   ? `<p style="font-size:11px;color:var(--red-600);margin-top:4px">✗ ${h.errors.length} error(s)</p>`    : ''}
    </div>`).join('');
}

export async function renderAuditLog() {
  const events = await db.getAllAuditEvents();
  const el     = document.getElementById('audit-list');
  if (!el) return;

  if (!events?.length) {
    el.innerHTML = '<p class="text-muted" style="padding:16px">No audit events recorded yet.</p>';
    return;
  }

  const sorted = [...events].sort((a, b) => (b.ts > a.ts ? 1 : -1)).slice(0, 200);
  el.innerHTML = sorted.map(e => `
    <div class="audit-entry">
      <span class="audit-time">${formatIST(e.ts)}</span>
      <div>
        <div class="audit-body">
          <span class="audit-ref">${esc(e.record_key || '?')}</span>
          · <strong>${esc(e.field)}</strong>
        </div>
        <div class="audit-change">
          ${esc(e.prev ?? '—')} → ${esc(e.next ?? '—')}
          ${e.detail ? ` · ${esc(e.detail)}` : ''}
          &nbsp;·&nbsp; <em>${esc(e.source || '?')}</em>
        </div>
      </div>
    </div>`).join('');
}
