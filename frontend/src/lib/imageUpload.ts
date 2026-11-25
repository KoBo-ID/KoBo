/**
 * Browser-side photo pipeline (spec section 9): decode, downscale to 800 and 1600 px wide (never upscale), encode
 * as WebP (JPEG where the browser cannot), and upload each variant with a presigned PUT. No server-side image
 * processing exists, so this is the only place a photo gets smaller.
 */

export const TARGET_WIDTHS = [800, 1600] as const;
export const MAX_BYTES = 2 * 1024 * 1024;
export const MIN_SOURCE_WIDTH = 100;

/** File picker accept string covering standard and mobile image formats (excluding SVG). */
export const DOCUMENT_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif,image/bmp,image/gif,image/*,.heic,.heif';
export type DocumentImageType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif' | 'image/heic' | 'image/heif' | 'image/bmp';

const DIRECT_IMAGE_TYPES: readonly DocumentImageType[] = [
  'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif', 'image/bmp',
];
const EXT_TO_MIME: Record<string, DocumentImageType> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg',
  png: 'image/png', webp: 'image/webp', avif: 'image/avif',
  heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp',
};
const MAX_DOC_DIM = 2400;

export class UploadError extends Error {}

export interface Variant {
  blob: Blob;
  width: number;
  height: number;
  contentType: 'image/webp' | 'image/jpeg';
}

function isSvgFile(file: Blob): boolean {
  if (file.type === 'image/svg+xml') return true;
  const name = 'name' in file && typeof (file as File).name === 'string' ? (file as File).name : '';
  return /\.svgz?$/i.test(name);
}

function inferImageMime(file: File): DocumentImageType | null {
  const raw = file.type.toLowerCase();
  if (raw === 'image/jpg') return 'image/jpeg';
  if ((DIRECT_IMAGE_TYPES as readonly string[]).includes(raw)) return raw as DocumentImageType;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_MIME[ext] ?? null;
}

async function encode(bitmap: ImageBitmap, width: number, height: number, quality: number, type: 'image/webp' | 'image/jpeg' = 'image/webp'): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
    return canvas.convertToBlob({ type, quality }).catch(() => null);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Prepares any non-SVG raster image for document upload (KTM, owner KTP/land docs).
 * Directly accepted formats within maxBytes upload unchanged; other browser-decodable formats (e.g. GIF, TIFF)
 * or oversized raster images are re-encoded to WebP/JPEG so they fit cleanly.
 */
export async function prepareDocumentImage(file: File, maxBytes: number): Promise<{ blob: Blob; contentType: DocumentImageType }> {
  if (isSvgFile(file)) throw new UploadError('Format SVG tidak didukung. Gunakan foto atau gambar raster (JPG, PNG, WebP, HEIC).');
  const direct = inferImageMime(file);
  if (direct && file.size > 0 && file.size <= maxBytes) return { blob: file, contentType: direct };

  const maxMb = Math.round(maxBytes / 1_000_000);
  if (!direct && file.type && !file.type.startsWith('image/')) {
    throw new UploadError('Format file tidak didukung. Pilih file gambar (JPG, PNG, WebP, HEIC, dll.).');
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    if (direct && file.size > maxBytes) throw new UploadError(`Ukuran foto maksimal ${maxMb} MB.`);
    throw new UploadError('Gambar ini tidak dapat dibaca. Gunakan JPG, PNG, WebP, atau HEIC.');
  }
  try {
    const scale = Math.min(1, MAX_DOC_DIM / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    for (const quality of [0.85, 0.7, 0.55]) {
      let blob = await encode(bitmap, width, height, quality, 'image/webp');
      if (!blob || (blob.type !== 'image/webp' && blob.type !== 'image/jpeg')) {
        blob = await encode(bitmap, width, height, quality, 'image/jpeg');
      }
      if (blob && (blob.type === 'image/webp' || blob.type === 'image/jpeg') && blob.size <= maxBytes) {
        return { blob, contentType: blob.type };
      }
    }
    throw new UploadError(`Ukuran foto masih melebihi ${maxMb} MB setelah dikecilkan. Pilih foto lain.`);
  } finally {
    bitmap.close();
  }
}

/** One variant per distinct target width, smallest first. Throws UploadError (Indonesian) for unusable files. */
export async function resizeVariants(file: Blob): Promise<Variant[]> {
  if (isSvgFile(file)) throw new UploadError('Format SVG tidak didukung. Pilih foto berformat JPG, PNG, WebP, atau format gambar lain.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new UploadError('File ini bukan gambar yang dapat dibaca. Gunakan JPG, PNG, WebP, atau format gambar lain.');
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
