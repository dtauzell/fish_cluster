// Browser-only file saving; CSV/JSON content is prepared by exports.mjs.
export function download(name, content, mime) {
  const file = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
