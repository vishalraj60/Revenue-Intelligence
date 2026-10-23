/**
 * views/methodology.js — Methodology reference view
 */

export function renderMethodology() {
  const el = document.getElementById('methodology-content');
  if (!el) return;

  el.innerHTML = `
    <div class="methodology-section">
      <h2>Metric Definitions</h2>

      <h3>Total records</h3>
      <p>Count of all records in the IndexedDB <code>source_records</code> store. Identity key is <code>(source_type, source_id)</code>. Importing the same batch twice does not inflate this count.</p>

      <h3>Calls / Meetings</h3>
      <p>Partitioned by <code>source_type</code> field in each record. 30 calls are expected; 14 meetings. Validated against assignment targets.</p>

      <h3>Has transcript</h3>
      <p>For calls: <code>payload.transcript</code> is a non-empty string. For meetings: <code>transcript_payload.turns</code> is a non-empty array. This is the count of records with usable text content. Expected: 17 in initial batch, 18 after <code>02_update.json</code>.</p>

      <h3>Missing transcript</h3>
      <p>Records where transcript content is absent. Includes: voicemails, unresponsive calls, silent recordings, cancelled/unscheduled meeting recordings, and records where the transcript is pending a later delivery.</p>

      <h3>Needs review</h3>
      <p>Records with <code>review_status = "needs-review"</code>. These are conversations with usable transcript content that have not yet been manually reviewed or explicitly closed.</p>

      <h3>No action</h3>
      <p>Records with <code>review_status = "no-action-needed"</code>. Voicemails, unresponsive calls, silent recordings, cancelled meetings. No routing action is possible.</p>

      <h3>Manual overrides</h3>
      <p>Count of records with an entry in the <code>manual_decisions</code> store. A manual override replaces the automated route in all displays but does not delete the automated analysis.</p>

      <h3>Stale analysis</h3>
      <p>Records where the transcript content changed after the analysis was last computed. The <code>analysis.stale</code> flag is set to <code>true</code> and the reason is recorded in <code>analysis.stale_reason</code>. Analysis is recomputed automatically when a transcript arrives for the first time; the stale flag marks cases where a <em>change</em> to an existing transcript occurred after analysis was already stored.</p>
    </div>

    <div class="methodology-section">
      <h2>Routing Rules</h2>
      <p>Routing is deterministic — no external AI service is called at runtime. Rules are defined in <code>js/analysis.js</code> and are keyed to specific <code>record_ref</code> values where the actual conversation content is known and specific. For records without usable transcript content, the engine assigns <strong>No Action</strong> or <strong>Human Review</strong> and does not invent analysis.</p>

      <h3>Routing destinations</h3>
      <ul>
        <li><strong>Sales Coaching</strong> — Rep behaviour that warrants manager feedback. Examples: cold-call consent handling, pushing past rejection signals, poor audio management.</li>
        <li><strong>Deal Next Steps</strong> — Active sales conversation with an agreed follow-up action (email, callback, demo). The next step is explicitly stated in the transcript.</li>
        <li><strong>Customer Follow-up</strong> — Existing customer requires post-meeting action: support resolution, account setup, migration confirmation.</li>
        <li><strong>Partner / Referral</strong> — Third-party partnership discussion or prospect referral to a named contact.</li>
        <li><strong>Internal/Vendor Note</strong> — Internal SpendNest team meeting, billing training, or vendor evaluation with no direct customer action.</li>
        <li><strong>Human Review</strong> — Transcript present but no routing rule matched, or transcript expected but not yet available.</li>
        <li><strong>No Action</strong> — Voicemail, unresponsive, silent recording, or cancelled meeting. No analysis possible.</li>
      </ul>

      <h3>Evidence standard</h3>
      <p>Every route that is not <strong>No Action</strong> must cite a supporting passage from the transcript, a turn reference (timecode), and any uncertainty or limitation. The routing engine does not use keyword matching alone — the rule must be grounded in an identifiable passage.</p>

      <h3>Manual overrides</h3>
      <p>A user can override the automated route from the Conversation Details view. The override is stored in <code>manual_decisions</code>. When an import update arrives, the override is preserved — it is never silently overwritten by a new automated suggestion. The user must explicitly reset the override to return to the automated route.</p>
    </div>

    <div class="methodology-section">
      <h2>Data Persistence Model</h2>

      <h3>Source records (<code>source_records</code>)</h3>
      <p>Original source fields, latest imported revision, transcript text, transcript fingerprint, intake/review status, import provenance. Identity key: <code>source_type::source_id</code>.</p>

      <h3>Automated analysis (<code>analysis</code>)</h3>
      <p>Computed routes, summary, evidence passages, next action, limitations, staleness flag, transcript fingerprint at time of computation.</p>

      <h3>Manual decisions (<code>manual_decisions</code>)</h3>
      <p>User-selected route override, override timestamp, previous auto routes. Never overwritten by imports.</p>

      <h3>Import history (<code>import_history</code>)</h3>
      <p>Batch ID, revision, timestamp, inserted/updated/unchanged/rejected counts, warnings, errors.</p>

      <h3>Audit events (<code>audit_events</code>)</h3>
      <p>Record-level change events: field name, previous value, new value, change source (import batch ID or "manual-override"), timestamp.</p>
    </div>

    <div class="methodology-section">
      <h2>Import and Update Semantics (DATA_CONTRACT)</h2>

      <p>The data contract is implemented in <code>js/importer.js</code>:</p>
      <ul>
        <li>Logical identity is <code>(source_type, source_id)</code> — not array position or display name.</li>
        <li>A higher batch <code>revision</code> number triggers an update. Same or lower revision = unchanged (unless content differs).</li>
        <li>Duplicate records within a single batch are rejected after the first.</li>
        <li>When a transcript changes, existing analysis is marked stale and recomputed.</li>
        <li>Manual route decisions are never replaced by an import.</li>
        <li>Importing the same batch twice does not inflate any count.</li>
      </ul>
    </div>

    <div class="methodology-section">
      <h2>Analysis Provenance</h2>

      <p>The routing analysis and manager brief are pre-generated and deterministic. They are not produced by a live generative AI service at runtime. The rules were authored after reading all 44 source records and their transcripts. Every finding cites a specific <code>record_ref</code> and a passage from the transcript.</p>

      <p>Limitations of this approach:</p>
      <ul>
        <li>Rules are per-record — the engine does not generalise across unseen transcripts.</li>
        <li>Meeting transcripts use redacted role labels ("Team member A", "Customer A") — individual identities cannot be confirmed.</li>
        <li>Financial figures, company sizes, and timelines are prospect-stated and unverified.</li>
        <li>20 batch calls (B01–B20) have no transcript content and receive only "No Action" routing.</li>
        <li>Three meetings (M05, M08, M11) are silent recordings; three (M12, M13, M14) have no recordings at all.</li>
      </ul>
    </div>

    <div class="methodology-section">
      <h2>Startup and Reset</h2>
      <p>On first load, the application reads IndexedDB. If no records exist, it shows the Import History view with demo-load buttons. The <strong>Load initial.json</strong> button fetches <code>data/01_initial.json</code> from the local server. The <strong>Load update.json</strong> button then imports <code>data/02_update.json</code>, adding the M07 transcript.</p>
      <p><strong>Reset:</strong> The "Clear all data" button on the Import History view (or the sidebar Reset button) clears all IndexedDB stores and returns the application to its empty state. The original JSON files in <code>data/</code> are never modified.</p>
    </div>
  `;
}
