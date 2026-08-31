# `reservetoday.app` runs on Vercel nameservers

**Status**: accepted (2026-08-31) — recorded *after* execution. Settles the Option A / Option B
question posed by `docs/md/multi-tenancy-plan.md` §Decisions and by issue #57, and supersedes the
Clerk row in `docs/md/deployment.md` §Environments.

Multi-tenancy resolves `{tenant}.reservetoday.app` and `{tenant}.portal.reservetoday.app` through
wildcard domains on Vercel, and Vercel will only issue the wildcard certificate for a zone whose
nameservers it holds. The zone sat in the Blueprint Cloudflare account. Either the nameservers
moved to Vercel (Option A) and wildcards became available, or they stayed at Cloudflare (Option B)
and the super portal made two API calls per tenant to mint a CNAME by hand. Option A is
materially simpler and it is what we chose.

The nameservers moved on 2026-08-31. `reservetoday.app` now answers from `ns1.vercel-dns.com` and
`ns2.vercel-dns.com`. The registrar is GoDaddy.com, LLC, which permits nameserver edits from
within the account, so no domain transfer and no 60-day lock was involved.

## What the move cost

A nameserver move carries nothing across. Vercel created the new zone with five records of its own
— three CAA entries and an ALIAS each for the apex and `*` — and the eighteen records that existed
at Cloudflare were simply gone. Twelve of them did not come back:

| Lost | Count | Consequence |
|---|---|---|
| Clerk custom-domain sets for `reservetoday.app` and `yogasadhana.reservetoday.app` (`accounts`, `clerk`, `clkmail`, `clk._domainkey`, `clk2._domainkey`) | 10 | Both apps run on Clerk's default `*.vercel.app` frontend API hosts and are unaffected. The Clerk dashboard state for instances `yzxn3e3xr293` and `peu4tr0s6xj5` is unverified. |
| `cdn` → `public.r2.dev` (the only proxied record in the zone) | 1 | No runtime effect: the `Production` GitHub Environment has never held any `R2_*` secret, so production builds no asset URLs at all. The record was orphaned infrastructure. |
| `_dmarc` TXT (`p=quarantine`) | 1 | No mail originates from this zone — the backend sends through Gmail SMTP as `askblueprintagency@gmail.com` — so nothing was failing authentication. The zone is now unprotected against spoofing. |

The `api` and `api.staging` A records were also lost, which took the backend offline for both
frontends until they were recreated by hand. That outage is written up in
`docs/md/multi-tenancy-plan.md`; the rule it produced — **inventory first, recreate second, switch
nameservers last** — is the reason this ADR exists.

## The wildcard hides missing records

This is the consequence most likely to bite someone later. At Cloudflare a name with no record
returned NXDOMAIN, which is unmistakable. With `*` ALIAS in place every name in the zone resolves
and returns a plausible Vercel 404 instead:

```
$ curl -o /dev/null -w '%{http_code}' https://definitely-not-a-real-record.reservetoday.app/
404
```

Absence is therefore no longer observable from outside the zone. `api.reservetoday.app` did not
vanish during the outage, it was swallowed by the wildcard and served `DEPLOYMENT_NOT_FOUND`. No
amount of probing can enumerate what is missing, so the Cloudflare export taken on 2026-08-31 —
reconciled in full above — is the only authoritative record of the pre-move zone.

## Standing constraints this creates

**The R2 asset host cannot be rebuilt the way it was.** `cdn.reservetoday.app` was a Cloudflare R2
custom domain, and R2 binds a custom domain through Cloudflare's proxy, which requires the zone to
be on Cloudflare nameservers. The sibling project `kaiteki` still does exactly this — `kaiteki.my`
is on Cloudflare, and `cdn.kaiteki.my` serves from R2 behind the proxy with `cf-cache-status: HIT`
— and it works there *because* that zone never moved. It is the control case, not a template. Any
asset host on `reservetoday.app` must now be fronted by Vercel or by the VPS instead.

**The VPS can never issue a wildcard certificate for this zone.** Traefik's `le-tls` resolver is
TLS-ALPN-01, which cannot do wildcards, and its DNS-01 resolver holds a Cloudflare token scoped to
the Teeko account while this zone belongs to the Blueprint account. Traefik reads that token
process-wide, so a second DNS-01 resolver would silently reuse the wrong one. This is a concrete
reason the frontends stay on Vercel.

**Backend TLS was never at risk and still is not.** `le-tls` proves control of port 443 and needs
only an A record, which is why `api*` were deliberately DNS-only at Cloudflare and why the move
did not threaten the certificate. `letsencrypt.org` is in the zone's CAA set.

## Consequences

- Wildcard domains are available, so creating a tenant stays a database insert with no DNS call.
  This is the property the whole multi-tenancy plan rests on.
- Vercel DNS is now a load-bearing production dependency with no configuration in version control.
  The zone's contents live only in the Vercel dashboard.
- `bpvps2` is `187.127.207.82`. It is recorded here and in the plan document because deploys reach
  it over Tailscale and the address appears nowhere else in this repository — recovering it during
  the outage meant reading another repository's README.
- Restoring `_dmarc` is cheap and worth doing even though no mail originates here, precisely
  because none does: a strict policy on a non-sending domain is free anti-spoofing.
- Whether Clerk's two production instances still expect their custom domains is unresolved, and
  the answer decides whether ten CNAMEs get recreated or formally retired.
