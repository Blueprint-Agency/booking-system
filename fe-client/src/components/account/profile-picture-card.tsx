"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Portal } from "@/components/ui/portal";
import { BTN_PRIMARY, BTN_SECONDARY, CARD, SHEET_ACTIONS, SHEET_BACKDROP, SHEET_PANEL, SHEET_TEXT, SHEET_TITLE } from "@/components/ui/styles";
import { ApiError, useApi } from "@/lib/api";
import { setAppUserPhoto, useAppUser } from "@/lib/auth";
import { croppedFile, drawCrop, loadImage } from "@/lib/avatar-image";
import { cropPlan, initialCrop, MAX_ZOOM, panCrop, zoomCrop, type Crop, type ImageSize } from "@/lib/square-crop";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { useFocusTrap } from "@/lib/use-focus-trap";

interface Picked {
  image: HTMLImageElement;
  type: string;
}

/** A refusal's own sentence (`{ error, message }`), or `fallback`. */
function refusalSentence(err: unknown, fallback: string): string {
  const message = err instanceof ApiError ? (err.body as { message?: unknown } | null)?.message : undefined;
  return typeof message === "string" ? message : fallback;
}

/**
 * The member's own Profile picture on the profile page: pick a file, crop it
 * to a square, and it is sent at 512×512. Replace and remove sit beside it.
 */
export function ProfilePictureCard() {
  const api = useApi();
  const { user, isLoaded } = useAppUser();
  const inputRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [status, setStatus] = useState<{ tone: "error" | "done"; text: string } | null>(null);

  const photoUrl = user?.photoUrl ?? null;
  const name = user ? `${user.firstName} ${user.lastName}` : "";

  async function pick(file: File | undefined) {
    if (!file) return;
    setStatus(null);
    const image = await loadImage(file);
    if (!image) {
      setStatus({ tone: "error", text: "We couldn't read that picture. Choose a JPG, PNG or WebP." });
      return;
    }
    setPicked({ image, type: file.type });
  }

  async function upload(file: File) {
    setBusy("upload");
    setStatus(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const saved = await api.upload<{ photo_url: string | null }>("/me/photo", form);
      setAppUserPhoto(saved.photo_url);
      setPicked(null);
      setStatus({ tone: "done", text: "Picture saved" });
    } catch (err) {
      setPicked(null);
      setStatus({ tone: "error", text: refusalSentence(err, "Couldn't save your picture. Please try again.") });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("remove");
    setStatus(null);
    try {
      const saved = await api.del<{ photo_url: null }>("/me/photo");
      setAppUserPhoto(saved.photo_url);
      setStatus({ tone: "done", text: "Picture removed" });
    } catch (err) {
      setStatus({ tone: "error", text: refusalSentence(err, "Couldn't remove your picture. Please try again.") });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={`${CARD} p-5 sm:p-6`} aria-labelledby="profile-picture-heading">
      <h2 id="profile-picture-heading" className="text-base font-bold text-ink">Profile picture</h2>
      <p className="mt-1 text-sm text-muted">The studio sees it when you book and check in.</p>
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
        <Avatar
          name={name}
          email={user?.email}
          photoUrl={photoUrl}
          className="h-20 w-20 bg-accent text-inverse text-2xl"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={!isLoaded || busy !== null}
            className={BTN_SECONDARY}
          >
            {photoUrl ? "Replace picture" : "Upload picture"}
          </button>
          {photoUrl && (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy !== null}
              className={BTN_SECONDARY}
            >
              {busy === "remove" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {busy === "remove" ? "Removing…" : "Remove"}
            </button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      </div>
      <p role="status" className="mt-3 text-sm font-medium empty:hidden">
        {status && <span className={status.tone === "error" ? "text-error" : "text-sage"}>{status.text}</span>}
      </p>

      {picked && (
        <CropDialog
          picked={picked}
          saving={busy === "upload"}
          onCancel={() => setPicked(null)}
          onSave={(file) => void upload(file)}
        />
      )}
    </section>
  );
}

const PAN_STEP = 10;

function CropDialog({
  picked,
  saving,
  onCancel,
  onSave,
}: {
  picked: Picked;
  saving: boolean;
  onCancel: () => void;
  onSave: (file: File) => void;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  useBodyScrollLock(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const size: ImageSize = { width: picked.image.naturalWidth, height: picked.image.naturalHeight };
  const [crop, setCrop] = useState<Crop>(() => initialCrop(size));
  const [failed, setFailed] = useState(false);
  const plan = cropPlan(size, crop, picked.type);

  useEffect(() => {
    if (canvasRef.current) drawCrop(canvasRef.current, picked.image, plan);
  });

  function pan(dx: number, dy: number) {
    const viewport = canvasRef.current?.getBoundingClientRect().width || 1;
    setCrop((c) => panCrop(size, c, { dx, dy }, viewport));
  }

  async function save() {
    setFailed(false);
    try {
      onSave(await croppedFile(picked.image, plan));
    } catch {
      setFailed(true);
    }
  }

  return (
    <Portal>
      <div className={SHEET_BACKDROP} onClick={() => !saving && onCancel()}>
        <div
          ref={trapRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="crop-picture-title"
          tabIndex={-1}
          className={SHEET_PANEL}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.key === "Escape" && !saving && onCancel()}
        >
          <h3 id="crop-picture-title" className={SHEET_TITLE}>Crop your picture</h3>
          <p className={SHEET_TEXT}>Drag to move it inside the circle, and zoom to fit.</p>

          <div className="relative mx-auto mt-5 aspect-square w-full max-w-[280px] overflow-hidden rounded-2xl bg-ink/[0.06]">
            <canvas
              ref={canvasRef}
              width={560}
              height={560}
              tabIndex={0}
              aria-label="Picture crop. Use the arrow keys to move it."
              className="h-full w-full cursor-grab touch-none active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-accent"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = { x: e.clientX, y: e.clientY };
              }}
              onPointerMove={(e) => {
                if (!drag.current) return;
                pan(e.clientX - drag.current.x, e.clientY - drag.current.y);
                drag.current = { x: e.clientX, y: e.clientY };
              }}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
              onKeyDown={(e) => {
                const moves: Record<string, [number, number]> = {
                  ArrowLeft: [PAN_STEP, 0],
                  ArrowRight: [-PAN_STEP, 0],
                  ArrowUp: [0, PAN_STEP],
                  ArrowDown: [0, -PAN_STEP],
                };
                const move = moves[e.key];
                if (!move) return;
                e.preventDefault();
                pan(move[0], move[1]);
              }}
            />
            <div
              className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgb(0_0_0/0.45)]"
              aria-hidden
            />
          </div>

          <label className="mt-5 block text-sm font-semibold text-ink" htmlFor="crop-zoom">
            Zoom
          </label>
          <input
            id="crop-zoom"
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={crop.zoom}
            onChange={(e) => setCrop((c) => zoomCrop(size, c, Number(e.target.value)))}
            className="mt-2 w-full accent-accent"
          />

          {failed && (
            <p role="alert" className="mt-3 text-sm font-medium text-error">
              Your browser couldn&apos;t prepare this picture. Try another one.
            </p>
          )}

          <div className={SHEET_ACTIONS}>
            <button type="button" onClick={onCancel} disabled={saving} className={BTN_SECONDARY}>
              Cancel
            </button>
            <button type="button" onClick={() => void save()} disabled={saving} className={BTN_PRIMARY}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {saving ? "Saving…" : "Save picture"}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
