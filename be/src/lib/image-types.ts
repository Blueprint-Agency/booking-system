/**
 * The image types an app draws inline (a merch photo, a Profile picture), each
 * with the extension its object key takes. A Supporting Document keeps a list
 * of its own, because it may also be a PDF.
 */
export const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
