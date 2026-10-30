/** Copy an analysis export with physical results in cm and cm/s.
 * Singular Inch fields such as pixelsPerInch describe calibration and stay unchanged.
 */
export function centimetersJson(value) {
  if (Array.isArray(value)) return value.map(centimetersJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const name = key.replaceAll('Inches', 'Centimeters').replaceAll('inches', 'centimeters');
    return [name, name !== key && !key.endsWith('N') && Number.isFinite(item)
      ? item * 2.54 : centimetersJson(item)];
  }));
}
