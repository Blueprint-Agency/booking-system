import test from "node:test";
import assert from "node:assert/strict";
import { cropPlan, initialCrop, panCrop, zoomCrop, MAX_ZOOM } from "./square-crop.ts";

const landscape = { width: 1000, height: 600 };

test("ACC-59 a picture of any shape is cropped to a square sent at 512×512", () => {
  for (const image of [landscape, { width: 600, height: 1000 }, { width: 200, height: 300 }]) {
    const plan = cropPlan(image, initialCrop(image), "image/jpeg");
    assert.equal(plan.from.size, Math.min(image.width, image.height));
    assert.deepEqual(plan.to, { width: 512, height: 512 });
  }
});

test("ACC-59 the crop starts as the largest square in the middle of the picture", () => {
  assert.deepEqual(cropPlan(landscape, initialCrop(landscape), "image/jpeg").from, { x: 200, y: 0, size: 600 });
});

test("ACC-59 the file sent is a JPG, PNG or WebP whatever the member picked", () => {
  const typeFor = (picked: string) => cropPlan(landscape, initialCrop(landscape), picked).type;
  assert.equal(typeFor("image/png"), "image/png");
  assert.equal(typeFor("image/webp"), "image/webp");
  assert.equal(typeFor("image/jpeg"), "image/jpeg");
  assert.equal(typeFor("image/gif"), "image/jpeg");
  assert.equal(typeFor("image/heic"), "image/jpeg");
  assert.equal(typeFor(""), "image/jpeg");
});

test("ACC-59 dragging the picture moves the square the other way, in the picture's own pixels", () => {
  const dragged = panCrop(landscape, initialCrop(landscape), { dx: 30, dy: 0 }, 300);
  assert.deepEqual(cropPlan(landscape, dragged, "image/jpeg").from, { x: 140, y: 0, size: 600 });
});

test("ACC-59 the square never leaves the picture, however far it is dragged", () => {
  const farLeft = panCrop(landscape, initialCrop(landscape), { dx: 5000, dy: 5000 }, 300);
  assert.deepEqual(cropPlan(landscape, farLeft, "image/jpeg").from, { x: 0, y: 0, size: 600 });
  const farRight = panCrop(landscape, initialCrop(landscape), { dx: -5000, dy: -5000 }, 300);
  assert.deepEqual(cropPlan(landscape, farRight, "image/jpeg").from, { x: 400, y: 0, size: 600 });
});

test("ACC-59 zooming in shrinks the square about its centre", () => {
  const zoomed = zoomCrop(landscape, initialCrop(landscape), 2);
  assert.deepEqual(cropPlan(landscape, zoomed, "image/jpeg").from, { x: 350, y: 150, size: 300 });
});

test("ACC-59 zooming out at an edge pulls the square back inside the picture", () => {
  const corner = panCrop(landscape, zoomCrop(landscape, initialCrop(landscape), 2), { dx: 5000, dy: 5000 }, 300);
  assert.deepEqual(cropPlan(landscape, corner, "image/jpeg").from, { x: 0, y: 0, size: 300 });
  assert.deepEqual(cropPlan(landscape, zoomCrop(landscape, corner, 1), "image/jpeg").from, { x: 0, y: 0, size: 600 });
});

test("ACC-59 zoom stays between the whole short side and the closest zoom", () => {
  assert.equal(cropPlan(landscape, zoomCrop(landscape, initialCrop(landscape), 0.2), "image/jpeg").from.size, 600);
  assert.equal(cropPlan(landscape, zoomCrop(landscape, initialCrop(landscape), 99), "image/jpeg").from.size, 600 / MAX_ZOOM);
});
