import { connectedRegions } from './connected-regions.mjs';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Look for two substantial dark bodies that remain separate at two adjacent
 * contrast cutoffs. Restrict every pixel to the original region: tank grid lines
 * outside it cannot become new bodies. This is evidence, not a reflection label.
 */
export function darkBodySeeds(blob, frame, background, frameWidth, threshold, minArea) {
  if (!frame || !background || !blob.pixels?.length) return null;
  const xs = blob.pixels.map(index => index % frameWidth);
  const ys = blob.pixels.map(index => Math.floor(index / frameWidth));
  const left = Math.min(...xs), top = Math.min(...ys);
  const width = Math.max(...xs) - left + 1, height = Math.max(...ys) - top + 1;
  const minimumCoreArea = Math.max(minArea, Math.ceil(blob.area * 0.08));
  let previous = null;
  for (let cutoff = threshold + 16; cutoff <= Math.min(255, threshold + 56); cutoff += 4) {
    const mask = new Uint8Array(width * height);
    for (const index of blob.pixels) {
      if (background[index] - frame[index] >= cutoff) {
        mask[(Math.floor(index / frameWidth) - top) * width + index % frameWidth - left] = 1;
      }
    }
    const cores = connectedRegions(mask, width, height, { minArea: minimumCoreArea })
      .map(core => ({ x: core.x + left, y: core.y + top }));
    if (cores.length !== 2 || distance(cores[0], cores[1]) < 10) { previous = null; continue; }
    const stable = previous && (
      (distance(cores[0], previous[0]) <= 4 && distance(cores[1], previous[1]) <= 4) ||
      (distance(cores[0], previous[1]) <= 4 && distance(cores[1], previous[0]) <= 4)
    );
    if (stable) return cores;
    previous = cores;
  }
  return null;
}

/**
 * Associate preceding observed centers with their nearest current region, within
 * eight pixels of its foreground. Two centers entering one region support a
 * possible merge. The caller supplies only a recent, complete, non-estimated frame;
 * this helper never propagates its own estimates or fills the known count.
 */
export function previousBodySeeds(blobs, previousDetections, frameWidth) {
  const groups = new Map();
  for (const point of previousDetections ?? []) {
    let nearest = null, nearestDistance = Infinity;
    for (const blob of blobs) {
      if (!blob.pixels) continue;
      for (const index of blob.pixels) {
        const pixelDistance = Math.hypot(index % frameWidth - point.x, Math.floor(index / frameWidth) - point.y);
        if (pixelDistance < nearestDistance) { nearest = blob; nearestDistance = pixelDistance; }
      }
    }
    if (!nearest || nearestDistance > 8) continue;
    if (!groups.has(nearest)) groups.set(nearest, []);
    groups.get(nearest).push({ x: point.x, y: point.y, area: point.area });
  }
  const seeds = new Map();
  for (const [blob, points] of groups) {
    if (points.length !== 2 || distance(points[0], points[1]) < 10) continue;
    // Nearby fish can pass each other's previous positions without merging.
    // Require the current region to retain most of their combined observed area;
    // otherwise proximity alone can split one fish and displace a real candidate.
    const haveAreas = points.every(point => Number.isFinite(point.area) && point.area > 0);
    if (haveAreas && blob.area < .65 * (points[0].area + points[1].area)) continue;
    seeds.set(blob, points.map(({ x, y }) => ({ x, y })));
  }
  return seeds;
}
