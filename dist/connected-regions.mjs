// Flood-fill neighboring foreground pixels into blobs (connected regions).
// Centers are the average pixel positions, not the centers of the rectangles.
export function connectedRegions(mask, width, height, { minArea = 1, maxArea = Infinity, minLength = 1 } = {}) {
  const stack = new Int32Array(mask.length);
  const blobs = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start]) continue;
    let top = 0;
    stack[top++] = start;
    mask[start] = 0;
    let area = 0, sumX = 0, sumY = 0;
    const pixels = [];
    let minX = width, minY = height, maxX = 0, maxY = 0;
    while (top) {
      const index = stack[--top];
      const x = index % width;
      const y = (index - x) / width;
      area++;
      sumX += x;
      sumY += y;
      pixels.push(index);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      let next = index - width;
      if (y > 0 && mask[next]) { mask[next] = 0; stack[top++] = next; }
      next = index + width;
      if (y < height - 1 && mask[next]) { mask[next] = 0; stack[top++] = next; }
      next = index - 1;
      if (x > 0 && mask[next]) { mask[next] = 0; stack[top++] = next; }
      next = index + 1;
      if (x < width - 1 && mask[next]) { mask[next] = 0; stack[top++] = next; }
    }
    if (area >= minArea && area <= maxArea && Math.max(maxX - minX + 1, maxY - minY + 1) >= minLength) {
      blobs.push({ x: sumX / area, y: sumY / area, width: maxX - minX + 1, height: maxY - minY + 1, area, pixels });
    }
  }
  return blobs;
}
