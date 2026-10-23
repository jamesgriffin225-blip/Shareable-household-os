"use client";

/**
 * Downscaling happens on the device that took the photo.
 *
 * A phone photo is twelve megapixels; the wall it ends up on is about two.
 * Shrinking here means the upload fits inside a serverless request body, the
 * database holds hundreds of photos rather than dozens, and the slideshow
 * never waits on a four-megabyte download.
 */
export const FULL_EDGE = 1600;
export const THUMB_EDGE = 320;

export interface Prepared {
  full: Blob;
  thumb: Blob;
  width: number;
  height: number;
}

async function render(
  bitmap: ImageBitmap,
  edge: number,
  quality: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser can't resize images");
  context.drawImage(bitmap, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) throw new Error("Could not read that image");
  return { blob, width, height };
}

export async function prepare(file: File): Promise<Prepared> {
  // createImageBitmap applies EXIF orientation, so portrait photos from a
  // phone don't arrive on the wall lying on their side.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const full = await render(bitmap, FULL_EDGE, 0.86);
    const thumb = await render(bitmap, THUMB_EDGE, 0.75);
    return { full: full.blob, thumb: thumb.blob, width: full.width, height: full.height };
  } finally {
    bitmap.close();
  }
}
