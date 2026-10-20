/** Rectangles and points use original-video pixels unless explicitly translated. */
export function insideCrop(point, crop) {
  return point.x >= crop.x && point.x <= crop.x + crop.width &&
    point.y >= crop.y && point.y <= crop.y + crop.height;
}

export function insideAnalysisArea(point, crop, exclusions = []) {
  return insideCrop(point, crop) && !exclusions.some(box => insideCrop(point, box));
}

export function localExclusions(crop, exclusions = []) {
  return exclusions.map(box => ({ ...box, x: box.x - crop.x, y: box.y - crop.y }));
}

/** Remove excluded pixels before cleanup, and again before finding connected regions. */
export function maskExcludedPixels(mask, width, height, exclusions = []) {
  for (const box of exclusions) {
    const left = Math.max(0, Math.ceil(box.x));
    const right = Math.min(width, Math.floor(box.x + box.width) + 1);
    const top = Math.max(0, Math.ceil(box.y));
    const bottom = Math.min(height, Math.floor(box.y + box.height) + 1);
    if (left >= right || top >= bottom) continue;
    for (let y = top; y < bottom; y++) mask.fill(0, y * width + left, y * width + right);
  }
}

/**
 * Split the usable area into disjoint rectangles. Overlapping masks count once.
 * Random reference points can then be sampled uniformly without retry loops,
 * even when almost the entire crop is masked out.
 */
export function usableRectangles(crop, exclusions = []) {
  const clipped = exclusions.map(box => ({
    left: Math.max(crop.x, box.x), right: Math.min(crop.x + crop.width, box.x + box.width),
    top: Math.max(crop.y, box.y), bottom: Math.min(crop.y + crop.height, box.y + box.height)
  })).filter(box => box.left < box.right && box.top < box.bottom);
  const edges = [...new Set([crop.x, crop.x + crop.width, ...clipped.flatMap(box => [box.left, box.right])])].sort((a, b) => a - b);
  const rectangles = [];
  for (let i = 1; i < edges.length; i++) {
    const left = edges[i - 1], right = edges[i];
    const blocked = clipped.filter(box => box.left < right && box.right > left).sort((a, b) => a.top - b.top);
    let y = crop.y;
    for (const box of blocked) {
      if (box.top > y) rectangles.push({ x: left, y, width: right - left, height: box.top - y });
      y = Math.max(y, box.bottom);
    }
    if (y < crop.y + crop.height) rectangles.push({ x: left, y, width: right - left, height: crop.y + crop.height - y });
  }
  return rectangles;
}
