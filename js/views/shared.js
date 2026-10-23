/**
 * views/shared.js — Shared UI helpers used across multiple views
 */

export const ROUTE_COLORS = {
  'Sales Coaching':       'purple',
  'Deal Next Steps':      'blue',
  'Customer Follow-up':   'teal',
  'Partner / Referral':   'green',
  'Internal/Vendor Note': 'navy',
  'Human Review':         'amber',
  'No Action':            'navy',
};

export function routeBadge(destination) {
  const color = ROUTE_COLORS[destination] || 'navy';
  return `<span class="badge badge-${color}">${esc(destination)}</span>`;
}

export function statusBadge(status) {
  const map = {
    'needs-review':        ['purple', 'Needs Review'],
    'no-action-needed':    ['navy',   'No Action'],
    'pending':             ['amber',  'Pending'],
    'needs-transcript':    ['amber',  'Needs Transcript'],
    'no-conversation':     ['navy',   'No Conversation'],
    'transcript-available':['green',  'Transcript Ready'],
    'no-recording':        ['navy',   'No Recording'],
    'silent-recording':    ['navy',   'Silent'],
    'transcript-pending':  ['amber',  'Transcript Pending'],
    'transcript-missing':  ['red',    'Transcript Missing'],
    'conversation-no-transcript': ['amber', 'Conv. / No Tx'],
  };
  const [color, label] = map[status] || ['navy', status || '—'];
  return `<span class="badge badge-${color}">${esc(label)}</span>`;
}

export function intakeBadge(status) {
  const map = {
    'received':              ['navy',   'Received'],
    'no-conversation':       ['navy',   'No Conversation'],
    'transcript-available':  ['green',  'Tx Available'],
    'conversation-no-transcript': ['amber', 'Conv/No Tx'],
    'no-recording':          ['navy',   'No Recording'],
    'transcript-pending':    ['amber',  'Tx Pending'],
    'silent-recording':      ['navy',   'Silent'],
    'transcript-missing':    ['red',    'Tx Missing'],
  };
  const [color, label] = map[status] || ['navy', status || '—'];
  return `<span class="badge badge-${color}">${esc(label)}</span>`;
}

export function confidenceDot(confidence) {
  const colors = { high: '#16a34a', medium: '#d97706', low: '#dc2626' };
  return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${colors[confidence]||'#888'};margin-right:4px;vertical-align:middle"></span>`;
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
