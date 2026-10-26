"use client";
import { useRef, useState } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Avatar, Button, Dialog, DialogFooter, Label } from "@/components/ui";
import { refusalMessage } from "@/lib/refusal-message";
import { useWorkspace } from "@/lib/workspace-context";
import {
  MAX_ZOOM,
  frameCentred,
  panFraming,
  previewBox,
  renderPicture,
  zoomFraming,
  type Framing,
  type Size,
} from "@/lib/profile-picture";

const PHOTO_PATH = "/portal/profile/photo";

interface PickedPhoto {
  image: HTMLImageElement;
  size: Size;
}

/**
 * The signed-in staff member's own Profile picture: pick a photo, frame it as
 * a square, upload it; or remove it. There is no way to point this at anyone
 * else: the route answers for the caller's own staff row only.
 */
export function ProfilePictureField() {
  const { api, currentStaff, setOwnPhoto } = useWorkspace();
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<PickedPhoto | null>(null);
  const [removing, setRemoving] = useState(false);

  if (!currentStaff) return null;
  const photoUrl = currentStaff.photoUrl;

  function pick(file: File | undefined) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      setPicked({ image, size: { width: image.naturalWidth, height: image.naturalHeight } });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      toast.error("That file isn't a picture this browser can open. Try a JPG, PNG or WebP.");
    };
    image.src = url;
  }

  function closeCrop() {
    if (picked) URL.revokeObjectURL(picked.image.src);
    setPicked(null);
  }

  async function remove() {
    if (!api) return;
    setRemoving(true);
    try {
      await api.del<{ photo_url: null }>(PHOTO_PATH);
      setOwnPhoto(null);
      toast.success("Picture removed");
    } catch (err) {
      toast.error(refusalMessage(err, "Couldn't remove the picture"));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Avatar name={currentStaff.name} src={photoUrl} size={80} className="text-lg" />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-xs text-muted">
          Everyone at the studio sees it wherever you appear. JPG, PNG or WebP; you can
          frame it before it uploads.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => input.current?.click()}>
            <Camera className="h-4 w-4" />
            {photoUrl ? "Change picture" : "Upload picture"}
          </Button>
          {photoUrl && (
            <Button type="button" variant="ghost" size="sm" onClick={remove} disabled={removing}>
              {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Remove
            </Button>
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label="Choose a picture"
          onChange={e => {
            pick(e.target.files?.[0]);
            // Cleared so picking the same file again still opens the framing.
            e.target.value = "";
          }}
        />
      </div>
      {picked && (
        <FramePictureDialog
          picked={picked}
          onClose={closeCrop}
          onUploaded={url => {
            setOwnPhoto(url);
            toast.success("Picture updated");
            closeCrop();
          }}
        />
      )}
    </div>
  );
}

const VIEW = 256;
const KEY_STEP = 16;

function FramePictureDialog({
  picked,
  onClose,
  onUploaded,
}: {
  picked: PickedPhoto;
  onClose: () => void;
  onUploaded: (photoUrl: string) => void;
}) {
  const { api } = useWorkspace();
  const [framing, setFraming] = useState<Framing>(() => frameCentred(picked.size));
  const [uploading, setUploading] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const box = previewBox(picked.size, framing, VIEW);

  function pan(dx: number, dy: number) {
    setFraming(f => panFraming(picked.size, f, dx, dy, VIEW));
  }

  async function upload() {
    if (!api) return;
    setUploading(true);
    try {
      const blob = await renderPicture(picked.image, picked.size, framing);
      const form = new FormData();
      form.append("file", new File([blob], "picture.jpg", { type: blob.type }));
      const res = await api.post<{ photo_url: string }>(PHOTO_PATH, form);
      onUploaded(res.photo_url);
    } catch (err) {
      toast.error(refusalMessage(err, "Couldn't upload the picture"));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={o => !o && !uploading && onClose()}
      title="Frame your picture"
      description="Drag to move it, and zoom to fit. The circle is what everyone sees."
    >
      <div className="flex flex-col items-center gap-4">
        <div
          role="img"
          aria-label="Picture framing. Arrow keys move the picture."
          tabIndex={0}
          className="relative cursor-grab touch-none select-none overflow-hidden rounded-lg bg-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing"
          style={{ width: VIEW, height: VIEW }}
          onPointerDown={e => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY };
          }}
          onPointerMove={e => {
            if (!drag.current) return;
            pan(e.clientX - drag.current.x, e.clientY - drag.current.y);
            drag.current = { x: e.clientX, y: e.clientY };
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onKeyDown={e => {
            const step: Record<string, [number, number]> = {
              ArrowLeft: [KEY_STEP, 0],
              ArrowRight: [-KEY_STEP, 0],
              ArrowUp: [0, KEY_STEP],
              ArrowDown: [0, -KEY_STEP],
            };
            const move = step[e.key];
            if (!move) return;
            e.preventDefault();
            pan(...move);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={picked.image.src}
            alt=""
            draggable={false}
            className="pointer-events-none absolute max-w-none"
            style={box}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgb(13_26_62/0.55)]"
          />
        </div>
        <div className="w-full max-w-[256px] space-y-1.5">
          <Label htmlFor="picture-zoom">Zoom</Label>
          <input
            id="picture-zoom"
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={framing.zoom}
            onChange={e => setFraming(f => zoomFraming(picked.size, f, Number(e.target.value)))}
            className="w-full accent-accent"
          />
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={uploading}>
          Cancel
        </Button>
        <Button type="button" onClick={upload} disabled={uploading}>
          {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
          {uploading ? "Uploading…" : "Use picture"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
