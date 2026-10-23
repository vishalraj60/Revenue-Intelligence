/**
 * importer.js — Revision-aware JSON import engine
 *
 * DATA CONTRACT rules:
 *  - Logical identity = (source_type, source_id)
 *  - A record with the same identity but higher batch revision replaces the stored one
 *  - Same revision = unchanged; do not inflate counts
 *  - Manual decisions are NEVER overwritten by an import
 *  - When transcript content changes, mark existing analysis as stale
 *  - Duplicate records in the same batch are rejected after the first
 */

import { db } from './db.js';
import { computeAnalysis } from './analysis.js';
import { makeRecordKey, fingerprintTranscript } from './utils.js';

/**
 * Import a parsed JSON batch object into IndexedDB.
 * Returns an import result summary.
 */
export async function previewBatch(batchData, filename = 'custom.json') {
  if (!batchData || typeof batchData !== 'object') {
    return { valid: false, errors: ['File does not contain a valid JSON object.'] };
  }

  const { batch_id, revision, exported_at, records } = batchData;

  if (!Array.isArray(records)) {
    return {
      valid: false,
      errors: ['Invalid schema: Root object missing "records" array. Expected { batch_id, revision, exported_at, records: [...] }.'],
    };
  }

  const preview = {
    valid: true,
    batch_id: batch_id || 'unspecified-batch',
    revision: revision ?? null,
    exported_at: exported_at || null,
    filename,
    totalInFile: records.length,
    callsInFile: 0,
    meetingsInFile: 0,
    toInsert: 0,
    toUpdate: 0,
    unchanged: 0,
    rejected: 0,
    conflicts: 0,
    transcriptUpdates: [],
    overridesPreserved: 0,
    errors: [],
    warnings: [],
  };

  const seenInBatch = new Set();

  for (const raw of records) {
    const { source_type, source_id, record_ref, payload, transcript_payload } = raw;

    if (!source_type || !source_id) {
      preview.rejected++;
      preview.errors.push(`Record ${record_ref || '?'}: missing source_type or source_id.`);
      continue;
    }

    if (source_type !== 'call' && source_type !== 'meeting') {
      preview.rejected++;
      preview.errors.push(`Record ${record_ref || '?'}: unknown source_type "${source_type}". Expected "call" or "meeting".`);
      continue;
    }

    if (source_type === 'call') preview.callsInFile++;
    if (source_type === 'meeting') preview.meetingsInFile++;

    const key = makeRecordKey(source_type, source_id);

    if (seenInBatch.has(key)) {
      preview.rejected++;
      preview.warnings.push(`Duplicate key ${key} (${record_ref || '?'}) within batch — subsequent occurrence skipped.`);
      continue;
    }
    seenInBatch.add(key);

    const existing = await db.getRecord(key);
    const existingDecision = await db.getDecision(key);

    if (existingDecision) {
      preview.overridesPreserved++;
    }

    const txText = extractTranscriptText(source_type, payload, transcript_payload);
    const txFp   = txText ? fingerprintTranscript(txText) : null;
    const hasTx  = !!txText;

    if (!existing) {
      preview.toInsert++;
    } else {
      const existingRev = existing.import_revision ?? 0;
      const incomingRev = revision ?? 1;

      if (incomingRev < existingRev) {
        preview.unchanged++;
        preview.warnings.push(`Record ${record_ref} (${key}): incoming revision ${incomingRev} is older than stored revision ${existingRev}.`);
      } else if (incomingRev === existingRev) {
        const contentChanged = existing.transcript_fingerprint !== txFp
          || JSON.stringify(existing.payload) !== JSON.stringify(payload);
        if (!contentChanged) {
          preview.unchanged++;
        } else {
          preview.toUpdate++;
        }
      } else {
        preview.toUpdate++;
        const txChanged = existing.transcript_fingerprint !== txFp && txFp !== null;
        if (txChanged || (hasTx && !existing.has_transcript)) {
          preview.transcriptUpdates.push({
            record_ref: record_ref || key,
            source_type,
            reason: `Transcript updated. Previous analysis will be marked stale for review.`,
          });
        }
      }
    }
  }

  return preview;
}

export async function importBatch(batchData) {
  const { batch_id, revision, exported_at, records } = batchData;

  if (!Array.isArray(records)) throw new Error('JSON does not contain a records array.');

  const result = {
    batch_id:    batch_id || 'unknown',
    revision:    revision ?? null,
    exported_at: exported_at || null,
    imported_at: new Date().toISOString(),
    inserted:    0,
    updated:     0,
    unchanged:   0,
    rejected:    0,
    warnings:    [],
    errors:      [],
  };

  const seenInBatch = new Set();   // guard duplicates within one batch

  for (const raw of records) {
    const { source_type, source_id, record_ref, payload, transcript_payload } = raw;

    if (!source_type || !source_id) {
      result.rejected++;
      result.errors.push(`Record ${record_ref || '?'}: missing source_type or source_id.`);
      continue;
    }

    const key = makeRecordKey(source_type, source_id);

    // Duplicate detection within this batch
    if (seenInBatch.has(key)) {
      result.rejected++;
      result.errors.push(`Record ${record_ref}: duplicate identity ${key} within batch — skipped.`);
      continue;
    }
    seenInBatch.add(key);

    const existing = await db.getRecord(key);

    // Build the canonical transcript text for fingerprinting
    const txText  = extractTranscriptText(source_type, payload, transcript_payload);
    const txFp    = txText ? fingerprintTranscript(txText) : null;
    const hasTx   = !!txText;

    // Review/intake state derivation
    const { intakeStatus, reviewStatus } = deriveStatus(source_type, payload, transcript_payload, hasTx);

    if (!existing) {
      // New record
      const rec = buildRecord({ key, source_type, source_id, record_ref, payload, transcript_payload,
        txText, txFp, hasTx, intakeStatus, reviewStatus, revision, exported_at });
      await db.putRecord(rec);

      // Generate analysis
      const analysis = computeAnalysis(rec);
      await db.putAnalysis(analysis);

      await db.addAuditEvent({
        record_key: key,
        field:      'record',
        prev:       null,
        next:       'created',
        source:     'import:' + result.batch_id,
        ts:         result.imported_at,
      });

      result.inserted++;

    } else {
      // Existing record — check revision ordering
      const existingRev = existing.import_revision ?? 0;
      const incomingRev = revision ?? 1;

      if (incomingRev < existingRev) {
        result.unchanged++;
        result.warnings.push(`Record ${record_ref} (${key}): incoming revision ${incomingRev} < stored ${existingRev} — skipped.`);
        continue;
      }

      if (incomingRev === existingRev) {
        // Same revision — check if content differs
        const contentChanged = existing.transcript_fingerprint !== txFp
          || JSON.stringify(existing.payload) !== JSON.stringify(payload);

        if (!contentChanged) {
          result.unchanged++;
          continue;
        }
      }

      // Update needed
      const txChanged = existing.transcript_fingerprint !== txFp && txFp !== null;

      const rec = buildRecord({ key, source_type, source_id, record_ref, payload, transcript_payload,
        txText, txFp, hasTx, intakeStatus, reviewStatus: txChanged ? 'needs-review' : reviewStatus, revision, exported_at });

      await db.putRecord(rec);

      // If transcript changed → mark analysis stale
      if (txChanged || (hasTx && !existing.has_transcript)) {
        const existing_analysis = await db.getAnalysis(key);
        if (existing_analysis) {
          await db.putAnalysis({
            ...existing_analysis,
            stale: true,
            stale_reason: `Transcript updated in batch ${result.batch_id} (revision ${incomingRev}). Review updated transcript and re-verify routing.`,
            updated_at: result.imported_at,
          });
        } else {
          // If no existing analysis, compute fresh
          const freshAnalysis = computeAnalysis(rec);
          await db.putAnalysis(freshAnalysis);
        }
      }

      await db.addAuditEvent({
        record_key: key,
        field:      'record',
        prev:       `revision ${existingRev}`,
        next:       `revision ${incomingRev}`,
        source:     'import:' + result.batch_id,
        ts:         result.imported_at,
        detail:     txChanged ? 'transcript updated' : 'metadata updated',
      });

      result.updated++;
    }
  }

  // Save import history entry
  await db.addImportBatch(result);

  return result;
}

// ── Helpers ──

function buildRecord({ key, source_type, source_id, record_ref, payload, transcript_payload,
    txText, txFp, hasTx, intakeStatus, reviewStatus, revision, exported_at }) {
  return {
    record_key:            key,
    source_type,
    source_id,
    record_ref,
    payload:               payload || {},
    transcript_payload:    transcript_payload || null,
    transcript_text:       txText,
    transcript_fingerprint: txFp,
    has_transcript:        hasTx,
    intake_status:         intakeStatus,
    review_status:         reviewStatus,
    import_revision:       revision ?? 1,
    import_exported_at:    exported_at || null,
    imported_at:           new Date().toISOString(),
  };
}

function extractTranscriptText(source_type, payload, transcript_payload) {
  if (source_type === 'call') {
    const t = payload?.transcript;
    return (typeof t === 'string' && t.trim()) ? t.trim() : null;
  }
  if (source_type === 'meeting') {
    const turns = transcript_payload?.turns;
    if (!Array.isArray(turns) || turns.length === 0) return null;
    return turns.map(t => `[${t.speaker}] ${t.text}`).join('\n');
  }
  return null;
}

function deriveStatus(source_type, payload, transcript_payload, hasTx) {
  let intakeStatus = 'received';
  let reviewStatus = 'pending';

  if (source_type === 'call') {
    const isConversation = payload?.is_conversation === true;
    if (!isConversation) {
      intakeStatus = 'no-conversation';
      reviewStatus = 'no-action-needed';
    } else if (hasTx) {
      intakeStatus  = 'transcript-available';
      reviewStatus  = 'needs-review';
    } else {
      intakeStatus = 'conversation-no-transcript';
      reviewStatus = 'needs-transcript';
    }
  }

  if (source_type === 'meeting') {
    const recStatus = payload?.recording_status;
    const turns     = transcript_payload?.turns;
    const hasTurns  = Array.isArray(turns) && turns.length > 0;
    const unavailableReason = transcript_payload?.unavailable_reason;

    if (recStatus === 'cancelled' || recStatus === 'not_scheduled') {
      intakeStatus = 'no-recording';
      reviewStatus = 'no-action-needed';
    } else if (!hasTurns && unavailableReason && unavailableReason.includes('later')) {
      intakeStatus = 'transcript-pending';
      reviewStatus = 'needs-transcript';
    } else if (!hasTurns && unavailableReason && unavailableReason.includes('nobody spoke')) {
      intakeStatus = 'silent-recording';
      reviewStatus = 'no-action-needed';
    } else if (hasTurns) {
      intakeStatus  = 'transcript-available';
      reviewStatus  = 'needs-review';
    } else {
      intakeStatus = 'transcript-missing';
      reviewStatus = 'needs-transcript';
    }
  }

  return { intakeStatus, reviewStatus };
}
