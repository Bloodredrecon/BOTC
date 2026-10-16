/** Client-side resize to a square JPEG before upload (keeps payloads small; server still size-caps). */

const MAX_EDGE = 256;
const JPEG_QUALITY = 0.85;

export function playerPhotoUrl(playerId: string, photoRev: number | null | undefined): string | null {
  if (!photoRev) return null;
  return `/api/player-photos/${encodeURIComponent(playerId)}?v=${photoRev}`;
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that photo."));
    };
    img.src = url;
  });
}

/** Centre-crop to square, shrink to MAX_EDGE, return JPEG data URL (base64). */
export async function resizeToJpegDataUrl(file: Blob): Promise<string> {
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
  if (!side) throw new Error("Could not read that photo.");
  const sx = ((img.naturalWidth || img.width) - side) / 2;
  const sy = ((img.naturalHeight || img.height) - side) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = MAX_EDGE;
  canvas.height = MAX_EDGE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare that photo.");
  ctx.drawImage(img, sx, sy, side, side, 0, 0, MAX_EDGE, MAX_EDGE);
  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  if (!dataUrl.startsWith("data:image/jpeg")) throw new Error("Could not make a JPEG from that photo.");
  return dataUrl;
}
