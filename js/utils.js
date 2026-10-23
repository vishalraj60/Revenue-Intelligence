/**
 * utils.js — Shared utility functions
 */

/** Stable logical identity key */
export function makeRecordKey(source_type, source_id) {
  return `${source_type}::${source_id}`;
}

/** Lightweight transcript fingerprint (length + first 60 chars) */
export function fingerprintTranscript(text) {
  if (!text) return null;
  const s = text.trim();
  return `${s.length}:${s.slice(0, 60)}`;
}

/** Format a UTC ISO string to display in Asia/Kolkata */
export function formatIST(isoString, opts = {}) {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    return d.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour12: false,
      year:   'numeric',
      month:  'short',
      day:    '2-digit',
      hour:   '2-digit',
      minute: '2-digit',
      ...opts,
    });
  } catch { return isoString; }
}

/** Format seconds to mm:ss or hh:mm:ss */
export function formatDuration(secs) {
  if (!secs) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Safe filename from a source_id (UUID-style) */
export function safeFilename(str) {
  return str.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 64);
}

/** Extract the display name / person for a record */
export function getPersonName(rec) {
  if (!rec) return '—';
  if (rec.source_type === 'call') {
    return rec.payload?.rep_name || rec.payload?.rep_email || '—';
  }
  if (rec.source_type === 'meeting') {
    return rec.payload?.organizer_email || '—';
  }
  return '—';
}

/** Show toast */
export function toast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

/** Simple HTML escape */
export function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Truncate a string */
export function truncate(str, n = 80) {
  if (!str) return '';
  const s = String(str);
  return s.length <= n ? s : s.slice(0, n) + '…';
}

/** Date only portion from ISO string (YYYY-MM-DD) */
export function dateOnly(iso) {
  if (!iso) return '';
  return iso.slice(0, 10);
}
