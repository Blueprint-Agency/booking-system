import type { Api } from "./api";
import { refusalMessage } from "./refusal-message";

/**
 * The studio's emails and their switches (be-portal.md § emails.ts). The
 * backend's list is the whole truth, names included: the page shows what it
 * returns.
 */
export type EmailAudience = "member" | "staff";

export interface StudioEmail {
  slug: string;
  /** How the page lists it, in plain language. */
  name: string;
  audience: EmailAudience;
  /** Always sent: listed, never switchable. */
  locked: boolean;
  enabled: boolean;
}

export type StudioEmailsView = Record<EmailAudience, StudioEmail[]>;

const GROUPS: { audience: EmailAudience; title: string }[] = [
  { audience: "member", title: "To members" },
  { audience: "staff", title: "To staff" },
];

export interface EmailGroup {
  audience: EmailAudience;
  title: string;
  emails: { slug: string; name: string; locked: boolean; enabled: boolean }[];
}

/** The page's two lists, in the order the API gave each one. */
export function emailGroups(view: StudioEmailsView): EmailGroup[] {
  return GROUPS.map(({ audience, title }) => ({
    audience,
    title,
    emails: view[audience].map(({ slug, name, locked, enabled }) => ({ slug, name, locked, enabled })),
  }));
}

const PATH = "/portal/admin/emails";

export const fetchStudioEmails = (api: Api) => api.get<StudioEmailsView>(PATH);

const withEnabled = (view: StudioEmailsView, slug: string, enabled: boolean): StudioEmailsView => ({
  member: view.member.map((e) => (e.slug === slug ? { ...e, enabled } : e)),
  staff: view.staff.map((e) => (e.slug === slug ? { ...e, enabled } : e)),
});

/**
 * Switch one email, showing the change before the API answers. A refusal
 * puts the switch back and returns the sentence to show; success returns null.
 * `show` takes an update, so two switches saving at once each put back only
 * their own.
 */
export async function switchEmail(
  api: Api,
  slug: string,
  enabled: boolean,
  show: (update: (view: StudioEmailsView) => StudioEmailsView) => void,
): Promise<string | null> {
  show((view) => withEnabled(view, slug, enabled));
  try {
    const saved = await api.patch<StudioEmail>(`${PATH}/${encodeURIComponent(slug)}`, { enabled });
    show((view) => withEnabled(view, slug, saved.enabled));
    return null;
  } catch (err) {
    show((view) => withEnabled(view, slug, !enabled));
    return refusalMessage(err, "Couldn’t save the switch. Try again.");
  }
}
