"use client";

import type { CropPlan } from "@/lib/square-crop";

/** The picked file decoded, or null when the browser cannot read it as a picture. */
export function loadImage(file: Blob): Promise<HTMLImageElement | null> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image.naturalWidth > 0 && image.naturalHeight > 0 ? image : null);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}

/** Draws the plan's square of `image` onto `canvas`, filling it. */
export function drawCrop(canvas: HTMLCanvasElement, image: HTMLImageElement, plan: CropPlan): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.imageSmoothingQuality = "high";
  context.clearRect(0, 0, canvas.width, canvas.height);
  const { x, y, size } = plan.from;
  context.drawImage(image, x, y, size, size, 0, 0, canvas.width, canvas.height);
}

/**
 * The cropped picture as the file to upload. A browser that cannot write WebP
 * writes PNG instead, which the backend takes too; the name follows the type
 * actually written.
 */
export async function croppedFile(image: HTMLImageElement, plan: CropPlan): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = plan.to.width;
  canvas.height = plan.to.height;
  drawCrop(canvas, image, plan);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, plan.type, 0.9));
  if (!blob) throw new Error("The cropped picture could not be written.");
  const extension = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
  return new File([blob], `profile-picture.${extension}`, { type: blob.type });
}
