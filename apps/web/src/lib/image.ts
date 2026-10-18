/**
 * Client-side image preparation.
 *
 * Two reasons this matters:
 *  1. A 12 MP camera photo is ~4 MB of base64. Downscaling to ~1024px keeps the
 *     request small enough that a local model can start work immediately.
 *  2. It all happens on the device, before anything is sent anywhere — which is what
 *     makes "your photos never leave this device" true rather than aspirational.
 */

export const MAX_EDGE = 1024;

export async function prepareImage(file: File | Blob): Promise<{ dataUrl: string; width: number; height: number }> {
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't read images.");
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, w, h);
  if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();

  const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  return { dataUrl, width: w, height: h };
}

async function loadBitmap(file: File | Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error("That file isn't a readable image."));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Rough size of a base64 data URL, for the "what leaves the device" receipt. */
export function dataUrlBytes(dataUrl: string): number {
  const b64 = dataUrl.split("base64,")[1] ?? "";
  return Math.round((b64.length * 3) / 4);
}
