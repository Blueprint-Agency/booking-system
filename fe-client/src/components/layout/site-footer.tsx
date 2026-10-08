"use client";

import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { useBrand } from "@/components/brand/brand-provider";
import { publicApi } from "@/lib/api";
import { useLocations } from "@/lib/classes";
import { useCachedResource } from "@/lib/resource-cache";
import { footerLinks, type FooterLink } from "@/lib/site-footer";
import { ROOT_DOMAIN, tenantSlugFromHost } from "@/lib/tenant-host";

/** `GET /public/marketing`: the studio's own public-site copy. */
interface PublicMarketing {
  footer_text: string | null;
}

const getMarketing = () => publicApi.get<PublicMarketing>("/public/marketing");

/**
 * The foot of every member page (fe-client-features §9.2): the studio's name
 * and tagline, its own footer words, where its Locations are, its legal and
 * social links, and the copyright line. Every piece is the studio's own data
 * and is left out when the studio has not set it; nothing names the platform,
 * because a studio's member app is not a pitch for the software it runs on.
 *
 * Only on a studio's own address: the bare domain names no studio, so there
 * is nothing to read and nothing to show.
 */
export function SiteFooter() {
  const [onStudio, setOnStudio] = useState(false);
  useEffect(() => {
    setOnStudio(tenantSlugFromHost(window.location.host, ROOT_DOMAIN) !== null);
  }, []);
  return onStudio ? <StudioFooter /> : null;
}

function StudioFooter() {
  const brand = useBrand();
  const { data: locations } = useLocations();
  const { data: marketing } = useCachedResource("public:marketing", getMarketing);
  const { legal, social } = footerLinks(brand.copy);
  const footerText = marketing?.footer_text?.trim() || null;
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-paper">
      <div className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6 md:py-10">
        <div className="grid gap-8 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] md:gap-10">
          <div className="min-w-0">
            <p className="text-base font-bold tracking-tight text-ink">{brand.name}</p>
            {brand.tagline && <p className="mt-1 text-sm text-ink/80">{brand.tagline}</p>}
            {footerText && (
              <p className="mt-3 max-w-prose whitespace-pre-line text-sm leading-relaxed text-muted">{footerText}</p>
            )}
          </div>

          {locations && locations.length > 0 && (
            <div className="min-w-0">
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted">
                {locations.length === 1 ? "Location" : "Locations"}
              </h2>
              <ul className="mt-3 space-y-3">
                {locations.map((l) => (
                  <li key={l.id} className="flex gap-2 text-sm">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink/30" aria-hidden />
                    <div className="min-w-0">
                      {l.gmaps_url && /^https?:\/\//i.test(l.gmaps_url) ? (
                        <a
                          href={l.gmaps_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-ink hover:text-accent-deep transition-colors"
                        >
                          {l.name}
                        </a>
                      ) : (
                        <p className="font-semibold text-ink">{l.name}</p>
                      )}
                      {l.address && <p className="text-muted break-words">{l.address}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {social.length > 0 && (
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted">Follow</h2>
              <FooterLinks links={social} className="mt-3 flex-col gap-2" />
            </div>
          )}
        </div>

        <div className="mt-8 flex flex-col-reverse gap-3 border-t border-border pt-5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {brand.name}
          </p>
          {legal.length > 0 && <FooterLinks links={legal} className="gap-5" />}
        </div>
      </div>
    </footer>
  );
}

function FooterLinks({ links, className }: { links: FooterLink[]; className?: string }) {
  return (
    <ul className={`flex flex-wrap ${className ?? ""}`}>
      {links.map((link) => (
        <li key={link.href}>
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-muted hover:text-ink transition-colors"
          >
            {link.label}
          </a>
        </li>
      ))}
    </ul>
  );
}
