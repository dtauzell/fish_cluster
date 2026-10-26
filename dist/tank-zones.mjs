import { shapePath } from './geometry.mjs';
import { insideCrop, insideAnalysisArea } from './region.mjs';

/** Last drawn area wins at overlaps; uncovered pixels remain unmarked. */
export function tankSide(point, zones = []) {
  for (let i = zones.length - 1; i >= 0; i--) {
    if (insideCrop(point, zones[i])) return zones[i].side;
  }
  return 'unmarked';
}

/** Single-fish light/dark experiments treat the remaining usable tank as light. */
export function usesSingleFishSides(config) {
  return config?.testType !== 'shoaling' && config?.expectedFish === 1 && Boolean(config.tankZones?.some(zone => zone.side === 'dark'));
}

export function analysisTankSide(point, config) {
  const side = tankSide(point, config.tankZones);
  if (!usesSingleFishSides(config)) return side;
  if (!insideAnalysisArea(point, config.crop, config.exclusions)) return 'unmarked';
  return side === 'dark' ? 'dark' : 'light';
}

/** Build once per run, in crop pixels, so foreground detection stays inexpensive. */
export function darkZoneMask(crop, zones = []) {
  const mask = new Uint8Array(crop.width * crop.height);
  for (const zone of zones) {
    const left = Math.max(0, Math.ceil(zone.x - crop.x));
    const right = Math.min(crop.width, Math.floor(zone.x + zone.width - crop.x) + 1);
    const top = Math.max(0, Math.ceil(zone.y - crop.y));
    const bottom = Math.min(crop.height, Math.floor(zone.y + zone.height - crop.y) + 1);
    if (left >= right || top >= bottom) continue;
    for (let y = top; y < bottom; y++) {
      if (!zone.polygon) mask.fill(zone.side === 'dark' ? 1 : 0, y * crop.width + left, y * crop.width + right);
      else for (let x = left; x < right; x++) if (insideCrop({ x: crop.x + x, y: crop.y + y }, zone)) mask[y * crop.width + x] = zone.side === 'dark' ? 1 : 0;
    }
  }
  return mask;
}

export function drawTankZones(context, zones = [], view = { x: 0, y: 0 }, scale = 1) {
  if (!zones.length) return;
  context.save();
  context.lineWidth = 2 * scale;
  context.font = `${12 * scale}px sans-serif`;
  for (const zone of zones) {
    context.strokeStyle = zone.side === 'dark' ? '#bdadff' : '#69e3e9';
    context.fillStyle = zone.side === 'dark' ? 'rgba(155, 125, 255, 0.10)' : 'rgba(70, 220, 230, 0.10)';
    shapePath(context, zone, view);
    context.fill();
    context.stroke();
    context.fillStyle = context.strokeStyle;
    const label = zone.polygon?.[0] ?? zone;
    context.fillText(zone.side === 'dark' ? 'Dark' : 'Light', label.x - view.x + 5 * scale, label.y - view.y + 16 * scale);
  }
  context.restore();
}
