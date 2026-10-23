/**
 * views/inbox.js — Intelligence Inbox view
 */

import { db } from '../db.js';
import { formatIST, esc, getPersonName, truncate } from '../utils.js';
import { routeBadge, statusBadge, ROUTE_COLORS } from './shared.js';
import { renderDetail } from './detail.js';
import { navigate } from '../app.js';

let _sortCol = 'started_at';
let _sortDir = 'desc';
let _allRecords = [];
let _analysisMap = {};
let _decisionMap = {};

export async function renderInbox() {
  const [records, analyses, decisions] = await Promise.all([
    db.getAllRecords(),
    db.getAllAnalysis(),
    db.getAllDecisions(),
  ]);

  _allRecords  = records;
  _analysisMap = Object.fromEntries(analyses.map(a  => [a.record_key, a]));
  _decisionMap = Object.fromEntries(decisions.map(d => [d.record_key, d]));

  const emptyState = document.getElementById('inbox-empty-state');
  const filterBar  = document.getElementById('inbox-filter-bar');
  const tableCard  = document.querySelector('.table-card');

  if (!records.length) {
    if (emptyState) emptyState.style.display = 'block';
    if (filterBar)  filterBar.style.display  = 'none';
    if (tableCard)  tableCard.style.display  = 'none';
    const label = document.getElementById('inbox-count-label');
    if (label) label.textContent = '0 records — import data first';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';
  if (filterBar)  filterBar.style.display  = 'block';
  if (tableCard)  tableCard.style.display  = 'block';

  // Populate filter dropdowns
  populateFilters(records);

  // Render
  applyFiltersAndRender();

  // Bind filter events
  ['inbox-search', 'inbox-type', 'inbox-person', 'inbox-status', 'inbox-route', 'inbox-transcript', 'inbox-override']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', applyFiltersAndRender);
    });

  document.getElementById('inbox-clear-filters')?.addEventListener('click', clearFilters);

  // Sort headers
  document.querySelectorAll('#inbox-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (_sortCol === col) {
        _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        _sortCol = col;
        _sortDir = 'asc';
      }
      applyFiltersAndRender();
    });
  });
}

function populateFilters(records) {
  // Person
  const personSel = document.getElementById('inbox-person');
  if (personSel) {
    const current = personSel.value;
    const people  = [...new Set(records.map(r => getPersonName(r)).filter(p => p && p !== '—'))].sort();
    personSel.innerHTML = '<option value="">All people</option>' + people.map(p => `<option value="${esc(p)}" ${current===p?'selected':''}>${esc(p)}</option>`).join('');
  }

  // Status
  const statusSel = document.getElementById('inbox-status');
  if (statusSel && statusSel.children.length <= 1) {
    const statuses = [
      ['needs-review',   'Needs Review'],
      ['no-action-needed','No Action'],
      ['needs-transcript','Needs Transcript'],
      ['transcript-available','Transcript Ready'],
      ['no-recording','No Recording'],
      ['silent-recording','Silent Recording'],
    ];
    statusSel.innerHTML = '<option value="">All statuses</option>' +
      statuses.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  }

  // Route
  const routeSel = document.getElementById('inbox-route');
  if (routeSel && routeSel.children.length <= 1) {
    const routeNames = Object.keys(ROUTE_COLORS);
    routeSel.innerHTML = '<option value="">All routes</option>' +
      routeNames.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
  }
}

function clearFilters() {
  ['inbox-search','inbox-type','inbox-person','inbox-status','inbox-route','inbox-transcript','inbox-override']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  applyFiltersAndRender();
}

function applyFiltersAndRender() {
  const search      = (document.getElementById('inbox-search')?.value || '').toLowerCase();
  const typeFilter  = document.getElementById('inbox-type')?.value || '';
  const personFilter= document.getElementById('inbox-person')?.value || '';
  const statusFilter= document.getElementById('inbox-status')?.value || '';
  const routeFilter = document.getElementById('inbox-route')?.value || '';
  const txFilter    = document.getElementById('inbox-transcript')?.value || '';
  const ovFilter    = document.getElementById('inbox-override')?.value || '';

  let filtered = _allRecords.filter(r => {
    if (typeFilter && r.source_type !== typeFilter) return false;
    if (personFilter && getPersonName(r) !== personFilter) return false;
    if (statusFilter && r.review_status !== statusFilter) return false;
    if (txFilter === 'has' && !r.has_transcript) return false;
    if (txFilter === 'missing' && r.has_transcript) return false;
    if (ovFilter === 'manual' && !_decisionMap[r.record_key]) return false;
    if (ovFilter === 'stale' && !_analysisMap[r.record_key]?.stale) return false;

    if (routeFilter) {
      const analysis  = _analysisMap[r.record_key];
      const decision  = _decisionMap[r.record_key];
      const routes    = decision?.manual_routes?.length ? decision.manual_routes : (analysis?.routes || []);
      const hasRoute  = routes.some(rt => rt.destination === routeFilter);
      if (!hasRoute) return false;
    }

    if (search) {
      const searchable = [
        r.record_ref, r.source_type, r.source_id,
        getPersonName(r),
        r.payload?.observed_outcome, r.payload?.title,
        r.review_status, r.intake_status,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!searchable.includes(search)) return false;
    }

    return true;
  });

  // Sort
  filtered.sort((a, b) => {
    let av, bv;
    switch (_sortCol) {
      case 'record_ref':   av = a.record_ref || ''; bv = b.record_ref || ''; break;
      case 'source_type':  av = a.source_type || ''; bv = b.source_type || ''; break;
      case 'started_at':
        av = a.source_type === 'call' ? a.payload?.started_at : a.payload?.starts_at;
        bv = b.source_type === 'call' ? b.payload?.started_at : b.payload?.starts_at;
        break;
      case 'person':       av = getPersonName(a); bv = getPersonName(b); break;
      case 'has_transcript': av = a.has_transcript ? 1 : 0; bv = b.has_transcript ? 1 : 0; break;
      case 'review_status':  av = a.review_status || ''; bv = b.review_status || ''; break;
      case 'route': {
        const ra = _decisionMap[a.record_key]?.manual_routes?.[0]?.destination ||
                   _analysisMap[a.record_key]?.routes?.[0]?.destination || '';
        const rb = _decisionMap[b.record_key]?.manual_routes?.[0]?.destination ||
                   _analysisMap[b.record_key]?.routes?.[0]?.destination || '';
        av = ra; bv = rb; break;
      }
      default: av = ''; bv = '';
    }
    if (av < bv) return _sortDir === 'asc' ? -1 : 1;
    if (av > bv) return _sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  // Update sort indicators
  document.querySelectorAll('#inbox-table th.sortable').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === _sortCol) th.classList.add(`sort-${_sortDir}`);
  });

  renderInboxRows(filtered);

  const label = document.getElementById('inbox-count-label');
  if (label) label.textContent = `${filtered.length} of ${_allRecords.length} records`;

  const showing = document.getElementById('inbox-showing');
  if (showing) showing.textContent = `Showing ${filtered.length} record${filtered.length !== 1 ? 's' : ''}`;
}

function renderInboxRows(records) {
  const tbody = document.getElementById('inbox-tbody');
  if (!tbody) return;

  if (!records.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:32px;color:var(--navy-400)">No records match the current filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = records.map(r => {
    const analysis = _analysisMap[r.record_key];
    const decision = _decisionMap[r.record_key];
    const routes   = decision?.manual_routes?.length ? decision.manual_routes : (analysis?.routes || []);
    const primaryRoute = routes[0]?.destination;
    const isStale    = analysis?.stale;
    const isOverride = !!decision;

    const startedAt = r.source_type === 'call'
      ? r.payload?.started_at
      : r.payload?.starts_at;

    const dateStr = startedAt
      ? formatIST(startedAt, { year: undefined, month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      : '—';

    return `
      <tr data-key="${esc(r.record_key)}" tabindex="0" role="row" aria-label="Record ${esc(r.record_ref)}">
        <td><code style="font-size:11px">${esc(r.record_ref)}</code></td>
        <td><span class="badge badge-${r.source_type === 'call' ? 'blue' : 'teal'}">${esc(r.source_type)}</span></td>
        <td style="white-space:nowrap;font-size:12px;color:var(--navy-500)">${esc(dateStr)}</td>
        <td style="font-size:13px">${esc(getPersonName(r))}</td>
        <td>${r.has_transcript
          ? '<span class="badge badge-green">✓ Yes</span>'
          : '<span class="badge badge-navy">— No</span>'}</td>
        <td>${primaryRoute ? routeBadge(primaryRoute) : '<span class="text-muted" style="font-size:11px">—</span>'}</td>
        <td>${statusBadge(r.review_status)}</td>
        <td>${isOverride
          ? '<span class="badge badge-amber" title="Manually overridden">Manual</span>'
          : ''}</td>
        <td>${isStale
          ? '<span class="badge badge-red" title="Transcript updated; analysis may be stale">Stale</span>'
          : ''}</td>
      </tr>`;
  }).join('');

  // Row click → detail
  tbody.querySelectorAll('tr[data-key]').forEach(row => {
    const handler = () => {
      const key = row.dataset.key;
      const rec = _allRecords.find(r => r.record_key === key);
      if (rec) openDetail(rec);
    };
    row.addEventListener('click', handler);
    row.addEventListener('keydown', e => { if (e.key === 'Enter') handler(); });
  });
}

async function openDetail(rec) {
  await renderDetail(rec);
  navigate('detail');
}

// Allow inbox to be refreshed externally
export function refreshInbox() {
  renderInbox().catch(console.error);
}
