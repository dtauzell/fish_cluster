// Read exported CSV cells, preserving quoted commas, newlines, and escaped quotes.
function csvRows(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { cell += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (!quoted && (char === ',' || char === '\r' || char === '\n')) {
      row.push(cell); cell = '';
      if (char !== ',') {
        rows.push(row); row = [];
        if (char === '\r' && text[i + 1] === '\n') i++;
      }
    } else cell += char;
  }
  if (row.length || cell || text.endsWith('"')) { row.push(cell); rows.push(row); }
  return rows;
}

export function renderExportPreview(container, format, text, visibleColumns = null) {
  if (format === 'json') {
    const pre = document.createElement('pre');
    pre.textContent = text;
    container.replaceChildren(pre);
    return;
  }
  const [headers, ...rows] = csvRows(text);
  const shown = headers.filter(name => !visibleColumns || visibleColumns.has(name));
  const table = document.createElement('table');
  const caption = table.createCaption();
  caption.className = 'visually-hidden';
  caption.textContent = `${format === 'frames' ? 'Frames' : format === 'detections' ? 'Detections' : 'Summary'} export data`;
  const header = table.createTHead().insertRow();
  for (const name of shown) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = name;
    header.append(th);
  }
  const body = table.createTBody();
  for (const values of rows) {
    const tr = body.insertRow();
    for (const name of shown) tr.insertCell().textContent = values[headers.indexOf(name)] ?? '';
  }
  container.replaceChildren(table);
}
