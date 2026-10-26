// The Staff page's bell links: `?invitation=<id>` and `?staff=<id>`
// (be/src/services/attention/staff-logins.ts). Which tab and view show the row.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Role = "admin" | "instructor";

export interface StaffLinkTarget {
  kind: "invitation" | "staff";
  id: string;
  tab: "admin" | "instructors";
  view: "active" | "archived";
}

const tabFor = (role: Role): StaffLinkTarget["tab"] => (role === "instructor" ? "instructors" : "admin");

function param(search: string, name: string): string | null {
  const id = new URLSearchParams(search).get(name);
  return id && UUID.test(id) ? id : null;
}

/**
 * What a bell link asks the Staff page to show, or null when it names nothing
 * the page lists (a stale link, a revoked or accepted invitation, a non-id).
 * Only a pending invitation is a row; a person is on the Archived view when
 * archived, and otherwise on Active (pending people are shown as invitations).
 */
export function staffLinkTarget(
  search: string,
  staff: ReadonlyArray<{ id: string; role: Role; status: "pending" | "active" | "archived" }>,
  invitations: ReadonlyArray<{ id: string; role: Role; status: string }>,
): StaffLinkTarget | null {
  const invitationId = param(search, "invitation");
  if (invitationId) {
    const inv = invitations.find((i) => i.id === invitationId && i.status === "pending");
    if (inv) return { kind: "invitation", id: inv.id, tab: tabFor(inv.role), view: "active" };
  }
  const staffId = param(search, "staff");
  if (staffId) {
    const person = staff.find((s) => s.id === staffId);
    if (person) {
      return {
        kind: "staff",
        id: person.id,
        tab: tabFor(person.role),
        view: person.status === "archived" ? "archived" : "active",
      };
    }
  }
  return null;
}
