/** Geometry stays in original-video pixels; image decoding uses the bounding box. */
export function insidePolygon(point, vertices) {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[j], b = vertices[i];
    const cross = (point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x);
    if (Math.abs(cross) < 1e-7 && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x) &&
      point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function polygonBox(points) {
  if (points.length !== 4 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    throw new Error('Click four corners in order around the area.');
  }
  let winding = 0;
  for (let i = 0; i < 4; i++) {
    const a = points[i], b = points[(i + 1) % 4], c = points[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1 || (winding && Math.sign(cross) !== winding)) {
      throw new Error('Corners must form a convex area. Click around its edge without crossing lines.');
    }
    winding = Math.sign(cross);
  }
  const x = Math.floor(Math.min(...points.map(p => p.x))), y = Math.floor(Math.min(...points.map(p => p.y)));
  return { x, y, width: Math.ceil(Math.max(...points.map(p => p.x))) - x,
    height: Math.ceil(Math.max(...points.map(p => p.y))) - y,
    polygon: points.map(p => ({ x: p.x, y: p.y })) };
}

export function copyShape(shape) {
  return { ...shape, ...(shape.polygon ? { polygon: shape.polygon.map(p => ({ ...p })) } : {}) };
}

export function shapePath(context, shape, view = { x: 0, y: 0 }) {
  context.beginPath();
  if (shape.polygon) {
    shape.polygon.forEach((p, i) => context[i ? 'lineTo' : 'moveTo'](p.x - view.x, p.y - view.y));
    context.closePath();
  } else context.rect(shape.x - view.x, shape.y - view.y, shape.width, shape.height);
}
