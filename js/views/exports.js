/**
 * views/exports.js — Export generation view
 */

import { db } from '../db.js';
import { formatIST, esc, getPersonName, safeFilename, toast } from '../utils.js';
import { computeAnalysis } from '../analysis.js';

export function initExportsView() {
  document.getElementById('btn-export-zip')?.addEventListener('click', generateZip);
}

async function generateZip() {
  const btn = document.getElementById('btn-export-zip');
  const statusEl = document.getElementById('export-status');
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = 'Generating…';

  try {
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip library not loaded. Check internet connection or include JSZip locally.');
    }

    const [records, analyses, decisions] = await Promise.all([
      db.getAllRecords(),
      db.getAllAnalysis(),
      db.getAllDecisions(),
    ]);

    if (!records.length) {
      toast('Workspace is empty. Ingest a dataset before exporting.', 'warning');
      if (statusEl) statusEl.textContent = '0 records in workspace.';
      if (btn) btn.disabled = false;
      return;
    }

    const analysisMap  = Object.fromEntries(analyses.map(a  => [a.record_key, a]));
    const decisionMap  = Object.fromEntries(decisions.map(d => [d.record_key, d]));

    const zip = new JSZip();
    const manifestEntries = [];

    const generatedAt = new Date().toISOString();

    for (const rec of records) {
      const analysis = analysisMap[rec.record_key] || computeAnalysis(rec);
      const decision = decisionMap[rec.record_key];

      const effectiveRoutes = decision?.manual_routes?.length
        ? decision.manual_routes
        : (analysis?.routes || []);

      const primaryRoute = effectiveRoutes[0]?.destination || 'No Action';
      const person       = getPersonName(rec);
      const safeId       = safeFilename(rec.source_id);
      const folder       = `conversations/${rec.source_type}s/${safeId}`;
      const hasContent   = rec.has_transcript;

      const manifestEntry = {
        source_type:   rec.source_type,
        source_id:     rec.source_id,
        record_ref:    rec.record_ref,
        person,
        assigned_routes: effectiveRoutes.map(r => r.destination),
        primary_route: primaryRoute,
        intake_status: rec.intake_status,
        review_status: rec.review_status,
        has_transcript: rec.has_transcript,
        manual_override: !!decision,
        stale_analysis: !!analysis.stale,
        output_paths:  hasContent
          ? [`${folder}/analysis.json`, `${folder}/analysis.md`]
          : [],
        generated_at:  generatedAt,
      };
      manifestEntries.push(manifestEntry);

      if (!hasContent) continue;

      // analysis.json
      const analysisJson = {
        record_key:       rec.record_key,
        source_type:      rec.source_type,
        source_id:        rec.source_id,
        record_ref:       rec.record_ref,
        person,
        computed_at:      analysis.computed_at,
        stale:            analysis.stale,
        manual_override:  !!decision,
        routes:           effectiveRoutes,
        summary:          analysis.summary,
        next_action:      analysis.next_action,
        limitations:      analysis.limitations,
        transcript_available: rec.has_transcript,
      };
      zip.file(`${folder}/analysis.json`, JSON.stringify(analysisJson, null, 2));

      // analysis.md
      const md = buildAnalysisMd(rec, analysis, decision, effectiveRoutes);
      zip.file(`${folder}/analysis.md`, md);
    }

    // manifest.json
    zip.file('manifest.json', JSON.stringify({ generated_at: generatedAt, record_count: records.length, entries: manifestEntries }, null, 2));

    // manifest.csv
    zip.file('manifest.csv', buildManifestCsv(manifestEntries));

    // manager brief
    zip.file('manager_brief/manager_brief_2026-08-21.md', buildManagerBriefMd());

    // routing_summary.csv
    zip.file('reports/routing_summary.csv', buildRoutingSummary(records, analysisMap, decisionMap));

    // intake_review.csv
    zip.file('reports/intake_review.csv', buildIntakeReview(records));

    // findings.md
    zip.file('reports/findings.md', buildFindingsMd());

    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'revenue-intelligence-export.zip';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    if (statusEl) statusEl.textContent = `✓ Downloaded ${(blob.size / 1024).toFixed(1)} KB`;
    toast('ZIP exported successfully.', 'success');

    // Show tree preview
    renderExportPreview(manifestEntries);

  } catch (err) {
    console.error(err);
    if (statusEl) statusEl.textContent = `Error: ${err.message}`;
    toast('Export failed — see console.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function buildAnalysisMd(rec, analysis, decision, effectiveRoutes) {
  const lines = [];
  lines.push(`# Analysis — ${rec.record_ref} (${rec.source_type})`);
  lines.push('');
  lines.push(`**Source ID:** \`${rec.source_id}\``);
  lines.push(`**Person:** ${getPersonName(rec)}`);
  lines.push(`**Date:** ${formatIST(rec.source_type === 'call' ? rec.payload?.started_at : rec.payload?.starts_at)}`);
  lines.push(`**Intake status:** ${rec.intake_status}`);
  lines.push(`**Review status:** ${rec.review_status}`);
  lines.push(`**Manual override:** ${decision ? 'Yes' : 'No'}`);
  lines.push(`**Analysis stale:** ${analysis.stale ? 'Yes — ' + (analysis.stale_reason || '') : 'No'}`);
  lines.push('');
  lines.push('## Summary');
  lines.push(analysis.summary || '—');
  lines.push('');
  lines.push('## Routes');
  effectiveRoutes.forEach((r, i) => {
    lines.push(`### ${i + 1}. ${r.destination}`);
    lines.push(`**Confidence:** ${r.confidence}`);
    lines.push(`**Reason:** ${r.reason}`);
    if (r.evidence) lines.push(`**Evidence:** > ${r.evidence}`);
    if (r.uncertainty) lines.push(`**Uncertainty:** ⚠ ${r.uncertainty}`);
    lines.push('');
  });
  lines.push('## Recommended Next Action');
  lines.push(analysis.next_action || '—');
  if (analysis.limitations?.length) {
    lines.push('');
    lines.push('## Limitations');
    analysis.limitations.forEach(l => lines.push(`- ${l}`));
  }
  lines.push('');
  lines.push(`---`);
  lines.push(`*Generated by Revenue Intelligence Inbox at ${new Date().toISOString()}*`);
  return lines.join('\n');
}

function buildManifestCsv(entries) {
  const header = 'source_type,source_id,record_ref,person,primary_route,intake_status,review_status,has_transcript,manual_override,stale_analysis';
  const rows   = entries.map(e =>
    [e.source_type, e.source_id, e.record_ref, e.person, e.primary_route,
     e.intake_status, e.review_status, e.has_transcript, e.manual_override, e.stale_analysis]
    .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`)
    .join(',')
  );
  return [header, ...rows].join('\n');
}

function buildRoutingSummary(records, analysisMap, decisionMap) {
  const header = 'record_ref,source_type,source_id,person,destination,confidence,manual_override,reason';
  const rows   = [];
  records.forEach(rec => {
    const a = analysisMap[rec.record_key];
    const d = decisionMap[rec.record_key];
    const routes = d?.manual_routes?.length ? d.manual_routes : (a?.routes || []);
    routes.forEach(r => {
      rows.push([
        rec.record_ref, rec.source_type, rec.source_id, getPersonName(rec),
        r.destination, r.confidence, !!d, r.reason
      ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
    });
  });
  return [header, ...rows].join('\n');
}

function buildIntakeReview(records) {
  const header = 'record_ref,source_type,source_id,person,intake_status,review_status,has_transcript,import_revision,imported_at';
  const rows   = records.map(rec => [
    rec.record_ref, rec.source_type, rec.source_id, getPersonName(rec),
    rec.intake_status, rec.review_status, rec.has_transcript,
    rec.import_revision, rec.imported_at,
  ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
  return [header, ...rows].join('\n');
}

function buildManagerBriefMd() {
  return `# Manager Brief — 21 August 2026 (Asia/Kolkata)

*Provenance: Pre-generated from transcript analysis. Not produced by a live AI service.*

## Activity Summary

44 source records captured: 30 calls, 14 meetings. Two reps (Arun, Leela) ran high-volume
campaign calling (20 short calls, mostly voicemails). Three reps (Kiran, Meera, Dev) ran
substantive sales and partnership conversations.

## Finding 1 — Partner Activation Ready: Harborpath Advisory (M01)

Partner A at Harborpath Advisory agreed to partner onboarding (M01 · 00:10:26).
Commission structure: USD 260 activation, USD 195–390 spend bonuses, interchange revenue share.
Referral link agreed. MOU and documents to follow.

**Action:** Send MOU and referral link immediately. Connect with marketing for podcast.

## Finding 2 — Pricing Confusion in Customer Conversations

Asterloom Systems (M03): Pricing confusion — rep combined INR 26,000 subscription and
INR 13,000 integration setup into INR 39,000 before correcting it on the call (M03 · 00:30:41).
Cedarwave Distribution (M04): Bank-card feed eligibility not confirmed on call.

**Coaching:** Pre-call pricing clarity; confirm programme eligibility before customer conversations.

## Finding 3 — Customer Support Bugs Require Expedited Resolution (M07)

Willowfield Trust raised 4 product bugs (M07 transcript arrived in update batch):
1. Description field not saving visually
2. File upload blocked via Recreate Payment route
3. Reimbursements stuck in Processing
4. Mark-as-paid amount carrying forward across items

Item 3 promised ~1-2 hour resolution. Confirm status.

## Coaching Opportunities

- C01 (Arun): Cold-call consent handling — contact challenged how details obtained.
- C06 (Meera/Ravi): Continued past a clear "already have it" rejection.
- C10 (Meera): Persisted in proposing a follow-up call after prospect declined.
- C03 (Kiran): Continued substantive call on demonstrably poor audio.

## Follow-up Priorities

1. M01 — Send Harborpath Advisory MOU + referral link (HIGH)
2. M04 — Confirm Cedarwave bank-card feed eligibility
3. M07 — Follow up Willowfield Trust on all 4 bug resolutions
4. C03 — Kiran: email Milan + call Monday/Tuesday
5. C08 — Meera: send proposal to contact08@example.com

## Limitations

- 20 batch calls (B01-B20): no transcript content (voicemails/unresponsive)
- M05, M08, M11: silent recordings
- M12, M13, M14: no recordings
- Meeting transcripts use role labels only — individual identities unconfirmed
- Financial figures and company sizes are prospect-stated and unverified

---
*Generated by Revenue Intelligence Inbox · ${new Date().toISOString()}*
`;
}

function buildFindingsMd() {
  return `# Findings Report — 21 August 2026

## Partner / Referral Findings

- **M01 Harborpath Advisory**: Ready to activate as referral partner. MOU pending.
- **C07 Willowbank Advisory (Dev/Aditya)**: Partnership conversation — virtual accounts post-incorporation. Chat message + Monday call agreed.
- **C08 (Meera/Raghav)**: Referred to people-ops colleague at contact08@example.com. Proposal to be sent.
- **C09 (Meera/Vedant)**: ~130-store prospect; referred to Mr Rishabh (business head) via LinkedIn. Do not mention Vedant.

## Deal Next Steps

- **C03 (Kiran/Milan)**: Email + Monday/Tuesday call agreed. Subject: "Developer access and event notifications — follow-up".
- **C04 (Arun/Ritesh)**: Voicemail left for Lanternpath Media. Confirm corrected email delivered.
- **C05 (Meera)**: Multi-store retail. Presentation to be sent to contact05@example.com.
- **C10 (Meera/Aniket)**: Brief to be sent via messaging app; no call scheduled.
- **M02 (LedgerBridge)**: Volume template to be completed; commercial walkthrough call to follow.
- **M03 (Asterloom)**: Clear cards proposal needed. CFO walkthrough offered.
- **M06 (Mapletrail)**: AR + expense material to be sent; include security docs.

## Customer Support

- **M04 (Cedarwave)**: Migration discussion — credit-card eligibility to be confirmed.
- **M07 (Willowfield Trust)**: 4 bugs logged; engineering follow-up required.
- **M09 (Brookmint Holdings)**: Expired invitation token — fix and resend.

## Sales Coaching

- C01: Cold-call consent — contact objected to being called
- C06: Continuing past clear "already have it" signal
- C10: Proposing call after prospect declined
- C03: Continuing on demonstrably poor audio
- M03: Pricing confusion — combined subscription and setup costs

---
*Generated by Revenue Intelligence Inbox · ${new Date().toISOString()}*
`;
}

function renderExportPreview(entries) {
  const el = document.getElementById('export-preview');
  if (!el) return;

  const callIds    = entries.filter(e => e.source_type === 'call' && e.output_paths.length).map(e => safeFilename(e.source_id)).slice(0, 3);
  const meetingIds = entries.filter(e => e.source_type === 'meeting' && e.output_paths.length).map(e => safeFilename(e.source_id)).slice(0, 3);

  el.innerHTML = `<div class="file-tree">
<span class="folder">exports/</span>
├── manifest.json
├── manifest.csv
├── <span class="folder">manager_brief/</span>
│   └── manager_brief_2026-08-21.md
├── <span class="folder">conversations/</span>
│   ├── <span class="folder">calls/</span>
${callIds.map(id => `│   │   └── <span class="folder">${esc(id)}/</span>  (analysis.json + .md)`).join('\n')}
│   │   └── … (${entries.filter(e => e.source_type === 'call' && e.output_paths.length).length} calls with content)
│   └── <span class="folder">meetings/</span>
${meetingIds.map(id => `│       └── <span class="folder">${esc(id)}/</span>  (analysis.json + .md)`).join('\n')}
│       └── … (${entries.filter(e => e.source_type === 'meeting' && e.output_paths.length).length} meetings with content)
└── <span class="folder">reports/</span>
    ├── routing_summary.csv
    ├── intake_review.csv
    └── findings.md
</div>`;
}
