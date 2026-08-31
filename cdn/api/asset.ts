export const config = { runtime: 'edge' }

/**
 * Asset edge proxy for `cdn.reservetoday.app`.
 *
 * The R2 bucket used to be reachable as a Cloudflare custom domain, which is no
 * longer possible: R2 binds a custom domain through the Cloudflare proxy, and
 * that needs the zone on Cloudflare nameservers. `reservetoday.app` moved to
 * Vercel on 2026-08-31 to get wildcard domains, so the bucket is fronted here
 * instead. See `docs/adr/0001-reservetoday-app-on-vercel-nameservers.md`.
 *
 * `R2_ORIGIN` is the bucket's `https://pub-<hash>.r2.dev` URL and is never
 * exposed to callers — it is the private origin behind this cache. It is set
 * per Vercel environment so Production and Preview can address different
 * buckets from one codebase.
 */
const ORIGIN = process.env.R2_ORIGIN

// Assets are content-addressed by key: an object is replaced by writing a new
// key, never by mutating one, so a long immutable TTL is safe.
const CACHE_CONTROL = 'public, max-age=31536000, immutable'

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
  }

  if (!ORIGIN) {
    // Matches how the backend degrades when R2_PUBLIC_URL is unset: the asset
    // is unavailable, but nothing 500s.
    return new Response('Asset origin not configured', { status: 503 })
  }

  const key = new URL(req.url).searchParams.get('key')
  if (!key) return new Response('Not Found', { status: 404 })

  // The key lands in a URL path, so anything that could climb out of the
  // bucket prefix or re-target the origin is refused rather than normalised —
  // there is no legitimate key containing these.
  if (key.startsWith('/') || key.includes('..') || key.includes('//')) {
    return new Response('Bad Request', { status: 400 })
  }

  const upstream = await fetch(`${ORIGIN.replace(/\/$/, '')}/${key}`, {
    method: req.method,
    // Forward validators so a repeat view can still 304 against the origin.
    headers: pick(req.headers, ['if-none-match', 'if-modified-since', 'range']),
    redirect: 'follow',
  })

  if (!upstream.ok && upstream.status !== 304 && upstream.status !== 206) {
    // Don't cache a miss as if it were an asset, and don't leak the origin's
    // body — which names the r2.dev host in some error responses.
    return new Response(upstream.status === 404 ? 'Not Found' : 'Bad Gateway', {
      status: upstream.status === 404 ? 404 : 502,
      headers: { 'cache-control': 'no-store' },
    })
  }

  const headers = pick(upstream.headers, [
    'content-type',
    'content-length',
    'content-range',
    'etag',
    'last-modified',
    'accept-ranges',
  ])
  headers.set('cache-control', CACHE_CONTROL)

  return new Response(req.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    headers,
  })
}

function pick(source: Headers, names: string[]): Headers {
  const out = new Headers()
  for (const name of names) {
    const value = source.get(name)
    if (value) out.set(name, value)
  }
  return out
}
