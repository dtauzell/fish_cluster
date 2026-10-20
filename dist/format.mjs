// Shared presentation helpers.
export function fmt(value, digits = 1) { return Number.isFinite(value) ? value.toFixed(digits) : '—'; }
export function timeLabel(ms) { return `${(ms / 1000).toFixed(2)} s`; }
