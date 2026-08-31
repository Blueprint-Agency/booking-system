# booking-cdn

Edge proxy that serves the Cloudflare R2 bucket at `cdn.reservetoday.app`.

## Why this exists

`cdn.reservetoday.app` used to be an R2 **custom domain** — R2 bound directly to the hostname and
Cloudflare's proxy served it. That stopped being possible on 2026-08-31, when `reservetoday.app`
moved to Vercel nameservers to get the wildcard domains multi-tenancy depends on. R2 binds a custom
domain through the Cloudflare proxy, which requires the zone to be on Cloudflare nameservers, so
the binding cannot be recreated. The record was lost in the move and is not restorable in its old
form.

The sibling project `kaiteki` still does it the old way — `kaiteki.my` is on Cloudflare and
`cdn.kaiteki.my` serves from R2 behind the proxy. That works *because* the zone never moved, which
makes it the control case rather than a pattern to copy here.

This project restores the hostname by putting Vercel's edge in front of the bucket instead of
Cloudflare's. The bucket's `pub-<hash>.r2.dev` URL becomes a private origin and is never public.

## How it works

`vercel.json` rewrites every path to the edge function, which fetches the same key from
`R2_ORIGIN` and streams it back with a one-year immutable `Cache-Control`. Assets are addressed by
key and replaced by writing a new key rather than mutating one, so that TTL is safe.

```
GET https://cdn.reservetoday.app/workshops/hatha-intro.jpg
  → /api/asset?key=workshops/hatha-intro.jpg
  → ${R2_ORIGIN}/workshops/hatha-intro.jpg
```

Range requests and conditional validators (`if-none-match`, `if-modified-since`) are forwarded, so
206 and 304 still work. Origin errors return a bare 404 or 502 with `no-store` — the origin's own
body is dropped because it names the `r2.dev` host.

## Vercel setup

One project, Root Directory `cdn/`, with `R2_ORIGIN` set **twice** — once per scope, exactly like
the two frontends:

| Scope | Domain | `R2_ORIGIN` |
|---|---|---|
| Production | `cdn.reservetoday.app` | production bucket's `https://pub-<hash>.r2.dev` |
| Preview | `cdn.staging.reservetoday.app` | staging bucket's `https://pub-<hash>.r2.dev` |

No DNS record is needed: the zone's `*` ALIAS already resolves both names to Vercel, and attaching
the domain to this project is what claims them. Vercel issues the certificates.

The backend's `R2_PUBLIC_URL` then points at the matching hostname per environment, never at
`r2.dev` directly.
