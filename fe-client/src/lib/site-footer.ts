/**
 * The links in the footer (fe-client-features §9.2), from the studio's own
 * copy (`tenant_settings.copy`): its legal pages and its social accounts.
 *
 * Only what the studio set, and only web addresses — the values are studio
 * data, so anything that is not plainly http(s) is left out rather than put in
 * an href. There is no platform link and no stand-in: a studio that set none
 * gets a footer without links.
 */
export interface FooterLink {
  label: string;
  href: string;
}

const LEGAL: [key: string, label: string][] = [
  ["legal.terms_url", "Terms"],
  ["legal.privacy_url", "Privacy"],
];

const SOCIAL: [key: string, label: string][] = [
  ["social.instagram", "Instagram"],
  ["social.facebook", "Facebook"],
];

function webAddress(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && /^https?:\/\/\S+$/i.test(trimmed) ? trimmed : null;
}

function pick(copy: Record<string, string>, keys: [string, string][]): FooterLink[] {
  return keys.flatMap(([key, label]) => {
    const href = webAddress(copy[key]);
    return href ? [{ label, href }] : [];
  });
}

export function footerLinks(copy: Record<string, string>): { legal: FooterLink[]; social: FooterLink[] } {
  return { legal: pick(copy, LEGAL), social: pick(copy, SOCIAL) };
}
