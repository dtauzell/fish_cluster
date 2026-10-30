import { csv } from './analysis.mjs';

// CSVs use centimeters regardless of display units; internal calibration stays in inches.
export function centimetersCsv(rows, columns = [...new Set(rows.flatMap(Object.keys))]) {
  const name = key => key.replaceAll('Inches', 'Centimeters').replaceAll('inches', 'centimeters');
  return csv(rows.map(row => Object.fromEntries(columns.map(key => [name(key),
    name(key) !== key && !key.endsWith('N') && Number.isFinite(row[key]) ? row[key] * 2.54 : row[key]
  ]))), columns.map(name));
}
