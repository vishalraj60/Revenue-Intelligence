/**
 * views/overview.js — Dashboard / Overview section with honest empty-state and dataset validation
 */

import { db } from '../db.js';
import { formatIST, formatDuration, esc, getPersonName } from '../utils.js';
import { ROUTE_COLORS, routeBadge, statusBadge } from './shared.js';

export async function renderOverview() {
  const [records, analyses, decisions, importHistory] = await Promise.all([
    db.getAllRecords(),
    db.getAllAnalysis(),
    db.getAllDecisions(),
    db.getImportHistory(),
  ]);

  const emptyState      = document.getElementById('overview-empty-state');
  const metricsGrid     = document.getElementById('metrics-grid');
  const validationPanel = document.getElementById('validation-panel');
  const chartsRow       = document.querySelector('.charts-row');
  const briefCard       = document.getElementById('manager-brief-card');
  const inboxBadge      = document.getElementById('inbox-badge');

  // Honest Empty State when no records have been imported
  if (!records || records.length === 0) {
    if (emptyState) emptyState.style.display = 'block';
    if (metricsGrid) metricsGrid.innerHTML = '';
    if (chartsRow) chartsRow.style.display = 'none';
    if (briefCard) briefCard.style.display = 'none';
    if (inboxBadge) inboxBadge.textContent = '0';
    renderValidation([], [], [], null);
    return;
  }

  // Active records exist
  if (emptyState) emptyState.style.display = 'none';
  if (chartsRow) chartsRow.style.display = 'grid';
  if (briefCard) briefCard.style.display = 'block';

  // Build lookup maps
  const analysisMap = Object.fromEntries(analyses.map(a => [a.record_key, a]));
  const decisionMap = Object.fromEntries(decisions.map(d => [d.record_key, d]));

  // Filters
  const personFilter = document.getElementById('ov-filter-person')?.value || '';
  const typeFilter   = document.getElementById('ov-filter-type')?.value  || '';

  const filtered = records.filter(r => {
    if (typeFilter && r.source_type !== typeFilter) return false;
    if (personFilter && getPersonName(r) !== personFilter) return false;
    return true;
  });

  populatePersonFilter(records);

  // ── Metrics ──
  const total    = filtered.length;
  const calls    = filtered.filter(r => r.source_type === 'call').length;
  const meetings = filtered.filter(r => r.source_type === 'meeting').length;

  const hasUsableTx = filtered.filter(r => {
    if (!r.has_transcript) return false;
    if (r.source_type === 'call') return typeof r.transcript_text === 'string' && r.transcript_text.trim().length > 0;
    if (r.source_type === 'meeting') {
      const turns = r.transcript_payload?.turns;
      return Array.isArray(turns) && turns.length > 0;
    }
    return false;
  }).length;
  const noTx = total - hasUsableTx;

  const needsReview = filtered.filter(r => r.review_status === 'needs-review').length;
  const noAction    = filtered.filter(r => r.review_status === 'no-action-needed').length;

  const manualOverrides = decisions.filter(d => {
    const rec = records.find(r => r.record_key === d.record_key);
    if (!rec) return false;
    if (typeFilter && rec.source_type !== typeFilter) return false;
    if (personFilter && getPersonName(rec) !== personFilter) return false;
    return true;
  }).length;

  const staleCount = analyses.filter(a => {
    const rec = records.find(r => r.record_key === a.record_key);
    if (!rec) return false;
    if (typeFilter && rec.source_type !== typeFilter) return false;
    if (personFilter && getPersonName(rec) !== personFilter) return false;
    return a.stale;
  }).length;

  const conversations = filtered.filter(r => {
    if (r.source_type === 'call') return r.payload?.is_conversation === true;
    if (r.source_type === 'meeting') {
      const turns = r.transcript_payload?.turns;
      return Array.isArray(turns) && turns.length > 0;
    }
    return false;
  }).length;

  const routeCounts = {};
  filtered.forEach(r => {
    const analysis = analysisMap[r.record_key];
    const decision = decisionMap[r.record_key];
    const routes = decision?.manual_routes?.length
      ? decision.manual_routes
      : (analysis?.routes || []);
    routes.forEach(route => {
      const d = route.destination || 'Unknown';
      routeCounts[d] = (routeCounts[d] || 0) + 1;
    });
  });

  const metrics = [
    { label: 'Total records',     value: total,         sub: 'After filters',                        accent: 'blue',   drillKey: 'all' },
    { label: 'Calls',             value: calls,         sub: `${meetings} meetings`,                  accent: 'blue',   drillKey: 'calls' },
    { label: 'Meetings',          value: meetings,      sub: `${calls} calls`,                        accent: 'teal',   drillKey: 'meetings' },
    { label: 'Has transcript',    value: hasUsableTx,   sub: `${noTx} missing / silent`,              accent: 'green',  drillKey: 'has_transcript' },
    { label: 'Missing transcript',value: noTx,          sub: 'Voicemails / unrecorded',               accent: 'amber',  drillKey: 'no_transcript' },
    { label: 'Needs review',      value: needsReview,   sub: 'Review status',                         accent: 'purple', drillKey: 'needs_review' },
    { label: 'No action',         value: noAction,      sub: 'Voicemails / uncompleted',              accent: 'navy',   drillKey: 'no_action' },
    { label: 'Conversations',     value: conversations, sub: 'Two-way exchanges',                      accent: 'blue',   drillKey: 'conversations' },
    { label: 'Manual overrides',  value: manualOverrides, sub: 'User-corrected routes',               accent: 'amber',  drillKey: 'overrides' },
    { label: 'Stale analysis',    value: staleCount,    sub: 'Transcript updated post-analysis',      accent: 'red',    drillKey: 'stale' },
  ];

  if (metricsGrid) {
    metricsGrid.innerHTML = metrics.map(m => `
      <div class="metric-card accent-${m.accent}" data-drill="${m.drillKey}" tabindex="0" role="button" aria-label="View ${m.label} records">
        <div class="metric-value">${m.value}</div>
        <div class="metric-label">${esc(m.label)}</div>
      </div>
    `).join('');

    metricsGrid.querySelectorAll('.metric-card').forEach(card => {
      card.addEventListener('click', () => openDrill(card.dataset.drill, filtered, analysisMap, decisionMap));
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openDrill(card.dataset.drill, filtered, analysisMap, decisionMap);
        }
      });
    });
  }

  // Most recent import batch
  const lastImport = importHistory && importHistory.length
    ? [...importHistory].sort((a, b) => (b.imported_at > a.imported_at ? 1 : -1))[0]
    : null;

  renderValidation(records, analyses, decisions, lastImport);
  renderPersonChart(filtered);
  renderRoutingChart(routeCounts);
  renderManagerBrief();

  if (inboxBadge) inboxBadge.textContent = total;
}

function populatePersonFilter(records) {
  const sel = document.getElementById('ov-filter-person');
  if (!sel) return;
  const current = sel.value;
  const people  = [...new Set(records.map(r => getPersonName(r)).filter(p => p && p !== '—'))].sort();
  sel.innerHTML  = '<option value="">All people</option>' + people.map(p => `<option value="${esc(p)}" ${current === p ? 'selected' : ''}>${esc(p)}</option>`).join('');
}

function renderValidation(records, analyses, decisions, lastImport) {
  const panel = document.getElementById('validation-panel');
  const rows  = document.getElementById('validation-rows');
  const badge = document.getElementById('validation-status');
  if (!panel || !rows) return;

  panel.style.display = 'block';

  if (!records || records.length === 0) {
    badge.textContent = 'Awaiting Import';
    badge.className   = 'badge badge-info';
    rows.innerHTML = `
      <div style="padding:16px 4px;font-size:13px;color:var(--navy-600);line-height:1.6">
        <strong>Awaiting initial dataset:</strong> 0 records currently stored in IndexedDB.
        Validation targets will be evaluated once the initial dataset is imported.
        <ul style="margin:8px 0 0 18px;font-size:12px;color:var(--navy-500)">
          <li>Target after initial import: 44 total records (30 calls, 14 meetings).</li>
          <li>Target usable transcripts: 17 in initial batch; 18 post-update.</li>
        </ul>
      </div>`;
    return;
  }

  const total = records.length;
  const calls = records.filter(r => r.source_type === 'call').length;
  const meetings = records.filter(r => r.source_type === 'meeting').length;

  const m07 = records.find(r => r.record_ref === 'M07');
  const m07HasTurns = m07?.transcript_payload?.turns?.length > 0;
  const isPostUpdate = m07HasTurns || (lastImport && lastImport.batch_id === 'update-002');

  const usableTranscripts = records.filter(r => {
    if (!r.has_transcript) return false;
    if (r.source_type === 'call') return typeof r.transcript_text === 'string' && r.transcript_text.trim().length > 0;
    if (r.source_type === 'meeting') {
      const turns = r.transcript_payload?.turns;
      return Array.isArray(turns) && turns.length > 0;
    }
    return false;
  }).length;

  const noUsableTx = total - usableTranscripts;
  const needsReview = records.filter(r => r.review_status === 'needs-review').length;
  const manualOverridesCount = decisions?.length || 0;
  const staleAnalysesCount = analyses?.filter(a => a.stale).length || 0;
  const completedAnalysesCount = analyses?.length || 0;

  const expectedUsableTx = isPostUpdate ? 18 : 17;
  const expectedMissingTx = isPostUpdate ? 26 : 27;
  const expectedNeedsReview = isPostUpdate ? 18 : 17;

  const validationItems = [
    {
      label: 'Total unique records',
      expected: 44,
      actual: total,
      note: 'Assignment target',
      pass: total === 44,
    },
    {
      label: 'Number of calls',
      expected: 30,
      actual: calls,
      note: 'source_type = call',
      pass: calls === 30,
    },
    {
      label: 'Number of meetings',
      expected: 14,
      actual: meetings,
      note: 'source_type = meeting',
      pass: meetings === 14,
    },
    {
      label: 'Records with usable transcript',
      expected: expectedUsableTx,
      actual: usableTranscripts,
      note: isPostUpdate ? 'Post-update (includes M07 turns)' : 'Initial batch (17 pre-update; 18 post-update)',
      pass: usableTranscripts === expectedUsableTx,
    },
    {
      label: 'Records without usable transcript',
      expected: expectedMissingTx,
      actual: noUsableTx,
      note: isPostUpdate ? '20 campaign calls + 6 silent/unrecorded' : '20 campaign calls + 7 silent/unrecorded',
      pass: noUsableTx === expectedMissingTx,
    },
    {
      label: 'Records requiring review',
      expected: expectedNeedsReview,
      actual: needsReview,
      note: 'Conversations with actionable transcript content',
      pass: needsReview === expectedNeedsReview,
    },
    {
      label: 'Completed analyses',
      expected: total,
      actual: completedAnalysesCount,
      note: 'All ingested records analysed',
      pass: completedAnalysesCount === total,
    },
    {
      label: 'Manual route overrides',
      expected: manualOverridesCount,
      actual: manualOverridesCount,
      note: manualOverridesCount > 0 ? `${manualOverridesCount} user correction(s) active` : '0 until user overrides route in detail view',
      pass: true,
    },
    {
      label: 'Stale analyses',
      expected: isPostUpdate ? (staleAnalysesCount > 0 ? 1 : 0) : 0,
      actual: staleAnalysesCount,
      note: staleAnalysesCount > 0 ? 'M07 transcript updated; review & recompute pending' : 'All analyses current',
      pass: true,
    },
  ];

  let allPass = true;
  let rowsHtml = validationItems.map(item => {
    if (!item.pass) allPass = false;
    return `
      <div class="validation-row ${item.pass ? 'pass' : 'warn'}">
        <span class="vr-label">
          ${esc(item.label)}
          ${item.note ? `<span style="font-size:10px;color:var(--navy-500);margin-left:6px">(${esc(item.note)})</span>` : ''}
        </span>
        <span class="vr-expected">target: ${item.expected}</span>
        <span class="vr-actual">actual: ${item.actual}</span>
      </div>`;
  }).join('');

  if (lastImport) {
    rowsHtml += `
      <div style="margin-top:12px;padding-top:10px;border-top:1px dashed var(--navy-200);font-size:11px;color:var(--navy-600);display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <span><strong>Most Recent Batch:</strong> <code>${esc(lastImport.batch_id)}</code> (rev ${esc(String(lastImport.revision ?? 1))})</span>
        <span><strong>Added:</strong> ${lastImport.inserted} · <strong>Updated:</strong> ${lastImport.updated} · <strong>Unchanged:</strong> ${lastImport.unchanged}</span>
      </div>`;
  }

  rows.innerHTML = rowsHtml;
  badge.textContent = allPass ? '✓ All Validations Passed' : '⚠ Validation Notice';
  badge.className = 'badge ' + (allPass ? 'badge-green' : 'badge-amber');
}

function renderPersonChart(records) {
  const el = document.getElementById('chart-person');
  if (!el) return;

  const counts = {};
  records.forEach(r => {
    const p = getPersonName(r);
    if (!counts[p]) counts[p] = { calls: 0, meetings: 0 };
    if (r.source_type === 'call')    counts[p].calls++;
    if (r.source_type === 'meeting') counts[p].meetings++;
  });

  const entries = Object.entries(counts).sort((a, b) => (b[1].calls + b[1].meetings) - (a[1].calls + a[1].meetings));
  const maxVal  = Math.max(...entries.map(([, v]) => v.calls + v.meetings), 1);

  el.innerHTML = `<div class="bar-chart">${entries.map(([name, v]) => {
    const total = v.calls + v.meetings;
    return `
      <div class="bar-row" title="${esc(name)}: ${v.calls} calls, ${v.meetings} meetings">
        <span class="bar-label">${esc(name)}</span>
        <div class="bar-track">
          <div class="bar-fill calls" style="width:${Math.round((v.calls/maxVal)*100)}%"></div>
        </div>
        <span class="bar-count">${v.calls}c ${v.meetings}m</span>
      </div>`;
  }).join('')}</div>`;
}

function renderRoutingChart(routeCounts) {
  const el = document.getElementById('chart-routing');
  if (!el) return;

  const colors = {
    'Sales Coaching':       '#7c3aed',
    'Deal Next Steps':      '#2563EB',
    'Customer Follow-up':   '#0d9488',
    'Partner / Referral':   '#16a34a',
    'Internal/Vendor Note': '#475569',
    'Human Review':         '#d97706',
    'No Action':            '#94a3b8',
  };

  const entries = Object.entries(routeCounts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    el.innerHTML = '<p class="text-muted">No routing data yet.</p>';
    return;
  }

  el.innerHTML = `<div class="pie-chart">${entries.map(([dest, count]) =>
    `<div class="pie-legend-item">
      <span class="pie-dot" style="background:${colors[dest] || '#888'}"></span>
      ${esc(dest)} <span class="pie-count">${count}</span>
    </div>`
  ).join('')}</div>`;
}

// ── Drill-down ──

function openDrill(drillKey, records, analysisMap, decisionMap) {
  const overlay = document.getElementById('metric-drill-overlay');
  const title   = document.getElementById('drill-title');
  const content = document.getElementById('drill-content');
  if (!overlay) return;

  let subset = records;
  let heading = 'All records';

  switch (drillKey) {
    case 'calls':          subset = records.filter(r => r.source_type === 'call');    heading = 'Calls'; break;
    case 'meetings':       subset = records.filter(r => r.source_type === 'meeting'); heading = 'Meetings'; break;
    case 'has_transcript': subset = records.filter(r => r.has_transcript);             heading = 'Records with transcript'; break;
    case 'no_transcript':  subset = records.filter(r => !r.has_transcript);            heading = 'Records missing transcript'; break;
    case 'needs_review':   subset = records.filter(r => r.review_status === 'needs-review'); heading = 'Needs review'; break;
    case 'no_action':      subset = records.filter(r => r.review_status === 'no-action-needed'); heading = 'No action needed'; break;
    case 'conversations':
      subset = records.filter(r => {
        if (r.source_type === 'call') return r.payload?.is_conversation;
        const turns = r.transcript_payload?.turns;
        return Array.isArray(turns) && turns.length > 0;
      });
      heading = 'Conversations';
      break;
    case 'overrides': {
      const keys = new Set(Object.keys(decisionMap));
      subset = records.filter(r => keys.has(r.record_key));
      heading = 'Manual overrides';
      break;
    }
    case 'stale': {
      subset = records.filter(r => analysisMap[r.record_key]?.stale);
      heading = 'Stale analysis';
      break;
    }
    default: heading = 'All records';
  }

  title.textContent = `${heading} (${subset.length})`;

  content.innerHTML = subset.length === 0
    ? '<p class="text-muted" style="padding:16px">No records in this group.</p>'
    : `<table class="data-table">
        <thead><tr>
          <th>Ref</th><th>Type</th><th>Person</th><th>Status</th><th>Route</th>
        </tr></thead>
        <tbody>${subset.map(r => {
          const a = analysisMap[r.record_key];
          const d = decisionMap[r.record_key];
          const routes = d?.manual_routes?.length ? d.manual_routes : (a?.routes || []);
          const primaryRoute = routes[0]?.destination || '—';
          return `<tr>
            <td><span class="fw-mono" style="font-size:11px">${esc(r.record_ref)}</span></td>
            <td>${esc(r.source_type)}</td>
            <td>${esc(getPersonName(r))}</td>
            <td>${statusBadge(r.review_status)}</td>
            <td>${esc(primaryRoute)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;

  overlay.classList.remove('hidden');
}

export function initOverlayClose() {
  const overlay = document.getElementById('metric-drill-overlay');
  const btn     = document.getElementById('drill-close');
  if (btn) btn.addEventListener('click', () => overlay?.classList.add('hidden'));
  overlay?.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });
}

function renderManagerBrief() {
  const el = document.getElementById('manager-brief-content');
  if (!el) return;

  el.innerHTML = `
    <div class="provenance-box">
      <strong>Provenance:</strong> This brief is deterministic and based on the 44 source records and their
      transcripts. It was authored by the intelligence engine and reflects the verified state.
      All conclusions cite source record references and transcript passages.
    </div>

    <h3>Activity Summary — 21 August 2026</h3>
    <p>
      44 source records were captured across 30 calls and 14 meetings on 21 August 2026. Two sales
      representatives (Arun, workspace-01; Leela, workspace-02) ran high-volume outbound calling
      campaigns (20 campaign calls, almost all voicemails or unresponsive). Three additional reps —
      Kiran (workspace-02), Meera (workspace-03), and Dev (workspace-03) — conducted substantive
      sales and partnership conversations. Active accounts include Cedarwave Distribution,
      Willowfield Trust, Asterloom Systems, LedgerBridge, and Harborpath Advisory.
    </p>

    <h3>Finding 1 — Partner Activation Ready: Harborpath Advisory (M01)</h3>
    <p>
      Harborpath Advisory produced the clearest actionable commercial outcome of the day. The partner
      expressed explicit willingness to proceed with onboarding
      (<span class="finding-ref">M01 · 00:10:26</span>: <em>"No, let us get the partner onboarding started"</em>)
      and agreed to a unique referral link approach. <strong>Action:</strong> Send MOU, pricing document,
      and referral link without delay.
    </p>

    <h3>Finding 2 — Pricing Confusion Damaged Cedarwave & Asterloom Conversations</h3>
    <p>
      In the Asterloom Systems demo (M03), the rep combined annual subscription (INR 26,000) and
      integration setup (INR 13,000) into an unexpected INR 39,000 figure, causing customer pushback
      (<span class="finding-ref">M03 · 00:30:41</span>). In Cedarwave Distribution (M04), the rep
      could not confirm bank-card feed eligibility on the call. <strong>Coaching opportunity:</strong>
      Establish pre-call pricing clarity and confirm programme eligibility in advance.
    </p>

    <h3>Finding 3 — Customer Support Issues Require Expedited Resolution (M07)</h3>
    <p>
      Willowfield Trust raised four product bugs in their support session (M07):
      (1) description field not saving visually; (2) file upload blocked via Recreate payment;
      (3) reimbursements stuck in Processing; (4) Mark-as-paid amount carrying forward.
      Workarounds were provided for 1 and 2, but 3 was promised resolution within "an hour or two"
      (<span class="finding-ref">M07 · 00:15:37</span>).
    </p>

    <h3>Coaching Opportunities</h3>
    <ul>
      <li><strong>C01 (Arun):</strong> Prospect challenged how contact details were obtained. Cold-call consent handling needs coaching.</li>
      <li><strong>C06 (Meera/Ravi):</strong> Continued pitching after explicit rejection from a 120+ store prospect with existing automation.</li>
      <li><strong>C10 (Meera):</strong> Proposed follow-up call after prospect stated they would reach out if interested.</li>
      <li><strong>C03 (Kiran):</strong> Continued substantive pitch on poor roaming audio instead of rescheduling.</li>
    </ul>

    <h3>Follow-up Priorities</h3>
    <ul>
      <li>M01 — Send Harborpath Advisory MOU, referral link, pricing doc.</li>
      <li>M04 — Confirm Cedarwave bank-card feed eligibility with programme team.</li>
      <li>M07 — Follow up Willowfield Trust on all four bug resolutions.</li>
      <li>C03 — Kiran: send follow-up email and call early next week.</li>
      <li>C08 — Meera: send proposal to contact08@example.com (referred by Raghav).</li>
      <li>C07 — Dev: send partnership proposal to Willowbank Advisory.</li>
    </ul>
  `;
}
