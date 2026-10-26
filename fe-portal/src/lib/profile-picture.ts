/**
 * Framing a picked photo into the square Profile picture the API stores. The
 * browser does all of it: the server checks only the type and the size, so the
 * upload is always the framed square drawn onto a 512x512 JPEG.
 */

export const PICTURE_SIZE = 512;
const PICTURE_TYPE = "image/jpeg";
const PICTURE_QUALITY = 0.9;
export const MAX_ZOOM = 4;

export interface Size {
  width: number;
  height: number;
}

/** How the square sits on the photo: `zoom` 1 is the whole short side; the centre is in photo pixels. */
export interface Framing {
  zoom: number;
  centreX: number;
  centreY: number;
}

/** The part of the photo that becomes the picture, in photo pixels. */
export interface Square {
  x: number;
  y: number;
  side: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function frameCentred(image: Size): Framing {
  return { zoom: 1, centreX: image.width / 2, centreY: image.height / 2 };
}

export function cropSquare(image: Size, framing: Framing): Square {
  const side = Math.min(image.width, image.height) / clamp(framing.zoom, 1, MAX_ZOOM);
  return {
    x: clamp(framing.centreX - side / 2, 0, image.width - side),
    y: clamp(framing.centreY - side / 2, 0, image.height - side),
    side,
  };
}

/** The framing whose square stays inside the photo, so a drag past an edge leaves nothing to undo. */
function settled(image: Size, framing: Framing): Framing {
  const zoom = clamp(framing.zoom, 1, MAX_ZOOM);
  const { x, y, side } = cropSquare(image, { ...framing, zoom });
  return { zoom, centreX: x + side / 2, centreY: y + side / 2 };
}

export function zoomFraming(image: Size, framing: Framing, zoom: number): Framing {
  return settled(image, { ...framing, zoom });
}

/** Dragging the photo by (`dx`, `dy`) screen pixels in a view `viewSide` pixels square. */
export function panFraming(image: Size, framing: Framing, dx: number, dy: number, viewSide: number): Framing {
  const perScreenPixel = cropSquare(image, framing).side / viewSide;
  return settled(image, {
    ...framing,
    centreX: framing.centreX - dx * perScreenPixel,
    centreY: framing.centreY - dy * perScreenPixel,
  });
}

/** Where the whole photo is drawn, in screen pixels, so the square fills a `viewSide` view. */
export function previewBox(image: Size, framing: Framing, viewSide: number) {
  const square = cropSquare(image, framing);
  const scale = viewSide / square.side;
  return {
    left: -square.x * scale,
    top: -square.y * scale,
    width: image.width * scale,
    height: image.height * scale,
  };
}

/** The slice of `HTMLCanvasElement` the picture is drawn with. */
export interface PictureCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): Pick<
    CanvasRenderingContext2D,
    "fillStyle" | "fillRect" | "drawImage" | "imageSmoothingQuality"
  > | null;
  toBlob(done: (blob: Blob | null) => void, type?: string, quality?: unknown): void;
}

export function renderPicture(
  photo: CanvasImageSource,
  image: Size,
  framing: Framing,
  makeCanvas: () => PictureCanvas = () => document.createElement("canvas"),
): Promise<Blob> {
  const canvas = makeCanvas();
  canvas.width = PICTURE_SIZE;
  canvas.height = PICTURE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("This browser can't draw the picture."));
  // A JPEG has no transparency: a transparent PNG would otherwise turn black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PICTURE_SIZE, PICTURE_SIZE);
  ctx.imageSmoothingQuality = "high";
  const { x, y, side } = cropSquare(image, framing);
  ctx.drawImage(photo, x, y, side, side, 0, 0, PICTURE_SIZE, PICTURE_SIZE);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error("This browser can't save the picture."))),
      PICTURE_TYPE,
      PICTURE_QUALITY,
    );
  });
}
