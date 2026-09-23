"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Loader2, ScanLine } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * A camera that stays armed at the door and hands every QR it reads to
 * `onToken`. It does not decide what a QR means or whether it was just seen —
 * the desk does (`createScanGate` in lib/check-in.ts).
 *
 * Decoding: the browser's own `BarcodeDetector` where it has one (Chrome on
 * Android, most desktop Chromium), else `jsqr` on a downscaled frame — loaded
 * only then, so a browser that can read QR codes itself never downloads it.
 *
 * The camera is asked for only when someone presses "Start camera"; after
 * that, this browser remembers and re-opens it on the next visit.
 */

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (opts: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

type Decoder = (video: HTMLVideoElement) => Promise<string | null>;

/** How often a frame is read. Fast enough to feel instant, slow enough to spare a tablet's battery. */
const SCAN_INTERVAL_MS = 200;
/** jsqr's cost grows with pixels; a QR held at the door is large in frame, so 640px wide is plenty. */
const FALLBACK_MAX_WIDTH = 640;
/** Per browser, not per studio: whether this device last left its camera on. */
const STORAGE_KEY_CAMERA = "rt.checkInCamera";

async function nativeDecoder(): Promise<Decoder | null> {
  const Ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    const formats = (await Ctor.getSupportedFormats?.()) ?? ["qr_code"];
    if (!formats.includes("qr_code")) return null;
    const detector = new Ctor({ formats: ["qr_code"] });
    return async (video) => {
      const found = await detector.detect(video);
      return found[0]?.rawValue ?? null;
    };
  } catch {
    return null;
  }
}

async function fallbackDecoder(): Promise<Decoder> {
  const mod = await import("jsqr");
  const jsQR = (mod.default ?? mod) as typeof mod.default;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return async (video) => {
    if (!ctx || !video.videoWidth) return null;
    const scale = Math.min(1, FALLBACK_MAX_WIDTH / video.videoWidth);
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    const frame = ctx.getImageData(0, 0, w, h);
    return jsQR(frame.data, w, h, { inversionAttempts: "dontInvert" })?.data ?? null;
  };
}

type CameraState =
  | { kind: "off" }
  | { kind: "starting" }
  | { kind: "on" }
  | { kind: "failed"; message: string };

function cameraFailure(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access was refused. Allow the camera for this site in the browser's settings, or type the booking code below.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No camera was found on this device. Type the booking code below instead.";
  }
  if (name === "NotReadableError") {
    return "The camera is in use by another app. Close it and try again.";
  }
  return "The camera couldn't be started. Type the booking code below instead.";
}

function readRemembered(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY_CAMERA) === "on";
  } catch {
    return false;
  }
}

function remember(on: boolean) {
  try {
    if (on) window.localStorage.setItem(STORAGE_KEY_CAMERA, "on");
    else window.localStorage.removeItem(STORAGE_KEY_CAMERA);
  } catch {
    // Private mode or blocked storage: the camera just won't auto-start next time.
  }
}

export function QrScanner({ onToken }: { onToken: (token: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const onTokenRef = useRef(onToken);
  const [state, setState] = useState<CameraState>({ kind: "off" });

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  const halt = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState({
        kind: "failed",
        message:
          "This browser can't open the camera here (it needs a secure https page). Type the booking code below instead.",
      });
      return;
    }
    halt();
    setState({ kind: "starting" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        halt();
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      const decode = (await nativeDecoder()) ?? (await fallbackDecoder());

      // The camera can be taken away (another app, the OS): say so rather than freeze.
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        halt();
        setState({ kind: "failed", message: "The camera stopped. Start it again to keep scanning." });
      });

      const tick = async () => {
        if (streamRef.current !== stream) return;
        try {
          if (video.readyState >= 2) {
            const token = await decode(video);
            if (token) onTokenRef.current(token.trim());
          }
        } catch {
          // A frame that fails to decode is just a frame without a QR in it.
        }
        if (streamRef.current === stream) {
          timerRef.current = window.setTimeout(tick, SCAN_INTERVAL_MS);
        }
      };
      timerRef.current = window.setTimeout(tick, SCAN_INTERVAL_MS);
      remember(true);
      setState({ kind: "on" });
    } catch (err) {
      halt();
      remember(false);
      setState({ kind: "failed", message: cameraFailure(err) });
    }
  }, [halt]);

  const stop = useCallback(() => {
    halt();
    remember(false);
    setState({ kind: "off" });
  }, [halt]);

  // Re-open the camera if this device left it on last time — the desk
  // shouldn't have to press Start every morning.
  useEffect(() => {
    let cancelled = false;
    if (readRemembered()) {
      queueMicrotask(() => {
        if (!cancelled) void start();
      });
    }
    return () => {
      cancelled = true;
      halt();
    };
  }, [start, halt]);

  const on = state.kind === "on";

  return (
    <div>
      <div
        className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-paper text-muted"
        aria-live="polite"
      >
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label="Camera view for scanning booking QR codes"
          className={`absolute inset-0 h-full w-full object-cover ${on ? "" : "invisible"}`}
        />
        {on ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-[18%] rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]"
          />
        ) : (
          <div className="relative px-4 text-center text-sm">
            {state.kind === "starting" ? (
              <>
                <Loader2 className="mx-auto mb-2 h-8 w-8 animate-spin" />
                Opening the camera…
              </>
            ) : (
              <>
                <ScanLine className="mx-auto mb-2 h-10 w-10" />
                {state.kind === "failed" ? (
                  <span className="text-error">{state.message}</span>
                ) : (
                  "Start the camera, then hold a member's QR code in the frame."
                )}
              </>
            )}
          </div>
        )}
      </div>
      {on ? (
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="mt-3 w-full"
          onClick={stop}
          data-testid="check-in-camera-stop"
        >
          <CameraOff className="h-5 w-5" /> Stop camera
        </Button>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="mt-3 w-full"
          onClick={() => void start()}
          disabled={state.kind === "starting"}
          data-testid="check-in-camera-start"
        >
          <Camera className="h-5 w-5" /> {state.kind === "failed" ? "Try the camera again" : "Start camera"}
        </Button>
      )}
      {on && (
        <p className="mt-2 text-center text-xs text-muted">
          Scanning — the camera stays on between members.
        </p>
      )}
    </div>
  );
}
