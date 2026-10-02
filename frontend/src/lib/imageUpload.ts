/**
 * Browser-side photo pipeline (spec section 9): decode, downscale to 800 and 1600 px wide (never upscale), encode
 * as WebP (JPEG where the browser cannot), and upload each variant with a presigned PUT. No server-side image
 * processing exists, so this is the only place a photo gets smaller.
 */

export const TARGET_WIDTHS = [800, 1600] as const;
export const MAX_BYTES = 2 * 1024 * 1024;
export const MIN_SOURCE_WIDTH = 100;

export class UploadError extends Error {}

export interface Variant {
  blob: Blob;
  width: number;
  height: number;
  contentType: 'image/webp' | 'image/jpeg';
}

async function encode(bitmap: ImageBitmap, width: number, height: number, quality: number): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
    return canvas.convertToBlob({ type: 'image/webp', quality }).catch(() => null);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
}

/** One variant per distinct target width, smallest first. Throws UploadError (Indonesian) for unusable files. */
export async function resizeVariants(file: Blob): Promise<Variant[]> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new UploadError('File ini bukan gambar yang dapat dibaca. Gunakan JPG, PNG, atau WebP.');
  }
  try {
    if (bitmap.width < MIN_SOURCE_WIDTH) throw new UploadError('Foto terlalu kecil. Lebar minimal 100 piksel.');
    const widths = [...new Set(TARGET_WIDTHS.map((w) => Math.min(w, bitmap.width)))];
    const variants: Variant[] = [];
    for (const width of widths) {
      const height = Math.max(1, Math.round((bitmap.height * width) / bitmap.width));
      let blob = await encode(bitmap, width, height, 0.8);
      if (blob && blob.size > MAX_BYTES) blob = await encode(bitmap, width, height, 0.6);
      if (!blob || (blob.type !== 'image/webp' && blob.type !== 'image/jpeg')) throw new UploadError('Browser Anda tidak dapat memproses foto ini.');
      if (blob.size > MAX_BYTES) throw new UploadError('Foto masih lebih dari 2 MB setelah dikecilkan. Pilih foto lain.');
      variants.push({ blob, width, height, contentType: blob.type });
    }
    return variants;
  } finally {
    bitmap.close();
  }
}

/** PUT the bytes to the presigned URL. The headers (Content-Type) are part of the signature. */
export async function putToStorage(url: string, headers: Record<string, string>, blob: Blob): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'PUT', headers, body: blob });
  } catch {
    throw new UploadError('Gagal mengunggah foto. Periksa koneksi Anda lalu coba lagi.');
  }
  if (!res.ok) throw new UploadError('Penyimpanan foto menolak unggahan. Coba lagi beberapa saat.');
}
