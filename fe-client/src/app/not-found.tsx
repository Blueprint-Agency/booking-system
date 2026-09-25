import Link from "next/link";

/** Default 404 page for unmatched client routes. */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-16">
      <div className="max-w-md text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-muted">404</p>
        <h1 className="mt-3 text-2xl font-extrabold text-ink">Page not found</h1>
        <p className="mt-2 text-sm text-muted">
          The page you&rsquo;re looking for doesn&rsquo;t exist or has moved.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-full bg-accent px-6 text-sm font-semibold text-white transition-colors hover:bg-accent-deep"
        >
          Back home
        </Link>
      </div>
    </div>
  );
}
