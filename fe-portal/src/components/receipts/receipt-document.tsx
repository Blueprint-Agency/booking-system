"use client";

/**
 * A Receipt as the backend draws it: the `html` on a Receipt, the one design
 * the PDF, the email and the member's Receipt page share. Nothing here lays a
 * Receipt out, so an admin sees exactly what the member sees.
 *
 * Shown in a frame that runs no script (`sandbox` without `allow-scripts`),
 * sized to what it holds. `allow-same-origin` only lets this page measure it.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export function ReceiptDocument({ html, title }: { html: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(720);

  // The body, not the document element: the document is never shorter than
  // the frame, so measuring it would let the frame grow but never shrink.
  const fit = useCallback(() => {
    const body = frame.current?.contentDocument?.body;
    if (body) setHeight(body.scrollHeight);
  }, []);

  // The frame is as wide as the page, so a narrower page can make it taller.
  useEffect(() => {
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fit]);

  return (
    <iframe
      ref={frame}
      title={title}
      srcDoc={html}
      sandbox="allow-same-origin"
      onLoad={fit}
      className="block w-full border-0 bg-transparent"
      style={{ height }}
    />
  );
}
