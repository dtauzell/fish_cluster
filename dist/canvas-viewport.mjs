/** Size the canvas itself so pointer coordinates exclude the surrounding letterbox. */
export function createCanvasViewport({ canvas, viewport, controls, dimensions, onChange }) {
  let zoom = 1;
  function resize() {
    const { width, height } = dimensions();
    if (!width || !height || !viewport.clientWidth || !viewport.clientHeight) return false;
    const scale = Math.min(viewport.clientWidth / width, viewport.clientHeight / height) * zoom;
    const nextWidth = `${Math.max(1, Math.floor(width * scale))}px`;
    const nextHeight = `${Math.max(1, Math.floor(height * scale))}px`;
    const changed = canvas.style.width !== nextWidth || canvas.style.height !== nextHeight;
    canvas.style.width = nextWidth;
    canvas.style.height = nextHeight;
    controls.output.textContent = zoom === 1 ? 'Fit' : `${Math.round(zoom * 100)}%`;
    controls.out.disabled = zoom === 1;
    controls.in.disabled = zoom === 4;
    return changed;
  }
  function setZoom(value) {
    const old = canvas.getBoundingClientRect();
    const centerX = (viewport.scrollLeft + viewport.clientWidth / 2) / Math.max(viewport.clientWidth, old.width);
    const centerY = (viewport.scrollTop + viewport.clientHeight / 2) / Math.max(viewport.clientHeight, old.height);
    zoom = Math.max(1, Math.min(4, value));
    resize();
    const next = canvas.getBoundingClientRect();
    viewport.scrollLeft = zoom === 1 ? 0 : centerX * Math.max(viewport.clientWidth, next.width) - viewport.clientWidth / 2;
    viewport.scrollTop = zoom === 1 ? 0 : centerY * Math.max(viewport.clientHeight, next.height) - viewport.clientHeight / 2;
    onChange();
  }
  controls.fit.addEventListener('click', () => setZoom(1));
  controls.in.addEventListener('click', () => setZoom(zoom + .5));
  controls.out.addEventListener('click', () => setZoom(zoom - .5));
  new ResizeObserver(() => { if (resize()) onChange(); }).observe(viewport);
  return { resize, reset: () => setZoom(1) };
}
