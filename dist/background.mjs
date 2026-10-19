/** Convert browser ImageData to the grayscale pixels used by the detector. */
export function grayscale(imageData) {
  const rgba = imageData.data;
  const gray = new Uint8Array(imageData.width * imageData.height);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    gray[j] = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
  }
  return gray;
}

/** A median across frames removes fish that move around a fixed tank. */
export function medianBackground(samples) {
  if (!samples.length) throw new Error('No video frames were available for the background.');
  const length = samples[0].length;
  if (samples.some(sample => sample.length !== length)) throw new Error('Background samples have different dimensions.');
  const result = new Uint8Array(length);
  const values = new Uint8Array(samples.length);
  const middle = Math.floor(values.length / 2);
  for (let pixel = 0; pixel < length; pixel++) {
    for (let sample = 0; sample < samples.length; sample++) values[sample] = samples[sample][pixel];
    values.sort();
    result[pixel] = values[middle];
  }
  return result;
}

function erode3(mask, width, height) {
  const result = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      if (mask[i] && mask[i - width] && mask[i + width] && mask[i - 1] && mask[i + 1]) result[i] = 1;
    }
  }
  return result;
}

function dilate3(mask, width, height) {
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      result[i] = 1;
      if (y > 0) result[i - width] = 1;
      if (y < height - 1) result[i + width] = 1;
      if (x > 0) result[i - 1] = 1;
      if (x < width - 1) result[i + 1] = 1;
    }
  }
  return result;
}

function splitJoinedBlob(blob, frameWidth, minArea) {
  const pixels = blob.pixels;
  let xx = 0, xy = 0, yy = 0;
  for (const index of pixels) {
    const x = index % frameWidth - blob.x;
    const y = Math.floor(index / frameWidth) - blob.y;
    xx += x * x; xy += x * y; yy += y * y;
  }
  const angle = Math.atan2(2 * xy, xx - yy) / 2;
  const axisX = Math.cos(angle), axisY = Math.sin(angle);
  let low = Infinity, high = -Infinity;
  for (const index of pixels) {
    const projection = (index % frameWidth) * axisX + Math.floor(index / frameWidth) * axisY;
    low = Math.min(low, projection);
    high = Math.max(high, projection);
  }
  const centerProjection = blob.x * axisX + blob.y * axisY;
  const firstOffset = low + (high - low) / 4 - centerProjection;
  const secondOffset = low + 3 * (high - low) / 4 - centerProjection;
  let centers = [
    { x: blob.x + axisX * firstOffset, y: blob.y + axisY * firstOffset },
    { x: blob.x + axisX * secondOffset, y: blob.y + axisY * secondOffset }
  ];
  for (let step = 0; step < 8; step++) {
    const sums = [{ x: 0, y: 0, area: 0 }, { x: 0, y: 0, area: 0 }];
    for (const index of pixels) {
      const x = index % frameWidth, y = Math.floor(index / frameWidth);
      const a = (x - centers[0].x) ** 2 + (y - centers[0].y) ** 2;
      const b = (x - centers[1].x) ** 2 + (y - centers[1].y) ** 2;
      const group = sums[a <= b ? 0 : 1];
      group.x += x; group.y += y; group.area++;
    }
    if (sums.some(group => group.area < minArea)) return null;
    centers = sums.map(group => ({ x: group.x / group.area, y: group.y / group.area, area: group.area }));
  }
  if (Math.hypot(centers[0].x - centers[1].x, centers[0].y - centers[1].y) < 10) return null;
  const groups = [
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, area: 0 },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, area: 0 }
  ];
  for (const index of pixels) {
    const x = index % frameWidth, y = Math.floor(index / frameWidth);
    const a = (x - centers[0].x) ** 2 + (y - centers[0].y) ** 2;
    const b = (x - centers[1].x) ** 2 + (y - centers[1].y) ** 2;
    const group = groups[a <= b ? 0 : 1];
    group.area++;
    group.minX = Math.min(group.minX, x); group.maxX = Math.max(group.maxX, x);
    group.minY = Math.min(group.minY, y); group.maxY = Math.max(group.maxY, y);
  }
  return centers.map((center, index) => ({ ...center, area: groups[index].area,
    width: groups[index].maxX - groups[index].minX + 1,
    height: groups[index].maxY - groups[index].minY + 1, splitFromBlob: true }));
}

/** Connected dark regions in one frame, with centers in crop coordinates. */
export function detectBackgroundFish(frame, background, width, height, options = {}) {
  if (frame.length !== width * height || background.length !== frame.length) throw new Error('Background frame dimensions do not match.');
  const threshold = options.threshold ?? 24;
  const minArea = options.minArea ?? 45;
  const maxArea = options.maxArea ?? 2500;
  const edgeX = options.edgeX ?? Math.round(width * 12 / 420);
  const edgeTop = options.edgeTop ?? options.edgeY ?? Math.round(height * 10 / 290);
  const edgeBottom = options.edgeBottom ?? options.edgeY ?? Math.round(height * 20 / 290);
  let mask = new Uint8Array(frame.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const index = row + x;
      if (background[index] - frame[index] >= threshold) mask[index] = 1;
    }
  }
  // Match the experimental cleanup: opening once, then closing twice.
  mask = dilate3(erode3(mask, width, height), width, height);
  mask = dilate3(dilate3(mask, width, height), width, height);
  mask = erode3(erode3(mask, width, height), width, height);
  for (let y = 0; y < edgeTop; y++) mask.fill(0, y * width, (y + 1) * width);
  for (let y = height - edgeBottom; y < height; y++) mask.fill(0, y * width, (y + 1) * width);
  for (let y = edgeTop; y < height - edgeBottom; y++) {
    mask.fill(0, y * width, y * width + edgeX);
    mask.fill(0, (y + 1) * width - edgeX, (y + 1) * width);
  }
  const stack = new Int32Array(frame.length);
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
      area++; sumX += x; sumY += y; pixels.push(index);
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
    if (area >= minArea && area <= maxArea && Math.max(maxX - minX + 1, maxY - minY + 1) >= 10) {
      blobs.push({ x: sumX / area, y: sumY / area, width: maxX - minX + 1, height: maxY - minY + 1, area, pixels });
    }
  }
  const expectedFish = options.expectedFish;
  if (Number.isInteger(expectedFish) && blobs.length < expectedFish && options.recoverEdges !== false) {
    const relaxed = detectBackgroundFish(frame, background, width, height, {
      ...options, expectedFish: undefined, recoverEdges: false,
      edgeX: Math.min(edgeX, 4), edgeTop: Math.min(edgeTop, 4), edgeBottom: Math.min(edgeBottom, 4)
    });
    const areas = blobs.map(blob => blob.area).sort((a, b) => a - b);
    const typicalArea = areas[Math.floor(areas.length / 2)] ?? minArea;
    const minEdgeArea = Math.max(minArea, typicalArea * 0.35);
    const candidates = relaxed.filter(blob => {
      const nearExcludedEdge = blob.x - blob.width / 2 < edgeX + 2 ||
        blob.x + blob.width / 2 > width - edgeX - 2 ||
        blob.y - blob.height / 2 < edgeTop + 2 ||
        blob.y + blob.height / 2 > height - edgeBottom - 2;
      return nearExcludedEdge && blob.area >= minEdgeArea;
    }).sort((a, b) => b.area - a.area);
    for (const candidate of candidates) {
      if (blobs.length >= expectedFish) break;
      const duplicate = blobs.some(blob => Math.hypot(blob.x - candidate.x, blob.y - candidate.y) < 15);
      if (!duplicate) blobs.push({ ...candidate, edgeRecovered: true });
    }
  }
  if (Number.isInteger(expectedFish) && blobs.length < expectedFish && blobs.length >= 2) {
    while (blobs.length < expectedFish) {
      const areas = blobs.map(blob => blob.area).sort((a, b) => a - b);
      const middle = areas.length / 2;
      const median = areas.length % 2 ? areas[Math.floor(middle)] : (areas[middle - 1] + areas[middle]) / 2;
      const candidate = blobs.filter(blob => blob.pixels && blob.area >= Math.max(400, median * 1.5)).sort((a, b) => b.area - a.area)[0];
      if (!candidate) break;
      const halves = splitJoinedBlob(candidate, width, minArea);
      if (!halves) { candidate.pixels = null; continue; }
      blobs.splice(blobs.indexOf(candidate), 1, ...halves);
    }
  }
  return blobs.map(({ pixels, ...blob }) => blob);
}
