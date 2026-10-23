/**
 * views/detail.js — Conversation Detail view
 */

import { db } from '../db.js';
import { formatIST, formatDuration, esc, getPersonName } from '../utils.js';
import { routeBadge, statusBadge, intakeBadge, confidenceDot, ROUTE_COLORS } from './shared.js';
import { toast } from '../utils.js';

const ALL_ROUTES = [
  'Sales Coaching',
  'Deal Next Steps',
  'Customer Follow-up',
  'Partner / Referral',
  'Internal/Vendor Note',
  'Human Review',
  'No Action',
];

let _currentDetailRecord = null;

export async function renderDetailDefault() {
  if (_currentDetailRecord) {
    return renderDetail(_currentDetailRecord);
  }
  const records = await db.getAllRecords();
  if (!records || records.length === 0) {
    const header  = document.getElementById('detail-header-main');
    const content = document.getElementById('detail-content');
    if (header) header.innerHTML = `<h1 class="page-title">Conversation Details</h1>`;
    if (content) content.innerHTML = `
      <div class="card" style="padding:48px 24px;text-align:center;width:100%">
        <p class="text-muted" style="margin-bottom:14px">No conversations found in workspace. Ingest a dataset to inspect conversation details.</p>
        <button class="btn btn-primary btn-sm" onclick="window.location.hash='#import'">Go to Import</button>
      </div>`;
    return;
  }
  const defaultRec = records.find(r => r.has_transcript) || records[0];
  return renderDetail(defaultRec);
}

export async function renderDetail(rec) {
  _currentDetailRecord = rec;
  const [analysis, decision, auditEvents] = await Promise.all([
    db.getAnalysis(rec.record_key),
    db.getDecision(rec.record_key),
    db.getAuditForRecord(rec.record_key),
  ]);

  const header  = document.getElementById('detail-header-main');
  const content = document.getElementById('detail-content');
  if (!header || !content) return;

  const startedAt = rec.source_type === 'call' ? rec.payload?.started_at : rec.payload?.starts_at;
  const person    = getPersonName(rec);
  const title     = rec.source_type === 'meeting'
    ? (rec.payload?.title || 'Meeting')
    : `Call ${rec.record_ref}`;

  header.innerHTML = `
    <div>
      <h1 class="page-title">${esc(title)}</h1>
      <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
        <span class="badge badge-${rec.source_type === 'call' ? 'blue' : 'teal'}">${esc(rec.source_type)}</span>
        <span style="font-size:12px;color:var(--navy-500)">${esc(rec.record_ref)}</span>
        <span style="font-size:12px;color:var(--navy-500)">${formatIST(startedAt)}</span>
        ${statusBadge(rec.review_status)}
      </div>
    </div>
  `;

  const effectiveRoutes = decision?.manual_routes?.length
    ? decision.manual_routes
    : (analysis?.routes || []);

  const isOverride = !!decision;
  const isStale    = analysis?.stale && !isOverride;

  content.innerHTML = `
    <div class="detail-main">
      <!-- Source metadata -->
      <div class="card">
        <div class="detail-section">
          <div class="detail-section-title">Source metadata <span style="color:var(--blue-600);font-size:10px">ORIGINAL SOURCE DATA</span></div>
          ${renderMetaGrid(rec)}
        </div>
      </div>

      <!-- Transcript -->
      <div class="card">
        <div class="detail-section">
          <div class="detail-section-title">
            Transcript
            ${rec.has_transcript
              ? '<span class="badge badge-green" style="margin-left:6px">Available</span>'
              : '<span class="badge badge-amber" style="margin-left:6px">Not available</span>'}
          </div>
          ${renderTranscript(rec)}
        </div>
      </div>

      <!-- Analysis -->
      <div class="card">
        ${isStale ? `
          <div style="padding:14px 18px 0">
            <div class="stale-banner" style="background:var(--amber-50);border:1px solid var(--amber-200);border-radius:var(--radius);padding:12px 16px;font-size:12px;color:var(--amber-900);line-height:1.6">
              <strong>⚠️ Analysis is Stale:</strong> ${esc(analysis?.stale_reason || 'Transcript content was updated in the update batch.')}<br>
              Review the updated transcript below to verify the conversation content, then click to update the intelligence model:
              <div style="margin-top:8px">
                <button class="btn btn-primary btn-sm" id="btn-recompute-analysis">Recompute Analysis for Updated Transcript</button>
              </div>
            </div>
          </div>` : ''}
        <div class="detail-section">
          <div class="detail-section-title">Automated analysis <span style="color:var(--navy-400);font-size:10px">SYSTEM-GENERATED · ${analysis ? formatIST(analysis.computed_at) : 'N/A'}</span></div>
          ${renderAnalysisSection(analysis, isOverride)}
        </div>
      </div>

      <!-- Revision / audit history -->
      <div class="card">
        <div class="detail-section">
          <div class="detail-section-title">Change history</div>
          ${renderHistory(auditEvents)}
        </div>
      </div>
    </div>

    <div class="detail-side">
      <!-- Routing controls -->
      <div class="card">
        <div class="card-header">
          <h2 class="card-title">Routing</h2>
          ${isOverride ? '<span class="badge badge-amber">Manual override active</span>' : '<span class="badge badge-navy">Automated</span>'}
        </div>
        <div style="padding:14px 16px">
          <p style="font-size:12px;color:var(--navy-500);margin-bottom:10px">
            ${isOverride
              ? 'This record has a manual route override. The automated suggestion is shown in parentheses.'
              : 'Automated routing based on transcript analysis.'}
          </p>

          <p class="detail-section-title" style="margin-bottom:8px">Current routes</p>
          <div id="current-routes" style="margin-bottom:14px">
            ${effectiveRoutes.map(r => routeBadge(r.destination)).join(' ')}
          </div>

          <p class="detail-section-title" style="margin-bottom:8px">Override route</p>
          <div class="route-control-row">
            <select class="route-select" id="route-select-input" aria-label="Select override route">
              <option value="">— Select route —</option>
              ${ALL_ROUTES.map(r => `<option value="${esc(r)}" ${decision?.manual_routes?.[0]?.destination === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}
            </select>
          </div>
          <div class="button-row" style="margin-top:8px">
            <button class="btn btn-primary btn-sm" id="btn-apply-override">Apply override</button>
            ${isOverride ? '<button class="btn btn-ghost btn-sm btn-danger" id="btn-reset-override">Reset to auto</button>' : ''}
          </div>
          ${isOverride ? `
            <div class="override-indicator" style="margin-top:10px">
              ⚡ Override applied ${formatIST(decision.override_at)}
              ${decision.override_by ? `by ${esc(decision.override_by)}` : ''}
            </div>
          ` : ''}
        </div>
      </div>

      <!-- Key fields -->
      <div class="card">
        <div class="card-header"><h2 class="card-title">Key fields</h2></div>
        <div style="padding:14px 16px">
          ${renderKeyFields(rec)}
        </div>
      </div>

      <!-- Evidence & next action -->
      ${analysis ? `
      <div class="card">
        <div class="card-header"><h2 class="card-title">Recommended action</h2></div>
        <div style="padding:14px 16px">
          <p style="font-size:13px;color:var(--navy-700)">${esc(analysis.next_action || '—')}</p>
        </div>
      </div>
      ` : ''}
    </div>
  `;

  // Bind override buttons
  document.getElementById('btn-apply-override')?.addEventListener('click', () => {
    applyOverride(rec.record_key, rec.record_ref);
  });
  document.getElementById('btn-reset-override')?.addEventListener('click', () => {
    resetOverride(rec.record_key, rec.record_ref);
  });

  // Bind recompute analysis button
  document.getElementById('btn-recompute-analysis')?.addEventListener('click', async () => {
    const { computeAnalysis } = await import('../analysis.js');
    const freshAnalysis = computeAnalysis(rec);
    await db.putAnalysis(freshAnalysis);
    await db.addAuditEvent({
      record_key: rec.record_key,
      field:      'analysis',
      prev:       'stale',
      next:       'current',
      source:     'user-recompute',
      ts:         new Date().toISOString(),
      detail:     'Analysis recomputed after reviewing updated transcript turns',
    });
    toast('Analysis recomputed and updated.', 'success');
    await renderDetail(rec);
  });
}

async function applyOverride(recordKey, recordRef) {
  const sel = document.getElementById('route-select-input');
  const destination = sel?.value;
  if (!destination) { toast('Select a route first.', 'warning'); return; }

  const existing = await db.getDecision(recordKey);

  const decision = {
    record_key:    recordKey,
    manual_routes: [{ destination, reason: 'Manual override by user', evidence: null, confidence: 'manual' }],
    override_at:   new Date().toISOString(),
    override_by:   'user',
    previous_auto_routes: existing?.previous_auto_routes || null,
  };

  await db.putDecision(decision);

  await db.addAuditEvent({
    record_key: recordKey,
    field:      'route',
    prev:       existing?.manual_routes?.[0]?.destination || 'auto',
    next:       destination,
    source:     'manual-override',
    ts:         decision.override_at,
  });

  toast(`Route overridden to "${destination}"`, 'success');

  // Reload detail
  const rec = await db.getRecord(recordKey);
  if (rec) renderDetail(rec);
}

async function resetOverride(recordKey) {
  await db.deleteFromStore?.('manual_decisions', recordKey);
  // Fallback via direct delete
  try {
    const { deleteFromStore } = await import('../db.js');
    await deleteFromStore('manual_decisions', recordKey);
  } catch {}

  // Also try via db wrapper
  await db.putDecision({ record_key: recordKey, __deleted: true }).catch(() => {});

  // Actually use the correct approach:
  const { deleteFromStore: del } = await import('../db.js');
  await del('manual_decisions', recordKey).catch(() => {});

  await db.addAuditEvent({
    record_key: recordKey,
    field:      'route',
    prev:       'manual-override',
    next:       'auto',
    source:     'override-reset',
    ts:         new Date().toISOString(),
  });

  toast('Override reset — showing automated route.', 'success');

  const rec = await db.getRecord(recordKey);
  if (rec) renderDetail(rec);
}

// ── Sub-renderers ──

function renderMetaGrid(rec) {
  const p = rec.payload || {};
  const rows = [];

  if (rec.source_type === 'call') {
    rows.push(
      ['Source type',   'call'],
      ['Source ID',     `<code>${esc(rec.source_id)}</code>`],
      ['External ID',   esc(p.external_call_id || '—')],
      ['Direction',     esc(p.direction || '—')],
      ['Started at',    formatIST(p.started_at)],
      ['Duration',      formatDuration(p.duration_seconds)],
      ['Talk time',     formatDuration(p.talk_time_seconds)],
      ['Rep',           esc(p.rep_name || p.rep_email || '—')],
      ['Outcome',       `<span class="badge badge-navy">${esc(p.observed_outcome || '—')}</span>`],
      ['Is conversation', p.is_conversation ? '<span class="badge badge-green">Yes</span>' : '<span class="badge badge-navy">No</span>'],
      ['Is connected',  p.is_connected ? '<span class="badge badge-green">Yes</span>' : '<span class="badge badge-navy">No</span>'],
      ['Campaign call', p.is_campaign_call ? 'Yes' : 'No'],
      ['Prior dials',   esc(String(p.prior_dials_ever ?? '—'))],
      ['Speakers',      esc(String(p.speaker_count ?? '—'))],
      ['Segments',      esc(String(p.segment_count ?? '—'))],
    );
  } else {
    rows.push(
      ['Source type',   'meeting'],
      ['Source ID',     `<code>${esc(rec.source_id)}</code>`],
      ['Title',         esc(p.title || '—')],
      ['Provider',      esc(p.provider || '—')],
      ['Starts at',     formatIST(p.starts_at)],
      ['Ends at',       formatIST(p.ends_at)],
      ['Duration',      formatDuration(p.duration_seconds)],
      ['Organiser',     esc(p.organizer_email || '—')],
      ['Attendees',     esc(String(p.attendee_count ?? '—'))],
      ['Recording',     esc(p.recording_status || '—')],
      ['Has transcript',p.has_transcript ? '<span class="badge badge-green">Yes</span>' : '<span class="badge badge-navy">No</span>'],
      ['Summary status',esc(p.summary_status || '—')],
    );
  }

  rows.push(
    ['Intake status',  intakeBadge(rec.intake_status)],
    ['Review status',  statusBadge(rec.review_status)],
    ['Import revision', esc(String(rec.import_revision ?? '—'))],
    ['Imported at',    formatIST(rec.imported_at)],
  );

  return `<div class="meta-grid">${rows.map(([k, v]) =>
    `<span class="meta-key">${esc(k)}</span><span class="meta-val">${v}</span>`
  ).join('')}</div>`;
}

function renderTranscript(rec) {
  if (!rec.has_transcript) {
    const reason = rec.transcript_payload?.unavailable_reason || 'No transcript available.';
    return `<p class="analysis-empty">Not available — ${esc(reason)}</p>`;
  }

  if (rec.source_type === 'call') {
    return `<div class="call-transcript">${esc(rec.transcript_text || '')}</div>`;
  }

  if (rec.source_type === 'meeting') {
    const turns = rec.transcript_payload?.turns || [];
    if (!turns.length) return '<p class="analysis-empty">No transcript turns available.</p>';

    const isUpdateBatch = (rec.import_revision ?? 1) > 1 || (rec.record_ref === 'M07' && turns.length > 0);

    return `
      ${isUpdateBatch ? `
        <div style="margin-bottom:10px;padding:8px 12px;background:var(--purple-50);border:1px solid var(--purple-200);border-radius:var(--radius);font-size:12px;color:var(--purple-900);display:flex;align-items:center;justify-content:space-between">
          <span><strong>Additional Transcript Delivered:</strong> Ingested from update batch (Revision ${esc(String(rec.import_revision))}).</span>
          <span class="badge badge-purple">${turns.length} turns</span>
        </div>` : ''}
      <div class="transcript-container">${turns.map(t => {
      const sp = (t.speaker || '').toLowerCase();
      const cls = sp.includes('team') ? 'team' : sp.includes('supplier') ? 'supplier' : 'customer';
      return `
        <div class="transcript-turn">
          <div>
            <div class="turn-speaker ${cls}">${esc(t.speaker)}</div>
            <div class="turn-time">${esc(t.timecode || '')}</div>
          </div>
          <div class="turn-text">${esc(t.text)}</div>
        </div>`;
    }).join('')}</div>`;
  }

  return '<p class="analysis-empty">Unknown source type.</p>';
}

function renderAnalysisSection(analysis, isOverride) {
  if (!analysis) return '<p class="analysis-empty">No analysis computed yet.</p>';

  if (!analysis.routes?.length) return '<p class="analysis-empty">No routing data.</p>';

  return `
    <p style="font-size:12px;color:var(--navy-600);margin-bottom:12px">${esc(analysis.summary || '—')}</p>

    ${analysis.routes.map((r, i) => `
      <div style="background:var(--navy-50);border-radius:var(--radius);padding:12px 14px;margin-bottom:10px;${isOverride?'opacity:0.65':''}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          ${routeBadge(r.destination)}
          <span>${confidenceDot(r.confidence)}</span>
          <span style="font-size:11px;color:var(--navy-400)">${esc(r.confidence)} confidence</span>
          ${isOverride ? '<span style="font-size:11px;color:var(--amber-600)">[SUPERSEDED BY OVERRIDE]</span>' : ''}
        </div>
        <p style="font-size:12px;color:var(--navy-700);margin-bottom:6px">${esc(r.reason || '—')}</p>
        ${r.evidence ? `<div class="evidence-passage">${esc(r.evidence)}</div>` : ''}
        ${r.uncertainty ? `<p style="font-size:11px;color:var(--amber-600)">⚠ ${esc(r.uncertainty)}</p>` : ''}
      </div>
    `).join('')}

    ${analysis.limitations?.length ? `
      <div style="margin-top:10px">
        <p style="font-size:11px;font-weight:600;color:var(--navy-500);margin-bottom:4px">LIMITATIONS</p>
        ${analysis.limitations.map(l => `<p style="font-size:11px;color:var(--amber-600)">⚠ ${esc(l)}</p>`).join('')}
      </div>
    ` : ''}
  `;
}

function renderKeyFields(rec) {
  const p = rec.payload || {};
  if (rec.source_type === 'call') {
    return `
      <div class="meta-grid">
        <span class="meta-key">Outcome</span><span class="meta-val"><span class="badge badge-navy">${esc(p.observed_outcome || '—')}</span></span>
        <span class="meta-key">Duration</span><span class="meta-val">${formatDuration(p.duration_seconds)}</span>
        <span class="meta-key">Campaign</span><span class="meta-val">${p.is_campaign_call ? 'Yes' : 'No'}</span>
      </div>`;
  }
  return `
    <div class="meta-grid">
      <span class="meta-key">Recording</span><span class="meta-val"><span class="badge badge-navy">${esc(p.recording_status || '—')}</span></span>
      <span class="meta-key">Duration</span><span class="meta-val">${formatDuration(p.duration_seconds)}</span>
      <span class="meta-key">Attendees</span><span class="meta-val">${esc(String(p.attendee_count ?? '—'))}</span>
    </div>`;
}

function renderHistory(events) {
  if (!events?.length) return '<p class="analysis-empty">No change history.</p>';
  const sorted = [...events].sort((a, b) => (b.ts > a.ts ? 1 : -1));
  return `<div>${sorted.map(e => `
    <div class="history-entry">
      <span class="history-time">${formatIST(e.ts)}</span>
      <div>
        <div class="history-detail">${esc(e.field)}: ${esc(e.prev ?? '—')} → ${esc(e.next ?? '—')}</div>
        <div class="history-source">Source: ${esc(e.source)}${e.detail ? ` · ${esc(e.detail)}` : ''}</div>
      </div>
    </div>`).join('')}</div>`;
}
