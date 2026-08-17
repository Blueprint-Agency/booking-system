import Link from "next/link";

/** Default 404 page for unmatched portal routes. */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-16">
      <div className="max-w-md text-center">
        <p className="text-xs uppercase tracking-widest text-muted">404</p>
        <h1 className="mt-3 text-2xl font-bold text-ink">Page not found</h1>
        <p className="mt-2 text-sm text-muted">
          The page you&rsquo;re looking for doesn&rsquo;t exist or has moved.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-accent px-5 text-sm font-medium text-white transition-colors hover:bg-accent-deep"
        >
          Back home
        </Link>
      </div>
    </div>
  );
}
