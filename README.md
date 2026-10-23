# SpendNest Revenue Intelligence Inbox

A production-grade, framework-free browser application for sales conversation intelligence, activity analytics, automated routing, and manager brief generation.

Built according to the SpendNest Revenue Intelligence specification using vanilla **HTML5**, **CSS3**, and **Vanilla JavaScript (ES Modules)** backed by durable browser **IndexedDB** storage.

---

## Architecture & Tech Stack

- **Frontend**: Pure Vanilla JavaScript (ES2022+ Modules), Semantic HTML5, Custom CSS3 Design System (Inter & JetBrains Mono typography, dark-mode ready glassmorphic panels, responsive sidebar layout).
- **Storage**: Browser IndexedDB (`revenue-intelligence` v1) with transaction-managed stores for `source_records`, `analysis`, `manual_decisions`, `import_history`, and `audit_events`.
- **Archive Generation**: Client-side JSZip (loaded via CDN) producing timestamped zip packages with manifests, CSVs, and markdown reports.
- **Zero Backend Required**: Runs directly in any modern browser via any static development server.

---

## Getting Started

Run a simple local HTTP server from the project directory:

```bash
# Using Python
python3 -m http.server 8080

# Or using Node.js / npx
npx serve . -p 8080
```

Open your browser at `http://localhost:8080` (or `http://localhost:3000`).

---

## Dataset Ingestion & Update Workflow

The application supports two datasets supplied in the `data/` directory:
1. `01_initial.json`: Primary batch (`initial-001`, revision 1) containing 44 records (30 calls and 14 meetings).
2. `02_update.json`: Incremental update batch (`update-002`, revision 2) providing the full 27-turn transcript for meeting `M07`.

### How to Import:
1. Navigate to **Import & Data Management** in the sidebar.
2. Under **Supplied Assignment Datasets**, click **Import Initial Dataset (01_initial.json)** or drag & drop any custom `.json` file into the upload zone.
3. Review the **Pre-Import Preview Modal**:
   - Inspect detected batch metadata (Batch ID, Revision, exported timestamp).
   - Review impact counts: New records to insert, records to update, unchanged records, and conflicts.
   - Verify that existing user manual route overrides are preserved.
4. Click **Confirm & Apply Import** to commit records to IndexedDB.
5. Next, click **Import Update Dataset (02_update.json)** to apply the incremental revision. The preview dialog will highlight that M07's transcript is being updated (revision 2 > revision 1) without creating duplicate records.

---

## Acceptance Test Results

All 8 workflow test scenarios specified in the assignment have been executed and verified in the browser:

| Test | Scenario | Verified Behavior | Status |
| :--- | :--- | :--- | :--- |
| **Test A** | **Empty Workspace** | Clicked "Reset Workspace". Verified all stores wiped. Overview displays clean "No Dataset Imported Yet" empty state (0 records) with no fake counts. Validation panel displays "Awaiting Import". | **PASS** |
| **Test B** | **Initial Import** | Loaded `01_initial.json`. Preview modal confirmed 44 to insert. Ingested 44 records (30 calls, 14 meetings, 17 usable transcripts). Dashboard metrics match actual imported records. | **PASS** |
| **Test C** | **Duplicate Import** | Re-attempted importing `01_initial.json`. Preview modal accurately flagged 0 new, 44 unchanged. Total records remained 44 without count inflation. | **PASS** |
| **Test D** | **Manual Route Correction** | Changed routing destination on conversation in detail view. Refreshed page. Manual override persisted in IndexedDB and reflected in overview KPI. | **PASS** |
| **Test E** | **Update Dataset Import** | Imported `02_update.json`. Updated M07 from revision 1 to revision 2. Total records remained 44. Usable transcripts increased from 17 to 18. M07 analysis was flagged with `stale: true`. Inspected 27 turns in M07 and clicked "Recompute Analysis for Updated Transcript" to update routing to Customer Follow-up. | **PASS** |
| **Test F** | **Browser Restart / Reload** | Closed / reloaded browser tab. Verified all 44 records, updated M07 transcript, and manual route overrides were restored from IndexedDB. | **PASS** |
| **Test G** | **Invalid JSON Handling** | Attempted importing malformed JSON and non-JSON files. Clear syntax/schema error displayed; existing database records remained untouched. | **PASS** |
| **Test H** | **ZIP Export & Manifest** | Generated ZIP package. Verified `manifest.json` and `manifest.csv` accurately reflect the 44 records, routing destinations, review statuses, and manual override flags. | **PASS** |

---

## Core Capabilities

### 1. Overview Dashboard
- High-level KPIs: Total records, calls vs. meetings, usable transcripts, missing/silent transcripts, review status, active conversations, manual overrides, stale analyses.
- Automated validation panel reporting live data health against assignment targets.
- Activity breakdowns by team member and routing distribution.
- Automated Manager Brief summarizing key pipeline risks, critical objections, and next actions.

### 2. Intelligence Inbox
- Sortable, searchable tabular list of all 44 conversations and touchpoints.
- Multi-dimensional filters: Search query, source type (Call / Meeting), person, review status, routing destination, transcript availability, and override state.
- One-click navigation to full conversation details.

### 3. Conversation Details
- Source metadata view: Timestamps (Asia/Kolkata IST), attendees, duration, contact details.
- Full speaker-separated transcript viewer with turn timecodes and update-batch revision tags.
- Automated intelligence breakdown:
  - Sentiment score and confidence metrics.
  - Risk factors identified with evidence quotes.
  - Customer objections categorized with recommended counter-strategies.
  - Action items extracted with assignees and deadlines.
- Interactive overrides: Ability to adjust routing assignments and recompute stale analyses.

### 4. Outputs & Exports
- **Complete ZIP Archive**: Exports `manifest.json`, `manifest.csv`, per-conversation analysis files (`analysis.json` and `analysis.md`), routing summary, manager brief, and findings report.

### 5. Methodology & Rules
- Built-in reference view explaining deterministic scoring algorithms, routing rules, data contracts, and provenance.
