import { grayscale } from './background.mjs';

/** Browser decoding and pixel access. Detection never reads the visible preview canvas. */
export function createVideoSource(video) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const grayCanvas = document.createElement('canvas');
  const grayContext = grayCanvas.getContext('2d', { willReadFrequently: true });
  let seekQueue = Promise.resolve();

  function queueSeek(operation) {
    const pending = seekQueue.catch(() => {}).then(operation);
    seekQueue = pending;
    return pending;
  }

  function capture() {
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    context.drawImage(video, 0, 0);
  }

  function readGray(crop) {
    // Read back only the tank crop. Keep a separate buffer so model bitmaps and
    // labeling PNGs can use the full-frame canvas without resizing it each time.
    if (grayCanvas.width !== crop.width || grayCanvas.height !== crop.height) {
      grayCanvas.width = crop.width;
      grayCanvas.height = crop.height;
    }
    grayContext.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    return grayscale(grayContext.getImageData(0, 0, crop.width, crop.height));
  }

  function readBitmap(crop) {
    capture();
    return createImageBitmap(canvas, crop.x, crop.y, crop.width, crop.height);
  }

  function readPng(crop) {
    capture();
    const image = document.createElement('canvas');
    image.width = crop.width; image.height = crop.height;
    image.getContext('2d').drawImage(canvas, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    return new Promise((resolve, reject) => image.toBlob(blob =>
      blob ? resolve(blob) : reject(new Error('Could not save the decoded frame image.')), 'image/png'));
  }

  async function showFirstFrame() {
    // A seek away from exact zero makes Safari decode a frame from a local MOV.
    const firstTime = Math.min(0.01, video.duration / 2);
    if (typeof video.requestVideoFrameCallback !== 'function') {
      await seekTo(firstTime);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return;
    }
    let callbackId, timer;
    const presented = new Promise((resolve, reject) => {
      callbackId = video.requestVideoFrameCallback(() => resolve());
      timer = setTimeout(() => reject(new Error('The video did not present a decoded frame.')), 10000);
    });
    try {
      await Promise.all([seekTo(firstTime), presented]);
    } finally {
      clearTimeout(timer);
      if (typeof video.cancelVideoFrameCallback === 'function') video.cancelVideoFrameCallback(callbackId);
    }
  }

  function performSeek(seconds) {
    return new Promise((resolve, reject) => {
      if (video.readyState >= 2 && Math.abs(video.currentTime - seconds) < .001) { resolve(); return; }
      const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out while seeking the video.')); }, 12000);
      const onSeek = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error('The video could not be decoded at this time.')); };
      function cleanup() {
        clearTimeout(timer);
        video.removeEventListener('seeked', onSeek);
        video.removeEventListener('loadeddata', onSeek);
        video.removeEventListener('error', onError);
      }
      video.addEventListener('seeked', onSeek, { once: true });
      video.addEventListener('error', onError, { once: true });
      if (seconds === 0 && video.currentTime === 0 && video.readyState < 2) video.addEventListener('loadeddata', onSeek, { once: true });
      else video.currentTime = seconds;
    });
  }

  function seekTo(seconds) {
    return queueSeek(() => performSeek(seconds));
  }

  function seekToDrawableFrame(seconds) {
    return queueSeek(async () => {
      await performSeek(seconds);
      // Safari updates drawImage after seeked even when a paused video's frame callback does not fire.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
  }

  return { showFirstFrame, seekTo, seekToDrawableFrame, readGray, readBitmap, readPng };
}
