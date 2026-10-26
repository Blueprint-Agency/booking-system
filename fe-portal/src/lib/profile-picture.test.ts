import test from "node:test";
import assert from "node:assert";
import {
  cropSquare,
  frameCentred,
  panFraming,
  previewBox,
  renderPicture,
  zoomFraming,
  type PictureCanvas,
} from "./profile-picture";

const landscape = { width: 1000, height: 600 };
const portrait = { width: 400, height: 900 };

test("STF-52 a photo of any shape is framed as the largest square at its centre", () => {
  assert.deepStrictEqual(cropSquare(landscape, frameCentred(landscape)), { x: 200, y: 0, side: 600 });
  assert.deepStrictEqual(cropSquare(portrait, frameCentred(portrait)), { x: 0, y: 250, side: 400 });
});

test("STF-52 zooming in narrows the square around the same centre", () => {
  const zoomed = zoomFraming(landscape, frameCentred(landscape), 2);
  assert.deepStrictEqual(cropSquare(landscape, zoomed), { x: 350, y: 150, side: 300 });
});

test("STF-52 zoom stays between the whole short side and four times closer", () => {
  const start = frameCentred(landscape);
  assert.strictEqual(cropSquare(landscape, zoomFraming(landscape, start, 0.5)).side, 600);
  assert.strictEqual(cropSquare(landscape, zoomFraming(landscape, start, 10)).side, 150);
});

test("STF-52 dragging the photo moves the square the other way, never past the photo's edge", () => {
  const zoomed = zoomFraming(landscape, frameCentred(landscape), 2);
  // A 300px square shown in a 150px view: dragging 50px right moves it 100px left.
  assert.deepStrictEqual(cropSquare(landscape, panFraming(landscape, zoomed, 50, 0, 150)), {
    x: 250,
    y: 150,
    side: 300,
  });
  assert.deepStrictEqual(cropSquare(landscape, panFraming(landscape, zoomed, 5000, -5000, 150)), {
    x: 0,
    y: 300,
    side: 300,
  });
});

test("STF-52 a square dragged against an edge moves back off it at once", () => {
  const start = frameCentred(landscape);
  const pinned = panFraming(landscape, start, 5000, 0, 300);
  assert.deepStrictEqual(cropSquare(landscape, panFraming(landscape, pinned, -50, 0, 300)), {
    x: 100,
    y: 0,
    side: 600,
  });
});

test("STF-52 the preview places the photo so the square fills the view", () => {
  const zoomed = zoomFraming(landscape, frameCentred(landscape), 2);
  assert.deepStrictEqual(previewBox(landscape, zoomed, 150), {
    left: -175,
    top: -75,
    width: 500,
    height: 300,
  });
});

test("STF-52 the upload is the framed square drawn onto a 512x512 JPEG", async () => {
  const drawn: unknown[][] = [];
  let encoded: { type?: string; quality?: unknown } = {};
  const canvas: PictureCanvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      fillStyle: "",
      imageSmoothingQuality: "low",
      fillRect: () => {},
      drawImage: (...args: unknown[]) => {
        drawn.push(args);
      },
    }),
    toBlob: (done, type, quality) => {
      encoded = { type, quality };
      done(new Blob(["x"], { type }));
    },
  };
  const photo = {} as CanvasImageSource;

  const blob = await renderPicture(photo, landscape, frameCentred(landscape), () => canvas);

  assert.strictEqual(canvas.width, 512);
  assert.strictEqual(canvas.height, 512);
  assert.deepStrictEqual(drawn, [[photo, 200, 0, 600, 600, 0, 0, 512, 512]]);
  assert.strictEqual(encoded.type, "image/jpeg");
  assert.ok(["image/jpeg", "image/png", "image/webp"].includes(blob.type));
});
