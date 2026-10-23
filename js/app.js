/**
 * app.js — Main application entry point and router
 *
 * Coordinates:
 *  - IndexedDB initialisation
 *  - Navigation between sections
 *  - View lifecycle calls
 *  - Global event bindings
 */

import { openDB, db, clearAllStores } from './db.js';
import { renderOverview, initOverlayClose } from './views/overview.js';
import { renderInbox } from './views/inbox.js';
import { renderDetailDefault } from './views/detail.js';
import { initImportView } from './views/importHistory.js';
import { initExportsView } from './views/exports.js';
import { renderMethodology } from './views/methodology.js';
import { toast } from './utils.js';

// ── Section registry ──
const SECTIONS = ['overview', 'inbox', 'detail', 'exports', 'import', 'methodology'];

let _currentSection = 'overview';

export function navigate(sectionId) {
  if (!SECTIONS.includes(sectionId)) return;

  // Hide all sections
  SECTIONS.forEach(id => {
    const el = document.getElementById(`section-${id}`);
    if (el) { el.hidden = true; el.classList.remove('active'); }
    document.getElementById(`nav-${id}`)?.classList.remove('active');
  });

  // Show target section
  const target = document.getElementById(`section-${sectionId}`);
  if (target) { target.hidden = false; target.classList.add('active'); }
  document.getElementById(`nav-${sectionId}`)?.classList.add('active');

  _currentSection = sectionId;

  // Trigger section-specific renders
  switch (sectionId) {
    case 'overview':   renderOverview().catch(e => console.error('overview:', e));   break;
    case 'inbox':      renderInbox().catch(e => console.error('inbox:', e));          break;
    case 'detail':     renderDetailDefault().catch(e => console.error('detail:', e)); break;
    case 'methodology': renderMethodology();                                          break;
    // exports, import — rendered on demand / already init'd
  }
}

// ── Init ──

async function init() {
  // Init DB
  try {
    await openDB();
    updateDBStatus(true);
  } catch (err) {
    updateDBStatus(false);
    console.error('IndexedDB failed:', err);
    toast('IndexedDB unavailable — data will not persist.', 'error', 8000);
    return;
  }

  // Init static views
  initImportView();
  initExportsView();
  initOverlayClose();
  renderMethodology();
  bindNavigation();
  bindGlobalButtons();

  // Check if data exists; if empty, redirect to import
  const records = await db.getAllRecords();
  if (records.length === 0) {
    showEmptyState();
    navigate('import');
  } else {
    navigate('overview');
  }
}

function bindNavigation() {
  SECTIONS.forEach(id => {
    const navLink = document.getElementById(`nav-${id}`);
    navLink?.addEventListener('click', e => {
      e.preventDefault();
      navigate(id);
    });
  });

  // Back button in detail view
  document.getElementById('detail-back')?.addEventListener('click', () => navigate('inbox'));

  // Overview filters
  document.getElementById('ov-filter-person')?.addEventListener('change', () => renderOverview().catch(console.error));
  document.getElementById('ov-filter-type')?.addEventListener('change',   () => renderOverview().catch(console.error));
}

function bindGlobalButtons() {
  document.getElementById('btn-reset')?.addEventListener('click', async () => {
    const confirmed = window.confirm(
      'RESET WORKSPACE?\n\n' +
      'This action will permanently delete ALL imported conversation records, automated analyses, user manual route overrides, import history, and audit logs from browser IndexedDB.\n\n' +
      'The workspace will be restored to an empty state with 0 records.\n\n' +
      'Are you sure you want to proceed?'
    );
    if (!confirmed) return;

    await clearAllStores();
    toast('Workspace reset: all records and corrections cleared.', 'warning');
    showEmptyState();
    navigate('overview');
  });
}

function updateDBStatus(ok) {
  const dot  = document.querySelector('.status-dot');
  const text = document.querySelector('.status-text');
  if (dot)  dot.className  = `status-dot ${ok ? '' : 'error'}`;
  if (text) text.textContent = ok ? 'IndexedDB ready' : 'IndexedDB error';
}

function showEmptyState() {
  const label = document.getElementById('inbox-count-label');
  if (label) label.textContent = 'No records — import data first';
  const badge = document.getElementById('inbox-badge');
  if (badge) badge.textContent = '0';

  toast('No data found — load the JSON files from Import History.', 'info', 6000);
}

// ── Boot ──
document.addEventListener('DOMContentLoaded', () => {
  init().catch(err => {
    console.error('App init failed:', err);
    toast('Application failed to initialise. Check console.', 'error', 10000);
  });
});
