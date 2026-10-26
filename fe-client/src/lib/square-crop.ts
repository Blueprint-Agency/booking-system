/**
 * The square a member crops their Profile picture to, and what it is sent as.
 * The backend keeps what it is given, so the browser does the cropping and the
 * shrinking: `avatar-image.ts` draws `cropPlan` onto a canvas.
 *
 * The crop lives in the picture's own pixels: `zoom` 1 is the largest square
 * the picture holds, and the centre is where that square sits. Every step
 * clamps the centre, so the square never leaves the picture.
 */
export interface ImageSize {
  width: number;
  height: number;
}

export interface Crop {
  zoom: number;
  centerX: number;
  centerY: number;
}

export type AvatarType = "image/jpeg" | "image/png" | "image/webp";

export interface CropPlan {
  from: { x: number; y: number; size: number };
  to: { width: number; height: number };
  type: AvatarType;
}

export const AVATAR_SIZE = 512;
export const MAX_ZOOM = 4;

function side(image: ImageSize, zoom: number): number {
  return Math.min(image.width, image.height) / zoom;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

function placed(image: ImageSize, crop: Crop): Crop {
  const zoom = clamp(crop.zoom, 1, MAX_ZOOM);
  const half = side(image, zoom) / 2;
  return {
    zoom,
    centerX: clamp(crop.centerX, half, image.width - half),
    centerY: clamp(crop.centerY, half, image.height - half),
  };
}

export function initialCrop(image: ImageSize): Crop {
  return { zoom: 1, centerX: image.width / 2, centerY: image.height / 2 };
}

/** The picture dragged by `dx`, `dy` screen pixels in a crop box `viewport` pixels wide. */
export function panCrop(image: ImageSize, crop: Crop, drag: { dx: number; dy: number }, viewport: number): Crop {
  const scale = side(image, crop.zoom) / viewport;
  return placed(image, { ...crop, centerX: crop.centerX - drag.dx * scale, centerY: crop.centerY - drag.dy * scale });
}

export function zoomCrop(image: ImageSize, crop: Crop, zoom: number): Crop {
  return placed(image, { ...crop, zoom });
}

/** PNG and WebP keep their type, so a transparent background stays transparent; anything else becomes a JPG. */
function avatarType(picked: string): AvatarType {
  return picked === "image/png" || picked === "image/webp" ? picked : "image/jpeg";
}

export function cropPlan(image: ImageSize, crop: Crop, pickedType: string): CropPlan {
  const { zoom, centerX, centerY } = placed(image, crop);
  const size = side(image, zoom);
  return {
    from: { x: centerX - size / 2, y: centerY - size / 2, size },
    to: { width: AVATAR_SIZE, height: AVATAR_SIZE },
    type: avatarType(pickedType),
  };
}
